// Semantic interior snapshot (task8 §21.2, §21.4).
//
// Two layouts are the same when the player would see the same furniture in the
// same places. Key order, normalization defaults and derived bounds are not
// part of that comparison — treating them as meaningful is what made an
// untouched interior look "dirty" and produced an error on exit.

const SNAPSHOT_FIELDS = Object.freeze([
  'oid', 'itemId', 'floorId', 'roomId', 'zoneId', 'spotId', 'slotType',
  'placementType', 'scaleVariant', 'elevated',
]);

function roundCoordinate(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : 0;
}

export function interiorSnapshot(objects) {
  return (objects || []).map((object) => {
    const entry = {};
    for (const field of SNAPSHOT_FIELDS) entry[field] = object?.[field] ?? null;
    entry.pos = [roundCoordinate(object?.pos?.[0]), roundCoordinate(object?.pos?.[1])];
    entry.rot = roundCoordinate(object?.rot);
    return entry;
  }).sort((a, b) => String(a.oid).localeCompare(String(b.oid)));
}

export function interiorSnapshotHash(objects) {
  return JSON.stringify(interiorSnapshot(objects));
}

export function sameInteriorLayout(left, right) {
  return interiorSnapshotHash(left) === interiorSnapshotHash(right);
}
