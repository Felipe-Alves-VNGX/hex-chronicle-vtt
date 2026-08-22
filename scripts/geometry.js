/**
 * Pure hex-grid geometry, ported 1:1 from hex-chronicle's TileShape
 * (classes/hexagon_renderer.py). Flat-topped hexagons (vertices at E/W),
 * column-wise offset: odd columns are pushed down by half the hex height
 * ("odd-q" offset scheme). No PIXI/Foundry dependency — safe to unit-test
 * in a bare console.
 *
 * A hex is identified by integer (col, row). All pixel helpers accept an
 * `origin` {x, y} so the whole grid can be repositioned on a scene without
 * changing col/row bookkeeping.
 */

/** 24 fine-grained terrain zones: N1..N12 form a ring of 12 wedges between
 * the inner hexagon and the outer edge (each half the size of the old
 * N/NE/SE/S/SW/NW trapezoids), C1..C12 form a matching ring of 12 triangles
 * splitting what used to be the single "C" center hexagon. See
 * ringPoints()/zonePolygon() below for the geometry. */
export const TERRAIN_ZONES = [
  "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12",
];

/** Anchor points a road/river can start/end at: the same 12 ring positions
 * as the outer terrain-zone wedges (N1..N12), plus the single true-center
 * point C - a path doesn't need C split into 12 like a fill region does,
 * since "touches the center" is already unambiguous as one point. */
export const PATH_ANCHORS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12", "C"];

export function isValidZone(token) {
  return TERRAIN_ZONES.includes(token);
}

export function isValidPathAnchor(token) {
  return PATH_ANCHORS.includes(token);
}

/** Normalizes a raw side/cardinal token: uppercases and maps the French
 * "O" (Ouest) alias to "W" (West) - e.g. "no" -> "NW", "so" -> "SW".
 * Always returns a string (never coerces to boolean), fixing the bug in
 * the original CardinalEnumMeta where an unquoted YAML "NO"/"SO" value is
 * parsed as a boolean and crashes the renderer. */
export function normalizeCardinal(token) {
  if (typeof token !== "string") {
    throw new TypeError(
      `Invalid cardinal value ${JSON.stringify(token)}: expected a quoted string ` +
      `(if this came from YAML, an unquoted "NO"/"SO"-style value is parsed as a boolean - quote it)`
    );
  }
  return token.toUpperCase().replace(/O/g, "W");
}

