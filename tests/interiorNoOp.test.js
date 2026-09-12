import test from 'node:test';
import assert from 'node:assert/strict';

import { interiorSnapshot, interiorSnapshotHash, sameInteriorLayout } from '../server/interiorSnapshot.js';
import { buildHouseDefinition, defaultResidentialObjects, normalizeObjectInstance } from '../src/houseModel.js';

function house(overrides = {}) {
  return {
    id: 'house_noop', owner: 'acc_1', name: 'No-op House', nickname: 'qa',
    foundation: 'compact', height: 'one', floorCount: 2, material: 'wood', roof: 'gable',
    kit: 'cozy', layout: 'balanced', detail: 'none', scheme: 'warm',
    builtAt: 1_700_000_000_000, plot: { i: 4, x: 10, z: 10 }, schemaVersion: 4,
    ...overrides,
  };
}

function canonicalObjects(definition) {
  return defaultResidentialObjects(definition)
    .map((object, index) => normalizeObjectInstance(definition, object, index));
}

test('opening an interior without editing produces no change at all', () => {
  const definition = buildHouseDefinition(house());
  const stored = canonicalObjects(definition);
  // What the editor loads: a JSON round trip through the world document, then
  // normalization. The saved copy is normalized from the untouched source.
  const working = JSON.parse(JSON.stringify(stored)).map((object, index) => normalizeObjectInstance(definition, object, index));
  assert.ok(sameInteriorLayout(working, stored));
  assert.equal(interiorSnapshotHash(working), interiorSnapshotHash(stored));
});

test('key order and normalization defaults never look like an edit', () => {
  const definition = buildHouseDefinition(house());
  const stored = canonicalObjects(definition);
  // Re-serializing the same objects with a different key order, extra derived
  // fields and float noise is not a semantic change.
  const reordered = stored.map((object) => {
    const shuffled = {};
    for (const key of Object.keys(object).reverse()) shuffled[key] = object[key];
    return { ...shuffled, footprintBounds: null, renderHint: 'ignored', pos: [object.pos[0] + 1e-9, object.pos[1]] };
  }).reverse();
  assert.ok(sameInteriorLayout(reordered, stored));
});

test('a real placement change is detected', () => {
  const definition = buildHouseDefinition(house());
  const stored = canonicalObjects(definition);
  assert.ok(stored.length > 1);
  const moved = stored.map((object, index) => (index === 0
    ? { ...object, pos: [object.pos[0] + 0.6, object.pos[1]] }
    : object));
  assert.ok(!sameInteriorLayout(moved, stored));

  const rotated = stored.map((object, index) => (index === 0 ? { ...object, rot: (object.rot || 0) + Math.PI / 2 } : object));
  assert.ok(!sameInteriorLayout(rotated, stored));

  const removed = stored.slice(1);
  assert.ok(!sameInteriorLayout(removed, stored));

  const replaced = stored.map((object, index) => (index === 0 ? { ...object, itemId: 'bookshelf' } : object));
  assert.ok(!sameInteriorLayout(replaced, stored));
});

test('an empty patch from an old client is a no-op against an empty interior', () => {
  assert.ok(sameInteriorLayout([], []));
  assert.ok(sameInteriorLayout(undefined, []));
  assert.ok(!sameInteriorLayout([], canonicalObjects(buildHouseDefinition(house()))));
});

test('the snapshot ignores fields the player cannot change', () => {
  const definition = buildHouseDefinition(house());
  const [object] = canonicalObjects(definition);
  const [entry] = interiorSnapshot([object]);
  for (const derived of ['footprintBounds', 'clearanceBounds', 'interactionBounds', 'schemaVersion', 'revision', 'localPosition', 'localRotation']) {
    assert.equal(entry[derived], undefined, derived);
  }
  assert.equal(entry.itemId, object.itemId);
  assert.equal(entry.zoneId, object.zoneId);
});

test('floor order does not affect the snapshot', () => {
  const definition = buildHouseDefinition(house({ floorCount: 3 }));
  const stored = canonicalObjects(definition);
  const shuffled = [...stored].sort(() => -1);
  assert.ok(sameInteriorLayout(shuffled, stored));
});
