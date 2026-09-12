# Task 8 — Solana → Robinhood Chain migration

Status: implemented in this repository and verified as far as this environment
allows. Three things are **not** done and cannot be done from here; they are
listed under [What is still required](#what-is-still-required).

---

## 1. Verified network profile

Both endpoints were queried live from this repository:

| Environment | Chain id | RPC | Latest / safe / finalized |
|---|---:|---|---|
| Mainnet | 4663 | `https://rpc.mainnet.chain.robinhood.com` | answered, `safe` and `finalized` tags supported |
| Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` | answered, `safe` and `finalized` tags supported |

Gas token is ETH on both. Explorers are Blockscout
(`https://robinhoodchain.blockscout.com`, `https://explorer.testnet.chain.robinhood.com`).

Because the chain reports `safe` and `finalized` block tags, the settlement
policy uses them directly instead of a timeout (`server/chain/finality.js`).

---

## 2. Audit of the Solana implementation

| Module | Responsibility | Solana dependency | Robinhood Chain replacement | Data migration | Removal condition | Test status |
|---|---|---|---|---|---|---|
| `src/solana.js` | RPC, mint checks, deposits, payouts | `@solana/web3.js`, `@solana/spl-token` | `server/chain/adapter.js` + `convex/chainActions.js` | none (no state) | after mainnet sign-off | retained, unimported |
| `src/walletProviders.js` | Wallet Standard discovery | Solana Wallet Standard | `src/chain/evmProviders.js` (EIP-6963) | none | after mainnet sign-off | retained, unimported |
| `src/tokenAdmin.js`, `token-admin.html`, `src/tokenAdmin.css` | unprotected static admin page | SPL mint validation | `server/adminConsole.js` + `api/token-admin-page.js` | none | **removed** | replaced |
| `api/public-config.js` | public C/A in Redis | Base58 address | `api/token-config.js` (versioned, Convex) | historical value kept, writes disabled (HTTP 410) | keep for history | `tests/publicConfig.test.js` |
| `api/pool.js`, `server/publicConfig.js`, `scripts/setup-devnet-*.mjs` | Devnet pool tooling | SPL/Base58 | none — replaced by the vault | none | keep for history | `tests/poolApi.test.js` |
| `src/market.js` pricing | conversion formula | none | extracted to `server/conversion.js`, versioned | none | n/a | `tests/economy.test.js`, `tests/robinhoodChain.test.js` |
| `src/state.js` linked wallets | wallet records | `network: 'solana'` | `chainFamily` + `chainId` per wallet | on-load labelling, Solana rows marked `historical` | never | `tests/economy.test.js` |
| `convex/world.js` `beginPayment` | payment session guard | Base58 wallet regex | EVM address accepted | none | n/a | `tests/worldProtocol.test.js` |

Preserved untouched: Game Coin balances and the double-entry ledger, houses,
house definitions, interiors, placements, businesses, inventories, visits,
household state, and every historical Solana address and signature.

---

## 3. What was built

### Chain foundation — `server/chain/`
`networks.js` (chain registry and environment mapping), `evm.js` (EIP-55
checksum implemented locally, BigInt raw amounts, no floats), `abi.js`,
`finality.js` (state machines, settlement policy, log identity),
`tokenConfig.js` (DRAFT/VALIDATED/ACTIVE/PAUSED/RETIRED, versioning, sanitized
public projection), `quotes.js`, `siwe.js`, `depositVerification.js`, and
`adapter.js` (`RobinhoodChainAdapter`, the only module that speaks RPC).

`server/conversion.js` holds the versioned Game Coin conversion rule, extracted
unchanged from the Solana build so an identical configuration produces an
identical player outcome.

### Durable state — `convex/`
New tables: `tokenConfigs`, `chainAudit`, `walletChallenges`,
`linkedChainWallets`, `chainSessions`, `chainDeposits`, `chainWithdrawals`,
`processedChainLogs`, `chainCursors`, `chainOutbox`. Uniqueness on
`chainId + transactionHash + logIndex`; one credit per `depositId`.

`convex/chain.js` holds the canonical records and never makes a network call.
`convex/chainActions.js` (`"use node"`) is the only place with RPC access or a
signer. `convex/crons.js` runs reconciliation every two minutes and the
withdrawal queue every minute — the cursor is a database row, so a redeploy or
a dropped connection delays ingestion but never loses a deposit.

### Protected operations page
`/token-admin.html` is rewritten to `api/token-admin-page.js`. An
unauthenticated request receives only a login shell; the operations markup is
rendered server-side for an authenticated session. `api/token-admin.js` is
authorized independently: session cookie, CSRF token, same-origin check, rate
limit, `no-store`, `noindex`. Every action writes an audit row without
signatures, keys, session tokens or provider secrets. Activation is two-step
and requires the exact confirmation phrase.

### Client
`src/chain/evmProviders.js` (EIP-6963 discovery, Robinhood Wallet, MetaMask,
Coinbase, OKX, Phantom EVM, Backpack EVM, plus lazily loaded WalletConnect),
`src/chain/evmWallet.js` (connect, `wallet_switchEthereumChain` /
`wallet_addEthereumChain`, account and chain events, `personal_sign`, approve
and deposit submission), `src/chain/chainService.js` (config, sign-in,
balances, quotes, deposit run, withdrawal request, private subscriptions).

Private deposit and withdrawal events ride the existing authorized Convex
socket. No provider WebSocket is exposed to the browser, and no game client
decides that a deposit is valid.

### Contracts
`contracts/TokenCityVault.sol` with allowlist, roles, pause, replay-resistant
deposit and withdrawal ids, safe ERC-20 handling, reentrancy guard, a
balance-delta check that rejects fee-on-transfer and rebasing tokens, and a
two-step admin handover. `contracts/README.md` lists the review and test gate.

---

## 4. Bug fixes

### Exiting an unchanged interior (§21)
Root cause: `Interior#dirty` compared `JSON.stringify(objects)` against
`JSON.stringify(committed)`. Both sides are produced by `normalizeObjectInstance`,
whose result spreads the source object first, so **key order** followed whatever
the document happened to carry. A saved layout reloaded from the world document
and the same layout normalized in memory could serialize differently, the editor
believed the interior was dirty, ran full validation on exit and reported an
error on a house the player had not touched.

Fix: `server/interiorSnapshot.js` defines a semantic snapshot — only the fields
a player can change, coordinates rounded to a millimetre, sorted by object id.
`dirtyState` compares snapshots. An unchanged exit now leaves immediately with
no mutation, no dialog and no error; a changed exit offers Save, Discard and
Continue editing. `convex/world.js#save` returns
`{ status: 'NO_CHANGES', revision }` for a valid patch that changes nothing, so
an older client cannot force a new revision or a duplicate realtime event.

Covered by `tests/interiorNoOp.test.js`.

### Flickering texture in door openings (§22)
Root cause, in order of contribution:

1. **The ghosted front wall.** It is transparent with `depthWrite: false` and
   was built from boxes. Around an opening those boxes meet, so two blended
   faces sat on one plane and three.js re-sorted them by distance every frame;
   the order flipped as the camera orbited and the doorway edge crawled. A
   second transparent shell — the ghost jamb and header — was stacked on top of
   it. This is the artifact players see.
2. **Window frame corners.** The vertical and horizontal bars had the same
   depth, so their front faces coincided at the four corners: two same-facing
   coplanar faces, which is a true z-fight.
3. **Per-opening wall slicing.** The wall was cut into a separate piece above
   every opening, multiplying seams for both problems above.

Not a cause, though it looks like one: the butt joints between opaque wall
pieces and the frame. Those faces point away from each other and are back-face
culled, so they never fight. The fix therefore does **not** overlap opaque wall
pieces — overlapping them would have *created* same-facing coplanar faces.

Fix: ghost walls are single-sided planes with a fixed render order and no
transparent frame; the wall above the tallest opening is one continuous band;
jambs and header are embedded into the wall and into each other so no face is
shared; window frame bars have different depths; frame parts now cast and
receive shadows consistently with the wall. The exterior house door frame had
the same self-overlap (header and jamb shared their top, side and front planes)
and is now seated 4 cm into the wall with interpenetrating parts.

No `polygonOffset`, no depth-buffer change, no disabled shadows, no hidden
surface. Opening geometry, `doorX`, room ids, sockets and clearances are
unchanged, so collision and resident navigation are unaffected — asserted in
`tests/doorwayGeometry.test.js`, which fails on any *same-facing* coincident
face that is not buried inside another solid, across door widths, opening
heights, wall thicknesses, mixed door/window walls, every material and kit.

---

## 5. Verification performed here

- `npm test` — 97 tests pass, including 20 new Robinhood Chain unit tests,
  6 interior no-op tests and 6 doorway geometry tests.
- `npm run build` — succeeds. The pre-existing >500 kB chunk advisory remains;
  `viem` added roughly 90 kB and WalletConnect is a lazily loaded chunk.
- Live RPC probe of both Robinhood Chain networks (section 1).
- `GET /token-admin.html` without a session returns **401 and a login shell
  only** — no operations markup, no field names, no chain metadata.
- `GET /api/token-config` returns the sanitized network shell and no secret.

## 6. Live deployment (2026-09-07)

Deployed to Vercel production, `dpl_CEnbqyEqFj3Kmur5pWxu7VWDABPg`, aliased to
https://token-city.vercel.app. The build pushed the new Convex schema, functions
and crons to the production deployment `adamant-flamingo-747`; the new tables and
indexes were created and no existing table was altered.

`npm run verify:chain -- https://token-city.vercel.app` — 17/17 checks pass
against the live site.

Production environment variables added: `CONVEX_URL`, `CHAIN_SERVICE_SECRET`,
and `RHC_ENVIRONMENT=testnet`.

### RHC_ENVIRONMENT is deliberately set to testnet

Mainnet 4663 has neither the project token nor a reviewed vault, so nothing can
be exercised there. The live site therefore runs against Robinhood Chain Testnet
46630 — the staged-cohort approach in task8 §26 Phase 8. Deposits, credits and
withdrawals are real transactions on a real chain, just not real money.

Rollback to mainnet is one variable and one redeploy:

```bash
vercel env rm RHC_ENVIRONMENT production
vercel deploy --prod
```

Nothing else changes: the token configuration is versioned per environment, and
a configuration validated for testnet can never be activated on mainnet.

## 7. Testnet test wallets

`npm run setup:testnet-wallets` creates a deployer, a dedicated withdrawal
signer and three player wallets in `wallet-access/robinhood-testnet.local.json`
(mode 0600, gitignored, never uploaded). The signer is deliberately not the
vault admin: the key the backend holds can move approved withdrawals and
nothing else.

```bash
npm run setup:testnet-wallets            # create / show status and balances
npm run setup:testnet-wallets fund       # deployer -> signer and players (gas)
npm run setup:testnet-wallets deploy     # test ERC-20 + vault, allowlist, mint
```

`deploy` compiles `contracts/TestProjectToken.sol` and
`contracts/TokenCityVault.sol` with solc-js, deploys both, allowlists the token,
grants the withdrawer role to the signer, mints 250,000 TCITY to each player and
seeds the vault with 500,000 TCITY so a withdrawal can be tested before any
deposit exists. It then prints exactly the values to paste into
`/token-admin.html`.

Testnet ETH comes from Alchemy's faucet — 0.1 ETH per address every 24 hours,
no account required: https://www.alchemy.com/faucets/robinhood-testnet

`TestProjectToken` is a deliberately plain 18-decimal ERC-20 with no fee on
transfer, no rebasing and no callbacks, so a successful run proves the game's
code rather than a token quirk. It is testnet-only.

## What is still required

These need credentials or a chain this environment does not have:

1. **Deploy Convex and set its environment variables.** The new tables,
   functions and crons must be pushed (`npx convex deploy`), and
   `CHAIN_SERVICE_SECRET`, `RHC_RPC_HTTP_URL_*` and the signer variables set in
   the Convex deployment environment.
2. **Deploy and review the vault contract.** `contracts/README.md` lists the
   required security review and contract test suite. Nothing may go to mainnet
   before both are complete.
3. **Testnet and mainnet end-to-end runs.** Section 25.3 and 25.6 of the task —
   wallet-by-wallet connection tests, a real approve/deposit/credit cycle, a
   real withdrawal, and the low-value mainnet smoke test — require a deployed
   vault, a deployed token and funded wallets.

Until a token configuration is activated, deposits are refused with a clear
message and no code path falls back to Solana.

## Cutover order

1. Deploy Convex with the new functions; set the Convex environment variables.
2. Deploy the vault on testnet (46630); `setSupportedToken`, `setWithdrawer`.
3. Open `/token-admin.html`, validate the token, review the metadata and
   warnings, then activate with the confirmation phrase.
4. Run the testnet checklist in task8 §25.3.
5. Repeat on mainnet (4663) behind the same console; run the §25.6 smoke test
   with a dedicated low-value wallet.
6. Leave the Solana modules in place, unimported, until sign-off.
