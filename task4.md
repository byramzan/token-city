# Technical Specification: Token Economy, User Marketplace, Multi-Wallet Support, Residents, Camera, and Visual Improvements

**Version:** 2.0  
**Date:** August 7, 2026  
**Status:** Product and engineering specification  
**Language:** English  
**Chain:** Solana  
**External token launch:** Pump.fun  
**Post-graduation market:** PumpSwap

---

## 1. Purpose

This document defines the required changes to the game economy, backend accounting, player-owned businesses, user-to-user purchases, wallet integration, resident simulation, camera controls, fog, and visual quality.

The main economic requirement is:

> Game Coins are created only when users deposit the configured Project Token. Once created, those Game Coins circulate between users. A purchase from another user transfers existing Game Coins from the buyer to the seller. It must never mint a second copy of the payment.

The backend must track every monetary movement using an auditable double-entry ledger.

---

## 2. Main Product Rules

- One game account may own one main house.
- One game account may link multiple wallets.
- A linked wallet does not create another house.
- The Project Token is an external SPL token launched through Pump.fun.
- Game Coins are the internal transactional balance.
- Game Coins are issued only against a confirmed Project Token deposit and valid reserve backing.
- Player-to-player purchases transfer existing Game Coins.
- Business revenue belongs to the seller after settlement.
- Sellers may reuse settled revenue inside the game or withdraw it, subject to policy and limits.
- Reputation, XP, resident stats, and promotional points are not money and cannot be withdrawn.
- A business is purchased separately and is not created automatically with the house.
- Four residents spawn when the house is completed.
- Residents have needs that create demand for player businesses.
- Residents must not spend withdrawable user funds without explicit permission.

---

## 3. Changes That Supersede Previous Requirements

The following previous rules no longer apply:

- Game Coins are no longer permanently non-withdrawable.
- A commercial building is no longer created automatically.
- The application is no longer limited to Phantom.
- One wallet is no longer treated as the entire identity of the user.
- Materials are no longer priced in a permanently fixed number of Project Tokens.
- Residents are no longer purely decorative.
- A user must not leave the house builder to add funds.

The following rules remain:

- one main house per game account;
- shared 3D low-poly city;
- slot-based interior placement;
- automatic city roads and connection graph;
- guest city exploration;
- no promise of financial return;
- no request for private keys or seed phrases.

---

## 4. Pump.fun Pricing Model

### 4.1. Bonding curve

Every new Pump.fun coin begins on a bonding curve.

Pump.fun describes the curve as a constant-product automated market maker using virtual reserves.

This means:

- every buy pushes the price upward;
- every sell pushes the price downward;
- large orders receive more price impact;
- early buyers generally receive a lower price than later buyers;
- the price is calculated by the curve rather than fixed by the game;
- a quoted amount can change before execution.

The game cannot force every user to acquire the external Project Token at the same historical price.

### 4.2. Graduation

After the Pump.fun graduation threshold is reached:

- the bonding curve closes;
- liquidity migrates to the canonical PumpSwap pool;
- trading continues on PumpSwap;
- the transition is automatic and irreversible.

### 4.3. Fees

At the time of this specification:

- the Pump.fun bonding curve total trading fee is 1.25%;
- PumpSwap canonical-pool fees depend on market capitalization;
- Solana network fees, wallet fees, price impact, and slippage may apply separately;
- fee schedules may change.

The application must read fee configuration from current sources or protected project settings. Fees must never be hardcoded permanently into the user interface.

---

## 5. Fair-Pricing Problem

If a house material costs a fixed 100,000 Project Tokens:

- an early user may acquire 100,000 tokens cheaply;
- a later user may pay significantly more for the same amount;
- the same game item has a radically different real cost.

If the game permanently fixes the conversion rate between Project Token and Game Coins:

- price growth can grant early users disproportionate purchasing power;
- price decline can make withdrawals undercollateralized;
- users may arbitrage the game against PumpSwap;
- a temporary manipulated price may create excessive Game Coins;
- the fixed rate quickly stops reflecting the market.

The external token may remain volatile, but the in-game price list must use a separate unit of account.

---

## 6. Currency Model

The economy must contain three separate assets.

### 6.1. Project Token

The real Pump.fun SPL token.

It:

- exists on Solana;
- remains in user wallets until a transaction is approved;
- has a changing market price;
- can be used to fund Game Coins;
- can be received during withdrawal;
- is verified using the configured mint address;
- must not have a fixed in-game price.

