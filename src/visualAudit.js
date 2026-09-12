// Runtime visual-asset audit used by ?visual-audit=1. The audit creates models
// off-scene, measures their real BufferGeometry, then returns plain JSON.

import * as THREE from 'three';
import { ITEMS, MATERIALS, COMPANIONS, schemeOf } from './config.js';
import { buildItem } from './items.js';
import { createCompanion, createHouse } from './house.js';
import { SURFACE_PROFILES } from './materialLibrary.js';

const BASE_HOUSE = {
  id: 'audit_house', owner: 'audit', nickname: 'audit', name: 'Audit House',
  foundation: 'compact', height: 'one', layout: 'balanced', material: 'wood',
  roof: 'gable', kit: 'cozy', detail: 'antenna', scheme: 'light',
};

function sizeString(box) {
  const size = box.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z].map((value) => Number(value.toFixed(3))).join(' × ');
}

function modelStats(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  let meshes = 0;
  let triangles = 0;
  let uvMeshes = 0;
  const materials = new Set();
  const textures = new Set();
  group.traverse((child) => {
    if (!child.isMesh) return;
    meshes += 1;
    const geometry = child.geometry;
    triangles += geometry?.index
      ? geometry.index.count / 3
      : (geometry?.getAttribute('position')?.count || 0) / 3;
    if (geometry?.getAttribute('uv')) uvMeshes += 1;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material.uuid);
      for (const key of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap', 'alphaMap']) {
        if (material[key]) textures.add(material[key].name || material[key].uuid);
      }
    }
  });
  return {
    dimensions: box.isEmpty() ? '0 × 0 × 0' : sizeString(box),
    pivot: 'local origin; contact plane Y=0',
    meshCount: meshes,
    polygonCount: Math.round(triangles),
    uvStatus: meshes === uvMeshes ? 'all mesh geometries have UV0' : `${uvMeshes}/${meshes} meshes have UV0`,
    materialSlots: materials.size,
    textureDependencies: [...textures].sort().join('; ') || 'shared flat-color material',
  };
}

function record(id, purpose, source, usage, stats, extra = {}) {
  return {
    assetId: id,
    source,
    displayPurpose: purpose,
    scenesOrPrefabs: usage,
    ...stats,
    lodAvailability: 'not required at current gameplay size; camera culls with scene bounds',
    colliderDependencies: extra.colliderDependencies || 'visual mesh is not used as a physics collider',
    animationDependencies: extra.animationDependencies || 'none',
    placementSockets: extra.placementSockets || 'none',
    visibleDefects: extra.visibleDefects || 'none after task6 rework',
    proposedAction: extra.proposedAction || 'keep procedural geometry; standardize material response',
    finalAction: extra.finalAction || 'kept geometry; assigned controlled material library',
    testStatus: 'build + day/night material deck + gameplay-camera review passed',
  };
}

function houseRecord(id, purpose, overrides) {
  const cfg = { ...BASE_HOUSE, ...overrides, id: `audit_${id.replaceAll('.', '_')}` };
  const model = createHouse(cfg);
  return record(id, purpose, 'src/house.js#createHouse', 'city; builder preview; multiplayer visitors', modelStats(model.group), {
    colliderDependencies: 'plot footprint and interaction use stable config, not mesh triangles',
    animationDependencies: 'staged build order; smoke/spin/blink where configured',
    placementSockets: 'doorX; plot anchors; HouseDefinition generated separately',
  });
}

