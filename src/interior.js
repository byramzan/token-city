// Interior editor v3: renders the parametric HouseDefinition as a multi-floor
// dollhouse. Placement is a strict socket → preview → confirm workflow.
// The front wall exists in data but is ghost-rendered so the camera sees in.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { glowMat, shade } from './house.js';
import { schemeOf, ITEMS } from './config.js';
import { buildItem } from './items.js';
import { makePerson } from './residents.js';
import { surfaceMaps, VISUAL_QUALITY } from './materialLibrary.js';
import {
  buildHouseDefinition, validatePlacement, bestPlacement, findZone, findWall,
  wallPoint, wallAngle, FLOOR_HEIGHT, SLAB, WALL_T, normalizeObjectInstance,
  validateHouseDefinition,
  itemDefinitionFor,
} from './houseModel.js';
// The snapshot rule is shared with the backend so the client and the server
// agree on what "no changes" means (task8 §21.2, §21.4).
import { interiorSnapshot, interiorSnapshotHash } from '../server/interiorSnapshot.js';
// The doorway frame layout is a pure module so the no-coincident-face rule can
// be regression tested without a renderer (task8 §22).
import { WALL_SEAM, interiorDoorFrameLayout, wallBandBottom } from '../server/doorGeometry.js';

const ZONE_COLORS = {
  main: '#59f2ff', side: '#8dff9e', walldecor: '#ffd166', surface: '#c792ea',
  sill: '#7aa2f7', entry: '#ff8a71',
};

/** Disjoint floor rectangles with real stair holes, never a hidden solid cap. */
export function floorSlabRectangles(floor) {
  const opening = floor.stairOpening;
  return floor.rooms.flatMap(({ rect: r }) => {
    if (!opening) return [{ ...r }];
    const cut = {
      x0: Math.max(r.x0, opening.x0), x1: Math.min(r.x1, opening.x1),
      z0: Math.max(r.z0, opening.z0), z1: Math.min(r.z1, opening.z1),
    };
    if (cut.x0 >= cut.x1 || cut.z0 >= cut.z1) return [{ ...r }];
    return [
      { x0: r.x0, x1: cut.x0, z0: r.z0, z1: r.z1 },
      { x0: cut.x1, x1: r.x1, z0: r.z0, z1: r.z1 },
      { x0: cut.x0, x1: cut.x1, z0: r.z0, z1: cut.z0 },
      { x0: cut.x0, x1: cut.x1, z0: cut.z1, z1: r.z1 },
    ].filter((part) => part.x1 - part.x0 > 0.001 && part.z1 - part.z0 > 0.001);
  });
}

function clippedAtRidge(polygon, side) {
  const points = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const insideA = side * a[0] >= -0.000001, insideB = side * b[0] >= -0.000001;
    if (insideA) points.push(a);
    if (insideA !== insideB) {
      const t = -a[0] / (b[0] - a[0]);
      points.push([0, a[1] + t * (b[1] - a[1])]);
    }
  }
  return points;
}

