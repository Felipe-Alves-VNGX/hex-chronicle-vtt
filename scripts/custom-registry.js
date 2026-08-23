/**
 * World-scoped registries of GM-authored biomes (terrain types) and
 * structures (building icons), beyond the fixed lists in data-model.js and
 * hex-icon-picker.js. Both settings are `config: false` - managed entirely
 * through BiomeStructureManager (biome-structure-manager.js), reached via
 * a settings menu init.js registers alongside these settings.
 *
 * Collision checks against the *built-in* key lists are the caller's job
 * (pass them in as `builtinKeys`) rather than this module importing
 * data-model.js/hex-icon-picker.js directly - both of those will need to
 * import getCustomBiomes()/getCustomStructures() from here, so importing
 * them back would be circular.
 */
import { MODULE_ID } from "./settings.js";
import { invalidateCustomStructureTextures } from "./render.js";

export function registerCustomRegistrySettings() {
  game.settings.register(MODULE_ID, "customBiomes", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => canvas.hexChronicle?.refresh(),
  });

  game.settings.register(MODULE_ID, "customStructures", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      // A deleted-then-re-added custom structure re-uses the same slug (and
      // therefore the same `custom:<slug>` cache key) if it has the same
      // name, but a different image - drop any stale cached texture for it
      // before refreshing, or the old image keeps rendering forever.
      invalidateCustomStructureTextures();
      canvas.hexChronicle?.refresh();
    },
  });
}

export function getCustomBiomes() {
  return game.settings.get(MODULE_ID, "customBiomes");
}

export function getCustomStructures() {
  return game.settings.get(MODULE_ID, "customStructures");
}

/** "Fortress of Doom" -> "fortress_of_doom". Used as both the registry key
 * and the value stored in a hex's `terrain.type`/`icon` field, so it has to
 * be safe as a plain identifier - lowercase, ASCII alphanumerics and
 * underscores only. */
export function slugify(name) {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function addCustomBiome(name, color, builtinKeys = []) {
  const slug = slugify(name);
  if (!slug) {
    ui.notifications.warn(game.i18n.localize("HEXCHRON.RegistryInvalidName"));
    return null;
  }
  const current = getCustomBiomes();
  if (builtinKeys.includes(slug) || slug in current) {
    ui.notifications.warn(game.i18n.format("HEXCHRON.RegistryDuplicateKey", { slug }));
    return null;
  }
  await game.settings.set(MODULE_ID, "customBiomes", { ...current, [slug]: { name: name.trim(), color } });
  return slug;
}

export async function removeCustomBiome(slug) {
  const current = { ...getCustomBiomes() };
  delete current[slug];
  await game.settings.set(MODULE_ID, "customBiomes", current);
}

export async function addCustomStructure(name, path, builtinKeys = []) {
  const slug = slugify(name);
  if (!slug) {
    ui.notifications.warn(game.i18n.localize("HEXCHRON.RegistryInvalidName"));
    return null;
  }
  if (!path) {
    ui.notifications.warn(game.i18n.localize("HEXCHRON.RegistryMissingImage"));
    return null;
  }
  const current = getCustomStructures();
  if (builtinKeys.includes(slug) || slug in current) {
    ui.notifications.warn(game.i18n.format("HEXCHRON.RegistryDuplicateKey", { slug }));
    return null;
  }
  await game.settings.set(MODULE_ID, "customStructures", { ...current, [slug]: { name: name.trim(), path } });
  return slug;
}

export async function removeCustomStructure(slug) {
  const current = { ...getCustomStructures() };
  delete current[slug];
  await game.settings.set(MODULE_ID, "customStructures", current);
}
