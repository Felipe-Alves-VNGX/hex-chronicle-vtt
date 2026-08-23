/**
 * Normalization/validation for a single hex's metadata, shared by the
 * per-hex editor (hex-editor.js) and the bulk importer (import.js) so both
 * paths produce the exact same shape before it lands in a scene flag.
 *
 * Schema (all fields optional - matches the original hex-chronicle
 * Markdown/YAML frontmatter field-for-field):
 *
 * {
 *   terrain: { type: "heavy_woods", mixed: [{ type: "lake", sides: ["C4", "C5"] }] },
 *   alt: "Some Text",
 *   icon: "fortin",
 *   roads: ["N9 N5"],
 *   rivers: ["N1 N7"],
 *   zone: ["secured"],
 *   link: "JournalEntry.aBc123" | "Scene.xYz789" | "JournalEntry.aBc123.JournalEntryPage.dEf456",
 *   notes: "Some longer GM-only text",
 * }
 *
 * `sides`/road/river endpoints use the 24 fine terrain-zone tokens and 13
 * path anchors from geometry.js (TERRAIN_ZONES/PATH_ANCHORS) - N1..N12 ring
 * the hex's outer half, C1..C12 ring its center half, and paths anchor to
 * N1..N12 or C. The original 7-token vocabulary (N/NE/SE/S/SW/NW/C) still
 * reads correctly forever - normalizeSides()/normalizePath() below expand
 * it to its fine equivalent on every read, no migration needed - but is no
 * longer written by this module once a hex is resaved.
 *
 * `link` is a Foundry document UUID (see scripts/links.js) that the "Open
 * Link" tool resolves and opens - a Journal Entry, a specific page in one,
 * or a Scene to jump to. It's the hex-chronicle equivalent of a native
 * Foundry Note pin, but attached to the hex itself instead of a separate
 * canvas pin.
 *
 * `notes` is GM-only, longer-form text (never gated/stripped since nothing
 * player-facing reads it).
 */
import { isValidZone, isValidPathAnchor, normalizeCardinal } from "./geometry.js";
import { MODULE_ID } from "./settings.js";

/** The original 7-token vocabulary (N/NE/SE/S/SW/NW/C), kept forever valid
 * for reading - old hex data, hand-typed text, and imported files all still
 * use it. Expanded transparently at normalize time into the fine-grained
 * TERRAIN_ZONES tokens (geometry.js) that now back it, so nothing needs a
 * one-time migration: every read re-expands, same as any other
 * normalization this function already does. A coarse zone maps to the pair
 * of fine wedges that together cover the exact same area (see
 * geometry.js#zonePolygon's numbering); "C" maps to all 12 center wedges. */
const LEGACY_ZONE_ALIASES = {
  N: ["N12", "N1"],
  NE: ["N2", "N3"],
  SE: ["N4", "N5"],
  S: ["N6", "N7"],
  SW: ["N8", "N9"],
  NW: ["N10", "N11"],
  C: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"],
};

/** Same idea for a road/river endpoint - a legacy label maps to exactly one
 * fine anchor point (a point doesn't need the pair-expansion a fill region
 * does). "C" needs no aliasing - the single center point never changed. */
const LEGACY_PATH_ALIASES = { N: "N1", NE: "N3", SE: "N5", S: "N7", SW: "N9", NW: "N11" };

/** Expands one normalized zone token into the fine token(s) it represents -
 * a no-op (wrapped in an array) for anything already fine-grained. */
export function expandZoneToken(token) {
  return LEGACY_ZONE_ALIASES[token] ?? [token];
}

/** Expands one normalized path-anchor token the same way, but 1:1. */
export function expandPathToken(token) {
  return LEGACY_PATH_ALIASES[token] ?? token;
}

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
  return { terrain: { type: undefined, mixed: [] }, alt: "", icon: "", roads: [], rivers: [], zone: [], link: "", notes: "" };
}

function normalizeSides(sides) {
  if (!Array.isArray(sides)) return [];
  const out = new Set();
  for (const raw of sides) {
    let token;
    try {
      token = normalizeCardinal(raw);
    } catch {
      continue;
    }
    for (const fine of expandZoneToken(token)) {
      if (isValidZone(fine)) out.add(fine);
    }
  }
  return [...out];
}

function normalizePath(entry) {
  // "SW SE" -> "N9 N7", tolerating extra whitespace, French aliases, and
  // the legacy 6-anchor vocabulary (expanded to its fine equivalent).
  if (typeof entry !== "string") return null;
  const tokens = entry.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return null;
  try {
    const [a, b] = tokens.map(normalizeCardinal).map(expandPathToken);
    if (![a, b].every(isValidPathAnchor)) return null;
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
  if (typeof raw.notes === "string" && raw.notes.trim()) out.notes = raw.notes.trim();

  out.roads = (Array.isArray(raw.roads) ? raw.roads : []).map(normalizePath).filter(Boolean);
  out.rivers = (Array.isArray(raw.rivers) ? raw.rivers : []).map(normalizePath).filter(Boolean);

  const zone = raw.zone;
  out.zone = Array.isArray(zone) ? zone.filter((z) => typeof z === "string" && z.trim()) : typeof zone === "string" && zone.trim() ? [zone.trim()] : [];

  if (typeof raw.link === "string" && raw.link.trim()) out.link = raw.link.trim();

  return out;
}

/** Returns a copy of `content` with its point-of-interest fields (building
 * icon, its fallback label, and any linked Journal/Scene) stripped, keeping
 * base terrain/mixed-terrain/roads/rivers intact. Used to hide a "structure"
 * from players until it's been specifically discovered - see fog.js -
 * independent of whether the surrounding terrain has been explored. */
export function stripStructure(content) {
  return { ...content, icon: "", alt: "", link: "" };
}

/** Derives which icon (if any) should be drawn in the hex center, matching
 * the original priority: explicit building icon > center-zone terrain icon. */
export function resolveIcon(content) {
  if (content.icon) return `building/${content.icon}`;
  const centerTerrain = content.terrain.mixed.find((m) => m.sides.some((s) => s.startsWith("C")));
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

/** Applies a partial-field patch to each of several hexes in a single scene
 * write - used by the Hex Overview's inline edits and bulk actions so N
 * edited hexes cost one setFlag call, not N (mirrors fog.js's revealArea()).
 * `patches` is [{ col, row, patch }]; `patch` is a partial raw hex object
 * (e.g. { alt: "..." } or { zone: [...] }) shallow-merged onto that hex's
 * existing raw content before normalization. */
export async function applyHexPatches(scene, patches) {
  const raw = scene.getFlag(MODULE_ID, "hexes") ?? {};
  const merged = { ...raw };
  for (const { col, row, patch } of patches) {
    const key = hexKey(col, row);
    merged[key] = normalizeHexContent({ ...(merged[key] ?? {}), ...patch });
  }
  return scene.setFlag(MODULE_ID, "hexes", merged);
}