### 6.2. Game Coins

The internal transactional balance.

Game Coins are used for:

- construction materials;
- house upgrades;
- businesses;
- inventory;
- resident goods;
- user-to-user purchases;
- interior objects;
- marketplace fees.

Game Coins:

- are issued only after a confirmed Project Token funding transaction;
- are backed by the project’s defined reserve model;
- circulate between player accounts;
- can become withdrawable according to balance type and settlement status;
- are not created when one user buys from another user;
- are removed from circulation when redeemed or explicitly burned.

### 6.3. Reputation

Reputation is non-financial progression.

It is earned through:

- unique customers;
- successfully fulfilled resident needs;
- business availability;
- good service history;
- district development;
- social connections.

Reputation:

- cannot be bought directly;
- cannot be transferred;
- cannot be withdrawn;
- cannot be converted to Project Token;
- must be stored separately from monetary balances.

---

## 7. Game Coin Supply and Circulation

### 7.1. Creation

New Game Coins may enter circulation only through an approved issuance event.

An issuance event requires:

1. A verified game account.
2. A verified linked wallet.
3. The configured Project Token mint.
4. A valid quote.
5. A signed Solana transaction.
6. Confirmed on-chain settlement.
7. Reserve receipt or conversion confirmation.
8. An unprocessed transaction signature.
9. A successful ledger entry.

Promotional balances must use a separate non-withdrawable balance class and must not increase withdrawable Game Coin supply.

### 7.2. User-to-user transfer

When User A buys an item from User B:

- User A’s existing Game Coins decrease;
- User B’s pending Game Coins increase;
- the marketplace fee account receives the configured fee;
- no additional Game Coins are issued;
- the total monetary liability remains conserved, except for an explicitly recorded burn or system fee.

### 7.3. Reuse

After settlement, User B may:

- buy another item;
- fund the household budget;
- restock the business;
- buy a business upgrade;
- transfer value through another legitimate purchase;
- request withdrawal.

The same Game Coins may circulate through many users.

### 7.4. Removal

Game Coins leave circulation when:

- they are redeemed during withdrawal;
- they are explicitly burned by an approved system sink;
- a reversed issuance is corrected;
- an administrative accounting correction is performed through an auditable journal entry.

No balance may be silently deleted.

---

## 8. Reserve Model

### 8.1. Recommended stable-value model

To keep in-game prices reasonably fair, Game Coins should use a stable reference value.

Recommended flow:

1. The user pays with Project Token.
2. The Project Token is converted through the approved market route.
3. The reserve receives the configured backing asset.
4. Game Coins are issued based on actual net settlement.
5. The reserve remains segregated from operating funds.

This ensures that the user acquired Game Coins using the Project Token while allowing Game Coins to maintain stable purchasing power.

### 8.2. Why not hold only Project Token

If Game Coins have stable purchasing power but the reserve holds only volatile Project Token:

- a Project Token price decline can create a reserve deficit;
- withdrawals may become impossible;
- seller earnings may not be fully covered.

If the project requires a pure 1:1 Project Token reserve, Game Coins must be token-denominated and the early-versus-late price problem cannot be eliminated.

The recommended model is therefore:

- Project Token is the funding and withdrawal rail;
- Game Coin is the stable game unit;
- reserve backing is maintained in the configured reserve asset;
- conversions use current market execution.

### 8.3. Reserve invariant

At all times:

`Eligible reserve value >= total withdrawable Game Coin liability`

The following are liabilities:

- user available balances;
- seller pending balances expected to settle;
- locked marketplace balances;
- withdrawal balances in progress;
- refundable balances.

Non-withdrawable promotional points must not be counted as reserve-backed liability.

### 8.4. Reconciliation

The backend must run:

- real-time balance invariants;
- periodic reserve reconciliation;
- daily full-ledger reconciliation;
- alerting for any mismatch;
- automatic withdrawal pause when coverage is below policy.

---

## 9. Double-Entry Ledger

### 9.1. Core requirement

Balances must not be updated directly.

Every monetary change must be represented by balanced journal entries.

For every transaction:

`sum(debits) = sum(credits)`

### 9.2. Ledger accounts

Required account types:

- `user_available`;
- `user_pending`;
- `user_locked`;
- `marketplace_escrow`;
- `business_inventory`;
- `platform_fee`;
- `system_store`;
- `system_sink`;
- `withdrawal_pending`;
- `deposit_pending`;
- `reserve_asset`;
- `promotional_nonwithdrawable`;
- `reconciliation_adjustment`.

