export const MODULE_ID = "hex-chronicle-vtt";

export function registerSettings() {
  game.settings.register(MODULE_ID, "hexRadius", {
    name: "HEXCHRON.SettingHexRadius",
    hint: "HEXCHRON.SettingHexRadiusHint",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    onChange: () => refreshLayer(),
  });

  game.settings.register(MODULE_ID, "originX", {
    name: "HEXCHRON.SettingOriginX",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
    onChange: () => refreshLayer(),
  });

  game.settings.register(MODULE_ID, "originY", {
    name: "HEXCHRON.SettingOriginY",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
    onChange: () => refreshLayer(),
  });

  game.settings.register(MODULE_ID, "autoReveal", {
    name: "HEXCHRON.SettingAutoReveal",
    hint: "HEXCHRON.SettingAutoRevealHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "autoRevealRadius", {
    name: "HEXCHRON.SettingAutoRevealRadius",
    hint: "HEXCHRON.SettingAutoRevealRadiusHint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
  });

  game.settings.register(MODULE_ID, "paletteOverride", {
    name: "HEXCHRON.SettingPalette",
    hint: "HEXCHRON.SettingPaletteHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshLayer(),
  });
}

export function getOrigin() {
  return { x: game.settings.get(MODULE_ID, "originX"), y: game.settings.get(MODULE_ID, "originY") };
}

export function getRadius() {
  return game.settings.get(MODULE_ID, "hexRadius");
}

/** Used by the align-tool drag handles (layer.js) to commit a new grid
 * position/size once, on drag-release - never called per-pointermove-frame,
 * to avoid hammering the world settings document (and the socket
 * round-trip that implies) with a write per pixel of mouse movement. */
export async function setOrigin(x, y) {
  await game.settings.set(MODULE_ID, "originX", Math.round(x));
  await game.settings.set(MODULE_ID, "originY", Math.round(y));
}

export async function setRadius(radius) {
  await game.settings.set(MODULE_ID, "hexRadius", Math.max(10, Math.round(radius)));
}

export function isAutoRevealEnabled() {
  return game.settings.get(MODULE_ID, "autoReveal");
}

export function getAutoRevealRadius() {
  return game.settings.get(MODULE_ID, "autoRevealRadius");
}

export function toColorNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.startsWith("#")) return Number.parseInt(value.slice(1), 16);
  return undefined;
}

export function getPaletteOverride() {
  const raw = game.settings.get(MODULE_ID, "paletteOverride");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const convert = (group) =>
      Object.fromEntries(
        Object.entries(group ?? {})
          .map(([k, v]) => [k, toColorNumber(v)])
          .filter(([, v]) => v !== undefined)
      );
    return { terrain: convert(parsed.terrain), zone: convert(parsed.zone) };
  } catch (err) {
    console.warn(`${MODULE_ID} | invalid palette override JSON, ignoring`, err);
    return {};
  }
}

function refreshLayer() {
  canvas.hexChronicle?.refresh();
}
