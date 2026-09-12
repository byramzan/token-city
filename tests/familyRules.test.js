import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_RULES, FAMILY_BUSINESSES, NEED_KEYS, initialHousehold, calculateHousehold,
  updatePresence, activeCrisis, productFor, offerQuote, deliverRecovery, useStoredRecovery,
  recoveryPreview, validateRecovery, applyRecovery, familyResidents, consumptionUnits,
  rankBusinessOffers, emergencyOffer, needState,
} from '../server/familyRules.js';

const START = 1_000_000;
const home = { id: 'family_test', owner: 'owner_test', floorCount: 1, plot: { x: 0, z: 0 } };
const make = (floors = 1) => initialHousehold({ ...home, floorCount: floors }, START);
function advance(input, duration, visibility = 'active') {
  let state = updatePresence(input, { clientId: 'browser', visibility }, input.lastCalculatedAt);
  const end = input.lastCalculatedAt + duration;
  while (state.lastCalculatedAt < end) state = updatePresence(state, { clientId: 'browser', visibility }, Math.min(end, state.lastCalculatedAt + 60_000));
  return state;
}
const crisisState = (keys = ['hunger']) => {
  const state = make();
  for (const key of keys) state.needs[key] = 0;
  state.activeCrisisNeed = activeCrisis(state.needs);
  return calculateHousehold(state, START);
};
const business = (type = 'grocery', quantity = 12) => ({ type, status: 'open', reputation: 12,
  stock: Object.fromEntries(FAMILY_BUSINESSES[type].products.map((product) => [product.id, quantity])),
  prices: Object.fromEntries(FAMILY_BUSINESSES[type].products.map((product) => [product.id, product.price])) });

