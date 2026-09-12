// Parametric house model (task5).
// A house is structured data: floors → rooms → walls → openings → zones →
// objects. Everything is generated deterministically from the builder config,
// so the same saved house reconstructs identically on every client (§18).
// No random placement anywhere in this module.

import { CLEARANCES, SLOT_FOOTPRINT, ITEMS, HOUSE_LAYOUTS, floorCountFor, residentsFor } from './config.js';

// v3 replaces broad multi-position "zones" with authored one-object sockets.
// A socket is a promise that an eligible item can be previewed and placed at
// exactly the position represented by its marker.
export const SCHEMA_VERSION = 4;
export const FLOOR_HEIGHT = 3.0;
export const SLAB = 0.25;
export const WALL_T = 0.3;

// ── deterministic generation ─────────────────────────────────────────────────

const FOOTPRINTS = {
  compact: { w: 10, d: 8 },
  wide: { w: 13, d: 8 },
  lshape: { w: 12, d: 9, notch: { x0: 0, z0: 1.0, x1: 6, z1: 4.5 } }, // front-right courtyard
};

/** Rooms per foundation: two rects per floor whose union is the footprint
 *  (minus the L-notch). Partition edge between them becomes an interior wall. */
function roomRects(foundation, floorIndex, layoutId = 'balanced') {
  const f = FOOTPRINTS[foundation] || FOOTPRINTS.compact;
  const hw = f.w / 2, hd = f.d / 2;
  if (foundation === 'lshape') {
    return [
      { rect: { x0: -hw, z0: -hd, x1: 0, z1: hd }, split: 'x' },
      { rect: { x0: 0, z0: -hd, x1: hw, z1: 1.0 }, split: 'x' },
    ];
  }
  const layout = HOUSE_LAYOUTS.find((x) => x.id === layoutId) || HOUSE_LAYOUTS[0];
  // The split is derived only from saved parameters. No camera, frame timing
  // or runtime ordering participates in the floor plan.
  const px = -hw + f.w * layout.splitRatio;
  return [
    { rect: { x0: -hw, z0: -hd, x1: px, z1: hd } },
    { rect: { x0: px, z0: -hd, x1: hw, z1: hd } },
  ];
}

const ROOM_NAMES = {
  living: 'Living Room', kitchen: 'Kitchen', bedroom: 'Bedroom', office: 'Office',
  bathroom: 'Bathroom', hallway: 'Hallway', utility: 'Utility Room', unassigned: 'Unassigned',
};

const PLACEMENT_TYPE = {
  'floor-large': 'Floor',
  'floor-med': 'Floor',
  'floor-small': 'Floor',
  'floor-tall': 'Floor',
  bed: 'Floor', seating: 'Floor', storage: 'Floor', ceiling: 'Ceiling', 'wall-shelf': 'Wall',
  wall: 'Wall',
  surface: 'Shelf',
  window: 'WindowSill',
  door: 'Floor',
  yard: 'ExteriorGround',
};

const ALL_ROOM_TYPES = [
  'living', 'kitchen', 'bedroom', 'bathroom',
  'office', 'hallway', 'utility', 'unassigned',
];

const SLOT_STANDARD = {
  'floor-large': 'FloorLarge', 'floor-med': 'FloorMedium', 'floor-small': 'FloorSmall',
  'floor-tall': 'Storage', wall: 'WallDecoration', 'wall-shelf': 'WallShelf',
  surface: 'Tabletop', window: 'FloorMedium', bed: 'Bed', seating: 'Seating',
  storage: 'Storage', ceiling: 'CeilingLight', yard: 'ExteriorGround', door: 'FloorSmall',
};

// Measured model envelopes. buildItem repivots and normalizes the visible mesh
// to this same authoring contract, so validation never guesses from slot size.
const ITEM_PROFILES = {
  'floor-large': [2.25, 1.3, 1.2, 'large-furniture'],
  'floor-med': [1.25, 0.85, 1.2, 'medium-furniture'],
  'floor-small': [0.62, 0.62, 1.55, 'small-furniture'],
  'floor-tall': [0.8, 0.7, 2.05, 'storage'],
  wall: [1.1, 0.12, 0.9, 'wall-decoration'],
  'wall-shelf': [1.1, 0.38, 0.35, 'wall-shelf'],
  surface: [0.5, 0.32, 0.5, 'tabletop'],
  bed: [1.65, 2.15, 0.95, 'bed'], seating: [0.6, 0.6, 1.0, 'seating'],
  storage: [0.8, 0.7, 2.0, 'storage'], ceiling: [0.65, 0.65, 0.55, 'ceiling-light'],
  yard: [1.4, 1.4, 1.8, 'yard'],
};
const ITEM_MEASUREMENTS = {
  rug: [2.25, 1.3, 0.045, 'rug'], rug_trap: [2.25, 1.3, 0.08, 'rug'],
  sofa: [2.25, 1.0, 1.2, 'seating'], table: [1.25, 0.85, 0.65, 'table'],
  family_bunk: [1.25, 2.15, 2.15, 'bed'], bed_double: [1.65, 2.15, 0.95, 'bed'],
  lamp_floor: [0.62, 0.62, 1.8, 'small-furniture'], plant: [0.62, 0.62, 1.25, 'small-furniture'],
  safe: [0.62, 0.62, 0.8, 'small-furniture'], grass_mat: [0.62, 0.62, 0.05, 'small-furniture'],
  trench_mat: [0.62, 0.62, 0.05, 'small-furniture'], paper_bin: [0.55, 0.55, 0.75, 'small-furniture'],
  kitchen_counter: [1.25, 0.7, 0.9, 'kitchen'], fridge: [0.75, 0.7, 1.8, 'storage'],
};

function boundsFor(slotType) {
  const [width, depth] = SLOT_FOOTPRINT[slotType] || [0.6, 0.6];
  const height = slotType === 'wall' ? 0.9 : slotType === 'floor-tall' ? 2.1 : 1.0;
  return {
    size: [width, height, depth],
    center: [0, height / 2, 0],
  };
}

/**
 * Approved, normalized item metadata used by placement and validation. The
 * existing catalog remains the content-authoring source while this registry
 * supplies the complete task5 ItemDefinition contract.
 */
