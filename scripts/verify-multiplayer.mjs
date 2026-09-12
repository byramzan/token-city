import assert from 'node:assert/strict';
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const convexUrl = process.env.VITE_CONVEX_URL;
if (!convexUrl) throw new Error('VITE_CONVEX_URL is required');

const clientA = new ConvexClient(convexUrl, { unsavedChangesWarning: false });
const clientB = new ConvexClient(convexUrl, { unsavedChangesWarning: false });
const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const houseId = `verify_${suffix}`;
const paymentOneId = `verify_payment_one_${suffix}`;
const paymentTwoId = `verify_payment_two_${suffix}`;
const existing = await clientA.query(api.world.list, {});
const taken = new Set(existing.map((entry) => entry.house.plot.i));

function cityPlots() {
  const rings = [20, 36, 52];
  const plotOffset = 7.6;
  const avenues = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const plots = [];
  for (const ringRadius of rings) {
    const plotRadius = ringRadius + plotOffset;
    const step = 16.5 / plotRadius;
    for (let angle = 0; angle < Math.PI * 2 - step / 2; angle += step) {
      const nearAvenue = avenues.some((avenue) => Math.abs(angleDifference(angle, avenue)) < 9.5 / plotRadius);
      if (nearAvenue) continue;
      plots.push({
        i: plots.length,
        x: Math.cos(angle) * plotRadius,
        z: Math.sin(angle) * plotRadius,
      });
    }
  }
  return plots;
}

const verificationPlot = cityPlots().reverse().find((plot) => !taken.has(plot.i));
if (!verificationPlot) throw new Error('No verification plot is available');

const document = {
  version: 0,
  updatedAt: Date.now(),
  house: {
    id: houseId,
    owner: `verify_owner_${suffix}`,
    name: `Realtime Check ${suffix}`,
    nickname: 'tester',
    foundation: 'compact',
    height: 'one',
    material: 'wood',
    layout: 'balanced',
    roof: 'gable',
    kit: 'cozy',
    detail: 'none',
    scheme: 'warm',
    companion: null,
    builtAt: Date.now(),
    plot: {
      i: verificationPlot.i,
      x: Math.round(verificationPlot.x * 100) / 100,
      z: Math.round(verificationPlot.z * 100) / 100,
    },
    schemaVersion: 3,
    revision: 0,
  },
  definition: null,
  interior: { slots: {}, yard: {} },
  placements: { revision: 0, objects: [] },
  business: null,
  needs: null,
  links: [],
};