test('four distinct authoritative timings reach zero at 8, 10, 14, 18 active hours', () => {
  for (const [key, hours] of [['hunger', 8], ['energy', 10], ['knowledge', 14], ['familyBond', 18]]) {
    const state = advance(make(), hours * 3_600_000);
    assert.equal(state.needs[key], 0, key);
    assert.ok(advance(make(), (hours - 0.5) * 3_600_000).needs[key] > 0, key);
  }
  const short = advance(make(), 30 * 60_000);
  assert.ok(NEED_KEYS.every((key) => short.needs[key] > 90));
});
test('background tabs decay at one quarter speed and multiple tabs do not multiply decay', () => {
  const oneHour = 3_600_000;
  assert.equal(advance(make(), oneHour, 'background').needs.hunger, 96.87500002);
  let input = updatePresence(make(), { clientId: 'other', visibility: 'active' }, START);
  input = updatePresence(input, { clientId: 'browser', visibility: 'active' }, START);
  assert.ok(Math.abs(advance(input, oneHour).needs.hunger - 87.5) < 1e-6);
});
test('disconnect leases expire; long offline periods cap each loss and preserve Family Bond', () => {
  const state = updatePresence(make(), { clientId: 'closed-tab', visibility: 'active' }, START);
  const offline = calculateHousehold(state, START + 7 * 24 * 3_600_000);
  assert.ok(Math.abs(offline.needs.hunger - (75 - 12.5 * FAMILY_RULES.presenceLeaseMs / 3_600_000)) < 1e-6);
  assert.ok(Math.abs(offline.needs.familyBond - (100 - (100 / 18) * FAMILY_RULES.presenceLeaseMs / 3_600_000)) < 1e-6);
  assert.deepEqual(calculateHousehold(offline, START + 30 * 24 * 3_600_000).needs, offline.needs);
  const fullyOffline = calculateHousehold(make(), START + 3 * 24 * 3_600_000);
  assert.equal(fullyOffline.needs.familyBond, 100);
  assert.equal(fullyOffline.needs.hunger, 75);
  const reopened = updatePresence(fullyOffline, { clientId: 'browser', visibility: 'active' }, fullyOffline.lastCalculatedAt);
  assert.equal(reopened.needs.hunger, 75);
});
test('warning thresholds, family sizes and consumption units are deterministic', () => {
  assert.deepEqual([100, 70, 30, 10, 0].map(needState), ['comfortable', 'normal', 'low', 'critical', 'crisis']);
  assert.deepEqual([1, 2, 3, 4, 5].map(familyResidents), [4, 6, 8, 10, 12]);
  assert.deepEqual([4, 6, 8, 10, 12].map(consumptionUnits), [1, 2, 2, 3, 3]);
});
test('Hunger crisis blocks books, permits grocery, and remains locked until 20', () => {
  const state = crisisState();
  assert.match(validateRecovery(state, productFor('bookstore', 'book')), /Hunger.*20/);
  assert.equal(validateRecovery(state, productFor('grocery', 'basket')), null);
  const small = { ...productFor('grocery', 'basket'), effects: { hunger: 10 } };
  const first = applyRecovery(state, small, START);
  assert.equal(first.activeCrisisNeed, 'hunger');
  const second = applyRecovery(first, small, START);
  assert.equal(second.activeCrisisNeed, null);
  assert.equal(validateRecovery(second, productFor('bookstore', 'book')), null);
});
test('secondary effects are suspended in a crisis while unrelated needs continue to decay', () => {
  const state = crisisState();
  state.needs.familyBond = 30;
  const meal = productFor('restaurant', 'dinner');
  const preview = recoveryPreview(state, meal);
  assert.equal(preview.effects.hunger, 45);
  assert.equal(preview.suspendedEffects.familyBond, 8);
  assert.equal(preview.resultingNeeds.familyBond, 30);
  const after = advance(state, 60_000);
  assert.ok(after.needs.energy < state.needs.energy);
  assert.ok(after.needs.knowledge < state.needs.knowledge);
});
test('two simultaneous zero needs and complete crisis recover in strict order', () => {
  const dual = crisisState(['hunger', 'knowledge']);
  assert.equal(applyRecovery(dual, productFor('grocery', 'basket'), START).activeCrisisNeed, 'knowledge');
  let state = crisisState(NEED_KEYS);
  assert.equal(state.fullCrisis, true);
  const choices = [['grocery', 'basket'], ['cafe', 'coffee'], ['bookstore', 'book'], ['flower', 'bouquet']];
  for (let i = 0; i < choices.length; i++) {
    assert.equal(state.activeCrisisNeed, NEED_KEYS[i]);
    state = applyRecovery(state, productFor(...choices[i]), START);
  }
  assert.equal(state.activeCrisisNeed, null);
  assert.equal(state.fullCrisis, false);
});
test('goods deliver to inventory; use applies once; family packages consume 1, 2, 3 units', () => {
  const state = make(3);
  state.needs.hunger = 10;
  const basket = productFor('grocery', 'basket');
  const delivered = deliverRecovery(state, basket, 'purchase-one', START, 'shop');
  assert.equal(delivered.needs.hunger, 10);
  const used = useStoredRecovery(delivered, 'delivery:purchase-one', START).state;
  assert.equal(used.needs.hunger, 27.5);
  assert.equal(useStoredRecovery(used, 'delivery:purchase-one', START).duplicate, true);
  assert.equal(useStoredRecovery(used, 'delivery:purchase-one', START).state.needs.hunger, 27.5);
  const quote = offerQuote(state, business(), 'basket_8');
  assert.equal(quote.stockUnits, 2);
  assert.equal(quote.partial, false);
  assert.equal(quote.effects.hunger, 35);
  assert.equal(offerQuote(state, business('grocery', 1), 'basket_8').allowed, false);
  for (const category of Object.values(FAMILY_BUSINESSES)) {
    assert.ok([4, 8, 12].every((coverage) => category.products.some((product) => product.coveredResidents === coverage)), category.name);
  }
});
test('flowers need gifting and books cannot be read repeatedly or stockpiled without bound', () => {
  let state = make();
  state.needs.familyBond = 20;
  state = deliverRecovery(state, productFor('flower', 'bouquet'), 'gift', START, 'flowers');
  assert.equal(state.needs.familyBond, 20);
  state = useStoredRecovery(state, 'delivery:gift', START).state;
  assert.equal(state.needs.familyBond, 50);
  state = deliverRecovery(state, productFor('bookstore', 'book'), 'book', START, 'books');
  state = useStoredRecovery(state, 'delivery:book', START).state;
  assert.match(validateRecovery(state, productFor('bookstore', 'book'), { purchase: true }), /already been read/);
  let stocked = make();
  for (let i = 0; i < 6; i++) stocked = deliverRecovery(stocked, productFor('bookstore', 'book'), `book${i}`, START, 'books');
  assert.match(validateRecovery(stocked, productFor('bookstore', 'book'), { purchase: true }), /maximum/);
  stocked = make();
  for (let i = 0; i < 8; i++) stocked = deliverRecovery(stocked, productFor('grocery', 'basket'), `food${i}`, START, 'shop');
  assert.match(validateRecovery(stocked, productFor('grocery', 'basket'), { purchase: true }), /maximum/);
});
test('services cannot finish early or apply twice; crisis recovery is not blocked by an unrelated pending visit', () => {
  let state = make();
  state.needs.knowledge = 10;
  state = deliverRecovery(state, productFor('bookstore', 'session'), 'visit', START, 'library');
  assert.equal(state.needs.knowledge, 10);
  assert.throws(() => useStoredRecovery(state, 'delivery:visit', START, true), /not finished/);
  const due = START + productFor('bookstore', 'session').durationMs;
  const finished = useStoredRecovery(state, 'delivery:visit', due, true);
  assert.ok(finished.state.needs.knowledge > 49);
  assert.equal(useStoredRecovery(finished.state, 'delivery:visit', due, true).duplicate, true);
  state.needs.energy = 0; state.activeCrisisNeed = 'energy';
  assert.equal(validateRecovery(state, productFor('restcenter', 'rest'), { purchase: true }), null);
});
test('ranked player offers suppress emergency support immediately, including full household storage', () => {
  const state = crisisState();
  state.unavailableSince.hunger = START;
  const shop = { house: { id: 'shop', owner: 'other', name: 'Neighbor', plot: { x: 4, z: 5 } }, business: business() };
  const now = START + FAMILY_RULES.emergencyGraceMs + 1;
  assert.equal(emergencyOffer(state, [], home, START + 1), null);
  const emergency = emergencyOffer(state, [], home, now);
  assert.equal(emergency.effects.hunger, 20);
  assert.ok(emergency.price >= emergency.referencePrice * 1.25);
  assert.equal(emergencyOffer(state, [shop], home, now), null);
  const ranked = rankBusinessOffers(state, [shop], 'hunger', home);
  assert.ok(ranked.length);
  assert.deepEqual(ranked, rankBusinessOffers(state, [shop], 'hunger', home));
  const closed = { ...shop, business: { ...shop.business, status: 'closed' } };
  assert.ok(emergencyOffer(state, [closed], home, now));
  assert.equal(emergencyOffer(make(), [], home, now), null);
});