export const ITEM_DEFINITIONS = Object.freeze(Object.fromEntries(ITEMS.map((item) => {
  const primary = item.slots[0];
  const [width, depth, height, category] = ITEM_MEASUREMENTS[item.id] || ITEM_PROFILES[primary] || ITEM_PROFILES['floor-small'];
  const wallItem = primary === 'wall' || primary === 'wall-shelf';
  const pivotType = wallItem ? 'rear-attachment' : primary === 'ceiling' ? 'top-center' : 'bottom-center';
  const collisionBounds = {
    size: [width, height, depth],
    center: wallItem ? [0, 0, depth / 2] : primary === 'ceiling' ? [0, -height / 2, 0] : [0, height / 2, 0],
  };
  const clearance = primary.startsWith('floor') ? CLEARANCES.furniture : CLEARANCES.wallDecorFromOpening;
  return [item.id, Object.freeze({
    itemDefinitionId: item.id,
    itemId: item.id,
    displayName: item.name,
    category,
    supportedSlotTypes: [...new Set(item.slots.map((s) => SLOT_STANDARD[s]))],
    width, depth, height, pivotType,
    modelId: `procedural:${item.id}:v4`,
    sleepingCapacity: primary === 'bed' ? 2 : 0,
    seatingCapacity: item.id === 'sofa' ? 2 : primary === 'seating' ? 1 : 0,
    allowedRoomTypes: [...ALL_ROOM_TYPES],
    placementTypes: [...new Set(item.slots.map((s) => PLACEMENT_TYPE[s] || 'Floor'))],
    footprintSize: [width, depth],
    visualBounds: collisionBounds,
    collisionBounds,
    clearanceBounds: {
      size: [
        collisionBounds.size[0] + clearance * 2,
        collisionBounds.size[1],
        collisionBounds.size[2] + clearance * 2,
      ],
      center: [...collisionBounds.center],
    },
    interactionBounds: {
      size: [Math.max(0.6, collisionBounds.size[0]), 1.8, 0.6],
      center: [0, 0.9, collisionBounds.size[2] / 2 + 0.3],
    },
    allowedRotations: [0, 90, 180, 270],
    wallClearance: CLEARANCES.furniture,
    doorClearance: CLEARANCES.door,
    windowClearance: CLEARANCES.wallDecorFromOpening,
    stairClearance: CLEARANCES.stair,
    requiresParentSocket: item.slots.some((s) => s === 'surface' || s === 'window'),
    providedSocketTypes: item.id === 'table' ? ['Tabletop'] : [],
    interactionType: 'resident-use',
    navigationEffect: primary.startsWith('floor') ? 'obstacle' : 'none',
    assetReference: `procedural:${item.id}`,
    lodReferences: [`procedural:${item.id}:low`],
    version: 4,
    source: item,
  })];
})));

export function itemDefinitionFor(itemId) {
  return ITEM_DEFINITIONS[itemId] || null;
}

function footprintPolygon(f) {
  const hw = f.w / 2, hd = f.d / 2;
  if (!f.notch) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return [
    [-hw, -hd], [hw, -hd], [hw, f.notch.z0],
    [f.notch.x0, f.notch.z0], [f.notch.x0, hd], [-hw, hd],
  ];
}

/** Build the full HouseDefinition for a builder config. Pure & deterministic. */
export function buildHouseDefinition(cfg) {
  const f = FOOTPRINTS[cfg.foundation] || FOOTPRINTS.compact;
  const floorCount = floorCountFor(cfg);
  const layoutId = HOUSE_LAYOUTS.some((x) => x.id === cfg.layout) ? cfg.layout : 'balanced';
  const roomTypes = [['living', 'kitchen'], ['bedroom', 'office']];
  const footprintPoly = footprintPolygon(f);
  const floors = [];

  for (let fi = 0; fi < floorCount; fi++) {
    const floorId = `${cfg.id}_f${fi}`;
    const rects = roomRects(cfg.foundation, fi, layoutId);
    const rooms = rects.map((r, ri) => ({
      roomId: `${floorId}_r${ri}`,
      floorId,
      roomType: roomTypes[Math.min(fi, 1)][ri],
      type: roomTypes[Math.min(fi, 1)][ri],
      name: ROOM_NAMES[roomTypes[Math.min(fi, 1)][ri]],
      roomPolygon: [
        [r.rect.x0, r.rect.z0], [r.rect.x1, r.rect.z0],
        [r.rect.x1, r.rect.z1], [r.rect.x0, r.rect.z1],
      ],
      rect: r.rect,
      ceilingHeight: FLOOR_HEIGHT,
      floorMaterialId: `${cfg.material || 'wood'}-floor`,
      wallMaterialId: cfg.material || 'wood',
      ceilingMaterialId: `${cfg.material || 'wood'}-ceiling`,
      wallSegmentIds: [],
      placementZoneIds: [],
      objectIds: [],
      zones: [],
    }));
    const walls = buildWalls(floorId, rooms, f, fi === 0 ? cfg : null, cfg);
    const floor = {
      floorId,
      houseId: cfg.id,
      floorIndex: fi,
      elevation: fi * (FLOOR_HEIGHT + SLAB),
      floorHeight: FLOOR_HEIGHT,
      height: FLOOR_HEIGHT,
      slabThickness: SLAB,
      ceilingThickness: 0.15,
      footprintPolygon: footprintPoly.map((p) => [...p]),
      roomIds: rooms.map((r) => r.roomId),
      stairOpeningId: null,
      visibilityState: 'visible',
      revision: Number.isInteger(cfg.revision) ? cfg.revision : 0,
      isAttic: false,
      layoutTemplate: fi === 0 ? 'shared-family-ground' : 'family-bedroom-upper',
      rooms,
      walls,
      stair: null,
    };
    floors.push(floor);
  }

  // Reserve the same stair footprint before a future extension. Existing
  // lower-floor slots therefore keep their IDs and transforms when floors grow.
  for (let fi = 0; fi < floorCount; fi++) {
    const lower = floors[fi];
    const room2 = lower.rooms[1];
    const sr = {
      x0: room2.rect.x1 - 1.2 - WALL_T, z0: room2.rect.z0 + 1.05,
      x1: room2.rect.x1 - WALL_T, z1: room2.rect.z0 + 1.05 + 2.6,
    };
    lower.stairReserved = sr;
    if (fi === floorCount - 1) continue;
    const stair = {
      stairId: `${cfg.id}_stair_${fi}`,
      lowerFloorId: lower.floorId,
      upperFloorId: floors[fi + 1].floorId,
      stairTypeId: 'straight',
      position: [(sr.x0 + sr.x1) / 2, 0, sr.z0],
      rotation: [0, 0, 0],
      risingDirection: 'positive-z',
      width: sr.x1 - sr.x0,
      runLength: sr.z1 - sr.z0,
      riseHeight: FLOOR_HEIGHT + SLAB,
      lowerClearance: CLEARANCES.stair,
      upperClearance: CLEARANCES.stair,
      openingPolygon: [
        [sr.x0, sr.z0], [sr.x1, sr.z0], [sr.x1, sr.z1], [sr.x0, sr.z1],
      ],
      rect: sr,
      entry: [(sr.x0 + sr.x1) / 2, sr.z0 - 0.5],  // lower approach point
      exit: [(sr.x0 + sr.x1) / 2, sr.z1 + 0.5],   // upper landing
    };
    lower.stair = stair;
    floors[fi + 1].stairOpening = sr;
    floors[fi + 1].stairOpeningId = `${stair.stairId}_opening`;
  }

  for (const floor of floors) {
    for (const room of floor.rooms) {
      room.wallSegmentIds = floor.walls
        .filter((w) => w.roomIds.includes(room.roomId))
        .map((w) => w.wallId);
      room.zones = buildZones(floor, room);
      room.placementZoneIds = room.zones.map((z) => z.zoneId);
    }
    floor.reservedSlots = buildReservedSlots(floor);
    floor.sleepingCapacity = floor.rooms.flatMap((room) => room.zones).reduce((sum, z) => sum + (z.sleepingCapacity || 0), 0);
    floor.seatingCapacity = floor.rooms.flatMap((room) => room.zones).reduce((sum, z) => sum + (z.seatingCapacity || 0), 0);
  }

  const createdAt = cfg.createdAt || cfg.builtAt || 0;
  return {
    houseId: cfg.id,
    ownerId: cfg.owner || cfg.ownerId || null,
    schemaVersion: SCHEMA_VERSION,
    templateId: `${cfg.foundation}-${layoutId}-family-v4`,
    footprintWidth: f.w,
    footprintDepth: f.d,
    footprintPolygon: footprintPoly,
    foundationType: cfg.foundation || 'compact',
    layoutId,
    activeFloorId: floors[0]?.floorId || null,
    exteriorMaterialId: cfg.material || 'wood',
    interiorMaterialSetId: cfg.material || 'wood',
    roofType: cfg.roof || 'gable',
    roofMaterialId: `${cfg.material || 'wood'}-roof`,
    roofHeight: cfg.roof === 'flat' ? 0.35 : 2.0,
    globalWallThickness: WALL_T,
    defaultFloorHeight: FLOOR_HEIGHT,
    footprint: f,
    wallThickness: WALL_T,
    floorHeight: FLOOR_HEIGHT,
    slab: SLAB,
    floorCount,
    residentCount: residentsFor(floorCount),
    entranceSide: 'front',
    worldPosition: [cfg.plot?.x || 0, 0, cfg.plot?.z || 0],
    worldRotation: [0, cfg.worldRotation || 0, 0],
    revision: Number.isInteger(cfg.revision) ? cfg.revision : 0,
    createdAt,
    updatedAt: cfg.updatedAt || createdAt,
    floors,
  };
}

