# Technical Specification: Migration from Solana to Robinhood Chain

**Document type:** Standalone implementation task  
**Version:** 1.0  
**Language:** English  
**Deployment:** Vercel  
**Scope:** Blockchain integration migration, wallet connection, token configuration, token deposits and withdrawals, chain event processing, real-time updates, and two existing game bug fixes

---

## 1. Objective

Migrate the game's existing blockchain integration from Solana to Robinhood Chain while preserving the current user-facing economic flow:

1. The project token is launched on Robinhood Chain.
2. Users buy the token and hold it in their own compatible wallets.
3. An authorized administrator opens the protected `token-admin.html` page after token deployment.
4. The administrator enters and validates the Robinhood Chain ERC-20 contract address.
5. The game uses that active contract address for wallet balance checks, deposits, conversion, and withdrawals.
6. A user connects a wallet containing the configured token.
7. The user transfers an approved token amount into the game deposit system.
8. The existing conversion rules credit the corresponding internal Game Coins.
9. The user spends Game Coins inside the game.
10. The existing reverse-conversion flow allows eligible Game Coins to be converted back into the configured token and sent to the user's linked Robinhood Chain wallet.

The Solana implementation already exists. Preserve its product behavior where it remains valid, but replace Solana-specific transaction mechanics with correct EVM and ERC-20 mechanics. Do not mechanically rename Solana functions and addresses.

This task must also fix:

- an error shown when the player exits the interior editor without changing anything;
- a flickering or unstable texture in door openings.

---

## 2. Verified Robinhood Chain Network Profile

Robinhood Chain is an EVM-compatible Arbitrum Layer-2 network. It uses standard Ethereum JSON-RPC tooling and ETH as its native gas token.

### 2.1. Mainnet

```text
Network name: Robinhood Chain
Chain ID: 4663
Native gas token: ETH
Public RPC: https://rpc.mainnet.chain.robinhood.com
Block explorer: https://robinhoodchain.blockscout.com
```

### 2.2. Testnet

```text
Network name: Robinhood Chain Testnet
Chain ID: 46630
Native gas token: ETH
Public RPC: https://rpc.testnet.chain.robinhood.com
Block explorer: https://explorer.testnet.chain.robinhood.com
```

### 2.3. Production provider

Do not use the public rate-limited RPC as the sole production endpoint.

Use a production provider supported by Robinhood Chain. Robinhood currently recommends Alchemy and documents HTTP and WebSocket endpoints in the following form:

```text
Mainnet HTTP:
https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}

Mainnet WebSocket:
wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}

Testnet HTTP:
https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}

Testnet WebSocket:
wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}
```

Provider URLs and credentials must come from environment-specific server configuration.

### 2.4. Do not confuse withdrawal with bridging

The normal game withdrawal sends the configured ERC-20 token from the game system to the user's wallet on Robinhood Chain. It is not a withdrawal from Robinhood Chain to Ethereum.

Bridging through the canonical Arbitrum bridge is a separate operation and is outside the normal game flow. The canonical Robinhood Chain-to-Ethereum bridge may involve the Arbitrum challenge period. Do not make users bridge to Ethereum merely to receive a game withdrawal.

---

## 3. Fundamental Differences from the Current Solana Integration

Replace the following concepts deliberately:

| Current Solana concept | Robinhood Chain replacement |
|---|---|
| Solana cluster | EVM chain identified by Chain ID |
| SPL token mint address | ERC-20 contract address |
| Base58 public key | `0x` EVM address |
| Associated Token Account | ERC-20 balance stored by the token contract |
| SPL `getTokenAccountsByOwner` | ERC-20 `balanceOf(address)` |
| SPL token decimals | ERC-20 `decimals()` |
| Solana transaction signature | EVM transaction hash plus relevant log index |
| SOL transaction fees | ETH gas fees |
| SPL token transfer instruction | ERC-20 approval and deposit contract call |
| Solana wallet adapter | EIP-1193/EVM wallet connector |
| Solana commitment level | Robinhood Chain receipt and L2/L1 finality policy |
| Solana program event | EVM smart-contract event log |

Do not:

- store an EVM contract address in a Solana mint field without a schema migration;
- parse an EVM address as Base58;
- use JavaScript floating-point numbers for token amounts;
- trust a client-provided token balance;
- treat an EVM transaction hash alone as proof of one specific deposit;
- assume the same token contract address is valid on every chain.

Every blockchain record must include `chainId`.

---

## 4. Required Discovery Before Implementation

Audit the existing Solana implementation before modifying it.

Record:

- frontend framework and version;
- backend framework and runtime;
- Vercel project structure;
- current wallet library;
- current Solana RPC provider;
- current deposit transaction flow;
- current withdrawal transaction flow;
- current conversion formula;
- current treasury or vault model;
- current token configuration storage;
- current database schema;
- current internal balance records;
- current transaction status model;
- current WebSocket implementation;
- current reconnect and state-recovery logic;
- current admin authentication;
- current environment-variable names;
- all Solana-specific packages and code paths;
- all pending or failed Solana transaction states;
- all existing user wallet links and Game Coin balances.

Create a migration map for every Solana-specific module:

```text
Current module
Current responsibility
Solana dependency
Robinhood Chain replacement
Data migration required
Removal condition
Test status
```

Do not remove the Solana implementation until the Robinhood Chain testnet flow and rollback plan have passed verification.

---

## 5. Blockchain Abstraction

Separate game logic from network-specific logic.

Create or formalize an interface similar to:

```text
BlockchainAdapter
  getChainId()
  getNetworkMetadata()
  validateAddress(address)
  getNativeBalance(wallet)
  getTokenMetadata(tokenAddress)
  getTokenBalance(tokenAddress, wallet)
  buildApprovalRequest(...)
  buildDepositRequest(...)
  getTransactionReceipt(txHash)
  getDepositEvent(txHash, logIndex)
  getFinalityStatus(blockNumber, blockHash)
  buildWithdrawal(...)
  getExplorerUrl(...)
```

