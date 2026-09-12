import { ConvexError, v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server.js';
import { internal } from './_generated/api.js';
import { constructionSecondsFor, floorExtensionCost } from '../src/config.js';
import { buildHouseDefinition, validateHouseDefinition, validatePlacement, defaultResidentialObjects, normalizeObjectInstance, migrateHouseInterior, SCHEMA_VERSION } from '../src/houseModel.js';
import {
  calculateHousehold, offerQuote, deliverRecovery, floorCountFor, familyResidents,
  consumptionUnits, emergencyOffer, applyRecovery,
} from '../server/familyRules.js';
import {
  authorizeExistingHome, authorizeHousehold, ensureHousehold, householdRow,
  saveHousehold, publicHousehold, refreshAvailability, analytics, validAccessKey,
} from './familyState.js';
import {
  normalizeBusiness,
  normalizeClientId,
  normalizeJoinDocuments,
  normalizeMarketplacePurchase,
  normalizeWorldDocument,
} from '../server/worldProtocol.js';
import { sameInteriorLayout } from '../server/interiorSnapshot.js';

const MAX_WORLD_HOUSES = 128;

function fail(code, document = null) {
  throw new ConvexError(document ? { code, document } : { code });
}

function publicDocument(row) {
  return {
    ...row.document,
    needs: null,
    version: row.version,
    updatedAt: row.updatedAt,
    originClientId: row.originClientId,
    eventId: `${row.document.house.id}:${row.version}`,
    stateRevision: row.version,
    serverTimestamp: row.updatedAt,
  };
}

async function rowByHouseId(ctx, houseId) {
  return ctx.db.query('houses')
    .withIndex('by_house_id', (q) => q.eq('houseId', houseId))
    .first();
}

async function rowByPlot(ctx, plotIndex) {
  return ctx.db.query('houses')
    .withIndex('by_plot', (q) => q.eq('plotIndex', plotIndex))
    .first();
}

async function rowByName(ctx, lowerName) {
  return ctx.db.query('houses')
    .withIndex('by_name', (q) => q.eq('lowerName', lowerName))
    .first();
}

async function paymentBySessionId(ctx, sessionId) {
  return ctx.db.query('paymentSessions')
    .withIndex('by_session_id', (q) => q.eq('sessionId', sessionId))
    .first();
}

function paymentText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

export const migrateFamilyInteriors = internalMutation({
  args: {}, handler: async (ctx) => {
    const rows = await ctx.db.query('houses').take(MAX_WORLD_HOUSES);
    let migrated = 0;
    for (const row of rows) {
      if (row.document.definition?.schemaVersion === SCHEMA_VERSION) continue;
      const source = row.document;
      const result = migrateHouseInterior({ ...source.house, houseDefinition: source.definition }, source.placements?.objects || [], source.interiorInventory || []);
      const legacy = Object.values(source.interior?.slots || {}).flat().filter((id) => typeof id === 'string');
      const house = { ...source.house, height: 'one', floorCount: result.floorCount, completedFloorCount: result.floorCount,
        residentCount: result.residentCount, schemaVersion: SCHEMA_VERSION };
      const version = row.version + 1, updatedAt = Date.now();
      const document = { ...source, house, definition: result.definition, needs: null,
        placements: { revision: (source.placements?.revision || 0) + 1, objects: result.objects },
        interiorInventory: [...result.inventory, ...legacy], interior: { ...source.interior, slots: {} }, version, updatedAt };
      await ctx.db.patch(row._id, { document, version, updatedAt, originClientId: 'server_migration_v4' });
      migrated++;
    }
    return { migrated };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('houses').take(MAX_WORLD_HOUSES);
    rows.sort((a, b) => (
      Number(a.document?.house?.builtAt || 0) - Number(b.document?.house?.builtAt || 0)
      || a.houseId.localeCompare(b.houseId)
    ));
    return rows.map(publicDocument);
  },
});

// Imports pre-multiplayer local saves once. Existing canonical records always win,
// so opening an older tab cannot roll the shared city back.
export const join = mutation({
  args: {
    clientId: v.string(),
    documents: v.array(v.any()),
    accountId: v.optional(v.string()),
    accessKey: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    if (!clientId) fail('invalid-client-id');
    let documents;
    try { documents = normalizeJoinDocuments(args.documents); }
    catch { documents = []; }

    let inserted = 0;
    for (const candidate of documents) {
      const count = await ctx.db.query('houses').take(MAX_WORLD_HOUSES + 1);
      if (count.length >= MAX_WORLD_HOUSES) break;
      const houseId = candidate.house.id;
      const plotIndex = candidate.house.plot.i;
      const lowerName = candidate.house.name.toLocaleLowerCase();
      if (await rowByHouseId(ctx, houseId)) continue;
      if (await rowByPlot(ctx, plotIndex)) continue;
      if (await rowByName(ctx, lowerName)) continue;
      const version = Math.max(1, Number(candidate.version) || 1);
      const updatedAt = Math.max(Date.now(), Number(candidate.updatedAt) || 0);
      const document = { ...candidate, version, updatedAt };
      await ctx.db.insert('houses', {
        houseId,
        plotIndex,
        lowerName,
        version,
        updatedAt,
        originClientId: clientId,
        document,
      });
      if (args.accountId === candidate.house.owner && validAccessKey(args.accessKey)) {
        await ensureHousehold(ctx, candidate.house, args.accountId, args.accessKey, args.walletAddress);
      }
      inserted += 1;
    }
    return { inserted };
  },
});

export const create = mutation({
  args: {
    clientId: v.string(),
    document: v.any(),
    accessKey: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    if (!clientId) fail('invalid-client-id');
    let candidate;
    try { candidate = normalizeWorldDocument(args.document); }
    catch (error) { fail(error?.message || 'invalid-document'); }

    const existing = await rowByHouseId(ctx, candidate.house.id);
    if (existing) {
      if (existing.document.house.owner !== candidate.house.owner) fail('house-id-taken');
      await authorizeExistingHome(ctx, existing.houseId, candidate.house.owner, args.accessKey);
      return publicDocument(existing);
    }
    if (!validAccessKey(args.accessKey)) fail('household-access-denied');
    const ownersHomes = (await ctx.db.query('houses').take(MAX_WORLD_HOUSES + 1)).filter((row) => row.document.house.owner === candidate.house.owner);
    if (ownersHomes.length) fail('one-family-house-per-account');
    const existingCount = await ctx.db.query('houses').take(MAX_WORLD_HOUSES + 1);
    if (existingCount.length >= MAX_WORLD_HOUSES) fail('world-full');
    if (await rowByHouseId(ctx, candidate.house.id)) fail('house-id-taken');
    if (await rowByPlot(ctx, candidate.house.plot.i)) fail('plot-taken');
    const lowerName = candidate.house.name.toLocaleLowerCase();
    if (await rowByName(ctx, lowerName)) fail('name-taken');

    const version = 1;
    const updatedAt = Date.now();
    const construction = { status: 'building', eventId: `${candidate.house.id}:initial-build`, startedAt: updatedAt,
      completesAt: updatedAt + constructionSecondsFor(candidate.house) * 1000, targetFloorCount: floorCountFor(candidate.house) };
    const house = { ...candidate.house, completedFloorCount: 0, residentCount: 0, construction };
    const definition = buildHouseDefinition(house);
    const initialObjects = defaultResidentialObjects(definition);
    const document = { ...candidate, house, definition, placements: { revision: 1, objects: initialObjects }, needs: null, version, updatedAt };
    await ctx.db.insert('houses', {
      houseId: candidate.house.id,
      plotIndex: candidate.house.plot.i,
      lowerName,
      version,
      updatedAt,
      originClientId: clientId,
      document,
    });
    await ensureHousehold(ctx, house, house.owner, args.accessKey, args.walletAddress);
    await ctx.scheduler.runAt(construction.completesAt, internal.world.finishConstruction, { houseId: house.id, eventId: construction.eventId });
    return publicDocument({ document, version, updatedAt, originClientId: clientId });
  },
});

export const update = mutation({
  args: {
    clientId: v.string(),
    document: v.any(),
    baseVersion: v.number(),
    basePlacementsRevision: v.optional(v.number()),
    accessKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    if (!clientId) fail('invalid-client-id');
    let candidate;
    try { candidate = normalizeWorldDocument(args.document); }
    catch (error) { fail(error?.message || 'invalid-document'); }

    const current = await rowByHouseId(ctx, candidate.house.id);
    if (!current) fail('house-not-found');
    await authorizeExistingHome(ctx, candidate.house.id, current.document.house.owner, args.accessKey);
    const sameInterior = args.basePlacementsRevision !== undefined
      && (current.document.placements?.revision || 0) === args.basePlacementsRevision;
    const replayedInterior = JSON.stringify(candidate.placements.objects) === JSON.stringify(current.document.placements?.objects)
      && candidate.placements.revision === current.document.placements?.revision;
    if (args.basePlacementsRevision !== undefined && !sameInterior && !replayedInterior) {
      fail('interior-revision-conflict', publicDocument(current));
    }
    if (current.version !== Math.trunc(args.baseVersion) && !sameInterior && !replayedInterior) {
      fail('revision-conflict', publicDocument(current));
    }
    if (candidate.house.owner !== current.document.house.owner) fail('owner-immutable');
    if (floorCountFor(candidate.house) !== floorCountFor(current.document.house)) fail('use-add-floor');
    const canonicalDefinition = buildHouseDefinition(candidate.house);
    if (validateHouseDefinition(canonicalDefinition).length) fail('invalid-house-layout');
    const canonicalObjects = [];
    for (const input of candidate.placements.objects) {
      const object = normalizeObjectInstance(canonicalDefinition, input, canonicalObjects.length);
      const result = validatePlacement(canonicalDefinition, canonicalObjects, object);
      if (!result.ok) fail(result.reason);
      canonicalObjects.push(object);
    }

    // task8 §21.4: a valid update that changes nothing is an idempotent no-op.
    // An older client that still posts an empty or identical patch gets the
    // canonical revision back instead of a generic server error, and no new
    // revision or duplicate realtime event is created.
    if (sameInteriorLayout(canonicalObjects, current.document.placements?.objects)
      && JSON.stringify(candidate.house) === JSON.stringify(current.document.house)
      && JSON.stringify(candidate.interior || {}) === JSON.stringify(current.document.interior || {})) {
      return { ...publicDocument(current), status: 'NO_CHANGES', revision: current.document.placements?.revision || 0 };
    }

    const plotIndex = candidate.house.plot.i;
    const lowerName = candidate.house.name.toLocaleLowerCase();
    const plotOwner = await rowByPlot(ctx, plotIndex);
    if (plotOwner && plotOwner._id !== current._id) fail('plot-taken');
    const nameOwner = await rowByName(ctx, lowerName);
    if (nameOwner && nameOwner._id !== current._id) fail('name-taken');

    const version = current.version + 1;
    const updatedAt = Date.now();
    const document = {
      ...candidate,
      definition: canonicalDefinition,
      placements: { ...candidate.placements, objects: canonicalObjects },
      house: { ...candidate.house, floorCount: floorCountFor(current.document.house),
        completedFloorCount: current.document.house.completedFloorCount ?? floorCountFor(current.document.house),
        residentCount: current.document.house.residentCount ?? familyResidents(floorCountFor(current.document.house)),
        construction: current.document.house.construction ?? null },
      // These fields are driven by each browser's ambient town simulation.
      // Preserve the canonical values while synchronizing player-authored
      // house geometry and interior placements.
      business: current.document.business ?? null,
      needs: null,
      links: current.document.links ?? [],
      version,
      updatedAt,
    };
    await ctx.db.patch(current._id, {
      plotIndex,
      lowerName,
      version,
      updatedAt,
      originClientId: clientId,
      document,
    });
    const family = await householdRow(ctx, candidate.house.id);
    if (family) await saveHousehold(ctx, family, family.state, { type: 'floor-interior-saved', data: { houseRevision: version } });
    return publicDocument({ document, version, updatedAt, originClientId: clientId });
  },
});

// Storefront changes use their own revision-checked mutation. They cannot be
// overwritten by ambient resident simulation or by a stale browser tab.
export const setBusiness = mutation({
  args: {
    clientId: v.string(),
    accountId: v.string(),
    houseId: v.string(),
    business: v.any(),
    baseVersion: v.number(),
    accessKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    const accountId = normalizeClientId(args.accountId);
    const houseId = normalizeClientId(args.houseId);
    if (!clientId || !accountId || !houseId) fail('invalid-business-request');
    const current = await rowByHouseId(ctx, houseId);
    if (!current) fail('house-not-found');
    if (current.document.house.owner !== accountId) fail('not-business-owner');
    await authorizeExistingHome(ctx, houseId, accountId, args.accessKey);
    if (current.version !== Math.trunc(args.baseVersion)) {
      fail('revision-conflict', publicDocument(current));
    }
    let business;
    try {
      business = normalizeBusiness(args.business, {
        material: current.document.house.material,
        existingType: current.document.business?.type || null,
      });
    } catch (error) {
      fail(error?.message || 'invalid-business');
    }

    const version = current.version + 1;
    const updatedAt = Date.now();
    const document = { ...current.document, business, version, updatedAt };
    await ctx.db.patch(current._id, {
      version,
      updatedAt,
      originClientId: clientId,
      document,
    });
    return publicDocument({ document, version, updatedAt, originClientId: clientId });
  },
});

// Business edits are commands rather than full-document replacements. Convex
// retries each command against the latest row, so unrelated house changes,
// purchases and other tabs cannot cause revision conflicts or lost stock.
export const changeBusiness = mutation({
  args: {
    clientId: v.string(),
    operationId: v.string(),
    accountId: v.string(),
    houseId: v.string(),
    action: v.string(),
    business: v.optional(v.any()),
    productId: v.optional(v.string()),
    amount: v.optional(v.number()),
    value: v.optional(v.any()),
    accessKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    const operationId = normalizeClientId(args.operationId);
    const accountId = normalizeClientId(args.accountId);
    const houseId = normalizeClientId(args.houseId);
    if (!clientId || !operationId || !accountId || !houseId) fail('invalid-business-request');
    const current = await rowByHouseId(ctx, houseId);
    if (!current) fail('house-not-found');
    if (current.document.house.owner !== accountId) fail('not-business-owner');
    await authorizeExistingHome(ctx, houseId, accountId, args.accessKey);

    const duplicate = await ctx.db.query('businessOperations')
      .withIndex('by_operation_id', (q) => q.eq('operationId', operationId))
      .first();
    if (duplicate) return { document: publicDocument(current), applied: true, duplicate: true };

    const action = paymentText(args.action, 24);
    let business;
    if (action === 'create') {
      if (current.document.business) {
        return { document: publicDocument(current), applied: false, reason: 'business-already-exists' };
      }
      try {
        business = normalizeBusiness(args.business, { material: current.document.house.material });
      } catch (error) { fail(error?.message || 'invalid-business'); }
    } else {
      try {
        business = normalizeBusiness(current.document.business, {
          material: current.document.house.material,
          existingType: current.document.business?.type || null,
        });
      } catch { fail('business-not-found', publicDocument(current)); }
      const productId = normalizeClientId(args.productId || '');
      if (action === 'restock') {
        const amount = Math.trunc(Number(args.amount));
        if (!productId || !(productId in business.stock) || amount < 1 || amount > 100) {
          fail('invalid-restock');
        }
        business.stock[productId] = Math.min(1_000_000, business.stock[productId] + amount);
      } else if (action === 'price') {
        if (!productId || !(productId in business.prices)) fail('invalid-product');
        const candidate = { ...business, prices: { ...business.prices, [productId]: args.value } };
        try {
          business = normalizeBusiness(candidate, {
            material: current.document.house.material,
            existingType: business.type,
          });
        } catch (error) { fail(error?.message || 'invalid-price'); }
      } else if (action === 'status') {
        if (!['open', 'closed'].includes(args.value)) fail('invalid-business-status');
        business.status = args.value;
      } else {
        fail('invalid-business-action');
      }
    }

    const version = current.version + 1;
    const updatedAt = Date.now();
    const document = { ...current.document, business, version, updatedAt };
    await ctx.db.patch(current._id, {
      version,
      updatedAt,
      originClientId: clientId,
      document,
    });
    await ctx.db.insert('businessOperations', {
      operationId,
      houseId,
      accountId,
      action,
      createdAt: updatedAt,
    });
    return {
      document: publicDocument({ document, version, updatedAt, originClientId: clientId }),
      applied: true,
      duplicate: false,
    };
  },
});

// The stock check, decrement and trade receipt are one Convex transaction.
// Two buyers therefore cannot purchase the same last item from different tabs.
export const purchaseProduct = mutation({
  args: {
    clientId: v.string(),
    buyerId: v.string(),
    houseId: v.string(),
    productId: v.string(),
    purchaseKey: v.string(),
    expectedPrice: v.number(),
    fee: v.number(),
    householdId: v.string(),
    accessKey: v.string(),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    if (!clientId) fail('invalid-client-id');
    let purchase;
    try { purchase = normalizeMarketplacePurchase(args); }
    catch (error) { fail(error?.message || 'invalid-purchase'); }

    let family = await authorizeHousehold(ctx, { houseId: args.householdId, accountId: purchase.buyerId, accessKey: args.accessKey });
    const duplicate = await ctx.db.query('trades')
      .withIndex('by_purchase_key', (q) => q.eq('purchaseKey', purchase.purchaseKey))
      .first();
    if (duplicate) {
      if (duplicate.buyerId !== purchase.buyerId || duplicate.houseId !== purchase.houseId || duplicate.productId !== purchase.productId) fail('purchase-key-conflict');
      const current = await rowByHouseId(ctx, duplicate.houseId);
      return { trade: duplicate, document: current ? publicDocument(current) : null, household: await publicHousehold(ctx, family), duplicate: true };
    }

    const current = await rowByHouseId(ctx, purchase.houseId);
    if (!current) fail('house-not-found');
    const sellerId = current.document.house.owner;
    if (sellerId === purchase.buyerId) fail('self-trade');
    let business;
    try {
      business = normalizeBusiness(current.document.business, {
        material: current.document.house.material,
        existingType: current.document.business?.type || null,
      });
    } catch { fail('business-not-found', publicDocument(current)); }
    if (business.status !== 'open') fail('business-closed', publicDocument(current));
    if (!(purchase.productId in business.stock)) fail('product-not-found', publicDocument(current));
    if (business.prices[purchase.productId] !== purchase.expectedPrice) {
      fail('price-changed', publicDocument(current));
    }
    const familyState = calculateHousehold(family.state, Date.now());
    if (!familyState.residentCount) fail('family-construction-in-progress');
    const quote = offerQuote(familyState, business, purchase.productId);
    if (!quote.allowed) fail(quote.reason);
    business.stock[purchase.productId] -= quote.stockUnits;
    business.visitors += 1;
    if (!business.uniq[purchase.buyerId]) {
      business.uniq[purchase.buyerId] = true;
      business.reputation += 2;
    }
    business.reputation += 1;
    business.level = 1 + Math.floor(Math.min(Object.keys(business.uniq).length, business.reputation / 12));
    const version = current.version + 1;
    const updatedAt = Date.now();
    const document = { ...current.document, business, version, updatedAt };
    await ctx.db.patch(current._id, {
      version,
      updatedAt,
      originClientId: clientId,
      document,
    });
    const tradeId = await ctx.db.insert('trades', {
      purchaseKey: purchase.purchaseKey,
      buyerId: purchase.buyerId,
      sellerId,
      houseId: purchase.houseId,
      productId: purchase.productId,
      gross: purchase.expectedPrice,
      fee: purchase.fee,
      net: purchase.expectedPrice - purchase.fee,
      createdAt: updatedAt,
    });
    const trade = await ctx.db.get(tradeId);
    family = await saveHousehold(ctx, family, deliverRecovery(familyState, quote.product, purchase.purchaseKey, updatedAt, purchase.houseId), {
      type: quote.product.delivery === 'service' ? 'service-started' : 'product-delivered', data: { productId: quote.product.id },
    });
    family = await refreshAvailability(ctx, family);
    await analytics(ctx, family.state, purchase.purchaseKey, 'recovery-purchase', { need: quote.product.need,
      businessType: business.type, playerBusiness: true, stockUnits: quote.stockUnits, price: purchase.expectedPrice,
      coveredResidents: quote.product.coveredResidents });
    return {
      trade,
      household: await publicHousehold(ctx, family),
      document: publicDocument({ document, version, updatedAt, originClientId: clientId }),
      duplicate: false,
    };
  },
});

export const recentTrades = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('trades').order('desc').take(512);
    rows.reverse();
    return rows;
  },
});

