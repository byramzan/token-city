// Procedural low-poly item models (task3 §4–6).
// Conventions (§8.2): 1 unit = 1 m, +Y up, item faces +Z, pivot at the lowest
// contact point. Canvas label textures stay tiny (≤256px) per the texture
// budget (§12.3) and all materials go through the shared cache in house.js.

import * as THREE from 'three';
import { mat, glowMat, shade } from './house.js';
import { configureCanvasTexture, inferSurfaceKind } from './materialLibrary.js';
import { itemDefinitionFor } from './houseModel.js';

const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const itemMat = (color, opts = {}) => mat(color, {
  textureKind: opts.textureKind || inferSurfaceKind(color),
  textureRepeat: opts.textureRepeat || [1, 1],
  ...opts,
});
const B = (w, h, d, c, o) => cast(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), itemMat(c, o)));
const C = (r1, r2, h, c, seg = 8) => cast(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), itemMat(c)));
const S = (r, c, w = 7, h = 6) => cast(new THREE.Mesh(new THREE.SphereGeometry(r, w, h), itemMat(c)));
const G = (c) => cast(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), itemMat(c)));
const labelTextureCache = new Map();
let nftArtTexture = null;

/** Tiny canvas label plane — one draw, low resolution, mipmapped. */
function label(text, { w = 0.7, h = 0.35, bg = '#f7f1e3', fg = '#3f3a33', px = 128, font = 0.42 } = {}) {
  const key = JSON.stringify({ text, w, h, bg, fg, px, font });
  if (!labelTextureCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = px; c.height = Math.round(px * (h / w));
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg;
    g.font = `800 ${Math.round(c.height * font)}px "Baloo 2", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((ln, i) => {
      g.fillText(ln, c.width / 2, c.height * ((i + 0.5) / lines.length));
    });
    labelTextureCache.set(key, configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 2 }));
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: labelTextureCache.get(key), toneMapped: false }),
  );
  return m;
}

function sharedNftArtTexture() {
  if (nftArtTexture) return nftArtTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 96, 96);
  gr.addColorStop(0, '#59f2ff'); gr.addColorStop(0.5, '#c792ea'); gr.addColorStop(1, '#ff8a71');
  x.fillStyle = gr; x.fillRect(0, 0, 96, 96);
  const artRnd = (() => { let seed = 193; return () => ((seed = (seed * 48271) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(255,255,255,${0.08 + artRnd() * 0.24})`;
    const size = 5 + Math.floor(artRnd() * 8);
    x.fillRect(artRnd() * 96, artRnd() * 96, size, size);
  }
  nftArtTexture = configureCanvasTexture(new THREE.CanvasTexture(c), { anisotropy: 2 });
  nftArtTexture.name = 'tc_item_nft_art';
  return nftArtTexture;
}

const screenMat = (color, i = 0.8) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: i, flatShading: true,
});

/**
 * Builds an item model. Unknown ids return the neutral delivery box (§11 —
 * the game must never show a missing/pink model).
 */
export function buildItem(id) {
  const g = new THREE.Group();
  const builder = BUILDERS[id];
  if (!builder) return fallbackBox();
  const model = new THREE.Group();
  builder(model);
  const definition = itemDefinitionFor(id);
  if (definition) {
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    model.scale.set(definition.width / Math.max(size.x, 0.001), definition.height / Math.max(size.y, 0.001), definition.depth / Math.max(size.z, 0.001));
    const wall = definition.pivotType === 'rear-attachment';
    const ceiling = definition.pivotType === 'top-center';
    model.position.set(-center.x * model.scale.x,
      -(wall ? center.y : ceiling ? bounds.max.y : bounds.min.y) * model.scale.y,
      -(wall ? bounds.min.z : center.z) * model.scale.z);
    g.userData.itemDefinitionId = id;
    g.userData.modelId = definition.modelId;
    g.userData.pivotType = definition.pivotType;
    g.userData.visualDimensions = [definition.width, definition.height, definition.depth];
    // Decorative motion may illuminate an object but cannot rotate its mesh
    // beyond the declared collision envelope or silently change placement.
    model.traverse((node) => { if (node.userData.spin) node.userData.spin = false; });
  }
  g.add(model);
  return g;
}

export function fallbackBox() {
  const g = new THREE.Group();
  const box = B(0.6, 0.5, 0.6, '#c89a68');
  box.position.y = 0.25;
  const tape = B(0.62, 0.09, 0.62, '#e8c15a');
  tape.position.y = 0.4;
  const lbl = label('?', { w: 0.3, h: 0.3, px: 64 });
  lbl.position.set(0, 0.28, 0.31);
  g.add(box, tape, lbl);
  return g;
}

