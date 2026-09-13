const MAX_DOCUMENT_BYTES = 512 * 1024;
const MAX_HOUSES_PER_MESSAGE = 96;
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

import { FAMILY_BUSINESSES, FAMILY_BUSINESS_MATERIALS, floorCountFor } from './familyRules.js';
const BUSINESS_PRODUCTS = Object.fromEntries(Object.entries(FAMILY_BUSINESSES).map(([id, business]) => [id,
  Object.fromEntries(business.products.map((product) => [product.id, product.price]))]));
const BUSINESS_MATERIALS = Object.fromEntries(Object.entries(FAMILY_BUSINESS_MATERIALS).map(([id, types]) => [id, new Set(types)]));

const HOUSE_ENUMS = Object.freeze({
  foundation: new Set(['compact', 'wide', 'lshape']),
  height: new Set(['one', 'two', 'attic']),
  material: new Set(['wood', 'brick', 'stone', 'tech']),
  layout: new Set(['balanced', 'social', 'private', 'open', 'split', 'family']),
  roof: new Set(['gable', 'flat']),
  scheme: new Set(['warm', 'light', 'dark', 'cold']),
});

function text(value, max, fallback = '') {
  const result = String(value ?? fallback).trim();
  return result.slice(0, max);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function jsonClone(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
}

function integer(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
}

/** Canonical storefront state accepted by realtime mutations. Unknown product
 * keys and browser-only fields are discarded before the value reaches Convex. */
export function normalizeBusiness(input, { material = null, existingType = null } = {}) {
  const source = jsonClone(input, null);
  if (!source || typeof source !== 'object') throw new Error('invalid-business');
  const type = text(source.type, 24);
  const products = BUSINESS_PRODUCTS[type];
  if (!products) throw new Error('invalid-business-type');
  if (existingType && type !== existingType) throw new Error('business-type-immutable');
  if (!existingType && material && !BUSINESS_MATERIALS[material]?.has(type)) {
    throw new Error('business-not-allowed');
  }

  const stock = {};
  const prices = {};
  for (const [productId, catalogPrice] of Object.entries(products)) {
    stock[productId] = integer(source.stock?.[productId], 0, 1_000_000, 0);
    const minPrice = Math.max(1, Math.round(catalogPrice * 0.6));
    const maxPrice = Math.round(catalogPrice * 1.8);
    prices[productId] = integer(source.prices?.[productId], minPrice, maxPrice, catalogPrice);
  }

  const uniq = {};
  for (const accountId of Object.keys(source.uniq || {}).slice(0, 2_000)) {
    if (ID_RE.test(accountId) && source.uniq[accountId]) uniq[accountId] = true;
  }
  return {
    type,
    level: integer(source.level, 1, 100, 1),
    reputation: integer(source.reputation, 0, 1_000_000, 0),
    stock,
    prices,
    status: source.status === 'closed' ? 'closed' : 'open',
    visitors: integer(source.visitors, 0, 10_000_000, 0),
    uniq,
  };
}

export function normalizeMarketplacePurchase(input) {
  const buyerId = normalizeClientId(input?.buyerId);
  const houseId = normalizeClientId(input?.houseId);
  const productId = normalizeClientId(input?.productId);
  const purchaseKey = text(input?.purchaseKey, 120);
  const expectedPrice = integer(input?.expectedPrice, 1, 1_000_000, 0);
  const fee = integer(input?.fee, 0, expectedPrice - 1, 0);
  if (!buyerId || !houseId || !productId || purchaseKey.length < 8 || expectedPrice < 1) {
    throw new Error('invalid-purchase');
  }
  return { buyerId, houseId, productId, purchaseKey, expectedPrice, fee };
}

export function normalizeWorldDocument(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid-document');
  const raw = JSON.stringify(input);
  if (raw.length > MAX_DOCUMENT_BYTES) throw new Error('document-too-large');
  const source = jsonClone(input, null);
  const sourceHouse = source?.house;
  if (!sourceHouse || !ID_RE.test(String(sourceHouse.id || ''))) throw new Error('invalid-house-id');
  if (!ID_RE.test(String(sourceHouse.owner || ''))) throw new Error('invalid-owner-id');
  const name = text(sourceHouse.name, 60);
  const nickname = text(sourceHouse.nickname, 40);
  if (name.length < 2 || nickname.length < 1) throw new Error('invalid-house-name');
  const plotIndex = Math.trunc(finite(sourceHouse.plot?.i, -1));
  const plotX = finite(sourceHouse.plot?.x, NaN);
  const plotZ = finite(sourceHouse.plot?.z, NaN);
  if (plotIndex < 0 || plotIndex > 199 || !Number.isFinite(plotX) || !Number.isFinite(plotZ)
      || Math.abs(plotX) > 120 || Math.abs(plotZ) > 120) {
    throw new Error('invalid-plot');
  }

  const house = {
    id: String(sourceHouse.id),
    owner: String(sourceHouse.owner),
    name,
    nickname,
    foundation: text(sourceHouse.foundation, 20, 'compact'),
    height: text(sourceHouse.height, 20, 'one'),
    floorCount: floorCountFor(sourceHouse),
    material: text(sourceHouse.material, 20, 'wood'),
    layout: text(sourceHouse.layout, 20, 'balanced'),
    // 'shed' roofs were removed; any legacy value maps to the closed gable.
    roof: (() => { const r = text(sourceHouse.roof, 20, 'gable'); return r === 'shed' ? 'gable' : r; })(),
    kit: text(sourceHouse.kit, 24, 'cozy'),
    detail: text(sourceHouse.detail, 24, 'none'),
    scheme: text(sourceHouse.scheme, 20, 'warm'),
    companion: sourceHouse.companion ? text(sourceHouse.companion, 40) : null,
    builtAt: Math.max(0, Math.trunc(finite(sourceHouse.builtAt, Date.now()))),
    plot: { i: plotIndex, x: plotX, z: plotZ },
    schemaVersion: Math.max(0, Math.trunc(finite(sourceHouse.schemaVersion, 0))),
    revision: Math.max(0, Math.trunc(finite(sourceHouse.revision, 0))),
    construction: jsonClone(sourceHouse.construction, null),
    completedFloorCount: integer(sourceHouse.completedFloorCount, 0, floorCountFor(sourceHouse), floorCountFor(sourceHouse)),
    residentCount: sourceHouse.completedFloorCount === 0 ? 0 : 4 + ((Number(sourceHouse.completedFloorCount) || floorCountFor(sourceHouse)) - 1) * 2,
  };
  for (const [field, allowed] of Object.entries(HOUSE_ENUMS)) {
    if (!allowed.has(house[field])) throw new Error(`invalid-${field}`);
  }

  const document = {
    version: Math.max(0, Math.trunc(finite(source.version, 0))),
    updatedAt: Math.max(0, Math.trunc(finite(source.updatedAt, Date.now()))),
    house,
    definition: jsonClone(source.definition, null),
    interior: jsonClone(source.interior, { slots: {}, yard: {} }),
    placements: jsonClone(source.placements, { revision: 0, objects: [] }),
    interiorInventory: jsonClone(source.interiorInventory, []),
    business: jsonClone(source.business, null),
    needs: null,
    links: jsonClone(source.links, []),
  };
  if (!Array.isArray(document.placements?.objects)) document.placements = { revision: 0, objects: [] };
  if (!Array.isArray(document.links)) document.links = [];
  if (JSON.stringify(document).length > MAX_DOCUMENT_BYTES) throw new Error('document-too-large');
  return document;
}

export function normalizeJoinDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return documents.slice(0, MAX_HOUSES_PER_MESSAGE).map((document) => normalizeWorldDocument(document));
}

export function parseClientMessage(data) {
  let message;
  try { message = JSON.parse(String(data)); } catch { throw new Error('invalid-json'); }
  if (!message || typeof message !== 'object') throw new Error('invalid-message');
  const type = text(message.type, 32);
  const requestId = message.requestId == null ? null : text(message.requestId, 80);
  if (!type) throw new Error('missing-message-type');
  return { ...message, type, requestId };
}

export function normalizeClientId(value) {
  const clientId = text(value, 80);
  return ID_RE.test(clientId) ? clientId : '';
}