// Construction completion is derived from the target floor count, never an
// increment. Scheduler retries and websocket replays cannot duplicate people.
async function finishConstructionRecord(ctx, houseId, eventId) {
  const current = await rowByHouseId(ctx, houseId);
  if (!current) return null;
  const construction = current.document.house.construction;
  if (!construction || construction.status !== 'building' || construction.eventId !== eventId) return publicDocument(current);
  if (Date.now() < construction.completesAt) fail('construction-not-ready');
  const floors = construction.targetFloorCount;
  const house = { ...current.document.house, floorCount: floors, completedFloorCount: floors,
    residentCount: familyResidents(floors), construction: { ...construction, status: 'completed', completedAt: Date.now() } };
  const version = current.version + 1;
  const updatedAt = Date.now();
  const document = { ...current.document, house, definition: buildHouseDefinition(house), version, updatedAt };
  await ctx.db.patch(current._id, { document, version, updatedAt });
  let family = await householdRow(ctx, houseId);
  if (family) {
    const state = calculateHousehold(family.state, updatedAt);
    state.constructing = false;
    state.floorCount = floors;
    state.residentCount = familyResidents(floors);
    state.familyConsumptionUnits = consumptionUnits(state.residentCount);
    family = await saveHousehold(ctx, family, state, { type: 'construction-completed', data: { floorCount: floors } });
    await analytics(ctx, state, eventId, 'floor-count-distribution', { floorCount: floors, laterAddition: construction.kind === 'extension' });
  }
  return publicDocument({ ...current, document, version, updatedAt });
}
export const finishConstruction = internalMutation({
  args: { houseId: v.string(), eventId: v.string() },
  handler: (ctx, args) => finishConstructionRecord(ctx, args.houseId, args.eventId),
});
export const completeConstruction = mutation({
  args: { accountId: v.string(), houseId: v.string(), accessKey: v.string(), eventId: v.string() },
  handler: async (ctx, args) => {
    await authorizeHousehold(ctx, args);
    return finishConstructionRecord(ctx, args.houseId, args.eventId);
  },
});
export const addFloor = mutation({
  args: { clientId: v.string(), accountId: v.string(), houseId: v.string(), accessKey: v.string(), eventId: v.string(), baseFloorCount: v.number() },
  handler: async (ctx, args) => {
    const family = await authorizeHousehold(ctx, args);
    const current = await rowByHouseId(ctx, args.houseId);
    if (!current) fail('house-not-found');
    const duplicate = await ctx.db.query('householdOperations').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).first();
    if (duplicate) {
      if (duplicate.householdId !== args.houseId) fail('event-id-conflict');
      return { document: publicDocument(current), duplicate: true };
    }
    if (current.document.house.construction?.status === 'building') fail('construction-in-progress');
    const previousCount = floorCountFor(current.document.house);
    if (previousCount !== Math.trunc(args.baseFloorCount)) fail('floor-count-changed');
    if (previousCount >= 5) fail('maximum-five-floors');
    const now = Date.now();
    const construction = { status: 'building', kind: 'extension', eventId: args.eventId, startedAt: now,
      completesAt: now + 6_000, targetFloorCount: previousCount + 1 };
    const house = { ...current.document.house, floorCount: previousCount + 1, completedFloorCount: previousCount,
      residentCount: familyResidents(previousCount), construction, revision: (current.document.house.revision || 0) + 1 };
    const definition = buildHouseDefinition(house);
    const definitionValidation = validateHouseDefinition(definition);
    if (definitionValidation.length) fail('new-floor-layout-invalid');
    const objects = current.document.placements?.objects || [];
    for (const object of objects) {
      const placement = validatePlacement(definition, objects.filter((other) => other !== object), object);
      if (!placement.ok) fail('clear-stair-zone-before-extension');
    }
    const version = current.version + 1;
    const newObjects = [...objects, ...defaultResidentialObjects(definition, { fromFloorIndex: previousCount })];
    const document = { ...current.document, house, definition, placements: { ...current.document.placements,
      revision: (current.document.placements?.revision || 0) + 1, objects: newObjects }, version, updatedAt: now };
    await ctx.db.patch(current._id, { document, version, updatedAt: now, originClientId: args.clientId });
    await ctx.db.insert('householdOperations', { eventId: args.eventId, householdId: args.houseId, kind: 'add-floor', at: now,
      result: { targetFloorCount: previousCount + 1 } });
    await analytics(ctx, family.state, args.eventId, 'later-floor-addition', { floorCount: previousCount + 1, cost: floorExtensionCost(current.document.house) });
    await ctx.scheduler.runAt(construction.completesAt, internal.world.finishConstruction, { houseId: args.houseId, eventId: args.eventId });
    return { document: publicDocument({ ...current, document, version, updatedAt: now, originClientId: args.clientId }), duplicate: false };
  },
});

