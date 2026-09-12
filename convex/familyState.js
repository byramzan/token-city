import { ConvexError } from 'convex/values';
import {
  FAMILY_RULES, FAMILY_NEEDS, NEED_KEYS, initialHousehold, calculateHousehold,
  rankBusinessOffers, emergencyOffer, familyResidents, consumptionUnits, floorCountFor, hasPlayerRecoveryOffer,
} from '../server/familyRules.js';

export const familyFail = (code) => { throw new ConvexError({ code }); };
export const validAccessKey = (key) => typeof key === 'string' && /^[A-Za-z0-9_+/=-]{32,256}$/.test(key);
export async function householdRow(ctx, householdId) {
  return ctx.db.query('households').withIndex('by_household', (q) => q.eq('householdId', householdId)).first();
}
export async function houseRow(ctx, houseId) {
  return ctx.db.query('houses').withIndex('by_house_id', (q) => q.eq('houseId', houseId)).first();
}
export async function authorizeHousehold(ctx, { accountId, houseId, accessKey }) {
  const row = await householdRow(ctx, houseId);
  if (!row || row.accountId !== accountId || !validAccessKey(accessKey) || row.accessKey !== accessKey) familyFail('household-access-denied');
  return row;
}
export async function authorizeExistingHome(ctx, houseId, accountId, accessKey) {
  const row = await householdRow(ctx, houseId);
  if (row && (row.accountId !== accountId || !validAccessKey(accessKey) || row.accessKey !== accessKey)) familyFail('household-access-denied');
  return row;
}
export async function ensureHousehold(ctx, house, accountId, accessKey, walletAddress) {
  const current = await householdRow(ctx, house.id);
  if (current) return authorizeHousehold(ctx, { houseId: house.id, accountId, accessKey });
  if (house.owner !== accountId || !validAccessKey(accessKey)) familyFail('household-access-denied');
  // New houses register this capability in their creation transaction. Legacy
  // worlds had no wallet ownership binding; first registration migrates that
  // compatibility data without ever importing client-supplied need values.
  const state = initialHousehold(house, Date.now());
  if (house.construction?.status === 'building' && !house.completedFloorCount) {
    state.residentCount = 0; state.familyConsumptionUnits = 0; state.constructing = true;
  }
  const id = await ctx.db.insert('households', {
    householdId: house.id, accountId, accessKey, ...(walletAddress ? { walletAddress } : {}), state, updatedAt: Date.now(),
  });
  return ctx.db.get(id);
}

