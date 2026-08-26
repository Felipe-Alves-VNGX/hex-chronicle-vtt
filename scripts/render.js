/**
 * PIXI drawing for the hex-chronicle overlay. Mirrors the visual language of
 * the original SVG renderer (classes/hexagon_renderer.py + svg_templates/),
 * stacked bottom-to-top exactly like the original's layer order (content,
 * then grid, then coordinate numbers, then zone boundaries on top).
 *
 * Zone boundaries (dashed cluster outlines) are GM-only: they can leak the
 * shape of a secret area to players before they've explored it, and unlike
 * terrain they have no "unknown" fallback that hides that shape - so v1
 * simply never draws them for non-GM users. Revisit if the campaign wants
 * players to see zone outlines.
 */
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber } from "./settings.js";
import { hexKey, parseHexKey, resolveIcon, normalizeHexContent } from "./data-model.js";
import { hexShapePoints, zonePolygon, fineRingPoints, tileCenter, neighbors, neighborsWithinRange, pointToHex, pointInPolygon } from "./geometry.js";
import { zoneClusterLoops } from "./zone-cluster.js";
import { getEffectiveContent } from "./fog.js";
import { isHexEnabled, getSceneGrid, getSceneBiomes, getSceneZones, getSceneStructures, structureIconSrc } from "./scene-settings.js";

const LINK_MARKER_COLOR = 0x26c6da;

/** How many rings of empty hexes to draw when a scene has no authored hexes
 * at all. Without this, a brand-new scene renders nothing whatsoever - no
 * grid, nothing to click on - since the normal "authored hex + its
 * neighbors" rule has nothing to start from. Confirmed live: a scene with
 * zero hexes rendered a fully blank layer. Centered on the scene's own
 * center rather than world (0,0)/the origin setting - confirmed live that
 * Foundry's default camera position looks at the scene center, which for
 * a typical scene is nowhere near world (0,0), so a grid seeded there
 * would be just as invisible without the GM first panning to find it. */
const STARTER_GRID_RANGE = 3;

// A more muted, natural palette than the original tool's flat websafe
// colors (pure lightgreen/maroon/bisque read as harsh/cartoonish on a
// real map) - same semantic terrain-to-hue mapping, just toned down.
const DEFAULT_TERRAIN_COLORS = {
  plains: 0xb5c98e,
  light_wood: 0x6b8f5c,
  heavy_woods: 0x35502e,
  grassland: 0x8fbf5a,
  mountains: 0x8c7a6b,
  hills: 0xc9ad80,
  sea: 0x2e6f95,
  lake: 0x6fb3c2,
  marsh: 0x76824a,
  desert: 0xe3c77d,
  unknown: 0x5a5a5a,
};

const DEFAULT_ZONE_COLORS = {
  secured: 0x3f9142,
};

// Zones have no built-in "unknown" fallback the way terrain does, so an
// unrecognized zone id still needs *some* pattern - "diagonal" reads as a
// generic hatch without implying anything about what the zone means.
const DEFAULT_ZONE_PATTERNS = {
  secured: "diagonal",
};
const FALLBACK_ZONE_PATTERN = "diagonal";

const GRID_COLOR = 0x707070;
const ROAD_COLOR = 0x8b5a2b;
const RIVER_COLOR = 0x3a7ca5;

const textureCache = new Map();

/** Exposed so the hex editor's visual terrain-brush diagram (hex-diagram.js)
 * and the on-screen legend (hex-legend.js) paint with the exact same colors
 * (world palette override + this scene's own custom biomes/zones) as the
 * actual map render - keeps every picker/preview WYSIWYG instead of
 * drifting out of sync with a second color list. Defaults to the currently
 * viewed scene since every existing call site already operates in that
 * context. */
export function palette(scene = canvas.scene) {
  const override = getPaletteOverride();
  const terrain = { ...DEFAULT_TERRAIN_COLORS, ...(override.terrain ?? {}) };
  for (const b of getSceneBiomes(scene)) {
    const c = toColorNumber(b.color);
    if (c !== undefined) terrain[b.id] = c;
  }

  const zone = { ...DEFAULT_ZONE_COLORS, ...(override.zone ?? {}) };
  const zonePatterns = { ...DEFAULT_ZONE_PATTERNS };
  for (const z of getSceneZones(scene)) {
    const c = toColorNumber(z.color);
    if (c !== undefined) zone[z.id] = c;
    zonePatterns[z.id] = z.pattern;
  }

  return { terrain, zone, zonePatterns };
}