/** Perimeter + partition walls with deterministic openings. */
function buildWalls(floorId, rooms, f, groundCfg, cfg) {
  const hw = f.w / 2, hd = f.d / 2;
  const walls = [];
  let wi = 0;
  const mkWall = (x0, z0, x1, z1, side, exterior, roomIds) => {
    const w = {
      wallId: `${floorId}_w${wi++}`,
      floorId,
      startPoint: [x0, 0, z0],
      endPoint: [x1, 0, z1],
      x0, z0, x1, z1, side, exterior, roomIds,
      height: FLOOR_HEIGHT,
      thickness: WALL_T,
      interiorMaterialId: cfg.material || 'wood',
      exteriorMaterialId: exterior ? (cfg.material || 'wood') : null,
      isExterior: exterior,
      openingIds: [],
      loadClass: exterior ? 'perimeter' : 'partition',
      length: Math.hypot(x1 - x0, z1 - z0),
      openings: [],
    };
    walls.push(w);
    return w;
  };

  const notch = f.notch;
  // perimeter (front wall is ghost-rendered in the editor but exists in data)
  mkWall(-hw, -hd, hw, -hd, 'back', true, rooms.map((r) => r.roomId));
  mkWall(-hw, -hd, -hw, hd, 'left', true, [rooms[0].roomId]);
  if (notch) {
    mkWall(hw, -hd, hw, notch.z0, 'right', true, [rooms[1].roomId]);
    mkWall(-hw, hd, notch.x0, hd, 'front', true, [rooms[0].roomId]);
    mkWall(notch.x0, notch.z0, hw, notch.z0, 'front', true, [rooms[1].roomId]); // notch-facing
  } else {
    mkWall(hw, -hd, hw, hd, 'right', true, [rooms[1].roomId]);
    mkWall(-hw, hd, hw, hd, 'front', true, rooms.map((r) => r.roomId));
  }
  // interior partition along the shared room edge
  const px = rooms[0].rect.x1;
  const pz1 = Math.min(rooms[0].rect.z1, rooms[1].rect.z1);
  const part = mkWall(px, -hd, px, pz1, 'partition', false, rooms.map((r) => r.roomId));

  // openings — all validated by validateOpening before being committed
  const kit = cfg.kit || 'cozy';
  const winW = kit === 'open' ? 1.8 : kit === 'tech' ? 1.0 : 1.3;
  const winH = kit === 'tech' ? 1.9 : 1.4;
  let oi = 0;
  const addOpening = (wall, kind, offset, width, height, sill) => {
    const id = `${wall.wallId}_o${oi++}`;
    const op = {
      id,
      kind,
      wallId: wall.wallId,
      offsetAlongWall: offset,
      offset,
      width,
      height,
      sillHeight: sill,
      sill,
      depth: wall.thickness,
      frameMaterialId: `${cfg.material || 'wood'}-trim`,
      ...(kind === 'window'
        ? {
            windowId: id,
            windowTypeId: cfg.kit || 'cozy',
            interiorTrimId: `${cfg.material || 'wood'}-trim`,
            exteriorTrimId: `${cfg.material || 'wood'}-trim`,
          }
        : {
            doorId: id,
            doorTypeId: cfg.kit || 'cozy',
            hingeSide: 'left',
            opensTowardRoomId: wall.roomIds[0] || null,
            swingAngle: 90,
          }),
    };
    if (validateOpening(wall, op).ok) {
      wall.openings.push(op);
      wall.openingIds.push(id);
    }
  };

  if (groundCfg) {
    // entrance door centered on the front wall of the living room
    const front = walls.find((w) => w.side === 'front');
    if (front) addOpening(front, 'door', (rooms[0].rect.x0 + rooms[0].rect.x1) / 2 - front.x0 - 0.55, 1.1, 2.2, 0);
    // interior door near the front end of the partition
    addOpening(part, 'door', part.length - 1.9, 1.0, 2.1, 0);
  } else {
    // upper floor: interior door in the partition
    addOpening(part, 'door', part.length - 1.9, 1.0, 2.1, 0);
  }
  // windows on back/left/right exterior walls: count from wall length + kit
  for (const w of walls) {
    if (!w.exterior || w.side === 'front') continue;
    const n = w.length >= 9 ? (kit === 'open' ? 3 : 2) : w.length >= 5 ? (kit === 'cozy' ? 1 : 2) : 1;
    for (let i = 0; i < n; i++) {
      const offset = ((i + 1) * w.length) / (n + 1) - winW / 2;
      addOpening(w, 'window', offset, winW, winH, 1.0);
    }
  }
  return walls;
}

/** Opening validation (task5 §11.2): margins, overlap, gaps, lintel space. */
export function validateOpening(wall, op) {
  const startMargin = 0.5, endMargin = 0.5, minGap = 0.4;
  if (op.offset < startMargin) return { ok: false, reason: 'This opening is too close to the wall corner.' };
  if (op.offset + op.width > wall.length - endMargin) return { ok: false, reason: 'This opening is too close to the wall corner.' };
  if (op.sill + op.height > FLOOR_HEIGHT - 0.3) return { ok: false, reason: 'There is no lintel space above this opening.' };
  for (const other of wall.openings) {
    if (other.id === op.id) continue;
    if (op.offset < other.offset + other.width + minGap && other.offset < op.offset + op.width + minGap) {
      return { ok: false, reason: 'Two openings cannot overlap on the same wall.' };
    }
  }
  return { ok: true };
}