const BUILDERS = {
  bed_double(g) {
    const frame = B(1.65, 0.22, 2.15, '#a9835c'); frame.position.y = 0.28;
    const mattress = B(1.54, 0.25, 1.99, '#fff0ce'); mattress.position.y = 0.49;
    const quilt = B(1.56, 0.12, 1.35, '#6fa6a0'); quilt.position.set(0, 0.65, 0.3);
    const head = B(1.65, 0.8, 0.11, '#a9835c'); head.position.set(0, 0.55, -1.02);
    g.add(frame, mattress, quilt, head);
    for (const x of [-0.42, 0.42]) {
      const pillow = B(0.61, 0.12, 0.36, '#fff6df'); pillow.position.set(x, 0.69, -0.67); g.add(pillow);
    }
  },
  family_bunk(g) {
    for (const y of [0.35, 1.45]) {
      const frame = B(1.25, 0.16, 2.15, '#a9835c'); frame.position.y = y;
      const mattress = B(1.12, 0.18, 2, '#fff0ce'); mattress.position.y = y + 0.17;
      const quilt = B(1.14, 0.09, 1.35, y < 1 ? '#73a8bb' : '#cfaa60'); quilt.position.set(0, y + 0.3, 0.28);
      const pillow = B(0.84, 0.12, 0.36, '#fff6df'); pillow.position.set(0, y + 0.32, -0.69);
      g.add(frame, mattress, quilt, pillow);
    }
    for (const x of [-0.59, 0.59]) for (const z of [-1.02, 1.02]) {
      const post = B(0.1, 2.15, 0.1, '#9b7750'); post.position.set(x, 1.075, z); g.add(post);
    }
    for (let y = 0.3; y < 1.7; y += 0.28) {
      const step = B(0.43, 0.075, 0.09, '#bd9969'); step.position.set(0.3, y, 1.03); g.add(step);
    }
    const rail = B(1.25, 0.12, 0.08, '#9b7750'); rail.position.set(0, 1.95, -1.02); g.add(rail);
  },
  chair(g) {
    const seat = B(0.6, 0.12, 0.6, '#a9835c'); seat.position.y = 0.48; g.add(seat);
    const cushion = B(0.52, 0.08, 0.52, '#73a8bb'); cushion.position.y = 0.57; g.add(cushion);
    const back = B(0.6, 0.46, 0.1, '#a9835c'); back.position.set(0, 0.78, -0.25); g.add(back);
    for (const x of [-0.23, 0.23]) for (const z of [-0.23, 0.23]) {
      const leg = B(0.07, 0.43, 0.07, '#8a6f4d'); leg.position.set(x, 0.215, z); g.add(leg);
    }
  },
  wardrobe(g) {
    const body = B(0.8, 2, 0.7, '#a9835c'); body.position.y = 1; g.add(body);
    for (const x of [-0.2, 0.2]) {
      const door = B(0.365, 1.85, 0.055, '#bd9969'); door.position.set(x, 1, 0.365); g.add(door);
      const knob = S(0.025, '#e8c15a'); knob.position.set(x < 0 ? -0.06 : 0.06, 1, 0.41); g.add(knob);
    }
  },
  pendant_light(g) {
    const mount = C(0.1, 0.1, 0.05, '#4c5566'); mount.position.y = 0.525;
    const cable = C(0.018, 0.018, 0.25, '#4c5566', 6); cable.position.y = 0.375;
    const shade = C(0.14, 0.325, 0.23, '#e8c15a'); shade.position.y = 0.14;
    const bulb = S(0.09, '#fff6df'); bulb.position.y = 0.055;
    g.add(mount, cable, shade, bulb);
  },
  wall_shelf(g) {
    const shelf = B(1.1, 0.075, 0.38, '#a9835c'); shelf.position.y = -0.1;
    g.add(shelf);
    for (const x of [-0.37, 0.37]) {
      const bracket = B(0.055, 0.35, 0.055, '#8a6f4d'); bracket.position.set(x, -0.075, -0.15); g.add(bracket);
    }
  },
  kitchen_counter(g) {
    const cabinet = B(1.25, 0.83, 0.7, '#a9835c'); cabinet.position.y = 0.415;
    const top = B(1.25, 0.07, 0.7, '#efe3ca'); top.position.y = 0.865;
    g.add(cabinet, top);
    for (const x of [-0.3, 0.3]) {
      const door = B(0.55, 0.69, 0.035, '#bd9969'); door.position.set(x, 0.43, 0.362); g.add(door);
    }
  },
  fridge(g) {
    const body = B(0.75, 1.8, 0.7, '#e6dfd0'); body.position.y = 0.9; g.add(body);
    const seam = B(0.72, 0.018, 0.02, '#a8a494'); seam.position.set(0, 1.25, 0.359); g.add(seam);
    for (const y of [0.8, 1.52]) {
      const handle = B(0.045, 0.25, 0.045, '#748297'); handle.position.set(-0.24, y, 0.375); g.add(handle);
    }
  },
  // ── base furniture (v1 set) ───────────────────────────────────────────────
  rug(g) {
    const r = cast(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.06, 16), itemMat('#d96c5f', { textureKind: 'fabric', textureRepeat: [3, 3] })));
    r.position.y = 0.03;
    const r2 = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.07, 16), itemMat('#f4a4c0', { textureKind: 'fabric', textureRepeat: [2, 2] }));
    r2.position.y = 0.035;
    g.add(r, r2);
  },
  sofa(g) {
    const base = B(2.2, 0.5, 0.9, '#7aa2f7'); base.position.y = 0.35;
    const back = B(2.2, 0.7, 0.25, '#6b8fe0'); back.position.set(0, 0.85, -0.33);
    const armL = B(0.25, 0.75, 0.9, '#6b8fe0'); armL.position.set(-1.0, 0.5, 0);
    const armR = armL.clone(); armR.position.x = 1.0;
    const cush = B(0.9, 0.18, 0.7, '#ffd166'); cush.position.set(-0.5, 0.66, 0.05);
    const cush2 = cush.clone(); cush2.position.x = 0.5;
    g.add(base, back, armL, armR, cush, cush2);
  },
  table(g) {
    const top = B(1.3, 0.1, 0.9, '#a9835c'); top.position.y = 0.62;
    g.add(top);
    for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) {
      const leg = B(0.1, 0.6, 0.1, '#8a6f4d'); leg.position.set(x, 0.3, z);
      g.add(leg);
    }
  },
  plant(g) {
    const pot = C(0.3, 0.22, 0.4, '#c96b4a', 7); pot.position.y = 0.2;
    const bush = G('#5eb85e'); bush.scale.setScalar(0.45); bush.position.y = 0.75;
    const bush2 = G('#6cbf5a'); bush2.scale.setScalar(0.3); bush2.position.set(0.2, 1.0, 0.1);
    g.add(pot, bush, bush2);
  },
  lamp_floor(g) {
    const base = C(0.25, 0.3, 0.08, '#4c5566'); base.position.y = 0.04;
    const pole = C(0.04, 0.04, 1.4, '#4c5566', 6); pole.position.y = 0.75;
    const sh = cast(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 8, 1, true), glowMat('#ffd98a', 0.9)));
    sh.position.y = 1.6;
    g.add(base, pole, sh);
  },
  meme_poster(g) {
    const back = B(1.2, 1.2, 0.06, '#3b2f63');
    const art = label('🚀\nTO THE MOON', { w: 1.05, h: 1.05, bg: '#1c2233', fg: '#ffd166', px: 128, font: 0.2 });
    art.position.z = 0.04;
    g.add(back, art);
  },
  nft_frame(g) {
    const frame = B(1.2, 1.2, 0.1, '#e8c15a');
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: sharedNftArtTexture() }));
    art.position.z = 0.06;
    g.add(frame, art);
  },
  safe(g) {
    const body = B(0.8, 1.0, 0.7, '#525a6b'); body.position.y = 0.5;
    const dial = C(0.12, 0.12, 0.08, '#e8c15a', 10);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 0.6, 0.38);
    const handle = B(0.22, 0.06, 0.06, '#e8c15a'); handle.position.set(0.22, 0.4, 0.37);
    g.add(body, dial, handle);
  },
  hw_wallet(g) {
    const stand = B(0.3, 0.06, 0.2, '#2b3245'); stand.position.y = 0.03;
    const dev = B(0.16, 0.34, 0.06, '#1c2233'); dev.position.y = 0.24; dev.rotation.x = -0.25;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.12), screenMat('#59f2ff', 1));
    scr.position.set(0, 0.28, 0.045); scr.rotation.x = -0.25;
    g.add(stand, dev, scr);
  },
  terminal(g) {
    const desk = B(1.4, 0.08, 0.7, '#4c5566'); desk.position.y = 0.7;
    for (const x of [-0.6, 0.6]) {
      const leg = B(0.08, 0.7, 0.6, '#3a4152'); leg.position.set(x, 0.35, 0);
      g.add(leg);
    }
    const scrBack = B(1.06, 0.56, 0.06, '#1c2233'); scrBack.position.set(0, 1.15, -0.14); scrBack.rotation.x = -0.1;
    const scr = label('TCITY +12.4%', { w: 1.0, h: 0.5, bg: '#0c1018', fg: '#35e07f', px: 160, font: 0.26 });
    scr.position.set(0, 1.15, -0.1);
    scr.rotation.x = -0.1;
    g.add(desk, scrBack, scr);
  },
  server_rack(g) {
    const rack = B(0.9, 2.0, 0.7, '#2b3245'); rack.position.y = 1.0;
    g.add(rack);
    for (let i = 0; i < 5; i++) {
      const unit = B(0.74, 0.22, 0.06, '#3a4152'); unit.position.set(0, 0.4 + i * 0.36, 0.36);
      g.add(unit);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), screenMat(i % 2 ? '#35e07f' : '#59f2ff', 0.9));
      led.position.set(0.26, 0.4 + i * 0.36, 0.4);
      led.userData.blink = true;
      led.userData.phase = i * 1.3;
      g.add(led);
    }
  },
  holo_token(g) {
    const base = C(0.3, 0.36, 0.16, '#2b3245'); base.position.y = 0.08;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 8, 1, true),
      mat('#59f2ff', { transparent: true, opacity: 0.25 }));
    beam.position.y = 0.4;
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 12), screenMat('#59f2ff', 1.3));
    coin.rotation.z = Math.PI / 2;
    coin.position.y = 0.75;
    coin.userData.spin = true;
    g.add(base, beam, coin);
  },

  // ── permanent crypto culture (§4.1) ───────────────────────────────────────
  gm_clock(g) {
    const body = C(0.26, 0.26, 0.1, '#f7f1e3', 12);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.35;
    const face = label('GM', { w: 0.34, h: 0.34, px: 64, fg: '#e8850c' });
    face.position.set(0, 0.35, 0.06);
    const foot = B(0.3, 0.1, 0.16, '#e8c15a'); foot.position.y = 0.05;
    const sun = S(0.06, '#ffd166', 6, 5); sun.position.set(0.2, 0.58, 0);
    g.add(body, face, foot, sun);
  },
  gn_moon(g) {
    const base = C(0.16, 0.2, 0.1, '#4c5566'); base.position.y = 0.05;
    const arm = C(0.03, 0.03, 0.4, '#4c5566', 5); arm.position.y = 0.3;
    const moon = cast(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), screenMat('#cfe0ff', 0.7)));
    moon.position.y = 0.62;
    g.add(base, arm, moon);
  },
  diamond_hands(g) {
    const ped = B(0.6, 0.16, 0.4, '#3b2f63'); ped.position.y = 0.08;
    for (const x of [-0.16, 0.16]) {
      const palm = cast(new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0),
        mat('#8ff0e8', { transparent: true, opacity: 0.85 })));
      palm.position.set(x, 0.36, 0);
      palm.scale.y = 1.5;
      g.add(palm);
    }
    const lbl = label('HODL', { w: 0.4, h: 0.14, px: 96, bg: '#3b2f63', fg: '#8ff0e8' });
    lbl.position.set(0, 0.1, 0.21);
    g.add(ped, lbl);
  },
  paper_bin(g) {
    const bin = C(0.26, 0.2, 0.5, '#8b93a5', 9); bin.position.y = 0.25;
    for (let i = 0; i < 3; i++) {
      const ball = S(0.09, '#f7f1e3', 6, 5);
      ball.position.set((i - 1) * 0.12, 0.55, (i % 2) * 0.1 - 0.05);
      g.add(ball);
    }
    const glove = B(0.16, 0.02, 0.2, '#f7f1e3'); glove.position.set(0.3, 0.01, 0.2); glove.rotation.y = 0.5;
    g.add(bin, glove);
  },
  bag_rack(g) {
    const pole = C(0.05, 0.07, 1.7, '#8a6f4d', 6); pole.position.y = 0.85;
    const cross = B(0.7, 0.06, 0.06, '#8a6f4d'); cross.position.y = 1.6;
    g.add(pole, cross);
    for (const [x, c] of [[-0.3, '#d96c5f'], [0.3, '#7aa2f7']]) {
      const bag = B(0.34, 0.44, 0.24, c); bag.position.set(x, 1.16, 0);
      const strap = B(0.06, 0.18, 0.05, shade(c, -20)); strap.position.set(x, 1.48, 0);
      g.add(bag, strap);
    }
    const tag = label('HEAVY', { w: 0.3, h: 0.12, px: 96, bg: '#ffd166' });
    tag.position.set(-0.3, 0.85, 0.14);
    g.add(tag);
  },
  copium_tank(g) {
    const tank = C(0.22, 0.22, 0.85, '#4f9a55', 10); tank.position.y = 0.45;
    const cap = C(0.1, 0.12, 0.14, '#8b93a5', 8); cap.position.y = 0.93;
    const lbl = label('COPE', { w: 0.34, h: 0.16, px: 96, bg: '#2f6e35', fg: '#dfffe0' });
    lbl.position.set(0, 0.5, 0.23);
    g.add(tank, cap, lbl);
    for (let i = 0; i < 3; i++) {
      const puff = cast(new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + i * 0.03, 0),
        mat('#9fe6a5', { transparent: true, opacity: 0.55 })));
      puff.position.set(0.16 + i * 0.1, 1.0 + i * 0.16, 0);
      g.add(puff);
    }
  },
  hopium_balloon(g) {
    const weight = B(0.18, 0.1, 0.18, '#8b93a5'); weight.position.y = 0.05;
    const string = C(0.008, 0.008, 1.5, '#e8e2d2', 4); string.position.y = 0.85;
    const ball = cast(new THREE.Mesh(new THREE.SphereGeometry(0.3, 9, 8), mat('#35e07f')));
    ball.position.y = 1.85;
    ball.scale.y = 1.15;
    g.add(weight, string, ball);
  },
  ath_mountain(g) {
    const rock = cast(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 6), mat('#8b93a5')));
    rock.position.y = 0.35;
    const snow = cast(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.24, 6), mat('#f4f1de')));
    snow.position.y = 0.66;
    const pole = C(0.015, 0.015, 0.3, '#4c5566', 4); pole.position.set(0.02, 0.85, 0);
    const flag = label('ATH', { w: 0.2, h: 0.11, px: 64, bg: '#35e07f', fg: '#0c3d17' });
    flag.position.set(0.12, 0.92, 0);
    g.add(rock, snow, pole, flag);
  },
  rug_trap(g) {
    const r = B(1.6, 0.05, 1.1, '#c792ea'); r.position.y = 0.025;
    const r2 = B(1.1, 0.06, 0.7, '#f4a4c0'); r2.position.y = 0.03;
    // подозрительно приподнятый угол и люк
    const corner = B(0.4, 0.06, 0.4, '#a06ee0');
    corner.position.set(0.62, 0.1, 0.38);
    corner.rotation.z = 0.28;
    const hatch = B(0.5, 0.04, 0.5, '#6b5540'); hatch.position.set(0.62, 0.005, 0.38);
    g.add(r, r2, hatch, corner);
  },
  green_candle(g) {
    const base = C(0.2, 0.24, 0.1, '#2b3245'); base.position.y = 0.05;
    const body = B(0.22, 1.3, 0.22, '#35e07f'); body.position.y = 0.75;
    const wick = B(0.06, 0.35, 0.06, '#0c3d17'); wick.position.y = 1.55;
    const glow = cast(new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.32, 0.24), screenMat('#35e07f', 0.35)));
    glow.position.y = 0.75;
    g.add(base, body, wick, glow);
  },
  red_alarm(g) {
    const mountP = B(0.34, 0.34, 0.06, '#4c5566');
    const dome = cast(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), screenMat('#ff5d5d', 1)));
    dome.position.z = 0.06;
    dome.rotation.x = -Math.PI / 2;
    dome.userData.blink = true;
    const lbl = label('DIP?', { w: 0.26, h: 0.1, px: 64, bg: '#4c5566', fg: '#ffd9d9' });
    lbl.position.set(0, -0.22, 0.04);
    g.add(mountP, dome, lbl);
  },
  telescope(g) {
    const tripod = C(0.02, 0.3, 0.9, '#4c5566', 4); tripod.position.y = 0.45;
    const tube = C(0.09, 0.12, 0.7, '#3b2f63', 8);
    tube.position.y = 1.05;
    tube.rotation.x = -Math.PI / 3.2; // always aimed at the moon
    const eye = C(0.05, 0.05, 0.12, '#e8c15a', 6);
    eye.position.set(0, 0.82, -0.24);
    eye.rotation.x = -Math.PI / 3.2;
    g.add(tripod, tube, eye);
  },
  grass_mat(g) {
    const soil = B(0.8, 0.05, 0.8, '#7a5b3a'); soil.position.y = 0.025;
    const grass = B(0.76, 0.06, 0.76, '#5eb85e'); grass.position.y = 0.06;
    for (let i = 0; i < 5; i++) {
      const blade = B(0.03, 0.14, 0.03, '#6cbf5a');
      blade.position.set((Math.random() - 0.5) * 0.6, 0.14, (Math.random() - 0.5) * 0.6);
      g.add(blade);
    }
    const lbl = label('TOUCH', { w: 0.4, h: 0.12, px: 96, bg: '#5eb85e', fg: '#0c3d17' });
    lbl.rotation.x = -Math.PI / 2;
    lbl.position.set(0, 0.1, 0);
    g.add(soil, grass, lbl);
  },
  alpha_folder(g) {
    const folder = B(0.36, 0.26, 0.05, '#ffd166');
    folder.position.y = 0.16;
    folder.rotation.x = -0.3;
    const tab = B(0.12, 0.06, 0.05, '#e8b53a'); tab.position.set(-0.1, 0.3, -0.02); tab.rotation.x = -0.3;
    const a = label('A', { w: 0.14, h: 0.14, px: 48, bg: '#ffd166', fg: '#7a4d07' });
    a.position.set(0.02, 0.17, 0.02);
    a.rotation.x = -0.3;
    const stand = B(0.3, 0.04, 0.2, '#8a6f4d'); stand.position.y = 0.02;
    g.add(folder, tab, a, stand);
  },
  dyor_shelf(g) {
    const frame = B(1.0, 1.9, 0.34, '#8a6f4d'); frame.position.y = 0.95;
    g.add(frame);
    const cols = ['#d96c5f', '#7aa2f7', '#4ecdc4', '#ffd166', '#c792ea'];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4; i++) {
        const book = B(0.16, 0.42, 0.22, cols[(row + i) % 5]);
        book.position.set(-0.33 + i * 0.22, 0.42 + row * 0.6, 0.03);
        g.add(book);
      }
    }
    const lbl = label('DYOR', { w: 0.5, h: 0.15, px: 96, bg: '#8a6f4d', fg: '#f7f1e3' });
    lbl.position.set(0, 1.98, 0.1);
    g.add(lbl);
  },
  vibes_terminal(g) {
    const stand = C(0.2, 0.3, 0.5, '#2b3245', 6); stand.position.y = 0.25;
    const scrBack = B(0.9, 0.65, 0.08, '#1c2233'); scrBack.position.y = 0.85;
    const scr = label('☀ BULLISH ☀', { w: 0.8, h: 0.5, px: 128, bg: '#0c1018', fg: '#ffd166', font: 0.24 });
    scr.position.set(0, 0.85, 0.05);
    g.add(stand, scrBack, scr);
  },
  degen_coffee(g) {
    const machine = B(0.34, 0.44, 0.3, '#d96c5f'); machine.position.y = 0.22;
    const spout = B(0.06, 0.08, 0.1, '#4c5566'); spout.position.set(0, 0.3, 0.18);
    const cup = C(0.06, 0.05, 0.1, '#f7f1e3', 8); cup.position.set(0, 0.05, 0.18);
    const steam = S(0.04, '#ffffff', 5, 4); steam.position.set(0, 0.16, 0.18);
    const lbl = label('24/7', { w: 0.22, h: 0.1, px: 64, bg: '#d96c5f', fg: '#fff' });
    lbl.position.set(0, 0.4, 0.16);
    g.add(machine, spout, cup, steam, lbl);
  },
  sell_button(g) {
    const base = C(0.3, 0.34, 0.12, '#4c5566', 10); base.position.y = 0.06;
    const btn = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 10), screenMat('#ff5d5d', 0.5)));
    btn.position.y = 0.17;
    const lbl = label('DO NOT PRESS\nDURING DIP', { w: 0.6, h: 0.22, px: 128, bg: '#f7f1e3', fg: '#a33', font: 0.3 });
    lbl.position.set(0, 0.14, 0.34);
    lbl.rotation.x = -0.4;
    g.add(base, btn, lbl);
  },
  doormat(g) {
    const m = B(1.0, 0.04, 0.6, '#c89a68'); m.position.y = 0.02;
    const lbl = label('BACK TO\nTHE TRENCHES', { w: 0.9, h: 0.5, px: 128, bg: '#c89a68', fg: '#5b3a1e', font: 0.26 });
    lbl.rotation.x = -Math.PI / 2;
    // The entrance camera looks from -Z into the room. Rotate the horizontal
    // label around its own normal so the copy reads from the doorway instead
    // of appearing upside down in the interior view.
    lbl.rotateZ(Math.PI);
    lbl.position.y = 0.045;
    g.add(m, lbl);
  },
  candle_arcade(g) {
    const cab = B(0.8, 1.7, 0.7, '#3b2f63'); cab.position.y = 0.85;
    const scr = label('CHASE THE\nCANDLE', { w: 0.6, h: 0.45, px: 128, bg: '#0c1018', fg: '#35e07f', font: 0.26 });
    scr.position.set(0, 1.25, 0.36);
    scr.rotation.x = -0.15;
    const panel = B(0.8, 0.1, 0.5, '#a06ee0'); panel.position.set(0, 0.85, 0.45); panel.rotation.x = 0.4;
    const joy = S(0.05, '#ff5d5d', 6, 5); joy.position.set(-0.15, 0.95, 0.5);
    const marq = cast(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.2, 0.72), screenMat('#c792ea', 0.6)));
    marq.position.y = 1.8;
    g.add(cab, scr, panel, joy, marq);
  },

  // ── Meme Reserve Week (§5) ────────────────────────────────────────────────
  oil_barrel(g) {
    const barrel = C(0.32, 0.32, 0.85, '#2b3245', 10); barrel.position.y = 0.43;
    for (const y of [0.2, 0.65]) {
      const ring = C(0.335, 0.335, 0.05, '#8b93a5', 10); ring.position.y = y;
      g.add(ring);
    }
    const plaque = label('OFFICIAL\nUNOFFICIAL', { w: 0.42, h: 0.24, px: 96, bg: '#e8c15a', fg: '#5b3a1e', font: 0.26 });
    plaque.position.set(0, 0.45, 0.33);
    g.add(barrel, plaque);
  },
  reserve_safe(g) {
    const body = B(1.0, 1.3, 0.85, '#525a6b'); body.position.y = 0.65;
    const door = B(0.8, 1.05, 0.08, '#626b7d');
    door.position.set(0.28, 0.62, 0.44);
    door.rotation.y = 0.9; // приоткрыта
    const coin = C(0.07, 0.07, 0.03, '#ffd166', 10);
    coin.rotation.x = Math.PI / 2;
    coin.position.set(0, 0.35, 0.2);
    const note = label('RESERVE\nSECURED', { w: 0.4, h: 0.26, px: 96, bg: '#f7f1e3', font: 0.26 });
    note.position.set(-0.12, 0.75, 0.45);
    g.add(body, door, coin, note);
  },
  ticker_gen(g) {
    const body = B(0.7, 1.3, 0.5, '#2b3245'); body.position.y = 0.65;
    const scr = label('MOIL FUND\nVERY REAL', { w: 0.55, h: 0.4, px: 128, bg: '#0c1018', fg: '#59f2ff', font: 0.24 });
    scr.position.set(0, 0.95, 0.26);
    const slot = B(0.4, 0.05, 0.06, '#1c2233'); slot.position.set(0, 0.45, 0.26);
    const paper = B(0.3, 0.2, 0.02, '#f7f1e3'); paper.position.set(0, 0.32, 0.3); paper.rotation.x = 0.4;
    g.add(body, scr, slot, paper);
  },
  nothing_cert(g) {
    const frame = B(1.0, 0.76, 0.07, '#e8c15a');
    const cert = label('CERTIFICATE\nOF NOTHING\n★ 100% ★', { w: 0.86, h: 0.62, px: 160, bg: '#f7f1e3', fg: '#5b4a32', font: 0.2 });
    cert.position.z = 0.045;
    g.add(frame, cert);
  },
  official_stamp(g) {
    const handle = C(0.05, 0.07, 0.3, '#8a6f4d', 8); handle.position.y = 0.35;
    const head = B(0.4, 0.14, 0.3, '#a33'); head.position.y = 0.14;
    const page = B(0.5, 0.02, 0.36, '#f7f1e3'); page.position.set(0.4, 0.01, 0);
    const word = label('OFFICIAL', { w: 0.4, h: 0.12, px: 96, bg: '#f7f1e3', fg: '#a33' });
    word.rotation.x = -Math.PI / 2;
    word.position.set(0.4, 0.03, 0);
    g.add(handle, head, page, word);
  },
  copycat_printer(g) {
    const body = B(0.8, 0.4, 0.6, '#dfe3ea'); body.position.y = 0.5;
    const legs = B(0.7, 0.3, 0.5, '#8b93a5'); legs.position.y = 0.15;
    const texts = ['OFFICIAL', 'MORE\nOFFICIAL', 'MOST\nOFFICIAL'];
    texts.forEach((t, i) => {
      const page = label(t, { w: 0.34, h: 0.4, px: 80, bg: '#f7f1e3', fg: '#3b2f63', font: 0.2 });
      page.position.set(-0.35 + i * 0.35, 0.86, 0.1 - i * 0.06);
      page.rotation.x = -0.25;
      g.add(page);
    });
    g.add(body, legs);
  },
  bull_bust(g) {
    const ped = B(0.4, 0.3, 0.4, '#cfc6ae'); ped.position.y = 0.15;
    const chest = B(0.44, 0.3, 0.3, '#8a6f4d'); chest.position.y = 0.45;
    const head = B(0.3, 0.26, 0.34, '#7a5b3a'); head.position.set(0, 0.7, 0.06);
    for (const x of [-0.17, 0.17]) {
      const horn = C(0.03, 0.06, 0.2, '#f4f1de', 5);
      horn.position.set(x, 0.84, 0.05);
      horn.rotation.z = x > 0 ? -0.7 : 0.7;
      g.add(horn);
    }
    const tie = B(0.08, 0.2, 0.03, '#35e07f'); tie.position.set(0, 0.4, 0.17);
    g.add(ped, chest, head, tie);
  },
  asset_board(g) {
    const board = B(1.3, 0.9, 0.06, '#f7f1e3');
    const pins = ['#d96c5f', '#7aa2f7', '#ffd166', '#4ecdc4'];
    pins.forEach((c, i) => {
      const pin = S(0.05, c, 6, 5);
      pin.position.set(-0.45 + (i % 2) * 0.5, 0.25 - Math.floor(i / 2) * 0.45, 0.05);
      g.add(pin);
      const arrow = B(0.3, 0.03, 0.02, '#5b4a32');
      arrow.position.set(pin.position.x + 0.2, pin.position.y - 0.1, 0.05);
      arrow.rotation.z = -0.5;
      g.add(arrow);
    });
    const vibes = label('VIBES', { w: 0.4, h: 0.16, px: 96, bg: '#ffd166', fg: '#5b3a1e' });
    vibes.position.set(0.3, -0.25, 0.06);
    g.add(board, vibes);
  },

  // ── pop culture (§6) ──────────────────────────────────────────────────────
  portal(g) {
    const ring = cast(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 8, 20), screenMat('#c792ea', 0.9)));
    ring.position.y = 0.85;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20),
      mat('#a06ee0', { transparent: true, opacity: 0.4 }));
    disc.position.y = 0.85;
    const base = B(0.9, 0.12, 0.5, '#4c5566'); base.position.y = 0.06;
    const sign = label('STORAGE →', { w: 0.5, h: 0.13, px: 96, bg: '#4c5566', fg: '#f7f1e3' });
    sign.position.set(0, 0.2, 0.28);
    g.add(ring, disc, base, sign);
  },
  brain_lamp(g) {
    const base = C(0.18, 0.22, 0.1, '#4c5566'); base.position.y = 0.05;
    const stem = C(0.03, 0.03, 0.5, '#4c5566', 5); stem.position.y = 0.35;
    const brain = cast(new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), screenMat('#ffd98a', 0.9)));
    brain.position.y = 0.75;
    brain.scale.set(1.1, 0.9, 1);
    g.add(base, stem, brain);
  },
  ai_printer(g) {
    const body = B(0.7, 0.5, 0.55, '#aeb6c2'); body.position.y = 0.55;
    const legs = B(0.6, 0.3, 0.45, '#6d7684'); legs.position.y = 0.15;
    const eye = cast(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), screenMat('#59f2ff', 1.2)));
    eye.position.set(0, 0.68, 0.29);
    eye.userData.blink = true;
    const page = label('SLOP #4821', { w: 0.4, h: 0.3, px: 96, bg: '#f7f1e3', fg: '#8a7f6a', font: 0.2 });
    page.position.set(0, 0.45, 0.35);
    page.rotation.x = -0.5;
    g.add(body, legs, eye, page);
  },
  ring_light(g) {
    const tripod = C(0.02, 0.28, 1.1, '#4c5566', 4); tripod.position.y = 0.55;
    const ring = cast(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 18), screenMat('#fff3cf', 1)));
    ring.position.y = 1.35;
    const phone = B(0.1, 0.18, 0.02, '#1c2233'); phone.position.set(0, 1.35, 0.02);
    g.add(tripod, ring, phone);
  },
  neon_summer(g) {
    const back = B(1.3, 0.5, 0.05, '#2b3245');
    const txt = label('SUMMER WAS\nDIFFERENT', { w: 1.15, h: 0.4, px: 160, bg: '#2b3245', fg: '#ff8ac2', font: 0.3 });
    txt.position.z = 0.035;
    const tube = cast(new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.05, 0.05), screenMat('#ff8ac2', 1)));
    tube.position.y = -0.28;
    g.add(back, txt, tube);
  },

  // ── yard items (outdoor sockets) ──────────────────────────────────────────
  exit_fountain(g) {
    const pool = C(0.9, 1.0, 0.4, '#cfc6ae', 12); pool.position.y = 0.2;
    const water = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 12),
      mat('#6fd6e8', { transparent: true, opacity: 0.85 })));
    water.position.y = 0.42;
    const column = C(0.12, 0.16, 0.5, '#cfc6ae', 8); column.position.y = 0.65;
    const whaleToy = S(0.12, '#7aa2f7', 7, 6); whaleToy.position.set(0.4, 0.5, 0.2); whaleToy.scale.z = 1.5;
    const pipe = C(0.05, 0.05, 0.4, '#8b93a5', 6);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0.95, 0.18, 0.4);
    g.add(pool, water, column, whaleToy, pipe);
  },
  dept_flag(g) {
    const pole = C(0.04, 0.06, 2.2, '#e8e2d2', 6); pole.position.y = 1.1;
    const flag = label('DEPT. OF\nMEMES', { w: 0.8, h: 0.5, px: 128, bg: '#3b2f63', fg: '#ffd166', font: 0.26 });
    flag.position.set(0.44, 1.85, 0);
    flag.userData.flag = true;
    flag.userData.phase = Math.random() * 5;
    g.add(pole, flag);
  },
  touch_patch(g) {
    const soil = C(0.7, 0.78, 0.1, '#7a5b3a', 10); soil.position.y = 0.05;
    const grass = C(0.66, 0.66, 0.08, '#5eb85e', 10); grass.position.y = 0.12;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const blade = B(0.04, 0.18, 0.04, '#6cbf5a');
      blade.position.set(Math.cos(a) * 0.4, 0.22, Math.sin(a) * 0.4);
      g.add(blade);
    }
    const sign = label('TOUCH GRASS', { w: 0.5, h: 0.12, px: 96, bg: '#f7f1e3', fg: '#2f6e35' });
    sign.position.set(0, 0.5, 0.5);
    const post = B(0.05, 0.4, 0.05, '#8a6f4d'); post.position.set(0, 0.25, 0.52);
    g.add(soil, grass, sign, post);
  },
  bull_statue(g) {
    const ped = B(0.7, 0.5, 0.7, '#cfc6ae'); ped.position.y = 0.25;
    const body = B(0.8, 0.45, 0.4, '#8a6f4d'); body.position.y = 0.75;
    const head = B(0.3, 0.3, 0.3, '#7a5b3a'); head.position.set(0.45, 0.95, 0);
    for (const z of [-0.1, 0.1]) {
      const horn = C(0.03, 0.05, 0.22, '#f4f1de', 5);
      horn.position.set(0.55, 1.12, z);
      horn.rotation.x = z > 0 ? 0.6 : -0.6;
      g.add(horn);
    }
    for (const [x, z] of [[-0.25, -0.12], [0.25, -0.12], [-0.25, 0.12], [0.25, 0.12]]) {
      const leg = B(0.12, 0.3, 0.12, '#7a5b3a'); leg.position.set(x, 0.55, z);
      g.add(leg);
    }
    g.add(ped, body, head);
  },
};