function terrainColor(scene, type) {
  const p = palette(scene);
  return p.terrain[type] ?? p.terrain.unknown;
}

function zoneStyle(scene, name) {
  const p = palette(scene);
  return { color: p.zone[name] ?? 0x228b22, pattern: p.zonePatterns[name] ?? FALLBACK_ZONE_PATTERN };
}

/** Resolves a resolveIcon() key ("building/xxx" or "terrain/xxx") to the
 * actual asset URL to load, honoring this scene's custom structure set for
 * "building/" icons (see scene-settings.js#structureIconSrc) - terrain
 * icons are always the module's own bundled set, biomes only get colors,
 * not icons. */
function iconUrl(iconKey, scene) {
  const [kind, id] = iconKey.split("/");
  if (kind === "building") {
    const custom = getSceneStructures(scene).find((s) => s.id === id);
    const src = custom ? structureIconSrc(custom.icon) : null;
    if (src) return src;
  }
  return `modules/${MODULE_ID}/assets/icons/${iconKey}.svg`;
}

function drawHexPolygon(graphics, points, { fillColor, alpha = 1 } = {}) {
  const flat = points.flatMap((p) => [p.x, p.y]);
  graphics.beginFill(fillColor, alpha);
  graphics.drawPolygon(flat);
  graphics.endFill();
}

function strokeDashedPolyline(graphics, points, { color, width, dash = 15, gap = 15, alpha = 1 }) {
  graphics.lineStyle(width, color, alpha);
  let drawing = true;
  let remaining = dash;
  for (let i = 0; i < points.length - 1; i++) {
    let [x0, y0] = [points[i].x, points[i].y];
    const [x1, y1] = [points[i + 1].x, points[i + 1].y];
    let segLen = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / (segLen || 1);
    const dy = (y1 - y0) / (segLen || 1);

    while (segLen > 0) {
      const step = Math.min(remaining, segLen);
      const nx = x0 + dx * step;
      const ny = y0 + dy * step;
      if (drawing) {
        graphics.moveTo(x0, y0).lineTo(nx, ny);
      }
      x0 = nx;
      y0 = ny;
      segLen -= step;
      remaining -= step;
      if (remaining <= 0) {
        drawing = !drawing;
        remaining = drawing ? dash : gap;
      }
    }
  }
}

// Keyed by the final resolved URL (not the "building/xxx" icon key), since
// two scenes can point the same custom-structure id at two different
// images (see scene-settings.js#structureIconSrc) - keying by icon key
// alone would let one scene's custom icon leak into another's cache entry.
async function getIconTexture(url) {
  if (textureCache.has(url)) return textureCache.get(url);
  try {
    const texture = await PIXI.Assets.load(url);
    // A 404 for an .svg asset doesn't always make PIXI.Assets.load() reject -
    // confirmed live: it can resolve with a texture that has no real
    // width/height instead. Treat that the same as a load failure, or a
    // later `new PIXI.Sprite(texture)` throws (crashing the whole render,
    // not just this one icon) instead of just skipping the missing icon.
    if (!texture?.width || !texture?.height) {
      throw new Error("resolved texture has no valid dimensions (likely a missing/malformed asset)");
    }
    textureCache.set(url, texture);
    return texture;
  } catch (err) {
    // Missing terrain icons are expected (not every terrain has one) -
    // matches the original renderer's quiet handling of that case. Mixed
    // terrain "type" is free text (custom terrains are meant to be
    // supported via custom CSS in the original tool), so a typo or a
    // made-up type here is normal too, not a bug to report loudly.
    if (!url.includes("/terrain/")) {
      console.warn(`${MODULE_ID} | icon not found: ${url}`, err);
    }
    textureCache.set(url, null);
    return null;
  }
}

