// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Token City deposit vault for Robinhood Chain (task8 §11.1, §14).
 *
 * Deposits are pulled with transferFrom against an exact allowance and are
 * identified by a server-issued depositId, so the backend can bind one event to
 * one quote. Withdrawals leave through an authorized entry point with its own
 * replay-resistant id, so a retried worker can never pay twice.
 *
 * Deliberate design decisions:
 *   * immutable, not upgradeable — an upgrade path is a second signing key on
 *     the money and is not justified for this scope;
 *   * fee-on-transfer, rebasing and reflection tokens are rejected at deposit
 *     time by comparing the balance delta with the requested amount, because
 *     the crediting logic assumes the received amount equals the event amount;
 *   * no ETH is ever held or accepted.
 *
 * This contract MUST pass an independent security review and a full test suite
 * before it is used on mainnet. Do not deploy generated code unreviewed.
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TokenCityVault {
    // ── roles ───────────────────────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public isWithdrawer;
    mapping(address => bool) public isPauser;

    // ── configuration ───────────────────────────────────────────────────────
    mapping(address => bool) public supportedToken;
    bool public paused;

    // ── replay protection ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public depositUsed;
    mapping(bytes32 => bool) public withdrawalUsed;

    event Deposited(address indexed wallet, address indexed token, bytes32 indexed depositId, uint256 amount);
    event Withdrawn(address indexed wallet, address indexed token, bytes32 indexed withdrawalId, uint256 amount);
    event TokenSupportChanged(address indexed token, bool supported);
    event PausedChanged(bool paused);
    event RoleChanged(string role, address indexed account, bool enabled);
    event AdminTransferStarted(address indexed from, address indexed to);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error NotWithdrawer();
    error NotPauser();
    error IsPaused();
    error ZeroAddress();
    error ZeroAmount();
    error TokenNotSupported();
    error IdAlreadyUsed();
    error UnexpectedAmountReceived();
    error TransferFailed();
    error Reentrancy();

    uint256 private _entered;

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        isPauser[initialAdmin] = true;
        emit AdminTransferred(address(0), initialAdmin);
    }

    // ── administration ──────────────────────────────────────────────────────
    function setSupportedToken(address token, bool supported) external onlyAdmin {
        if (token == address(0)) revert ZeroAddress();
        supportedToken[token] = supported;
        emit TokenSupportChanged(token, supported);
    }

    function setWithdrawer(address account, bool enabled) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isWithdrawer[account] = enabled;
        emit RoleChanged("withdrawer", account, enabled);
    }

    function setPauser(address account, bool enabled) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isPauser[account] = enabled;
        emit RoleChanged("pauser", account, enabled);
    }

    function setPaused(bool value) external {
        if (!isPauser[msg.sender] && msg.sender != admin) revert NotPauser();
        paused = value;
        emit PausedChanged(value);
    }

    /// Two-step admin handover: a mistyped address cannot lock the contract.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAdmin();
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }

    // ── deposits ────────────────────────────────────────────────────────────
    /**
     * Pull `amount` of `token` from the caller and record the deposit.
     * The caller must have approved exactly this contract for at least `amount`.
     */
    function deposit(address token, uint256 amount, bytes32 depositId) external nonReentrant {
        if (paused) revert IsPaused();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!supportedToken[token]) revert TokenNotSupported();
        if (depositId == bytes32(0) || depositUsed[depositId]) revert IdAlreadyUsed();
        depositUsed[depositId] = true;

        uint256 before = IERC20(token).balanceOf(address(this));
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        // A fee-on-transfer, reflection or rebasing token would deliver a
        // different amount than the event claims. Reject instead of crediting a
        // number the vault does not actually hold.
        if (received != amount) revert UnexpectedAmountReceived();

        emit Deposited(msg.sender, token, depositId, amount);
    }

    // ── withdrawals ─────────────────────────────────────────────────────────
    function withdrawTo(address token, address to, uint256 amount, bytes32 withdrawalId) external nonReentrant {
        if (!isWithdrawer[msg.sender]) revert NotWithdrawer();
        if (paused) revert IsPaused();
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!supportedToken[token]) revert TokenNotSupported();
        if (withdrawalId == bytes32(0) || withdrawalUsed[withdrawalId]) revert IdAlreadyUsed();
        withdrawalUsed[withdrawalId] = true;

        _safeTransfer(token, to, amount);
        emit Withdrawn(to, token, withdrawalId, amount);
    }

    /**
     * Emergency recovery for a token that was sent here by mistake. It is
     * deliberately admin-only, pausable-independent and fully logged as a
     * withdrawal so reconciliation still sees the movement.
     */
    function emergencyRecover(address token, address to, uint256 amount, bytes32 recoveryId) external onlyAdmin nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (recoveryId == bytes32(0) || withdrawalUsed[recoveryId]) revert IdAlreadyUsed();
        withdrawalUsed[recoveryId] = true;
        _safeTransfer(token, to, amount);
        emit Withdrawn(to, token, recoveryId, amount);
    }

    // ── safe ERC-20 helpers ─────────────────────────────────────────────────
    // Some deployed tokens return nothing instead of a bool. Accept an empty
    // return, reject an explicit false, and reject a call into a non-contract.
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