// The existing ledger consumes the returned trade receipt; this gameplay
// endpoint neither mints coins nor changes reserve/withdrawal accounting.
export const purchaseEmergency = mutation({
  args: { clientId: v.string(), accountId: v.string(), houseId: v.string(), accessKey: v.string(), purchaseKey: v.string(), expectedPrice: v.number(), fee: v.number() },
  handler: async (ctx, args) => {
    let family = await authorizeHousehold(ctx, args);
    const duplicate = await ctx.db.query('trades').withIndex('by_purchase_key', (q) => q.eq('purchaseKey', args.purchaseKey)).first();
    if (duplicate) {
      if (duplicate.buyerId !== args.accountId || duplicate.sellerId !== 'city_emergency') fail('purchase-key-conflict');
      return { trade: duplicate, household: await publicHousehold(ctx, family), duplicate: true };
    }
    const current = await rowByHouseId(ctx, args.houseId);
    const world = (await ctx.db.query('houses').take(MAX_WORLD_HOUSES)).map((row) => row.document);
    const state = calculateHousehold(family.state, Date.now());
    const offer = emergencyOffer(state, world, current.document.house, Date.now());
    if (!offer) fail('emergency-offer-unavailable');
    if (offer.price !== args.expectedPrice) fail('price-changed');
    if (!Number.isInteger(args.fee) || args.fee < 0 || args.fee >= offer.price) fail('invalid-fee');
    const tradeId = await ctx.db.insert('trades', { purchaseKey: args.purchaseKey, buyerId: args.accountId, sellerId: 'city_emergency',
      houseId: 'city_emergency', productId: offer.id, gross: offer.price, fee: args.fee, net: offer.price - args.fee, createdAt: Date.now() });
    family = await saveHousehold(ctx, family, applyRecovery(state, offer, Date.now()), { type: 'emergency-recovery', data: { need: offer.need } });
    await analytics(ctx, family.state, args.purchaseKey, 'emergency-offer-activation', { need: offer.need, price: offer.price, playerBusiness: false });
    family = await refreshAvailability(ctx, family);
    return { trade: await ctx.db.get(tradeId), household: await publicHousehold(ctx, family), duplicate: false };
  },
});