### 9.3. Ledger entry fields

Every entry stores:

- journal ID;
- operation ID;
- debit account;
- credit account;
- amount in smallest Game Coin unit;
- asset type;
- balance class;
- reason code;
- buyer account ID;
- seller account ID;
- business ID;
- order ID;
- source wallet;
- destination wallet;
- on-chain transaction signature;
- idempotency key;
- timestamp;
- created-by service;
- previous journal reference for reversals.

### 9.4. Immutable journal

Posted journal entries must be immutable.

Corrections use:

- a reversing entry;
- a replacement entry;
- a reason code;
- an audit record.

Administrators must not edit historical monetary rows.

### 9.5. Cached balances

The system may keep cached balance totals for performance, but:

- the journal is the source of truth;
- cached balances are rebuilt from the journal;
- a mismatch triggers an alert;
- withdrawals use reconciled balances.

---

## 10. User-to-User Purchase Flow

### 10.1. Example

User A buys bread from User B for 100 Game Coins.

Configured marketplace fee: 5 Game Coins.

Settlement:

- 100 Game Coins leave User A’s available balance;
- 100 Game Coins enter marketplace escrow;
- the item is delivered;
- 95 Game Coins move to User B’s pending balance;
- 5 Game Coins move to the platform-fee account;
- after the settlement hold, 95 Game Coins move from User B pending to User B available.

No new Game Coins are created.

### 10.2. Required transaction stages

1. Create order.
2. Validate buyer.
3. Validate seller.
4. Block self-trading.
5. Validate business status.
6. Validate stock.
7. Validate price band.
8. Validate buyer balance.
9. Reserve buyer Game Coins.
10. Reserve item inventory.
11. Create escrow journal entry.
12. Deliver item or fulfill resident need.
13. Credit seller pending balance.
14. Credit marketplace fee account.
15. Start settlement hold.
16. Release seller funds.
17. Close order.

### 10.3. Atomicity

The following must happen atomically:

- buyer balance reservation;
- inventory reservation;
- order creation.

The following must also happen atomically:

- item delivery;
- seller pending credit;
- fee credit;
- escrow release.

If fulfillment fails:

- inventory returns to the seller;
- the buyer receives a full ledger refund;
- the seller is not credited;
- no fee is retained unless clearly disclosed and legally approved.

### 10.4. Idempotency

Every purchase request requires a unique idempotency key.

Repeated requests must return the original order result and must not:

- charge the buyer twice;
- deliver two items;
- credit the seller twice;
- charge two fees.

### 10.5. Seller ownership

Once settlement is complete, the net sale proceeds belong to the seller’s account.

The backend must expose:

- gross sales;
- fees;
- refunds;
- pending balance;
- available balance;
- withdrawn balance;
- inventory cost;
- net earnings.

---

## 11. Balance Classes

The interface and backend must distinguish:

### Available

May be spent or withdrawn.

### Pending

Received from sales but still inside the settlement hold.

### Locked

Reserved for an open order or withdrawal.

### Promotional

May be spent only on approved game content and cannot be withdrawn.

### Household Budget

Explicitly allocated by the user for resident purchases.

### Business Working Balance

Optional sub-balance used for inventory and business expenses.

The application must never combine these into one misleading number.

---

## 12. Funding Game Coins

### 12.1. Quote flow

1. User selects a Game Coin amount.
2. Backend requests a protected Project Token quote.
3. UI shows required Project Token.
4. UI shows fees, price impact, and slippage.
5. Quote receives an expiration time.
6. User selects one linked wallet.
7. User signs the transaction.
8. Backend waits for confirmation.
9. Backend verifies exact mint, amount, sender, recipient, and route.
10. Reserve settlement is confirmed.
11. Game Coins are issued through the ledger.

### 12.2. Calculation

Simplified model:

`Game Coins issued = net reserve value received / configured Game Coin unit value`

Issuance must use actual net settlement rather than a screenshot or client-provided price.

### 12.3. Manipulation protection

Use:

- TWAP or comparable protected pricing;
- minimum liquidity;
- maximum spot-to-average deviation;
- quote expiration;
- maximum order size;
- daily account limits;
- daily wallet limits;
- slippage limits;
- circuit breakers;
- stale-price rejection;
- final execution verification.

### 12.4. Before Pump.fun graduation

Recommended policy:

- test Game Coins only;
- no user-to-user real-value trading;
- no withdrawal;
- no real seller earnings;
- wallet verification and quote preview may be tested;
- live economy activates only after canonical PumpSwap liquidity is verified.

