import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server.js';
import {
  FAMILY_RULES, updatePresence, calculateHousehold, offerQuote, useStoredRecovery,
} from '../server/familyRules.js';
import {
  familyFail, houseRow, ensureHousehold, authorizeHousehold, saveHousehold,
  settleHousehold, refreshAvailability, publicHousehold, analytics,
} from './familyState.js';

const accessArgs = { accountId: v.string(), houseId: v.string(), accessKey: v.string() };
const presenceArgs = { ...accessArgs, clientId: v.string(), visibility: v.union(v.literal('active'), v.literal('background'), v.literal('offline')) };
export const open = mutation({
  args: { ...presenceArgs, walletAddress: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const home = await houseRow(ctx, args.houseId);
    if (!home) familyFail('house-not-found');
    let row = await ensureHousehold(ctx, home.document.house, args.accountId, args.accessKey, args.walletAddress);
    row = await saveHousehold(ctx, row, updatePresence(row.state, args, Date.now()));
    row = await refreshAvailability(ctx, row);
    return publicHousehold(ctx, row);
  },
});
export const current = query({
  args: accessArgs,
  handler: async (ctx, args) => publicHousehold(ctx, await authorizeHousehold(ctx, args)),
});
export const presence = mutation({
  args: presenceArgs,
  handler: async (ctx, args) => {
    let row = await authorizeHousehold(ctx, args);
    row = await saveHousehold(ctx, row, updatePresence(row.state, args, Date.now()));
    row = await refreshAvailability(ctx, row);
    return publicHousehold(ctx, row);
  },
});
export const quote = query({
  args: { ...accessArgs, sellerHouseId: v.string(), productId: v.string() },
  handler: async (ctx, args) => {
    const row = await authorizeHousehold(ctx, args);
    const state = calculateHousehold(row.state, Date.now());
    if (!state.residentCount) return { allowed: false, reason: 'The family moves in when construction completes.' };
    const seller = await houseRow(ctx, args.sellerHouseId);
    if (!seller) return { allowed: false, reason: 'This business is no longer available.' };
    if (seller.document.house.owner === args.accountId) return { allowed: false, reason: 'Choose another player’s business.' };
    return { ...offerQuote(state, seller.document.business, args.productId), stateRevision: state.stateRevision, serverTime: Date.now() };
  },
});
async function use(ctx, args, service) {
  let row = await authorizeHousehold(ctx, args);
  const prior = await ctx.db.query('householdOperations').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).first();
  if (prior) {
    if (prior.householdId !== args.houseId) familyFail('event-id-conflict');
    return { household: await publicHousehold(ctx, row), duplicate: true };
  }
  let result;
  try { result = useStoredRecovery(row.state, service ? args.serviceId : args.itemId, Date.now(), service); }
  catch (error) { familyFail(error.message); }
  row = await saveHousehold(ctx, row, result.state, result.duplicate ? null : {
    type: service ? 'service-completed' : 'product-used', data: { itemId: service ? args.serviceId : args.itemId },
  });
  row = await refreshAvailability(ctx, row);
  await ctx.db.insert('householdOperations', { eventId: args.eventId, householdId: args.houseId,
    kind: service ? 'service' : 'product', at: Date.now(), result: { duplicate: result.duplicate } });
  return { household: await publicHousehold(ctx, row), duplicate: result.duplicate };
}
export const useItem = mutation({
  args: { ...accessArgs, itemId: v.string(), eventId: v.string() },
  handler: (ctx, args) => use(ctx, args, false),
});
export const completeService = mutation({
  args: { ...accessArgs, serviceId: v.string(), eventId: v.string() },
  handler: (ctx, args) => use(ctx, args, true),
});
export const setPreference = mutation({
  args: { ...accessArgs, businessHouseId: v.string(), preferred: v.boolean() },
  handler: async (ctx, args) => {
    let row = await authorizeHousehold(ctx, args);
    const preferences = new Set(row.state.preferences || []);
    if (args.preferred) preferences.add(args.businessHouseId); else preferences.delete(args.businessHouseId);
    row = await saveHousehold(ctx, row, { ...row.state, preferences: [...preferences].slice(-30) });
    return publicHousehold(ctx, row);
  },
});
export const recordPlacementFailure = mutation({
  args: { ...accessArgs, eventId: v.string(), reason: v.string(), floorId: v.string() },
  handler: async (ctx, args) => {
    const row = await authorizeHousehold(ctx, args);
    await analytics(ctx, row.state, args.eventId, 'furniture-slot-placement-failure', { reason: args.reason.slice(0, 120), floorId: args.floorId.slice(0, 40) });
    return { recorded: true };
  },
});

// Minute-level simulation persists threshold crossings even when the browser
// sleeps; each row uses its own leases, so websocket frequency is never time.
export const tick = internalMutation({
  args: {}, handler: async (ctx) => {
    const rows = await ctx.db.query('households').take(256);
    for (const input of rows) {
      // A saturated offline period no longer needs writes until the next load.
      const state = calculateHousehold(input.state, Date.now());
      const changed = Object.keys(state.needs).some((key) => state.needs[key] !== input.state.needs[key]);
      const readyService = state.services.some((entry) => !entry.completedAt && entry.completeAt <= Date.now());
      if (!changed && !readyService && !state.activeCrisisNeed) continue;
      let row = await settleHousehold(ctx, input);
      row = await refreshAvailability(ctx, row);
    }
    return { intervalMs: FAMILY_RULES.tickMs, households: rows.length };
  },
});