/** Structural and cross-floor validation shared by save and editor UI. */
export function validateHouseDefinition(def) {
  const errors = [];
  if (!def || def.schemaVersion !== SCHEMA_VERSION) {
    errors.push({ code: 'schema', reason: 'The house schema version is not supported.' });
    return errors;
  }
  if (!Array.isArray(def.floors) || def.floors.length !== def.floorCount) {
    errors.push({ code: 'floors', reason: 'The saved floor count does not match the house structure.' });
    return errors;
  }
  const ids = new Set();
  const takeId = (id, label) => {
    if (!id) errors.push({ code: 'missing-id', reason: `${label} is missing a stable ID.` });
    else if (ids.has(id)) errors.push({ code: 'duplicate-id', reason: `${label} uses a duplicate ID.` });
    else ids.add(id);
  };
  takeId(def.houseId, 'House');
  for (const floor of def.floors) {
    takeId(floor.floorId, 'Floor');
    if (floor.floorIndex < 0 || floor.elevation < 0) {
      errors.push({ code: 'floor-transform', floorId: floor.floorId, reason: 'A floor has an invalid elevation.' });
    }
    for (const room of floor.rooms) {
      takeId(room.roomId, 'Room');
      if (!room.roomPolygon?.length) {
        errors.push({ code: 'room-polygon', roomId: room.roomId, reason: 'A room has no valid boundary.' });
      }
      for (const zone of room.zones) {
        takeId(zone.zoneId, 'Placement socket');
        if (zone.max !== 1 || zone.spots?.length !== 1) {
          errors.push({
            code: 'placement-socket', floorId: floor.floorId, roomId: room.roomId,
            reason: 'Every interior placement socket must contain exactly one authored spot.',
          });
        }
      }
    }
    for (const wall of floor.walls) {
      takeId(wall.wallId, 'Wall');
      if (wall.length <= 0 || wall.thickness <= 0 || wall.height <= 0) {
        errors.push({ code: 'wall-geometry', wallId: wall.wallId, reason: 'A wall has invalid dimensions.' });
      }
      for (const op of wall.openings) {
        takeId(op.id, op.kind === 'door' ? 'Door' : 'Window');
        const result = validateOpening(wall, op);
        if (!result.ok) errors.push({ code: 'opening', openingId: op.id, reason: result.reason });
      }
    }
    // Lightweight authoritative room graph: every room on a floor must be
    // reachable through a stored door portal. Templates are small, so a full
    // navmesh is unnecessary for this structural save check.
    if (floor.rooms.length > 1) {
      const adjacency = new Map(floor.rooms.map((room) => [room.roomId, new Set()]));
      for (const wall of floor.walls) {
        if (wall.roomIds.length < 2 || !wall.openings.some((opening) => opening.kind === 'door')) continue;
        for (const a of wall.roomIds) for (const b of wall.roomIds) {
          if (a !== b && adjacency.has(a) && adjacency.has(b)) adjacency.get(a).add(b);
        }
      }
      const start = floor.rooms[0].roomId;
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const current = queue.shift();
        for (const next of adjacency.get(current) || []) {
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      if (seen.size !== floor.rooms.length) {
        errors.push({
          code: 'navigation',
          floorId: floor.floorId,
          reason: 'Every room must remain reachable through a valid doorway.',
        });
      }
    }
  }
  if (def.floorCount < 1 || def.floorCount > 5) errors.push({ code: 'floor-limit', reason: 'A family house supports one to five floors.' });
  for (let index = 1; index < def.floorCount; index++) {
    const lower = def.floors[index - 1];
    const upper = def.floors[index];
    if (!lower.stair || lower.stair.upperFloorId !== upper.floorId || !upper.stairOpeningId) {
      errors.push({
        code: 'stairs',
        floorId: upper.floorId,
        reason: `Floor ${index + 1} is not connected to the floor below.`,
      });
    }
  }
  return errors;
}

// ── placement zones (task5 §8.3) ─────────────────────────────────────────────

function buildZones(floor, room) {
  const zones = [];
  const r = room.rect;
  const cx = round2((r.x0 + r.x1) / 2);
  const back = r.z0 + 1.65;
  const isFirstRoom = room === floor.rooms[0];
  const categoriesFor = (types) => [...new Set(Object.values(ITEM_DEFINITIONS)
    .filter((item) => item.source.slots.some((type) => types.includes(type)))
    .map((item) => item.category))];

  const socket = (key, name, type, types, x, z, width, depth, height, extra = {}) => {
    const zoneId = `${room.roomId}_slot_${key}`;
    const pos = [round2(x), round2(z)];
    const elevated = extra.elevated || 0;
    const rot = extra.rot || 0;
    const spot = { spotId: `${zoneId}_spot`, name, types: [...types], pos, rot, ...extra.spot };
    const rect = { x0: x - width / 2, z0: z - depth / 2, x1: x + width / 2, z1: z + depth / 2 };
    const zone = {
      zoneId, slotId: zoneId, floorId: floor.floorId, roomId: room.roomId,
      slotType: type, kind: types.includes('surface') ? 'surface' : extra.wallId ? 'walldecor' : 'main',
      name: `${room.name} · ${name}`,
      types: [...types], spots: [spot], anchor: pos, rect, max: 1, maximumObjectCount: 1,
      allowedItemCategories: categoriesFor(types), allowedItemTags: [...types],
      prohibitedItemTags: [], allowedRotations: [rot * 180 / Math.PI],
      position: [pos[0], elevated, pos[1]], rotation: [0, rot, 0],
      maximumWidth: width, maximumDepth: depth, maximumHeight: height,
      clearanceBounds: { size: [width + 0.24, height, depth + 0.24], center: [pos[0], elevated + height / 2, pos[1]] },
      interactionPoint: [pos[0], elevated, round2(pos[1] + depth / 2 + 0.32)],
      navigationClearance: 0.6, wallIdIfRequired: extra.wallId || null,
      parentSlotIdIfRequired: types.includes('surface') ? `${zoneId}_fixed_shelf` : null,
      occupancyState: 'empty', preferredWallId: extra.wallId || null,
      minimumSpacing: 0.12, prio: 3, priority: 3, elevated, ...extra,
    };
    delete zone.spot;
    zone.polygon = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]];
    zones.push(zone);
    return zone;
  };

  if (isFirstRoom) {
    // The four-person starter family has two two-person bunk beds in a sleeping
    // alcove; each later level adds one double bed for its two new residents.
    const bedXs = floor.floorIndex === 0 ? [cx - 0.8, cx + 0.8] : [cx];
    bedXs.forEach((x, index) => socket(`bed_${index}`, `Sleeping Area ${index + 1}`, 'Bed', ['bed'],
      x, back, floor.floorIndex === 0 ? 1.32 : 1.72, 2.2, 2.3,
      { sleepingCapacity: 2, defaultItemId: floor.floorIndex === 0 ? 'family_bunk' : 'bed_double' }));
    socket('sofa', 'Family Sofa', 'FloorLarge', ['floor-large'], cx, -0.05, 2.3, 1.3, 1.3,
      { seatingCapacity: 2, defaultItemId: 'sofa' });
    socket('table', 'Conversation Table', 'FloorMedium', ['floor-med'], cx, 1.6, 1.3, 0.9, 1.25);
    for (const [key, x] of [['left', r.x0 + 0.78], ['right', r.x1 - 0.78]]) {
      socket(`chair_${key}`, `Family Chair ${key}`, 'Seating', ['seating'], x, 1.6, 0.64, 0.64, 1.1,
        { seatingCapacity: 1, defaultItemId: 'chair' });
    }
    room.functionalAreas = ['living', 'sleeping', 'family-seating'];
  } else {
    // The right room keeps a permanent stair bay at the rear right and an
    // unobstructed arrival/departure strip. Furniture lives in its front half.
    const compactDepth = r.z1 - r.z0 < 6;
    const frontZ = compactDepth ? r.z1 - 2.55 : 1.4;
    const innerX = r.x0 + (compactDepth ? 2.0 : 1.0);
    socket('worktable', floor.floorIndex ? 'Study Table' : 'Dining Counter', 'FloorMedium', ['floor-med'],
      innerX, frontZ, 1.3, 0.9, 1.25);
    socket('storage', 'Family Storage', 'Storage', ['storage', 'floor-tall'],
      r.x0 + 0.75, r.z0 + 0.95, 0.86, 0.76, 2.2);
    socket('small', 'Reading Corner', 'FloorSmall', ['floor-small'],
      r.x1 - 0.72, compactDepth ? r.z1 - 0.7 : 1.32, 0.68, 0.68, 1.9);
    // These are deliberate small-item ledges, with physical supports supplied
    // by the renderer. They are not floating tabletop guesses.
    for (const [key, x] of [['left', r.x0 + 0.75], ['right', r.x0 + 1.9]]) {
      socket(`shelf_${key}`, `Display Shelf ${key}`, 'Tabletop', ['surface'],
        x, r.z0 + 0.38, 0.6, 0.4, 0.6, { elevated: 1.6, prio: 1 });
    }
    room.functionalAreas = floor.floorIndex ? ['study', 'storage', 'stair-hall'] : ['kitchen', 'dining', 'bathroom', 'stair-hall'];
  }

  socket('light', 'Ceiling Pendant', 'CeilingLight', ['ceiling'], cx, 0.1, 0.75, 0.75, 0.65,
    { elevated: FLOOR_HEIGHT - 0.12, defaultItemId: 'pendant_light', interactionPoint: null });

  // Wall objects have an actual solid attachment interval, never a window.
  const walls = floor.walls.filter((wall) => wall.roomIds.includes(room.roomId) && wall.side !== 'front');
  for (const wall of walls) {
    if (wall.side === 'partition' && wall.roomIds[0] !== room.roomId) continue;
    const margin = 0.75;
    let cursor = margin;
    const intervals = [];
    for (const opening of [...wall.openings].sort((a, b) => a.offset - b.offset)) {
      if (opening.offset - 0.2 - cursor >= 1.2) intervals.push([cursor, opening.offset - 0.2]);
      cursor = Math.max(cursor, opening.offset + opening.width + 0.2);
    }
    if (wall.length - margin - cursor >= 1.2) intervals.push([cursor, wall.length - margin]);
    intervals.forEach(([a, b], index) => {
      const offset = round2((a + b) / 2);
      const pos = wallPoint(wall, offset, WALL_T / 2 + 0.035);
      // Long back walls are shared by the two rectangles in the structural
      // graph. Only the room containing the attachment owns this socket.
      if (pos[0] < r.x0 + 0.15 || pos[0] > r.x1 - 0.15 || pos[1] < r.z0 + 0.15 || pos[1] > r.z1 - 0.15) return;
      socket(`art_${wall.wallId.split('_w').pop()}_${index}`, 'Wall Art', 'WallDecoration', ['wall'],
        pos[0], pos[1], 1.16, 0.16, 1.0,
        { wallId: wall.wallId, interval: [a, b], elevated: 2.0, rot: wallAngle(wall), spot: { offset } });
      socket(`wall_shelf_${wall.wallId.split('_w').pop()}_${index}`, 'Wall Shelf', 'WallShelf', ['wall-shelf'],
        pos[0], pos[1], 1.16, 0.4, 0.4,
        { wallId: wall.wallId, interval: [a, b], elevated: 1.25, rot: wallAngle(wall), spot: { offset } });
    });
  }
  return zones;
}

