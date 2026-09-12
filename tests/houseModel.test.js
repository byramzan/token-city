import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  ITEM_DEFINITIONS,
  bestPlacement,
  buildHouseDefinition,
  findZone,
  normalizeObjectInstance,
  remapObjectsToPlacementSlots,
  validateHouseDefinition,
  validateOpening,
  validatePlacement,
} from '../src/houseModel.js';

const cfg = (overrides = {}) => ({
  id: 'house_test',
  owner: 'account_test',
  foundation: 'compact',
  height: 'two',
  layout: 'balanced',
  material: 'wood',
  roof: 'gable',
  kit: 'cozy',
  scheme: 'light',
  builtAt: 123456,
  plot: { x: 4, z: -8 },
  ...overrides,
});

test('canonical two-floor house has stable IDs and a valid stair connection', () => {
  const a = buildHouseDefinition(cfg());
  const b = buildHouseDefinition(cfg());

  assert.equal(a.schemaVersion, SCHEMA_VERSION);
  assert.equal(a.floorCount, 2);
  assert.equal(a.ownerId, 'account_test');
  assert.deepEqual(a, b);
  assert.ok(a.floors[0].stair);
  assert.equal(a.floors[0].stair.upperFloorId, a.floors[1].floorId);
  assert.ok(a.floors[1].stairOpeningId);
  assert.deepEqual(validateHouseDefinition(a), []);

  const ids = [
    a.houseId,
    ...a.floors.flatMap((floor) => [
      floor.floorId,
      ...floor.rooms.map((room) => room.roomId),
      ...floor.walls.map((wall) => wall.wallId),
      ...floor.walls.flatMap((wall) => wall.openings.map((opening) => opening.id)),
    ]),
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test('saved layout parameter changes the room plan without randomness', () => {
  const social = buildHouseDefinition(cfg({ height: 'one', layout: 'social' }));
  const privatePlan = buildHouseDefinition(cfg({ height: 'one', layout: 'private' }));
  assert.notEqual(social.floors[0].rooms[0].rect.x1, privatePlan.floors[0].rooms[0].rect.x1);
  assert.equal(social.layoutId, 'social');
  assert.equal(privatePlan.layoutId, 'private');
});

test('opening validation blocks corners and overlaps', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const wall = def.floors[0].walls.find((candidate) => candidate.openings.length);
  assert.equal(validateOpening(wall, {
    id: 'bad_corner',
    offset: 0.1,
    width: 1,
    height: 1.5,
    sill: 0,
  }).ok, false);

  const existing = wall.openings[0];
  assert.equal(validateOpening(wall, {
    id: 'bad_overlap',
    offset: existing.offset,
    width: existing.width,
    height: existing.height,
    sill: existing.sill,
  }).ok, false);
});

test('automatic interior placement is deterministic and fully normalized', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const zone = def.floors[0].rooms[0].zones.find((candidate) => candidate.types.includes('floor-large'));
  const first = bestPlacement(def, [], 'sofa', zone);
  const second = bestPlacement(def, [], 'sofa', zone);
  assert.deepEqual(first, second);
  assert.equal(zone.max, 1);
  assert.equal(zone.spots.length, 1);
  const approved = zone.spots.find((spot) => spot.spotId === first.spotId);
  assert.ok(approved);
  assert.deepEqual(first.pos, approved.pos.map((value) => Math.round(value * 100) / 100));
  assert.equal(validatePlacement(def, [], first).ok, true);

  const normalized = normalizeObjectInstance(def, { ...first, oid: 'stable_sofa' });
  assert.equal(normalized.objectInstanceId, 'stable_sofa');
  assert.equal(normalized.itemDefinitionId, 'sofa');
  assert.deepEqual(normalized.localPosition, [first.pos[0], 0, first.pos[1]]);
  assert.ok(normalized.footprintBounds);
  assert.ok(normalized.clearanceBounds);
  assert.ok(normalized.interactionBounds);
});

test('placement is rejected when an object is moved away from its exact socket', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const zone = def.floors[0].rooms[0].zones.find((candidate) => candidate.types.includes('floor-large'));
  const approved = bestPlacement(def, [], 'sofa', zone);
  const moved = { ...approved, pos: [approved.pos[0] + 0.2, approved.pos[1]] };
  assert.equal(validatePlacement(def, [], approved).ok, true);
  assert.equal(validatePlacement(def, [], moved).ok, false);
});

