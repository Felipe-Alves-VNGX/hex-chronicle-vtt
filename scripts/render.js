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
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride } from "./settings.js";
import { hexKey, parseHexKey, resolveIcon, normalizeHexContent } from "./data-model.js";
import { hexShapePoints, zonePolygon, fineRingPoints, tileCenter, neighbors, neighborsWithinRange, pointToHex } from "./geometry.js";
import { zoneClusterLoops } from "./zone-cluster.js";
import { getEffectiveContent } from "./fog.js";

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

const GRID_COLOR = 0x707070;
const ROAD_COLOR = 0x8b5a2b;
const RIVER_COLOR = 0x3a7ca5;

const textureCache = new Map();

/** Exposed so the hex editor's visual terrain-brush diagram (hex-diagram.js)
 * paints with the exact same colors (including any world palette override)
 * as the actual map render - keeps the picker WYSIWYG instead of drifting
 * out of sync with a second hardcoded color list. */
export function palette() {
  const override = getPaletteOverride();
  return {
    terrain: { ...DEFAULT_TERRAIN_COLORS, ...(override.terrain ?? {}) },
    zone: { ...DEFAULT_ZONE_COLORS, ...(override.zone ?? {}) },
  };
}

function terrainColor(type) {
  const p = palette();
  return p.terrain[type] ?? p.terrain.unknown;
}

function zoneColor(name) {
  const p = palette();
  return p.zone[name] ?? 0x228b22;
}

function drawHexPolygon(graphics, points, { fillColor, alpha = 1 } = {}) {
  const flat = points.flatMap((p) => [p.x, p.y]);
  graphics.beginFill(fillColor, alpha);
  graphics.drawPolygon(flat);
  graphics.endFill();
}

function strokeDashedPolyline(graphics, points, { color, width, dash = 15, gap = 15 }) {
  graphics.lineStyle(width, color, 1);
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

async function getIconTexture(iconPath) {
  if (textureCache.has(iconPath)) return textureCache.get(iconPath);
  const url = `modules/${MODULE_ID}/assets/icons/${iconPath}.svg`;
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
    textureCache.set(iconPath, texture);
    return texture;
  } catch (err) {
    // Missing terrain icons are expected (not every terrain has one) -
    // matches the original renderer's quiet handling of that case. Mixed
    // terrain "type" is free text (custom terrains are meant to be
    // supported via custom CSS in the original tool), so a typo or a
    // made-up type here is normal too, not a bug to report loudly.
    if (!iconPath.startsWith("terrain/")) {
      console.warn(`${MODULE_ID} | icon not found: ${iconPath}`, err);
    }
    textureCache.set(iconPath, null);
    return null;
  }
}

async function preloadIcons(contents) {
  const paths = new Set();
  for (const content of contents) {
    const icon = resolveIcon(content);
    if (icon) paths.add(icon);
  }
  await Promise.all([...paths].map(getIconTexture));
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

  const radius = getRadius();
  const origin = getOrigin();
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

  await preloadIcons(effectiveByKey.values());

  const contentLayer = new PIXI.Container();
  const gridLayer = new PIXI.Graphics();
  const numbersLayer = new PIXI.Container();
  const zonesLayer = new PIXI.Graphics();
  container.addChild(contentLayer, gridLayer, numbersLayer, zonesLayer);

  for (const [key, content] of effectiveByKey) {
    const { col, row } = parseHexKey(key);
    drawGrid(gridLayer, col, row, radius, origin);
    drawContent(contentLayer, col, row, radius, origin, content);
    drawNumber(numbersLayer, col, row, radius, origin);
  }

  if (isGM) {
    drawZones(zonesLayer, hexes, radius, origin);
  }
}

function drawGrid(graphics, col, row, radius, origin) {
  const pts = hexShapePoints(col, row, radius, origin);
  graphics.lineStyle(Math.max(1, radius / 20), GRID_COLOR, 0.6);
  const flat = pts.flatMap((p) => [p.x, p.y]);
  graphics.drawPolygon(flat);
}

function drawContent(container, col, row, radius, origin, content) {
  const g = new PIXI.Graphics();
  container.addChild(g);

  const shape = hexShapePoints(col, row, radius, origin);
  drawHexPolygon(g, shape, { fillColor: terrainColor(content.terrain.type ?? "unknown") });

  for (const mixed of content.terrain.mixed) {
    for (const side of mixed.sides) {
      const poly = zonePolygon(side, col, row, radius, origin);
      drawHexPolygon(g, poly, { fillColor: terrainColor(mixed.type) });
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
  const texture = icon ? textureCache.get(icon) : null;
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

function drawZones(graphics, hexes, radius, origin) {
  const byZone = new Map();
  for (const [key, content] of hexes) {
    const { col, row } = parseHexKey(key);
    for (const zone of content.zone) {
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push([col, row]);
    }
  }

  const strokeW = Math.max(1, radius / 15);
  for (const [zone, cells] of byZone) {
    const loops = zoneClusterLoops(cells, radius, origin);
    for (const loop of loops) {
      strokeDashedPolyline(graphics, loop, { color: zoneColor(zone), width: strokeW });
    }
  }
}
