// Shared presentation data and pure server gameplay rules. Only Convex advances
// authoritative household time; importing these values never trusts a client clock.
export const FAMILY_RULES = Object.freeze({
  version: 1, tickMs: 60_000, presenceLeaseMs: 90_000,
  backgroundRate: 0.25, offlineRate: 0.1, offlineCap: 25,
  crisisExitThreshold: 20, emergencyGraceMs: 180_000,
  storage: Object.freeze({ food: 8, energy: 6, books: 6, flowers: 4 }),
});
export const NEED_KEYS = Object.freeze(['hunger', 'energy', 'knowledge', 'familyBond']);
export const FAMILY_NEEDS = Object.freeze({
  hunger: { name: 'Hunger', icon: '🍞', activeHours: 8 },
  energy: { name: 'Energy', icon: '⚡', activeHours: 10 },
  knowledge: { name: 'Knowledge', icon: '📚', activeHours: 14 },
  familyBond: { name: 'Family Bond', icon: '🤝', activeHours: 18 },
});

const good = (id, name, price, need, restore, category, extra = {}) => ({
  id, name, price, cost: Math.max(1, Math.floor(price * 0.5)), need, restore,
  effects: { [need]: restore }, delivery: 'product', storageCategory: category,
  coveredResidents: 4, stockUnits: 1, useLabel: category === 'books' ? 'Read' : category === 'flowers' ? 'Give to family' : 'Consume',
  ...extra,
});
const service = (id, name, price, need, restore, extra = {}) => ({
  ...good(id, name, price, need, restore, null), delivery: 'service', durationMs: 15_000, useLabel: 'Complete visit', ...extra,
});
function packages(base) {
  return [base, ...[2, 3].map((units) => ({
    ...base, id: `${base.id}_${units * 4}`, name: `${base.name} · ${units * 4} people`,
    price: Math.round(base.price * units * 0.95), cost: base.cost * units,
    coveredResidents: units * 4, stockUnits: units,
  }))];
}
export const FAMILY_BUSINESSES = Object.freeze({
  grocery: {
    name: 'Grocery Store', comp: 'bakery', sign: 'GROCERY', emoji: '🛒', category: 'food',
    products: packages(good('basket', 'Grocery Basket', 12, 'hunger', 35, 'food')),
  },
  bakery: {
    name: 'Bakery', comp: 'bakery', sign: 'BAKERY', emoji: '🥨', category: 'food',
    products: [good('bread', 'Bread', 8, 'hunger', 20, 'food'), good('pastry', 'Pastry Box', 12, 'hunger', 25, 'food'),
      ...packages(good('meal', 'Bakery Meal', 20, 'hunger', 25, 'food')), good('cake', 'Family Breakfast', 35, 'hunger', 35, 'food', { coveredResidents: 12, stockUnits: 3 })],
  },
  restaurant: {
    name: 'Restaurant', comp: 'cafe', sign: 'RESTAURANT', emoji: '🍽️', category: 'food',
    products: packages(service('dinner', 'Restaurant Family Meal', 20, 'hunger', 45, { effects: { hunger: 45, familyBond: 8 }, durationMs: 25_000 })),
  },
  cafe: {
    name: 'Café', comp: 'cafe', sign: 'CAFÉ', emoji: '☕', category: 'drinks',
    products: [good('coffee', 'Coffee', 6, 'energy', 30, 'energy'), good('tea', 'Tea', 5, 'energy', 24, 'energy'),
      good('snack', 'Energy Snack', 9, 'energy', 20, 'energy'),
      ...packages(service('social', 'Café Family Visit', 15, 'energy', 20, { effects: { energy: 20, familyBond: 8 } }))],
  },
  restcenter: {
    name: 'Rest Center', comp: 'cafe', sign: 'REST & SPA', emoji: '🛋️', category: 'rest',
    products: packages(service('rest', 'Rest Center Visit', 18, 'energy', 45, { durationMs: 25_000 })),
  },
  bookstore: {
    name: 'Library & Bookstore', comp: 'library', sign: 'LIBRARY', emoji: '📚', category: 'books',
    products: [good('book', 'Book', 12, 'knowledge', 25, 'books', { titleId: 'town-stories' }),
      good('kit', 'Learning Kit', 22, 'knowledge', 35, 'books', { titleId: 'family-science', coveredResidents: 8, stockUnits: 2 }),
      service('archive', 'Research Session', 9, 'knowledge', 25), ...packages(service('session', 'Library Session', 18, 'knowledge', 40))],
  },
  flower: {
    name: 'Flower Shop', comp: 'flower', sign: 'FLOWERS', emoji: '🌸', category: 'flowers',
    products: [...packages(good('bouquet', 'Flower Gift', 10, 'familyBond', 30, 'flowers')),
      good('familyb', 'Family Bouquet', 18, 'familyBond', 30, 'flowers', { coveredResidents: 8, stockUnits: 2 }),
      good('celebr', 'Celebration Arrangement', 30, 'familyBond', 40, 'flowers', { coveredResidents: 12, stockUnits: 3 }),
      good('plant', 'Family Plant Gift', 14, 'familyBond', 35, 'flowers')],
  },
  entertainment: {
    name: 'Family Entertainment', comp: 'arcade', sign: 'FAMILY FUN', emoji: '🎭', category: 'entertainment',
    products: packages(service('visit', 'Family Entertainment Visit', 20, 'familyBond', 45, { durationMs: 25_000 })),
  },
  // Retained catalog IDs migrate existing stores without losing their stock.
  techshop: {
    name: 'Technology Learning Center', comp: 'techstore', sign: 'LEARN TECH', emoji: '💾', category: 'gadgets',
    products: [service('terminal', 'Terminal Workshop', 30, 'knowledge', 40), service('device', 'Quiet Device Session', 16, 'energy', 28),
      service('lamp', 'Light Therapy', 12, 'energy', 22), ...packages(service('gadget', 'Family Technology Workshop', 20, 'knowledge', 35))],
  },
});
export const FAMILY_BUSINESS_MATERIALS = Object.freeze({
  wood: ['grocery', 'cafe', 'flower', 'restaurant', 'restcenter', 'entertainment', 'bakery', 'bookstore'],
  brick: ['bakery', 'bookstore', 'grocery', 'restaurant', 'cafe', 'flower', 'restcenter', 'entertainment'],
  stone: ['bookstore', 'cafe', 'grocery', 'bakery', 'restaurant', 'restcenter', 'flower', 'entertainment'],
  tech: ['techshop', 'bookstore', 'grocery', 'bakery', 'restaurant', 'cafe', 'restcenter', 'flower', 'entertainment'],
});

