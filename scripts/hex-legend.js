/**
 * On-screen terrain/zone color key, toggled from the Hex Chronicle scene
 * controls (a checkbox-style tool, see init.js) rather than an
 * ApplicationV2 window - it's meant to sit passively in a canvas corner
 * while a GM or player reads the map, not something anyone drags around or
 * closes/reopens as a workflow step.
 *
 * Only lists terrain types and zones actually *used* on the currently
 * viewed scene (not the module's full palette) - the point is "what do
 * these colors on THIS map mean", not a static reference of every terrain
 * hex-chronicle knows about. Colors come from render.js's palette()
 * (already merges any paletteOverride), so this always matches what's
 * actually drawn.
 *
 * Zones are GM-only here too, mirroring render.js's own
 * "zone boundaries never draw for non-GM users" rule (see that file's
 * module docstring) - a player toggling this on only ever sees the
 * terrain half.
 */
import { MODULE_ID } from "./settings.js";
import { normalizeHexContent } from "./data-model.js";
import { palette } from "./render.js";
import { TERRAIN_ZONES, zonePolygon, hexShapePoints } from "./geometry.js";

let panelEl = null;
let hooks = [];

const SVG_NS = "http://www.w3.org/2000/svg";
const ZONE_KEY_RADIUS = 65;

function colorHex(num) {
  return "#" + (Number(num) >>> 0).toString(16).padStart(6, "0");
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function centroid(points) {
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x, y };
}

/** Static (non-interactive) reference diagram for the N1..N12/C1..C12
 * addressing scheme itself - unlike the terrain/zone color lists below,
 * this isn't scene-dependent (the numbering is fixed geometry, not data),
 * so it's built once and reused across re-renders rather than rebuilt in
 * render(). Bare numbers only (not the full "N7"/"C7" token) to fit the
 * wedges at this size - the caption underneath says which ring is which. */
function buildZoneKeyDiagram() {
  const wrap = document.createElement("div");
  wrap.className = "hc-legend-zonekey";

  const svg = svgEl("svg", { viewBox: "-75 -70 150 140", class: "hc-legend-zonekey-svg" });
  for (const card of TERRAIN_ZONES) {
    const pts = zonePolygon(card, 0, 0, ZONE_KEY_RADIUS, { x: 0, y: 0 });
    const flat = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("polygon", { points: flat, class: card.startsWith("C") ? "hc-legend-zonekey-inner" : "hc-legend-zonekey-outer" }));
    const { x, y } = centroid(pts);
    const label = svgEl("text", { x: x.toFixed(1), y: y.toFixed(1), class: "hc-legend-zonekey-label" });
    label.textContent = card.slice(1);
    svg.appendChild(label);
  }
  svg.appendChild(svgEl("polygon", {
    points: hexShapePoints(0, 0, ZONE_KEY_RADIUS, { x: 0, y: 0 }).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    class: "hc-legend-zonekey-outline",
    fill: "none",
  }));
  wrap.appendChild(svg);

  const caption = document.createElement("p");
  caption.className = "hc-legend-zonekey-caption";
  caption.textContent = game.i18n.localize("HEXCHRON.LegendZoneKeyCaption");
  wrap.appendChild(caption);

  return wrap;
}

function computeUsage(scene) {
  const raw = scene?.getFlag(MODULE_ID, "hexes") ?? {};
  const terrains = new Set();
  const zones = new Set();
  for (const data of Object.values(raw)) {
    const content = normalizeHexContent(data);
    if (content.terrain.type) terrains.add(content.terrain.type);
    for (const mixed of content.terrain.mixed) terrains.add(mixed.type);
    for (const zone of content.zone) zones.add(zone);
  }
  return { terrains: [...terrains].sort(), zones: [...zones].sort() };
}

function buildList(items, paint) {
  const ul = document.createElement("ul");
  ul.className = "hc-legend-list";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "hc-legend-empty";
    li.textContent = game.i18n.localize("HEXCHRON.LegendEmpty");
    ul.appendChild(li);
    return ul;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "hc-legend-swatch";
    paint(swatch, item);
    li.appendChild(swatch);
    li.append(item.replace(/_/g, " "));
    ul.appendChild(li);
  }
  return ul;
}

function render() {
  if (!panelEl || !canvas.scene) return;
  const { terrains, zones } = computeUsage(canvas.scene);
  const p = palette();

  panelEl.replaceChildren();

  const terrainHeading = document.createElement("h4");
  terrainHeading.textContent = game.i18n.localize("HEXCHRON.LegendTerrain");
  panelEl.append(terrainHeading, buildList(terrains, (swatch, type) => {
    swatch.style.background = colorHex(p.terrain[type] ?? p.terrain.unknown);
  }));

  const zoneKeyHeading = document.createElement("h4");
  zoneKeyHeading.textContent = game.i18n.localize("HEXCHRON.LegendZoneKey");
  panelEl.append(zoneKeyHeading, buildZoneKeyDiagram());

  if (game.user.isGM && zones.length > 0) {
    const zoneHeading = document.createElement("h4");
    zoneHeading.textContent = game.i18n.localize("HEXCHRON.LegendZones");
    panelEl.append(zoneHeading, buildList(zones, (swatch, zone) => {
      swatch.classList.add("hc-legend-zone-swatch");
      swatch.style.borderColor = colorHex(p.zone[zone] ?? 0x228b22);
    }));
  }
}

function onUpdateScene(scene, changes) {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) render();
}

export function isLegendVisible() {
  return !!panelEl;
}

// showLegend()/hideLegend() must both stay idempotent - confirmed live that
// a single click on the toolbar toggle can invoke onChange 2-3 times in a
// row with the same resulting `active` value (a scene-controls/theme quirk,
// not something under this module's control), which would otherwise show
// two hook registrations or throw on a double-remove.
export function showLegend() {
  if (panelEl) return;
  const host = document.getElementById("interface") ?? document.body;
  panelEl = document.createElement("div");
  panelEl.id = "hex-chronicle-legend";
  host.appendChild(panelEl);
  hooks.push(["updateScene", Hooks.on("updateScene", onUpdateScene)]);
  hooks.push(["canvasReady", Hooks.on("canvasReady", render)]);
  render();
}

export function hideLegend() {
  for (const [name, id] of hooks) Hooks.off(name, id);
  hooks = [];
  panelEl?.remove();
  panelEl = null;
}

export function toggleLegend(active) {
  if (active) showLegend();
  else hideLegend();
}
