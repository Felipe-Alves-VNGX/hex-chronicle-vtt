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
import { hexShapePoints, zonePolygon, pathPoints, tileCenter, neighbors } from "./geometry.js";
import { zoneClusterLoops } from "./zone-cluster.js";
import { isExplored } from "./fog.js";

const DEFAULT_TERRAIN_COLORS = {
  plains: 0x90ee90,
  light_wood: 0x008000,
  heavy_woods: 0x006400,
  grassland: 0x7fff00,
  mountains: 0x800000,
  hills: 0xffe4c4,
  sea: 0x0000ff,
  lake: 0x87cefa,
  marsh: 0x9acd32,
  desert: 0xffffe0,
  unknown: 0x808080,
};

const DEFAULT_ZONE_COLORS = {
  secured: 0x008000,
};

const GRID_COLOR = 0x8e8e8e;
const ROAD_COLOR = 0x8b4513;
const RIVER_COLOR = 0x0000ff;

const textureCache = new Map();

function palette() {
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
    textureCache.set(iconPath, texture);
    return texture;
  } catch (err) {
    // Missing terrain icons are expected (not every terrain has one) -
    // matches the original renderer's quiet handling of that case.
    if (!iconPath.startsWith("terrain/")) {
      console.warn(`${MODULE_ID} | icon not found: ${iconPath}`, err);
    }
    textureCache.set(iconPath, null);
    return null;
  }
}

async function preloadIcons(hexes) {
  const paths = new Set();
  for (const content of hexes.values()) {
    const icon = resolveIcon(content);
    if (icon) paths.add(icon);
  }
  await Promise.all([...paths].map(getIconTexture));
}

/** Renders every hex + its neighborhood into `container` (a PIXI.Container
 * owned by HexChronicleLayer). Fully synchronous drawing, but icon textures
 * are preloaded first so nothing pops in mid-frame. */
export async function renderHexes(container, scene, { isGM }) {
  container.removeChildren().forEach((c) => c.destroy({ children: true }));

  const radius = getRadius();
  const origin = getOrigin();
  const raw = scene.getFlag(MODULE_ID, "hexes") ?? {};
  const hexes = new Map(Object.entries(raw).map(([k, v]) => [k, normalizeHexContent(v)]));

  await preloadIcons(hexes);

  const contentLayer = new PIXI.Container();
  const gridLayer = new PIXI.Graphics();
  const numbersLayer = new PIXI.Container();
  const zonesLayer = new PIXI.Graphics();
  container.addChild(contentLayer, gridLayer, numbersLayer, zonesLayer);

  const allCells = new Set(hexes.keys());
  for (const key of [...hexes.keys()]) {
    const { col, row } = parseHexKey(key);
    for (const [nc, nr] of Object.values(neighbors(col, row))) {
      allCells.add(hexKey(nc, nr));
    }
  }

  for (const key of allCells) {
    const { col, row } = parseHexKey(key);
    const visible = isGM || isExplored(col, row, scene);
    const content = visible ? hexes.get(key) ?? normalizeHexContent({}) : normalizeHexContent({ terrain: { type: "unknown" } });

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
  graphics.lineStyle(Math.max(1, radius / 15), GRID_COLOR, 1);
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

  const pp = pathPoints(col, row, radius, origin);
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
  if (texture) {
    const sprite = new PIXI.Sprite(texture);
    const scale = (radius * 0.6) / Math.max(texture.width, texture.height) / 1.1;
    sprite.scale.set(scale);
    sprite.anchor.set(0.5);
    sprite.position.set(pp.C.x, pp.C.y);
    container.addChild(sprite);
  } else if (content.alt) {
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
}

function drawNumber(container, col, row, radius, origin) {
  const { x, y } = tileCenter(col, row, radius, origin);
  const text = new PIXI.Text(`${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`, {
    fontSize: radius * 0.2,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: Math.max(1, radius / 25),
  });
  text.position.set(x - radius * 0.85, y - radius * 0.75);
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