async function preloadIcons(contents, scene) {
  const urls = new Set();
  for (const content of contents) {
    const icon = resolveIcon(content);
    if (icon) urls.add(iconUrl(icon, scene));
  }
  await Promise.all([...urls].map(getIconTexture));
}

/** Renders every hex + its neighborhood into `container` (a PIXI.Container
 * owned by HexChronicleLayer). Fully synchronous drawing, but icon textures
 * are preloaded first so nothing pops in mid-frame.
 *
 * Visibility (terrain fog + structure-reveal) is resolved once per hex via
 * fog.js's getEffectiveContent(), so drawing and the "Open Link" tool
 * (layer.js) can never disagree about what a given viewer is allowed to
 * see. Zone boundaries are the one thing still read from the raw,
 * un-gated data, since they're GM-only regardless (see module docstring).
 */
export async function renderHexes(container, scene, { isGM }) {
  container.removeChildren().forEach((c) => c.destroy({ children: true }));

  // Per-scene master toggle (default OFF, see scene-settings.js) - a
  // disabled scene draws absolutely nothing, not even the empty starter
  // grid, so a table's non-hexcrawl scenes stay untouched.
  if (!isHexEnabled(scene)) return;

  const radius = getRadius();
  const origin = getOrigin();
  const gridCfg = getSceneGrid(scene);
  const raw = scene.getFlag(MODULE_ID, "hexes") ?? {};
  const hexes = new Map(Object.entries(raw).map(([k, v]) => [k, normalizeHexContent(v)]));

  const allCells = new Set(hexes.keys());
  if (hexes.size === 0) {
    const centerX = (scene.width ?? radius * 6) / 2;
    const centerY = (scene.height ?? radius * 6) / 2;
    const seed = pointToHex(centerX, centerY, radius, origin) ?? { col: 0, row: 0 };
    for (const [c, r] of neighborsWithinRange(seed.col, seed.row, STARTER_GRID_RANGE)) {
      allCells.add(hexKey(c, r));
    }
  } else {
    for (const key of [...hexes.keys()]) {
      const { col, row } = parseHexKey(key);
      for (const [nc, nr] of Object.values(neighbors(col, row))) {
        allCells.add(hexKey(nc, nr));
      }
    }
  }

  const effectiveByKey = new Map();
  for (const key of allCells) {
    const { col, row } = parseHexKey(key);
    effectiveByKey.set(key, getEffectiveContent(col, row, scene, isGM));
  }

  await preloadIcons(effectiveByKey.values(), scene);

  const contentLayer = new PIXI.Container();
  const gridLayer = new PIXI.Graphics();
  const numbersLayer = new PIXI.Container();
  const zonesLayer = new PIXI.Container();
  container.addChild(contentLayer, gridLayer, numbersLayer, zonesLayer);

  for (const [key, content] of effectiveByKey) {
    const { col, row } = parseHexKey(key);
    drawGrid(gridLayer, col, row, radius, origin, gridCfg);
    drawContent(contentLayer, col, row, radius, origin, content, scene);
    drawNumber(numbersLayer, col, row, radius, origin);
  }

  if (isGM) {
    drawZones(zonesLayer, hexes, radius, origin, scene);
  }
}

function drawGrid(graphics, col, row, radius, origin, gridCfg) {
  const pts = hexShapePoints(col, row, radius, origin);
  const color = gridCfg.color ?? GRID_COLOR;
  const width = gridCfg.width ?? Math.max(1, radius / 20);
  if (gridCfg.style === "dashed") {
    strokeDashedPolyline(graphics, [...pts, pts[0]], {
      color, width, alpha: 0.6, dash: Math.max(6, radius * 0.18), gap: Math.max(5, radius * 0.12),
    });
  } else if (gridCfg.style === "dotted") {
    strokeDashedPolyline(graphics, [...pts, pts[0]], {
      color, width: width * 1.3, alpha: 0.6, dash: Math.max(1, width * 0.6), gap: Math.max(5, width * 2.6),
    });
  } else {
    graphics.lineStyle(width, color, 0.6);
    graphics.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
  }
}