let unsubscribe = null;
let unsubscribeBusiness = null;
let unsubscribeTrades = null;
try {
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Second WebSocket client did not receive the house')), 12_000);
    unsubscribe = clientB.onUpdate(api.world.list, {}, (documents) => {
      if (!documents.some((entry) => entry.house.id === houseId)) return;
      clearTimeout(timer);
      resolve(documents);
    }, reject);
  });
  const created = await clientA.mutation(api.world.create, {
    clientId: `verify_a_${suffix}`,
    document,
  });
  assert.equal(created.house.id, houseId);
  const documentsOnB = await received;
  assert.ok(documentsOnB.some((entry) => entry.house.id === houseId));
  const businessReceived = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Second WebSocket client did not receive the business')), 12_000);
    unsubscribeBusiness = clientB.onUpdate(api.world.list, {}, (documents) => {
      const shared = documents.find((entry) => entry.house.id === houseId);
      if (!shared?.business) return;
      clearTimeout(timer);
      resolve(shared);
    }, reject);
  });
  const withBusinessResult = await clientA.mutation(api.world.changeBusiness, {
    clientId: `verify_a_${suffix}`,
    operationId: `verify_business_create_${suffix}`,
    accountId: document.house.owner,
    houseId,
    action: 'create',
    business: {
      type: 'cafe', level: 1, reputation: 0, status: 'open', visitors: 0, uniq: {},
      stock: { coffee: 3, tea: 0, snack: 0, social: 0 },
      prices: { coffee: 6, tea: 5, snack: 9, social: 15 },
    },
  });
  const withBusiness = withBusinessResult.document;
  assert.equal(withBusiness.business.type, 'cafe');
  const businessOnB = await businessReceived;
  assert.equal(businessOnB.business.stock.coffee, 3);

  await Promise.all([
    clientA.mutation(api.world.changeBusiness, {
      clientId: `verify_a_${suffix}`,
      operationId: `verify_business_stock_${suffix}`,
      accountId: document.house.owner,
      houseId,
      action: 'restock',
      productId: 'coffee',
      amount: 5,
    }),
    clientB.mutation(api.world.changeBusiness, {
      clientId: `verify_b_${suffix}`,
      operationId: `verify_business_price_${suffix}`,
      accountId: document.house.owner,
      houseId,
      action: 'price',
      productId: 'coffee',
      value: 7,
    }),
  ]);
  const afterConcurrentChanges = (await clientA.query(api.world.list, {}))
    .find((entry) => entry.house.id === houseId);
  assert.equal(afterConcurrentChanges.business.stock.coffee, 8);
  assert.equal(afterConcurrentChanges.business.prices.coffee, 7);

  const purchaseKey = `verify_purchase_${suffix}`;
  const tradeReceived = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Second WebSocket client did not receive the trade')), 12_000);
    unsubscribeTrades = clientB.onUpdate(api.world.recentTrades, {}, (trades) => {
      const trade = trades.find((entry) => entry.purchaseKey === purchaseKey);
      if (!trade) return;
      clearTimeout(timer);
      resolve(trade);
    }, reject);
  });
  const purchase = await clientA.mutation(api.world.purchaseProduct, {
    clientId: `verify_buyer_${suffix}`,
    buyerId: `verify_buyer_${suffix}`,
    houseId,
    productId: 'coffee',
    purchaseKey,
    expectedPrice: 7,
    fee: 1,
  });
  assert.equal(purchase.document.business.stock.coffee, 7);
  assert.equal(purchase.trade.net, 6);
  const tradeOnB = await tradeReceived;
  assert.equal(tradeOnB.sellerId, document.house.owner);
  const paymentBase = {
    clientId: `verify_payment_client_${suffix}`,
    accountId: document.house.owner,
    walletAddress: '11111111111111111111111111111111',
    quoteId: `q_verify_${suffix}`,
    coins: 500,
    tokens: 25000,
  };
  await clientA.mutation(api.world.beginPayment, { ...paymentBase, sessionId: paymentOneId });
  const secondPayment = await clientA.mutation(api.world.beginPayment, { ...paymentBase, sessionId: paymentTwoId });
  assert.equal(secondPayment.status, 'open');
  const replacedPayment = await clientA.query(api.world.verificationPayment, { sessionId: paymentOneId });
  assert.equal(replacedPayment.status, 'cancelled');
  assert.equal(replacedPayment.closeReason, 'replaced-by-new-attempt');
  const completedPayment = await clientA.mutation(api.world.completePayment, {
    sessionId: paymentTwoId,
    accountId: document.house.owner,
    signature: `verify_signature_${suffix}`,
  });
  assert.equal(completedPayment.status, 'completed');
  console.log('Realtime verification passed: house, business, player trade and replaceable payment sessions work.');
  const holdMs = Math.min(30_000, Math.max(0, Number(process.env.VERIFY_HOLD_MS) || 0));
  if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
} finally {
  unsubscribe?.();
  unsubscribeBusiness?.();
  unsubscribeTrades?.();
  await clientA.mutation(api.world.removeVerificationHouse, { houseId }).catch(() => {});
  await clientA.mutation(api.world.removeVerificationPayment, { sessionId: paymentOneId }).catch(() => {});
  await clientA.mutation(api.world.removeVerificationPayment, { sessionId: paymentTwoId }).catch(() => {});
  await Promise.all([clientA.close(), clientB.close()]);
}
