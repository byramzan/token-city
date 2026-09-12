// Double-entry ledger (task4 §7–§11).
// Balances are never edited directly: every monetary change is a balanced
// journal entry (sum of debits == sum of credits per operation). The journal
// is append-only; corrections are reversing entries. Cached balances are
// rebuilt from the journal and reconciled.
//
// Account id format: `${owner}|${class}` where owner is a game-account id or
// 'sys'. Classes: available | pending | locked | household | promo.
// System accounts: sys|issuance (coin source, negative = coins in circulation),
// sys|escrow, sys|fees, sys|store, sys|sink, sys|withdrawal, sys|reserve.

import { state, save } from './state.js';

export const acct = (owner, cls = 'available') => `${owner}|${cls}`;

function led() { return state.ledger; }

/**
 * Post one balanced operation of 1+ entries.
 * entries: [{ debit, credit, amount, reason, meta }]
 * Idempotency: if `key` was already processed the original opId is returned
 * and nothing is double-posted (task4 §10.4).
 */
export function post(entries, { key = null, opId = null } = {}) {
  const L = led();
  if (key && L.keys[key]) return { opId: L.keys[key], duplicate: true };
  for (const e of entries) {
    if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Error('ledger: bad amount');
    if (!e.debit || !e.credit || e.debit === e.credit) throw new Error('ledger: bad accounts');
  }
  const op = opId || 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  for (const e of entries) {
    L.seq++;
    const meta = e.meta ? Object.freeze({ ...e.meta }) : null;
    const journalEntry = Object.freeze({
      jid: 'j' + L.seq,
      opId: op,
      debit: e.debit,
      credit: e.credit,
      amount: e.amount,
      asset: 'COIN',
      balanceClass: e.balanceClass || e.credit.split('|')[1] || null,
      reason: e.reason || '',
      buyerId: meta?.buyerId || null,
      sellerId: meta?.sellerId || null,
      businessId: meta?.businessId || null,
      orderId: meta?.orderId || null,
      sourceWallet: meta?.sourceWallet || null,
      destinationWallet: meta?.destinationWallet || null,
      signature: meta?.signature || null,
      meta,
      key: key || null,
      ts: Date.now(),
      svc: 'client-demo',
      previousJournalReference: e.previousJournalReference || null,
    });
    L.journal.push(journalEntry);
    L.balances[e.debit] = (L.balances[e.debit] || 0) - e.amount;
    L.balances[e.credit] = (L.balances[e.credit] || 0) + e.amount;
  }
  if (key) L.keys[key] = op;
  save();
  return { opId: op, duplicate: false };
}

/**
 * Historical rows are never edited. A correction posts exact opposite entries
 * and references the original journal rows.
 */
export function reverseOperation(operationId, reason, key) {
  const originals = led().journal.filter((entry) => entry.opId === operationId);
  if (!originals.length) return { error: 'operation-not-found' };
  const entries = originals.map((entry) => ({
    debit: entry.credit,
    credit: entry.debit,
    amount: entry.amount,
    reason: `reversal:${reason}`,
    meta: { reversedOperationId: operationId },
    previousJournalReference: entry.jid,
  }));
  return post(entries, { key, opId: `${operationId}_reversal` });
}

export function balance(account) { return led().balances[account] || 0; }

/** All balance classes of one owner, for honest UI (task4 §11). */
export function balancesOf(owner) {
  return {
    available: balance(acct(owner, 'available')),
    pending: balance(acct(owner, 'pending')),
    locked: balance(acct(owner, 'locked')),
    household: balance(acct(owner, 'household')),
    promo: balance(acct(owner, 'promo')),
  };
}

/** Rebuild cached balances from the journal; returns mismatches (task4 §9.5). */
export function reconcile() {
  const L = led();
  const rebuilt = {};
  for (const j of L.journal) {
    rebuilt[j.debit] = (rebuilt[j.debit] || 0) - j.amount;
    rebuilt[j.credit] = (rebuilt[j.credit] || 0) + j.amount;
  }
  const mismatches = [];
  const keys = new Set([...Object.keys(rebuilt), ...Object.keys(L.balances)]);
  for (const k of keys) {
    if ((rebuilt[k] || 0) !== (L.balances[k] || 0)) {
      mismatches.push({ account: k, cached: L.balances[k] || 0, journal: rebuilt[k] || 0 });
    }
  }
  if (mismatches.length) {
    console.warn('ledger reconciliation mismatch', mismatches);
    L.balances = rebuilt; // journal is the source of truth
    save();
  }
  return mismatches;
}

/** Reserve invariant (task4 §8.3): eligible reserve >= withdrawable liability. */
export function reserveReport() {
  const L = led();
  let liability = 0;
  for (const [k, v] of Object.entries(L.balances)) {
    const [owner, cls] = k.split('|');
    if (owner === 'sys') continue;
    // Household and business working balances are still reserve-backed user
    // value even when temporarily earmarked for a narrower purpose.
    if (['available', 'pending', 'locked', 'household', 'business'].includes(cls)) liability += v;
  }
  const reserve = balance(acct('sys', 'reserve'));
  return { reserve, liability, covered: reserve >= liability };
}