export const canonicalNeed = (key) => key === 'bond' ? 'familyBond' : key;
export const floorCountFor = (house) => Math.max(1, Math.min(5, Math.trunc(Number(house?.floorCount) || (['two', 'attic'].includes(house?.height) ? 2 : 1))));
export const familyResidents = (floors) => 4 + (Math.max(1, Math.min(5, Number(floors) || 1)) - 1) * 2;
export const consumptionUnits = (residents) => Math.ceil(residents / 4);
const round = (n) => n < 1e-6 ? 0 : Math.round(Math.max(0, Math.min(100, Number(n) || 0)) * 1e9) / 1e9;
export function needState(value) {
  return value <= 0 ? 'crisis' : value <= 10 ? 'critical' : value <= 30 ? 'low' : value <= 70 ? 'normal' : 'comfortable';
}
export function activeCrisis(needs, previous = null) {
  if (previous && needs[previous] < FAMILY_RULES.crisisExitThreshold) return previous;
  return NEED_KEYS.find((key) => needs[key] <= 0) || null;
}
export function initialHousehold(house, now) {
  const floorCount = floorCountFor(house);
  return {
    householdId: house.id, houseId: house.id, needs: Object.fromEntries(NEED_KEYS.map((key) => [key, 100])),
    floorCount, residentCount: familyResidents(floorCount), familyConsumptionUnits: consumptionUnits(familyResidents(floorCount)),
    lastCalculatedAt: now, simulationState: 'offline', activeCrisisNeed: null, crisisStartedAt: null,
    needConfigVersion: FAMILY_RULES.version, stateRevision: 1, sessions: [], offlineLoss: {},
    inventory: [], services: [], readTitles: [], recentOperations: [], events: [], unavailableSince: {},
    activeMs: 0, backgroundMs: 0, offlineMs: 0,
  };
}
function sessionMode(sessions, at) {
  const connected = sessions.filter((session) => session.visibility !== 'offline' && session.lastSeenAt + FAMILY_RULES.presenceLeaseMs > at);
  return connected.some((session) => session.visibility === 'active') ? 'active' : connected.length ? 'background' : 'offline';
}