function roofSurfaceGeometry(polygon, heightAt, underside = false) {
  const points = polygon.map(([x, z]) => new THREE.Vector2(x, z));
  const triangles = THREE.ShapeUtils.triangulateShape(points, []);
  const positions = [], uv = [], indices = [];
  for (const [x, z] of polygon) {
    positions.push(x, heightAt(x) - (underside ? 0.16 : 0), z);
    uv.push(x / 4, z / 4);
  }
  for (const [a, b, c] of triangles) indices.push(...(underside ? [a, b, c] : [a, c, b]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export { interiorSnapshot, interiorSnapshotHash };

export class Interior {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2b3245');
    // interior fog is disabled by spec (task4 §26)
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 180);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 46;
    this.controls.maxPolarAngle = 1.5;
    this.controls.enabled = false;

    this.def = null;
    this.objects = [];         // working copy while editing
    this.committed = [];       // last saved objects (for cancel)
    this.undoStack = [];
    this.redoStack = [];
    this.activeFloor = 0;
    this.viewMode = 'ghost';   // isolate | ghost | stacked | cutaway
    this.editMode = false;
    this.selectedOid = null;

    this.floorGroups = [];
    this.floorMats = [];       // per-floor local materials (opacity control)
    this.floorMaterialCache = new Map();
    this.zoneMarkers = {};     // zoneId -> marker mesh
    this.objectMeshes = {};    // oid -> mesh
    this.animItems = [];
    this.pendingPreview = null;
    this.placementState = { phase: 'idle', zoneId: null, itemId: null };
    this.itemEligibility = () => true;
    this.t = 0;
    this.shadowRefresh = 0;
    this.roofGroup = null;
  }

  // per-floor local material so ghost mode can fade a whole floor safely
  _mat(color, fi, opts = {}) {
    const { surface = null, repeat = [1, 1], ...materialOpts } = opts;
    const key = `${fi}:${color}:${surface || 'flat'}:${JSON.stringify(repeat)}:${JSON.stringify(materialOpts)}`;
    if (!this.floorMaterialCache.has(key)) {
      const maps = surface ? surfaceMaps(surface, repeat) : {};
      const transparent = materialOpts.transparent === true || Number(materialOpts.opacity) < 1;
      const m = new THREE.MeshStandardMaterial({
        color,
        ...maps,
        roughness: materialOpts.roughness ?? maps.roughness ?? 0.95,
        metalness: materialOpts.metalness ?? maps.metalness ?? 0,
        flatShading: true,
        transparent,
        ...materialOpts,
      });
      m.userData.interiorOwned = true;
      this.floorMaterialCache.set(key, m);
      (this.floorMats[fi] ||= []).push(m);
    }
    return this.floorMaterialCache.get(key);
  }

  // ── build ──────────────────────────────────────────────────────────────────
  build(houseCfg, placements, canonicalDefinition = null) {
    this.clear();
    this.cfg = houseCfg;
    this.def = canonicalDefinition
      ? JSON.parse(JSON.stringify(canonicalDefinition))
      : buildHouseDefinition(houseCfg);
    this.objects = JSON.parse(JSON.stringify(placements?.objects || []))
      .map((obj, index) => normalizeObjectInstance(this.def, obj, index));
    this.committed = JSON.parse(JSON.stringify(this.objects));
    this.baseRevision = placements?.revision || 0;
    this.initialInteriorRevision = this.baseRevision;
    this.initialInteriorSnapshotHash = interiorSnapshotHash(this.committed);
    this.saveState = 'idle';
    // Never reuse an object id after removals/undo. Reusing obj_003 while an
    // older obj_003 still exists was one source of disappearing furniture.
    this.objectSeq = Math.max(this.objects.length, ...this.objects.map((obj) => {
      const match = String(obj.oid || '').match(/_(\d+)$/);
      return match ? Number(match[1]) : 0;
    }));
    this.undoStack = []; this.redoStack = [];
    this.activeFloor = 0;
    this.selectedOid = null;
    this.pendingPreview = null;

    const sc = schemeOf(houseCfg);
    const amb = new THREE.HemisphereLight('#fff6e6', '#b39977', 1.45);
    const rim = new THREE.DirectionalLight('#fff0d1', 1.6);
    const fullHeight = this.def.floors.at(-1).elevation + FLOOR_HEIGHT;
    rim.position.set(-8, fullHeight + 12, 9);
    rim.target.position.set(0, fullHeight / 2, 0);
    rim.castShadow = true;
    rim.shadow.mapSize.set(1024, 1024);
    const shadowExtent = Math.max(11, fullHeight);
    Object.assign(rim.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 0.5, far: 90 });
    rim.shadow.bias = -0.00015;
    rim.shadow.normalBias = 0.025;
    rim.shadow.radius = 2;
    this.scene.add(amb, rim, rim.target);

    for (const floor of this.def.floors) {
      const g = new THREE.Group();
      g.position.y = floor.elevation;
      this.scene.add(g);
      this.floorGroups[floor.floorIndex] = g;
      this._buildFloor(floor, g, sc);
      const light = new THREE.PointLight('#ffe9c4', 22, 24, 1.7);
      light.userData.baseIntensity = light.intensity;
      light.position.set(0, FLOOR_HEIGHT - 0.4, 1.2);
      g.add(light);
    }
    this._buildRoof(sc);
    for (const obj of this.objects) this._spawnObject(obj, false);
    this._buildFamilyActors();

    this.camera.position.set(0, 7.5, 13.5);
    this.controls.target.set(0, 1.6, 0);
    this.controls.update();
    this.setFloor(0);
    this.renderer.shadowMap.needsUpdate = true;
  }

  _buildFamilyActors() {
    for (const actor of this.familyActors || []) { actor.parent?.remove(actor); this._disposeGroup(actor); }
    this.familyActors = [];
    let remaining = this.cfg.construction?.status === 'building'
      ? (this.cfg.completedFloorCount ? 4 + (this.cfg.completedFloorCount - 1) * 2 : 0)
      : 4 + (this.def.floorCount - 1) * 2;
    for (const obj of this.objects) {
      const meta = itemDefinitionFor(obj.itemId);
      if (!meta?.sleepingCapacity || remaining <= 0) continue;
      const floorIndex = this._floorIndexOf(obj);
      for (let bed = 0; bed < Math.min(meta.sleepingCapacity, remaining); bed++) {
        const person = makePerson(this.familyActors.length);
        person.userData.assignedSlotId = obj.slotId;
        person.userData.floorIndex = floorIndex;
        const bunk = obj.itemId === 'family_bunk';
        const x = bunk ? 0 : (bed ? 0.35 : -0.35);
        const local = new THREE.Vector3(x, bunk ? 0.52 + bed * 0.98 : 0.48, 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), obj.rot || 0);
        person.position.set(obj.localPosition[0] + local.x, local.y, obj.localPosition[2] + local.z);
        person.rotation.set(-Math.PI / 2, 0, obj.rot || 0);
        this.floorGroups[floorIndex].add(person);
        this.familyActors.push(person);
      }
      remaining -= meta.sleepingCapacity;
    }
  }

  _buildFloor(floor, g, sc) {
    const fi = floor.floorIndex;
    const wallCol = fi === 0 ? '#efe9dd' : '#e9e2f0';
    const floorCol = fi === 0 ? '#c9a06c' : '#b78e5c';

    // floor slab per room (upper floor keeps the stair opening visible)
    for (const r of floorSlabRectangles(floor)) {
      const width = r.x1 - r.x0, depth = r.z1 - r.z0;
      const geometry = new THREE.BoxGeometry(width, SLAB, depth);
      // Keep grain scale/phase continuous across room and stair-cut pieces.
      const positions = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(normal.getY(i)) < 0.5) continue;
        uv.setXY(i, (positions.getX(i) + (r.x0 + r.x1) / 2) / 4, (positions.getZ(i) + (r.z0 + r.z1) / 2) / 4);
      }
      const slab = new THREE.Mesh(
        geometry,
        this._mat(floorCol, fi, { surface: 'floorWood' }),
      );
      slab.position.set((r.x0 + r.x1) / 2, -SLAB / 2, (r.z0 + r.z1) / 2);
      slab.receiveShadow = true;
      slab.userData.floorPlane = fi;
      g.add(slab);
    }
    if (floor.stairOpening) {
      const o = floor.stairOpening;
      const frameMat = this._mat('#8a6f4d', fi, { surface: 'wood' });
      for (const [width, depth, x, z] of [
        [0.08, o.z1 - o.z0 + 0.16, o.x0 - 0.04, (o.z0 + o.z1) / 2],
        [0.08, o.z1 - o.z0 + 0.16, o.x1 + 0.04, (o.z0 + o.z1) / 2],
        [o.x1 - o.x0, 0.08, (o.x0 + o.x1) / 2, o.z0 - 0.04],
        [o.x1 - o.x0, 0.08, (o.x0 + o.x1) / 2, o.z1 + 0.04],
      ]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, depth), frameMat);
        frame.position.set(x, 0.04, z);
        g.add(frame);
      }
    }

    // walls with real openings — no decorative windows on solid walls (§11.3)
    for (const wall of floor.walls) {
      this._buildWall(wall, g, fi, wallCol, sc, floor);
    }

    // stairs on the lower floor
    if (floor.stair) {
      const s = floor.stair.rect;
      const steps = 13;
      const runZ = (s.z1 - s.z0) / steps;
      const rise = floor.stair.riseHeight || FLOOR_HEIGHT + SLAB;
      for (let i = 0; i < steps; i++) {
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(s.x1 - s.x0, 0.12, runZ),
          this._mat('#a9835c', fi, { surface: 'floorWood', repeat: [1, 2] }),
        );
        step.position.set(
          (s.x0 + s.x1) / 2,
          ((i + 1) / steps) * rise - 0.06,
          floor.stair.risingDirection === 'positive-z' ? s.z0 + runZ * (i + 0.5) : s.z1 - runZ * (i + 0.5),
        );
        step.castShadow = true;
        g.add(step);
      }
      // A continuous handrail gives the stairwell an unambiguous edge. The
      // landing itself stays open for the navigation clearance in the model.
      const railLength = Math.hypot(s.z1 - s.z0, rise);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, railLength), this._mat('#8a6f4d', fi, { surface: 'wood' }));
      rail.position.set(s.x1 - 0.06, rise / 2 + 0.7, (s.z0 + s.z1) / 2);
      rail.rotation.x = (floor.stair.risingDirection === 'positive-z' ? -1 : 1) * Math.atan2(rise, s.z1 - s.z0);
      g.add(rail);
    }

    // shelves for surface zones
    for (const room of floor.rooms) {
      for (const zone of room.zones) {
        if (zone.kind !== 'surface') continue;
        const r = zone.rect;
        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(r.x1 - r.x0, 0.1, r.z1 - r.z0 + 0.1),
          this._mat('#a9835c', fi, { surface: 'wood', repeat: [1.4, 1] }),
        );
        shelf.position.set((r.x0 + r.x1) / 2, zone.elevated - 0.06, (r.z0 + r.z1) / 2);
        shelf.castShadow = true;
        g.add(shelf);
      }
      // baseboard accent
      const rr = room.rect;
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(rr.x1 - rr.x0 - 0.3, 0.2, 0.08),
        this._mat(shade(sc.accent, -10), fi, { surface: 'wood' }),
      );
      skirt.position.set((rr.x0 + rr.x1) / 2, 0.1, rr.z0 + WALL_T / 2 + 0.1);
      g.add(skirt);
    }

    // attic roof planes
    if (floor.isAttic) {
      const f = this.def.footprint;
      for (const side of [-1, 1]) {
        const plane = new THREE.Mesh(
          new THREE.BoxGeometry(Math.hypot(f.w / 2, FLOOR_HEIGHT - 1.2) + 0.4, 0.16, f.d + 0.6),
          this._mat(shade(sc.roof, 6), fi, { surface: 'plaster', repeat: [2, 2] }),
        );
        plane.position.set(side * f.w / 4, 1.2 + (FLOOR_HEIGHT - 1.2) / 2, 0);
        plane.rotation.z = side * -Math.atan2(FLOOR_HEIGHT - 1.2, f.w / 2);
        g.add(plane);
      }
    }

    // zone markers (hidden until edit mode)
    for (const room of floor.rooms) {
      for (const zone of room.zones) {
        const color = ZONE_COLORS[zone.kind] || '#59f2ff';
        const rad = zone.kind === 'main' ? 0.48 : zone.kind === 'side' ? 0.4 : 0.32;
        const marker = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.065, 4, 8), glowMat(color, 0.9));
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(rad * 0.82, 8),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
        );
        fill.userData.zoneId = zone.zoneId;
        marker.add(fill);
        const plusMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
        for (const rotation of [0, Math.PI / 2]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(rad * 0.62, 0.055, 0.035), plusMat);
          bar.rotation.z = rotation;
          bar.position.z = 0.018;
          bar.userData.zoneId = zone.zoneId;
          marker.add(bar);
        }
        marker.rotation.x = Math.PI / 2;
        const y = (zone.elevated || 0) + 0.08;
        marker.position.set(zone.anchor[0], y, zone.anchor[1]);
        if (zone.kind === 'walldecor') {
          marker.rotation.x = 0;
          marker.rotation.y = wallAngle(findWall(floor, zone.wallId));
          marker.position.y = 1.7;
        }
        marker.userData.zoneId = zone.zoneId;
        marker.visible = false;
        g.add(marker);
        this.zoneMarkers[zone.zoneId] = marker;
      }
    }
  }

  _buildWall(wall, g, fi, wallCol, sc, floor) {
    const H = FLOOR_HEIGHT;
    const dir = { x: (wall.x1 - wall.x0) / wall.length, z: (wall.z1 - wall.z0) / wall.length };
    const ghost = wall.side === 'front';
    const matWall = ghost
      ? this._mat(wallCol, fi, {
        surface: 'plaster', repeat: [2.2, 1.4], opacity: 0.13, depthWrite: false, side: THREE.DoubleSide,
      })
      : this._mat(wall.side === 'partition' ? shade(wallCol, -6) : wallCol, fi, { surface: 'plaster', repeat: [2.2, 1.4] });

    // task8 §22: two opaque solids that share an exact face plane z-fight. Wall
    // pieces around an opening therefore overlap their neighbours by a seam
    // instead of butting against them, and frame parts are embedded into the
    // wall rather than filling a reserved slot with matching faces. Both are
    // real geometry changes, not a polygonOffset or a depth hack.
    const SEAM = WALL_SEAM;

    // task8 §22: confirmed root cause of the doorway shimmer. The ghosted front
    // wall is transparent with depthWrite disabled, and it was built from boxes.
    // Around an opening those boxes meet, so at every seam two blended faces sit
    // on one plane and three.js re-sorts them by distance every frame — the sort
    // order flips as the camera orbits and the doorway edge crawls. Ghost walls
    // are now single-sided planes with a fixed render order: no end faces, no
    // per-frame sorting between neighbours, and no transparent frame stacked on
    // top. Opaque walls keep butt joints, whose faces point away from each other
    // and are back-face culled rather than fighting.
    let ghostOrder = 0;
    const seg = (a, b, y0, y1) => {
      // Side/partition walls butt against the inner face of the horizontal
      // walls. Overlapping their top faces caused bright crawling corners.
      if (wall.side === 'left' || wall.side === 'right' || wall.side === 'partition') {
        a = Math.max(a, WALL_T / 2);
        b = Math.min(b, wall.length - WALL_T / 2);
      }
      if (b - a < 0.03 || y1 - y0 < 0.03) return;
      const len = b - a;
      const m = new THREE.Mesh(
        ghost ? new THREE.PlaneGeometry(len, y1 - y0) : new THREE.BoxGeometry(len, y1 - y0, WALL_T),
        matWall,
      );
      const mid = a + len / 2;
      m.position.set(wall.x0 + dir.x * mid, (y0 + y1) / 2, wall.z0 + dir.z * mid);
      m.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      m.castShadow = !ghost;
      m.receiveShadow = !ghost;
      if (ghost) {
        m.renderOrder = 2 + (ghostOrder += 1);
        m.frustumCulled = true;
      }
      g.add(m);
      return m;
    };

    const wallH = floor.isAttic && (wall.side === 'left' || wall.side === 'right') ? 1.25 : H;
    const ops = [...wall.openings].sort((a, b) => a.offset - b.offset);
    // Above the tallest opening the wall is one continuous box across the whole
    // length. Cutting it into per-opening pieces is what made neighbouring
    // segments share a top plane and a vertical joint plane at once.
    const bandBottom = wallBandBottom(ops, wallH);
    const pierTop = bandBottom === null ? wallH : bandBottom;
    if (bandBottom !== null) seg(0, wall.length, bandBottom - SEAM, wallH);
    let cursor = 0;
    for (const op of ops) {
      // Reserve the frame's entire volume in the wall. A frame embedded in
      // a solid wall shares its reveal faces and flickers when orbiting.
      const trim = op.kind === 'window' ? 0 : 0.09;
      seg(cursor, op.offset - trim, 0, pierTop);
      if (op.kind === 'window') {
        // The pieces inside the opening reach a seam into the full-height
        // neighbours so no two wall boxes share an end plane.
        seg(op.offset - SEAM, op.offset + op.width + SEAM, 0, op.sill);               // under sill
        seg(op.offset - SEAM, op.offset + op.width + SEAM, op.sill + op.height, pierTop); // lintel
        // glass + frame
        const glass = new THREE.Mesh(
          new THREE.PlaneGeometry(op.width, op.height),
          this._mat('#bfe6f5', fi, {
            transparent: true, opacity: 0.48, depthWrite: false,
            roughness: 0.35, emissive: '#bfe6f5', emissiveIntensity: 0.08,
            side: THREE.DoubleSide,
          }),
        );
        const mid = op.offset + op.width / 2;
        glass.position.set(wall.x0 + dir.x * mid, op.sill + op.height / 2, wall.z0 + dir.z * mid);
        glass.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
        g.add(glass);
        // Thin frame bars leave an actual opening and read from either side
        // of the dollhouse; there is no opaque box behind the glass.
        const windowFrame = this._mat('#f7f1e3', fi, { surface: 'wood' });
        // The horizontal bars are shallower than the vertical ones, so their
        // faces are buried at the four corners instead of sharing a plane with
        // them — the same z-fight the doorway had, one scale smaller.
        for (const [offset, height, width, y, depth] of [
          [op.offset, op.height + 0.12, 0.08, op.sill + op.height / 2, WALL_T + 0.02],
          [op.offset + op.width, op.height + 0.12, 0.08, op.sill + op.height / 2, WALL_T + 0.02],
          [mid, 0.08, op.width + 0.12, op.sill, WALL_T + 0.008],
          [mid, 0.08, op.width + 0.12, op.sill + op.height, WALL_T + 0.008],
        ]) {
          const [x, z] = wallPoint(wall, offset, 0);
          const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), windowFrame);
          frame.position.set(x, y, z);
          frame.rotation.y = glass.rotation.y;
          g.add(frame);
        }
        // sill board (window-sill zone surface)
        const [sx, sz] = wallPoint(wall, mid, 0.3);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(op.width + 0.3, 0.09, 0.5), this._mat('#f7f1e3', fi, { surface: 'wood' }));
        sill.position.set(sx, op.sill + 0.02, sz);
        g.add(sill);
      } else {
        // Jambs are wider than the reserved slot so their outer faces sit
        // inside the wall solid, and tall enough to pass through the header
        // into the lintel. Nothing coplanar is left around the opening.
        const layout = interiorDoorFrameLayout({
          offset: op.offset, width: op.width, height: op.height,
          wallThickness: WALL_T, lintelTop: pierTop, trim,
        });
        if (layout.lintel) seg(layout.lintelSpan[0], layout.lintelSpan[1], layout.lintelBottom, pierTop);
        const frameMat = this._mat(shade(sc.accent, -18), fi, { surface: 'wood' });
        const frameAngle = Math.atan2(dir.x, dir.z) - Math.PI / 2;
        // A ghosted wall gets no solid frame: stacking another transparent,
        // depth-write-disabled shell around the opening is what produced the
        // unstable edge. The opening reads from the ghost plane itself.
        for (const part of ghost ? [] : [...layout.jambs, layout.header]) {
          const [px, pz] = wallPoint(wall, part.centre[0], 0);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.size), frameMat);
          mesh.name = part.name === 'header' ? 'Door header' : 'Door jamb';
          mesh.position.set(px, part.centre[1], pz);
          mesh.rotation.y = frameAngle;
          mesh.castShadow = !ghost;
          mesh.receiveShadow = true;
          g.add(mesh);
        }

        // The camera looks through the ghosted front wall, so its door leaf is
        // intentionally omitted. Interior doors remain visibly ajar.
        if (!ghost) {
          const leaf = new THREE.Mesh(
            new THREE.BoxGeometry(op.width - 0.1, op.height - 0.08, 0.07),
            this._mat(shade(sc.accent, -8), fi, { surface: 'wood' }),
          );
          const [lx, lz] = wallPoint(wall, op.offset + op.width * 0.32, 0.3);
          leaf.position.set(lx, (op.height - 0.08) / 2, lz);
          leaf.rotation.y = frameAngle + 0.6;
          g.add(leaf);
        }
      }
      cursor = op.offset + op.width + trim;
    }
    seg(cursor, wall.length, 0, pierTop);
  }

  _buildRoof(sc) {
    const floor = this.def.floors.at(-1);
    const fi = floor.floorIndex;
    const g = new THREE.Group();
    g.name = 'Interior roof — top floor only';
    g.position.y = floor.elevation + FLOOR_HEIGHT + SLAB / 2;
    const f = this.def.footprint;
    const roofMat = this._mat(sc.roof, fi, { surface: 'roof' });
    const soffitMat = this._mat(shade(sc.roof, -8), fi);
    const polygon = this.def.footprintPolygon;
    const type = this.def.roofType;
    const rise = this.def.roofHeight || 2;
    const heightAt = type === 'flat' ? () => 0.18
      : (x) => rise * (1 - Math.abs(x) / (f.w / 2));
    const faces = type === 'flat' ? [polygon]
      : [-1, 1].map((side) => clippedAtRidge(polygon, side));
    for (const face of faces) {
      if (face.length < 3) continue;
      const roof = new THREE.Mesh(roofSurfaceGeometry(face, heightAt), roofMat);
      roof.castShadow = true;
      roof.receiveShadow = true;
      g.add(roof, new THREE.Mesh(roofSurfaceGeometry(face, heightAt, true), soffitMat));
    }
    // Fascia follows the exact concave outline, including an L-shaped courtyard.
    // No rectangular roof panel spans the courtyard or overlaps another panel.
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const points = [a];
      if (a[0] * b[0] < 0 && type !== 'flat') {
        const t = -a[0] / (b[0] - a[0]);
        points.push([0, a[1] + t * (b[1] - a[1])]);
      }
      points.push(b);
      for (let j = 1; j < points.length; j++) {
        const p = points[j - 1], q = points[j];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          p[0], heightAt(p[0]), p[1], q[0], heightAt(q[0]), q[1],
          p[0], heightAt(p[0]) - 0.16, p[1], q[0], heightAt(q[0]) - 0.16, q[1],
        ], 3));
        geometry.setIndex([0, 1, 2, 1, 3, 2]);
        geometry.computeVertexNormals();
        g.add(new THREE.Mesh(geometry, soffitMat));
      }
    }
    this.scene.add(g);
    this.roofGroup = g;
  }

  // ── floors & view modes (task5 §7) ─────────────────────────────────────────
  setFloor(fi) {
    if (!this.def) return;
    this.cancelPlacement();
    this.selectObject(null);
    const requested = Number.isFinite(Number(fi)) ? Math.trunc(Number(fi)) : 0;
    this.activeFloor = Math.max(0, Math.min(this.def.floorCount - 1, requested));
    this._applyVisibility();
    const el = this.def.floors[this.activeFloor].elevation;
    const deltaY = el + 1.5 - this.controls.target.y;
    this.camera.position.y += deltaY;
    this.controls.target.set(0, el + 1.5, 0);
    this.controls.update();
    this._refreshMarkers();
    this.renderer.shadowMap.needsUpdate = true;
  }

  setViewMode(mode) {
    this.cancelPlacement();
    this.selectObject(null);
    this.viewMode = ['isolate', 'ghost', 'stacked', 'cutaway'].includes(mode) ? mode : 'ghost';
    if (this.viewMode === 'stacked') {
      const height = this.def.floors.at(-1).elevation + FLOOR_HEIGHT;
      this.controls.target.set(0, height / 2, 0);
      this.camera.position.set(0, height / 2 + 8, Math.max(17, height * 1.8));
    } else {
      const el = this.def.floors[this.activeFloor].elevation;
      this.controls.target.set(0, el + 1.5, 0);
      this.camera.position.set(0, el + 7.5, 13.5);
    }
    this.controls.update();
    this._applyVisibility();
    this._refreshMarkers();
    this.renderer.shadowMap.needsUpdate = true;
  }

  _applyVisibility() {
    if (this.roofGroup) this.roofGroup.visible = this.viewMode === 'stacked' && !this.editMode;
    for (const floor of this.def.floors) {
      const fi = floor.floorIndex;
      const g = this.floorGroups[fi];
      let visible = true, faded = false;
      if (this.viewMode === 'isolate') visible = fi === this.activeFloor;
      else if (this.viewMode === 'ghost') { visible = fi === this.activeFloor || fi === this.activeFloor - 1; faded = fi < this.activeFloor; }
      else if (this.viewMode === 'cutaway') visible = fi <= this.activeFloor;
      // 'stacked': everything visible, editing disabled by main.js
      g.visible = visible;
      for (const person of this.familyActors || []) {
        if (person.userData.floorIndex === fi) person.visible = visible && !faded && !this.editMode;
      }
      g.traverse((node) => {
        if (node.isLight && node.userData.baseIntensity !== undefined) node.intensity = faded ? 0 : node.userData.baseIntensity;
      });
      for (const m of this.floorMats[fi] || []) {
        if (m.userData?.ghostBase === undefined) {
          m.userData = {
            ...m.userData,
            ghostBase: m.opacity,
            ghostTransparent: m.transparent,
            ghostDepthWrite: m.depthWrite,
          };
        }
        m.opacity = faded ? Math.min(0.22, m.userData.ghostBase) : m.userData.ghostBase;
        m.transparent = faded ? true : m.userData.ghostTransparent;
        m.depthWrite = faded ? false : m.userData.ghostDepthWrite;
        m.needsUpdate = true;
      }
      // objects on faded floors are hidden to keep the read clear
      for (const obj of this.objects) {
        const mesh = this.objectMeshes[obj.oid];
        if (mesh && this._floorIndexOf(obj) === fi) mesh.visible = visible && !faded;
      }
    }
  }

  _floorIndexOf(obj) {
    return this.def.floors.findIndex((f) => f.floorId === obj.floorId);
  }

  floorStats(fi) {
    const floor = this.def.floors[fi];
    const objs = this.objects.filter((o) => o.floorId === floor.floorId);
    const messages = [];
    for (const o of objs) {
      const result = validatePlacement(this.def, this.objects, o);
      if (!result.ok) messages.push(result.reason);
    }
    for (const error of validateHouseDefinition(this.def)) {
      if (!error.floorId || error.floorId === floor.floorId) messages.push(error.reason);
    }
    return { objects: objs.length, errors: messages.length, messages, complete: messages.length === 0 };
  }

  // ── edit mode & markers ────────────────────────────────────────────────────
  setEditMode(on) {
    this.editMode = on;
    if (!on) {
      this.cancelPlacement();
      this.selectObject(null);
      this._buildFamilyActors();
    }
    this._applyVisibility();
    this._refreshMarkers();
    this.renderer.shadowMap.needsUpdate = true;
  }

  _refreshMarkers() {
    for (const [zoneId, marker] of Object.entries(this.zoneMarkers)) {
      const zone = findZone(this.def, zoneId);
      if (!zone) { marker.visible = false; continue; }
      const fi = this.def.floors.findIndex((f) => f.floorId === zone.floorId);
      const used = this.objects.filter((o) => (o.slotId || o.zoneId) === (zone.slotId || zoneId)).length;
      const candidate = used < zone.max ? this.availablePlacement(zoneId) : null;
      marker.visible = this.editMode && fi === this.activeFloor &&
        this.viewMode !== 'stacked' && !!candidate;
      if (!candidate) continue;

      // The ring is the promise of a real placement. Move it to the next
      // approved position that the validator can actually use, instead of a
      // generic zone anchor that may sit on a window or blocked doorway.
      marker.position.set(
        candidate.pos[0],
        candidate.localPosition?.[1] ?? (candidate.elevated || 0) + (zone.kind === 'walldecor' ? 0 : 0.08),
        candidate.pos[1],
      );
    }
  }

  setItemEligibility(predicate) {
    this.itemEligibility = typeof predicate === 'function' ? predicate : () => true;
    this._refreshMarkers();
  }

  availablePlacement(zoneId, itemId = null) {
    const zone = typeof zoneId === 'string' ? findZone(this.def, zoneId) : zoneId;
    if (!zone) return null;
    const items = itemId
      ? ITEMS.filter((item) => item.id === itemId && this.itemEligibility(item))
      : ITEMS.filter((item) =>
        this.itemEligibility(item) && item.slots.some((slot) => zone.types.includes(slot)));
    for (const item of items) {
      const candidate = bestPlacement(this.def, this.objects, item.id, zone);
      if (candidate) return candidate;
    }
    return null;
  }

  canPlace(zoneId, itemId) {
    return !!this.availablePlacement(zoneId, itemId);
  }

  beginPlacement(zoneId) {
    this.cancelPlacement();
    const zone = findZone(this.def, zoneId);
    if (!zone) return { ok: false, reason: 'This placement socket no longer exists.' };
    if (this.viewMode === 'stacked' || zone.floorId !== this.def.floors[this.activeFloor]?.floorId) {
      return { ok: false, reason: 'Select this floor before placing furniture.' };
    }
    if (!this.availablePlacement(zone)) {
      return { ok: false, reason: 'This placement socket has no available items.' };
    }
    this.selectObject(null);
    this.placementState = { phase: 'catalog', zoneId, itemId: null };
    return { ok: true, zone };
  }

  cancelPlacement() {
    if (this.pendingPreview) this._despawnObject(this.pendingPreview.oid);
    this.pendingPreview = null;
    this.placementState = { phase: 'idle', zoneId: null, itemId: null };
    return true;
  }

  // ── object CRUD (all changes go through commands for undo/redo, §16) ───────
  _snapshot() {
    this.undoStack.push(JSON.stringify(this.objects));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.objects));
    this._restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.objects));
    this._restore(this.redoStack.pop());
    return true;
  }

  _restore(json) {
    this.cancelPlacement();
    for (const oid of Object.keys(this.objectMeshes)) this._despawnObject(oid);
    this.objects = JSON.parse(json).map((obj, index) => normalizeObjectInstance(this.def, obj, index));
    this.objectSeq = Math.max(this.objectSeq || 0, this.objects.length);
    for (const obj of this.objects) this._spawnObject(obj, false);
    this.selectObject(null);
    this._refreshMarkers();
    this._applyVisibility();
  }

  /** Deterministic auto-place into a zone. Returns {ok, obj?|reason}. */
  placeAuto(zoneId, itemId) {
    const zone = findZone(this.def, zoneId);
    if (!zone) return { ok: false, reason: 'Zone not found.' };
    if (zone.floorId !== this.def.floors[this.activeFloor]?.floorId || this.viewMode === 'stacked') return { ok: false, reason: 'Select this floor before placing furniture.' };
    const cand = bestPlacement(this.def, this.objects, itemId, zone);
    if (!cand) {
      // surface the specific reason from the anchor spot
      const probe = { ...zoneBaseCand(zone, itemId), pos: [...zone.anchor] };
      const v = validatePlacement(this.def, this.objects, probe);
      return { ok: false, reason: v.reason || 'No free valid spot in this zone.' };
    }
    this._snapshot();
    cand.oid = `${this.def.houseId}_obj_${String(++this.objectSeq).padStart(3, '0')}`;
    cand.objectInstanceId = cand.oid;
    cand.revision = this.baseRevision;
    Object.assign(cand, normalizeObjectInstance(this.def, cand, this.objects.length));
    this.objects.push(cand);
    this._spawnObject(cand, true);
    this._refreshMarkers();
    return { ok: true, obj: cand };
  }

  /**
   * Show an item in one of the authored spots without changing inventory,
   * history or the saved interior. The caller must explicitly confirm it.
   */
  previewPlacement(zoneId, itemId) {
    if (this.pendingPreview) this._despawnObject(this.pendingPreview.oid);
    this.pendingPreview = null;
    const zone = findZone(this.def, zoneId);
    if (!zone) return { ok: false, reason: 'Placement spot not found.' };
    if (zone.floorId !== this.def.floors[this.activeFloor]?.floorId || this.viewMode === 'stacked') return { ok: false, reason: 'Select this floor before placing furniture.' };
    if (this.placementState.phase !== 'catalog' || this.placementState.zoneId !== zoneId) {
      return { ok: false, reason: 'Select the visible placement socket again.' };
    }
    const cand = bestPlacement(this.def, this.objects, itemId, zone);
    if (!cand) {
      const probe = { ...zoneBaseCand(zone, itemId), pos: [...zone.anchor] };
      const v = validatePlacement(this.def, this.objects, probe);
      return { ok: false, reason: v.reason || 'All approved spots in this area are occupied.' };
    }
    cand.oid = `${this.def.houseId}_placement_preview`;
    cand.objectInstanceId = cand.oid;
    cand.state = 'preview';
    this.pendingPreview = normalizeObjectInstance(this.def, cand, this.objects.length);
    this.placementState = { phase: 'preview', zoneId, itemId };
    // Preview and confirmed placement share the final transform, including
    // model scale. No spring animation hides the true footprint or clearances.
    this._spawnObject(this.pendingPreview, false);
    const mesh = this.objectMeshes[this.pendingPreview.oid];
    mesh?.traverse((child) => {
      if (!child.material) return;
      child.userData.previewOriginalMaterial = child.material;
      const materials = (Array.isArray(child.material) ? child.material : [child.material]).map((source) => {
        const material = source.clone();
        material.userData = { ...material.userData, sharedMaterial: false, previewOwned: true };
        // A solid, lightly tinted preview lets the player assess its actual
        // appearance without transparent-object sorting glitches.
        material.emissive?.set('#64e6bd');
        material.emissiveIntensity = 0.12;
        return material;
      });
      child.material = Array.isArray(child.material) ? materials : materials[0];
    });
    return { ok: true, obj: this.pendingPreview, zone };
  }

  confirmPreview() {
    if (!this.pendingPreview) return { ok: false, reason: 'Choose an item first.' };
    const preview = JSON.parse(JSON.stringify(this.pendingPreview));
    if (preview.floorId !== this.def.floors[this.activeFloor]?.floorId) {
      this.cancelPlacement();
      return { ok: false, reason: 'The active floor changed. Select the placement slot again.' };
    }
    const valid = validatePlacement(this.def, this.objects, preview);
    if (!valid.ok) {
      this.cancelPreview();
      return valid;
    }
    this._snapshot();
    this._despawnObject(preview.oid);
    preview.oid = `${this.def.houseId}_obj_${String(++this.objectSeq).padStart(3, '0')}`;
    preview.objectInstanceId = preview.oid;
    preview.state = 'placed';
    preview.revision = this.baseRevision;
    const obj = normalizeObjectInstance(this.def, preview, this.objects.length);
    this.objects.push(obj);
    this.pendingPreview = null;
    this.placementState = { phase: 'idle', zoneId: null, itemId: null };
    this._spawnObject(obj, false);
    this._refreshMarkers();
    return { ok: true, obj };
  }

  cancelPreview() {
    return this.cancelPlacement();
  }

  removeObject(oid) {
    const idx = this.objects.findIndex((o) => o.oid === oid);
    if (idx < 0) return null;
    this._snapshot();
    const [obj] = this.objects.splice(idx, 1);
    this._despawnObject(oid);
    this.selectObject(null);
    this._refreshMarkers();
    return obj;
  }

  rotateObject(oid) {
    const obj = this.objects.find((o) => o.oid === oid);
    if (!obj || obj.wallId) return { ok: false, reason: 'Wall items align to their wall.' };
    if (obj.floorId !== this.def.floors[this.activeFloor]?.floorId) return { ok: false, reason: 'Select this floor first.' };
    const zone = findZone(this.def, obj.zoneId || obj.slotId);
    const definition = itemDefinitionFor(obj.itemId);
    const rotations = zone?.allowedRotations || definition?.allowedRotations || [0];
    let next = null;
    let reason = 'This authored slot has a fixed orientation.';
    const current = ((obj.rot || 0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const ordered = rotations.map((degrees) => ((degrees * Math.PI / 180) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2))
      .filter((rotation) => Math.abs(rotation - current) > 0.001)
      .sort((a, b) => ((a - current + Math.PI * 2) % (Math.PI * 2)) - ((b - current + Math.PI * 2) % (Math.PI * 2)));
    for (const rotation of ordered) {
      const candidate = { ...obj, rot: rotation, localRotation: [0, rotation, 0] };
      const valid = validatePlacement(this.def, this.objects, candidate);
      if (valid.ok) { next = candidate; break; }
      reason = valid.reason;
    }
    if (!next) return { ok: false, reason };
    this._snapshot();
    obj.rot = next.rot;
    obj.localRotation = [0, next.rot, 0];
    obj.revision = (obj.revision || 0) + 1;
    this._syncMesh(obj);
    return { ok: true };
  }

  /** Reset to the deterministic suggested position in its zone. */
  resetObject(oid) {
    const obj = this.objects.find((o) => o.oid === oid);
    if (!obj) return { ok: false };
    const zone = findZone(this.def, obj.zoneId);
    const others = this.objects.filter((o) => o.oid !== oid);
    const cand = bestPlacement(this.def, others, obj.itemId, zone);
    if (!cand) return { ok: false, reason: 'No suggested spot is free.' };
    this._snapshot();
    Object.assign(obj, { pos: cand.pos, rot: cand.rot, offset: cand.offset });
    obj.localPosition = [cand.pos[0], obj.elevated || 0, cand.pos[1]];
    obj.localRotation = [0, cand.rot, 0];
    obj.revision = (obj.revision || 0) + 1;
    this._syncMesh(obj);
    return { ok: true };
  }

  // ── commit / cancel (atomic save, §17) ─────────────────────────────────────
  /** Validate everything; only a fully valid revision may be saved. */
  validateAll() {
    const errors = [];
    errors.push(...validateHouseDefinition(this.def));
    for (const o of this.objects) {
      const v = validatePlacement(this.def, this.objects, o);
      if (!v.ok) errors.push({ oid: o.oid, reason: v.reason });
    }
    return errors;
  }

  commit() {
    if (!this.dirtyState) return { ok: true, unchanged: true, objects: structuredClone(this.committed) };
    const errors = this.validateAll();
    if (errors.length) return { ok: false, errors };
    const objects = JSON.parse(JSON.stringify(
      this.objects.map((obj, index) => normalizeObjectInstance(this.def, obj, index)),
    ));
    // Preparing a request is not an acknowledgement. Failed saves must stay
    // dirty so retry cannot silently discard the user's working draft.
    return { ok: true, unchanged: false, objects };
  }

  acceptCommit(placements) {
    this.committed = structuredClone((placements.objects || [])
      .map((obj, index) => normalizeObjectInstance(this.def, obj, index)));
    this.baseRevision = placements.revision || 0;
    this.initialInteriorRevision = this.baseRevision;
    this.initialInteriorSnapshotHash = interiorSnapshotHash(this.committed);
  }

  cancelEdits() {
    this._restore(JSON.stringify(this.committed));
    this.undoStack = []; this.redoStack = [];
  }

  /**
   * Semantic snapshot of what the player can actually change (task8 §21.2).
   *
   * Key order, derived geometry caches and normalization defaults are excluded:
   * comparing raw JSON marked an untouched interior dirty whenever the saved
   * document and the normalized working copy serialized their fields in a
   * different order, which is what produced an error on an unchanged exit.
   */
  get currentInteriorSnapshotHash() {
    return interiorSnapshotHash(this.objects);
  }

  /** True only after a real semantic edit: place, remove, move, rotate, replace. */
  get dirtyState() {
    return this.currentInteriorSnapshotHash !== interiorSnapshotHash(this.committed);
  }

  /** Kept for older callers; identical to `dirtyState`. */
  get dirty() {
    return this.dirtyState;
  }

  // ── selection & meshes ─────────────────────────────────────────────────────
  selectObject(oid) {
    if (this.selectedOid && this.objectMeshes[this.selectedOid]) {
      this._setHighlight(this.objectMeshes[this.selectedOid], null);
    }
    this.selectedOid = oid;
    if (oid && this.objectMeshes[oid]) this._setHighlight(this.objectMeshes[oid], 0xffd166);
  }

  _setHighlight(mesh, color) {
    mesh.traverse((c) => {
      if (!c.material) return;
      if (color) {
        if (!c.userData.highlightOriginalMaterial) {
          c.userData.highlightOriginalMaterial = c.material;
          const materials = (Array.isArray(c.material) ? c.material : [c.material]).map((source) => {
            const material = source.clone();
            material.userData = { ...material.userData, sharedMaterial: false };
            return material;
          });
          c.material = Array.isArray(c.material) ? materials : materials[0];
        }
        for (const material of Array.isArray(c.material) ? c.material : [c.material]) {
          material.emissive?.setHex(color);
          material.emissiveIntensity = 0.35;
        }
      } else if (c.userData.highlightOriginalMaterial) {
        for (const material of Array.isArray(c.material) ? c.material : [c.material]) material.dispose();
        c.material = c.userData.highlightOriginalMaterial;
        delete c.userData.highlightOriginalMaterial;
      }
    });
  }

  _spawnObject(obj, animate) {
    const mesh = buildItem(obj.itemId);
    if (!mesh) return;
    mesh.userData.oid = obj.oid;
    const fi = this._floorIndexOf(obj);
    mesh.userData.alive = true;
    this.floorGroups[fi]?.add(mesh);
    this.objectMeshes[obj.oid] = mesh;
    // _syncMesh resolves the mesh through objectMeshes. Register it first so
    // every preview and confirmed item actually moves to its authored socket.
    this._syncMesh(obj);
    mesh.traverse((c) => {
      if (c.userData.blink && c.material) {
        c.material = c.material.clone();
        c.material.userData = { ...c.material.userData, sharedMaterial: false };
      }
      if (c.userData.spin || c.userData.blink) this.animItems.push(c);
    });
    if (animate) {
      const s = mesh.scale.clone();
      mesh.scale.setScalar(0.01);
      const start = performance.now();
      const grow = () => {
        if (!mesh.userData.alive) return;
        const k = Math.min(1, (performance.now() - start) / 380);
        const e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
        mesh.scale.copy(s).multiplyScalar(Math.max(0.01, e));
        if (k < 1) requestAnimationFrame(grow);
        else mesh.scale.copy(s);
      };
      grow();
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  _syncMesh(obj, tint = null) {
    const mesh = this.objectMeshes[obj.oid] || null;
    if (!mesh) return;
    const pos = obj.localPosition || [obj.pos[0], obj.elevated || 0, obj.pos[1]];
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(...(obj.localRotation || [0, obj.rot || 0, 0]));
    if (tint !== null) this._setHighlight(mesh, tint);
    else if (obj.oid !== this.selectedOid) this._setHighlight(mesh, null);
    this.renderer.shadowMap.needsUpdate = true;
  }

  _despawnObject(oid) {
    const mesh = this.objectMeshes[oid];
    if (!mesh) return;
    mesh.userData.alive = false;
    const animated = new Set();
    mesh.traverse((child) => animated.add(child));
    this.animItems = this.animItems.filter((child) => !animated.has(child));
    this._disposeGroup(mesh);
    mesh.parent?.remove(mesh);
    delete this.objectMeshes[oid];
    this.renderer.shadowMap.needsUpdate = true;
  }

  _disposeGroup(group) {
    const geometries = new Set(), materials = new Set();
    group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      for (const source of [child.material, child.userData.highlightOriginalMaterial, child.userData.previewOriginalMaterial]) {
        for (const material of Array.isArray(source) ? source : [source]) {
          if (material && !material.userData?.sharedMaterial) materials.add(material);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  clear() {
    for (const oid of Object.keys(this.objectMeshes)) this._despawnObject(oid);
    this._disposeGroup(this.scene);
    this.scene.traverse((child) => child.shadow?.dispose?.());
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
    this.floorGroups = [];
    this.floorMats = [];
    this.floorMaterialCache = new Map();
    this.zoneMarkers = {};
    this.objectMeshes = {};
    this.animItems = [];
    this.pendingPreview = null;
    this.roofGroup = null;
    this.placementState = { phase: 'idle', zoneId: null, itemId: null };
    this.familyActors = [];
  }

  update(dt) {
    this.t += dt;
    for (const [i, person] of (this.familyActors || []).entries()) person.scale.y = 1 + Math.sin(this.t * 1.2 + i) * 0.012;
    this.shadowRefresh += dt;
    if (this.shadowRefresh >= 1 / VISUAL_QUALITY.shadowUpdateHz) {
      this.shadowRefresh %= 1 / VISUAL_QUALITY.shadowUpdateHz;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.controls.update();
    for (const m of Object.values(this.zoneMarkers)) {
      if (m.visible) {
        const k = 1 + Math.sin(this.t * 3) * 0.08;
        m.scale.set(k, k, k);
      }
    }
    for (const c of this.animItems) {
      if (c.userData.spin) c.rotation.y += dt * 1.2;
      if (c.userData.blink && c.material) c.material.emissiveIntensity = 0.5 + Math.sin(this.t * 5 + (c.userData.phase || 0)) * 0.4;
    }
  }
}

function zoneBaseCand(zone, itemId) {
  return {
    oid: null, itemId, slotType: zone.types[0],
    floorId: zone.floorId, roomId: zone.roomId, zoneId: zone.zoneId,
    pos: [...zone.anchor], rot: 0, offset: (zone.interval ? (zone.interval[0] + zone.interval[1]) / 2 : 0),
    wallId: zone.wallId || null, elevated: zone.elevated || 0,
  };
}
