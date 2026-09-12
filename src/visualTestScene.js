// Controlled visual-regression deck, opened with ?visual-test=1.
// It is intentionally absent from the public navigation and uses the same
// runtime materials/models as gameplay rather than special screenshot assets.

import * as THREE from 'three';
import { mat } from './house.js';
import { buildItem } from './items.js';

const SWATCHES = [
  ['grass', '#fff3cf'], ['asphalt', '#f1eadb'], ['pavers', '#e3d5ae'],
  ['soil', '#f4eadb'], ['sand', '#f8edcf'], ['wood', '#d9a66b'],
  ['floorWood', '#c69258'], ['brick', '#bd634a'], ['stone', '#d8cfba'],
  ['tech', '#68798e'], ['roof', '#a54d2d'], ['plaster', '#f2eadc'],
  ['fabric', '#70a6b7'], ['ceramic', '#f4e8cf'], ['metal', '#8e98a2'],
  ['plastic', '#e18b64'], ['bark', '#8a6848'], ['foliage', '#69a954'],
];

export function buildVisualTestDeck(scene) {
  const group = new THREE.Group();
  group.name = 'visual_test_deck';
  group.position.set(0, 0, 92);
  scene.add(group);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.35, 17),
    mat('#d8c7a5', { textureKind: 'pavers', textureRepeat: [6, 4] }),
  );
  base.position.y = 0.16;
  base.receiveShadow = true;
  group.add(base);

  SWATCHES.forEach(([kind, color], index) => {
    const col = index % 6;
    const row = Math.floor(index / 6);
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(2.65, 0.28, 2.65),
      mat(color, { textureKind: kind, textureRepeat: [1.4, 1.4] }),
    );
    tile.name = `visual_test_${kind}`;
    tile.position.set(-8.0 + col * 3.2, 0.48, -4.6 + row * 3.2);
    tile.castShadow = true;
    tile.receiveShadow = true;
    group.add(tile);
  });

  // Representative interior props exercise fabric, wood, metal, ceramics,
  // emissive surfaces and the shared item material cache.
  for (const [id, x] of [['sofa', -6], ['table', -2.2], ['safe', 1.8], ['plant', 5.4]]) {
    const item = buildItem(id);
    item.name = `visual_test_item_${id}`;
    item.position.set(x, 0.38, 6.0);
    group.add(item);
  }

  // One single-sided pane verifies the production glass render mode without
  // the duplicate coplanar surfaces that caused the old storefront flicker.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 2.1),
    new THREE.MeshStandardMaterial({
      color: '#bfe6f5', emissive: '#bfe6f5', emissiveIntensity: 0.08,
      roughness: 0.35, transparent: true, opacity: 0.48,
      depthWrite: false, side: THREE.FrontSide,
    }),
  );
  glass.name = 'visual_test_glass';
  glass.position.set(9.1, 1.45, 5.6);
  glass.rotation.y = -0.35;
  group.add(glass);

  return {
    group,
    camera: new THREE.Vector3(0, 15.5, 111),
    target: new THREE.Vector3(0, 1.5, 92),
  };
}