// Each funding attempt has one disposable server record. Starting a new one
// atomically closes every unfinished attempt for the same game account.
export const beginPayment = mutation({
  args: {
    clientId: v.string(),
    sessionId: v.string(),
    accountId: v.string(),
    walletAddress: v.string(),
    quoteId: v.string(),
    coins: v.number(),
    tokens: v.number(),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeClientId(args.clientId);
    const sessionId = normalizeClientId(args.sessionId);
    const accountId = normalizeClientId(args.accountId);
    const walletAddress = paymentText(args.walletAddress, 64);
    const quoteId = paymentText(args.quoteId, 80);
    const coins = Math.trunc(Number(args.coins));
    const tokens = Math.trunc(Number(args.tokens));
    // task8 §3: an EVM address is 0x + 40 hex characters. The old Base58 test
    // rejected every Robinhood Chain wallet. Historical Solana addresses are
    // still accepted so past sessions remain readable.
    const evmAddress = /^0x[0-9a-fA-F]{40}$/.test(walletAddress);
    const legacySolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(walletAddress);
    if (!clientId || !sessionId || !accountId || !(evmAddress || legacySolanaAddress)
        || !/^q_[a-zA-Z0-9_-]{4,76}$/.test(quoteId)
        || coins <= 0 || tokens <= 0 || coins > 10_000_000 || tokens > 1_000_000_000_000) {
      fail('invalid-payment-session');
    }
    const duplicate = await paymentBySessionId(ctx, sessionId);
    if (duplicate) return duplicate;

    const now = Date.now();
    const previous = await ctx.db.query('paymentSessions')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect();
    for (const session of previous) {
      if (session.status === 'open') {
        await ctx.db.patch(session._id, {
          status: 'cancelled',
          updatedAt: now,
          closeReason: 'replaced-by-new-attempt',
        });
      }
    }
    const id = await ctx.db.insert('paymentSessions', {
      sessionId,
      clientId,
      accountId,
      walletAddress,
      quoteId,
      coins,
      tokens,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 5 * 60_000,
    });
    return ctx.db.get(id);
  },
});