export function radius2FromRadius(radius) {
  return Math.sqrt(radius ** 2 - (radius / 2) ** 2);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function tileCenter(col, row, radius, origin = { x: 0, y: 0 }) {
  const radius2 = radius2FromRadius(radius);
  return {
    x: round1(origin.x + radius * 1.5 * col),
    y: round1(origin.y + radius2 * 2 * row + (col % 2) * radius2),
  };
}

export function outerPoints(col, row, radius, origin) {
  const radius2 = radius2FromRadius(radius);
  const { x: cx, y: cy } = tileCenter(col, row, radius, origin);
  return {
    E: { x: round1(cx + radius), y: round1(cy) },
    NE: { x: round1(cx + radius / 2), y: round1(cy - radius2) },
    NW: { x: round1(cx - radius / 2), y: round1(cy - radius2) },
    W: { x: round1(cx - radius), y: round1(cy) },
    SW: { x: round1(cx - radius / 2), y: round1(cy + radius2) },
    SE: { x: round1(cx + radius / 2), y: round1(cy + radius2) },
  };
}

/** Outer hexagon vertices, in drawing order (matches the original Shapely
 * polygon: E, NE, NW, W, SW, SE). */
export function hexShapePoints(col, row, radius, origin) {
  const o = outerPoints(col, row, radius, origin);
  return [o.E, o.NE, o.NW, o.W, o.SW, o.SE];
}

// The inner hexagon's boundary sits at 60% of the outer radius - unchanged
// from the original single "C" zone's size, just now subdivided.
const INNER_SCALE = 0.6;

/** The 12 points, 30deg apart, that bound the fine terrain-zone wedges and
 * double as road/river anchors: odd positions (1,3,5,7,9,11) are the old
 * N/NE/SE/S/SW/NW edge-midpoints (at radius2, the hexagon's apothem), even
 * positions (2,4,6,8,10,12) are the hexagon's own vertices (at radius, E/NE/
 * NW/W/SW/SE) - the two point sets this module already had, just
 * interleaved into one ring instead of used separately. `scale` shrinks the
 * whole ring toward the center: 1 for the outer zone ring's outer edge (and
 * for road/river anchors, which always sit on the true outer edge), 0.6 for
 * its inner edge (== the fine center ring's outer edge). Numeric 1..12 keys
 * so zonePolygon()/fineRingPoints() below can index them positionally. */
function ringPoints(col, row, radius, origin, scale) {
  const { x: cx, y: cy } = tileCenter(col, row, radius, origin);
  const r2 = radius2FromRadius(radius) * scale;
  const r1 = radius * scale;
  const cosx = r2 * 0.8660254; // cos(pi/6)
  return {
    1: { x: round1(cx), y: round1(cy - r2) }, // N
    2: { x: round1(cx + r1 / 2), y: round1(cy - r2) }, // NE vertex
    3: { x: round1(cx + cosx), y: round1(cy - r2 / 2) }, // NE
    4: { x: round1(cx + r1), y: round1(cy) }, // E vertex
    5: { x: round1(cx + cosx), y: round1(cy + r2 / 2) }, // SE
    6: { x: round1(cx + r1 / 2), y: round1(cy + r2) }, // SE vertex
    7: { x: round1(cx), y: round1(cy + r2) }, // S
    8: { x: round1(cx - r1 / 2), y: round1(cy + r2) }, // SW vertex
    9: { x: round1(cx - cosx), y: round1(cy + r2 / 2) }, // SW
    10: { x: round1(cx - r1), y: round1(cy) }, // W vertex
    11: { x: round1(cx - cosx), y: round1(cy - r2 / 2) }, // NW
    12: { x: round1(cx - r1 / 2), y: round1(cy - r2) }, // NW vertex
  };
}

/** Public, named version of ringPoints() at the outer edge (scale 1) -
 * {N1: {x,y}, ..., N12: {x,y}} - the 12 road/river anchor points, and also
 * what hex-diagram.js draws its clickable anchor circles at. */
export function fineRingPoints(col, row, radius, origin) {
  const pts = ringPoints(col, row, radius, origin, 1);
  const named = {};
  for (let k = 1; k <= 12; k++) named[`N${k}`] = pts[k];
  return named;
}

/** Polygon for one of the 24 fine terrain zones (see TERRAIN_ZONES above):
 * "N{k}" is the quadrilateral wedge between ring position k and k+1, from
 * the inner hexagon boundary to the outer edge; "C{k}" is the matching
 * triangular wedge from the true center out to the inner hexagon boundary
 * at the same two ring positions - the same 12 angular cuts extended all
 * the way in, so an outer and inner wedge sharing a number sit flush
 * against each other with no gap or overlap. */
export function zonePolygon(card, col, row, radius, origin) {
  const outerMatch = /^N(\d{1,2})$/.exec(card);
  const centerMatch = /^C(\d{1,2})$/.exec(card);
  const k = Number((outerMatch ?? centerMatch)?.[1]);
  if (!k || k < 1 || k > 12) throw new Error(`No zone polygon for cardinal: ${card}`);
  const next = (k % 12) + 1;
  const inner = ringPoints(col, row, radius, origin, INNER_SCALE);

  if (outerMatch) {
    const outer = ringPoints(col, row, radius, origin, 1);
    return [inner[k], inner[next], outer[next], outer[k]];
  }
  const { x, y } = tileCenter(col, row, radius, origin);
  return [{ x, y }, inner[k], inner[next]];
}

/** Neighbor (col,row) for each of the 6 edge directions of a flat-top,
 * column-offset hex grid. Ported from hexamap.py's add_border_tiles, which
 * encodes the same odd/even column offset rule as tileCenter() above. */
export function neighbors(col, row) {
  const even = col % 2 === 0;
  return {
    N: [col, row - 1],
    S: [col, row + 1],
    NE: even ? [col + 1, row - 1] : [col + 1, row],
    SE: even ? [col + 1, row] : [col + 1, row + 1],
    NW: even ? [col - 1, row - 1] : [col - 1, row],
    SW: even ? [col - 1, row] : [col - 1, row + 1],
  };
}

/** All 6 neighbor (col,row) pairs within `range` hex-steps (BFS over
 * neighbors()), including the origin hex itself. Used for the fog-of-war
 * "reveal radius" around a token. */
export function neighborsWithinRange(col, row, range) {
  const seen = new Map([[`${col},${row}`, [col, row]]]);
  let frontier = [[col, row]];
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const [c, r] of frontier) {
      for (const [nc, nr] of Object.values(neighbors(c, r))) {
        const key = `${nc},${nr}`;
        if (!seen.has(key)) {
          seen.set(key, [nc, nr]);
          next.push([nc, nr]);
        }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

function pointInPolygon(point, polygon) {
  // Standard ray-casting test.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Inverse of tileCenter(): which (col,row) hex contains the given pixel
 * point? Approximates the column/row from the offset formulas, then
 * point-in-polygon tests a small neighborhood to handle the flat-top
 * column-offset skew exactly (cheap - at most 9 checks). Returns null if
 * no candidate hex contains the point (shouldn't happen on an
 * unboundedly-tiled plane, but callers should not assume it can't). */
export function pointToHex(x, y, radius, origin = { x: 0, y: 0 }) {
  const radius2 = radius2FromRadius(radius);
  const px = x - origin.x;
  const py = y - origin.y;
  const approxCol = Math.round(px / (radius * 1.5));

  for (let dc = -1; dc <= 1; dc++) {
    const col = approxCol + dc;
    const approxRow = Math.round((py - (col % 2 !== 0 ? radius2 : 0)) / (radius2 * 2));
    for (let dr = -1; dr <= 1; dr++) {
      const row = approxRow + dr;
      const shape = hexShapePoints(col, row, radius, origin);
      if (pointInPolygon({ x, y }, shape)) {
        return { col, row };
      }
    }
  }
  return null;
}