function buildReservedSlots(floor) {
  const slots = [];
  const add = (type, key, rect, extra = {}) => slots.push({
    slotId: `${floor.floorId}_reserved_${key}`, floorId: floor.floorId,
    roomId: floor.rooms.find((room) => rect.x0 >= room.rect.x0 && rect.x1 <= room.rect.x1)?.roomId || floor.rooms[0].roomId,
    slotType: type, allowedItemCategories: [], occupancyState: 'reserved',
    position: [(rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2], rotation: [0, 0, 0],
    maximumWidth: rect.x1 - rect.x0, maximumDepth: rect.z1 - rect.z0, maximumHeight: FLOOR_HEIGHT,
    clearanceBounds: { size: [rect.x1 - rect.x0, FLOOR_HEIGHT, rect.z1 - rect.z0], center: [(rect.x0 + rect.x1) / 2, FLOOR_HEIGHT / 2, (rect.z0 + rect.z1) / 2] },
    interactionPoint: null, navigationClearance: 0.6, wallIdIfRequired: null, parentSlotIdIfRequired: null,
    rect, ...extra,
  });
  if (floor.stairReserved) {
    const s = floor.stairReserved;
    add('StairReserved', 'stair', { x0: s.x0 - 0.18, z0: s.z0 - 0.72, x1: s.x1 + 0.1, z1: s.z1 + 0.72 });
  }
  doorClearances(floor).forEach((rect, i) => add('DoorClearance', `door_${i}`, rect));
  const partition = floor.walls.find((wall) => !wall.exterior && wall.openings.some((op) => op.kind === 'door'));
  if (partition) {
    const door = partition.openings.find((op) => op.kind === 'door');
    const doorZ = partition.z0 + door.offset + door.width / 2;
    const left = floor.rooms[0].rect, right = floor.rooms[1].rect;
    const arrivalX = right.x1 - 1.85;
    const leftX = right.z1 < left.z1 ? left.x1 - 1.25 : (left.x0 + left.x1) / 2;
    floor.navigationRoutes = [{ id: `${floor.floorId}_family_route`, width: 0.6,
      points: [[leftX, doorZ], [arrivalX, doorZ], [arrivalX, floor.stairReserved.z0 - 0.5], [(floor.stairReserved.x0 + floor.stairReserved.x1) / 2, floor.stairReserved.z0 - 0.5]] }];
    for (const route of floor.navigationRoutes) for (let i = 1; i < route.points.length; i++) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      add('NavigationClearance', `path_${i}`, { x0: Math.min(a[0], b[0]) - 0.3, x1: Math.max(a[0], b[0]) + 0.3,
        z0: Math.min(a[1], b[1]) - 0.3, z1: Math.max(a[1], b[1]) + 0.3 });
    }
  }
  for (const wall of floor.walls) for (const op of wall.openings) {
    if (op.kind !== 'window') continue;
    const [x, z] = wallPoint(wall, op.offset + op.width / 2, 0.3);
    const horizontal = Math.abs(wall.x1 - wall.x0) > 0.1;
    add('WindowClearance', op.id, { x0: x - (horizontal ? op.width / 2 : 0.18), x1: x + (horizontal ? op.width / 2 : 0.18),
      z0: z - (horizontal ? 0.18 : op.width / 2), z1: z + (horizontal ? 0.18 : op.width / 2) },
    { wallIdIfRequired: wall.wallId, minimumY: op.sill, maximumY: op.sill + op.height });
  }
  return slots;
}

