import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBusiness, normalizeClientId, normalizeJoinDocuments, normalizeMarketplacePurchase,
  normalizeWorldDocument, parseClientMessage,
} from '../server/worldProtocol.js';

function worldDocument(overrides = {}) {
  return {
    version: 0,
    house: {
      id: 'h_shared_1', owner: 'acc_player_1', name: 'Shared House', nickname: 'builder',
      foundation: 'compact', height: 'two', material: 'brick', layout: 'balanced',
      roof: 'gable', kit: 'cozy', detail: 'none', scheme: 'warm', companion: null,
      builtAt: 123, plot: { i: 8, x: 12.4, z: -17.8 }, schemaVersion: 3, revision: 0,
      ...overrides,
    },
    definition: null,
    interior: { slots: {}, yard: {} },
    placements: { revision: 0, objects: [] },
    business: null,
    needs: null,
    links: [],
  };
}

test('shared world document preserves the canonical public house fields', () => {
  const result = normalizeWorldDocument(worldDocument());
  assert.equal(result.house.id, 'h_shared_1');
  assert.equal(result.house.plot.i, 8);
  assert.deepEqual(result.placements, { revision: 0, objects: [] });
});

test('shared world rejects invalid plots and executable-sized payloads', () => {
  assert.throws(() => normalizeWorldDocument(worldDocument({ plot: { i: -1, x: 0, z: 0 } })), /invalid-plot/);
  const oversized = worldDocument();
  oversized.definition = { payload: 'x'.repeat(600 * 1024) };
  assert.throws(() => normalizeWorldDocument(oversized), /document-too-large/);
});

test('join import is capped and every imported house is validated', () => {
  const documents = Array.from({ length: 120 }, (_, index) => worldDocument({
    id: `h_${index}`,
    name: `House ${index}`,
    plot: { i: index % 90, x: index, z: -index },
  }));
  assert.equal(normalizeJoinDocuments(documents).length, 96);
});

test('websocket messages and per-tab IDs are normalized', () => {
  assert.deepEqual(parseClientMessage('{"type":"ping","requestId":"r1"}').type, 'ping');
  assert.equal(normalizeClientId('client_abc-123'), 'client_abc-123');
  assert.equal(normalizeClientId('bad client id'), '');
  assert.throws(() => parseClientMessage('{broken'), /invalid-json/);
});

test('realtime businesses keep only valid catalog stock and bounded prices', () => {
  const business = normalizeBusiness({
    type: 'bakery', level: 4, reputation: 22, status: 'open',
    stock: { bread: 7, hacked: 999 },
    prices: { bread: 999, pastry: 1 },
    uniq: { acc_buyer: true, 'bad account': true },
  }, { material: 'brick' });
  assert.deepEqual(Object.keys(business.stock), ['bread', 'pastry', 'meal', 'meal_8', 'meal_12', 'cake']);
  assert.equal(business.prices.bread, 14);
  assert.equal(business.prices.pastry, 7);
  assert.deepEqual(business.uniq, { acc_buyer: true });
  assert.throws(() => normalizeBusiness({ type: 'techshop' }, { material: 'wood' }), /business-not-allowed/);
});

test('shared purchase receipts require stable ids and a positive net payment', () => {
  const purchase = normalizeMarketplacePurchase({
    buyerId: 'acc_buyer', houseId: 'h_shop', productId: 'bread',
    purchaseKey: 'purchase_unique_1', expectedPrice: 8, fee: 1,
  });
  assert.equal(purchase.expectedPrice - purchase.fee, 7);
  assert.throws(() => normalizeMarketplacePurchase({
    buyerId: 'bad buyer', houseId: 'h_shop', productId: 'bread',
    purchaseKey: 'purchase_unique_2', expectedPrice: 8, fee: 1,
  }), /invalid-purchase/);
});
