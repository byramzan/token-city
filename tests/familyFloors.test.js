import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { floorCountFor, residentsFor, familyConsumptionFor, houseCost, HEIGHTS } from '../src/config.js';
import { buildHouseDefinition, validateHouseDefinition, bestPlacement, validatePlacement, ITEM_DEFINITIONS, defaultResidentialObjects, migrateHouseInterior, SCHEMA_VERSION } from '../src/houseModel.js';
import { buildItem } from '../src/items.js';
import { createHouse } from '../src/house.js';

const config = (extra = {}) => ({ id: 'floor-matrix', foundation: 'compact', layout: 'balanced', floorCount: 1, material: 'wood', roof: 'gable', kit: 'cozy', name: 'Family', nickname: 'Test', ...extra });
const zones = (def) => def.floors.flatMap((floor) => floor.rooms.flatMap((room) => room.zones));

test('separate floor count clamps, migrates old types and determines one family', () => {
  assert.equal(floorCountFor(-10), 1);
  assert.equal(floorCountFor(20), 5);
  assert.equal(floorCountFor({ height: 'two' }), 2);
  assert.equal(floorCountFor({ height: 'attic' }), 2);
  assert.equal(floorCountFor({ height: 'two', floorCount: 4 }), 4);
  assert.deepEqual(HEIGHTS.map((height) => height.id), ['one']);
  assert.deepEqual([1, 2, 3, 4, 5].map(residentsFor), [4, 6, 8, 10, 12]);
  assert.deepEqual([1, 2, 3, 4, 5].map(familyConsumptionFor), [1, 2, 2, 3, 3]);
  assert.equal(houseCost(config({ floorCount: 5 })) - houseCost(config()), 1800);
});

test('all floors, layouts, foundations and window kits have valid independently authored furniture', () => {
  for (const foundation of ['compact', 'wide', 'lshape']) for (const layout of ['balanced', 'social', 'private']) {
    for (const kit of ['cozy', 'open', 'tech']) for (let floorCount = 1; floorCount <= 5; floorCount++) {
      const cfg = config({ foundation, layout, kit, floorCount });
      const def = buildHouseDefinition(cfg);
      assert.deepEqual(validateHouseDefinition(def), [], JSON.stringify(cfg));
      const defaults = defaultResidentialObjects(def);
      const beds = defaults.reduce((sum, item) => sum + ITEM_DEFINITIONS[item.itemId].sleepingCapacity, 0);
      assert.equal(beds, residentsFor(floorCount), `sleeping capacity ${JSON.stringify(cfg)}`);
      const seats = defaults.reduce((sum, item) => sum + ITEM_DEFINITIONS[item.itemId].seatingCapacity, 0);
      assert.ok(seats >= residentsFor(floorCount));
      const ids = zones(def).map((slot) => slot.slotId);
      assert.equal(new Set(ids).size, ids.length);
      for (const slot of zones(def)) {
        assert.ok(Object.keys(ITEM_DEFINITIONS).some((id) => bestPlacement(def, [], id, slot)), `unusable marker ${slot.name}`);
        for (const field of ['floorId', 'roomId', 'slotType', 'allowedItemCategories', 'position', 'rotation', 'maximumWidth', 'maximumDepth', 'maximumHeight', 'clearanceBounds', 'navigationClearance', 'occupancyState']) assert.ok(slot[field] !== undefined, field);
      }
      for (const item of defaults) assert.equal(validatePlacement(def, defaults, item).ok, true);
      const rebuilt = defaultResidentialObjects(buildHouseDefinition(cfg));
      assert.deepEqual(rebuilt, defaults, 'another client reconstructs identical transforms and stable IDs');
    }
  }
});

test('extension preserves completed floors and gives exactly two new sleeping places', () => {
  for (let count = 1; count < 5; count++) {
    const before = buildHouseDefinition(config({ floorCount: count }));
    const after = buildHouseDefinition(config({ floorCount: count + 1 }));
    for (let f = 0; f < count; f++) assert.deepEqual(after.floors[f].rooms.map((room) => room.zones), before.floors[f].rooms.map((room) => room.zones));
    const added = defaultResidentialObjects(after, { fromFloorIndex: count });
    assert.equal(added.reduce((sum, item) => sum + ITEM_DEFINITIONS[item.itemId].sleepingCapacity, 0), 2);
    assert.deepEqual(added, defaultResidentialObjects(after, { fromFloorIndex: count }));
  }
});