// ── issuance & removal ───────────────────────────────────────────────────────
/** Issue coins only after a confirmed funding transaction (task4 §7.1). */
export function issueCoins(owner, coins, { signature, reason = 'deposit', reserveValue = null, promo = false } = {}) {
  const cls = promo ? 'promo' : 'available';
  const entries = [
    {
      debit: acct('sys', 'issuance'),
      credit: acct(owner, cls),
      amount: coins,
      reason,
      meta: { signature, owner },
    },
  ];
  if (!promo) {
    entries.push({
      debit: acct('sys', 'reserve-source'),
      credit: acct('sys', 'reserve'),
      amount: reserveValue ?? coins,
      reason: 'reserve-in',
      meta: { signature, owner },
    });
  }
  return post(entries, { key: signature ? 'sig_' + signature : null });
}

/** System-store purchase (build costs, catalog items): coins leave circulation
 *  into sys|store — no second copy is minted anywhere. */
export function storeSpend(owner, cost, reason, key = null) {
  if (balance(acct(owner, 'available')) < cost) return null;
  return post([{ debit: acct(owner, 'available'), credit: acct('sys', 'store'), amount: cost, reason }], { key });
}

// ── household budget (task4 §22) ─────────────────────────────────────────────
export function fundHousehold(owner, amount) {
  if (balance(acct(owner, 'available')) < amount) return null;
  return post([{ debit: acct(owner, 'available'), credit: acct(owner, 'household'), amount, reason: 'household-fund' }]);
}

export function returnHousehold(owner, amount) {
  if (balance(acct(owner, 'household')) < amount) return null;
  return post([{ debit: acct(owner, 'household'), credit: acct(owner, 'available'), amount, reason: 'household-return' }]);
}

// ── marketplace escrow flow (task4 §10) ──────────────────────────────────────
/**
 * Stage 1: reserve buyer coins into escrow atomically with order creation.
 * buyerClass 'available' | 'household'. Self-trading is blocked (§20.4).
 */
export function createOrder({ buyer, seller, gross, fee, buyerClass = 'available', businessId, product, key }) {
  if (buyer === seller) return { error: 'self-trade' };
  if (key && led().keys[key]) {
    const existing = state.orders.find((o) => o.key === key);
    return existing ? { order: existing, duplicate: true } : { error: 'duplicate' };
  }
  if (balance(acct(buyer, buyerClass)) < gross) return { error: 'insufficient' };
  const business = state.businesses[businessId];
  if (business) {
    if (business.status !== 'open') return { error: 'business-closed' };
    if ((business.stock?.[product] || 0) <= 0) return { error: 'out-of-stock' };
    if (business.prices?.[product] !== undefined && business.prices[product] !== gross) {
      return { error: 'price-changed' };
    }
  }
  const order = {
    id: 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    buyer, seller, gross, fee, buyerClass, businessId, product,
    status: 'escrow',
    createdAt: Date.now(),
    settleAt: null,
    key: key || null,
    inventoryReserved: !!business,
  };
  const res = post(
    [{
      debit: acct(buyer, buyerClass),
      credit: acct('sys', 'escrow'),
      amount: gross,
      reason: 'order-escrow',
      meta: { orderId: order.id, product, buyerId: buyer, sellerId: seller, businessId },
    }],
    { key },
  );
  if (res.duplicate) return { error: 'duplicate' };
  // Buyer escrow, order creation and inventory reservation are one synchronous
  // commit boundary in this standalone backend model.
  if (business) business.stock[product]--;
  order.opId = res.opId;
  state.orders.push(order);
  save();
  return { order };
}

/** Stage 2: delivery succeeded — atomically credit seller pending + fee. */
export function deliverOrder(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'escrow') return false;
  const net = o.gross - o.fee;
  const entries = [
    {
      debit: acct('sys', 'escrow'),
      credit: acct(o.seller, 'pending'),
      amount: net,
      reason: 'order-deliver',
      meta: { orderId, buyerId: o.buyer, sellerId: o.seller, businessId: o.businessId },
    },
  ];
  if (o.fee > 0) entries.push({
    debit: acct('sys', 'escrow'),
    credit: acct('sys', 'fees'),
    amount: o.fee,
    reason: 'marketplace-fee',
    meta: { orderId, buyerId: o.buyer, sellerId: o.seller, businessId: o.businessId },
  });
  post(entries, { opId: o.opId + '_d' });
  o.inventoryReserved = false; // delivered inventory is now consumed
  o.status = 'settling';
  o.settleAt = Date.now() + (state.tokenConfig?.settleHoldMs ?? 45000);
  save();
  return true;
}

/** Attach the authoritative realtime receipt to the buyer's local order. */
export function attachSharedTrade(orderId, trade) {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order || !trade?.id) return false;
  order.sharedTradeId = String(trade.id);
  order.sharedPurchaseKey = String(trade.purchaseKey || order.key || '');
  save();
  return true;
}

/** Import a sale received over Convex into the seller's ledger. The receipt ID
 * makes reconnects and multiple WebSocket deliveries harmless. */
