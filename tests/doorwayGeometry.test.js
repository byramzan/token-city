import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALL_SEAM, FRAME_EMBED, interiorDoorFrameLayout, exteriorDoorFrameLayout,
  wallBandBottom, visibleCoincidentFaces, boxesIntersect,
} from '../server/doorGeometry.js';
import { buildHouseDefinition, FLOOR_HEIGHT, WALL_T } from '../src/houseModel.js';
import { MATERIALS, KITS, ROOFS, FOUNDATIONS } from '../src/config.js';

// task8 §22.5: the doorway must not flicker. The confirmed root cause was two
// opaque faces on the same plane, so the regression test is geometric: no
// *visible* coincident coplanar face may exist around any doorway. A pair that
// is buried inside a third solid cannot be seen and cannot flicker.

/** Rebuild the boxes `Interior#_buildWall` emits for one wall, in wall space. */
function wallBoxes({ wallLength, wallHeight, openings }) {
  const boxes = [];
  const push = (name, a, b, y0, y1) => {
    if (b - a < 0.03 || y1 - y0 < 0.03) return;
    boxes.push({ name, min: [a, y0, -WALL_T / 2], max: [b, y1, WALL_T / 2] });
  };
  const bandBottom = wallBandBottom(openings, wallHeight);
  const pierTop = bandBottom === null ? wallHeight : bandBottom;
  if (bandBottom !== null) push('band', 0, wallLength, bandBottom - WALL_SEAM, wallHeight);
  let cursor = 0;
  let index = 0;
  for (const opening of openings) {
    const trim = opening.kind === 'window' ? 0 : 0.09;
    push(`pier${index}`, cursor, opening.offset - trim, 0, pierTop);
    if (opening.kind === 'window') {
      push(`sill${index}`, opening.offset - WALL_SEAM, opening.offset + opening.width + WALL_SEAM, 0, opening.sill);
      push(`winLintel${index}`, opening.offset - WALL_SEAM, opening.offset + opening.width + WALL_SEAM,
        opening.sill + opening.height, pierTop);
    } else {
      const layout = interiorDoorFrameLayout({
        offset: opening.offset, width: opening.width, height: opening.height,
        wallThickness: WALL_T, lintelTop: pierTop, trim,
      });
      if (layout.lintel) push(`doorLintel${index}`, layout.lintelSpan[0], layout.lintelSpan[1], layout.lintelBottom, pierTop);
      for (const part of [...layout.jambs, layout.header]) {
        boxes.push({ ...part, name: `${part.name}${index}` });
      }
    }
    cursor = opening.offset + opening.width + trim;
    index += 1;
  }
  push('pierEnd', cursor, wallLength, 0, pierTop);
  // The floor slab caps every piece from below; without it the shared ground
  // plane at y = 0 would look like a defect instead of the floor it rests on.
  boxes.push({ name: 'floorSlab', min: [-1, -0.2, -1], max: [wallLength + 1, 0, 1] });
  return boxes;
}

test('a wall with one door has no visible coincident coplanar faces', () => {
  const boxes = wallBoxes({
    wallLength: 6, wallHeight: FLOOR_HEIGHT,
    openings: [{ kind: 'door', offset: 2.2, width: 0.95, height: 2.05 }],
  });
  assert.deepEqual(visibleCoincidentFaces(boxes), []);
});

test('doors, windows and mixed walls all stay clean', () => {
  const walls = [
    [{ kind: 'door', offset: 1.1, width: 0.95, height: 2.05 }],
    [{ kind: 'door', offset: 0.6, width: 1.4, height: 2.2 }],
    [{ kind: 'window', offset: 1.2, width: 1.2, height: 1.1, sill: 0.95 }],
    [
      { kind: 'door', offset: 0.8, width: 0.95, height: 2.05 },
      { kind: 'window', offset: 3.0, width: 1.2, height: 1.1, sill: 0.95 },
    ],
    [
      { kind: 'window', offset: 0.7, width: 1.0, height: 1.0, sill: 0.9 },
      { kind: 'door', offset: 2.6, width: 0.95, height: 2.05 },
      { kind: 'window', offset: 4.4, width: 1.0, height: 1.0, sill: 0.9 },
    ],
  ];
  for (const openings of walls) {
    for (const wallHeight of [FLOOR_HEIGHT, 1.25]) {
      const boxes = wallBoxes({ wallLength: 6.5, wallHeight, openings });
      assert.deepEqual(visibleCoincidentFaces(boxes), [], `${JSON.stringify(openings)} at ${wallHeight}`);
    }
  }
});