Implement:

```text
RobinhoodChainAdapter
```

The existing Solana adapter may remain temporarily during controlled migration, but all new production traffic must use the active network configuration.

Game systems must not import Solana RPC types directly after migration.

---

## 6. Token Requirements on Robinhood Chain

The configured project token must be an ERC-20 contract deployed on the selected Robinhood Chain environment.

Minimum required interface:

```solidity
function name() external view returns (string memory);
function symbol() external view returns (string memory);
function decimals() external view returns (uint8);
function totalSupply() external view returns (uint256);
function balanceOf(address account) external view returns (uint256);
function allowance(address owner, address spender) external view returns (uint256);
function approve(address spender, uint256 amount) external returns (bool);
function transfer(address to, uint256 amount) external returns (bool);
function transferFrom(address from, address to, uint256 amount) external returns (bool);
```

Use safe ERC-20 transfer handling because some contracts do not return values consistently.

### 6.1. Unsupported behavior for the initial release

Unless specifically implemented and tested, reject tokens with:

- rebasing balances;
- reflection rewards;
- fee-on-transfer mechanics;
- transfer restrictions incompatible with the vault;
- an active blacklist that can freeze the vault unexpectedly;
- nonstandard decimals behavior;
- transfers that change the received amount without an explicit supported calculation;
- malicious callbacks or behavior incompatible with the deposit contract.

If the project token intentionally uses one of these mechanisms, create a separate audited compatibility task before activation.

### 6.2. Integer amount handling

Store and calculate on-chain amounts in raw integer units.

Example:

```text
rawAmount = parsedHumanAmount × 10^tokenDecimals
```

Use `BigInt` or an equivalent arbitrary-precision integer type. Never use a JavaScript `number` for raw ERC-20 values.

Store:

```text
rawAmount
tokenDecimals
displayAmount
```

The authoritative value is `rawAmount`.

---

## 7. Protected `token-admin.html`

### 7.1. Security principle

The page may retain the URL `token-admin.html`, but a hidden URL is not access control.

Do not deploy an unprotected static file under a public directory and assume users cannot discover it.

Required protection:

- authenticated admin session;
- server-side role check on every admin API call;
- admin allowlist or role-based access control;
- multi-factor authentication where available;
- CSRF protection for session-based authentication;
- rate limiting;
- security audit logging;
- `Cache-Control: no-store`;
- `X-Robots-Tag: noindex, nofollow`;
- no token-management secrets in the browser bundle.

If `token-admin.html` must remain a literal route, use a Vercel rewrite or authenticated server-rendered response. Protect the API independently even if the page itself is protected.

### 7.2. Page fields

Required fields:

```text
Environment: Testnet or Mainnet
Chain ID
Token contract address
Expected token name
Expected token symbol
Expected token decimals
Token deployment transaction hash, optional
Deployment block or monitoring start block
Deposit vault address
Conversion configuration reference
Activation note
```

Chain ID must come from the selected environment and must not be freely typed.

### 7.3. Address validation

When an administrator enters a contract address:

1. trim whitespace;
2. validate EVM address format;
3. reject the zero address;
4. normalize the address using checksum formatting;
5. confirm the configured RPC is on the expected Chain ID;
6. call `eth_getCode` and reject an address with no contract code;
7. call `name()`;
8. call `symbol()`;
9. call `decimals()`;
10. call `totalSupply()`;
11. test `balanceOf()` through a read call;
12. check whether the contract behaves as the supported ERC-20 type;
13. display the Blockscout contract link;
14. compare returned metadata with the administrator's expected values;
15. display warnings before activation.

Do not allow the frontend to declare a contract valid without a successful server-side RPC validation.

### 7.4. Configuration states

Use:

```text
DRAFT
VALIDATED
ACTIVE
PAUSED
RETIRED
```

Only one token configuration may be `ACTIVE` for one game environment at a time.

### 7.5. Two-step activation

Required flow:

1. Admin enters the contract address.
2. Backend validates the contract.
3. Page displays canonical name, symbol, decimals, total supply, Chain ID, explorer link, and vault compatibility.
4. Admin reviews the result.
5. Admin enters a confirmation phrase or completes a second confirmation action.
6. Backend activates a new versioned token configuration.
7. An audit event is recorded.
8. Clients receive a sanitized configuration-change event and reload the public token metadata.

### 7.6. Token change safety

Every deposit quote must include:

```text
tokenConfigId
tokenConfigVersion
chainId
tokenAddress
vaultAddress
expiresAt
```

If the active token changes before the user submits a transaction, the old quote must expire.

Do not retire an old configuration while it has unresolved deposits or withdrawals. Continue monitoring its known contract and vault events until reconciliation is complete.

### 7.7. Admin audit log

Record:

```text
auditId
adminUserId
action
previousConfiguration
newConfiguration
serverTimestamp
requestId
sourceIpHash
result
failureReason
```

Do not log wallet signatures, private keys, full session tokens, or provider secrets.

---

## 8. Public Token Configuration

The client must not hard-code the token contract address.

Provide an authenticated or public sanitized endpoint such as:

```text
GET /api/token-config
```

Allowed response:

```json
{
  "networkName": "Robinhood Chain",
  "chainId": 4663,
  "tokenAddress": "0x...",
  "tokenName": "Project Token",
  "tokenSymbol": "PROJECT",
  "tokenDecimals": 18,
  "explorerUrl": "https://robinhoodchain.blockscout.com/address/0x...",
  "status": "ACTIVE",
  "configVersion": 1
}
```

Never return:

- RPC API keys;
- signer credentials;
- admin role configuration;
- webhook secrets;
- treasury signing secrets;
- internal risk thresholds.

---

## 9. Wallet Connection Migration

### 9.1. User security wording

Users connect a wallet. They never upload a wallet, seed phrase, private key, recovery phrase, or keystore file.

