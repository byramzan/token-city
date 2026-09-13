// Central visual-material library for My Hood.
//
// All runtime surface maps are deterministic, original CanvasTextures. Keeping
// them procedural makes the Vite build self-contained while still giving every
// active material the same painterly frequency, mipmap and filtering rules.

import * as THREE from 'three';

export const VISUAL_QUALITY = Object.freeze({
  textureSize: 256,
  terrainTextureSize: 512,
  maxAnisotropy: 8,
  pixelRatioCap: 1.75,
  shadowMapSize: 2048,
  shadowUpdateHz: 20,
});

export const SURFACE_PROFILES = Object.freeze({
  grass:     { size: 512, anisotropy: 8, roughness: 0.98, bumpScale: 0.018 },
  asphalt:   { size: 512, anisotropy: 8, roughness: 0.96, bumpScale: 0.012 },
  pavers:    { size: 256, anisotropy: 8, roughness: 0.94, bumpScale: 0.018 },
  soil:      { size: 256, anisotropy: 4, roughness: 0.98, bumpScale: 0.018 },
  sand:      { size: 256, anisotropy: 4, roughness: 0.96, bumpScale: 0.012 },
  wood:      { size: 256, anisotropy: 4, roughness: 0.86, bumpScale: 0.022 },
  floorWood: { size: 256, anisotropy: 8, roughness: 0.82, bumpScale: 0.018 },
  brick:     { size: 256, anisotropy: 4, roughness: 0.91, bumpScale: 0.028 },
  stone:     { size: 256, anisotropy: 4, roughness: 0.94, bumpScale: 0.024 },
  tech:      { size: 256, anisotropy: 4, roughness: 0.72, bumpScale: 0.01 },
  roof:      { size: 256, anisotropy: 8, roughness: 0.9, bumpScale: 0.026 },
  plaster:   { size: 256, anisotropy: 2, roughness: 0.96, bumpScale: 0.008 },
  fabric:    { size: 128, anisotropy: 2, roughness: 0.98, bumpScale: 0.012 },
  ceramic:   { size: 128, anisotropy: 2, roughness: 0.68, bumpScale: 0.006 },
  metal:     { size: 128, anisotropy: 2, roughness: 0.58, metalness: 0.56, bumpScale: 0.006 },
  plastic:   { size: 128, anisotropy: 2, roughness: 0.72, bumpScale: 0.006 },
  bark:      { size: 128, anisotropy: 4, roughness: 0.96, bumpScale: 0.024 },
  foliage:   { size: 128, anisotropy: 2, roughness: 0.93, bumpScale: 0.01 },
});

let rendererAnisotropy = 4;
const canvasCache = new Map();
const textureCache = new Map();

export function configureMaterialLibrary(renderer) {
  rendererAnisotropy = Math.max(1, Math.min(
    VISUAL_QUALITY.maxAnisotropy,
    renderer?.capabilities?.getMaxAnisotropy?.() || 4,
  ));
  for (const texture of textureCache.values()) {
    const profile = SURFACE_PROFILES[texture.userData.surfaceKind] || {};
    texture.anisotropy = Math.min(profile.anisotropy || 2, rendererAnisotropy);
    texture.needsUpdate = true;
  }
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function tiled(size, x, y, radius, draw) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    const px = x + ox;
    const py = y + oy;
    if (px + radius < 0 || px - radius > size || py + radius < 0 || py - radius > size) continue;
    draw(px, py);
  }
}

function fillNoise(g, size, rnd, colors, count, radius = [2, 8]) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = radius[0] + rnd() * (radius[1] - radius[0]);
    const color = colors[Math.floor(rnd() * colors.length)];
    // Every wrapped copy must be the same shape. Sampling inside `tiled`
    // changes the edge copy and produces visible rectangular tile seams.
    const aspect = 0.55 + rnd() * 0.45;
    const angle = rnd() * Math.PI;
    tiled(size, x, y, r, (px, py) => {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(px, py, r, r * aspect, angle, 0, Math.PI * 2);
      g.fill();
    });
  }
}