function drawContent(container, col, row, radius, origin, content, scene) {
  const g = new PIXI.Graphics();
  container.addChild(g);

  const shape = hexShapePoints(col, row, radius, origin);
  drawHexPolygon(g, shape, { fillColor: terrainColor(scene, content.terrain.type ?? "unknown") });

  for (const mixed of content.terrain.mixed) {
    for (const side of mixed.sides) {
      const poly = zonePolygon(side, col, row, radius, origin);
      drawHexPolygon(g, poly, { fillColor: terrainColor(scene, mixed.type) });
    }
  }

  const pp = { ...fineRingPoints(col, row, radius, origin), C: tileCenter(col, row, radius, origin) };
  const strokeW = Math.max(1, (radius / 15) * 1.2);
  for (const road of content.roads) {
    const [a, b] = road.split(" ");
    if (!pp[a] || !pp[b]) continue;
    g.lineStyle(strokeW, ROAD_COLOR, 1);
    g.moveTo(pp[a].x, pp[a].y).quadraticCurveTo(pp.C.x, pp.C.y, pp[b].x, pp[b].y);
  }
  for (const river of content.rivers) {
    const [a, b] = river.split(" ");
    if (!pp[a] || !pp[b]) continue;
    g.lineStyle(strokeW, RIVER_COLOR, 1);
    g.moveTo(pp[a].x, pp[a].y).quadraticCurveTo(pp.C.x, pp.C.y, pp[b].x, pp[b].y);
  }

  const icon = resolveIcon(content);
  const texture = icon ? textureCache.get(iconUrl(icon, scene)) : null;
  // getIconTexture() already validates dimensions before caching, but a
  // bad/half-loaded texture crashing `new PIXI.Sprite(...)` would otherwise
  // take down the *entire* map render (every hex, for every viewer) over
  // one broken icon reference - confirmed live. Guard here too and just
  // fall back to the label instead of losing the whole map.
  let iconDrawn = false;
  if (texture && texture.width && texture.height) {
    try {
      const sprite = new PIXI.Sprite(texture);
      const scale = (radius * 0.6) / Math.max(texture.width, texture.height) / 1.1;
      sprite.scale.set(scale);
      sprite.anchor.set(0.5);
      sprite.position.set(pp.C.x, pp.C.y);
      container.addChild(sprite);
      iconDrawn = true;
    } catch (err) {
      console.warn(`${MODULE_ID} | failed to draw icon "${icon}", falling back to label`, err);
    }
  }
  if (!iconDrawn && content.alt) {
    const text = new PIXI.Text(content.alt, {
      fontSize: radius * 0.25,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: Math.max(1, radius / 20),
      align: "center",
    });
    text.anchor.set(0.5);
    text.position.set(pp.C.x, pp.C.y);
    container.addChild(text);
  }

  if (content.link) {
    const marker = new PIXI.Graphics();
    marker.beginFill(LINK_MARKER_COLOR, 0.9);
    marker.drawCircle(0, 0, Math.max(3, radius * 0.08));
    marker.endFill();
    marker.position.set(pp.N5.x, pp.N5.y); // same corner the old pathPoints.SE sat at
    container.addChild(marker);
  }
}

function drawNumber(container, col, row, radius, origin) {
  const { x, y } = tileCenter(col, row, radius, origin);
  const text = new PIXI.Text(`${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`, {
    fontFamily: "Signika, sans-serif",
    fontSize: Math.max(9, radius * 0.16),
    fill: 0xe6e6e6,
    stroke: 0x000000,
    strokeThickness: Math.max(1, radius / 40),
  });
  text.alpha = 0.85;
  text.anchor.set(0, 0.5);
  text.position.set(x - radius * 0.55, y - radius * 0.55);
  container.addChild(text);
}

/** Zones default to a hachure (hatch) fill rather than a solid one - a
 * translucent line/dot pattern reads as "this area is marked" without
 * hiding the terrain color underneath it, unlike a flat fill would. Each
 * zone gets its own pattern + color (module default, or this scene's own
 * override - see palette()/zoneStyle() above), so multiple zones on the
 * same map stay visually distinct. The hatch is drawn per member hex
 * (clipped to that hex's own polygon, see clipSegmentToConvexPolygon
 * below), not the zone cluster as a whole - a hole in a cluster (a
 * non-member hex fully surrounded by members, see zone-cluster.js) is then
 * automatically excluded, since a hex with no zone simply gets no hatch. */