export function importSharedSale(trade) {
  if (!trade?.id || !trade?.sellerId || !trade?.buyerId) return false;
  if (state.orders.some((order) => order.sharedTradeId === String(trade.id))) return false;
  const gross = Math.trunc(Number(trade.gross));
  const fee = Math.trunc(Number(trade.fee));
  const net = Math.trunc(Number(trade.net));
  if (gross <= 0 || fee < 0 || net <= 0 || gross - fee !== net) return false;
  const order = {
    id: `shared_${String(trade.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(-80)}`,
    buyer: String(trade.buyerId),
    seller: String(trade.sellerId),
    gross,
    fee,
    buyerClass: 'available',
    businessId: String(trade.houseId || ''),
    product: String(trade.productId || ''),
    status: 'settling',
    createdAt: Number(trade.createdAt) || Date.now(),
    settleAt: (Number(trade.createdAt) || Date.now()) + (state.tokenConfig?.settleHoldMs ?? 45000),
    key: String(trade.purchaseKey || ''),
    inventoryReserved: false,
    sharedTradeId: String(trade.id),
    sharedPurchaseKey: String(trade.purchaseKey || ''),
  };
  const operation = post([
    {
      debit: acct('sys', 'market-clearing'),
      credit: acct(order.seller, 'pending'),
      amount: net,
      reason: 'shared-order-deliver',
      meta: {
        orderId: order.id,
        buyerId: order.buyer,
        sellerId: order.seller,
        businessId: order.businessId,
        sharedTradeId: order.sharedTradeId,
      },
    },
    {
      debit: acct('sys', 'reserve-source'),
      credit: acct('sys', 'reserve'),
      amount: net,
      reason: 'shared-reserve-in',
      meta: { orderId: order.id, sharedTradeId: order.sharedTradeId },
    },
  ], {
    key: `shared_sale_${order.sharedTradeId}`,
    opId: `${order.id}_d`,
  });
  if (operation.duplicate) return false;
  order.opId = operation.opId;
  state.orders.push(order);
  save();
  return true;
}

/** Fulfillment failed — full ledger refund, no fee retained (§10.3). */
export function failOrder(orderId, reason = 'fulfillment-failed') {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'escrow') return false;
  post([{ debit: acct('sys', 'escrow'), credit: acct(o.buyer, o.buyerClass), amount: o.gross, reason: 'order-refund:' + reason, meta: { orderId } }]);
  if (o.inventoryReserved) {
    const business = state.businesses[o.businessId];
    if (business) business.stock[o.product] = (business.stock[o.product] || 0) + 1;
    o.inventoryReserved = false;
  }
  o.status = 'refunded';
  save();
  return true;
}

/** Settlement hold elapsed → seller pending becomes available (§10.1). */
export function settleDueOrders(now = Date.now()) {
  let settled = 0;
  for (const o of state.orders) {
    if (o.status === 'settling' && o.settleAt <= now) {
      const net = o.gross - o.fee;
      post([{ debit: acct(o.seller, 'pending'), credit: acct(o.seller, 'available'), amount: net, reason: 'order-settle', meta: { orderId: o.id } }]);
      o.status = 'settled';
      settled++;
    }
  }
  if (settled) save();
  return settled;
}

// ── withdrawal (task4 §13) ───────────────────────────────────────────────────
export function startWithdrawal(owner, coins, key) {
  if (balance(acct(owner, 'available')) < coins) return null;
  return post([{ debit: acct(owner, 'available'), credit: acct('sys', 'withdrawal'), amount: coins, reason: 'withdraw-lock' }], { key });
}

/** On-chain payout confirmed: coins leave circulation, reserve shrinks. */
export function finishWithdrawal(owner, coins, { signature } = {}) {
  return post([
    { debit: acct('sys', 'withdrawal'), credit: acct('sys', 'issuance'), amount: coins, reason: 'withdraw-burn', meta: { signature, owner } },
    { debit: acct('sys', 'reserve'), credit: acct('sys', 'reserve-source'), amount: coins, reason: 'reserve-out', meta: { signature, owner } },
  ], { key: signature ? 'wd_' + signature : null });
}

export function cancelWithdrawal(owner, coins) {
  return post([{ debit: acct('sys', 'withdrawal'), credit: acct(owner, 'available'), amount: coins, reason: 'withdraw-cancel' }]);
}

// ── seller stats helper (task4 §10.5) ────────────────────────────────────────
export function sellerStats(owner) {
  let gross = 0, fees = 0, refunds = 0, withdrawn = 0;
  for (const o of state.orders) {
    if (o.seller !== owner) continue;
    if (o.status === 'settling' || o.status === 'settled') { gross += o.gross; fees += o.fee; }
    if (o.status === 'refunded') refunds += o.gross;
  }
  for (const entry of state.ledger.journal) {
    if (entry.reason === 'withdraw-burn' && entry.meta?.owner === owner) withdrawn += entry.amount;
  }
  const b = balancesOf(owner);
  return {
    gross,
    fees,
    refunds,
    pending: b.pending,
    available: b.available,
    withdrawn,
    net: gross - fees,
  };
}
