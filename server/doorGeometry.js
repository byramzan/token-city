// Doorway frame layout (task8 §22).
//
// Confirmed root cause of the flicker: the wall opening reserved a slot with
// exactly the frame's dimensions, so the jamb's outer face, the header's top
// face and the neighbouring wall segment's end face all landed on the same
// plane. Two opaque coplanar faces at the same depth is a z-fight, which reads
// as a shimmering texture around the opening while the camera moves.
//
// The fix is geometric: frame parts interpenetrate the wall and each other, and
// wall pieces around the opening overlap their neighbours by a seam. No
// polygonOffset, no depth-buffer trick, no hidden surface.

/**
 * Wall pieces butt against each other rather than overlapping.
 *
 * A butt joint puts two faces on the same plane but with opposite normals, so
 * each is back-face culled from the other's side and nothing z-fights. Making
 * them overlap instead would put two *same-facing* front faces of the wall on
 * one plane, which is the condition that actually flickers.
 */
export const WALL_SEAM = 0;
/** How far a frame part is embedded into the surface it meets. */
export const FRAME_EMBED = 0.03;

/**
 * Interior doorway frame, in wall-local coordinates.
 *
 * `x` runs along the wall, `y` is height, `z` is wall depth. Returned boxes are
 * axis-aligned in that frame, which is what makes the overlap testable.
 */
export function interiorDoorFrameLayout({ offset, width, height, wallThickness, lintelTop, trim = 0.09 }) {
  const lintelBottom = height + 0.1;
  const jambWidth = trim + FRAME_EMBED;
  const jambHeight = lintelBottom + FRAME_EMBED * 2;
  const jambDepth = wallThickness + 0.06;
  const headerHeight = 0.1 + FRAME_EMBED;
  const headerDepth = wallThickness + 0.06 + FRAME_EMBED;
  const mid = offset + width / 2;
  // The piece above the door reaches a seam into the full-height segments on
  // either side, so no two wall boxes share an end plane.
  const lintelSpan = [offset - trim - WALL_SEAM, offset + width + trim + WALL_SEAM];
  const lintelHeight = Math.max(0, Number(lintelTop) - lintelBottom);
  return {
    lintelBottom,
    lintelSpan,
    lintelHeight,
    lintel: lintelHeight > 0.001
      ? box('lintel', (lintelSpan[0] + lintelSpan[1]) / 2, lintelBottom + lintelHeight / 2,
        lintelSpan[1] - lintelSpan[0], lintelHeight, wallThickness)
      : null,
    jambs: [-1, 1].map((direction) => {
      const inner = direction < 0 ? offset : offset + width;
      const centre = inner + direction * (jambWidth / 2);
      return box(`jamb${direction < 0 ? 'Left' : 'Right'}`, centre, jambHeight / 2, jambWidth, jambHeight, jambDepth);
    }),
    header: box('header', mid, height + headerHeight / 2, width + 0.18, headerHeight, headerDepth),
  };
}

/**
 * Height at which a wall becomes one continuous band again.
 *
 * Above the tallest opening the wall is a single box across the whole length.
 * Splitting it per opening is what forced neighbouring pieces to share a top
 * plane, and a shared plane between two visible faces is the z-fight.
 */
export function wallBandBottom(openings, wallHeight) {
  if (!openings?.length) return null;
  const tops = openings.map((opening) => (opening.kind === 'window'
    ? Number(opening.sill) + Number(opening.height)
    : Number(opening.height) + 0.1));
  const bottom = Math.max(...tops);
  return bottom < wallHeight - 0.05 ? bottom : null;
}

/** Exterior house doorway, in door-group-local coordinates. */
export function exteriorDoorFrameLayout({ doorWidth, wallOffset = 0.04 }) {
  return {
    wallOffset,
    jambs: [-1, 1].map((direction) => box(
      `jamb${direction < 0 ? 'Left' : 'Right'}`,
      direction * (doorWidth / 2 + 0.08), 1.01, 0.14, 2.02, 0.12,
    )),
    header: box('header', 0, 1.91, doorWidth + 0.36, 0.14, 0.14),
    panel: box('panel', 0, 0.86, doorWidth, 1.72, 0.20, 0.02),
  };
}

function box(name, x, y, width, height, depth, z = 0) {
  return {
    name,
    centre: [x, y, z],
    size: [width, height, depth],
    min: [x - width / 2, y - height / 2, z - depth / 2],
    max: [x + width / 2, y + height / 2, z + depth / 2],
  };
}

const EPSILON = 1e-6;

function overlapsOnAxis(a, b, axis) {
  return Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > EPSILON;
}

/**
 * Same-facing coincident faces: two boxes whose `min` (or whose `max`) planes
 * coincide on one axis while they overlap on the other two. Both faces point
 * the same way, so both are rasterized at the same depth and the winner is
 * decided by floating-point noise — that is the z-fight.
 *
 * A `min`/`max` pair is a butt joint: the faces point away from each other and
 * each is culled from the other's side, so it is deliberately not reported.
 */
export function coincidentFacePairs(boxes) {
  const found = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      for (let axis = 0; axis < 3; axis += 1) {
        const others = [0, 1, 2].filter((value) => value !== axis);
        if (!others.every((other) => overlapsOnAxis(a, b, other))) continue;
        for (const [left, right] of [['min', 'min'], ['max', 'max']]) {
          if (Math.abs(a[left][axis] - b[right][axis]) < EPSILON) {
            found.push({ a: a.name, b: b.name, axis, planes: [left, right] });
          }
        }
      }
    }
  }
  return found;
}

/**
 * A coincident pair is harmless when the shared plane is buried inside a third
 * solid: nothing can be seen there, so nothing can flicker. Only pairs that
 * survive this filter are real defects.
 */
export function visibleCoincidentFaces(boxes) {
  return coincidentFacePairs(boxes).filter((pair) => {
    const a = boxes.find((entry) => entry.name === pair.a);
    const b = boxes.find((entry) => entry.name === pair.b);
    const region = [0, 1, 2].map((axis) => [
      Math.max(a.min[axis], b.min[axis]),
      Math.min(a.max[axis], b.max[axis]),
    ]);
    region[pair.axis] = [a[pair.planes[0]][pair.axis], a[pair.planes[0]][pair.axis]];
    return !boxes.some((other) => other !== a && other !== b
      && [0, 1, 2].every((axis) => other.min[axis] <= region[axis][0] + EPSILON
        && other.max[axis] >= region[axis][1] - EPSILON));
  });
}

/** Interpenetration proves the parts actually share volume rather than a face. */
export function boxesIntersect(a, b) {
  return [0, 1, 2].every((axis) => overlapsOnAxis(a, b, axis));
}