---

## 13. Withdrawal

### 13.1. Eligible balances

Withdrawable:

- unused reserve-backed Game Coins;
- settled business proceeds;
- released refunds;
- other explicitly backed available balances.

Not withdrawable:

- Reputation;
- test balance;
- promotional balance;
- pending sales;
- locked balance;
- disputed balance;
- resident stats;
- unbacked rewards.

### 13.2. Flow

1. User enters Game Coin amount.
2. Backend validates available withdrawable balance.
3. User selects a verified linked wallet.
4. Backend generates a Project Token quote.
5. UI shows expected token output.
6. UI shows fees and slippage.
7. User confirms.
8. Game Coins move to `withdrawal_pending`.
9. Reserve asset is converted to Project Token.
10. Project Token is sent to the verified destination.
11. On-chain confirmation is verified.
12. Game Coins are removed from circulation.

### 13.3. Safety

- withdrawal only to linked and verified wallets;
- one default withdrawal wallet;
- cooldown after changing default wallet;
- reauthentication for large withdrawals;
- minimum amount;
- daily limit;
- address classification;
- token-account and mint verification;
- idempotency;
- audit log;
- liquidity circuit breaker;
- safe retry without double payment.

---

## 14. Inline Funding in the House Builder

When the user cannot afford a selected material:

1. Keep the material visible.
2. Show its Game Coin price.
3. Show the exact shortfall.
4. Show “Add funds and continue.”
5. Save the house draft.
6. Open funding as an overlay.
7. Let the user select any linked supported wallet.
8. Display a live quote.
9. Complete the funding transaction.
10. Return to the same builder step.
11. Preserve all previous choices.
12. Revalidate the item price.
13. Keep the selected material active if still affordable.

The user must not return to the main menu.

Funding failure must not delete the draft.

---

## 15. Multi-Wallet Product Model

### 15.1. Account versus wallet

The game account is the identity.

Wallets are verified funding, login, and withdrawal methods linked to that account.

One account may link multiple wallets while retaining:

- one house;
- one resident household;
- one Game Coin balance;
- one business ownership profile;
- one Reputation profile.

### 15.2. Initial wallet limit

Recommended MVP limit:

- up to five linked wallets per game account;
- configurable by the backend.

The wallet selector may support more wallet providers than the number of wallets linked to an account.

### 15.3. Required wallet providers

The first supported list must include:

1. MetaMask;
2. Solflare;
3. Phantom;
4. Jupiter;
5. Backpack;
6. Coinbase Wallet;
7. OKX Wallet.

The architecture must allow additional Solana Wallet Standard providers without redesigning the modal.

### 15.4. Connection technology

For modern Solana wallets:

- use Solana Wallet Standard discovery;
- prefer the current Solana Kit wallet integration for new code;
- avoid hardcoding Phantom-specific APIs;
- support browser extensions;
- support mobile deep links where the provider supports them;
- support QR or approved universal-link flows where appropriate;
- isolate provider-specific adapters behind one wallet service.

MetaMask must use its documented Solana-capable integration rather than assuming an EVM-only account.

### 15.5. Active signer

Multiple wallets may be linked, but one wallet is the active signer for a transaction.

The user selects:

- payment wallet;
- login wallet;
- default withdrawal wallet.

The backend stores roles but never stores private keys.

---

## 16. Wallet Connection Modal

The modal should follow the provided visual reference.

### 16.1. Layout

- title: “Connect a wallet”;
- close button;
- search input;
- scrollable wallet list;
- provider icon;
- provider name;
- Installed badge when detected;
- arrow or action state for providers that require a deep link or installation;
- clear loading state;
- clear connection-error state.

### 16.2. Search

Search must filter by:

- wallet name;
- installed state;
- supported platform;
- provider tags.

Search must remain fast with additional Wallet Standard providers.

### 16.3. Installed state

If a supported browser wallet is detected:

- show a green status indicator;
- show “Installed”;
- prioritize it near the top;
- still preserve the configured provider order where needed.

### 16.4. Not installed

When a wallet is not installed:

- open only the provider’s verified official installation or deep-link route;
- never use an unverified search result;
- do not imitate the wallet;
- do not request seed phrases;
- allow returning to the wallet list.

### 16.5. Footer wording

Do not claim that the game “never accesses or holds funds” if the economy uses a custodial reserve or project-controlled escrow.

Safe wording:

> Your wallet keys always remain under your control. Deposits and purchases occur only after you approve a transaction.

A full “non-custodial” claim is allowed only if the deployed architecture and legal review confirm that the project cannot control user funds.

---

## 17. Linking Additional Wallets

### 17.1. Flow

1. User logs in with an already verified wallet.
2. User opens Account → Linked Wallets.
3. User selects “Add wallet.”
4. The connection modal opens.
5. User selects a provider.
6. New wallet signs a unique challenge.
7. Backend verifies address, signature, nonce, domain, and expiration.
8. Backend checks that the wallet is not linked to another game account.
9. Wallet is linked.
10. User assigns permitted roles.

### 17.2. Required challenge fields

- game domain;
- game account ID;
- wallet address;
- unique nonce;
- issued-at timestamp;
- expiration timestamp;
- network;
- purpose: link wallet.

### 17.3. Restrictions

- one wallet cannot be linked to multiple game accounts;
- linking does not grant another starter reward;
- linking does not create another house;
- linked wallets cannot trade with the same account;
- unlinking has a cooldown;
- withdrawal-wallet changes have a security delay;
- suspicious linking patterns are logged.

---

## 18. Protected Token Configuration Page

### 18.1. Purpose

After the Project Token is created, an administrator enters the mint address on a protected page.

Example route:

`/admin/token-config`

The page must not appear in public navigation.

A hidden URL alone is not security.

### 18.2. Access control

Require:

- administrator authentication;
- role-based authorization;
- multifactor authentication;
- server-side permission checks;
- audit logs;
- rate limits;
- testnet/mainnet separation;
- confirmation for critical changes;
- optional two-person approval for mainnet.

### 18.3. Fields

- network;
- Project Token mint address;
- expected symbol;
- expected decimals;
- Token Program or Token-2022;
- canonical PumpSwap pool;
- reserve asset;
- reserve accounts;
- fee accounts;
- minimum liquidity;
- quote source;
- funding enabled;
- withdrawal enabled;
- marketplace enabled;
- slippage limits;
- daily limits.

### 18.4. Verification

The backend verifies:

- valid Solana address;
- mint account exists;
- correct network;
- correct owning token program;
- decimals;
- supply;
- metadata;
- symbol;
- mint authority;
- freeze authority;
- token extensions;
- canonical pool;
- quote availability;
- pool liquidity;
- reserve accounts.

### 18.5. Activation

After activation:

- all wallet balance checks use only the configured mint;
- all deposits reject other mints;
- UI shows the shortened verified mint;
- normal administrators cannot silently replace the mint;
- replacement requires an audited migration process;
- previous configuration versions remain available.

---

## 19. Business Purchase

### 19.1. New rule

A business is not generated automatically.

After house construction:

- an adjacent business plot is reserved;
- the plot may remain empty;
- the user may buy a business later;
- the user sees a preview before purchase.

### 19.2. MVP limitation

One active business per house.

### 19.3. Business categories

#### Bakery

Products:

- bread;
- pastry;
- family meal;
- celebration cake.

Primary resident need: Hunger.

#### Café

Products:

- coffee;
- tea;
- snack;
- social table.

Primary needs: Energy and Household Bond.

#### Flower Shop

Products:

- simple bouquet;
- family bouquet;
- celebration flowers;
- home plant.

Primary need: Household Bond.

#### Bookstore or Learning Lab

Products:

- book;
- learning kit;
- archive access;
- educational session.

Primary need: Knowledge.

#### Technology Shop

Products:

- terminal upgrades;
- decorative devices;
- lamps;
- resident gadgets.

Primary needs: Energy or Knowledge.

### 19.4. Architectural adaptation

- wood house: warm café or flower shop;
- brick house: bakery or bookstore;
- light-stone house: library, gallery, or tea room;
- technology-panel house: technology shop, learning lab, or arcade.

Business function and business exterior are separate. The exterior automatically adapts to the main house material.

---

## 20. User Marketplace

### 20.1. Allowed goods

- resident consumables;
- approved decorations;
- interior objects;
- temporary game services;
- approved collectibles;
- business inventory.

### 20.2. Prohibited goods

- real-world goods;
- off-platform services;
- direct token trading;
- loans;
- financial promises;
- unapproved NFTs;
- paid random loot boxes;
- arbitrary user-uploaded images;
- prohibited or infringing content.

### 20.3. Seller controls

The seller may:

- choose from an approved catalog;
- purchase or produce stock;
- set price inside a permitted band;
- view cost;
- view fee;
- view estimated net proceeds;
- restock;
- close the business temporarily.

### 20.4. Anti-wash-trading controls

- no purchases from the same game account;
- all linked wallets count as the same account;
- price bands;
- daily limits;
- repeated-pair detection;
- circular-trade detection;
- turnover anomaly detection;
- settlement holds;
- no Reputation based only on volume;
- suspicious business suspension.

---

## 21. Four Starting Residents

After house completion, four residents spawn.

They:

- share one household;
- have individual visual identities;
- use the main house;
- visit businesses;
- have needs;
- do not represent real users;
- cannot permanently die;
- cannot silently spend real-value balances.

### 21.1. Hunger

Restored by:

- bread;
- pastries;
- meals;
- public kitchen.

### 21.2. Energy

Restored by:

- sleep;
- rest;
- coffee;
- tea;
- calm public locations.

### 21.3. Knowledge

Restored by:

- books;
- library visits;
- learning lab;
- educational home objects.

### 21.4. Household Bond

Restored by:

- flowers;
- shared meals;
- café visits;
- celebrations;
- walks;
- visits to connected houses.

---

## 22. Household Spending Permission

Residents must never spend withdrawable Game Coins without user authorization.

Create a Household Budget.

The user may:

- fund it manually;
- set a daily limit;
- permit selected product categories;
- enable or disable automatic purchases;
- require confirmation for each purchase;
- view spending history.

Default:

- automatic spending is off.

### 22.1. Free baseline services

The city must provide:

- public kitchen;
- public resting areas;
- basic library;
- public park.

These services:

- restore needs more slowly;
- do not produce player revenue;
- prevent residents from becoming permanently unusable;
- remove pay-to-survive pressure.

---

## 23. Resident Demand and Trade Loop

1. A resident need decreases.
2. Resident identifies the required product category.
3. System searches available businesses.
4. System considers stock, price, distance, queue, quality, and social connection.
5. Spending permission is checked.
6. Buyer Game Coins are reserved.
7. Resident walks to the business.
8. Service animation runs.
9. Item is consumed.
10. Resident need increases.
11. Seller receives pending Game Coins.
12. Connection between households strengthens.

Business revenue must come from the buyer’s existing balance, not from a system reward minted at the time of purchase.

---

## 24. Business Progression

Business data:

- level;
- Reputation;
- stock;
- capacity;
- service speed;
- product slots;
- visual-upgrade slots;
- visitor count;
- unique-household count;
- gross sales;
- fees;
- refunds;
- pending earnings;
- available earnings;
- withdrawn earnings.

Progress is earned through:

- fulfilled resident needs;
- unique customers;
- inventory availability;
- reliable service;
- district contribution;
- low cancellation rate.

Raw volume alone must not increase business level.

---

## 25. Connection Graph Updates

New connection types:

- Trade connection;
- Household connection;
- Service connection;
- Architectural connection;
- District connection.

Examples:

- “Residents buy bread here.”
- “The households regularly meet at this café.”
- “This bookstore improves Knowledge.”
- “Both houses use brick architecture.”

Trading volume must not be the only strength factor.

---

## 26. Fog Adjustment

The current fog is too dense and must be reduced.

Requirements:

- nearby districts remain clear;
- house materials remain readable;
- selected house is never obscured;
- roads remain visible between neighboring blocks;
- fog begins mainly in the distant part of the scene;
- city edge is softened without hiding the city;
- interior fog is disabled;
- graph mode keeps connected houses visible.

Recommended starting point:

- fog begins after approximately 60–70% of useful camera distance;
- full fade occurs near 95–100% of the far boundary;
- exact values remain configurable.

---

## 27. WASD Camera Movement

### Controls

- W: move forward;
- S: move backward;
- A: move left;
- D: move right;
- Shift: temporary speed increase;
- mouse: rotate and select;
- wheel: zoom;
- Space or dedicated button: return to selected house;
- Escape: exit camera mode or close current panel;
- optional Q/E: rotate.

### Behavior

- smooth acceleration;
- smooth deceleration;
- no sudden jumps;
- planar city movement;
- city-boundary limits;
- ground collision;
- building collision where appropriate;
- manual input cancels automatic camera movement.

WASD must be disabled while a text field, search field, amount input, or form is focused.

---

## 28. Texture and 2.5D Visual Upgrade

The game remains 3D low poly but uses a richer 2.5D-inspired visual treatment:

- hand-painted albedo;
- soft color gradients;
- controlled baked shading;
- subtle ambient occlusion;
- highlighted upper edges;
- large readable details;
- limited noise;
- consistent art direction.

### 28.1. Grass

New grass requires:

- soft macro color variation;
- 3–4 tile variants;
- random blend mask;
- darker contact near roads and buildings;
- sparse detail patches;
- low-poly grass clusters only near the camera;
- separate flowers and stones;
- no obvious repeating grid;
- no distant shimmering.

### 28.2. Roads

- large stylized shapes;
- soft edges;
- subtle wear;
- readable hierarchy;
- no photorealistic crack noise.

### 28.3. House materials

Wood:

- large grain;
- 2–3 tones;
- consistent grain scale.

Brick:

- large stylized blocks;
- soft mortar;
- aligned modular seams.

Light stone:

- broad color gradients;
- large forms;
- no scanned-detail noise.

Technology panels:

- matte base;
- large panel shapes;
- limited emissive lines;
- parameter-driven glow color.

---

## 29. Texture Performance

The current version contains texture-related lag.

Before adding visual quality, audit:

- resolution;
- format;
- file size;
- GPU memory;
- alpha usage;
- mipmaps;
- compression;
- material count;
- reuse count;
- decode duration;
- GPU upload duration;
- frame hitch;
- mobile fallback.

Recommended limits:

- tiny props: 128–256 px;
- normal props: 256–512 px;
- hero props: up to 1024 px;
- house/environment atlases: 1024–2048 px;
- 4K only after explicit approval.

Use:

- KTX2/Basis for suitable 3D textures;
- WebP/AVIF for suitable interface images;
- mipmaps;
- shared atlases;
- material parameters for color variants;
- progressive loading;
- LOD;
- mobile texture variants.

Do not load arbitrary token-metadata images directly into the 3D scene.

Interiors load only after an explicit request to enter a house.

---

## 30. Core Backend Data

### Game account

- account ID;
- house ID;
- linked wallet IDs;
- primary login wallet;
- primary withdrawal wallet;
- monetary balances by class;
- Reputation;
- household budget;
- business ID;
- restrictions.

### Linked wallet

- public address;
- provider;
- network;
- verified timestamp;
- roles;
- signature challenge reference;
- link status;
- unlink cooldown;
- token-balance cache.

### Ledger account

- ledger account ID;
- owner account ID;
- account type;
- balance class;
- currency;
- cached balance;
- status.

### Journal entry

- journal ID;
- operation ID;
- debit;
- credit;
- amount;
- reason;
- related order;
- related wallet transaction;
- idempotency key;
- timestamp.

### Business

- owner;
- house;
- type;
- level;
- stock;
- prices;
- Reputation;
- pending earnings;
- available earnings;
- status.

### Marketplace order

- buyer;
- seller;
- resident;
- business;
- product;
- quantity;
- price;
- fee;
- escrow amount;
- status;
- settlement deadline;
- fraud flags.

### Resident

- resident ID;
- house ID;
- Hunger;
- Energy;
- Knowledge;
- Household Bond;
- activity;
- target business;
- route;
- purchase permission.

---

## 31. Failure and Edge Cases

Handle:

- invalid mint;
- wrong network;
- token not graduated;
- canonical pool missing;
- insufficient liquidity;
- expired quote;
- large price deviation;
- wallet disconnected during signing;
- one wallet linked to two accounts;
- unlinked wallet during an open order;
- self-purchase through another linked wallet;
- duplicate purchase request;
- duplicate deposit signature;
- duplicate withdrawal request;
- last inventory item purchased simultaneously;
- delivery succeeds but seller credit fails;
- seller credit succeeds but UI closes;
- withdrawal swap succeeds but transfer is delayed;
- reserve mismatch;
- resident need changes during purchase;
- household budget exhausted;
- business closes during resident route;
- route becomes unavailable;
- texture fails;
- WASD captures text input;
- fog hides selected house.

Every financial failure must resolve to one of:

- safely completed;
- safely refunded;
- safely pending;
- paused for review.

An ambiguous hidden state is not acceptable.

---

## 32. Security Requirements

- no private keys or seed phrases;
- server-side authorization;
- MFA for administrators;
- immutable ledger;
- idempotency;
- rate limits;
- withdrawal limits;
- verified destinations;
- wallet-link signature challenges;
- replay protection;
- reserve segregation;
- reconciliation;
- audit logging;
- secret rotation;
- testnet/mainnet separation;
- emergency pause;
- two-person approval for critical reserve actions.