/** Split at lease expiry so a closed tab never decays at active speed forever. */
export function calculateHousehold(input, now) {
  const state = structuredClone(input);
  if (state.constructing) { state.lastCalculatedAt = now; return state; }
  const start = Math.min(now, state.lastCalculatedAt);
  const boundaries = [...new Set([start, now, ...state.sessions.map((session) => session.lastSeenAt + FAMILY_RULES.presenceLeaseMs)
    .filter((at) => at > start && at < now)])].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const at = boundaries[index];
    const duration = boundaries[index + 1] - at;
    const mode = sessionMode(state.sessions, at);
    if (mode !== 'offline') state.offlineLoss = {};
    else if (state.simulationState !== 'offline') state.offlineLoss = {};
    state.simulationState = mode;
    state[`${mode}Ms`] = (state[`${mode}Ms`] || 0) + duration;
    for (const key of NEED_KEYS) {
      const multiplier = mode === 'active' ? 1 : mode === 'background' ? FAMILY_RULES.backgroundRate : key === 'familyBond' ? 0 : FAMILY_RULES.offlineRate;
      let loss = duration / 3_600_000 * (100 / FAMILY_NEEDS[key].activeHours) * multiplier;
      if (mode === 'offline') {
        loss = Math.min(loss, Math.max(0, FAMILY_RULES.offlineCap - (state.offlineLoss[key] || 0)));
        state.offlineLoss[key] = (state.offlineLoss[key] || 0) + loss;
      }
      state.needs[key] = round(state.needs[key] - loss);
    }
    state.activeCrisisNeed = activeCrisis(state.needs, state.activeCrisisNeed);
  }
  state.simulationState = sessionMode(state.sessions, now);
  state.lastCalculatedAt = now;
  state.activeCrisisNeed = activeCrisis(state.needs, state.activeCrisisNeed);
  if (state.activeCrisisNeed && !state.crisisStartedAt) state.crisisStartedAt = now;
  if (!state.activeCrisisNeed) state.crisisStartedAt = null;
  state.fullCrisis = NEED_KEYS.every((key) => state.needs[key] <= 0) || Boolean(state.fullCrisis && state.activeCrisisNeed);
  state.crisisSequence = state.activeCrisisNeed ? [state.activeCrisisNeed, ...NEED_KEYS.filter((key) => key !== state.activeCrisisNeed && state.needs[key] <= 0)] : [];
  return state;
}
export function updatePresence(input, { clientId, visibility }, now) {
  const state = calculateHousehold(input, now);
  const hadConnected = state.simulationState !== 'offline';
  state.sessions = state.sessions.filter((session) => session.clientId !== clientId && session.lastSeenAt + FAMILY_RULES.presenceLeaseMs > now);
  if (visibility !== 'offline') state.sessions.push({ clientId, visibility, lastSeenAt: now });
  state.sessions = state.sessions.slice(-12);
  state.simulationState = sessionMode(state.sessions, now);
  if (!hadConnected && state.simulationState !== 'offline') state.offlineLoss = {};
  return state;
}
export function productFor(businessType, productId) {
  return FAMILY_BUSINESSES[businessType]?.products.find((product) => product.id === productId) || null;
}
export function storageUsage(state, category) {
  return state.inventory.filter((item) => !item.usedAt && item.storageCategory === category)
    .reduce((sum, item) => sum + (category === 'books' || category === 'flowers' ? 1 : item.stockUnits), 0);
}
export function recoveryPreview(state, product) {
  const coverage = Math.min(product.coveredResidents / state.residentCount, 1);
  const effects = {};
  const suspendedEffects = {};
  for (const [key, amount] of Object.entries(product.effects)) {
    if (state.activeCrisisNeed && key !== state.activeCrisisNeed) suspendedEffects[key] = round(amount * coverage);
    else effects[key] = round(amount * coverage);
  }
  const resultingNeeds = { ...state.needs };
  for (const [key, effect] of Object.entries(effects)) resultingNeeds[key] = round(resultingNeeds[key] + effect);
  const crisisAfter = activeCrisis(resultingNeeds, state.activeCrisisNeed);
  return { coverage, partial: coverage < 1, effects, suspendedEffects, resultingNeeds, crisisAfter };
}
export function validateRecovery(state, product, { purchase = false } = {}) {
  if (!product) return 'This offer is no longer available.';
  if (state.activeCrisisNeed && !(product.effects[state.activeCrisisNeed] > 0)) {
    return `${FAMILY_NEEDS[state.activeCrisisNeed].name} is in crisis. Restore it to 20 before ${product.name} can be bought or used.`;
  }
  if (product.titleId && state.readTitles.includes(product.titleId)) return 'This book has already been read. Choose another title or a library session.';
  if (purchase && product.delivery === 'service' && state.services.some((entry) => !entry.completedAt
      && (!state.activeCrisisNeed || entry.effects[state.activeCrisisNeed] > 0))) {
    return 'Complete the current family visit before starting another service.';
  }
  if (purchase && product.storageCategory) {
    const units = ['books', 'flowers'].includes(product.storageCategory) ? 1 : product.stockUnits;
    if (storageUsage(state, product.storageCategory) + units > FAMILY_RULES.storage[product.storageCategory]) {
      return `Your household already stores the maximum amount of ${product.storageCategory}. Use a stored product first.`;
    }
  }
  return null;
}
export function offerQuote(state, business, productId) {
  const product = productFor(business?.type, productId);
  if (!product) return { allowed: false, reason: 'This offer is no longer available.' };
  const stock = Number(business.stock?.[productId] || 0);
  const reason = business.status !== 'open' ? 'This business is temporarily closed.'
    : stock < product.stockUnits ? `This business has insufficient ${product.delivery === 'service' ? 'service capacity' : 'stock'} for this package.`
      : validateRecovery(state, product, { purchase: true });
  return {
    allowed: !reason, reason, product, price: Number(business.prices?.[productId] || product.price), stock,
    stockUnits: product.stockUnits, coveredResidents: product.coveredResidents,
    residentCount: state.residentCount, requiredUnits: state.familyConsumptionUnits,
    storageUsed: product.storageCategory ? storageUsage(state, product.storageCategory) : 0,
    storageLimit: product.storageCategory ? FAMILY_RULES.storage[product.storageCategory] : null,
    ...recoveryPreview(state, product),
  };
}
export function deliverRecovery(input, product, purchaseKey, now, businessId) {
  const state = structuredClone(input);
  if ([...state.inventory, ...state.services].some((entry) => entry.purchaseKey === purchaseKey)) return state;
  const record = { ...structuredClone(product), id: `delivery:${purchaseKey}`, productId: product.id, purchaseKey, businessId, purchasedAt: now };
  if (product.delivery === 'service') state.services.push({ ...record, completeAt: now + product.durationMs, completedAt: null });
  else state.inventory.push({ ...record, usedAt: null });
  return state;
}
export function applyRecovery(input, product, now) {
  const state = structuredClone(input);
  const reason = validateRecovery(state, product);
  if (reason) throw new Error(reason);
  state.needs = recoveryPreview(state, product).resultingNeeds;
  state.activeCrisisNeed = activeCrisis(state.needs, state.activeCrisisNeed);
  if (!state.activeCrisisNeed) state.crisisStartedAt = null;
  if (product.titleId && !state.readTitles.includes(product.titleId)) state.readTitles.push(product.titleId);
  return calculateHousehold(state, now);
}
export function useStoredRecovery(input, itemId, now, serviceCompletion = false) {
  const state = calculateHousehold(input, now);
  const records = serviceCompletion ? state.services : state.inventory;
  const item = records.find((entry) => entry.id === itemId);
  if (!item) throw new Error('This household item was not found.');
  if (item.usedAt || item.completedAt) return { state, duplicate: true };
  if (serviceCompletion && now < item.completeAt) throw new Error('This service has not finished yet.');
  const updated = applyRecovery(state, item, now);
  const target = (serviceCompletion ? updated.services : updated.inventory).find((entry) => entry.id === itemId);
  target[serviceCompletion ? 'completedAt' : 'usedAt'] = now;
  return { state: updated, duplicate: false };
}
export function rankBusinessOffers(state, world, need, home, preferences = []) {
  const key = canonicalNeed(need);
  return world.flatMap((document) => {
    const house = document.house;
    if (!house || house.owner === home.owner || house.id === home.id || !document.business) return [];
    return (FAMILY_BUSINESSES[document.business.type]?.products || []).flatMap((product) => {
      if (!(product.effects[key] > 0)) return [];
      const quote = offerQuote(state, document.business, product.id);
      if (!quote.allowed) return [];
      const distance = Math.hypot(house.plot.x - home.plot.x, house.plot.z - home.plot.z);
      const recovery = quote.effects[key] || 0;
      const score = recovery / Math.max(1, quote.price) * 10 + quote.coverage * 5 - distance * 0.025
        + Math.min(3, Number(document.business.reputation || 0) / 100) + Math.min(2, quote.stock / product.stockUnits / 10)
        + (product.delivery === 'product' ? 0.25 : 1 / (product.durationMs / 1000)) + (preferences.includes(house.id) ? 4 : 0);
      return [{ houseId: house.id, businessName: FAMILY_BUSINESSES[document.business.type].name, houseName: house.name,
        businessType: document.business.type, productId: product.id, name: product.name, need: key, distance: Math.round(distance * 10) / 10,
        score, recovery, ...quote }];
    });
  }).sort((a, b) => b.score - a.score || a.houseId.localeCompare(b.houseId) || a.productId.localeCompare(b.productId));
}
export function hasPlayerRecoveryOffer(world, need, home, state = null) {
  return world.some((document) => document.house?.owner !== home.owner && document.business?.status === 'open'
    && (FAMILY_BUSINESSES[document.business.type]?.products || []).some((product) => product.effects[need] > 0
      && !(product.titleId && state?.readTitles?.includes(product.titleId))
      && Number(document.business.stock?.[product.id] || 0) >= product.stockUnits));
}
export function emergencyOffer(state, world, home, now) {
  const need = state.activeCrisisNeed;
  if (!need || hasPlayerRecoveryOffer(world, need, home, state)) return null;
  const since = state.unavailableSince[need];
  if (!since || now - since < FAMILY_RULES.emergencyGraceMs) return null;
  const referenceOffers = world.flatMap((document) => (FAMILY_BUSINESSES[document.business?.type]?.products || [])
    .filter((product) => product.effects[need] > 0 && document.house?.owner !== home.owner)
    .map((product) => Number(document.business.prices?.[product.id] || product.price) / product.coveredResidents * state.residentCount));
  const catalogPrices = Object.values(FAMILY_BUSINESSES).flatMap((business) => business.products)
    .filter((product) => product.effects[need] > 0).map((product) => product.price / product.coveredResidents * state.residentCount);
  const prices = (referenceOffers.length ? referenceOffers : catalogPrices).sort((a, b) => a - b);
  const referencePrice = prices[Math.floor(prices.length / 2)] || 20;
  const restore = Math.max(0, FAMILY_RULES.crisisExitThreshold - state.needs[need]);
  return { id: `emergency_${need}`, name: `Emergency ${FAMILY_NEEDS[need].name} Support`, need,
    price: Math.ceil(referencePrice * 1.25), referencePrice, effects: { [need]: restore }, restore,
    delivery: 'emergency', coveredResidents: state.residentCount, stockUnits: state.familyConsumptionUnits,
    useLabel: 'Recover', availableSince: since + FAMILY_RULES.emergencyGraceMs };
}
