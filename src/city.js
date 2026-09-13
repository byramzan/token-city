// City v2 — roads first, then plots (spec §3): plaza → avenues → ring streets →
// ready plots along the streets. Each plot holds the house, its companion
// building, a yard, paths and themed decor. Includes the link graph display
// and a full day–night cycle.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  mat, glowMat, createHouse, createCompanion, shade,
} from './house.js';
import { schemeOf, COMPANIONS, FUNC_PAIRS, LINK_TYPES, MAX_LINKS, DAY, companionName, YARD_SLOTS } from './config.js';
import { buildItem } from './items.js';
import { tween, Ease } from './tween.js';
import { configureCanvasTexture, surfaceMaps, surfaceTexture, VISUAL_QUALITY } from './materialLibrary.js';

export const PLAZA_R = 11;
const RINGS = [20, 36, 52];
const DISTRICTS = ['Old Town', 'Garden District', 'New Quarter'];
const SECTORS = ['North', 'East', 'South', 'West'];
const PLOT_OFFSET = 7.6; // plot center distance beyond its ring street

// shared warm lamp material — one handle lets the night cycle dim/brighten
// every street & yard lamp together
export const lampGlow = new THREE.MeshStandardMaterial({
  color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 0.25, flatShading: true,
});

// Fog (task4 §26): far values sit past the useful camera range so nearby
// districts stay clear; fog only begins at FOG.startFrac of the far distance.
const DAY_KEYS = [
  { t: 0.00, sky: '#8fc9e3', sun: 0.9, sunCol: '#ffd7a1', hemi: 0.82, ambient: 0.38, fog: 220 }, // dawn
  { t: 0.16, sky: '#8ed9ef', sun: 1.6, sunCol: '#fff0c7', hemi: 0.96, ambient: 0.24, fog: 255 }, // day
  { t: 0.42, sky: '#80d3eb', sun: 1.65, sunCol: '#ffe5ad', hemi: 0.98, ambient: 0.25, fog: 255 },
  { t: 0.55, sky: '#f29b69', sun: 1.25, sunCol: '#ff9b4a', hemi: 0.8, ambient: 0.42, fog: 225 }, // golden sunset
  { t: 0.68, sky: '#76648e', sun: 0.5, sunCol: '#ffb36b', hemi: 0.62, ambient: 0.52, fog: 195 }, // evening
  { t: 0.82, sky: '#303e68', sun: 0.28, sunCol: '#91a7ff', hemi: 0.5, ambient: 0.58, fog: 180 }, // night
  { t: 0.94, sky: '#6b6687', sun: 0.48, sunCol: '#ffd09a', hemi: 0.62, ambient: 0.48, fog: 200 }, // pre-dawn
  { t: 1.00, sky: '#8fc9e3', sun: 0.9, sunCol: '#ffd7a1', hemi: 0.82, ambient: 0.38, fog: 220 },
];
// configurable, not hardcoded across systems: fog begins at ~65% of the far
// boundary and fully fades at 100%; graph mode pushes it further out so
// connected houses stay visible.
export const FOG = { startFrac: 0.65, graphBoost: 1.35 };

export class City {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bfe6f5');
    this.scene.fog = new THREE.Fog('#bfe6f5', 160, 250);

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
    this.camera.position.set(34, 26, 34);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 110;
    this.controls.maxPolarAngle = 1.42;
    this.controls.target.set(0, 2, 0);

    this.houseGroups = new Map(); // houseId -> record
    this.animParts = [];
    this.clouds = [];
    this.graphObjects = [];
    this.graphDim = 0;
    this.time = 0;
    // day phase 0..1
    this.phase = DAY.startPhase;
    this.nightAmt = 0;
    this.shadowRefresh = 0;