test('doorway parts interpenetrate instead of butting against each other', () => {
  const layout = interiorDoorFrameLayout({
    offset: 1.2, width: 0.95, height: 2.05, wallThickness: WALL_T, lintelTop: FLOOR_HEIGHT,
  });
  // Real shared volume is what removes the z-fight; a gap or a butt joint does not.
  assert.ok(boxesIntersect(layout.jambs[0], layout.header));
  assert.ok(boxesIntersect(layout.jambs[1], layout.header));
  assert.ok(boxesIntersect(layout.header, layout.lintel));
  assert.ok(boxesIntersect(layout.jambs[0], layout.lintel));
  assert.equal(Math.round((1.2 - 0.09 - layout.lintelSpan[0]) * 1000) / 1000, WALL_SEAM);
});

test('the wall above the tallest opening is a single continuous band', () => {
  const openings = [
    { kind: 'door', offset: 0.8, width: 0.95, height: 2.05 },
    { kind: 'window', offset: 3.0, width: 1.2, height: 1.1, sill: 0.95 },
  ];
  assert.equal(wallBandBottom(openings, FLOOR_HEIGHT), 2.15);
  // A knee wall with no room above the opening has no band and no door piece.
  assert.equal(wallBandBottom(openings, 2.1), null);
  assert.equal(wallBandBottom([], FLOOR_HEIGHT), null);
});

test('the exterior house doorway is embedded in the wall and has no shared plane', () => {
  for (const doorWidth of [1.05, 1.4]) {
    const layout = exteriorDoorFrameLayout({ doorWidth });
    const boxes = [...layout.jambs, layout.header, layout.panel];
    assert.deepEqual(visibleCoincidentFaces(boxes), [], `door width ${doorWidth}`);
    assert.ok(boxesIntersect(layout.jambs[0], layout.header));
    // Seated into the wall rather than floating in front of it: no seam.
    const wall = { name: 'wall', min: [-5, -1, -1], max: [5, 4, -layout.wallOffset] };
    const ground = { name: 'ground', min: [-9, -0.2, -3], max: [9, 0, 3] };
    assert.ok(boxesIntersect(layout.jambs[0], wall));
    assert.ok(boxesIntersect(layout.panel, wall));
    assert.deepEqual(visibleCoincidentFaces([...boxes, wall, ground]), []);
    assert.ok(layout.wallOffset > 0 && layout.wallOffset < FRAME_EMBED + 0.02);
  }
});

test('the visual fix does not change any gameplay opening data', () => {
  // Openings, room ids and socket metadata are the gameplay contract: a visual
  // fix must leave them untouched (task8 §22.3, developer guide §8).
  for (const material of MATERIALS.map((entry) => entry.id)) {
    for (const kit of KITS.map((entry) => entry.id)) {
      const definition = buildHouseDefinition({
        id: 'flicker_house', owner: 'acc_1', name: 'Flicker', nickname: 'qa',
        foundation: FOUNDATIONS[0].id, height: 'one', floorCount: 3, material,
        roof: ROOFS[0].id, kit, layout: 'balanced', detail: 'none', scheme: 'warm',
        builtAt: 1, plot: { i: 1, x: 0, z: 0 }, schemaVersion: 4,
      });
      const doorOpenings = definition.floors.flatMap((floor) => floor.walls
        .flatMap((wall) => wall.openings.filter((opening) => opening.kind !== 'window')));
      assert.ok(doorOpenings.length > 0, `${material}/${kit} has doorways`);
      for (const opening of doorOpenings) {
        const layout = interiorDoorFrameLayout({
          offset: opening.offset, width: opening.width, height: opening.height,
          wallThickness: WALL_T, lintelTop: FLOOR_HEIGHT,
        });
        // Jambs sit outside the walkable opening, so resident navigation and
        // the placement clearances behind it are unchanged.
        assert.ok(layout.jambs[0].max[0] <= opening.offset + 1e-9);
        assert.ok(layout.jambs[1].min[0] >= opening.offset + opening.width - 1e-9);
      }
    }
  }
});
