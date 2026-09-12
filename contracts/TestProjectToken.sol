// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal ERC-20 used ONLY to exercise the Robinhood Chain testnet flow.
 *
 * It is deliberately plain: 18 decimals, no fee on transfer, no rebasing, no
 * blacklist, no callbacks. That is exactly the token shape the deposit vault
 * and the backend validator support, so a successful testnet run proves the
 * game's own code rather than a token quirk.
 *
 * Do not deploy this on mainnet. The real project token is launched separately.
 */
contract TestProjectToken {
    string public name = "Token City Test";
    string public symbol = "TCITY";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error NotMinter();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address initialMinter, uint256 initialSupply) {
        if (initialMinter == address(0)) revert ZeroAddress();
        minter = initialMinter;
        _mint(initialMinter, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked { balanceOf[from] = balance - amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