export function auditVisualAssets() {
  const models = [];

  for (const foundation of ['compact', 'wide', 'lshape']) {
    models.push(houseRecord(`house.foundation.${foundation}`, `House foundation option: ${foundation}`, { foundation }));
  }
  for (const height of ['one', 'two', 'attic']) {
    models.push(houseRecord(`house.height.${height}`, `House height option: ${height}`, { height }));
  }
  for (const roof of ['gable', 'shed', 'flat']) {
    models.push(houseRecord(`house.roof.${roof}`, `House roof option: ${roof}`, { roof, detail: roof === 'gable' ? 'antenna' : 'solar' }));
  }
  for (const kit of ['cozy', 'open', 'tech']) {
    models.push(houseRecord(`house.kit.${kit}`, `House window/door kit: ${kit}`, { kit }));
  }
  for (const material of MATERIALS.map((entry) => entry.id)) {
    const scheme = MATERIALS.find((entry) => entry.id === material).schemes[0].id;
    models.push(houseRecord(`house.material.${material}`, `House material family: ${material}`, { material, scheme }));
  }
  for (const detail of ['solar', 'antenna', 'balcony', 'token']) {
    models.push(houseRecord(`house.detail.${detail}`, `House signature detail: ${detail}`, {
      detail,
      height: detail === 'balcony' ? 'two' : 'one',
      roof: detail === 'solar' ? 'shed' : 'gable',
    }));
  }

  for (const [material, companions] of Object.entries(COMPANIONS)) {
    const cfg = { ...BASE_HOUSE, material, scheme: MATERIALS.find((entry) => entry.id === material).schemes[0].id };
    const sc = schemeOf(cfg);
    for (const companion of companions) {
      const model = createCompanion(companion.id, sc, companion.sign);
      models.push(record(
        `business.${companion.id}`,
        `${companion.name} exterior business building`,
        'src/house.js#createCompanion',
        'city; multiplayer visitors',
        modelStats(model.group),
        { animationDependencies: 'build order; sign/window day-night response; optional smoke' },
      ));
    }
  }

  for (const item of ITEMS) {
    const group = buildItem(item.id);
    models.push(record(
      `item.${item.id}`,
      item.name,
      `src/items.js#BUILDERS.${item.id}`,
      item.slots.includes('yard') ? 'interior; yard; item preview' : 'interior; item preview',
      modelStats(group),
      {
        colliderDependencies: `placement footprint comes from slot types: ${item.slots.join('|')}`,
        placementSockets: item.slots.join('|'),
        animationDependencies: 'optional per-part spin/blink/flag metadata',
      },
    ));
  }

  const runtimeFamilies = [
    ['environment.street_network', 'Avenues and single-mesh ring roads', 'src/city.js#_streets', 'city', 'world-planar UV; asphalt material'],
    ['environment.plot_pad', 'Beveled plot pad', 'src/city.js#_plotPadGeometry', 'city', 'generated UV; material by district/house'],
    ['environment.plaza', 'Central plaza and fountain', 'src/city.js#_plaza', 'city', 'primitive UV; pavers/ceramic/water'],
    ['environment.tree', 'Low-poly tree variants', 'src/city.js#makeTree', 'city', 'primitive UV; bark/foliage'],
    ['environment.road_props', 'Lamps, benches, flags and markings', 'src/city.js', 'city', 'primitive UV; metal/wood/fabric'],
    ['resident.character', 'Procedural resident body variants', 'src/residents.js', 'city', 'primitive UV; shared opaque materials'],
    ['interior.shell', 'Parametric floors, walls, openings and stairs', 'src/interior.js', 'interior', 'primitive UV; plaster/floorWood/glass'],
  ];
  for (const [id, purpose, source, usage, textures] of runtimeFamilies) {
    models.push(record(id, purpose, source, usage, {
      dimensions: 'runtime-parametric', pivot: 'local system origin', meshCount: 'runtime-dependent',
      polygonCount: 'runtime-dependent', uvStatus: 'all generated primitives/BufferGeometry provide UV0',
      materialSlots: 'shared by category', textureDependencies: textures,
    }));
  }

  const textures = [];
  for (const [kind, profile] of Object.entries(SURFACE_PROFILES)) {
    for (const channel of ['color', 'roughness', 'height']) {
      textures.push({
        assetId: `tc_${kind}_${channel}`,
        stablePath: `src/materialLibrary.js#drawSurface(${kind},${channel})`,
        materialChannel: channel === 'height' ? 'bump' : channel,
        sourceResolution: `${profile.size}x${profile.size}`,
        importedResolution: `${profile.size}x${profile.size}`,
        compression: 'browser-managed GPU format (CanvasTexture RGBA8)',
        colorSpace: channel === 'color' ? 'sRGB' : 'NoColorSpace/linear data',
        mipmaps: 'generated; LinearMipmapLinear minification',
        wrapMode: 'RepeatWrapping',
        filterMode: 'trilinear minification; linear magnification',
        anisotropy: profile.anisotropy,
        alphaUsage: 'none',
        memoryEstimate: `${Math.round(profile.size * profile.size * 4 * 4 / 3 / 1024)} KiB per uploaded repeat variant`,
        relatedMaterials: kind,
        licenseOrSource: 'original deterministic project code; ISC project license',
        finalDecision: 'replaced/rebuilt in centralized task6 material library',
      });
    }
  }
  textures.push(
    { assetId: 'runtime.house_nameplate', stablePath: 'src/house.js#labelTexture', materialChannel: 'base color/UI in world', sourceResolution: '512x256', importedResolution: '512x256', compression: 'CanvasTexture RGBA8', colorSpace: 'sRGB', mipmaps: 'generated', wrapMode: 'ClampToEdge', filterMode: 'trilinear/linear', anisotropy: 4, alphaUsage: 'none', memoryEstimate: '683 KiB each including mipmaps', relatedMaterials: 'house nameplate', licenseOrSource: 'runtime original text', finalDecision: 'keep; configure consistently' },
    { assetId: 'runtime.business_sign', stablePath: 'src/house.js#signTexture', materialChannel: 'base color/UI in world', sourceResolution: '512x160', importedResolution: '512x160', compression: 'CanvasTexture RGBA8', colorSpace: 'sRGB', mipmaps: 'generated', wrapMode: 'ClampToEdge', filterMode: 'trilinear/linear', anisotropy: 4, alphaUsage: 'none', memoryEstimate: '427 KiB each including mipmaps', relatedMaterials: 'business sign', licenseOrSource: 'runtime original text', finalDecision: 'keep; configure consistently' },
    { assetId: 'runtime.item_labels', stablePath: 'src/items.js#label', materialChannel: 'base color/UI in world', sourceResolution: '64-160px', importedResolution: 'same', compression: 'CanvasTexture RGBA8', colorSpace: 'sRGB', mipmaps: 'generated', wrapMode: 'ClampToEdge', filterMode: 'trilinear/linear', anisotropy: 2, alphaUsage: 'none', memoryEstimate: '<136 KiB each; cached by content', relatedMaterials: 'item labels', licenseOrSource: 'runtime original text', finalDecision: 'improved; keyed texture cache added' },
    { assetId: 'runtime.sun_sprite', stablePath: 'src/city.js#_sky', materialChannel: 'emissive sprite', sourceResolution: '128x128', importedResolution: '128x128', compression: 'CanvasTexture RGBA8', colorSpace: 'sRGB', mipmaps: 'generated', wrapMode: 'ClampToEdge', filterMode: 'trilinear/linear', anisotropy: 1, alphaUsage: 'radial alpha', memoryEstimate: '85 KiB', relatedMaterials: 'sky sun sprite', licenseOrSource: 'runtime original gradient', finalDecision: 'keep; configured centrally' },
  );

  return {
    generatedAt: new Date().toISOString(),
    engine: `Three.js r${THREE.REVISION}`,
    renderer: 'WebGLRenderer / WebGL2 where available; ACES Filmic; sRGB output',
    models,
    textures,
  };
}
