import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TOKEN_CONFIG,
  createAccount,
  linkWallet,
  state,
  savePlacementsRevision,
  tokenMeta,
} from '../src/state.js';
import { TOKEN } from '../src/config.js';
import { executeFunding, executeWithdraw, quoteFunding, quoteWithdraw } from '../src/market.js';
import {
  acct,
  balance,
  createOrder,
  deliverOrder,
  failOrder,
  fundHousehold,
  issueCoins,
  importSharedSale,
  reconcile,
  reserveReport,
  settleDueOrders,
} from '../src/ledger.js';

function reset() {
  state.ledger = { journal: [], balances: {}, keys: {}, seq: 0 };
  state.orders = [];
  state.businesses = {};
  state.placements = {};
  state.placementSaveKeys = {};
  state.tokenConfig = { settleHoldMs: 1 };
}

test('demo wallet can fund every visible quick-start amount', async () => {
  reset();
  state.account = null;
  state.linkedWallets = [];
  state.walletMeta = {};
  state.walletRegistry = {};
  state.walletCooldowns = {};
  state.dailyUsage = {};
  state.tokenConfig = DEFAULT_TOKEN_CONFIG();
  createAccount();
  const wallet = linkWallet('DemoWalletAddress111111111111111111111111111', 'demo');

  assert.equal(tokenMeta(wallet.address).tokenBalance, TOKEN.startDemoBalance);
  const quote = quoteFunding(2500);
  const result = await executeFunding(quote, wallet);

  assert.equal(result.error, undefined);
  assert.equal(result.coins, 2500);
  assert.ok(tokenMeta(wallet.address).tokenBalance >= 0);
  assert.equal(balance(acct(state.account.id, 'available')), 2500);
});

test('linked Robinhood Chain wallet funds coins and receives withdrawal through confirmed callbacks', async () => {
  reset();
  state.account = null;
  state.linkedWallets = [];
  state.walletMeta = {};
  state.walletRegistry = {};
  state.walletCooldowns = {};
  state.dailyUsage = {};
  state.tokenConfig = DEFAULT_TOKEN_CONFIG();
  // Deposits require an ACTIVE server-side token configuration (task8 §7.4).
  state.tokenConfig.chain = {
    network: { chainId: 46630, networkName: 'Robinhood Chain Testnet' },
    token: { status: 'ACTIVE', tokenSymbol: 'TCITY', tokenDecimals: 18 },
  };
  createAccount();
  const wallet = linkWallet('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'metamask', {
    chainInfo: { chainFamily: 'evm', chainId: 46630, chainWalletId: 'cw_test' },
  });
  assert.equal(wallet.chainFamily, 'evm');
  assert.equal(wallet.chainId, 46630);

  const fundQuote = quoteFunding(500);
  const funded = await executeFunding(fundQuote, wallet, {
    deposit: async ({ quote, wallet: selected }) => ({
      signature: 'devnet_deposit_signature',
      walletAddress: selected.address,
      tokenAmount: quote.tokens,
    }),
  });
  assert.equal(funded.error, undefined);
  assert.equal(funded.coins, 500);
  assert.equal(balance(acct(state.account.id, 'available')), 500);

  const withdrawQuote = quoteWithdraw(100);
  const withdrawn = await executeWithdraw(withdrawQuote, {
    payout: async ({ quote, wallet: selected }) => ({
      signature: 'devnet_withdraw_signature',
      walletAddress: selected.address,
      tokenAmount: quote.tokens,
    }),
  });
  assert.equal(withdrawn.error, undefined);
  assert.equal(withdrawn.wallet.address, wallet.address);
  assert.equal(balance(acct(state.account.id, 'available')), 400);
});

test('player marketplace transfers existing coins without issuing a second payment', () => {
  reset();
  issueCoins('buyer', 1000, { signature: 'deposit_1', reserveValue: 1000 });
  const issuanceBefore = balance(acct('sys', 'issuance'));
  const reserveBefore = balance(acct('sys', 'reserve'));

  const created = createOrder({
    buyer: 'buyer',
    seller: 'seller',
    gross: 100,
    fee: 5,
    businessId: 'business_1',
    product: 'bread',
    key: 'purchase_1',
  });
  assert.ok(created.order);
  assert.equal(deliverOrder(created.order.id), true);
  assert.equal(balance(acct('buyer', 'available')), 900);
  assert.equal(balance(acct('seller', 'pending')), 95);
  assert.equal(balance(acct('sys', 'fees')), 5);
  assert.equal(balance(acct('sys', 'issuance')), issuanceBefore);
  assert.equal(balance(acct('sys', 'reserve')), reserveBefore);

  created.order.settleAt = 0;
  assert.equal(settleDueOrders(1), 1);
  assert.equal(balance(acct('seller', 'pending')), 0);
  assert.equal(balance(acct('seller', 'available')), 95);
  assert.deepEqual(reconcile(), []);
});

test('a realtime sale credits the seller once across reconnects', () => {
  reset();
  const trade = {
    id: 'trade_shared_1', purchaseKey: 'shared_purchase_1',
    buyerId: 'buyer', sellerId: 'seller', houseId: 'shop_1', productId: 'bread',
    gross: 100, fee: 5, net: 95, createdAt: 10,
  };
  assert.equal(importSharedSale(trade), true);
  assert.equal(importSharedSale(trade), false);
  assert.equal(balance(acct('seller', 'pending')), 95);
  assert.equal(state.orders.length, 1);
  state.orders[0].settleAt = 0;
  assert.equal(settleDueOrders(1), 1);
  assert.equal(balance(acct('seller', 'available')), 95);
  assert.equal(reserveReport().covered, true);
});