Use wording such as:

> Connect the wallet that holds the configured token. The game will never ask for your recovery phrase or private key.

### 9.2. EVM connection standard

Replace Solana-only wallet discovery with an EVM-compatible connection layer.

Recommended implementation stack:

- `viem` for EVM RPC and typed contract calls;
- `wagmi` or an equivalent maintained EVM connection layer;
- EIP-1193 injected wallet support;
- WalletConnect for compatible mobile and external wallets.

Do not allow one wallet provider's SDK to become the authoritative identity model.

### 9.3. Required initial providers

Support and test:

- Robinhood Wallet;
- MetaMask;
- Coinbase Wallet;
- WalletConnect-compatible wallets;
- OKX Wallet where its EVM connector supports the network;
- Phantom when its EVM account supports Robinhood Chain;
- Backpack when its EVM account supports Robinhood Chain.

Do not show Solana-only providers as compatible with Robinhood Chain unless they expose a tested EVM account and can switch to Chain ID 4663.

### 9.4. Network switching

After wallet connection:

1. read the active game `chainId`;
2. read the connected wallet's current chain;
3. if incorrect, request `wallet_switchEthereumChain`;
4. if the wallet reports the chain is unknown, request `wallet_addEthereumChain` with verified network metadata;
5. wait for `chainChanged` confirmation;
6. reload the token balance;
7. do not submit approval or deposit transactions on the wrong chain.

### 9.5. Wallet account changes

Handle:

- `accountsChanged`;
- `chainChanged`;
- wallet disconnect;
- locked wallet;
- rejected signature;
- rejected network switch;
- mobile deep-link return;
- stale wallet session.

Clear sensitive pending UI state when the active account changes.

### 9.6. Wallet ownership proof

Use a server-issued, one-time signed authentication challenge, preferably following Sign-In with Ethereum semantics.

Include:

```text
domain
wallet address
statement
URI
version
chain ID
nonce
issued at
expiration time
request ID
```

The backend verifies:

- signature;
- nonce;
- domain;
- Chain ID;
- expiration;
- replay status;
- account linking rules.

### 9.7. Multiple wallets

Preserve the current multi-wallet account model:

- one game account may link multiple supported EVM wallets;
- one linked wallet is selected as the active transaction signer;
- linking another wallet does not create another house or family;
- balances are checked separately for each wallet;
- a deposit is credited to the game account that owns the signed deposit request;
- withdrawal is allowed only to a verified linked wallet;
- wallets linked to the same game account cannot be treated as independent counterparties.

Existing Solana wallet records may be retained for historical transaction display, but they are not valid Robinhood Chain signing addresses.

---

## 10. Token Balance Display

After connecting and verifying a wallet:

1. load the active token configuration;
2. verify the wallet is on the configured Chain ID;
3. call the ERC-20 `balanceOf(wallet)`;
4. use the configured contract's verified decimals;
5. format the display value without losing precision;
6. show the wallet's ETH gas balance separately;
7. show a Blockscout link for the wallet and token;
8. refresh after a confirmed deposit or withdrawal;
9. refresh on account or chain change.

Display:

```text
Project Token balance
ETH available for gas
Internal Game Coin balance
Network: Robinhood Chain
```

If the user has the token but insufficient ETH for approval or deposit, show a specific gas warning before transaction submission.

---

## 11. Deposit Architecture

### 11.1. Required contract flow

Use a dedicated audited deposit vault or deposit contract rather than asking users to send tokens to an arbitrary externally owned address.

Recommended flow:

```text
User wallet
→ ERC-20 approval for exact required amount
→ deposit contract
→ token transferFrom into vault
→ Deposited event
→ backend verification
→ existing Game Coin credit logic
```

The contract should emit an event similar to:

```solidity
event Deposited(
    address indexed wallet,
    address indexed token,
    uint256 amount,
    bytes32 indexed depositId
);
```

### 11.2. Deposit request

Before a wallet transaction, request a server-generated deposit quote:

```text
POST /api/deposits/quote
```

Quote fields:

```text
depositId
gameAccountId
walletAddress
chainId
tokenAddress
vaultAddress
tokenConfigVersion
rawTokenAmount
displayTokenAmount
expectedGameCoins
conversionRuleVersion
expiresAt
```

The `depositId` must be unique, one-time, unpredictable, and bound to the game account and linked wallet.

### 11.3. Approval

Check:

```text
allowance(wallet, depositContract)
```

If allowance is insufficient:

- request approval for the exact required amount by default;
- clearly display the spender and amount;
- do not request unlimited approval unless an explicit advanced option and security review authorize it;
- wait for the approval receipt before submitting the deposit;
- handle user rejection separately from transaction failure.

If the token supports a verified permit standard, a one-transaction permit flow may be added later. Do not assume permit support.

### 11.4. Deposit submission

Required UI states:

```text
Preparing
Approval required
Waiting for approval signature
Approval submitted
Waiting for deposit signature
Deposit submitted
Confirming on Robinhood Chain
Credited
Failed
Expired
```

### 11.5. Server verification

Never credit Game Coins because the client sends a transaction hash.

The backend must independently verify:

- expected Chain ID;
- receipt exists;
- receipt status is successful;
- transaction interacted with the configured deposit contract;
- a canonical `Deposited` event exists;
- event token equals the active or expected versioned token contract;
- event wallet equals the linked wallet from the quote;
- event `depositId` equals the server-issued ID;
- event amount equals the actual supported deposited amount;
- event block hash is still canonical;
- quote was valid when the transaction was submitted;
- this event has not been credited before.

Use a uniqueness constraint based on:

```text
chainId + transactionHash + logIndex
```

Also enforce one successful credit per `depositId`.

### 11.6. Finality states

Robinhood Chain provides fast sequencer confirmation followed by posting and finality on Ethereum.

Use explicit states:

```text
SUBMITTED
SOFT_CONFIRMED
SAFE
FINALIZED
CREDITED
REORGED
FAILED
```

Do not use a fixed timeout as proof of finality.

Use the RPC provider's supported safe/finalized status or an equivalent documented Arbitrum settlement check.

Apply a risk policy:

- low-value testnet transactions may use a faster configurable threshold;
- production credits with withdrawal value must meet the configured safe settlement requirement;
- high-value transactions may require full Ethereum finality;
- the UI must distinguish “transaction received” from “Game Coins available.”

### 11.7. Reorganizations

If a previously observed event disappears before the configured settlement level:

- mark the deposit `REORGED`;
- do not credit it;
- continue monitoring for canonical inclusion;
- notify the private user channel;
- record the old and new block hashes.

Do not silently ignore removed logs.

---

## 12. Game Coin Credit Compatibility

Preserve the existing conversion formula unless a separate product decision changes it.

The migration must:

- feed verified ERC-20 raw amounts into the current conversion service;
- version the conversion rule used by every quote;
- preserve integer precision;
- avoid Solana-specific decimal assumptions;
- never credit before confirmed on-chain receipt and required settlement;
- produce the same expected user outcome as the former Solana flow for equivalent configured values.

Do not copy a Solana lamport or SPL base-unit constant into the EVM implementation.

---

## 13. Withdrawal to Robinhood Chain Wallet

### 13.1. User flow

1. User opens withdrawal.
2. User selects a verified linked Robinhood Chain wallet.
3. User enters an eligible Game Coin amount.
4. Backend generates a versioned withdrawal quote.
5. User confirms.
6. Existing internal logic locks or deducts the Game Coins.
7. The withdrawal worker submits the configured ERC-20 transfer on Robinhood Chain.
8. Backend monitors the receipt and settlement state.
9. The user receives the token in the selected wallet.
10. UI refreshes Game Coin, token, and transaction status.

### 13.2. Required checks

Verify:

- user session;
- linked-wallet ownership;
- wallet address format;
- Chain ID;
- active token configuration version;
- quote expiration;
- withdrawal limits already defined by the existing product;
- vault token balance;
- signer ETH gas balance;
- recipient is not the zero address;
- idempotency key;
- no duplicate processing.

### 13.3. Signer security

Never place a treasury private key in:

- frontend code;
- a `NEXT_PUBLIC_` variable;
- source control;
- browser storage;
- logs;
- `token-admin.html`.

Prefer a managed signer, HSM, KMS, or audited custody system with:

- transaction policy;
- amount limits;
- destination validation;
- role separation;
- key rotation;
- emergency pause;
- audit trail.

If a server-only Vercel environment secret is temporarily used during development, it must be environment-scoped and replaced by the approved production signer before mainnet activation.

### 13.4. Withdrawal states

Use:

```text
REQUESTED
VALIDATED
QUEUED
SUBMITTED
SOFT_CONFIRMED
SAFE
FINALIZED
COMPLETED
FAILED
REVERSED
MANUAL_REVIEW
```

The user must always be able to see whether the token has been submitted and open the transaction in Blockscout.

### 13.5. Failure behavior

If submission fails before an on-chain transaction exists:

- release or reverse the internal lock according to existing rules;
- do not create a fake transaction hash.

If a transaction exists but status is uncertain:

- keep the withdrawal pending;
- reconcile through chain data;
- do not submit a second transfer automatically with a new idempotency identity.

---

## 14. Smart-Contract Requirements

The deposit and vault contracts must receive an independent security review before mainnet use.

Required controls:

- supported-token allowlist;
- role-based administration;
- pause mechanism;
- replay-resistant deposit IDs where contract enforcement is appropriate;
- replay-resistant withdrawal authorization;
- safe ERC-20 transfers;
- reentrancy protection where state and external calls interact;
- explicit deposit and withdrawal events;
- zero-address rejection;
- amount validation;
- emergency recovery policy;
- upgrade or immutability decision documented;
- admin role transfer process;
- treasury withdrawal restrictions;
- test coverage for nonstandard ERC-20 return behavior.

Do not deploy a production contract copied from unverified generated code without review and tests.

---

## 15. Chain Event Ingestion

### 15.1. Do not rely on one live WebSocket connection

Robinhood Chain provider WebSockets are useful for fast event discovery, but they are not the sole durable record.

The chain indexer must:

- persist the last processed block and block hash;
- backfill missed ranges after reconnect;
- process logs in deterministic block/log order;
- handle duplicate notifications;
- handle removed logs;
- reconcile against HTTP RPC;
- survive a Vercel deployment or function restart;
- monitor every token configuration with unresolved operations.

### 15.2. Recommended ingestion model

Use one or both:

- provider webhooks delivering contract events to an authenticated Vercel Function;
- a durable block scanner using HTTP RPC and a persisted cursor.

Add periodic reconciliation through a protected Vercel Cron endpoint or the project's existing durable job mechanism.

The reconciliation job must verify:

- deposits seen in the database still exist canonically;
- no deposit event was missed;
- credited amounts equal verified event amounts;
- withdrawal receipts match stored statuses;
- configured token and vault balances are readable;
- signer gas balance is above threshold.

### 15.3. Ingestion cursor

Store:

```text
chainId
contractAddress
lastProcessedBlock
lastProcessedBlockHash
updatedAt
workerId
```

Never keep the only cursor in function memory.

---

## 16. Vercel Architecture

### 16.1. Runtime separation

Recommended responsibilities:

```text
Vercel server functions
  admin authentication and token configuration
  wallet challenge creation and verification
  token metadata and balance reads
  deposit and withdrawal quote APIs
  provider webhook receiver
  reconciliation endpoint
  private state APIs

Vercel WebSocket function
  house and business real-time events
  private deposit and withdrawal status events
  private wallet and Game Coin balance refresh signals

Durable database/store
  token configuration
  transaction states
  processed log identities
  event outbox
  WebSocket channel state
  reconciliation cursor
```