/** Point on a wall: `offset` along it, `depth` toward the room interior. */
export function wallPoint(wall, offset, depth) {
  const dx = (wall.x1 - wall.x0) / wall.length;
  const dz = (wall.z1 - wall.z0) / wall.length;
  // interior normal: walls are axis-aligned; point toward the footprint center
  let nx = -dz, nz = dx;
  const mx = wall.x0 + dx * offset + nx * 0.01, mz = wall.z0 + dz * offset + nz * 0.01;
  if (Math.hypot(mx, mz) > Math.hypot(wall.x0 + dx * offset - nx * 0.01, wall.z0 + dz * offset - nz * 0.01)) {
    nx = -nx; nz = -nz;
  }
  return [wall.x0 + dx * offset + nx * depth, wall.z0 + dz * offset + nz * depth];
}

export function wallAngle(wall) {
  // rotation so a wall item faces the interior normal
  const dx = (wall.x1 - wall.x0) / wall.length;
  const dz = (wall.z1 - wall.z0) / wall.length;
  const [ix, iz] = wallPoint(wall, wall.length / 2, 1);
  const nx = ix - (wall.x0 + dx * wall.length / 2);
  const nz = iz - (wall.z0 + dz * wall.length / 2);
  return Math.atan2(nx, nz);
}

// ── geometric helpers ────────────────────────────────────────────────────────

export function itemFootprint(slotType) {
  return SLOT_FOOTPRINT[slotType] || [0.6, 0.6];
}

const rectsOverlap = (a, b, gap = 0) =>
  a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.z0 - gap < b.z1 && b.z0 - gap < a.z1;

function objectRect(def, obj) {
  const item = itemDefinitionFor(obj.itemId || obj.itemDefinitionId);
  const [w, d] = item ? [item.width, item.depth] : itemFootprint(obj.slotType);
  const rot = obj.rot || 0;
  const swap = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
  const rw = swap ? d : w, rd = swap ? w : d;
  return { x0: obj.pos[0] - rw / 2, z0: obj.pos[1] - rd / 2, x1: obj.pos[0] + rw / 2, z1: obj.pos[1] + rd / 2 };
}

function findFloor(def, floorId) { return def.floors.find((f) => f.floorId === floorId); }
function findRoom(floor, roomId) { return floor.rooms.find((r) => r.roomId === roomId); }
export function findZone(def, zoneId) {
  for (const f of def.floors) for (const r of f.rooms) {
    const z = r.zones.find((z) => z.zoneId === zoneId);
    if (z) return z;
  }
  return null;
}
export function findWall(floor, wallId) { return floor.walls.find((w) => w.wallId === wallId); }

/** Door clearance rects (both sides of every door on the floor). */
function doorClearances(floor) {
  const rects = [];
  for (const w of floor.walls) {
    for (const op of w.openings) {
      if (op.kind !== 'door') continue;
      const c = CLEARANCES.door;
      const [ax, az] = wallPoint(w, op.offset + op.width / 2, c / 2 + 0.05);
      const [bx, bz] = wallPoint(w, op.offset + op.width / 2, -c / 2 - 0.05);
      const along = op.width / 2 + 0.15;
      const normal = c / 2;
      const dx = (w.x1 - w.x0) / w.length;
      const dz = (w.z1 - w.z0) / w.length;
      const nx = -dz, nz = dx;
      const halfX = Math.abs(dx) * along + Math.abs(nx) * normal;
      const halfZ = Math.abs(dz) * along + Math.abs(nz) * normal;
      for (const [px, pz] of [[ax, az], [bx, bz]]) {
        rects.push({ x0: px - halfX, z0: pz - halfZ, x1: px + halfX, z1: pz + halfZ });
      }
    }
  }
  return rects;
}

// ── validation pipeline (task5 §13) ──────────────────────────────────────────
/**
 * Validate one placement candidate against the definition and other objects.
 * Returns { ok } or { ok:false, reason } with a specific human message (§15).
 */
