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

let panelEl = null;
let hooks = [];

function colorHex(num) {
  return "#" + (Number(num) >>> 0).toString(16).padStart(6, "0");
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