### 16.2. WebSocket behavior

Vercel WebSocket connections may close when a function reaches its runtime duration or during deployment.

Clients must:

- reconnect with exponential backoff;
- authenticate again where required;
- resubscribe to authorized channels;
- send or retrieve the last known revision;
- request a fresh snapshot after reconnect;
- tolerate duplicate events;
- stop retrying aggressively when the network is unavailable.

Do not store durable rooms, transaction state, or the only copy of presence in a WebSocket function's memory.

### 16.3. Separate chain and game sockets

Do not expose the Alchemy or provider WebSocket directly as the game's public WebSocket.

Use:

```text
Robinhood Chain provider
→ backend ingestion
→ canonical database update
→ internal event/outbox
→ authorized game WebSocket notification
```

Game clients must never decide that a deposit is valid by reading a raw provider event.

### 16.4. Required real-time events

Preserve existing house and business events.

Add private events:

```text
token_config_refreshed
wallet_linked
wallet_network_changed
deposit_status_changed
game_coin_balance_changed
withdrawal_status_changed
token_balance_refresh_required
```

Every event must include:

```text
eventId
eventType
accountId
stateRevision
serverTimestamp
sanitizedPayload
```

Do not broadcast wallet balances, deposit amounts, or withdrawal data to public world channels.

### 16.5. Event outbox

Write the canonical database change and an outbox event in the same database transaction where possible.

A separate publisher delivers outbox events to connected clients. Mark an event delivered only after the publishing attempt is recorded.

This prevents a successful blockchain credit from being saved without a corresponding recoverable notification.

---

## 17. Vercel Environment Configuration

Use separate Vercel Development, Preview, and Production values.

Recommended server-only variables:

```text
RHC_CHAIN_ID
RHC_RPC_HTTP_URL
RHC_RPC_WS_URL
RHC_EXPLORER_URL
RHC_DEPOSIT_CONTRACT_ADDRESS
RHC_VAULT_ADDRESS
RHC_PROVIDER_WEBHOOK_SECRET
RHC_CONFIRMATION_POLICY
RHC_RECONCILIATION_SECRET
RHC_SIGNER_REFERENCE
TOKEN_ADMIN_ROLE_ID
TOKEN_ADMIN_ALLOWLIST_HASH
```

Public browser configuration may include only non-secret metadata such as:

```text
NEXT_PUBLIC_RHC_CHAIN_ID
NEXT_PUBLIC_RHC_NETWORK_NAME
NEXT_PUBLIC_RHC_PUBLIC_RPC_URL
NEXT_PUBLIC_RHC_EXPLORER_URL
```

Do not put a paid RPC API key, signer key, webhook secret, or admin secret in a `NEXT_PUBLIC_` variable.

Required environment mapping:

| Vercel environment | Robinhood environment |
|---|---|
| Development | Testnet 46630 |
| Preview | Testnet 46630 |
| Production | Mainnet 4663 |

Preview deployments must not receive production signer credentials or production database write access unless an explicitly reviewed staging design requires it.

Commit an `.env.example` containing variable names with empty or clearly fake values. Never commit secrets.

---

## 18. Database Changes

Do not overwrite historical Solana data. Add chain-aware fields and migrate deliberately.

### 18.1. Network configuration

```text
networkId
networkType
chainId
networkName
nativeCurrency
rpcProviderType
explorerBaseUrl
environment
status
```

### 18.2. Token configuration

```text
tokenConfigId
networkId
chainId
contractAddress
checksumAddress
name
symbol
decimals
totalSupplyAtValidation
depositContractAddress
vaultAddress
monitoringStartBlock
configVersion
status
validatedAt
activatedAt
activatedBy
retiredAt
```

### 18.3. Linked wallet

```text
walletId
gameAccountId
chainFamily
chainId
address
checksumAddress
providerType
verifiedAt
lastUsedAt
status
```

Use a unique normalized EVM address plus applicable account-linking constraints. Do not lowercase an address for display, but use a normalized comparison field for uniqueness.

### 18.4. Deposit

```text
depositId
gameAccountId
walletId
chainId
tokenConfigId
tokenConfigVersion
tokenAddress
vaultAddress
rawAmount
tokenDecimals
expectedGameCoins
conversionRuleVersion
transactionHash
logIndex
blockNumber
blockHash
finalityStatus
status
quoteExpiresAt
creditedAt
createdAt
updatedAt
```

### 18.5. Withdrawal

```text
withdrawalId
gameAccountId
walletId
chainId
tokenConfigId
rawTokenAmount
gameCoinAmount
quoteVersion
transactionHash
blockNumber
blockHash
finalityStatus
status
failureCode
createdAt
submittedAt
completedAt
updatedAt
```

### 18.6. Processed chain log

```text
chainId
transactionHash
logIndex
contractAddress
eventName
blockNumber
blockHash
removed
processedAt
```

Use a database uniqueness constraint on `chainId + transactionHash + logIndex`.

---

## 19. Solana-to-Robinhood Data Migration

### 19.1. Preserve historical records

Keep:

- historical Solana wallet addresses;
- historical Solana deposit transaction signatures;
- historical Solana withdrawal transaction signatures;
- current internal Game Coin balances;
- user account ownership;
- houses;
- businesses;
- interiors;
- existing purchase history.

Label old blockchain records with their original network.

### 19.2. Do not reinterpret addresses

- a Solana wallet address is not an EVM wallet address;
- a Solana SPL mint is not a Robinhood Chain ERC-20 contract;
- an SPL token balance does not automatically exist on Robinhood Chain;
- do not automatically link an EVM address merely because a wallet application supports both networks.

Users must connect and sign with their Robinhood Chain EVM address.

### 19.3. Existing token-holder migration

If users already hold the old Solana token, moving those on-chain holdings to Robinhood Chain is a separate token migration problem.