    this._lights();
    this._sky();
    this._ground();
    this._plaza();
    this._streets();
    this._nature();
    this._birds();
    this._fireflies();
  }

  // ── environment ────────────────────────────────────────────────────────────
  _lights() {
    this.hemi = new THREE.HemisphereLight('#fff0d1', '#9b7a54', 1.05);
    this.scene.add(this.hemi);
    // A soft warm fill preserves the graphic 2.5D shapes in shadow and keeps
    // dark tech palettes readable without flattening the directional light.
    this.ambient = new THREE.AmbientLight('#ffd9b5', 0.32);
    this.scene.add(this.ambient);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(40, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 200;
    // normalBias keeps low-poly corners from self-shadowing as the sun moves;
    // the smaller depth bias avoids detached "floating" shadows.
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 1.5;
    this.scene.add(sun);
    this.sun = sun;
    // Shadows update at a controlled cadence. This prevents tiny day-cycle
    // changes from re-rasterizing the atlas every animation frame and removes
    // the impression of rapidly crawling shadows without freezing NPC shadows.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  _sky() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,246,200,1)');
    grad.addColorStop(0.35, 'rgba(255,225,130,0.9)');
    grad.addColorStop(1, 'rgba(255,225,130,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 1 }),
      transparent: true, depthWrite: false,
    }));
    this.sunSprite.scale.setScalar(46);
    this.scene.add(this.sunSprite);
  }

  /** Calm painterly grass shared with yards and visual test scenes. */
  _grassTexture() {
    return surfaceTexture('grass', [4.15, 4.15]);
  }

  _ground() {
    this.grassTexture = this._grassTexture();
    const groundMaps = surfaceMaps('grass', [4.15, 4.15]);
    const groundMat = new THREE.MeshStandardMaterial({
      ...groundMaps, color: '#fff7dc', flatShading: true,
    });
    const yardMaps = surfaceMaps('grass', [1.7, 1.45]);
    this.yardGrassMat = new THREE.MeshStandardMaterial({
      ...yardMaps,
      color: '#d5e4bd',
      flatShading: true,
    });
    const g = new THREE.Mesh(new THREE.CircleGeometry(160, 48), groundMat);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);
    // low-poly grass clusters only near the center (near-camera detail, §28.1)
    const rnd = mulberry(23);
    const tuftMats = [mat('#6fae5c'), mat('#7dbf68'), mat('#659e53')];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = PLAZA_R + 4 + rnd() * 46;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this._nearInfra(x, z)) continue;
      const tuft = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const blade = new THREE.Mesh(
          new THREE.ConeGeometry(0.09 + rnd() * 0.07, 0.35 + rnd() * 0.3, 4),
          tuftMats[Math.floor(rnd() * tuftMats.length)],
        );
        blade.position.set((rnd() - 0.5) * 0.7, 0.18, (rnd() - 0.5) * 0.7);
        blade.rotation.z = (rnd() - 0.5) * 0.4;
        tuft.add(blade);
      }
      tuft.position.set(x, 0, z);
      this.scene.add(tuft);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 120 + Math.random() * 25;
      const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(12 + Math.random() * 10, 0), mat('#7db96a'));
      hill.position.set(Math.cos(a) * r, -4, Math.sin(a) * r);
      hill.scale.y = 0.45;
      this.scene.add(hill);
    }
  }

  _roadTexture() {
    return surfaceTexture('asphalt', [1, 1]);
  }

  _roadMaterial(repeatX, repeatY) {
    const maps = surfaceMaps('asphalt', [repeatX, repeatY]);
    return new THREE.MeshStandardMaterial({
      ...maps,
      color: '#f1eadb',
      flatShading: true,
    });
  }

  _walkwayTexture() {
    return surfaceTexture('pavers', [1, 1]);
  }

  _walkwayMaterial(color) {
    const maps = surfaceMaps('pavers', [1.25, 4]);
    return new THREE.MeshStandardMaterial({
      ...maps,
      color,
      flatShading: true,
    });
  }

  _plotPadGeometry() {
    if (this.plotPadGeometry) return this.plotPadGeometry;
    const d = 12.0;
    const outerHalf = 7.0;
    const innerHalf = 5.35;
    const cut = 0.78;
    const shape = new THREE.Shape();
    // The inner edge faces the smaller-radius ring street, so it must be
    // narrower than the outer edge. A rectangular pad inevitably overlaps its
    // neighbour at the inner corners on a curved row of plots.
    shape.moveTo(-outerHalf + cut, -d / 2);
    shape.lineTo(outerHalf - cut, -d / 2);
    shape.lineTo(outerHalf, -d / 2 + cut);
    shape.lineTo(innerHalf, d / 2 - cut);
    shape.lineTo(innerHalf - cut, d / 2);
    shape.lineTo(-innerHalf + cut, d / 2);
    shape.lineTo(-innerHalf, d / 2 - cut);
    shape.lineTo(-outerHalf, -d / 2 + cut);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.085,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // ShapeGeometry lives in XY and extrudes along +Z; lay it flat on XZ.
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    this.plotPadGeometry = geo;
    return geo;
  }

  _plaza() {
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAZA_R, PLAZA_R + 0.6, 0.5, 24),
      mat('#e3d5ae', { textureKind: 'pavers', textureRepeat: [4, 4] }),
    );
    plaza.position.y = 0.25;
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, PLAZA_R - 4.2), mat('#cdbd92'));
      const mid = 3.1 + (PLAZA_R - 4.2) / 2;
      line.position.set(Math.cos(a) * mid, 0.52, Math.sin(a) * mid);
      line.rotation.y = -a + Math.PI / 2;
      this.scene.add(line);
    }

    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 1.4, 8), mat('#cfc6ae'));
    ped.position.y = 1.2;
    ped.castShadow = true;
    this.scene.add(ped);
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.35, 18), glowMat('#ffd166', 0.5));
    coin.rotation.x = Math.PI / 2;
    coin.position.y = 4.4;
    coin.castShadow = true;
    coin.userData.spin = true;
    this.scene.add(coin);
    this.animParts.push(coin);

    const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 16), mat('#cfc6ae'));
    pool.position.y = 0.5;
    pool.castShadow = true;
    this.scene.add(pool);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.1, 0.18, 16),
      mat('#6fd6e8', { transparent: true, opacity: 0.85 })
    );
    water.position.y = 0.72;
    water.userData.water = true;
    this.scene.add(water);
    this.animParts.push(water);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 6), mat('#aee9f5', { transparent: true, opacity: 0.8 }));
      jet.position.set(Math.cos(a) * 2.5, 1.15, Math.sin(a) * 2.5);
      jet.userData.jet = true;
      jet.userData.phase = i * 1.3;
      this.scene.add(jet);
      this.animParts.push(jet);
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 0.5), mat('#a9835c', { textureKind: 'wood', textureRepeat: [2, 1] }));
      seat.position.y = 0.55;
      seat.castShadow = true;
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.12), mat('#a9835c', { textureKind: 'wood', textureRepeat: [2, 1] }));
      back.position.set(0, 0.9, -0.24);
      back.rotation.x = -0.15;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.4), mat('#8a6f4d', { textureKind: 'wood' }));
      legs.position.y = 0.28;
      bench.add(seat, back, legs);
      bench.position.set(Math.cos(a) * (PLAZA_R - 2.6), 0.28, Math.sin(a) * (PLAZA_R - 2.6));
      bench.lookAt(0, 0.5, 0);
      this.scene.add(bench);
    }

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.8;
      this._lampPost(Math.cos(a) * (PLAZA_R - 1.6), Math.sin(a) * (PLAZA_R - 1.6));
    }

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 5), mat('#e8e2d2'));
      pole.position.set(Math.cos(a) * (PLAZA_R - 0.9), 2.0, Math.sin(a) * (PLAZA_R - 0.9));
      pole.castShadow = true;
      this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({
        color: ['#ff8a71', '#4ecdc4', '#ffd166', '#7aa2f7'][i % 4], side: THREE.DoubleSide, flatShading: true,
      }));
      flag.position.set(Math.cos(a) * (PLAZA_R - 0.9) + 0.45, 3.3, Math.sin(a) * (PLAZA_R - 0.9));
      flag.userData.flag = true;
      flag.userData.phase = i;
      this.scene.add(flag);
      this.animParts.push(flag);
    }
  }

  _lampPost(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.8, 6), mat('#4c5566', { textureKind: 'metal' }));
    pole.position.set(x, 1.9, z);
    pole.castShadow = true;
    this.scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), lampGlow);
    head.position.set(x, 3.4, z);
    this.scene.add(head);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 8), mat('#4c5566', { textureKind: 'metal' }));
    cap.position.set(x, 3.75, z);
    this.scene.add(cap);
  }

  // ── streets first, then plots (spec §3.1) ──────────────────────────────────
  _streets() {
    const avenueMat = this._roadMaterial(1.1, 9);
    const ringMat = this._roadMaterial(0.9, 1.35);
    // main avenues from the plaza outwards
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const len = RINGS[RINGS.length - 1] + 12 - PLAZA_R;
      const road = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, len), avenueMat);
      const mid = PLAZA_R + len / 2;
      road.position.set(Math.cos(a) * mid, 0.06, Math.sin(a) * mid);
      road.rotation.y = -a + Math.PI / 2;
      road.receiveShadow = true;
      this.scene.add(road);
      for (let d = PLAZA_R + 1.5; d < PLAZA_R + len; d += 2.6) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 1.1), mat('#e8e2d2'));
        dash.position.set(Math.cos(a) * d, 0.08, Math.sin(a) * d);
        dash.rotation.y = -a + Math.PI / 2;
        this.scene.add(dash);
      }
    }
    // Ring streets are single annular meshes. The previous chain of slightly
    // overlapping boxes placed coplanar top faces at every joint, which was a
    // confirmed source of moving triangular bands and excessive draw calls.
    for (const r of RINGS) {
      const segs = Math.round(r * 1.15);
      const geometry = new THREE.RingGeometry(r - 0.9, r + 0.9, segs, 1);
      const positions = geometry.getAttribute('position');
      const uvs = geometry.getAttribute('uv');
      for (let i = 0; i < positions.count; i++) {
        // World-planar mapping keeps asphalt scale stable around the circle.
        uvs.setXY(i, positions.getX(i) / 5, positions.getY(i) / 5);
      }
      uvs.needsUpdate = true;
      geometry.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(geometry, ringMat);
      ring.position.y = 0.115;
      ring.receiveShadow = true;
      this.scene.add(ring);
      // street lamps every ~1/10 of the ring
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.15;
        this._lampPost(Math.cos(a) * (r - 1.6), Math.sin(a) * (r - 1.6));
      }
    }
    // ready plots along the outer side of each ring
    this.plots = [];
    RINGS.forEach((r, ringIdx) => {
      const plotR = r + PLOT_OFFSET;
      const step = 16.5 / plotR; // angular step ≈ plot width
      for (let a = 0; a < Math.PI * 2 - step / 2; a += step) {
        // keep avenue crossings clear
        const nearAvenue = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(
          (av) => Math.abs(angDiff(a, av)) < 9.5 / plotR
        );
        if (nearAvenue) continue;
        const sector = SECTORS[Math.floor((((a + Math.PI / 4) % (Math.PI * 2)) / (Math.PI * 2)) * 4) % 4];
        this.plots.push({
          i: this.plots.length,
          x: Math.cos(a) * plotR,
          z: Math.sin(a) * plotR,
          ang: a,
          r,
          ring: ringIdx,
          district: `${DISTRICTS[ringIdx]} · ${sector}`,
          taken: false,
        });
      }
    });
  }

  /** Auto plot selection (spec §3.5): likes similar-material neighbours,
   *  fills inner rings first, keeps districts growing evenly. */
  pickPlot(cfg, houses) {
    const free = this.plots.filter((p) => !p.taken);
    if (!free.length) return null;
    let best = null, bestScore = -1e9;
    for (const p of free) {
      let score = 0;
      score -= p.ring * 2; // settle inner rings first
      let sameNear = 0, near = 0;
      for (const h of houses) {
        const hp = this.plots[h.plot.i];
        if (!hp || hp.ring !== p.ring) continue;
        const d = Math.abs(angDiff(hp.ang, p.ang)) * p.r;
        if (d < 40) {
          near++;
          if (h.material === cfg.material) sameNear++;
        }
      }
      score += Math.min(sameNear, 2) * 1.5;  // similar architecture nearby
      score -= Math.max(0, near - 3) * 1.2;  // avoid over-dense blocks
      score += Math.random() * 0.8;          // keep variety
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ── plot composition (spec §3.2–3.3) ───────────────────────────────────────
  /** Builds house + companion + yard on the plot. Returns the record. */
  addHouse(cfg, opts = {}) {
    if (this.houseGroups.has(cfg.id)) return this.houseGroups.get(cfg.id);
    const { animate = false } = opts;
    const plot = this.plots[cfg.plot.i];
    if (plot) plot.taken = true;

    const root = new THREE.Group();
    root.position.set(cfg.plot.x, 0, cfg.plot.z);
    root.rotation.y = Math.atan2(-cfg.plot.x, -cfg.plot.z); // front (+z) faces the street/plaza
    root.userData.houseId = cfg.id;
    this.scene.add(root);

    const sc = schemeOf(cfg);
    const yardParts = [];
    const yAdd = (m, o = 0) => { m.userData.order = o; root.add(m); yardParts.push(m); return m; };

    // yard pad
    const padCol = { wood: '#9fc286', brick: '#b5a48c', stone: '#cfc9b8', tech: '#8f9aa8' }[cfg.material] || '#9fc286';
    const padSurface = cfg.material === 'brick' ? 'pavers' : cfg.material === 'stone' ? 'stone' : 'tech';
    const padMat = cfg.material === 'wood'
      ? this.yardGrassMat
      : mat(padCol, { textureKind: padSurface, textureRepeat: [2.6, 2.2] });
    const pad = yAdd(new THREE.Mesh(this._plotPadGeometry(), padMat));
    pad.position.y = 0.008;
    pad.receiveShadow = true;

    // house — main object, ~2/3 of the visual weight, left side
    const house = createHouse(cfg);
    house.group.position.set(-2.0, 0.09, -1.6);
    root.add(house.group);

    // business building (task4 §19): built only if this house owns a business.
    // Otherwise the adjacent plot is reserved and marked "for sale".
    let comp = null;
    let bizPlot = null;
    if (cfg.companion) {
      const list = COMPANIONS[cfg.material] || [];
      const meta = list.find((c) => c.id === cfg.companion) || list[0];
      comp = createCompanion(cfg.companion, sc, meta ? meta.sign : 'SHOP');
      comp.group.position.set(4.1, 0.09, 1.2);
      comp.group.rotation.y = -0.15;
      root.add(comp.group);
    } else {
      bizPlot = this._makeForSalePlot();
      root.add(bizPlot);
    }

    // paths: house door → street; branch → companion (spec §3.2)
    const pathCol = { wood: '#c9b89a', brick: '#b58a6a', stone: '#e0dbc9', tech: '#7d8794' }[cfg.material] || '#c9b89a';
    const walkwayMat = this._walkwayMaterial(pathCol);
    const doorLocalX = -2.0 + (house.doorX || 0);
    const pathParts = [];
    const mkPath = (x0, z0, x1, z1, w = 0.85, level = 0) => {
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.11, len), walkwayMat);
      p.position.set((x0 + x1) / 2, 0.155 + level * 0.012, (z0 + z1) / 2);
      p.rotation.y = Math.atan2(dx, dz);
      p.receiveShadow = true;
      root.add(p);
      pathParts.push(p);
      return p;
    };
    mkPath(doorLocalX, 1.1, doorLocalX, 6.9);             // to the street
    mkPath(doorLocalX, 3.6, 3.95, 3.6, 0.7, 1);          // branch across the yard
    mkPath(3.95, 3.6, 4.1, 3.0, 0.7, 2);                // to the companion entrance

    // Raised joint caps hide coplanar overlaps at T-junctions. Those overlaps
    // were the triangular/striped artefacts visible in the report.
    for (const [x, z, size] of [[doorLocalX, 3.6, 1.02], [3.95, 3.6, 0.84]]) {
      const joint = new THREE.Mesh(new THREE.BoxGeometry(size, 0.1, size), walkwayMat);
      joint.position.set(x, 0.195, z);
      joint.receiveShadow = true;
      root.add(joint);
      pathParts.push(joint);
    }

    // Small apron at the road edge. The old PLOT_OFFSET-based length continued
    // through the full ring street and produced a broken triangular overlap.
    const drive = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.8), walkwayMat);
    drive.position.set(doorLocalX, 0.145, 6.55);
    drive.rotation.y = 0;
    drive.receiveShadow = true;
    root.add(drive);
    pathParts.push(drive);

    // themed yard decor (2–5 pieces, spec §3.2 / §7)
    this._yardDecor(cfg.material, sc, root, yardParts, doorLocalX);

    root.updateMatrixWorld(true); // анкеры ниже считаются в мировых координатах
    const record = {
      cfg,
      root,
      houseParts: house.parts,
      compParts: comp ? comp.parts : [],
      yardParts,
      pathParts,
      yardItems: {},   // slotId -> mesh (дворовые сокеты)
      yardMarkers: {},
      bizPlot,         // reserved "for sale" plot until a business is bought
      businessComponent: comp,
      businessType: null,
      hasReserveItems: false,
      anim: [...house.anim, ...(comp ? comp.anim : [])],
      winMats: [...house.winMats, ...(comp ? comp.winMats : [])],
      signMats: [...house.signMats, ...(comp ? comp.signMats : [])],
      lightSeed: Math.random(),
      // world-space anchors for residents
      door: root.localToWorld(new THREE.Vector3(doorLocalX, 0, 2.2)),
      compSpot: comp ? root.localToWorld(comp.group.position.clone().add(new THREE.Vector3(0, 0, 2.6))) : null,
      street: root.localToWorld(new THREE.Vector3(doorLocalX, 0, PLOT_OFFSET - 0.4)),
    };
    this.animParts.push(...record.anim);
    this.houseGroups.set(cfg.id, record);

    // дворовые предметы из сохранения
    if (opts.yard) {
      for (const [slotId, itemId] of Object.entries(opts.yard)) {
        this.placeYardItem(cfg.id, slotId, itemId, false);
      }
    }

    if (animate) {
      [...record.compParts, ...pathParts].forEach((p) => { p.visible = false; });
    }
    return record;
  }

  /** Removes a remotely deleted/replaced house without disturbing shared materials. */
  removeHouse(houseId) {
    const record = this.houseGroups.get(houseId);
    if (!record) return false;
    const belongsToHouse = (object) => {
      let current = object;
      while (current) {
        if (current === record.root) return true;
        current = current.parent;
      }
      return false;
    };
    this.animParts = this.animParts.filter((object) => !belongsToHouse(object));
    this.scene.remove(record.root);
    this.houseGroups.delete(houseId);
    const plot = this.plots[record.cfg.plot?.i];
    if (plot) plot.taken = false;
    return true;
  }

  /** Reserved business plot with a small FOR SALE sign (task4 §19.1). */
  _makeForSalePlot() {
    const g = new THREE.Group();
    g.position.set(4.1, 0.09, 1.2);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.06, 4.2),
      mat('#b7ac91', { textureKind: 'pavers', textureRepeat: [2, 2] }),
    );
    pad.receiveShadow = true;
    g.add(pad);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 6), mat('#8a6f4d', { textureKind: 'wood' }));
    post.position.set(0, 0.7, 1.6);
    post.castShadow = true;
    g.add(post);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f1e3'; ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = '#8a6f4d'; ctx.lineWidth = 8; ctx.strokeRect(5, 5, 246, 86);
    ctx.fillStyle = '#4a3826';
    ctx.font = '800 40px "Baloo 2", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('FOR SALE', 128, 50);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.6, 0.08),
      new THREE.MeshStandardMaterial({
        map: configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 4 }),
        roughness: 0.86, flatShading: true,
      }),
    );
    board.position.set(0, 1.35, 1.6);
    board.castShadow = true;
    g.add(board);
    return g;
  }

  /** Build the purchased business on the reserved plot (task4 §19). */
  addBusinessBuilding(houseId, bizType, meta, { animate = true } = {}) {
    const rec = this.houseGroups.get(houseId);
    if (!rec) return null;
    if (rec.businessComponent && rec.businessType === bizType) {
      if (!animate) rec.businessComponent.parts.forEach((part) => { part.visible = true; });
      return rec.businessComponent;
    }
    if (rec.businessComponent?.group && rec.businessType) {
      rec.root.remove(rec.businessComponent.group);
      const oldAnim = new Set(rec.businessComponent.anim || []);
      this.animParts = this.animParts.filter((part) => !oldAnim.has(part));
    }
    if (rec.bizPlot) { rec.root.remove(rec.bizPlot); rec.bizPlot = null; }
    const sc = schemeOf(rec.cfg);
    const comp = createCompanion(meta.comp, sc, meta.sign);
    comp.group.position.set(4.1, 0.09, 1.2);
    comp.group.rotation.y = -0.15;
    rec.root.add(comp.group);
    rec.businessComponent = comp;
    rec.businessType = bizType;
    rec.compParts = comp.parts;
    rec.anim.push(...comp.anim);
    this.animParts.push(...comp.anim);
    rec.winMats.push(...comp.winMats);
    rec.signMats.push(...comp.signMats);
    rec.root.updateMatrixWorld(true);
    rec.compSpot = rec.root.localToWorld(comp.group.position.clone().add(new THREE.Vector3(0, 0, 2.6)));
    if (animate) comp.parts.forEach((p) => { p.visible = false; });
    return comp;
  }

  _yardDecor(material, sc, root, yardParts, doorX) {
    const yAdd = (m) => { m.userData.order = 0; root.add(m); yardParts.push(m); return m; };
    if (material === 'wood') {
      for (let x = -4.9; x <= 4.9; x += 1.09) { // front fence with a gap at the path
        if (Math.abs(x - doorX) < 1.3) continue;
        const post = yAdd(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.7, 0.13), mat('#e8e2d2')));
        post.position.set(x, 0.44, 5.85);
        post.castShadow = true;
      }
      const bush1 = yAdd(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mat('#5eb85e')));
      bush1.position.set(-4.9, 0.55, 3.5);
      const bench = yAdd(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.45), mat('#a9835c')));
      bench.position.set(1.6, 0.62, 0.4);
      const bl = yAdd(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.34), mat('#8a6f4d')));
      bl.position.set(1.6, 0.4, 0.4);
      this._yardLamp(root, yardParts, doorX + 1.6, 5.4);
    } else if (material === 'brick') {
      for (const [x, z] of [[-4.95, 4.2], [-4.4, 4.6]]) {
        const barrel = yAdd(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.75, 8), mat('#8a6f4d')));
        barrel.position.set(x, 0.47, z);
        barrel.castShadow = true;
      }
      const crate = yAdd(new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.65), mat('#a9835c')));
      crate.position.set(-4.8, 0.42, 3.3);
      const pot = yAdd(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat('#5eb85e')));
      pot.position.set(4.9, 0.5, 4.8);
      this._yardLamp(root, yardParts, doorX - 1.7, 5.4);
    } else if (material === 'stone') {
      for (const x of [-4.65, -2.9]) { // trimmed hedges
        const hedge = yAdd(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.7), mat('#4f9a55')));
        hedge.position.set(x, 0.5, 5.2);
        hedge.castShadow = true;
      }
      const ped = yAdd(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), mat('#f0ead9')));
      ped.position.set(1.8, 0.55, 0.3);
      const scl = yAdd(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 5), mat(sc.accent)));
      scl.position.set(1.8, 1.3, 0.3);
      this._yardLamp(root, yardParts, doorX + 1.6, 5.4, 1.6);
    } else { // tech
      for (const z of [5.6, 4.2, 2.8]) { // light pylons along the path
        const pyl = yAdd(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), lampGlow));
        pyl.position.set(doorX + 0.85, 0.4, z);
      }
      const dish = yAdd(new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), mat('#dfe3ea')));
      dish.position.set(-4.85, 0.6, 3.6);
      dish.rotation.z = -0.9;
      const cube = yAdd(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat('#4f9a55')));
      cube.position.set(4.9, 0.5, 4.6);
      cube.scale.y = 1.6;
    }
  }

  _yardLamp(root, yardParts, x, z, h = 2.2) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), mat('#4c5566'));
    pole.position.set(x, h / 2, z);
    pole.castShadow = true;
    pole.userData.order = 0;
    root.add(pole);
    yardParts.push(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), lampGlow);
    head.position.set(x, h + 0.15, z);
    head.userData.order = 0;
    root.add(head);
    yardParts.push(head);
  }

  // ── yard sockets (task3 §8/§9.6) ───────────────────────────────────────────
  placeYardItem(houseId, slotId, itemId, animate = true) {
    const rec = this.houseGroups.get(houseId);
    const slot = YARD_SLOTS.find((s) => s.id === slotId);
    if (!rec || !slot) return;
    this.removeYardItem(houseId, slotId);
    const mesh = buildItem(itemId);
    mesh.position.set(slot.x, 0.09, slot.z);
    mesh.userData.slotId = slotId;
    mesh.userData.itemId = itemId;
    rec.root.add(mesh);
    rec.yardItems[slotId] = mesh;
    mesh.traverse((c) => {
      if (c.userData.spin || c.userData.blink || c.userData.flag || c.userData.water) this.animParts.push(c);
    });
    if (animate) {
      const s = mesh.scale.clone();
      mesh.scale.setScalar(0.01);
      tween({
        duration: 450, ease: Ease.outBack,
        onUpdate: (k) => mesh.scale.set(s.x * Math.max(0.01, k), s.y * Math.max(0.01, k), s.z * Math.max(0.01, k)),
      });
    }
  }

  removeYardItem(houseId, slotId) {
    const rec = this.houseGroups.get(houseId);
    const m = rec?.yardItems[slotId];
    if (m) {
      rec.root.remove(m);
      delete rec.yardItems[slotId];
    }
  }

  /** Glowing rings on free yard sockets while editing the plot. */
  setYardEditMode(houseId, on, taken = {}) {
    const rec = this.houseGroups.get(houseId);
    if (!rec) return;
    for (const slot of YARD_SLOTS) {
      let m = rec.yardMarkers[slot.id];
      if (!m && on) {
        m = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 24), glowMat('#59f2ff', 0.8));
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(0.85, 24),
          new THREE.MeshBasicMaterial({ color: '#59f2ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
        );
        fill.userData.yardSlotId = slot.id;
        m.add(fill);
        m.rotation.x = Math.PI / 2;
        m.position.set(slot.x, 0.18, slot.z);
        m.userData.yardSlotId = slot.id;
        rec.root.add(m);
        rec.yardMarkers[slot.id] = m;
      }
      if (m) m.visible = on && !taken[slot.id];
    }
  }

  // ── link graph (spec §15) ──────────────────────────────────────────────────
  /** Compute up to MAX_LINKS links for a new house against existing ones. */
  computeLinks(cfg, houses, visits = {}) {
    const cands = [];
    for (const h of houses) {
      if (h.id === cfg.id) continue;
      let arch = 0;
      if (h.material === cfg.material) arch += 3;
      if (h.roof === cfg.roof) arch += 1;
      if (h.foundation === cfg.foundation) arch += 1;
      if (h.scheme === cfg.scheme && h.material === cfg.material) arch += 1;
      if (arch >= 3) {
        cands.push({
          to: h.id, type: 'architectural', strength: arch / 6,
          reason: h.material === cfg.material
            ? `Both homes are built of ${cfg.material === 'tech' ? 'tech panels' : cfg.material}`
            : 'The homes share their shape and roof style',
        });
      }
      const pa = this.plots[cfg.plot.i], pb = this.plots[h.plot?.i];
      if (pa && pb && pa.district === pb.district) {
        cands.push({
          to: h.id, type: 'district', strength: 0.55,
          reason: `Both homes are part of ${pa.district}`,
        });
      }
      if (cfg.companion && h.companion && (FUNC_PAIRS[cfg.companion] || []).includes(h.companion)) {
        cands.push({
          to: h.id, type: 'functional', strength: 0.8,
          reason: `The ${companionName(cfg.companion).toLowerCase()} and the ${companionName(h.companion).toLowerCase()} complement each other`,
        });
      }
      const v = (visits[cfg.id]?.[h.id] || 0) + (visits[h.id]?.[cfg.id] || 0);
      if (v >= 3) {
        cands.push({
          to: h.id, type: 'social', strength: Math.min(1, v / 8),
          reason: 'Residents visit each other regularly',
        });
      }
    }
    // one link per neighbour (strongest), then the top MAX_LINKS overall
    const byHouse = new Map();
    for (const c of cands) {
      const cur = byHouse.get(c.to);
      if (!cur || c.strength > cur.strength) byHouse.set(c.to, c);
    }
    return [...byHouse.values()].sort((a, b) => b.strength - a.strength).slice(0, MAX_LINKS);
  }

  /** Soft glowing lines + ground rings; the scene dims around them. */
  showGraph(houseId, links) {
    this.hideGraph();
    const from = this.houseGroups.get(houseId);
    if (!from) return;
    this.graphDim = 1;
    const a = from.root.position.clone().setY(3.2);

    const ring = (pos, color) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.16, 6, 36),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      r.rotation.x = Math.PI / 2;
      r.position.set(pos.x, 0.35, pos.z);
      this.scene.add(r);
      this.graphObjects.push(r);
    };
    ring(from.root.position, '#ffffff');

    links.forEach((link, idx) => {
      const toRec = this.houseGroups.get(link.to);
      if (!toRec) return;
      const b = toRec.root.position.clone().setY(3.2);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += a.distanceTo(b) * 0.18 + 4;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const color = LINK_TYPES[link.type]?.color || '#ffffff';
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, 0.09 + link.strength * 0.1, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false })
      );
      this.scene.add(tube);
      this.graphObjects.push(tube);
      ring(toRec.root.position, color);
      tween({ // lines fade in one after another
        duration: 500, delay: 150 + idx * 160, ease: Ease.out,
        onUpdate: (k) => { tube.material.opacity = 0.85 * k; },
      });
    });
  }

  hideGraph() {
    this.graphDim = 0;
    for (const o of this.graphObjects) this.scene.remove(o);
    this.graphObjects = [];
  }

  // ── streets routing for residents ──────────────────────────────────────────
  /** Waypoints from one plot to another along ring streets and avenues. */
  route(fromPlot, toPlot) {
    const pts = [];
    const pushArc = (r, a0, a1) => {
      let d = angDiff(a1, a0);
      const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.22));
      for (let s = 1; s <= steps; s++) {
        const a = a0 + (d * s) / steps;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
    };
    const nearestAvenue = (a) =>
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].reduce((best, av) =>
        Math.abs(angDiff(a, av)) < Math.abs(angDiff(a, best)) ? av : best, 0);

    if (fromPlot.r === toPlot.r) {
      pushArc(fromPlot.r, fromPlot.ang, toPlot.ang);
    } else {
      const av = nearestAvenue(fromPlot.ang);
      pushArc(fromPlot.r, fromPlot.ang, av);
      const steps = 3;
      for (let s = 1; s <= steps; s++) {
        const r = fromPlot.r + ((toPlot.r - fromPlot.r) * s) / steps;
        pts.push(new THREE.Vector3(Math.cos(av) * r, 0, Math.sin(av) * r));
      }
      pushArc(toPlot.r, av, toPlot.ang);
    }
    return pts;
  }

  routeToPlaza(fromPlot) {
    const pts = [];
    const av = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].reduce((best, a) =>
      Math.abs(angDiff(fromPlot.ang, a)) < Math.abs(angDiff(fromPlot.ang, best)) ? a : best, 0);
    let d = angDiff(av, fromPlot.ang);
    const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.22));
    for (let s = 1; s <= steps; s++) {
      const a = fromPlot.ang + (d * s) / steps;
      pts.push(new THREE.Vector3(Math.cos(a) * fromPlot.r, 0, Math.sin(a) * fromPlot.r));
    }
    for (let r = fromPlot.r - 6; r > PLAZA_R - 2; r -= 6) {
      pts.push(new THREE.Vector3(Math.cos(av) * r, 0, Math.sin(av) * r));
    }
    return pts;
  }

  // ── misc environment ───────────────────────────────────────────────────────
  _nature() {
    const rnd = mulberry(7);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 16 + rnd() * 100;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this._nearInfra(x, z)) continue;
      this.scene.add(makeTree(rnd, x, z));
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 25 + rnd() * 90;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + rnd() * 0.8, 0), mat('#aeb2ac', { textureKind: 'stone' }));
      rock.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
      rock.castShadow = true;
      this.scene.add(rock);
    }
    const flowerCols = ['#ff6f91', '#ffd166', '#c792ea', '#ff8a71', '#f4f1de'];
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = PLAZA_R + 3 + rnd() * 80;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (this._nearInfra(cx, cz)) continue;
      const patch = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const col = flowerCols[Math.floor(rnd() * flowerCols.length)];
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 4), mat('#4f9a55'));
        stem.position.set((rnd() - 0.5) * 1.4, 0.16, (rnd() - 0.5) * 1.4);
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat(col));
        bloom.position.set(stem.position.x, 0.36, stem.position.z);
        patch.add(stem, bloom);
      }
      patch.position.set(cx, 0, cz);
      this.scene.add(patch);
    }
    for (let i = 0; i < 7; i++) {
      const cl = new THREE.Group();
      for (let j = 0; j < 3; j++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + Math.random() * 1.6, 0),
          mat('#ffffff', { transparent: true, opacity: 0.9 }));
        puff.position.set(j * 2.6 - 2.6, Math.random() * 0.8, Math.random() * 1.4);
        puff.scale.y = 0.55;
        cl.add(puff);
      }
      let cx = (Math.random() - 0.5) * 180;
      const cz = (Math.random() - 0.5) * 180;
      if (Math.abs(cx) < 30 && Math.abs(cz) < 30) cx += Math.sign(cx || 1) * 45;
      cl.position.set(cx, 38 + Math.random() * 14, cz);
      cl.userData.speed = 0.4 + Math.random() * 0.5;
      this.scene.add(cl);
      this.clouds.push(cl);
    }
  }

  _nearInfra(x, z) {
    const r = Math.hypot(x, z);
    if (r < PLAZA_R + 3) return true;
    for (const ringR of RINGS) {
      if (Math.abs(r - ringR) < 3) return true;                    // ring street
      if (r > ringR + 2 && r < ringR + PLOT_OFFSET + 7) {           // plot band
        return true;
      }
    }
    const a = Math.atan2(z, x);
    for (const av of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      if (Math.abs(angDiff(a, av)) * r < 3.4 && r < RINGS[2] + 12) return true; // avenue
    }
    return false;
  }

  _birds() {
    this.birdFlocks = [];
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group();
      const n = 2 + f;
      for (let i = 0; i < n; i++) {
        const bird = new THREE.Group();
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.16), mat('#3f4652'));
        wingL.position.x = -0.26;
        const wingR = wingL.clone();
        wingR.position.x = 0.26;
        bird.add(wingL, wingR);
        bird.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 4);
        bird.userData.wings = [wingL, wingR];
        bird.userData.phase = Math.random() * 6;
        flock.add(bird);
      }
      flock.userData = {
        r: 34 + f * 18, h: 17 + f * 5,
        speed: 0.08 + Math.random() * 0.05,
        a: Math.random() * Math.PI * 2,
      };
      this.scene.add(flock);
      this.birdFlocks.push(flock);
    }
  }

  _fireflies() {
    const geo = new THREE.BufferGeometry();
    const n = 40;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 55;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.8 + Math.random() * 1.8;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: '#ffe9a8', size: 0.35, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.fireflies = new THREE.Points(geo, this.fireflyMat);
    this.scene.add(this.fireflies);
  }

  flyTo(target, { distance = 18, height = 11, duration = 1400, onDone } = {}) {
    const startPos = this.camera.position.clone();
    const startTgt = this.controls.target.clone();
    // A house is rotated so its front (the door, +z face) points toward the
    // world origin (the street/plaza). To show the FRONT of the house the
    // camera must sit on the origin side of the plot, not behind it. `dir`
    // points from the origin out to the plot, so we step back TOWARD the origin.
    const dir = new THREE.Vector3(target.x, 0, target.z).normalize();
    if (dir.lengthSq() < 0.01) dir.set(0.7, 0, 0.7);
    const endTgt = new THREE.Vector3(target.x, 2.2, target.z);
    const endPos = new THREE.Vector3(
      target.x - dir.x * distance * 0.8, height, target.z - dir.z * distance * 0.8,
    );
    // Keep the landing spot inside the OrbitControls distance band so the
    // controls do not snap the camera back the instant the tween hands over.
    const offset = endPos.clone().sub(endTgt);
    const clamped = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length()));
    endPos.copy(endTgt).add(offset.setLength(clamped));

    if (this.camTween) this.camTween.cancel();
    // While flying we own the camera; the damped controls.update() must not
    // fight the tween (that caused the zoom-in/spring-back jitter on load).
    this.flying = true;
    this.camTween = tween({
      duration, ease: Ease.inOut,
      onUpdate: (k) => {
        this.camera.position.lerpVectors(startPos, endPos, k);
        this.controls.target.lerpVectors(startTgt, endTgt, k);
        this.camera.lookAt(this.controls.target);
      },
      onDone: () => {
        this.flying = false;
        this.camTween = null;
        // Hand a settled state to the controls so nothing jumps next frame.
        this.controls.update();
        onDone?.();
      },
    });
  }

  /** Manual camera input (WASD) cancels automatic movement (task4 §27). */
  cancelFly() {
    if (this.camTween) {
      this.camTween.cancel();
      this.camTween = null;
    }
    this.flying = false;
  }

  // ── frame update: day cycle + ambient animation ────────────────────────────
  update(dt) {
    this.time += dt;
    // A fly tween owns the camera; running the damped, distance-clamping
    // controls.update() at the same time makes the camera zoom in and spring
    // back. Skip it until the tween finishes and hands over a settled state.
    if (!this.flying) this.controls.update();

    this.shadowRefresh += dt;
    if (this.shadowRefresh >= 1 / VISUAL_QUALITY.shadowUpdateHz) {
      this.shadowRefresh = 0;
      this.renderer.shadowMap.needsUpdate = true;
    }

    // day phase
    this.phase = (this.phase + dt / (DAY.cycleMinutes * 60)) % 1;
    this._applyDay();

    for (const p of this.animParts) {
      if (p.userData.spin) p.rotation.z += dt * 0.9;
      if (p.userData.blink && p.material) p.material.emissiveIntensity = 0.7 + Math.sin(this.time * 4) * 0.7;
      if (p.userData.flag) p.rotation.y = Math.sin(this.time * 2 + p.userData.phase) * 0.3;
      if (p.userData.water) p.position.y = 0.72 + Math.sin(this.time * 1.6) * 0.03;
      if (p.userData.jet) {
        const k = (Math.sin(this.time * 2.4 + p.userData.phase) + 1) / 2;
        p.scale.y = 0.6 + k * 0.8;
        p.material.opacity = 0.45 + k * 0.35;
      }
      if (p.userData.smoke) updateSmoke(p, this.time);
    }
    for (const cl of this.clouds) {
      cl.position.x += dt * cl.userData.speed;
      if (cl.position.x > 110) cl.position.x = -110;
    }
    if (this.birdFlocks) {
      for (const flock of this.birdFlocks) {
        const d = flock.userData;
        d.a += dt * d.speed;
        flock.position.set(Math.cos(d.a) * d.r, d.h + Math.sin(this.time * 0.5 + d.r) * 1.2, Math.sin(d.a) * d.r);
        flock.rotation.y = -d.a - Math.PI / 2;
        for (const bird of flock.children) {
          const flap = Math.sin(this.time * 9 + bird.userData.phase) * 0.55;
          bird.userData.wings[0].rotation.z = flap;
          bird.userData.wings[1].rotation.z = -flap;
        }
      }
    }
    // fireflies wander gently
    if (this.fireflies && this.fireflyMat.opacity > 0.01) {
      this.fireflies.rotation.y += dt * 0.02;
      this.fireflies.position.y = Math.sin(this.time * 0.7) * 0.3;
    }
  }

  _applyDay() {
    const t = this.phase;
    let k0 = DAY_KEYS[0], k1 = DAY_KEYS[DAY_KEYS.length - 1];
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      if (t >= DAY_KEYS[i].t && t <= DAY_KEYS[i + 1].t) { k0 = DAY_KEYS[i]; k1 = DAY_KEYS[i + 1]; break; }
    }
    const f = (t - k0.t) / Math.max(0.0001, k1.t - k0.t);
    const sky = new THREE.Color(k0.sky).lerp(new THREE.Color(k1.sky), f);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    // §26: fog begins after ~65% of the useful distance; graph mode keeps
    // connected houses visible by pushing fog further out
    const far = lerp(k0.fog, k1.fog, f) * (1 + this.graphDim * (FOG.graphBoost - 1));
    this.scene.fog.far = far;
    this.scene.fog.near = far * FOG.startFrac;
    const dimK = 1 - this.graphDim * 0.55; // graph mode dims the world
    this.sun.intensity = lerp(k0.sun, k1.sun, f) * dimK;
    this.sun.color.set(k0.sunCol).lerp(new THREE.Color(k1.sunCol), f);
    this.hemi.intensity = lerp(k0.hemi, k1.hemi, f) * dimK;
    this.ambient.intensity = lerp(k0.ambient, k1.ambient, f) * (1 - this.graphDim * 0.35);

    // sun arc: rises at dawn (t=0), peaks midday, sets around t≈0.62
    const sunA = t * Math.PI * 2 - Math.PI / 2;
    const dayT = Math.min(1, Math.max(0, t / 0.62));
    const el = Math.max(0.1, Math.sin(dayT * Math.PI));
    this.sun.position.set(Math.cos(sunA) * 70, 25 + el * 45, Math.sin(sunA) * 45);
    this.sunSprite.position.copy(this.sun.position).multiplyScalar(1.15);
    this.sunSprite.material.opacity = Math.max(0, Math.min(1, (this.sun.position.y - 12) / 25));

    // night amount drives windows, lamps, signs, fireflies (spec §17.3)
    const night = t > 0.55 && t < 0.97
      ? Math.min(1, Math.min((t - 0.55) / 0.1, (0.97 - t) / 0.08))
      : 0;
    this.nightAmt = night;
    lampGlow.emissiveIntensity = 0.25 + night * 1.1;
    this.fireflyMat.opacity = night * 0.9;

    for (const [, rec] of this.houseGroups) {
      // each building switches its windows on at a slightly different moment
      const local = Math.max(0, Math.min(1, (night - rec.lightSeed * 0.35) / 0.5));
      for (const m of rec.winMats) m.emissiveIntensity = 0.08 + local * 0.85;
      for (const m of rec.signMats) m.emissiveIntensity = 0.35 + local * 1.3;
    }
  }
}

