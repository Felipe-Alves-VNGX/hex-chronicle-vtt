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

export const CARDINALS = ["N", "NE", "SE", "S", "SW", "NW", "C"];

/** Zones valid for mixed-terrain sides / atomic zone composition. E and W are
 * vertex references only (used to build road/river Bezier anchors and the
 * outer hex shape) and are intentionally excluded here, matching the
 * original Cardinal.valid_zone behaviour. */
export function isValidZone(token) {
  return CARDINALS.includes(token);
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

export function innerPoints(col, row, radius, origin) {
  const r = radius * 0.6;
  const r2 = radius2FromRadius(radius) * 0.6;
  const { x: cx, y: cy } = tileCenter(col, row, radius, origin);
  return {
    E: { x: round1(cx + r), y: round1(cy) },
    NE: { x: round1(cx + r / 2), y: round1(cy - r2) },
    NW: { x: round1(cx - r / 2), y: round1(cy - r2) },
    W: { x: round1(cx - r), y: round1(cy) },
    SW: { x: round1(cx - r / 2), y: round1(cy + r2) },
    SE: { x: round1(cx + r / 2), y: round1(cy + r2) },
  };
}

/** Path anchor points used for road/river Bezier curves: N, NE, SE, S, SW, NW
 * at full radius2 (30/60deg trig positions) plus C (center). */
export function pathPoints(col, row, radius, origin) {
  const radius2 = radius2FromRadius(radius);
  const cosx = radius2 * 0.8660254; // cos(pi/6)
  const { x: cx, y: cy } = tileCenter(col, row, radius, origin);
  return {
    N: { x: round1(cx), y: round1(cy - radius2) },
    NW: { x: round1(cx - cosx), y: round1(cy - radius2 / 2) },
    NE: { x: round1(cx + cosx), y: round1(cy - radius2 / 2) },
    S: { x: round1(cx), y: round1(cy + radius2) },
    SW: { x: round1(cx - cosx), y: round1(cy + radius2 / 2) },
    SE: { x: round1(cx + cosx), y: round1(cy + radius2 / 2) },
    C: { x: round1(cx), y: round1(cy) },
  };
}

/** Outer hexagon vertices, in drawing order (matches the original Shapely
 * polygon: E, NE, NW, W, SW, SE). */
export function hexShapePoints(col, row, radius, origin) {
  const o = outerPoints(col, row, radius, origin);
  return [o.E, o.NE, o.NW, o.W, o.SW, o.SE];
}

/** Polygon (array of points) for one of the 7 zones of a hex: N/NE/SE/S/SW/NW
 * are quadrilaterals of 2 inner + 2 outer points; C is the inner hexagon. */
export function zonePolygon(card, col, row, radius, origin) {
  const inner = innerPoints(col, row, radius, origin);
  const outer = outerPoints(col, row, radius, origin);
  switch (card) {
    case "N":
      return [inner.NE, inner.NW, outer.NW, outer.NE];
    case "NE":
      return [inner.E, inner.NE, outer.NE, outer.E];
    case "SE":
      return [inner.E, inner.SE, outer.SE, outer.E];
    case "S":
      return [inner.SE, inner.SW, outer.SW, outer.SE];
    case "SW":
      return [inner.W, inner.SW, outer.SW, outer.W];
    case "NW":
      return [inner.W, inner.NW, outer.NW, outer.W];
    case "C":
      return [inner.E, inner.NE, inner.NW, inner.W, inner.SW, inner.SE];
    default:
      throw new Error(`No zone polygon for cardinal: ${card}`);
  }
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