Choose and document one explicit policy before production cutover:

- launch a new Robinhood Chain token with no automatic Solana migration;
- use an audited cross-chain bridge;
- use a controlled snapshot-and-claim process;
- use a verified burn-and-mint migration.

Do not invent Robinhood Chain balances by treating a Solana snapshot as proof without an approved claim process.

### 19.4. Pending operation cutover

Before disabling Solana:

1. stop creating new Solana deposit quotes;
2. let valid submitted quotes settle or expire;
3. reconcile every pending Solana deposit;
4. reconcile every pending Solana withdrawal;
5. snapshot database counts and balances;
6. enable Robinhood Chain deposits behind a feature flag;
7. verify test accounts;
8. activate the new token configuration;
9. monitor error rates;
10. keep the rollback procedure available.

---

## 20. Transaction and Admin Security

Required controls:

- server-side authorization for every sensitive endpoint;
- request validation using strict schemas;
- idempotency keys for deposit creation and withdrawal requests;
- one-time nonces;
- replay protection;
- address and Chain ID binding;
- rate limits by account, wallet, IP risk signal, and endpoint;
- RPC timeout and retry policy;
- circuit breaker for provider outages;
- contract-address allowlist;
- finality policy by transaction value;
- withdrawal velocity limits;
- anomaly alerts;
- admin action alerts;
- emergency pause for deposits;
- emergency pause for withdrawals;
- audit logs without secrets;
- dependency and smart-contract security review.

The client must never be trusted to provide:

- final token metadata;
- final balance;
- canonical deposit amount;
- successful receipt status;
- finality status;
- conversion result;
- admin authorization.

---

## 21. Fix: Error When Exiting an Unchanged Interior

### 21.1. Current defect

When a player opens the house interior editor and exits without changing anything, the game displays an error.

Expected behavior:

- opening and closing an unchanged interior is a valid no-op;
- no save request is required;
- no error is shown;
- the user returns to the previous game view normally.

### 21.2. Required state model

On editor entry, store or derive:

```text
initialInteriorRevision
initialInteriorSnapshotHash
currentInteriorSnapshotHash
dirtyState
saveState
```

`dirtyState` must change only after a real semantic edit such as:

- place item;
- remove item;
- move item;
- rotate item;
- replace item;
- change an editable material;
- change a floor-specific interior setting.

The following must not mark the interior dirty:

- opening the editor;
- changing camera position;
- selecting an item without placing it;
- switching floor tabs;
- opening a catalog;
- hovering over a placement slot;
- receiving an identical server snapshot.

### 21.3. Exit behavior

If `dirtyState = false`:

- exit immediately;
- do not call the mutation endpoint;
- do not show a save dialog;

- do not show an error.

If `dirtyState = true`:

show:

```text
Save changes
Discard changes
Continue editing
```

### 21.4. Backend no-op safety

Even if an old client submits an empty patch, the backend must treat a valid empty update as an idempotent no-op rather than a generic server error.

Return the current canonical revision and a result such as:

```json
{
  "status": "NO_CHANGES",
  "revision": 42
}
```

Do not create a new revision or duplicate WebSocket event for a no-op.

### 21.5. Required tests

- open and close the first floor without changes;
- open and close an upper floor without changes;
- move only the camera and exit;
- switch floors and exit;
- select an item and cancel placement;
- make a change and save;
- make a change and discard;
- double-click exit;
- exit during reconnect;
- receive an identical snapshot while the editor is open;
- use an old client that submits an empty patch.

---

## 22. Fix: Flickering Texture in Door Openings

### 22.1. Current defect

A texture flickers or shimmers around the door opening.

Do not assume that the source is the image texture. The likely causes include conflicting geometry or material layers.

### 22.2. Required investigation

For every affected door and wall variant:

1. reproduce the issue with a fixed camera path;
2. test from both sides of the door;
3. test at near, normal, and far camera distances;
4. inspect the wall, doorway cutout, jamb, trim, threshold, floor, and door mesh in wireframe;
5. check for duplicate or coplanar polygons;
6. check whether a decorative doorway surface sits on top of an uncut wall;
7. inspect material render queues;
8. inspect transparency or alpha-test settings;
9. inspect UV overlap and atlas padding;
10. inspect mipmaps and filtering;
11. inspect normals, tangents, and face orientation;
12. inspect LOD transitions;
13. disable shadows temporarily to distinguish shadow acne from texture flicker;
14. document the confirmed root cause;
15. implement the geometry, material, UV, or import fix at the source.

### 22.3. Required fix principles

- cut a real opening in the wall geometry where required;
- remove duplicate faces;
- avoid two coplanar material surfaces;
- rebuild the doorframe model if its geometry is incompatible;
- align wall and trim UVs;
- preserve deliberate doorway depth;
- update collision after geometry changes;
- keep the resident navigation opening valid;
- do not use a large arbitrary depth offset as the final fix;
- do not hide the issue only by changing camera angle;
- do not disable all shadows as the fix.

### 22.4. Coverage

Test:

- every house material;
- every door type;
- interior and exterior doorways;
- one- through five-floor houses;
- ground and upper floors;
- day and night lighting;
- fog;
- low and high graphics quality;
- camera movement through the opening;
- another connected client's reconstruction.

### 22.5. Acceptance

The doorway must not visibly flicker:

- while the camera is still;
- while panning;
- while zooming;
- while moving through the doorway;
- during LOD transition;
- after reloading the house;
- on another client.

---

## 23. Failure and Edge Cases

Handle at minimum:

- invalid token address;
- zero address;
- EOA entered instead of a contract;
- wrong Chain ID;
- RPC provider returns the wrong chain;
- token metadata call reverts;
- unsupported token mechanics;
- token configuration changed during a quote;
- admin session expires during activation;
- unauthorized request to admin API;
- wallet does not support Robinhood Chain;
- wallet refuses network switch;
- user switches account during approval;
- user has token but no ETH for gas;
- insufficient token balance;
- insufficient allowance;
- approval rejected;
- approval succeeds but deposit is rejected;
- quote expires before transaction submission;
- deposit transaction reverts;
- event amount differs from requested amount;
- duplicate provider webhook;
- duplicate log;
- same transaction contains multiple logs;
- chain reorganization;
- RPC outage;
- WebSocket disconnect;
- Vercel deployment closes live connections;
- indexer restarts between blocks;
- vault lacks withdrawal token balance;
- signer lacks ETH;
- withdrawal submitted but receipt is temporarily unavailable;
- withdrawal recipient changes after quote;
- old Solana wallet attempts an EVM transaction;
- user exits unchanged interior;
- door texture flickers on an upper floor.

Every user-facing error must distinguish:

- action rejected by user;
- incorrect wallet or chain;
- insufficient balance or gas;
- temporary provider problem;
- reverted on-chain transaction;
- transaction still pending;
- internal application failure.

---

## 24. Observability

Record metrics and alerts for:

- RPC latency and error rate;
- active RPC Chain ID mismatch;
- token metadata validation failures;
- wallet connection success by provider;
- network-switch rejection rate;
- approval rejection and failure rate;
- deposit submission rate;
- deposit confirmation time;
- deposit reconciliation mismatches;
- duplicate chain events;
- reorganization events;
- withdrawal queue age;
- withdrawal failure rate;
- vault token balance;
- signer ETH balance;
- WebSocket reconnect rate;
- snapshot recovery rate;
- unauthorized token-admin attempts;
- token-configuration changes;
- unchanged-interior exit errors;
- doorway flicker regression test status.

Never log:

- private keys;
- seed phrases;
- raw wallet-authentication signatures unless an approved secure retention need exists;
- session tokens;
- provider secrets;
- full sensitive admin request bodies.

---

## 25. Testing Strategy

### 25.1. Unit tests

- EVM address validation;
- checksum normalization;
- chain configuration;
- raw amount parsing and formatting;
- token decimal handling;
- quote expiration;
- deposit event decoding;
- unique log identity;
- finality state transitions;
- wallet challenge verification;
- token configuration versioning;
- interior dirty-state detection;
- no-op exit behavior.

### 25.2. Contract tests

- supported token deposit;
- approval amount;
- duplicate deposit ID;
- zero amount;
- wrong token;
- paused contract;
- safe-transfer behavior;
- event correctness;
- withdrawal authorization;
- replay attempt;
- role restrictions;
- emergency pause.

### 25.3. Robinhood Chain testnet tests

Use Chain ID 46630.

Test:

- add network to every supported wallet;
- connect every supported wallet;
- sign an ownership challenge;
- detect token balance;
- show ETH gas balance;
- approve exact token amount;
- deposit;
- confirm and credit once;
- reject duplicate processing;
- withdraw to linked wallet;
- view transaction in testnet explorer;
- recover after RPC WebSocket disconnect;
- backfill missed blocks;
- process a Vercel redeployment and reconnect;
- activate a new test token version;
- complete pending events from the retired test token.

### 25.4. Vercel environment tests

- Development uses testnet;
- Preview uses testnet;
- Production uses mainnet;
- Preview has no production signer credential;
- secrets are absent from the browser bundle;
- admin page is inaccessible without authorization;
- admin API is inaccessible even if its URL is known;
- WebSocket reconnect restores subscriptions and snapshots;
- durable state survives function-instance replacement.

### 25.5. Regression tests

- houses still build in real time;
- businesses still build in real time;
- existing Game Coin balance remains visible;
- existing houses and businesses remain owned;
- multi-wallet account does not create duplicate houses;
- business purchases continue using the existing internal system;
- unchanged interior exits without an error;
- changed interior still shows save/discard behavior;
- doorway texture remains stable in all required variants.

### 25.6. Mainnet smoke test

After approval and contract review:

- activate Robinhood Chain mainnet configuration;
- use a dedicated low-value test wallet;
- verify Chain ID 4663;
- perform a minimal real deposit;
- wait for the configured settlement state;
- verify one Game Coin credit;
- perform a minimal real withdrawal;
- verify the destination wallet and Blockscout record;
- verify reconciliation;
- pause rollout if any amount or identity mismatch occurs.

---

## 26. Delivery Phases

### Phase 1: Audit and abstraction

- document the Solana implementation;
- create the network migration map;
- introduce chain-aware database fields;
- create the blockchain adapter boundary;
- preserve historical Solana data.

### Phase 2: Robinhood Chain testnet foundation

- configure Chain ID 46630;
- configure production-grade test RPC credentials;
- implement ERC-20 reads;
- implement EVM wallet connection;
- implement wallet network switching;
- implement signed wallet linking.

### Phase 3: Protected token administration

- protect `token-admin.html`;
- implement server-side admin authorization;
- implement token contract validation;
- implement versioned configuration states;
- implement two-step activation and audit log.

### Phase 4: Deposit contracts and indexing

- implement or integrate the deposit vault;
- complete contract review and tests;
- implement exact approval flow;
- implement deposit quotes and submission;
- implement event ingestion, persisted cursor, backfill, and reconciliation;
- implement finality policy.

### Phase 5: Game Coin integration and withdrawals

- connect verified raw deposits to the existing conversion service;
- implement Robinhood Chain withdrawal submission;
- secure the production signer design;
- implement withdrawal status monitoring and reconciliation;
- add private real-time status events.

### Phase 6: Vercel real-time hardening

- preserve house and business events;
- add reconnect and resubscription logic;
- add snapshots and revisions;
- remove durable in-memory assumptions;
- add event outbox and private blockchain-status events;
- verify behavior through deployment restarts.

### Phase 7: Game bug fixes

- fix unchanged-interior exit behavior;
- diagnose and fix door-opening texture flicker;
- run floor, material, camera, lighting, and multiplayer regression tests.

