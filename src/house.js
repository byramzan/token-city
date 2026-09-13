// Procedural low-poly house v2: foundation shape × height × material × roof ×
// window kit × signature detail × ready-made color scheme.
// Every part carries userData.order for the staged build animation.
// Window glass / sign materials are cloned per building so the day-night cycle
// can switch lights on at slightly different moments (spec §9, §17).

import * as THREE from 'three';
import { tween, Ease } from './tween.js';
import { schemeOf, floorCountFor } from './config.js';
import { configureCanvasTexture, surfaceMaps } from './materialLibrary.js';
// The exterior doorway frame layout is shared with the flicker regression test.
import { exteriorDoorFrameLayout } from '../server/doorGeometry.js';

const matCache = new Map();

export function sharedMaterialCount() {
  return matCache.size;
}

export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const {
      textureKind = null,
      textureRepeat = [1, 1],
      ...materialOpts
    } = opts;
    const maps = textureKind ? surfaceMaps(textureKind, textureRepeat) : {};
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      ...maps,
      emissive: textureKind === 'tech' ? color : '#000000',
      emissiveIntensity: textureKind === 'tech' ? 0.07 : 0,
      roughness: maps.roughness ?? 0.9,
      metalness: textureKind === 'tech' ? 0.08 : (maps.metalness ?? 0),
      flatShading: true,
      ...materialOpts,
    }));
    matCache.get(key).userData.sharedMaterial = true;
  }
  return matCache.get(key);
}

export function glowMat(color, intensity = 0.5) {
  return mat(color, { emissive: color, emissiveIntensity: intensity });
}

function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A shed roof is a rotated box, so a single textured material also paints its
// underside. At a grazing camera angle those dense roof lines alias into the
// "stuck" horizontal bands from the bug report. Keep the tile pattern on the
// upper face only and give the fascia/soffit calm, untextured materials.
function shedRoofBox(w, h, d, color, opts) {
  const fascia = mat(shade(color, -10));
  const upper = mat(color, opts);
  const soffit = mat(shade(color, -18));
  const materials = [fascia, fascia, upper, soffit, fascia, fascia];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Explicit triangular prism: stable normals and no oversized/rotated cylinder
// faces that could clip across the camera on some WebGL drivers.
function prism(width, height, depth, color, opts = {}) {
  const hw = width / 2;
  const hd = depth / 2;
  const positions = new Float32Array([
    -hw, 0, -hd,  hw, height, 0,  hw, 0, -hd,
    -hw, 0, -hd, -hw, height, 0,  hw, height, 0,
    -hw, 0,  hd,  hw, 0,  hd,  hw, height, 0,
    -hw, 0,  hd,  hw, height, 0, -hw, height, 0,
    -hw, 0, -hd,  hw, 0, -hd,  hw, 0,  hd,
    -hw, 0, -hd,  hw, 0,  hd, -hw, 0,  hd,
    -hw, 0, -hd, -hw, 0,  hd, -hw, height, 0,
     hw, 0, -hd,  hw, height, 0,  hw, 0,  hd,
  ]);
  const uv = new Float32Array([
    0, 0, 1, 0, 1, 1,  0, 0, 1, 1, 0, 1,
    0, 0, 0, 1, 1, 1,  0, 0, 1, 1, 1, 0,
    0, 0, 0, 1, 1, 1,  0, 0, 1, 1, 1, 0,
    0, 0, 1, 0, .5, 1,  0, 0, 1, 0, .5, 1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // Only the two sloped planes use the roof pattern. A calm soffit and gable
  // remove the high-frequency underside bands that used to shimmer at grazing
  // angles and also avoid pretending the tile sheet wraps around the model.
  geo.clearGroups();
  geo.addGroup(0, 12, 0);
  geo.addGroup(12, 6, 1);
  geo.addGroup(18, 6, 2);
  const m = new THREE.Mesh(geo, [
    mat(color, opts),
    mat(shade(color, -18)),
    mat(shade(color, -10)),
  ]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function labelTexture(name, nick) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f1e3';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#c9b98a'; g.lineWidth = 14;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = '#3f3a33';
  g.font = '800 62px "Baloo 2", "Comic Sans MS", sans-serif';
  g.textAlign = 'center';
  g.fillText(clip(g, name, 460), 256, 118);
  g.fillStyle = '#8a7f6a';
  g.font = '700 44px "Baloo 2", "Comic Sans MS", sans-serif';
  g.fillText(clip(g, '@' + nick, 460), 256, 192);
  return configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 4 });
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = fg; g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 144);
  g.fillStyle = fg;
  g.font = '800 86px "Baloo 2", "Comic Sans MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(clip(g, text, 460), 256, 86);
  return configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 4 });
}