test('normalization always snaps stale saved coordinates back to the selected socket', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const zones = def.floors[0].rooms.flatMap((room) => room.zones).filter((candidate) => candidate.types.includes('floor-med'));
  assert.ok(zones.length >= 2);
  const placed = bestPlacement(def, [], 'table', zones[1]);
  const normalized = normalizeObjectInstance(def, {
    ...placed,
    oid: 'stale_table',
    pos: [99, 99],
    localPosition: [-99, 0, -99],
  });
  assert.deepEqual(normalized.pos, placed.pos);
  assert.deepEqual(normalized.localPosition, [placed.pos[0], 0, placed.pos[1]]);
});

test('each surface socket accepts one object and another authored socket stays available', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const zones = def.floors[0].rooms.flatMap((room) => room.zones).filter((candidate) => candidate.types.includes('surface'));
  assert.equal(zones.length, 2);
  const first = { ...bestPlacement(def, [], 'gm_clock', zones[0]), oid: 'surface_1' };
  const occupied = bestPlacement(def, [first], 'hw_wallet', zones[0]);
  const second = bestPlacement(def, [first], 'hw_wallet', zones[1]);
  assert.ok(first.spotId);
  assert.equal(occupied, null);
  assert.ok(second);
  assert.notEqual(second.spotId, first.spotId);
  assert.equal(validatePlacement(def, [first], second).ok, true);
});

test('every generated socket represents at least one genuinely valid catalog placement', () => {
  for (const foundation of ['compact', 'wide', 'lshape']) {
    const def = buildHouseDefinition(cfg({ foundation }));
    for (const floor of def.floors) for (const room of floor.rooms) for (const zone of room.zones) {
      assert.equal(zone.max, 1);
      assert.equal(zone.spots.length, 1);
      const compatible = Object.values(ITEM_DEFINITIONS)
        .map((definition) => definition.source)
        .filter((item) => item.slots.some((slot) => zone.types.includes(slot)));
      assert.ok(compatible.some((item) => bestPlacement(def, [], item.id, zone)), `invalid socket ${zone.name}`);
    }
  }
});

test('old object positions return ownership to inventory without copying invalid transforms', () => {
  const def = buildHouseDefinition(cfg({ height: 'one' }));
  const old = [{ oid: 'old_sofa', itemId: 'sofa', floorId: def.floors[0].floorId, pos: [99, 99] }];
  const a = remapObjectsToPlacementSlots(def, old);
  const b = remapObjectsToPlacementSlots(def, old);
  assert.deepEqual(a, b);
  assert.deepEqual(a.returned, ['sofa']);
  assert.equal(a.objects.length, 0);
});

test('all catalog items expose the complete placement metadata contract', () => {
  assert.ok(Object.keys(ITEM_DEFINITIONS).length >= 40);
  for (const definition of Object.values(ITEM_DEFINITIONS)) {
    assert.ok(definition.itemDefinitionId);
    assert.ok(definition.placementTypes.length);
    assert.equal(definition.visualBounds.size.length, 3);
    assert.equal(definition.collisionBounds.size.length, 3);
    assert.equal(definition.clearanceBounds.size.length, 3);
    assert.equal(definition.interactionBounds.size.length, 3);
    assert.ok(definition.assetReference);
  }
});

test('structural validator reports a disconnected second floor', () => {
  const def = buildHouseDefinition(cfg());
  def.floors[0].stair = null;
  const errors = validateHouseDefinition(def);
  assert.ok(errors.some((error) => error.code === 'stairs'));
});
