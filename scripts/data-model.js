/**
 * Normalization/validation for a single hex's metadata, shared by the
 * per-hex editor (hex-editor.js) and the bulk importer (import.js) so both
 * paths produce the exact same shape before it lands in a scene flag.
 *
 * Schema (all fields optional - matches the original hex-chronicle
 * Markdown/YAML frontmatter field-for-field):
 *
 * {
 *   terrain: { type: "heavy_woods", mixed: [{ type: "lake", sides: ["C"] }] },
 *   alt: "Some Text",
 *   icon: "fortin",
 *   roads: ["SW SE"],
 *   rivers: ["N S"],
 *   zone: ["secured"],
 * }
 */
import { isValidZone, normalizeCardinal } from "./geometry.js";

export const TERRAIN_TYPES = [
  "plains",
  "light_wood",
  "heavy_woods",
  "grassland",
  "mountains",
  "hills",
  "sea",
  "lake",
  "marsh",
  "desert",
  "unknown",
];

export function emptyHex() {
  return { terrain: { type: undefined, mixed: [] }, alt: "", icon: "", roads: [], rivers: [], zone: [] };
}

function normalizeSides(sides) {
  if (!Array.isArray(sides)) return [];
  return sides
    .map((s) => {
      try {
        return normalizeCardinal(s);
      } catch {
        return null;
      }
    })
    .filter((s) => s && isValidZone(s));
}

function normalizePath(entry) {
  // "SW SE" -> "SW SE", tolerating extra whitespace and French aliases.
  if (typeof entry !== "string") return null;
  const tokens = entry.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return null;
  try {
    const [a, b] = tokens.map(normalizeCardinal);
    if (![a, b].every((t) => isValidZone(t) || t === "C")) return null;
    return `${a} ${b}`;
  } catch {
    return null;
  }
}

/** Normalizes a raw hex-content object (from the editor form or a parsed
 * import file) into the canonical shape stored in the scene flag. Never
 * throws on malformed input - drops what it cannot make sense of, mirroring
 * the original tool's "everything not defined is simply ignored" policy. */
export function normalizeHexContent(raw = {}) {
  const out = emptyHex();

  const terrainType = raw?.terrain?.type;
  if (typeof terrainType === "string") out.terrain.type = terrainType.toLowerCase();

  const mixed = Array.isArray(raw?.terrain?.mixed) ? raw.terrain.mixed : [];
  out.terrain.mixed = mixed
    .map((m) => ({
      type: typeof m?.type === "string" ? m.type.toLowerCase() : "unknown",
      sides: normalizeSides(m?.sides),
    }))
    .filter((m) => m.sides.length > 0);

  if (typeof raw.alt === "string" && raw.alt.trim()) out.alt = raw.alt.trim();
  if (typeof raw.icon === "string" && raw.icon.trim()) out.icon = raw.icon.trim();

  out.roads = (Array.isArray(raw.roads) ? raw.roads : []).map(normalizePath).filter(Boolean);
  out.rivers = (Array.isArray(raw.rivers) ? raw.rivers : []).map(normalizePath).filter(Boolean);

  const zone = raw.zone;
  out.zone = Array.isArray(zone) ? zone.filter((z) => typeof z === "string" && z.trim()) : typeof zone === "string" && zone.trim() ? [zone.trim()] : [];

  return out;
}

/** Derives which icon (if any) should be drawn in the hex center, matching
 * the original priority: explicit building icon > center-zone terrain icon. */
export function resolveIcon(content) {
  if (content.icon) return `building/${content.icon}`;
  const centerTerrain = content.terrain.mixed.find((m) => m.sides.includes("C"));
  const terrainType = centerTerrain ? centerTerrain.type : content.terrain.type;
  return terrainType ? `terrain/${terrainType}` : null;
}

export function hexKey(col, row) {
  return `${col},${row}`;
}

export function parseHexKey(key) {
  const [col, row] = key.split(",").map(Number);
  return { col, row };
}