/** Chimney smoke: puffs rise, grow and fade on a loop. */
export function updateSmoke(smoke, time) {
  for (const puff of smoke.children) {
    const k = (time * 0.22 + puff.userData.k) % 1;
    puff.position.y = k * 1.9;
    puff.position.x = Math.sin(k * 6 + puff.userData.k * 9) * 0.14;
    const s = 0.5 + k * 1.1;
    puff.scale.setScalar(s);
    puff.material.opacity = 0.55 * (1 - k);
  }
}

function makeTree(rnd, x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.4, 5), mat('#8a6f4d', { textureKind: 'bark', textureRepeat: [1, 2] }));
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  g.add(trunk);
  const kind = rnd();
  if (kind < 0.5) {
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.3 + rnd() * 0.6, 2.6 + rnd(), 6), mat(rnd() < 0.5 ? '#4f9a55' : '#5eb85e', { textureKind: 'foliage' }));
    crown.position.y = 2.6;
    crown.castShadow = true;
    g.add(crown);
  } else {
    const R = 1.2 + rnd() * 0.6;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 0), mat('#6cbf5a', { textureKind: 'foliage' }));
    crown.position.y = 2.3;
    crown.castShadow = true;
    g.add(crown);
    if (rnd() < 0.45) {
      for (let i = 0; i < 3; i++) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.13, 5, 4), mat(rnd() < 0.5 ? '#ef5d5d' : '#ffb347'));
        const fa = rnd() * Math.PI * 2;
        fruit.position.set(Math.cos(fa) * R * 0.8, 2.1 + rnd() * 0.9, Math.sin(fa) * R * 0.8);
        g.add(fruit);
      }
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = rnd() * Math.PI * 2;
  const s = 0.8 + rnd() * 0.6;
  g.scale.set(s, s, s);
  return g;
}

export function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const lerp = (a, b, k) => a + (b - a) * k;

function mulberry(seed) {
  let t = seed;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