test('floor, wall, reserved areas, occupied slots and oversized items are rejected precisely', () => {
  const def = buildHouseDefinition(config({ floorCount: 2 }));
  const sofaSlot = zones(def).find((slot) => bestPlacement(def, [], 'sofa', slot));
  const artSlot = zones(def).find((slot) => bestPlacement(def, [], 'meme_poster', slot));
  assert.equal(bestPlacement(def, [], 'sofa', artSlot), null);
  assert.equal(bestPlacement(def, [], 'meme_poster', sofaSlot), null);
  const candidate = { ...bestPlacement(def, [], 'sofa', sofaSlot), oid: 'sofa-1' };
  assert.equal(bestPlacement(def, [candidate], 'sofa', sofaSlot), null);
  assert.equal(validatePlacement(def, [], { ...candidate, floorId: def.floors[1].floorId }).ok, false);
  assert.equal(validatePlacement(def, [], { ...candidate, rot: Math.PI / 4 }).ok, false);
  assert.equal(validatePlacement(def, [], { ...candidate, zoneId: def.floors[0].reservedSlots[0].slotId }).ok, false);
  sofaSlot.maximumWidth = 1;
  assert.equal(bestPlacement(def, [], 'sofa', sofaSlot), null);
});

test('migration preserves ownership, preserves current exact placements and is replay-safe', () => {
  const old = [{ oid: 'old', itemId: 'sofa', pos: [99, 99] }, { oid: 'unknown-owned', itemId: 'retired-chair', pos: [0, 0] }];
  const first = migrateHouseInterior({ ...config(), height: 'two', floorCount: undefined, interiorSchemaVersion: 3 }, old, ['plant']);
  assert.equal(first.floorCount, 2);
  assert.equal(first.residentCount, 6);
  assert.deepEqual(first.objects, []);
  assert.deepEqual(first.inventory, ['plant', 'sofa', 'retired-chair']);
  const next = migrateHouseInterior({ ...config(), floorCount: 2, interiorSchemaVersion: SCHEMA_VERSION }, first.objects, first.inventory);
  assert.deepEqual(next.inventory, first.inventory);
  const defaults = defaultResidentialObjects(first.definition);
  const current = migrateHouseInterior({ ...config(), floorCount: 2, interiorSchemaVersion: SCHEMA_VERSION }, defaults, []);
  assert.deepEqual(current.objects, defaults);
  assert.deepEqual(current.returned, []);
});

function canvasStub() {
  const context = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return (text) => ({ width: String(text).length * 5 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  }, set(target, key, value) { target[key] = value; return true; } });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

test('every furniture model matches its declared dimensions and correct attachment pivot', () => {
  const saved = globalThis.document;
  globalThis.document = canvasStub();
  try {
    for (const definition of Object.values(ITEM_DEFINITIONS)) {
      const model = buildItem(definition.itemId);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      for (const [actual, expected] of [[size.x, definition.width], [size.y, definition.height], [size.z, definition.depth]]) assert.ok(Math.abs(actual - expected) < 1e-5, `${definition.itemId} has measured valid size`);
      const center = bounds.getCenter(new THREE.Vector3());
      assert.ok(Math.abs(center.x) < 1e-5);
      if (definition.pivotType === 'rear-attachment') { assert.ok(Math.abs(bounds.min.z) < 1e-5); assert.ok(Math.abs(center.y) < 1e-5); }
      else if (definition.pivotType === 'top-center') assert.ok(Math.abs(bounds.max.y) < 1e-5);
      else assert.ok(Math.abs(bounds.min.y) < 1e-5);
    }
  } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
});

test('modular exterior raises all shells and roof to the selected top floor', () => {
  const saved = globalThis.document;
  globalThis.document = canvasStub();
  try {
    for (const foundation of ['compact', 'wide', 'lshape']) for (const roof of ['gable', 'shed', 'flat']) for (let floorCount = 1; floorCount <= 5; floorCount++) {
      const house = createHouse(config({ foundation, roof, floorCount }));
      assert.equal(house.group.userData.floorCount, floorCount);
      assert.equal(house.group.userData.roofElevation, 0.45 + floorCount * 2.5);
      assert.ok(house.parts.filter((part) => part.userData.roof).every((part) => part.userData.topFloorIndex === floorCount - 1));
      for (let i = 0; i < floorCount; i++) assert.ok(house.parts.some((part) => part.userData.floorIndex === i));
    }
  } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
});
