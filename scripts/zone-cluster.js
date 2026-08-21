/**
 * Computes the dashed outer-boundary loop(s) of a zone cluster without a
 * general polygon-union library. Zones are drawn stroke-only (fill:none in
 * the original CSS), so we don't need Shapely-style boolean geometry - just
 * the set of edges that are NOT shared between two member hexes.
 *
 * For each hex, its 6 outer edges are walked in a fixed rotational order.
 * Two adjacent member hexes always traverse their shared edge in opposite
 * directions (a consequence of both being wound the same way), so an edge
 * shared with another cluster member cancels out with its reverse. What's
 * left are one or more closed loops: the outer perimeter, and - for a
 * cluster with a "hole" (a non-member hex fully surrounded by members, see
 * test_files/test-zone-with-hole.yaml) - an inner loop too. Each loop is
 * simply stroked independently; no even-odd fill rule is needed.
 */
import { hexShapePoints } from "./geometry.js";

function edgeKey(p) {
  return `${p.x},${p.y}`;
}

/**
 * @param {Array<[number,number]>} hexes col,row pairs belonging to one zone
 * @returns {Array<Array<{x:number,y:number}>>} closed point loops
 */
export function zoneClusterLoops(hexes, radius, origin) {
  const edgeList = [];
  for (const [col, row] of hexes) {
    const pts = hexShapePoints(col, row, radius, origin);
    for (let i = 0; i < pts.length; i++) {
      edgeList.push([pts[i], pts[(i + 1) % pts.length]]);
    }
  }

  const forwardKeys = new Set(edgeList.map(([a, b]) => `${edgeKey(a)}|${edgeKey(b)}`));
  const boundary = edgeList.filter(([a, b]) => !forwardKeys.has(`${edgeKey(b)}|${edgeKey(a)}`));

  return buildLoops(boundary);
}

function buildLoops(edges) {
  const remaining = edges.map(([a, b]) => ({ a, b, used: false }));
  const loops = [];

  for (const start of remaining) {
    if (start.used) continue;
    start.used = true;
    const loop = [start.a];
    let current = start;
    let safety = remaining.length + 1;

    while (safety-- > 0) {
      loop.push(current.b);
      if (edgeKey(current.b) === edgeKey(start.a)) break; // loop closed
      const next = remaining.find((e) => !e.used && edgeKey(e.a) === edgeKey(current.b));
      if (!next) break; // malformed boundary - shouldn't happen for a real hex cluster
      next.used = true;
      current = next;
    }
    loops.push(loop);
  }

  return loops;
}