test('seller can redeem settled coins received from another player without new issuance', async () => {
  reset();
  state.dailyUsage = {};
  state.walletMeta = {};
  state.tokenConfig = DEFAULT_TOKEN_CONFIG();
  issueCoins('buyer', 1000, { signature: 'buyer_pool_deposit', reserveValue: 1000 });
  const issuanceAfterDeposit = balance(acct('sys', 'issuance'));
  const order = createOrder({
    buyer: 'buyer',
    seller: 'seller',
    gross: 200,
    fee: 10,
    businessId: 'seller_business',
    product: 'coffee',
    key: 'buyer_to_seller_trade',
  }).order;
  assert.ok(order);
  assert.equal(deliverOrder(order.id), true);
  order.settleAt = 0;
  settleDueOrders(1);
  assert.equal(balance(acct('seller', 'available')), 190);
  assert.equal(balance(acct('sys', 'issuance')), issuanceAfterDeposit);

  const sellerWallet = {
    id: 'seller_wallet',
    address: 'SellerWalletAddress11111111111111111111111111',
    provider: 'phantom',
  };
  state.account = {
    id: 'seller',
    converted: 0,
    paymentWallet: sellerWallet.id,
    loginWallet: sellerWallet.id,
    withdrawalWallet: sellerWallet.id,
    withdrawalChangedAt: 0,
  };
  state.linkedWallets = [sellerWallet];
  const quote = quoteWithdraw(100);
  const payout = await executeWithdraw(quote, {
    payout: async ({ wallet }) => ({ signature: 'pool_to_seller', destinationAddress: wallet.address }),
  });
  assert.equal(payout.error, undefined);
  assert.equal(payout.wallet.address, sellerWallet.address);
  assert.equal(balance(acct('seller', 'available')), 90);
  assert.equal(balance(acct('sys', 'issuance')), issuanceAfterDeposit + 100);
});

test('duplicate purchase key cannot charge or deliver twice', () => {
  reset();
  issueCoins('buyer', 500, { signature: 'deposit_2', reserveValue: 500 });
  const request = {
    buyer: 'buyer',
    seller: 'seller',
    gross: 80,
    fee: 4,
    businessId: 'business_2',
    product: 'tea',
    key: 'same_key',
  };
  const first = createOrder(request);
  const second = createOrder(request);
  assert.ok(first.order);
  assert.equal(second.duplicate, true);
  assert.equal(first.order.id, second.order.id);
  assert.equal(balance(acct('buyer', 'available')), 420);
  assert.equal(state.orders.length, 1);
});

test('the last inventory item is reserved once and restored on refund', () => {
  reset();
  issueCoins('buyer', 100, { signature: 'deposit_stock', reserveValue: 100 });
  state.businesses.business_stock = {
    status: 'open',
    stock: { bread: 1 },
    prices: { bread: 8 },
  };
  const first = createOrder({
    buyer: 'buyer',
    seller: 'seller',
    gross: 8,
    fee: 1,
    businessId: 'business_stock',
    product: 'bread',
    key: 'stock_1',
  });
  const second = createOrder({
    buyer: 'buyer',
    seller: 'seller',
    gross: 8,
    fee: 1,
    businessId: 'business_stock',
    product: 'bread',
    key: 'stock_2',
  });
  assert.ok(first.order);
  assert.equal(state.businesses.business_stock.stock.bread, 0);
  assert.equal(second.error, 'out-of-stock');
  assert.equal(failOrder(first.order.id, 'test-refund'), true);
  assert.equal(state.businesses.business_stock.stock.bread, 1);
  assert.equal(balance(acct('buyer', 'available')), 100);
});

test('household allocations remain included in the reserve liability', () => {
  reset();
  issueCoins('buyer', 300, { signature: 'deposit_3', reserveValue: 300 });
  fundHousehold('buyer', 120);
  const report = reserveReport();
  assert.equal(report.reserve, 300);
  assert.equal(report.liability, 300);
  assert.equal(report.covered, true);
});

test('house save is atomic, idempotent and revision checked', () => {
  reset();
  const first = savePlacementsRevision({
    houseId: 'house_1',
    baseRevision: 0,
    schemaVersion: 2,
    objects: [{ objectInstanceId: 'object_1' }],
    idempotencyKey: 'save_1',
  });
  assert.equal(first.ok, true);
  assert.equal(first.newRevision, 1);

  const duplicate = savePlacementsRevision({
    houseId: 'house_1',
    baseRevision: 0,
    schemaVersion: 2,
    objects: [{ objectInstanceId: 'different' }],
    idempotencyKey: 'save_1',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.canonicalHouseState.objects[0].objectInstanceId, 'object_1');

  const stale = savePlacementsRevision({
    houseId: 'house_1',
    baseRevision: 0,
    schemaVersion: 2,
    objects: [],
    idempotencyKey: 'save_2',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'revision-conflict');
  assert.equal(state.placements.house_1.revision, 1);
  assert.equal(state.placements.house_1.objects.length, 1);
});