export const completePayment = mutation({
  args: { sessionId: v.string(), accountId: v.string(), signature: v.string() },
  handler: async (ctx, args) => {
    const sessionId = normalizeClientId(args.sessionId);
    const accountId = normalizeClientId(args.accountId);
    const signature = paymentText(args.signature, 120);
    if (!sessionId || !accountId || signature.length < 12) fail('invalid-payment-completion');
    const session = await paymentBySessionId(ctx, sessionId);
    if (!session || session.accountId !== accountId) fail('payment-session-not-found');
    if (session.status === 'completed') return session;
    if (session.status !== 'open') fail('payment-session-closed');
    await ctx.db.patch(session._id, {
      status: 'completed', signature, updatedAt: Date.now(), closeReason: 'confirmed',
    });
    return ctx.db.get(session._id);
  },
});

export const cancelPayment = mutation({
  args: { sessionId: v.string(), accountId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const sessionId = normalizeClientId(args.sessionId);
    const accountId = normalizeClientId(args.accountId);
    if (!sessionId || !accountId) fail('invalid-payment-cancellation');
    const session = await paymentBySessionId(ctx, sessionId);
    if (!session || session.accountId !== accountId) return null;
    if (session.status !== 'open') return session;
    await ctx.db.patch(session._id, {
      status: 'cancelled',
      updatedAt: Date.now(),
      closeReason: paymentText(args.reason, 100) || 'cancelled',
    });
    return ctx.db.get(session._id);
  },
});

