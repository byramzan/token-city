import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferSurfaceKind, SURFACE_PROFILES, VISUAL_QUALITY, surfaceTexture,
} from '../src/materialLibrary.js';

test('every controlled surface stays inside the web texture budget', () => {
  const required = [
    'grass', 'asphalt', 'pavers', 'soil', 'sand', 'wood', 'floorWood',
    'brick', 'stone', 'tech', 'roof', 'plaster', 'fabric', 'ceramic',
    'metal', 'plastic', 'bark', 'foliage',
  ];
  assert.deepEqual(Object.keys(SURFACE_PROFILES), required);
  for (const [kind, profile] of Object.entries(SURFACE_PROFILES)) {
    assert.ok(profile.size >= 128 && profile.size <= 512, `${kind} uses a suitable source size`);
    assert.ok(profile.anisotropy >= 1 && profile.anisotropy <= VISUAL_QUALITY.maxAnisotropy);
    assert.ok(profile.roughness >= 0.5 && profile.roughness <= 1);
    assert.ok(profile.bumpScale >= 0 && profile.bumpScale <= 0.03);
  }
});

test('procedural furniture colors map into the intended reusable materials', () => {
  assert.equal(inferSurfaceKind('#a9835c'), 'wood');
  assert.equal(inferSurfaceKind('#7aa2f7'), 'fabric');
  assert.equal(inferSurfaceKind('#4c5566'), 'metal');
  assert.equal(inferSurfaceKind('#5eb85e'), 'foliage');
  assert.equal(inferSurfaceKind('#f7f1e3'), 'ceramic');
  assert.equal(inferSurfaceKind('#123456'), 'plastic');
});

test('grass crossing a tile edge keeps exactly the same shape on its wrapped copy', () => {
  const ellipses = [];
  const originalDocument = globalThis.document;
  const context = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'ellipse') return (...args) => ellipses.push(args);
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    const texture = surfaceTexture('grass', [3, 3]);
    const size = texture.image.width;
    const wrap = (value) => Math.round((((value % size) + size) % size) * 1e6) / 1e6;
    const byCenter = new Map();
    for (const [x, y, rx, ry, rotation] of ellipses) {
      const key = `${wrap(x)},${wrap(y)}`;
      const shape = [rx, ry, rotation];
      if (!byCenter.has(key)) byCenter.set(key, []);
      byCenter.get(key).push(shape);
    }
    const wrapped = [...byCenter.values()].filter((copies) => copies.length > 1);
    assert.ok(wrapped.length > 5, 'the generated sample exercises several opposite-edge copies');
    for (const copies of wrapped) for (const shape of copies) assert.deepEqual(shape, copies[0]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