function anonymousKey(value) {
  let hash = 2166136261;
  for (const ch of String(value)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
export async function analytics(ctx, state, eventId, eventType, data = {}) {
  const safeId = anonymousKey(eventId);
  if (await ctx.db.query('familyAnalytics').withIndex('by_event', (q) => q.eq('eventId', safeId)).first()) return;
  await ctx.db.insert('familyAnalytics', { eventId: safeId, eventType, at: Date.now(), cohort: state.residentCount, data });
}
function privateEvents(previous, next, now, explicit) {
  const events = [...(next.events || [])];
  const push = (type, data = {}) => events.push({ eventId: `${next.householdId}:${next.stateRevision}:${type}:${data.need || ''}`,
    householdId: next.householdId, stateRevision: next.stateRevision, serverTimestamp: now, type, ...data });
  for (const need of NEED_KEYS) for (const threshold of [30, 10, 0]) {
    if (previous.needs[need] > threshold && next.needs[need] <= threshold) push('need-threshold-crossed', { need, threshold, activeMs: next.activeMs });
  }
  if (previous.activeCrisisNeed !== next.activeCrisisNeed) push(!next.activeCrisisNeed ? 'crisis-ended' : !previous.activeCrisisNeed ? 'crisis-started' : 'active-crisis-changed', { need: next.activeCrisisNeed, previousNeed: previous.activeCrisisNeed });
  if (previous.residentCount !== next.residentCount) push('resident-count-changed', { residents: next.residentCount });
  if (explicit) push(explicit.type, explicit.data);
  return events.slice(-40);
}
export async function saveHousehold(ctx, row, input, explicit = null) {
  const now = Date.now();
  const next = calculateHousehold(input, now);
  next.stateRevision = row.state.stateRevision + 1;
  next.events = privateEvents(row.state, next, now, explicit);
  const newEvents = next.events.filter((event) => event.stateRevision === next.stateRevision);
  for (const event of newEvents) {
    await analytics(ctx, next, event.eventId, event.type, {
      ...(event.need ? { need: event.need } : {}), ...(event.threshold != null ? { threshold: event.threshold, activeMs: next.activeMs } : {}),
      ...(event.residents != null ? { residents: event.residents } : {}),
      ...(event.type === 'crisis-ended' ? { durationMs: now - (row.state.crisisStartedAt || now) } : {}),
    });
  }
  // Session-length samples contain only elapsed durations and family-size cohort.
  const activeDelta = next.activeMs - (row.state.activeMs || 0);
  if (activeDelta > 0) await analytics(ctx, next, `${next.householdId}:${next.stateRevision}:active`, 'active-session-length', { durationMs: activeDelta });
  await ctx.db.patch(row._id, { state: next, updatedAt: now });
  return { ...row, state: next, updatedAt: now };
}
export async function settleHousehold(ctx, row) {
  const house = await houseRow(ctx, row.householdId);
  let next = calculateHousehold(row.state, Date.now());
  if (house) {
    const completeFloors = house.document.house.completedFloorCount ?? floorCountFor(house.document.house);
    next.constructing = completeFloors === 0;
    next.floorCount = floorCountFor(house.document.house);
    next.residentCount = completeFloors ? familyResidents(completeFloors) : 0;
    next.familyConsumptionUnits = consumptionUnits(next.residentCount);
  }
  return saveHousehold(ctx, row, next);
}
export async function refreshAvailability(ctx, row) {
  const next = { ...row.state, unavailableSince: { ...row.state.unavailableSince } };
  const world = await ctx.db.query('houses').take(128);
  const home = world.find((entry) => entry.houseId === row.householdId)?.document.house;
  if (!home) return row;
  for (const need of NEED_KEYS) {
    const available = hasPlayerRecoveryOffer(world.map((entry) => entry.document), need, home, next);
    if (available) delete next.unavailableSince[need];
    else if (next.activeCrisisNeed === need && !next.unavailableSince[need]) {
      next.unavailableSince[need] = Date.now();
      await analytics(ctx, next, `${row.householdId}:${need}:${next.unavailableSince[need]}`, 'unavailable-stock', { need });
    }
  }
  await ctx.db.patch(row._id, { state: next });
  return { ...row, state: next };
}
export async function publicHousehold(ctx, row) {
  const state = calculateHousehold(row.state, Date.now());
  const worldRows = await ctx.db.query('houses').take(128);
  const world = worldRows.map((entry) => entry.document);
  const home = world.find((entry) => entry.house.id === row.householdId)?.house;
  const { sessions, offlineLoss, recentOperations, unavailableSince, ...view } = state;
  const recommendations = {};
  for (const need of NEED_KEYS) {
    const seen = new Set();
    recommendations[need] = home ? rankBusinessOffers(state, world, need, home, state.preferences || [])
      .filter((offer) => { if (seen.has(offer.houseId)) return false; seen.add(offer.houseId); return true; }).slice(0, 3) : [];
  }
  const rate = state.simulationState === 'active' ? 1 : state.simulationState === 'background' ? FAMILY_RULES.backgroundRate : FAMILY_RULES.offlineRate;
  return {
    ...view, inventory: view.inventory.filter((entry) => !entry.usedAt), services: view.services.filter((entry) => !entry.completedAt),
    serverTime: Date.now(), rules: FAMILY_RULES, recommendations,
    emergency: home ? emergencyOffer(state, world, home, Date.now()) : null,
    timeUntilZeroMs: Object.fromEntries(NEED_KEYS.map((need) => [need,
      state.simulationState === 'offline' && need === 'familyBond' ? null : Math.round(state.needs[need] / (100 / FAMILY_NEEDS[need].activeHours) * 3_600_000 / rate)])),
  };
}
