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

/** Per-scene overrides live under this single flag key (see scene-config.js,
 * which injects the "Hex Chronicle" tab into Foundry's own Scene
 * Configuration sheet). Each group carries its own `override` boolean so a
 * blank/zero field can never be mistaken for "not overridden" - `hexRadius:
 * 0` or `originX: 0` are otherwise indistinguishable from "inherit the
 * world default" if presence/emptiness alone were the signal. */
export function getSceneOverrides(scene = canvas.scene) {
  return scene?.getFlag(MODULE_ID, "sceneOverrides") ?? {};
}

/** Whole-module on/off switch for one scene, from the same tab. Absent flag
 * (any scene saved before this feature existed, or never touched since)
 * means enabled - matches the module's previous always-on behavior exactly,
 * so nothing breaks for existing worlds. */
export function isModuleEnabledOnScene(scene = canvas.scene) {
  const value = scene?.getFlag(MODULE_ID, "enabled");
  return value ?? true;
}

export function getRadius(scene = canvas.scene) {
  const grid = getSceneOverrides(scene).grid;
  if (grid?.override && typeof grid.hexRadius === "number") return grid.hexRadius;
  return game.settings.get(MODULE_ID, "hexRadius");
}

export function getOrigin(scene = canvas.scene) {
  const grid = getSceneOverrides(scene).grid;
  if (grid?.override) {
    return {
      x: typeof grid.originX === "number" ? grid.originX : 0,
      y: typeof grid.originY === "number" ? grid.originY : 0,
    };
  }
  return { x: game.settings.get(MODULE_ID, "originX"), y: game.settings.get(MODULE_ID, "originY") };
}

/** Used by the align-tool drag handles (layer.js) to commit a new grid
 * position/size once, on drag-release - never called per-pointermove-frame,
 * to avoid hammering the scene document (and the socket round-trip that
 * implies) with a write per pixel of mouse movement.
 *
 * Writes to the *scene's* grid override, not the world setting: the align
 * tool is always dragged against one specific scene's background art, so a
 * world-scoped write would silently misalign every other scene's grid too -
 * confirmed as the actual behavior before per-scene overrides existed. This
 * also flips `override` on, since dragging the handles is an unambiguous
 * "yes, this scene wants its own grid" signal. */
export async function setOrigin(x, y, scene = canvas.scene) {
  const grid = getSceneOverrides(scene).grid ?? {};
  await scene.setFlag(MODULE_ID, "sceneOverrides.grid", {
    ...grid,
    override: true,
    originX: Math.round(x),
    originY: Math.round(y),
  });
}

export async function setRadius(radius, scene = canvas.scene) {
  const grid = getSceneOverrides(scene).grid ?? {};
  await scene.setFlag(MODULE_ID, "sceneOverrides.grid", {
    ...grid,
    override: true,
    hexRadius: Math.max(10, Math.round(radius)),
  });
}

export function isAutoRevealEnabled(scene = canvas.scene) {
  const autoReveal = getSceneOverrides(scene).autoReveal;
  if (autoReveal?.override) return !!autoReveal.enabled;
  return game.settings.get(MODULE_ID, "autoReveal");
}

export function getAutoRevealRadius(scene = canvas.scene) {
  const autoReveal = getSceneOverrides(scene).autoReveal;
  if (autoReveal?.override && typeof autoReveal.radius === "number") return autoReveal.radius;
  return game.settings.get(MODULE_ID, "autoRevealRadius");
}

export function toColorNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.startsWith("#")) return Number.parseInt(value.slice(1), 16);
  return undefined;
}

function parsePalette(raw) {
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

export function getPaletteOverride(scene = canvas.scene) {
  const palette = getSceneOverrides(scene).palette;
  const raw = palette?.override ? palette.json : game.settings.get(MODULE_ID, "paletteOverride");
  return parsePalette(raw);
}

function refreshLayer() {
  canvas.hexChronicle?.refresh();
}