function drawZones(parent, hexes, radius, origin, scene) {
  const hatchGraphics = new PIXI.Graphics();
  const outlineGraphics = new PIXI.Graphics();
  parent.addChild(hatchGraphics, outlineGraphics);

  const byZone = new Map();
  for (const [key, content] of hexes) {
    const { col, row } = parseHexKey(key);
    for (const zone of content.zone) {
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push([col, row]);
      drawZoneHatch(hatchGraphics, col, row, radius, origin, zoneStyle(scene, zone));
    }
  }

  const strokeW = Math.max(1, radius / 20);
  for (const [zone, cells] of byZone) {
    const { color } = zoneStyle(scene, zone);
    for (const loop of zoneClusterLoops(cells, radius, origin)) {
      strokeDashedPolyline(outlineGraphics, loop, { color, width: strokeW, alpha: 0.85 });
    }
  }
}

/** Clips segment p0->p1 against a convex polygon (Cyrus-Beck), returning
 * the surviving [start, end] pair or null if the segment misses the
 * polygon entirely. Doesn't assume a winding order - each edge's inward
 * normal is oriented using the polygon's own centroid, so it works for
 * hexShapePoints()'s point list regardless of draw order. */
function clipSegmentToConvexPolygon(p0, p1, polygon) {
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  let t0 = 0, t1 = 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    if (nx * (cx - a.x) + ny * (cy - a.y) < 0) { nx = -nx; ny = -ny; }
    const denom = dx * nx + dy * ny;
    const num = (a.x - p0.x) * nx + (a.y - p0.y) * ny;
    if (Math.abs(denom) < 1e-9) {
      if (num > 0) return null; // parallel to this edge and entirely outside it
      continue;
    }
    const t = num / denom;
    if (denom > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (t0 > t1) return null;
  return [
    { x: p0.x + dx * t0, y: p0.y + dy * t0 },
    { x: p0.x + dx * t1, y: p0.y + dy * t1 },
  ];
}

/** Draws one hex's hatch fill, clipped to its own hexagon so adjacent
 * zone/non-zone hexes never bleed into each other. */
function drawZoneHatch(graphics, col, row, radius, origin, { color, pattern }) {
  const poly = hexShapePoints(col, row, radius, origin);
  const center = tileCenter(col, row, radius, origin);
  const spacing = Math.max(4, radius * 0.28);
  const lineWidth = Math.max(1, radius / 45);
  const alpha = 0.55;
  const span = radius * 1.3;

  const drawLinesAt = (angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const px = -dy, py = dx; // perpendicular - steps between parallel lines
    const steps = Math.ceil(span / spacing);
    graphics.lineStyle(lineWidth, color, alpha);
    for (let i = -steps; i <= steps; i++) {
      const ox = center.x + px * i * spacing;
      const oy = center.y + py * i * spacing;
      const clipped = clipSegmentToConvexPolygon(
        { x: ox - dx * span, y: oy - dy * span },
        { x: ox + dx * span, y: oy + dy * span },
        poly
      );
      if (!clipped) continue;
      graphics.moveTo(clipped[0].x, clipped[0].y).lineTo(clipped[1].x, clipped[1].y);
    }
  };

  if (pattern === "dots") {
    graphics.beginFill(color, alpha);
    const dotRadius = Math.max(1, radius * 0.04);
    for (let x = -radius; x <= radius; x += spacing) {
      for (let y = -radius; y <= radius; y += spacing) {
        const p = { x: center.x + x, y: center.y + y };
        if (pointInPolygon(p, poly)) graphics.drawCircle(p.x, p.y, dotRadius);
      }
    }
    graphics.endFill();
  } else if (pattern === "cross") {
    drawLinesAt(45);
    drawLinesAt(135);
  } else if (pattern === "horizontal") {
    drawLinesAt(0);
  } else if (pattern === "vertical") {
    drawLinesAt(90);
  } else {
    drawLinesAt(45); // "diagonal" and any unrecognized pattern
  }
}
