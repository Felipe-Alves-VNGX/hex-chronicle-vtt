/**
 * Per-scene overrides for Hex Chronicle, stored as scene flags (not world
 * settings - see settings.js for those) so each scene can opt in/out of the
 * hex layer independently and bring its own visual identity.
 *
 * Schema, all under `scene.flags[MODULE_ID]`:
 *
 * {
 *   enabled: false,                 // master per-scene toggle, default OFF
 *   grid: { color: "#707070", style: "solid" | "dashed" | "dotted", width: 4 },
 *   biomes: "[{\"id\":\"swamp\",\"label\":\"Swamp\",\"color\":\"#4b5d3a\"}]",
 *   structures: "[{\"id\":\"tower\",\"label\":\"Watchtower\",\"icon\":\"fortin\"}]",
 *   zones: "[{\"id\":\"dangerous\",\"label\":\"Dangerous\",\"pattern\":\"cross\",\"color\":\"#c0392b\"}]",
 * }
 *
 * `biomes`/`structures`/`zones` are stored as raw JSON text (same pattern as
 * settings.js's world-level `paletteOverride`) rather than a form of
 * repeatable rows, so a scene can define an arbitrarily-sized custom set
 * without needing a dynamic add/remove-row widget grafted onto Foundry's
 * own Scene Config sheet. Entries ADD TO / OVERRIDE the module's built-in
 * defaults by id, same override semantics as `paletteOverride` - they don't
 * replace the built-ins wholesale, so existing hexes referencing a default
 * biome/structure keep working even after a scene defines its own set.
 *
 * Invalid/malformed JSON is never fatal - parses to an empty list and warns,
 * matching every other "never throws on malformed input" spot in this
 * module (data-model.js's normalizeHexContent, settings.js's
 * getPaletteOverride).
 */
import { MODULE_ID, toColorNumber } from "./settings.js";
import { TERRAIN_TYPES } from "./data-model.js";

export const GRID_STYLES = ["solid", "dashed", "dotted"];
export const ZONE_PATTERNS = ["diagonal", "cross", "horizontal", "vertical", "dots"];

export function isHexEnabled(scene) {
  return !!scene?.getFlag(MODULE_ID, "enabled");
}

export function getSceneGrid(scene) {
  const raw = scene?.getFlag(MODULE_ID, "grid") ?? {};
  return {
    color: toColorNumber(raw.color) ?? null,
    style: GRID_STYLES.includes(raw.style) ? raw.style : "solid",
    width: Number.isFinite(raw.width) && raw.width > 0 ? raw.width : null,
  };
}

function parseJsonList(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string" && e.id.trim());
  } catch (err) {
    console.warn(`${MODULE_ID} | invalid scene override JSON, ignoring`, err);
    return [];
  }
}

export function getSceneBiomes(scene) {
  // data-model.js#normalizeHexContent lowercases terrain.type on save, so a
  // biome id must already be lowercase here or it'd never match back up
  // (the dropdown would offer "Swamp" but a saved hex would read back as
  // "swamp", failing to reselect it).
  return parseJsonList(scene?.getFlag(MODULE_ID, "biomes")).map((b) => ({ ...b, id: b.id.toLowerCase() }));
}

export function getSceneStructures(scene) {
  return parseJsonList(scene?.getFlag(MODULE_ID, "structures"));
}

export function getSceneZones(scene) {
  return parseJsonList(scene?.getFlag(MODULE_ID, "zones")).map((z) => ({
    ...z,
    pattern: ZONE_PATTERNS.includes(z.pattern) ? z.pattern : "diagonal",
  }));
}

/** Merged {id, label} list for the hex editor's terrain dropdown: the
 * module's built-in TERRAIN_TYPES plus this scene's custom biomes. A scene
 * biome sharing an id with a built-in one only relabels/recolors it (see
 * render.js#palette) rather than duplicating the entry. */
export function getEffectiveBiomes(scene = canvas.scene) {
  const byId = new Map(TERRAIN_TYPES.map((id) => [id, { id, label: id }]));
  for (const b of getSceneBiomes(scene)) {
    byId.set(b.id, { id: b.id, label: typeof b.label === "string" && b.label.trim() ? b.label.trim() : b.id });
  }
  return [...byId.values()];
}

/** Resolves a structure's `icon` field to an actual asset URL. A bare word
 * (no "/") is treated as one of the module's own bundled building icons
 * (assets/icons/building/<icon>.svg, same as always); anything containing a
 * "/" or an "http(s)://" prefix is used as-is, so a scene's custom
 * structure set can also point at a GM-uploaded image or another module's
 * icon. */
export function structureIconSrc(icon) {
  if (typeof icon !== "string" || !icon.trim()) return null;
  const trimmed = icon.trim();
  if (/^https?:\/\//.test(trimmed) || trimmed.includes("/")) return trimmed;
  return `modules/${MODULE_ID}/assets/icons/building/${trimmed}.svg`;
}