function clip(g, text, max) {
  while (g.measureText(text).width > max && text.length > 3) text = text.slice(0, -2) + '…';
  return text;
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt / 100)));
  return '#' + c.getHexString();
}

/** Footprint sizes per foundation. */
export function footprint(foundation) {
  if (foundation === 'wide') return { W: 7.0, D: 4.2 };
  if (foundation === 'lshape') return { W: 4.8, D: 4.4, wingW: 2.7, wingD: 3.4 };
  return { W: 4.8, D: 4.4 };
}

/**
 * Builds a house from a v2 config:
 * { foundation, height, material, roof, kit, detail, scheme, name, nickname }
 * Returns { group, parts, anim, winMats, signMats }.
 */
export function createHouse(cfg) {
  const group = new THREE.Group();
  const parts = [];
  const anim = [];
  const winMats = [];
  const signMats = [];
  let order = 0;
  const add = (mesh, o = order) => {
    mesh.userData.order = o;
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  };

  const sc = schemeOf(cfg);
  const { W, D, wingW, wingD } = footprint(cfg.foundation);
  const floorH = 2.5;
  const floors = floorCountFor(cfg);
  const hasAttic = false;
  const hasWing = cfg.foundation === 'lshape';
  const wallTexture = { textureKind: cfg.material, textureRepeat: [2.5, 2] };
  const roofTexture = { textureKind: cfg.material === 'tech' ? 'tech' : 'roof', textureRepeat: [2.5, 2] };

  // per-house glass material — the night cycle raises its emissive
  const glass = new THREE.MeshStandardMaterial({
    color: '#fff3cf', emissive: '#ffe9a8', emissiveIntensity: 0.08,
    flatShading: true, roughness: 0.72, transparent: true, opacity: 0.76,
    depthWrite: false, side: THREE.FrontSide,
  });
  winMats.push(glass);

  // ── 1. Base slab ──
  const baseH = 0.45;
  add(box(W + 0.8, baseH, D + 0.8, sc.trim)).position.y = baseH / 2;
  if (hasWing) {
    const wb = add(box(wingW + 0.6, baseH, wingD + 0.6, sc.trim));
    wb.position.set(W / 2 + wingW / 2 - 0.2, baseH / 2, D / 2 - wingD / 2 + 0.9);
  }
  const baseY = baseH;
  order++;

  // ── 2. Walls (main + optional wing) ──
  for (let f = 0; f < floors; f++) {
    const body = add(box(W, floorH, D, sc.wall, wallTexture), order + f);
    body.position.y = baseY + floorH / 2 + f * floorH;
    body.userData.floorIndex = f;
    if (f > 0) {
      const slab = add(box(W + 0.08, 0.12, D + 0.08, sc.trim), order + f);
      slab.position.y = baseY + f * floorH;
      slab.userData.floorIndex = f;
    }
  }
  let wingTop = 0;
  if (hasWing) {
    for (let f = 0; f < floors; f++) {
      const wing = add(box(wingW, floorH, wingD, sc.wall, wallTexture), order + f);
      wing.position.set(W / 2 + wingW / 2 - 0.2, baseY + floorH / 2 + f * floorH, D / 2 - wingD / 2 + 0.9);
      wing.userData.floorIndex = f;
    }
    wingTop = baseY + floors * floorH;
  }
  order += floors;
  const topY = baseY + floors * floorH;

  // ── material trims ──
  if (cfg.material === 'wood') {
    for (let f = 0; f < floors; f++) {
      for (const dy of [0.5, 1.6]) {
        const beam = add(box(W + 0.14, 0.15, D + 0.14, sc.trim));
        beam.position.y = baseY + f * floorH + dy;
      }
    }
  } else if (cfg.material === 'brick') {
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pil = add(box(0.4, floors * floorH, 0.4, sc.trim));
      pil.position.set(px * (W / 2), baseY + (floors * floorH) / 2, pz * (D / 2));
    }
    const lintel = add(box(W + 0.16, 0.16, D + 0.16, sc.trim));
    lintel.position.y = baseY + floorH - 0.08;
  } else if (cfg.material === 'stone') {
    const cornice = add(box(W + 0.32, 0.2, D + 0.32, sc.trim));
    cornice.position.y = topY - 0.1;
    const skirt = add(box(W + 0.22, 0.35, D + 0.22, sc.trim));
    skirt.position.y = baseY + 0.18;
  } else if (cfg.material === 'tech') {
    for (const px of [-W / 4, W / 4]) {
      const seam = add(box(0.12, floors * floorH, D + 0.1, sc.trim));
      seam.position.set(px, baseY + (floors * floorH) / 2, 0);
    }
    const neon = add(new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.07, 0.07), null));
    neon.material = new THREE.MeshStandardMaterial({
      color: sc.accent, emissive: sc.accent, emissiveIntensity: 0.9, flatShading: true,
    });
    signMats.push(neon.material);
    neon.position.set(0, topY - 0.18, D / 2 + 0.07);
    neon.castShadow = false;
  }
  order++;

  // ── 3. Door + windows (kit) ──
  const doorW = cfg.kit === 'open' ? 1.4 : 1.05;
  const doorG = new THREE.Group();
  // task8 §22: the old frame shared exact face planes with itself — the header
  // ended on the jamb's outer face and both boxes had the same depth and top
  // height, so the two upper corners of every doorway z-fought while the camera
  // moved. The parts now interpenetrate: jambs run past the header, the header
  // is wider and deeper than the jambs, and the whole frame is embedded into
  // the wall instead of floating in front of it.
  const doorLayout = exteriorDoorFrameLayout({ doorWidth: doorW });
  const dFrameParts = [];
  for (const jambSpec of doorLayout.jambs) {
    const jamb = box(...jambSpec.size, sc.trim);
    jamb.position.set(...jambSpec.centre);
    dFrameParts.push(jamb);
  }
  const dHeader = box(...doorLayout.header.size, sc.trim);
  dHeader.position.set(...doorLayout.header.centre);
  dFrameParts.push(dHeader);
  const dPanel = box(...doorLayout.panel.size, shade(sc.trim, -16));
  dPanel.position.set(...doorLayout.panel.centre);
  const dKnob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat('#e8c15a'));
  dKnob.position.set(doorW / 2 - 0.2, 0.86, 0.15);
  const dStep = box(doorW + 0.3, 0.13, 0.5, '#c7c0b2');
  dStep.position.set(0, 0.06, 0.4);
  doorG.add(...dFrameParts, dPanel, dKnob, dStep);
  if (cfg.kit === 'tech') { // glowing doorway outline
    const outline = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.42, 2.06, 0.09),
      new THREE.MeshStandardMaterial({ color: sc.accent, emissive: sc.accent, emissiveIntensity: 0.8, flatShading: true }));
    outline.position.set(0, 1.0, -0.02);
    signMats.push(outline.material);
    doorG.add(outline);
  }
  if (cfg.kit === 'cozy') { // small porch
    const canopy = box(doorW + 0.9, 0.13, 1.0, sc.roof);
    canopy.position.set(0, 2.25, 0.45);
    for (const px of [-1, 1]) {
      const post = box(0.12, 1.1, 0.12, sc.trim);
      post.position.set(px * (doorW / 2 + 0.3), 1.7, 0.82);
      doorG.add(post);
    }
    doorG.add(canopy);
  }
  if (cfg.kit === 'open') { // simple awning
    const awn = box(doorW + 1.2, 0.1, 0.9, sc.accent);
    awn.position.set(0, 2.2, 0.42);
    awn.rotation.x = 0.18;
    doorG.add(awn);
  }
  const doorX = hasWing ? -W / 4 : 0;
  // The frame is seated 2 cm into the wall. A doorway floating in front of an
  // uncut wall left a visible seam at shallow angles, and seating it exactly on
  // the wall face would put two opaque planes in the same place.
  doorG.position.set(doorX, baseY, D / 2 + doorLayout.wallOffset);
  add(doorG);

  // window factory per kit
  const mkWindow = (side = false) => {
    const g = new THREE.Group();
    let w = 0.95, h = 1.05, bars = true;
    if (cfg.kit === 'open') { w = side ? 1.1 : 1.5; h = 1.15; bars = false; }
    if (cfg.kit === 'tech') { w = 0.5; h = 1.65; bars = false; }
    const frameCol = cfg.kit === 'tech' ? shade(sc.trim, -12) : '#f7f1e3';
    const frameParts = [];
    for (const x of [-1, 1]) {
      const sideBar = box(0.1, h + 0.2, 0.12, frameCol);
      sideBar.position.x = x * (w / 2 + 0.05);
      frameParts.push(sideBar);
    }
    for (const y of [-1, 1]) {
      const rail = box(w, 0.1, 0.12, frameCol);
      rail.position.y = y * (h / 2 + 0.05);
      frameParts.push(rail);
    }
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
    gl.position.z = 0.075;
    gl.renderOrder = 2;
    g.add(...frameParts, gl);
    if (bars) {
      const bV = box(0.07, h, 0.14, shade(frameCol, -20)); bV.position.z = 0.03;
      const bH = box(w, 0.07, 0.14, shade(frameCol, -20)); bH.position.z = 0.03;
      g.add(bV, bH);
    }
    if (!side && cfg.kit !== 'tech') {
      const sill = box(w + 0.32, 0.1, 0.24, frameCol);
      sill.position.set(0, -(h / 2 + 0.13), 0.07);
      g.add(sill);
    }
    return g;
  };

  const frontXs = cfg.foundation === 'wide' ? [-2.4, 0, 2.4] : [1.5];
  if (cfg.foundation !== 'wide' && !hasWing) frontXs.unshift(-1.5);
  for (let f = 0; f < floors; f++) {
    const wy = baseY + f * floorH + 1.35;
    for (const wx of frontXs) {
      if (f === 0 && Math.abs(wx - doorX) < 1.2) continue; // keep the door clear
      const wf = mkWindow();
      wf.position.set(wx, wy, D / 2 + 0.13);
      add(wf);
    }
    for (const wx of cfg.foundation === 'wide' ? [-2.4, 2.4] : [-1.4, 1.4]) {
      const wb = mkWindow();
      wb.position.set(wx, wy, -D / 2 - 0.13);
      wb.rotation.y = Math.PI;
      add(wb);
    }
    const ws = mkWindow(true);
    ws.position.set(-W / 2 - 0.13, wy, 0);
    ws.rotation.y = -Math.PI / 2;
    add(ws);
  }
  if (hasWing) { // repeat the matching wing shell and windows on every floor
    for (let f = 0; f < floors; f++) {
      const ww = mkWindow();
      ww.position.set(W / 2 + wingW / 2 - 0.2, baseY + f * floorH + 1.35, D / 2 - wingD / 2 + 0.9 + wingD / 2 + 0.13);
      add(ww);
    }
  }
  order++;

  // ── 4. Roof ──
  const roofH = hasAttic ? 2.15 : 1.5;
  const roofStart = parts.length;
  if (cfg.roof === 'gable' || (hasAttic && cfg.roof === 'flat')) {
    const r = add(prism(W + 1.0, roofH, D + 1.0, sc.roof, roofTexture));
    r.position.y = topY;
    for (const sz of [-1, 1]) {
      const fascia = add(box(W + 1.1, 0.15, 0.15, shade(sc.roof, -10)));
      fascia.position.set(0, topY + 0.04, sz * (D / 2 + 0.5));
    }
    if (hasAttic) { // dormer window in the roof
      const dormer = new THREE.Group();
      const dbox = box(1.3, 1.15, 1.1, sc.wall, wallTexture);
      const dwin = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), glass);
      dwin.position.set(0, 0.05, 0.62);
      const droof = prism(1.5, 0.6, 1.3, sc.roof, roofTexture);
      droof.position.y = 0.58;
      dormer.add(dbox, dwin, droof);
      const dormerZ = D / 2 - 0.55;
      const roofHalfDepth = (D + 1.0) / 2;
      const roofSurfaceY = roofH * (1 - Math.abs(dormerZ) / roofHalfDepth);
      // Sit the dormer on top of the slope. Previously its lower half
      // intersected the roof, producing horizontal z-fighting bands.
      dormer.position.set(
        hasWing ? -0.9 : 0.9,
        topY + roofSurfaceY + 0.08 + 1.15 / 2,
        dormerZ,
      );
      add(dormer);
    }
    // chimney + smoke for warm materials
    if (cfg.material === 'wood' || cfg.material === 'brick') {
      const chim = add(box(0.5, 1.1, 0.5, sc.trim));
      chim.position.set(-W / 4, topY + roofH * 0.55, -0.8);
      const cap = add(box(0.64, 0.13, 0.64, shade(sc.trim, -14)));
      cap.position.set(-W / 4, topY + roofH * 0.55 + 0.6, -0.8);
      const smoke = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0),
          new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 1, flatShading: true }));
        puff.userData.k = i / 3;
        smoke.add(puff);
      }
      smoke.position.set(-W / 4, topY + roofH * 0.55 + 0.8, -0.8);
      smoke.userData.smoke = true;
      add(smoke);
      anim.push(smoke);
    }
  } else if (cfg.roof === 'shed') {
    const slope = hasAttic ? 0.34 : 0.22;
    const roofDepth = D + 1.3;
    const roofThickness = 0.28;
    const halfRise = Math.sin(slope) * roofDepth / 2;
    const r = add(shedRoofBox(W + 1.0, roofThickness, roofDepth, sc.roof, roofTexture));
    // A visible clearance keeps the wall and roof out of the same depth range;
    // the dark fascia closes the seam so there is no floating-roof gap.
    r.position.y = topY + 0.24 + halfRise + roofThickness / 2;
    r.rotation.x = slope;
    const backHeight = Math.max(hasAttic ? 1.4 : 0.8, halfRise * 2 + 0.12);
    const backWall = add(box(W, backHeight, 0.25, sc.wall, wallTexture));
    backWall.position.set(0, topY + backHeight / 2, -D / 2 + 0.15);
    if (hasAttic) {
      const aw = mkWindow();
      aw.position.set(0.9, topY + 0.75, -D / 2 + 0.33);
      aw.rotation.y = Math.PI;
      add(aw);
    }
  } else { // flat
    const r = add(box(W + 0.5, 0.3, D + 0.5, sc.roof, roofTexture));
    r.position.y = topY + 0.15;
    for (const [sx, sz, w, d] of [[0, 1, W + 0.5, 0.15], [0, -1, W + 0.5, 0.15], [1, 0, 0.15, D + 0.5], [-1, 0, 0.15, D + 0.5]]) {
      const par = add(box(w, 0.34, d, shade(sc.roof, -8)));
      par.position.set(sx * (W / 2 + 0.18), topY + 0.44, sz * (D / 2 + 0.18));
    }
  }
  if (hasWing) { // small matching roof over the wing
    const wr = cfg.roof === 'flat'
      ? box(wingW + 0.4, 0.24, wingD + 0.4, sc.roof, roofTexture)
      : prism(wingW + 0.5, 0.9, wingD + 0.5, sc.roof, roofTexture);
    wr.position.set(W / 2 + wingW / 2 - 0.2, wingTop + (cfg.roof === 'flat' ? 0.12 : 0), D / 2 - wingD / 2 + 0.9);
    add(wr);
  }
  for (const part of parts.slice(roofStart)) {
    part.userData.roof = true;
    part.userData.topFloorIndex = floors - 1;
  }
  group.userData.floorCount = floors;
  group.userData.roofElevation = topY;
  order++;

  // ── 5. Signature detail ──
  const detailTop = cfg.roof === 'flat' ? topY + 0.3 : topY + roofH;
  if (cfg.detail === 'solar' && cfg.roof !== 'gable') {
    for (const px of [-1.3, 1.3]) {
      const panel = add(box(2.0, 0.1, 1.5, '#1c3a5e'));
      panel.position.set(px, (cfg.roof === 'flat' ? topY + 0.62 : topY + 1.25), 0);
      panel.rotation.x = -0.3;
      const rim = add(box(2.1, 0.05, 1.6, '#dfe3ea'));
      rim.position.copy(panel.position);
      rim.position.y -= 0.06;
      rim.rotation.x = -0.3;
    }
  } else if (cfg.detail === 'antenna') {
    const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 2.2, 6), mat('#8b93a5')));
    mast.position.set(W / 4, detailTop + 1.0, 0);
    const bar = add(box(0.8, 0.06, 0.06, '#8b93a5'));
    bar.position.set(W / 4, detailTop + 1.6, 0);
    const beacon = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), glowMat('#ff5d5d', 1.2)));
    beacon.position.set(W / 4, detailTop + 2.15, 0);
    beacon.userData.blink = true;
    anim.push(beacon);
  } else if (cfg.detail === 'balcony' && floors + (hasAttic ? 1 : 0) > 1) {
    const by = baseY + floorH + 0.95;
    const plat = add(box(2.2, 0.15, 1.0, sc.trim));
    plat.position.set(doorX, by, D / 2 + 0.5);
    for (let i = -1; i <= 1; i += 0.4) {
      const barR = add(box(0.07, 0.6, 0.07, '#f0ead9'));
      barR.position.set(doorX + i * 1.0, by + 0.36, D / 2 + 0.95);
    }
    const rail = add(box(2.2, 0.08, 0.08, '#f0ead9'));
    rail.position.set(doorX, by + 0.68, D / 2 + 0.95);
  } else if (cfg.detail === 'token') {
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), mat('#8b93a5')));
    pole.position.set(0, detailTop + 0.5, 0);
    const coin = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.15, 14), glowMat('#ffd166', 0.55)));
    coin.rotation.x = Math.PI / 2;
    coin.position.set(0, detailTop + 1.6, 0);
    coin.userData.spin = true;
    anim.push(coin);
  }
  order++;

  // ── nameplate ──
  if (cfg.name) {
    const post = add(box(0.12, 1.05, 0.12, '#8a6f4d'));
    post.position.set(doorX + 2.0, 0.52, D / 2 + 1.7);
    const back = add(box(1.95, 1.0, 0.08, '#8a6f4d'));
    back.position.set(doorX + 2.0, 1.3, D / 2 + 1.64);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.85, 0.92),
      new THREE.MeshBasicMaterial({ map: labelTexture(cfg.name, cfg.nickname || '???'), toneMapped: false })
    );
    sign.position.set(doorX + 2.0, 1.3, D / 2 + 1.7);
    add(sign);
  }

  group.userData.cfg = cfg;
  return { group, parts, anim, winMats, signMats, doorX };
}