export function validatePlacement(def, objects, cand) {
  const item = ITEMS.find((i) => i.id === cand.itemId);
  const itemDef = itemDefinitionFor(cand.itemId);
  if (!item) return { ok: false, reason: 'Unknown item.' };
  const zone = findZone(def, cand.zoneId);
  if (!zone) return { ok: false, reason: 'This placement zone no longer exists.' };
  const floor = findFloor(def, zone.floorId);
  const room = findRoom(floor, zone.roomId);
  if (cand.floorId !== zone.floorId || cand.roomId !== zone.roomId) {
    return { ok: false, reason: 'Select a placement slot on the active floor and in the correct room.' };
  }
  if (!itemDef.supportedSlotTypes.includes(zone.slotType) || !zone.allowedItemCategories.includes(itemDef.category)) {
    return { ok: false, reason: `“${item.name}” is not compatible with this kind of placement slot.` };
  }
  if (itemDef.width > zone.maximumWidth + 0.001 || itemDef.depth > zone.maximumDepth + 0.001 || itemDef.height > zone.maximumHeight + 0.001) {
    return { ok: false, reason: `“${item.name}” is too large for this slot.` };
  }
  const degrees = ((Math.round((cand.rot || 0) * 180 / Math.PI) % 360) + 360) % 360;
  const slotDegrees = ((Math.round((zone.rotation?.[1] || 0) * 180 / Math.PI) % 360) + 360) % 360;
  if (!itemDef.allowedRotations.includes(degrees) || degrees !== slotDegrees) {
    return { ok: false, reason: 'This furniture must use the slot’s authored orientation.' };
  }
  if (!itemDef.allowedRoomTypes.includes(room.roomType || room.type)) {
    return { ok: false, reason: `“${item.name}” is not compatible with this room.` };
  }
  if (itemDef.requiresParentSocket && !cand.anchorId && !cand.zoneId) {
    return { ok: false, reason: `“${item.name}” requires a valid parent socket.` };
  }

  // surface compatibility
  if (!item.slots.includes(cand.slotType) || !zone.types.includes(cand.slotType)) {
    const t = zone.types[0] || '';
    const surface = t === 'surface' ? 'a shelf' : t === 'wall' ? 'a wall' : t === 'window' ? 'a window sill' : 'the floor';
    return { ok: false, reason: `“${item.name}” can only be placed on ${surface === 'the floor' ? 'a matching floor zone' : surface}.` };
  }

  // v3 sockets are exact. A saved or preview object must identify the socket's
  // one authored spot and must still be located on it. This is the hard guard
  // that makes free placement (and stale marker coordinates) impossible.
  const approvedSpot = zone.spots?.find((spot) => spot.spotId === cand.spotId);
  if (!approvedSpot) return { ok: false, reason: 'Choose one of the visible placement sockets.' };
  if (Math.abs((cand.elevated || 0) - (zone.elevated || 0)) > 0.001) {
    return { ok: false, reason: 'This object must use the slot’s fixed attachment height.' };
  }
  if (zone.wallId) {
    if (!Number.isFinite(cand.offset) || Math.abs(cand.offset - approvedSpot.offset) > 0.025) {
      return { ok: false, reason: 'This wall item must stay on its approved socket.' };
    }
  } else if (!Array.isArray(cand.pos) ||
      Math.hypot(cand.pos[0] - approvedSpot.pos[0], cand.pos[1] - approvedSpot.pos[1]) > 0.025) {
    return { ok: false, reason: 'This item must stay on its approved socket.' };
  }

  // zone capacity
  const inZone = objects.filter((o) => o.zoneId === cand.zoneId && o.oid !== cand.oid);
  if (inZone.length >= zone.max) return { ok: false, reason: 'This zone is full — remove something first.' };

  // wall-mounted items: interval + opening conflicts (§ wall items over windows)
  if (zone.wallId) {
    const wall = findWall(floor, zone.wallId);
    const w = itemDef.width;
    const a = cand.offset - w / 2, b = cand.offset + w / 2;
    if (a < zone.interval[0] || b > zone.interval[1]) {
      return { ok: false, reason: 'This item is too close to the wall corner.' };
    }
    if (cand.slotType === 'wall') {
      for (const op of wall.openings) {
        const gap = CLEARANCES.wallDecorFromOpening;
        if (a < op.offset + op.width + gap && op.offset - gap < b) {
          return { ok: false, reason: op.kind === 'window' ? 'A wall item cannot cover the window.' : 'A wall item cannot cover the doorway.' };
        }
      }
    }
    for (const o of inZone) {
      const [ow] = itemFootprint(o.slotType);
      if (a < o.offset + ow / 2 + 0.15 && o.offset - ow / 2 - 0.15 < b) {
        return { ok: false, reason: 'Too close to another wall item.' };
      }
    }
    return { ok: true };
  }

  // floor / surface items: stay inside the room (§8.7)
  const rect = objectRect(def, cand);
  const inset = WALL_T / 2;
  const rr = room.rect;
  if (rect.x0 < rr.x0 + inset || rect.z0 < rr.z0 + inset || rect.x1 > rr.x1 - inset || rect.z1 > rr.z1 - inset) {
    return { ok: false, reason: 'The item must stay inside the room — it would cross a wall.' };
  }
  // stay inside the zone envelope for floor zones
  if (zone.rect && !rectsOverlap(rect, zone.rect, 0.4)) {
    return { ok: false, reason: `This spot is outside the “${zone.name}” zone.` };
  }

  const floorLevel = itemDef.placementTypes.includes('Floor');
  if (floorLevel) {
    // doorway clearance (spec example: “This sofa blocks the doorway.”)
    for (const dc of doorClearances(floor)) {
      if (rectsOverlap(rect, dc)) return { ok: false, reason: `This ${item.name.toLowerCase()} blocks the doorway.` };
    }
    // stair clearance on the lower floor + stair opening on the upper floor
    for (const reserved of floor.reservedSlots || []) {
      if (reserved.slotType === 'WindowClearance' && itemDef.height <= reserved.minimumY) continue;
      if (rectsOverlap(rect, reserved.rect)) {
        return { ok: false, reason: reserved.slotType === 'WindowClearance'
          ? 'This item would block a window.' : 'Stairs, doors and circulation must remain clear.' };
      }
    }
  }

  // Approved spots must remain genuinely free. Floor/door items collide on
  // floor level; shelf items collide only with objects on the same shelf.
  for (const o of objects) {
    if (o.oid === cand.oid || o.floorId !== zone.floorId || o.wallId) continue;
    const otherFloorLevel = itemDefinitionFor(o.itemId)?.placementTypes.includes('Floor');
    const sameLevel = floorLevel === otherFloorLevel &&
      (floorLevel || Math.abs((o.elevated || 0) - (cand.elevated || 0)) < 0.15);
    if (!sameLevel) continue;
    const gap = floorLevel ? 0.12 : 0.08;
    if (rectsOverlap(rect, objectRect(def, o), gap)) {
      return { ok: false, reason: floorLevel
        ? 'Too close to another piece of furniture.'
        : 'That approved surface spot is already occupied.' };
    }
  }
  return { ok: true };
}

// ── deterministic auto-placement (task5 §8.5) ────────────────────────────────
/**
 * Best valid candidate for an item in a zone. Grid order + integer scores make
 * the result reproducible: no random number participates.
 */
export function bestPlacement(def, objects, itemId, zone) {
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) return null;
  const slotType = item.slots.find((s) => zone.types.includes(s));
  if (!slotType) return null;
  const floor = findFloor(def, zone.floorId);

  let best = null, bestScore = -1e9;
  const consider = (cand, score) => {
    const v = validatePlacement(def, objects, cand);
    if (v.ok && score > bestScore) { best = cand; bestScore = score; }
  };

  const approvedSpots = zone.spots || [];
  if (zone.wallId) {
    const wall = findWall(floor, zone.wallId);
    for (let index = 0; index < approvedSpots.length; index++) {
      const spot = approvedSpots[index];
      if (spot.types && !spot.types.includes(slotType)) continue;
      const offset = round2(spot.offset);
      const cand = mkCand(item, slotType, zone, {
        spotId: spot.spotId,
        spotName: spot.name,
        wallId: zone.wallId,
        offset,
        pos: [...zone.anchor],
        rot: wallAngle(wall),
      });
      consider(cand, 100 - index);
    }
    return best;
  }

  for (let index = 0; index < approvedSpots.length; index++) {
    const spot = approvedSpots[index];
    if (spot.types && !spot.types.includes(slotType)) continue;
    const cand = mkCand(item, slotType, zone, {
      spotId: spot.spotId,
      spotName: spot.name,
      pos: [round2(spot.pos[0]), round2(spot.pos[1])],
      rot: spot.rot || 0,
    });
    consider(cand, 100 - index);
  }
  return best;
}