### Phase 8: Controlled cutover

- settle or expire pending Solana operations;
- activate test cohort;
- activate Robinhood Chain mainnet token configuration;
- run low-value smoke tests;
- enable new deposits gradually;
- monitor balances and event reconciliation;
- disable Solana writes only after sign-off;
- retain historical Solana reads and rollback capability.

---

## 27. Acceptance Criteria

The task is complete only when all of the following are true.

### Network migration

1. The production application uses Robinhood Chain Chain ID 4663.
2. Development and Preview use Robinhood Chain Testnet Chain ID 46630.
3. ETH is displayed and used as the gas token.
4. Production does not rely solely on the public rate-limited RPC.
5. Every blockchain record is chain-aware.
6. Solana addresses and EVM addresses are not mixed.
7. Historical Solana records remain readable.
8. Current houses, businesses, interiors, ownership, and Game Coin balances remain intact.

### Token administration

9. `token-admin.html` requires real authentication and server-side authorization.
10. Knowing the admin URL does not grant access.
11. The token address is validated as a contract on the selected Chain ID.
12. Name, symbol, decimals, total supply, and balance behavior are validated.
13. Token activation is versioned and requires a second confirmation.
14. Only one token configuration is active per environment.
15. Old configurations remain monitored while operations are unresolved.
16. All admin changes are audited without logging secrets.
17. The client loads token metadata from the backend instead of hard-coding it.

### Wallets

18. Users connect wallets without uploading private keys or recovery phrases.
19. Robinhood Wallet and MetaMask are supported.
20. Coinbase Wallet and WalletConnect are supported.
21. Additional compatible EVM wallets are capability-tested before display.
22. The game can request adding and switching to Robinhood Chain.
23. Transactions cannot be submitted on the wrong Chain ID.
24. Wallet ownership is verified through a one-time signed challenge.
25. Multiple wallets may remain linked to one game account.
26. Linking another wallet does not create another house or family.

### Deposits

27. The game reads the configured ERC-20 balance correctly.
28. Raw token amounts use integer precision.
29. The user sees token balance and ETH gas balance separately.
30. Approval requests the exact required amount by default.
31. A unique server-issued deposit ID is used.
32. The backend verifies the canonical deposit event independently.
33. Transaction hash plus log index is unique.
34. A deposit cannot credit Game Coins twice.
35. A client-provided transaction hash is never sufficient proof.
36. Finality and reorganization states are handled explicitly.
37. A token configuration change invalidates stale quotes safely.

### Withdrawals

38. Eligible Game Coins can be converted back to the configured token through the existing product rules.
39. Tokens are sent to a verified linked wallet on Robinhood Chain.
40. A withdrawal does not require the user to bridge to Ethereum.
41. Signer secrets never enter the client bundle or repository.
42. Withdrawal processing is idempotent.
43. Failed and uncertain withdrawals are reconciled without double sending.
44. The user can see status and the Blockscout transaction link.

### Vercel and real time

45. Existing real-time house construction still works.
46. Existing real-time business construction still works.
47. Blockchain provider events pass through authoritative backend verification.
48. Private financial events are not broadcast publicly.
49. WebSocket clients reconnect with backoff and restore subscriptions.
50. Clients reload canonical state after reconnect.
51. Durable state and chain cursors are not kept only in function memory.
52. A Vercel deployment does not permanently lose chain events.
53. Missed blocks can be backfilled and reconciled.
54. Production secrets are isolated from Preview deployments.

### Bug fixes

55. Exiting an unchanged interior produces no error.
56. An unchanged exit does not send an unnecessary mutation or create a revision.
57. Changed interiors still provide Save, Discard, and Continue Editing actions.
58. A valid empty update from an old client is treated as a no-op.
59. Doorway texture flicker has a documented confirmed root cause.
60. The doorway does not flicker during movement, zoom, LOD changes, or reload.
61. The doorway fix works across materials, doors, floors, lighting states, and connected clients.
62. Door collision and resident navigation remain valid after the visual fix.

---

## 28. Definition of Done

The migration is ready when:

1. an authorized administrator can securely configure a verified Robinhood Chain ERC-20 address through `token-admin.html`;
2. the application uses that versioned address as the single active project token for the selected environment;
3. a user can connect a supported EVM wallet on Robinhood Chain;
4. the game correctly reads the user's token and ETH balances;
5. the user can approve and deposit the token;
6. the backend independently confirms the correct event and credits Game Coins once;
7. the user can convert eligible Game Coins back into the token and receive it in a verified linked Robinhood Chain wallet;
8. all blockchain status changes survive RPC disconnects, Vercel restarts, deployments, duplicate events, and client reconnects;
9. the current real-time house and business systems continue working;
10. exiting an unchanged interior no longer produces an error;
11. the door-opening texture no longer flickers;
12. historical Solana records and existing game ownership data remain intact;
13. Robinhood Chain mainnet has passed a controlled low-value end-to-end smoke test.

The work is not complete if the frontend merely displays Robinhood Chain while deposits, confirmations, contract validation, withdrawals, or event recovery still depend on Solana assumptions.

---

## 29. Official References

- [Robinhood Chain overview](https://docs.robinhood.com/chain/)
- [Connecting to Robinhood Chain: Chain IDs, RPC, WebSocket, and explorers](https://docs.robinhood.com/chain/connecting)
- [Add Robinhood Chain to a wallet](https://docs.robinhood.com/chain/add-network-to-wallet)
- [Robinhood Chain differences from Ethereum](https://docs.robinhood.com/chain/differences-from-ethereum)
- [Robinhood Chain gas and fees](https://docs.robinhood.com/chain/gas-and-fees)
- [Robinhood Chain transaction finality](https://docs.robinhood.com/chain/transaction-finality)
- [Robinhood Chain bridging](https://docs.robinhood.com/chain/bridging)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel WebSockets](https://vercel.com/docs/functions/websockets)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