/**
 * Companion public building (spec §12) — smaller than the house, reuses the
 * house scheme, gets a big readable sign that lights up in the evening.
 * Returns { group, parts, anim, signMats, winMats, spot } — spot: local point
 * in front of the entrance where residents gather.
 */
export function createCompanion(type, sc, signText) {
  const group = new THREE.Group();
  const parts = [];
  const anim = [];
  const signMats = [];
  const winMats = [];
  let order = 0;
  const add = (mesh, o = order) => {
    mesh.userData.order = o;
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  };
  const W = 3.6, D = 3.0, H = 2.3;
  const wall = shade(sc.wall, 4);
  const textureKind = type === 'techstore' || type === 'arcade'
    ? 'tech'
    : type === 'bakery' || type === 'workshop'
      ? 'brick'
      : type === 'library' || type === 'gallery'
        ? 'stone'
        : 'wood';
  const wallTexture = { textureKind, textureRepeat: [2, 1.5] };
  const roofTexture = { textureKind: textureKind === 'tech' ? 'tech' : 'roof', textureRepeat: [2, 1.5] };

  const glass = new THREE.MeshStandardMaterial({
    color: '#fff3cf', emissive: '#ffe9a8', emissiveIntensity: 0.08,
    flatShading: true, roughness: 0.72, transparent: true, opacity: 0.76,
    depthWrite: false, side: THREE.FrontSide,
  });
  winMats.push(glass);

  add(box(W + 0.6, 0.35, D + 0.6, sc.trim)).position.y = 0.17;
  order++;
  const body = add(box(W, H, D, wall, wallTexture));
  body.position.y = 0.35 + H / 2;
  order++;

  // roof differs from the house for variety
  if (type === 'library' || type === 'gallery') {
    const r = add(box(W + 0.5, 0.26, D + 0.5, sc.roof, roofTexture));
    r.position.y = 0.35 + H + 0.13;
    for (const px of [-1, 1]) { // little columns
      const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, H, 7), mat('#f0ead9')));
      col.position.set(px * (W / 2 - 0.35), 0.35 + H / 2, D / 2 + 0.28);
    }
  } else if (type === 'techstore' || type === 'arcade') {
    const r = add(box(W + 0.4, 0.24, D + 0.4, sc.roof, roofTexture));
    r.position.y = 0.35 + H + 0.12;
    const neon = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.07, 0.07),
      new THREE.MeshStandardMaterial({ color: sc.accent, emissive: sc.accent, emissiveIntensity: 0.9, flatShading: true }));
    neon.position.set(0, 0.35 + H + 0.28, D / 2 + 0.2);
    signMats.push(neon.material);
    add(neon);
  } else {
    const r = add(prism(W + 0.7, 1.1, D + 0.7, sc.roof, roofTexture));
    r.position.y = 0.35 + H;
    if (type === 'bakery') {
      const chim = add(box(0.4, 0.8, 0.4, sc.trim));
      chim.position.set(W / 4, 0.35 + H + 0.75, -0.5);
      const smoke = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0),
          new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 1, flatShading: true }));
        puff.userData.k = i / 3;
        smoke.add(puff);
      }
      smoke.position.set(W / 4, 0.35 + H + 1.25, -0.5);
      smoke.userData.smoke = true;
      add(smoke);
      anim.push(smoke);
    }
  }
  order++;

  // storefront: door + big window
  // Seated into the wall rather than floating in front of it (task8 §22.3).
  const door = add(box(0.95, 1.6, 0.14, shade(sc.trim, -14)));
  door.position.set(-W / 4, 0.35 + 0.8, D / 2 + 0.04);
  const win = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), glass));
  win.position.set(W / 4, 0.35 + 1.15, D / 2 + 0.16);
  win.renderOrder = 2;
  for (const x of [-1, 1]) {
    const frame = add(box(0.1, 1.3, 0.12, '#f7f1e3'));
    frame.position.set(W / 4 + x * 0.8, 0.35 + 1.15, D / 2 + 0.11);
  }
  for (const y of [-1, 1]) {
    const frame = add(box(1.5, 0.1, 0.12, '#f7f1e3'));
    frame.position.set(W / 4, 0.35 + 1.15 + y * 0.6, D / 2 + 0.11);
  }
  order++;

  // big sign above the entrance — glows at night. It is mounted on a short
  // bracket that stands PROUD of the roof overhang (prism roofs reach past the
  // wall front), so the text is never hidden under the eaves and never
  // z-fights the soffit. Sized to fit the clear band above the window.
  const signW = 2.4, signH = 0.62;
  const signY = 0.35 + H - 0.42;          // clear of the window below, under the ridge
  const signZ = D / 2 + 0.55;             // in front of the roof overhang (front edge ≈ D/2+0.35)
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(signText, sc.accent, '#ffffff'), toneMapped: false });
  const signBack = add(box(signW + 0.16, signH + 0.14, 0.1, sc.trim));
  signBack.position.set(0, signY, signZ);
  const signBoard = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
  signBoard.position.set(0, signY, signZ + 0.06);
  signBoard.renderOrder = 3;              // draw on top: never let the roof win the depth test
  add(signBoard);
  // Two small brackets tie the sign back to the wall so it reads as mounted.
  for (const bx of [-1, 1]) {
    const bracket = add(box(0.08, 0.08, 0.5, shade(sc.trim, -14)));
    bracket.position.set(bx * (signW / 2 - 0.2), signY, D / 2 + 0.3);
  }
  const signGlow = new THREE.Mesh(new THREE.BoxGeometry(signW + 0.2, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 0.3, flatShading: true }));
  signGlow.position.set(0, signY - signH / 2 - 0.08, signZ + 0.02);
  signMats.push(signGlow.material);
  add(signGlow);
  order++;

  // themed props in the open zone before the entrance
  if (type === 'cafe') {
    const awn = add(box(2.2, 0.08, 0.9, sc.accent));
    awn.position.set(W / 4, 0.35 + 1.95, D / 2 + 0.5);
    awn.rotation.x = 0.25;
    const table = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 8), mat('#f0ead9')));
    table.position.set(-0.4, 1.05, D / 2 + 1.5);
    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.72, 6), mat('#8a6f4d')));
    leg.position.set(-0.4, 0.7, D / 2 + 1.5);
    for (const dx of [-0.95, 0.2]) {
      const stool = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 7), mat(sc.trim)));
      stool.position.set(-0.4 + dx, 0.55, D / 2 + 1.5);
    }
  } else if (type === 'flower') {
    for (const dx of [-1.1, 0, 1.1]) {
      const potBox = add(box(0.8, 0.4, 0.45, sc.trim));
      potBox.position.set(dx, 0.55, D / 2 + 0.85);
      for (let i = 0; i < 3; i++) {
        const bloom = add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5),
          mat(['#ff6f91', '#ffd166', '#c792ea'][i])));
        bloom.position.set(dx - 0.24 + i * 0.24, 0.85, D / 2 + 0.85);
      }
    }
  } else if (type === 'bakery') {
    const pretzel = add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.12, 6, 12), mat('#c89a68')));
    pretzel.position.set(W / 2 + 0.35, 2.1, D / 2 - 0.4);
    const crate = add(box(0.7, 0.5, 0.7, '#a9835c'));
    crate.position.set(1.3, 0.6, D / 2 + 1.2);
  } else if (type === 'workshop') {
    for (const [dx, dz, s] of [[1.2, 1.1, 0.7], [1.7, 1.3, 0.5], [1.35, 1.7, 0.55]]) {
      const crate = add(box(s, s, s, '#a9835c'));
      crate.position.set(dx, 0.35 + s / 2, D / 2 + dz - 0.6);
    }
    const gear = add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.11, 5, 8), mat('#8b93a5')));
    gear.position.set(-W / 2 - 0.2, 1.9, D / 2 - 0.5);
  } else if (type === 'library') {
    const bench = add(box(1.3, 0.13, 0.45, '#a9835c'));
    bench.position.set(1.4, 0.72, D / 2 + 1.3);
    const bl = add(box(1.1, 0.35, 0.35, '#8a6f4d'));
    bl.position.set(1.4, 0.5, D / 2 + 1.3);
  } else if (type === 'gallery') {
    const ped = add(box(0.55, 0.8, 0.55, '#f0ead9'));
    ped.position.set(1.4, 0.75, D / 2 + 1.25);
    const art = add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.75, 5), mat(sc.accent)));
    art.position.set(1.4, 1.55, D / 2 + 1.25);
  } else if (type === 'techstore') {
    const term = add(box(0.5, 1.25, 0.4, '#2b3245'));
    term.position.set(1.4, 0.95, D / 2 + 1.1);
    const scr = add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.06), glowMat('#59f2ff', 0.9)));
    scr.position.set(1.4, 1.35, D / 2 + 1.32);
  } else if (type === 'arcade') {
    for (const dx of [1.1, 1.75]) {
      const cab = add(box(0.55, 1.35, 0.5, '#3b2f63'));
      cab.position.set(dx, 1.0, D / 2 + 1.0);
      const scr = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.06), glowMat('#ff8a71', 0.9)));
      scr.position.set(dx, 1.35, D / 2 + 1.27);
    }
  }

  group.userData.companion = type;
  return { group, parts, anim, signMats, winMats, spot: new THREE.Vector3(0, 0, D / 2 + 1.6) };
}