function drawSurface(kind, channel) {
  const profile = SURFACE_PROFILES[kind] || SURFACE_PROFILES.plastic;
  const size = profile.size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const seed = [...kind].reduce((sum, char) => sum + char.charCodeAt(0), 17) + (channel === 'color' ? 0 : channel === 'roughness' ? 101 : 211);
  const rnd = mulberry(seed);
  const isColor = channel === 'color';
  const bg = channel === 'roughness' ? '#ececec' : channel === 'height' ? '#858585' : '#f4efe6';
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (kind === 'grass') {
    g.fillStyle = isColor ? '#91c966' : channel === 'height' ? '#888888' : '#f4f4f4';
    g.fillRect(0, 0, size, size);
    const colors = isColor
      ? ['rgba(89,155,67,.20)', 'rgba(177,211,104,.22)', 'rgba(58,131,57,.12)', 'rgba(214,226,133,.18)']
      : channel === 'height' ? ['rgba(35,35,35,.11)', 'rgba(235,235,235,.13)'] : ['rgba(25,25,25,.035)', 'rgba(255,255,255,.025)'];
    fillNoise(g, size, rnd, colors, 54, [18, 54]);
    for (let i = 0; i < 150; i++) {
      const x = rnd() * size, y = rnd() * size;
      const w = 4 + rnd() * 8, h = 3 + rnd() * 7;
      const color = isColor
        ? (rnd() > 0.42 ? 'rgba(47,126,48,.32)' : 'rgba(213,232,139,.34)')
        : channel === 'height' ? 'rgba(225,225,225,.18)' : 'rgba(30,30,30,.03)';
      const lineWidth = 1.8 + rnd() * 1.4;
      tiled(size, x, y, 14, (px, py) => {
        g.strokeStyle = color;
        g.lineWidth = lineWidth;
        g.beginPath();
        g.moveTo(px - w * 0.4, py + h * 0.25);
        g.quadraticCurveTo(px, py - h, px + w * 0.25, py);
        g.stroke();
      });
    }
    if (isColor) {
      const flowers = ['rgba(255,239,165,.78)', 'rgba(255,199,213,.65)', 'rgba(219,210,255,.62)'];
      for (let i = 0; i < 13; i++) {
        const x = rnd() * size, y = rnd() * size;
        const flowerColor = flowers[Math.floor(rnd() * flowers.length)];
        tiled(size, x, y, 5, (px, py) => {
          g.fillStyle = flowerColor;
          for (let a = 0; a < 4; a++) {
            const angle = a * Math.PI / 2;
            g.beginPath(); g.arc(px + Math.cos(angle) * 2, py + Math.sin(angle) * 2, 1.5, 0, Math.PI * 2); g.fill();
          }
        });
      }
    }
  } else if (kind === 'asphalt') {
    g.fillStyle = isColor ? '#777a75' : channel === 'height' ? '#858585' : '#e9e9e9';
    g.fillRect(0, 0, size, size);
    fillNoise(g, size, rnd,
      isColor ? ['rgba(42,45,43,.13)', 'rgba(200,197,181,.12)', 'rgba(255,255,255,.07)']
        : channel === 'height' ? ['rgba(30,30,30,.08)', 'rgba(245,245,245,.1)'] : ['rgba(35,35,35,.025)', 'rgba(255,255,255,.02)'],
      150, [2, 8]);
    fillNoise(g, size, rnd,
      isColor ? ['rgba(45,48,44,.055)', 'rgba(230,224,205,.045)'] : ['rgba(60,60,60,.025)'],
      35, [16, 42]);
  } else if (kind === 'pavers') {
    g.fillStyle = isColor ? '#dfc99f' : channel === 'height' ? '#929292' : '#ececec';
    g.fillRect(0, 0, size, size);
    const mortar = isColor ? 'rgba(91,72,50,.22)' : channel === 'height' ? '#5f5f5f' : '#d2d2d2';
    g.strokeStyle = mortar; g.lineWidth = channel === 'height' ? 6 : 4;
    const rowHeight = size / 6, columnWidth = size / 4;
    for (let row = 0; row <= 6; row++) {
      const y = row * rowHeight;
      g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke();
      const offset = (row % 2) * columnWidth / 2;
      for (let x = offset - columnWidth; x <= size; x += columnWidth) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + rowHeight); g.stroke();
      }
    }
    fillNoise(g, size, rnd, isColor ? ['rgba(255,255,255,.10)', 'rgba(104,75,45,.05)'] : ['rgba(255,255,255,.025)'], 45, [2, 6]);
  } else if (kind === 'wood' || kind === 'floorWood' || kind === 'bark') {
    const vertical = kind !== 'wood';
    g.fillStyle = isColor ? (kind === 'bark' ? '#aa8967' : '#e6c69b') : channel === 'height' ? '#8b8b8b' : '#e8e8e8';
    g.fillRect(0, 0, size, size);
    const board = size / (kind === 'wood' ? 6 : 5);
    g.strokeStyle = isColor ? 'rgba(83,48,25,.22)' : channel === 'height' ? '#696969' : '#d3d3d3';
    g.lineWidth = channel === 'height' ? 5 : 3;
    for (let p = 0; p <= size; p += board) {
      g.beginPath();
      if (vertical) { g.moveTo(p, 0); g.lineTo(p, size); } else { g.moveTo(0, p); g.lineTo(size, p); }
      g.stroke();
    }
    const grain = isColor ? 'rgba(110,68,35,.16)' : channel === 'height' ? 'rgba(30,30,30,.13)' : 'rgba(25,25,25,.025)';
    g.strokeStyle = grain; g.lineWidth = 2;
    for (let i = 0; i < 34; i++) {
      const x = rnd() * size, y = rnd() * size, len = 18 + rnd() * 42;
      tiled(size, x, y, len + 4, (px, py) => {
        g.beginPath();
        if (vertical) { g.moveTo(px, py); g.bezierCurveTo(px + 3, py + len * .3, px - 3, py + len * .7, px, py + len); }
        else { g.moveTo(px, py); g.bezierCurveTo(px + len * .3, py + 3, px + len * .7, py - 3, px + len, py); }
        g.stroke();
      });
    }
    if (isColor && kind !== 'bark') {
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = 'rgba(92,55,29,.16)'; g.lineWidth = 3;
        const x = rnd() * size, y = rnd() * size, width = 8 + rnd() * 7, height = 3 + rnd() * 3;
        tiled(size, x, y, width + 2, (px, py) => {
          g.beginPath(); g.ellipse(px, py, width, height, vertical ? Math.PI / 2 : 0, 0, Math.PI * 2); g.stroke();
        });
      }
    }
  } else if (kind === 'brick' || kind === 'stone' || kind === 'roof') {
    // Even row counts make the alternating masonry bond periodic on both
    // axes, including the height map used by oblique-angle lighting.
    const rows = kind === 'roof' ? 8 : kind === 'stone' ? 4 : 6;
    const rowH = size / rows;
    const colW = size / (kind === 'roof' ? 6 : 4);
    g.fillStyle = isColor ? (kind === 'roof' ? '#e5b39b' : kind === 'brick' ? '#e4b4a2' : '#ddd5c3') : channel === 'height' ? '#999999' : '#ededed';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = isColor ? 'rgba(84,55,42,.22)' : channel === 'height' ? '#585858' : '#d0d0d0';
    g.lineWidth = channel === 'height' ? 7 : 4;
    for (let row = 0; row <= rows; row++) {
      const y = row * rowH;
      g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke();
      const offset = (row % 2) * colW * 0.5;
      for (let x = offset - colW; x <= size; x += colW) {
        g.beginPath();
        g.moveTo(x, y); g.lineTo(x, y + rowH);
        g.stroke();
      }
    }
    fillNoise(g, size, rnd, isColor ? ['rgba(255,255,255,.10)', 'rgba(94,63,40,.055)'] : ['rgba(255,255,255,.02)'], 36, [2, 7]);
  } else if (kind === 'tech') {
    g.fillStyle = isColor ? '#d1d7dd' : channel === 'height' ? '#969696' : '#d7d7d7';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = isColor ? 'rgba(30,48,62,.24)' : channel === 'height' ? '#717171' : '#bcbcbc';
    g.lineWidth = channel === 'height' ? 5 : 3;
    for (let y = 0; y <= size; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
    for (let x = 0; x <= size; x += size / 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
    for (let y = 12; y < size; y += 64) for (let x = 12; x < size; x += size / 3) {
      g.fillStyle = isColor ? 'rgba(25,45,60,.30)' : channel === 'height' ? '#bcbcbc' : '#9e9e9e';
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'plaster') {
    g.fillStyle = isColor ? '#f2ede2' : channel === 'height' ? '#858585' : '#f1f1f1';
    g.fillRect(0, 0, size, size);
    fillNoise(g, size, rnd, isColor ? ['rgba(158,132,94,.035)', 'rgba(255,255,255,.10)'] : channel === 'height' ? ['rgba(30,30,30,.035)', 'rgba(255,255,255,.05)'] : ['rgba(35,35,35,.015)'], 48, [7, 24]);
  } else if (kind === 'fabric') {
    g.fillStyle = isColor ? '#eeeeea' : channel === 'height' ? '#858585' : '#f4f4f4';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = isColor ? 'rgba(45,45,40,.10)' : channel === 'height' ? 'rgba(245,245,245,.18)' : 'rgba(50,50,50,.02)';
    g.lineWidth = 1.5;
    for (let p = 0; p <= size; p += size / 16) {
      g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    }
  } else if (kind === 'soil' || kind === 'sand') {
    g.fillStyle = isColor ? (kind === 'soil' ? '#9a7650' : '#dfc58d') : channel === 'height' ? '#888888' : '#eeeeee';
    g.fillRect(0, 0, size, size);
    fillNoise(g, size, rnd, isColor ? ['rgba(75,49,29,.12)', 'rgba(255,242,194,.12)'] : channel === 'height' ? ['rgba(25,25,25,.08)', 'rgba(255,255,255,.09)'] : ['rgba(20,20,20,.018)'], kind === 'soil' ? 100 : 60, [1.5, 5]);
  } else {
    g.fillStyle = isColor ? '#eeeeea' : channel === 'height' ? '#858585' : (kind === 'metal' ? '#bdbdbd' : '#e6e6e6');
    g.fillRect(0, 0, size, size);
    fillNoise(g, size, rnd, isColor ? ['rgba(50,50,45,.04)', 'rgba(255,255,255,.10)'] : ['rgba(40,40,40,.018)'], 28, [3, 12]);
  }

  return canvas;
}

function canvasFor(kind, channel) {
  const key = `${kind}:${channel}`;
  if (!canvasCache.has(key)) canvasCache.set(key, drawSurface(kind, channel));
  return canvasCache.get(key);
}

export function surfaceTexture(kind, repeat = [1, 1], channel = 'color') {
  const safeKind = SURFACE_PROFILES[kind] ? kind : 'plastic';
  const rep = Array.isArray(repeat) ? repeat : [repeat, repeat];
  const key = `${safeKind}:${channel}:${rep[0]}x${rep[1]}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = new THREE.CanvasTexture(canvasFor(safeKind, channel));
  texture.name = `tc_${safeKind}_${channel}_${rep[0]}x${rep[1]}`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rep[0], rep[1]);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.min(SURFACE_PROFILES[safeKind].anisotropy || 2, rendererAnisotropy);
  texture.userData.surfaceKind = safeKind;
  texture.userData.channel = channel;
  textureCache.set(key, texture);
  return texture;
}

export function surfaceMaps(kind, repeat = [1, 1]) {
  const profile = SURFACE_PROFILES[kind] || SURFACE_PROFILES.plastic;
  return {
    map: surfaceTexture(kind, repeat, 'color'),
    roughnessMap: surfaceTexture(kind, repeat, 'roughness'),
    bumpMap: surfaceTexture(kind, repeat, 'height'),
    roughness: profile.roughness,
    metalness: profile.metalness || 0,
    bumpScale: profile.bumpScale,
  };
}

export function configureCanvasTexture(texture, { anisotropy = 4, mipmaps = true, srgb = true } = {}) {
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(anisotropy, rendererAnisotropy);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const MATERIAL_COLOR_GROUPS = Object.freeze({
  wood: new Set(['#a9835c', '#8a6f4d', '#c89a68', '#7a5b3a', '#6b5540', '#e8b53a']),
  fabric: new Set(['#7aa2f7', '#6b8fe0', '#d96c5f', '#f4a4c0', '#c792ea', '#a06ee0', '#ff8ac2']),
  metal: new Set(['#4c5566', '#3a4152', '#525a6b', '#626b7d', '#8b93a5', '#aeb6c2', '#6d7684', '#dfe3ea', '#2b3245']),
  foliage: new Set(['#5eb85e', '#6cbf5a', '#4f9a55', '#2f6e35', '#35e07f', '#7dbf68', '#6fae5c', '#659e53']),
  ceramic: new Set(['#f7f1e3', '#f4f1de', '#fff3cf', '#cfc6ae', '#e8c15a']),
});

export function inferSurfaceKind(color) {
  const value = String(color || '').toLowerCase();
  for (const [kind, colors] of Object.entries(MATERIAL_COLOR_GROUPS)) {
    if (colors.has(value)) return kind;
  }
  return 'plastic';
}

export function materialLibraryStats() {
  const byKind = {};
  let estimatedBytes = 0;
  for (const texture of textureCache.values()) {
    const kind = texture.userData.surfaceKind;
    byKind[kind] = (byKind[kind] || 0) + 1;
    const width = Number(texture.image?.width) || 0;
    const height = Number(texture.image?.height) || 0;
    estimatedBytes += width * height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
  }
  return {
    textureObjects: textureCache.size,
    sourceCanvases: canvasCache.size,
    estimatedGpuMiB: Number((estimatedBytes / 1024 / 1024).toFixed(2)),
    byKind,
  };
}