---

## 33. Legal and Operational Gate

Withdrawals, reserve-backed balances, seller proceeds, and user-to-user trading create a real-value economy.

Before production activation, obtain jurisdiction-specific review covering:

- KYC/AML;
- sanctions;
- age restrictions;
- tax reporting;
- custody;
- money-transmission or exchange rules;
- marketplace terms;
- consumer protection;
- refund policy;
- risk disclosures;
- regional restrictions.

Funding, marketplace, and withdrawal features must use independent feature flags.

---

## 34. Delivery Phases

### Phase 1: Account and wallet foundation

- multi-provider wallet modal;
- seven required providers;
- multiple linked wallets;
- wallet roles;
- protected token configuration;
- mint verification.

### Phase 2: Ledger and reserve

- double-entry journal;
- balance classes;
- issuance;
- reconciliation;
- test deposits;
- inline builder funding.

### Phase 3: Residents and businesses

- four residents;
- four needs;
- household budget;
- business purchase;
- inventory;
- test marketplace.

### Phase 4: Visual improvements

- fog reduction;
- WASD;
- texture audit;
- grass upgrade;
- 2.5D materials;
- performance validation.

### Phase 5: Live economy

Requires:

- Pump.fun graduation;
- verified canonical PumpSwap pool;
- minimum liquidity;
- reserve coverage;
- security review;
- legal approval.

Then enable:

- live Game Coin issuance;
- seller settlement;
- withdrawals;
- real user marketplace.

---

## 35. Acceptance Criteria

### Money and backend

1. Game Coins are issued only after confirmed Project Token funding.
2. Every monetary operation creates balanced ledger entries.
3. User-to-user purchases do not mint Game Coins.
4. Buyer balance decreases exactly once.
5. Seller pending balance increases exactly once.
6. Marketplace fee is recorded separately.
7. Seller funds become available after settlement.
8. Failed fulfillment refunds the buyer.
9. Duplicate requests cannot duplicate payment or delivery.
10. Journal entries are immutable.
11. Cached balances reconcile with the journal.
12. Reserve coverage is monitored.

### Wallets

13. MetaMask is supported for its Solana-capable flow.
14. Solflare is supported.
15. Phantom is supported.
16. Jupiter is supported.
17. Backpack is supported.
18. Coinbase Wallet is supported.
19. OKX Wallet is supported.
20. Installed wallets are detected.
21. Wallet search works.
22. Multiple wallets can be linked to one account.
23. Linking another wallet does not create another house.
24. One wallet cannot belong to two accounts.
25. Wallet keys remain controlled by the user.

### Marketplace

26. A business is purchased rather than auto-created.
27. The seller owns net settled proceeds.
28. Seller proceeds may be spent again.
29. Seller proceeds may be withdrawn when eligible.
30. Self-trading across linked wallets is blocked.
31. Inventory and buyer balance are reserved atomically.
32. Price bands are enforced.

### Residents

33. Four residents spawn with the house.
34. Hunger, Energy, Knowledge, and Household Bond work.
35. Resident purchases use existing household Game Coins.
36. Automatic spending is off by default.
37. Free baseline services exist.
38. Residents cannot die permanently.

### Builder and visuals

39. Users can fund without leaving the builder.
40. Builder state survives funding failure.
41. Fog does not hide nearby districts.
42. WASD movement is smooth.
43. WASD does not trigger inside text inputs.
44. Grass uses the approved 2.5D style.
45. Texture improvements do not reintroduce frame hitches.
46. Interiors load on demand.

---

## 36. Sources

- [Pump.fun bonding curve](https://pump.fun/docs/bonding-curve)
- [Pump.fun current fees](https://pump.fun/docs/fees)
- [Pump.fun terms and market-risk notice](https://pump.fun/docs/terms-and-conditions)
- [Solana wallet directory](https://solana.com/wallets)
- [Solana frontend and Wallet Standard guidance](https://solana.com/docs/frontend)
- [Solana wallet interaction guide](https://solana.com/de/developers/courses/intro-to-solana/interact-with-wallets/)
- [Solana SPL Token basics](https://solana.com/docs/tokens/basics)
- [Solana address verification](https://solana.com/docs/payments/send-payments/verify-address)
- [MetaMask developer documentation](https://docs.metamask.io/)
- [Coinbase Wallet Standard integration](https://docs.cdp.coinbase.com/wallets/ecosystem-compatibility/wallet-standard)