/** Staged build animation with a soft back-out pop per part. */
export function playBuildAnimation(parts, { onPart, onDone, speed = 1 } = {}) {
  const sorted = [...parts].sort((a, b) => (a.userData.order || 0) - (b.userData.order || 0));
  const finals = sorted.map((m) => ({ y: m.position.y, s: m.scale.clone() }));
  sorted.forEach((m) => { m.visible = false; });
  let maxEnd = 0;
  sorted.forEach((m, i) => {
    const delay = (i * 42 + (m.userData.order || 0) * 200) / speed;
    const dur = 460 / speed;
    maxEnd = Math.max(maxEnd, delay + dur);
    tween({
      duration: dur, delay, ease: Ease.outBack,
      onUpdate: (k) => {
        if (!m.visible) { m.visible = true; onPart?.(m.userData.order || 0); }
        m.position.y = finals[i].y + (1 - k) * 2.2;
        const s = Math.max(0.001, k);
        m.scale.set(finals[i].s.x * s, finals[i].s.y * s, finals[i].s.z * s);
      },
      onDone: () => {
        m.position.y = finals[i].y;
        m.scale.copy(finals[i].s);
      },
    });
  });
  if (onDone) tween({ duration: maxEnd + 100, onUpdate: () => {}, onDone });
}
