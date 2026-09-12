import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Interior, floorSlabRectangles } from '../src/interior.js';
import { buildHouseDefinition } from '../src/houseModel.js';

const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

test('all rendered upper floors have real, nonoverlapping stair openings', () => {
  for (const foundation of ['compact', 'wide', 'lshape']) {
    for (const layout of ['balanced', 'social', 'private']) {
      const definition = buildHouseDefinition({ id: 'render-test', foundation, layout, floorCount: 5, roof: 'gable', kit: 'cozy' });
      assert.equal(definition.floors.length, 5);
      for (const floor of definition.floors) {
        const slabs = floorSlabRectangles(floor);
        const fullArea = floor.rooms.reduce((sum, room) => sum + area(room.rect), 0);
        const openingArea = floor.stairOpening ? floor.rooms.reduce((sum, room) => sum + overlap(room.rect, floor.stairOpening), 0) : 0;
        assert.ok(Math.abs(slabs.reduce((sum, r) => sum + area(r), 0) - (fullArea - openingArea)) < 1e-8);
        for (let i = 0; i < slabs.length; i++) {
          if (floor.stairOpening) assert.equal(overlap(slabs[i], floor.stairOpening), 0);
          for (let j = i + 1; j < slabs.length; j++) assert.equal(overlap(slabs[i], slabs[j]), 0);
        }
      }
    }
  }
});

test('render transforms preserve the canonical floor, wall and ceiling pivots', () => {
  const editor = Object.create(Interior.prototype);
  editor.renderer = { shadowMap: {} };
  for (const position of [[-3.4, 0, -1.2], [2.8, 1.62, -3.6], [-1.4, 2.74, 0.5]]) {
    const mesh = new THREE.Group();
    editor.objectMeshes = { chosen: mesh };
    editor.selectedOid = 'chosen';
    editor._syncMesh({ oid: 'chosen', pos: [0, 0], elevated: 0, localPosition: position, localRotation: [0, Math.PI / 2, 0] });
    assert.deepEqual(mesh.position.toArray(), position);
    assert.equal(mesh.rotation.y, Math.PI / 2);
  }
});

test('changing to floor five keeps camera relative offset and cancels pending placement', () => {
  const editor = Object.create(Interior.prototype);
  editor.def = buildHouseDefinition({ id: 'camera-test', foundation: 'compact', floorCount: 5 });
  editor.camera = new THREE.PerspectiveCamera();
  editor.camera.position.set(0, 7.5, 13.5);
  editor.controls = { target: new THREE.Vector3(0, 1.5, 0), update() {} };
  editor.renderer = { shadowMap: {} };
  editor.pendingPreview = { oid: 'pending' };
  editor.cancelPlacement = () => { editor.pendingPreview = null; };
  editor.selectObject = () => {};
  editor._applyVisibility = () => {};
  editor._refreshMarkers = () => {};
  editor.setFloor(4);
  assert.equal(editor.pendingPreview, null);
  assert.equal(editor.activeFloor, 4);
  assert.equal(editor.controls.target.y, editor.def.floors[4].elevation + 1.5);
  assert.equal(editor.camera.position.y - editor.controls.target.y, 6);
  assert.equal(editor.renderer.shadowMap.needsUpdate, true);
});

test('ghost view shows only the active level and the immediately lower floor', () => {
  const editor = Object.create(Interior.prototype);
  editor.def = buildHouseDefinition({ id: 'ghost-test', foundation: 'compact', floorCount: 5 });
  editor.floorGroups = editor.def.floors.map(() => new THREE.Group());
  editor.floorMats = [];
  editor.objects = [];
  editor.objectMeshes = {};
  editor.activeFloor = 3;
  editor.viewMode = 'ghost';
  editor._applyVisibility();
  assert.deepEqual(editor.floorGroups.map((group) => group.visible), [false, false, true, true, false]);
  editor.viewMode = 'cutaway';
  editor._applyVisibility();
  assert.deepEqual(editor.floorGroups.map((group) => group.visible), [true, true, true, true, false]);
});

test('full preview roofs face upward and leave the L-shaped courtyard open', () => {
  for (const roof of ['gable', 'shed', 'flat']) {
    const editor = Object.create(Interior.prototype);
    editor.def = buildHouseDefinition({ id: 'roof-test', foundation: 'lshape', floorCount: 5, roof });
    editor.scene = new THREE.Scene();
    editor._mat = () => new THREE.MeshStandardMaterial();
    editor._buildRoof({ roof: '#a06a4a' });
    editor.scene.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0);
    const courtyard = new THREE.Raycaster(new THREE.Vector3(4, 50, 3), down);
    assert.equal(courtyard.intersectObjects(editor.roofGroup.children).length, 0, `${roof} must not cover the courtyard`);
    const roofRay = new THREE.Raycaster(new THREE.Vector3(-3, 50, 0), down);
    const hits = roofRay.intersectObjects(editor.roofGroup.children);
    assert.ok(hits.length > 0, `${roof} surface must render when viewed from above`);
    assert.ok(hits[0].point.y > editor.def.floors[4].elevation + 3);
    editor._disposeGroup(editor.scene);
  }
});

test('removing an interior item frees local resources while keeping shared materials alive', () => {
  const editor = Object.create(Interior.prototype);
  const geometry = new THREE.BoxGeometry();
  const local = new THREE.MeshStandardMaterial();
  const shared = new THREE.MeshStandardMaterial();
  shared.userData.sharedMaterial = true;
  let geometryDisposed = 0, localDisposed = 0, sharedDisposed = 0;
  geometry.addEventListener('dispose', () => geometryDisposed++);
  local.addEventListener('dispose', () => localDisposed++);
  shared.addEventListener('dispose', () => sharedDisposed++);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, [local, shared]), new THREE.Mesh(geometry, local));
  editor._disposeGroup(group);
  assert.equal(geometryDisposed, 1);
  assert.equal(localDisposed, 1);
  assert.equal(sharedDisposed, 0);
});