export const verificationPayment = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    if (!args.sessionId.startsWith('verify_')) return null;
    return paymentBySessionId(ctx, args.sessionId);
  },
});

export const removeVerificationPayment = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    if (!args.sessionId.startsWith('verify_')) fail('verification-only');
    const session = await paymentBySessionId(ctx, args.sessionId);
    if (session) await ctx.db.delete(session._id);
    return { removed: Boolean(session) };
  },
});

// Verification clients use a reserved prefix and clean up only their own
// temporary records. Normal game houses can never be removed through this API.
export const removeVerificationHouse = mutation({
  args: { houseId: v.string() },
  handler: async (ctx, args) => {
    if (!args.houseId.startsWith('verify_')) fail('verification-only');
    const row = await rowByHouseId(ctx, args.houseId);
    if (row) await ctx.db.delete(row._id);
    const family = await householdRow(ctx, args.houseId);
    if (family) await ctx.db.delete(family._id);
    const familyOperations = await ctx.db.query('householdOperations').withIndex('by_household', (q) => q.eq('householdId', args.houseId)).collect();
    for (const operation of familyOperations) await ctx.db.delete(operation._id);
    const trades = await ctx.db.query('trades').collect();
    for (const trade of trades) {
      if (trade.houseId === args.houseId) await ctx.db.delete(trade._id);
    }
    const operations = await ctx.db.query('businessOperations')
      .withIndex('by_house', (q) => q.eq('houseId', args.houseId))
      .collect();
    for (const operation of operations) await ctx.db.delete(operation._id);
    return { removed: Boolean(row) };
  },
});
