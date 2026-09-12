# Token City deposit vault — Robinhood Chain

`TokenCityVault.sol` is the deposit and withdrawal contract the backend verifies
against. It is **not** deployed by this repository and **must not** reach mainnet
before the checks below are complete (task8 §14, §25.2).

## Required before any deployment

1. Independent security review of the contract source.
2. A contract test suite (Foundry or Hardhat) covering, at minimum:
   - supported-token deposit succeeds and emits the exact `Deposited` event;
   - approval below the amount reverts;
   - duplicate `depositId` reverts;
   - zero amount and zero address revert;
   - unsupported token reverts;
   - paused contract rejects deposits and withdrawals;
   - a token returning no value on `transfer`/`transferFrom` is accepted;
   - a token returning `false` is rejected;
   - a fee-on-transfer token is rejected by the balance-delta check;
   - `withdrawTo` is rejected for a non-withdrawer;
   - duplicate `withdrawalId` reverts;
   - reentrancy through a malicious token is rejected;
   - admin handover requires `acceptAdmin`.
3. Gas and event-shape verification against `server/chain/abi.js`.
4. Blockscout source verification after deployment.

## Deployment order

1. Deploy `TokenCityVault(initialAdmin)` on Robinhood Chain Testnet (46630).
2. `setSupportedToken(projectToken, true)`.
3. `setWithdrawer(withdrawalSigner, true)`.
4. Record the deployment block — it is the `monitoringStartBlock` in the
   operations console.
5. Validate and activate the token configuration in `/token-admin.html`.
6. Repeat on mainnet (4663) only after the testnet flow in
   `docs/TASK8_MIGRATION.md` has passed.

## Interface contract

The backend depends on these exact signatures:

```
function deposit(address token, uint256 amount, bytes32 depositId) external;
function withdrawTo(address token, address to, uint256 amount, bytes32 withdrawalId) external;
function depositUsed(bytes32) external view returns (bool);
function withdrawalUsed(bytes32) external view returns (bool);
function supportedToken(address) external view returns (bool);
function paused() external view returns (bool);
event Deposited(address indexed wallet, address indexed token, bytes32 indexed depositId, uint256 amount);
event Withdrawn(address indexed wallet, address indexed token, bytes32 indexed withdrawalId, uint256 amount);
```

`depositId` is `keccak256(utf8(serverDepositId))` and `withdrawalId` is
`keccak256(utf8(serverWithdrawalId))`; see `server/chain/quotes.js`.