function mkCand(item, slotType, zone, extra) {
  const itemDef = itemDefinitionFor(item.id);
  const pos = extra.pos || [0, 0];
  const rot = extra.rot || 0;
  return {
    oid: null,
    objectInstanceId: null,
    itemId: item.id,
    itemDefinitionId: item.id,
    houseId: zone.floorId.split('_f')[0],
    slotType,
    placementType: PLACEMENT_TYPE[slotType] || 'Floor',
    floorId: zone.floorId, roomId: zone.roomId, zoneId: zone.zoneId, slotId: zone.slotId,
    anchorId: zone.zoneId,
    pos,
    localPosition: [pos[0], zone.elevated || 0, pos[1]],
    rot,
    localRotation: [0, rot, 0],
    scaleVariant: 'default',
    footprintBounds: itemDef?.collisionBounds || boundsFor(slotType),
    clearanceBounds: itemDef?.clearanceBounds || boundsFor(slotType),
    interactionBounds: itemDef?.interactionBounds || boundsFor(slotType),
    state: 'placed',
    revision: 0,
    offset: 0, wallId: null, elevated: zone.elevated || 0,
    ...extra,
  };
}

/** Upgrade v1 placement aliases to the complete v2 object-instance schema. */
export function normalizeObjectInstance(def, obj, index = 0) {
  const zone = findZone(def, obj.zoneId);
  const approvedSpot = zone?.spots?.find((spot) => spot.spotId === obj.spotId) || zone?.spots?.[0] || null;
  const itemId = obj.itemDefinitionId || obj.itemId;
  const itemDef = itemDefinitionFor(itemId);
  const oid = obj.objectInstanceId || obj.oid || `${def.houseId}_obj_${String(index + 1).padStart(3, '0')}`;
  // The authored socket is the single transform source. Old drafts could carry
  // a stale localPosition from another zone and visually stack unrelated items
  // even though their zoneId was correct.
  let socketPosition = null;
  let socketRotation = null;
  if (zone && approvedSpot) {
    if (zone.wallId) {
      const floor = findFloor(def, zone.floorId);
      const wall = findWall(floor, zone.wallId);
      socketPosition = [...zone.anchor];
      socketRotation = wallAngle(wall);
    } else {
      socketPosition = [...approvedSpot.pos];
      socketRotation = approvedSpot.rot || 0;
    }
  }
  const pos = socketPosition || (Array.isArray(obj.pos)
    ? [...obj.pos]
    : Array.isArray(obj.localPosition)
      ? [obj.localPosition[0], obj.localPosition[2]]
      : [...(zone?.anchor || [0, 0])]);
  const savedRotation = Array.isArray(obj.localRotation) ? obj.localRotation[1] : obj.rot;
  const rot = socketRotation ?? (Number.isFinite(savedRotation) ? savedRotation : 0);
  const slotType = obj.slotType || itemDef?.source.slots.find((s) => zone?.types.includes(s)) || itemDef?.source.slots[0];
  return {
    ...obj,
    oid,
    objectInstanceId: oid,
    itemId,
    itemDefinitionId: itemId,
    houseId: def.houseId,
    floorId: zone?.floorId || obj.floorId,
    roomId: zone?.roomId || obj.roomId,
    slotId: zone?.slotId || obj.slotId || obj.zoneId,
    zoneId: zone?.zoneId || obj.zoneId,
    placementType: obj.placementType || PLACEMENT_TYPE[slotType] || 'Floor',
    anchorId: zone?.zoneId || obj.anchorId || obj.zoneId || null,
    spotId: obj.spotId || approvedSpot?.spotId || null,
    spotName: obj.spotName || approvedSpot?.name || null,
    slotType,
    pos,
    localPosition: [pos[0], zone?.elevated ?? 0, pos[1]],
    elevated: zone?.elevated ?? 0,
    rot,
    localRotation: [0, rot, 0],
    scaleVariant: obj.scaleVariant || 'default',
    footprintBounds: itemDef?.collisionBounds || boundsFor(slotType),
    clearanceBounds: itemDef?.clearanceBounds || boundsFor(slotType),
    interactionBounds: itemDef?.interactionBounds || boundsFor(slotType),
    schemaVersion: SCHEMA_VERSION,
    state: obj.state || 'placed',
    revision: Number.isInteger(obj.revision) ? obj.revision : 0,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

// ── legacy migration (task5 §19) ─────────────────────────────────────────────
// Old interiors stored `slotId → itemId`. Each item is re-placed through the
// deterministic scorer into a compatible zone; items with no valid spot go
// back to the player's inventory — nothing is deleted, nothing is random.
const LEGACY_SLOT_TYPE = {
  center: 'floor-large', left: 'floor-large', mid: 'floor-med', right: 'floor-med',
  corner_bl: 'floor-tall', corner_br: 'floor-small', corner_fr: 'floor-small',
  wall_l: 'wall', wall_r: 'wall', shelf: 'surface', sill: 'window', entry: 'door',
};

export function migrateLegacyInterior(def, slots = {}) {
  return { objects: [], returned: Object.keys(slots).sort().map((key) => slots[key]).filter((id) => typeof id === 'string' && id) };
}

/** Old transforms are not transferable between layouts: return ownership. */
export function remapObjectsToPlacementSlots(def, sourceObjects = []) {
  return {
    objects: [],
    returned: sourceObjects.map((source) => source.itemDefinitionId || source.itemId).filter(Boolean),
  };
}

/** A replay-safe migration: ownership is preserved; v4 exact slots alone survive. */
export function migrateHouseInterior(cfg, previousObjects = [], inventory = []) {
  const definition = buildHouseDefinition(cfg);
  const objects = [];
  const returned = [];
  const currentSchema = cfg.houseDefinition?.schemaVersion ?? cfg.interiorSchemaVersion ?? cfg.schemaVersion;
  for (const source of previousObjects) {
    const itemId = source.itemDefinitionId || source.itemId;
    if (!itemId) continue;
    const zone = findZone(definition, source.slotId || source.zoneId);
    if (currentSchema === SCHEMA_VERSION && zone && source.floorId === zone.floorId && source.roomId === zone.roomId) {
      const normalized = normalizeObjectInstance(definition, { ...source, zoneId: zone.zoneId });
      if (validatePlacement(definition, objects, normalized).ok) { objects.push(normalized); continue; }
    }
    returned.push(itemId);
  }
  return {
    definition, objects, returned, inventory: [...inventory, ...returned],
    floorCount: definition.floorCount, residentCount: residentsFor(definition.floorCount),
    migrated: currentSchema !== SCHEMA_VERSION || returned.length > 0,
  };
}

/** Included residential fixtures. IDs derive from authored slots, so repeated
 * construction events never create a second resident bed or a second object. */
export function defaultResidentialObjects(def, { fromFloorIndex = 0 } = {}) {
  const objects = [];
  for (const floor of def.floors) {
    if (floor.floorIndex < fromFloorIndex) continue;
    for (const room of floor.rooms) for (const zone of room.zones) {
      if (!zone.defaultItemId) continue;
      const cand = bestPlacement(def, objects, zone.defaultItemId, zone);
      if (!cand) continue;
      objects.push(normalizeObjectInstance(def, {
        ...cand, oid: `${zone.slotId}_builtin`, includedWithHouse: true,
      }));
    }
  }
  return objects;
}
