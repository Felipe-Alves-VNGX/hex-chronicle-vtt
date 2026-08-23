# Scene Config tab expansion + custom biome/structure registries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-scene tool visibility, grid line styling, and a standalone zone-visibility toggle to the existing "Hex Chronicle" Scene Config tab; add world-scoped custom biome and structure registries with a management window, wired into every place terrain type / building icon appears.

**Architecture:** Pure extension of the existing module - no new dependencies, no build step (this is a plain-ESM Foundry module, loaded by the browser as-is). Two independent surfaces: (1) three more fieldsets injected into the already-existing Scene Config tab (`scripts/scene-config.js`), each scene-scoped via the same `sceneOverrides` flag convention already used for grid/auto-reveal/palette; (2) a new world-scoped registry (`scripts/custom-registry.js`) of GM-authored biomes/structures, managed by a new `ApplicationV2` window reached from a `game.settings.registerMenu` entry, and consumed by every existing render/editor code path that currently hardcodes the built-in terrain/icon lists.

**Tech Stack:** FoundryVTT v13/14 ApplicationV2 + HandlebarsApplicationMixin, PIXI.js (canvas drawing), vanilla ESM (no bundler, no npm deps beyond the already-vendored `js-yaml`).

**Spec:** `docs/superpowers/specs/2026-08-23-scene-config-and-registries-design.md`

## Global Constraints

- No automated test harness exists in this repo (confirmed in `README.md`'s "Verifying this build" section) - there is no Jest/Mocha/etc. and none should be introduced. Every task's "test" step is `node --check <file>` (catches syntax errors only) plus a manual-verification bullet appended to `README.md`'s numbered list in the final task. Do not invent a test runner.
- Follow the codebase's existing defensive-access convention for Foundry v13-relocated APIs: `foundry.applications?.somePath?.Thing ?? globalThis.Thing` (see `scripts/import.js:82`, `scripts/scene-config.js`'s `renderTemplate` lookup).
- All new user-facing strings go in `lang/en.json` under the `HEXCHRON` namespace, referenced via `{{localize "HEXCHRON.Key"}}` in templates or `game.i18n.localize("HEXCHRON.Key")` in JS - never hardcoded English strings in templates/JS (matches every existing string in the codebase).
- Scene-scoped overrides always default to "current/legacy behavior" when their flag is absent, so no existing scene changes behavior after this ships without the GM opting in.
- World-scoped custom registries (`customBiomes`, `customStructures`) are `config: false` game settings - never add them to Foundry's generic "Configure Settings" list; they're reachable only through the dedicated manager window via `game.settings.registerMenu`.

---

## Task 1: Custom registry data layer

**Files:**
- Create: `scripts/custom-registry.js`

**Interfaces:**
- Consumes: `MODULE_ID` from `scripts/settings.js` (already exists).
- Produces (used by Tasks 2, 3, 4, 5, 6):
  - `registerCustomRegistrySettings(): void`
  - `getCustomBiomes(): Record<string, {name: string, color: string}>`
  - `getCustomStructures(): Record<string, {name: string, path: string}>`
  - `slugify(name: string): string`
  - `addCustomBiome(name: string, color: string, builtinKeys: string[]): Promise<string|null>`
  - `removeCustomBiome(slug: string): Promise<void>`
  - `addCustomStructure(name: string, path: string, builtinKeys: string[]): Promise<string|null>`
  - `removeCustomStructure(slug: string): Promise<void>`

This file intentionally does **not** import `data-model.js` or `hex-icon-picker.js` (both of those will import *from* this file in later tasks) - collision checks take the built-in key list as a parameter instead, so there's no circular import between this file and the two it will end up feeding.

- [ ] **Step 1: Write `scripts/custom-registry.js`**

```js
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
    onChange: () => canvas.hexChronicle?.refresh(),
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
```

- [ ] **Step 2: Add the three new lang keys this file's `ui.notifications.warn` calls reference**

Open `lang/en.json`, find the `"SceneOverridePalette"` line (last entry added in the previous session's work), and add after it (keep it inside the `HEXCHRON` object, comma-separated same as every other key):

```json
    "SceneOverridePalette": "Color palette",
    "RegistryInvalidName": "Enter a name (letters/numbers only after simplification).",
    "RegistryDuplicateKey": "\"{slug}\" already exists as a built-in or custom entry.",
    "RegistryMissingImage": "Choose an image for this structure first."
```

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/custom-registry.js`
Expected: no output (success).

- [ ] **Step 4: Validate JSON**

Run: `python3 -c "import json; json.load(open('lang/en.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/custom-registry.js lang/en.json
git commit -m "Add custom biome/structure registry data layer"
```

---

## Task 2: Custom biomes in the terrain dropdown and terrain-brush palette

**Files:**
- Modify: `scripts/data-model.js`
- Modify: `scripts/hex-editor.js`
- Modify: `scripts/hex-diagram.js`

**Interfaces:**
- Consumes: `getCustomBiomes()` from Task 1.
- Produces: `getAllTerrainTypes(): string[]` from `data-model.js`, used by Task 6.

- [ ] **Step 1: Add `getAllTerrainTypes()` to `data-model.js`**

Add this import near the top of `scripts/data-model.js` (it already imports from `./geometry.js` and `./settings.js`):

```js
import { getCustomBiomes } from "./custom-registry.js";
```

Immediately after the existing `TERRAIN_TYPES` array (currently ends with `"unknown",\n];`), add:

```js
/** Built-in terrain types plus every GM-registered custom biome
 * (custom-registry.js) - the full list a GM can pick from anywhere terrain
 * type is chosen (the editor's dropdown, the mixed-terrain brush palette).
 * Recomputed on every call (not cached) since custom biomes can be
 * added/removed without a reload. */
export function getAllTerrainTypes() {
  return [...TERRAIN_TYPES, ...Object.keys(getCustomBiomes())];
}
```

- [ ] **Step 2: Use it in the hex editor's terrain dropdown**

In `scripts/hex-editor.js`, change:

```js
import { normalizeHexContent, hexKey, TERRAIN_TYPES } from "./data-model.js";
```

to:

```js
import { normalizeHexContent, hexKey, getAllTerrainTypes } from "./data-model.js";
```

Then in `_prepareContext()`, change:

```js
      terrainTypes: Object.fromEntries(TERRAIN_TYPES.map((t) => [t, t])),
```

to:

```js
      terrainTypes: Object.fromEntries(getAllTerrainTypes().map((t) => [t, t])),
```

- [ ] **Step 3: Use it in the terrain-brush palette**

In `scripts/hex-diagram.js`, change:

```js
import { TERRAIN_TYPES, expandZoneToken, expandPathToken } from "./data-model.js";
```

to:

```js
import { getAllTerrainTypes, expandZoneToken, expandPathToken } from "./data-model.js";
```

Then change:

```js
  let armedType = TERRAIN_TYPES[0];
```

to:

```js
  let armedType = getAllTerrainTypes()[0];
```

And change:

```js
  for (const type of TERRAIN_TYPES) {
```

to:

```js
  for (const type of getAllTerrainTypes()) {
```

- [ ] **Step 4: Syntax-check all three files**

Run: `node --check scripts/data-model.js && node --check scripts/hex-editor.js && node --check scripts/hex-diagram.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add scripts/data-model.js scripts/hex-editor.js scripts/hex-diagram.js
git commit -m "Wire custom biomes into the terrain dropdown and brush palette"
```

---

## Task 3: Custom biome colors in the render palette

**Files:**
- Modify: `scripts/settings.js`
- Modify: `scripts/render.js`

**Interfaces:**
- Consumes: `getCustomBiomes()` from Task 1.
- Produces: `toColorNumber` now exported from `scripts/settings.js` (was private), used by Tasks 6 and 8.

- [ ] **Step 1: Export `toColorNumber` from `settings.js`**

In `scripts/settings.js`, change:

```js
function toColorNumber(value) {
```

to:

```js
export function toColorNumber(value) {
```

(No other change in this file - `parsePalette()` right below it keeps calling it exactly the same way, just now via an exported binding too.)

- [ ] **Step 2: Merge custom biome colors into `render.js#palette()`**

In `scripts/render.js`, change the import line:

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride } from "./settings.js";
```

to:

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber } from "./settings.js";
```

Add a new import right below it:

```js
import { getCustomBiomes } from "./custom-registry.js";
```

Then replace the `palette()` function:

```js
export function palette() {
  const override = getPaletteOverride();
  return {
    terrain: { ...DEFAULT_TERRAIN_COLORS, ...(override.terrain ?? {}) },
    zone: { ...DEFAULT_ZONE_COLORS, ...(override.zone ?? {}) },
  };
}
```

with:

```js
export function palette(scene = canvas.scene) {
  const custom = Object.fromEntries(
    Object.entries(getCustomBiomes())
      .map(([slug, biome]) => [slug, toColorNumber(biome.color)])
      .filter(([, v]) => v !== undefined)
  );
  const override = getPaletteOverride(scene);
  return {
    terrain: { ...DEFAULT_TERRAIN_COLORS, ...custom, ...(override.terrain ?? {}) },
    zone: { ...DEFAULT_ZONE_COLORS, ...(override.zone ?? {}) },
  };
}
```

(This also fixes `palette()` to accept an explicit `scene` the same way every other `settings.js` getter already does, so a scene's own palette override still wins over a custom biome's default color - custom biomes are a "define a new type" mechanism, not a way around per-scene overrides.)

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/settings.js && node --check scripts/render.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add scripts/settings.js scripts/render.js
git commit -m "Merge custom biome colors into the render palette"
```

---

## Task 4: Custom structure icon resolution

**Files:**
- Modify: `scripts/data-model.js`
- Modify: `scripts/render.js`

**Interfaces:**
- Consumes: `getCustomStructures()` from Task 1.
- Produces: `resolveIcon()` now returns a `"custom:<slug>"`-prefixed string for a custom structure, consumed by `render.js#getIconTexture`.

- [ ] **Step 1: Update `resolveIcon()` in `data-model.js`**

Change the import line (already touched in Task 2 - extend it further):

```js
import { getCustomBiomes } from "./custom-registry.js";
```

to:

```js
import { getCustomBiomes, getCustomStructures } from "./custom-registry.js";
```

Then replace:

```js
export function resolveIcon(content) {
  if (content.icon) return `building/${content.icon}`;
  const centerTerrain = content.terrain.mixed.find((m) => m.sides.some((s) => s.startsWith("C")));
  const terrainType = centerTerrain ? centerTerrain.type : content.terrain.type;
  return terrainType ? `terrain/${terrainType}` : null;
}
```

with:

```js
export function resolveIcon(content) {
  if (content.icon) {
    return getCustomStructures()[content.icon] ? `custom:${content.icon}` : `building/${content.icon}`;
  }
  const centerTerrain = content.terrain.mixed.find((m) => m.sides.some((s) => s.startsWith("C")));
  const terrainType = centerTerrain ? centerTerrain.type : content.terrain.type;
  return terrainType ? `terrain/${terrainType}` : null;
}
```

- [ ] **Step 2: Update `getIconTexture()` in `render.js`**

Extend the custom-registry import added in Task 3:

```js
import { getCustomBiomes } from "./custom-registry.js";
```

to:

```js
import { getCustomBiomes, getCustomStructures } from "./custom-registry.js";
```

Replace:

```js
async function getIconTexture(iconPath) {
  if (textureCache.has(iconPath)) return textureCache.get(iconPath);
  const url = `modules/${MODULE_ID}/assets/icons/${iconPath}.svg`;
  try {
```

with:

```js
async function getIconTexture(iconPath) {
  if (textureCache.has(iconPath)) return textureCache.get(iconPath);
  const url = iconPath.startsWith("custom:")
    ? getCustomStructures()[iconPath.slice(7)]?.path
    : `modules/${MODULE_ID}/assets/icons/${iconPath}.svg`;
  if (!url) {
    // The custom structure this hex references was deleted from the
    // registry since the hex was authored - same "missing icon" tolerance
    // as a bad built-in filename below, just caught before trying to load
    // anything.
    console.warn(`${MODULE_ID} | custom structure not found: ${iconPath}`);
    textureCache.set(iconPath, null);
    return null;
  }
  try {
```

(Leave the rest of the function - the `try`/`catch` body - untouched; it already reads `url` and falls back gracefully on a bad/missing texture.)

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/data-model.js && node --check scripts/render.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add scripts/data-model.js scripts/render.js
git commit -m "Resolve custom structure icons through the registry"
```

---

## Task 5: Custom structures in the icon picker

**Files:**
- Modify: `scripts/hex-icon-picker.js`

**Interfaces:**
- Consumes: `getCustomStructures()` from Task 1.
- Produces: `BUILDING_ICONS` now exported (was private), used by Task 6.

- [ ] **Step 1: Export `BUILDING_ICONS` and import the registry getter**

Change:

```js
import { MODULE_ID } from "./settings.js";

// Matches assets/icons/building/*.svg exactly - keep in sync if icons are
// added or removed there.
const BUILDING_ICONS = [
```

to:

```js
import { MODULE_ID } from "./settings.js";
import { getCustomStructures } from "./custom-registry.js";

// Matches assets/icons/building/*.svg exactly - keep in sync if icons are
// added or removed there.
export const BUILDING_ICONS = [
```

- [ ] **Step 2: Generalize `makeSwatch()` to take an optional label/image-src override, and list custom structures too**

Replace the whole body from `function makeSwatch(name) {` through the `makeSwatch("");` / built-in loop lines:

```js
  function makeSwatch(name) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-icon-swatch";
    btn.dataset.icon = name;
    btn.dataset.tooltip = name || game.i18n.localize("HEXCHRON.IconNone");
    if (name) {
      const img = document.createElement("img");
      img.src = `modules/${MODULE_ID}/assets/icons/building/${name}.svg`;
      img.alt = name;
      btn.appendChild(img);
    } else {
      btn.classList.add("hc-icon-none");
      btn.innerHTML = '<i class="fa-solid fa-ban"></i>';
    }
    btn.addEventListener("click", () => {
      input.value = input.value.trim() === name ? "" : name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    swatches.push(btn);
    grid.appendChild(btn);
  }

  makeSwatch("");
  for (const name of BUILDING_ICONS) makeSwatch(name);
```

with:

```js
  /** `key` is what actually gets written into the hex's `icon` field - a
   * bare filename for a built-in (resolved as `building/<key>.svg`) or a
   * custom structure's slug (resolved through the registry, see
   * data-model.js#resolveIcon). `label`/`src` override the tooltip/image
   * for a custom entry, whose real name and image path aren't derivable
   * from the key alone the way a built-in's are. */
  function makeSwatch(key, { label, src } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-icon-swatch";
    btn.dataset.icon = key;
    btn.dataset.tooltip = label ?? (key || game.i18n.localize("HEXCHRON.IconNone"));
    if (key) {
      const img = document.createElement("img");
      img.src = src ?? `modules/${MODULE_ID}/assets/icons/building/${key}.svg`;
      img.alt = label ?? key;
      btn.appendChild(img);
    } else {
      btn.classList.add("hc-icon-none");
      btn.innerHTML = '<i class="fa-solid fa-ban"></i>';
    }
    btn.addEventListener("click", () => {
      input.value = input.value.trim() === key ? "" : key;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    swatches.push(btn);
    grid.appendChild(btn);
  }

  makeSwatch("");
  for (const name of BUILDING_ICONS) makeSwatch(name);
  for (const [slug, structure] of Object.entries(getCustomStructures())) {
    makeSwatch(slug, { label: structure.name, src: structure.path });
  }
```

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/hex-icon-picker.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add scripts/hex-icon-picker.js
git commit -m "List custom structures in the icon picker"
```

---

## Task 6: Biome/structure manager window

**Files:**
- Create: `scripts/biome-structure-manager.js`
- Create: `templates/biome-structure-manager.hbs`
- Modify: `scripts/init.js`
- Modify: `styles/hex-chronicle.css`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: everything from Task 1 (`registerCustomRegistrySettings`, `getCustomBiomes`, `getCustomStructures`, `addCustomBiome`, `removeCustomBiome`, `addCustomStructure`, `removeCustomStructure`), `TERRAIN_TYPES` from `data-model.js`, `BUILDING_ICONS` from `hex-icon-picker.js` (Task 5).
- Produces: `registerRegistryMenu(): void`, called once from `init.js`.

- [ ] **Step 1: Write `templates/biome-structure-manager.hbs`**

```hbs
<div class="hc-registry-manager">
  <fieldset>
    <legend><i class="fa-solid fa-mountain-sun"></i> {{localize "HEXCHRON.RegistryBiomesLegend"}}</legend>

    <div class="hc-registry-list">
      {{#each customBiomes}}
      <div class="hc-registry-row">
        <span class="hc-registry-swatch" style="background-color: {{this.color}};"></span>
        <span class="hc-registry-name">{{this.name}}</span>
        <span class="hc-registry-slug">{{this.slug}}</span>
        <button type="button" data-action="removeBiome" data-slug="{{this.slug}}"><i class="fa-solid fa-trash"></i></button>
      </div>
      {{else}}
      <p class="hint">{{localize "HEXCHRON.RegistryNoCustomBiomes"}}</p>
      {{/each}}
    </div>

    <div class="hc-registry-add">
      <input type="text" name="newBiomeName" placeholder="{{localize 'HEXCHRON.RegistryNamePlaceholder'}}" />
      <input type="color" name="newBiomeColor" value="#888888" />
      <button type="button" data-action="addBiome">{{localize "HEXCHRON.RegistryAdd"}}</button>
    </div>

    <p class="hint">{{localize "HEXCHRON.RegistryBuiltinBiomes"}}: {{#each builtinBiomes}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</p>
  </fieldset>

  <fieldset>
    <legend><i class="fa-solid fa-chess-rook"></i> {{localize "HEXCHRON.RegistryStructuresLegend"}}</legend>

    <div class="hc-registry-list">
      {{#each customStructures}}
      <div class="hc-registry-row">
        <img class="hc-registry-icon" src="{{this.path}}" alt="{{this.name}}" />
        <span class="hc-registry-name">{{this.name}}</span>
        <span class="hc-registry-slug">{{this.slug}}</span>
        <button type="button" data-action="removeStructure" data-slug="{{this.slug}}"><i class="fa-solid fa-trash"></i></button>
      </div>
      {{else}}
      <p class="hint">{{localize "HEXCHRON.RegistryNoCustomStructures"}}</p>
      {{/each}}
    </div>

    <div class="hc-registry-add">
      <input type="text" name="newStructureName" placeholder="{{localize 'HEXCHRON.RegistryNamePlaceholder'}}" />
      <button type="button" data-action="chooseStructureImage">{{localize "HEXCHRON.RegistryChooseImage"}}</button>
      {{#if newStructurePath}}
      <img class="hc-registry-icon-preview" src="{{newStructurePath}}" alt="" />
      {{/if}}
      <button type="button" data-action="addStructure">{{localize "HEXCHRON.RegistryAdd"}}</button>
    </div>

    <p class="hint">{{localize "HEXCHRON.RegistryBuiltinStructures"}}: {{#each builtinStructures}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</p>
  </fieldset>
</div>
```

- [ ] **Step 2: Write `scripts/biome-structure-manager.js`**

```js
/**
 * GM-only world-scoped manager for custom biomes (terrain types) and
 * structures (building icons) - see custom-registry.js for the settings
 * these read/write. Reached via a settings menu (registerRegistryMenu()
 * below), not the module's own scene-controls toolbar, since it manages
 * world data, not anything about the current scene.
 *
 * Same "write immediately, no form-wide Save button" pattern as Hex
 * Overview's bulk actions - every add/remove is its own game.settings.set
 * call (inside custom-registry.js), followed by a re-render of this
 * window's own list.
 */
import { MODULE_ID } from "./settings.js";
import { TERRAIN_TYPES } from "./data-model.js";
import { BUILDING_ICONS } from "./hex-icon-picker.js";
import {
  getCustomBiomes,
  getCustomStructures,
  addCustomBiome,
  removeCustomBiome,
  addCustomStructure,
  removeCustomStructure,
} from "./custom-registry.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function getFilePickerImpl() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

export class BiomeStructureManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-registry-manager",
    window: {
      title: "HEXCHRON.RegistryManagerTitle",
      icon: "fa-solid fa-shapes",
      resizable: true,
      contentClasses: ["hex-chronicle-registry-manager"],
    },
    position: { width: 480, height: 620 },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/biome-structure-manager.hbs`, scrollable: [""] },
  };

  #newStructurePath = "";

  async _prepareContext() {
    return {
      builtinBiomes: TERRAIN_TYPES,
      customBiomes: Object.entries(getCustomBiomes()).map(([slug, biome]) => ({ slug, ...biome })),
      builtinStructures: BUILDING_ICONS,
      customStructures: Object.entries(getCustomStructures()).map(([slug, structure]) => ({ slug, ...structure })),
      newStructurePath: this.#newStructurePath,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.querySelector('[data-action="addBiome"]')?.addEventListener("click", async () => {
      const nameInput = this.element.querySelector('input[name="newBiomeName"]');
      const colorInput = this.element.querySelector('input[name="newBiomeColor"]');
      const slug = await addCustomBiome(nameInput.value, colorInput.value, TERRAIN_TYPES);
      if (slug) this.render();
    });

    for (const btn of this.element.querySelectorAll('[data-action="removeBiome"]')) {
      btn.addEventListener("click", async () => {
        await removeCustomBiome(btn.dataset.slug);
        this.render();
      });
    }

    this.element.querySelector('[data-action="chooseStructureImage"]')?.addEventListener("click", () => {
      const FilePickerImpl = getFilePickerImpl();
      new FilePickerImpl({
        type: "image",
        callback: (path) => {
          this.#newStructurePath = path;
          this.render();
        },
      }).render(true);
    });

    this.element.querySelector('[data-action="addStructure"]')?.addEventListener("click", async () => {
      const nameInput = this.element.querySelector('input[name="newStructureName"]');
      const slug = await addCustomStructure(nameInput.value, this.#newStructurePath, BUILDING_ICONS);
      if (slug) {
        this.#newStructurePath = "";
        this.render();
      }
    });

    for (const btn of this.element.querySelectorAll('[data-action="removeStructure"]')) {
      btn.addEventListener("click", async () => {
        await removeCustomStructure(btn.dataset.slug);
        this.render();
      });
    }
  }
}

export function registerRegistryMenu() {
  game.settings.registerMenu(MODULE_ID, "manageBiomesStructures", {
    name: "HEXCHRON.RegistryMenuName",
    label: "HEXCHRON.RegistryMenuLabel",
    hint: "HEXCHRON.RegistryMenuHint",
    icon: "fa-solid fa-shapes",
    type: BiomeStructureManager,
    restricted: true,
  });
}
```

- [ ] **Step 3: Wire both registration functions into `init.js`**

In `scripts/init.js`, change:

```js
import { MODULE_ID, registerSettings, isModuleEnabledOnScene } from "./settings.js";
import { HexChronicleLayer } from "./layer.js";
import { registerAutoRevealHook, confirmResetFog } from "./fog.js";
import { openImportDialog } from "./import.js";
import { HexOverview } from "./hex-overview.js";
import { toggleLegend } from "./hex-legend.js";
import { registerSceneConfigTab } from "./scene-config.js";
```

to:

```js
import { MODULE_ID, registerSettings, isModuleEnabledOnScene } from "./settings.js";
import { HexChronicleLayer } from "./layer.js";
import { registerAutoRevealHook, confirmResetFog } from "./fog.js";
import { openImportDialog } from "./import.js";
import { HexOverview } from "./hex-overview.js";
import { toggleLegend } from "./hex-legend.js";
import { registerSceneConfigTab } from "./scene-config.js";
import { registerCustomRegistrySettings } from "./custom-registry.js";
import { registerRegistryMenu } from "./biome-structure-manager.js";
```

Then change:

```js
Hooks.once("init", () => {
  registerSettings();
  registerSceneConfigTab();

  CONFIG.Canvas.layers.hexChronicle = {
```

to:

```js
Hooks.once("init", () => {
  registerSettings();
  registerCustomRegistrySettings();
  registerRegistryMenu();
  registerSceneConfigTab();

  CONFIG.Canvas.layers.hexChronicle = {
```

- [ ] **Step 4: Add CSS for the manager window**

Append to the end of `styles/hex-chronicle.css`:

```css
.hex-chronicle-registry-manager .hc-registry-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.hex-chronicle-registry-manager .hc-registry-swatch {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  flex: 0 0 auto;
}

.hex-chronicle-registry-manager .hc-registry-icon,
.hex-chronicle-registry-manager .hc-registry-icon-preview {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex: 0 0 auto;
}

.hex-chronicle-registry-manager .hc-registry-name {
  flex: 1 1 auto;
}

.hex-chronicle-registry-manager .hc-registry-slug {
  opacity: 0.6;
  font-size: 0.85em;
}

.hex-chronicle-registry-manager .hc-registry-add {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
```

- [ ] **Step 5: Add the remaining lang keys**

In `lang/en.json`, add after the three keys added in Task 1 (`RegistryInvalidName`/`RegistryDuplicateKey`/`RegistryMissingImage`):

```json
    "RegistryMenuName": "Manage Biomes & Structures",
    "RegistryMenuLabel": "Manage Biomes & Structures",
    "RegistryMenuHint": "Add or remove custom terrain types (biomes) and building icons (structures) beyond the module's built-in set - available to every scene.",
    "RegistryManagerTitle": "Manage Biomes & Structures",
    "RegistryBiomesLegend": "Biomes",
    "RegistryStructuresLegend": "Structures",
    "RegistryNoCustomBiomes": "No custom biomes yet.",
    "RegistryNoCustomStructures": "No custom structures yet.",
    "RegistryNamePlaceholder": "Name",
    "RegistryAdd": "Add",
    "RegistryChooseImage": "Choose Image",
    "RegistryBuiltinBiomes": "Built-in",
    "RegistryBuiltinStructures": "Built-in"
```

- [ ] **Step 6: Syntax-check and validate JSON**

Run: `node --check scripts/biome-structure-manager.js && node --check scripts/init.js`
Expected: no output (success).

Run: `python3 -c "import json; json.load(open('lang/en.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add scripts/biome-structure-manager.js templates/biome-structure-manager.hbs scripts/init.js styles/hex-chronicle.css lang/en.json
git commit -m "Add the biome/structure manager window and settings menu entry"
```

---

## Task 7: Scene tab — per-scene tool visibility

**Files:**
- Modify: `scripts/settings.js`
- Modify: `scripts/scene-config.js`
- Modify: `templates/scene-config-tab.hbs`
- Modify: `scripts/init.js`

**Interfaces:**
- Produces: `isToolVisibleOnScene(name: string, scene?: Scene): boolean` from `settings.js`, consumed by `init.js`.

- [ ] **Step 1: Add `isToolVisibleOnScene()` to `settings.js`**

Add after `isModuleEnabledOnScene()`:

```js
/** Per-tool visibility override for one scene's toolbar group (see the
 * "Hex Chronicle" Scene Config tab). Absent flag, or the whole
 * `sceneOverrides.tools` object absent, means visible - matches every
 * tool's previous always-available-when-the-group-is-visible behavior. */
export function isToolVisibleOnScene(name, scene = canvas.scene) {
  const tools = getSceneOverrides(scene).tools;
  return tools?.[name] ?? true;
}
```

- [ ] **Step 2: Add the fieldset to `templates/scene-config-tab.hbs`**

Append at the end of the file (after the existing "Color palette" `</fieldset>`):

```hbs

<fieldset>
  <legend>{{localize "HEXCHRON.SceneOverrideTools"}}</legend>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolEdit"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.edit" {{checked tools.edit}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolReveal"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.reveal" {{checked tools.reveal}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolRevealStructure"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.revealStructure" {{checked tools.revealStructure}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolOpen"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.open" {{checked tools.open}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolAlign"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.align" {{checked tools.align}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolImport"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.import" {{checked tools.import}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolResetFog"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.resetFog" {{checked tools.resetFog}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolOverview"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.overview" {{checked tools.overview}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.ToolLegend"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.tools.legend" {{checked tools.legend}} />
    </div>
  </div>
</fieldset>
```

- [ ] **Step 3: Add `tools` to the context built in `scene-config.js`**

In `scripts/scene-config.js`, the `context` object currently ends with the `palette` block. Add a `tools` entry to that same object (after `palette`):

```js
    palette: {
      override: !!overrides.palette?.override,
      json: overrides.palette?.json ?? game.settings.get(MODULE_ID, "paletteOverride"),
    },
    tools: Object.fromEntries(
      ["edit", "reveal", "revealStructure", "open", "align", "import", "resetFog", "overview", "legend"].map((name) => [
        name,
        overrides.tools?.[name] ?? true,
      ])
    ),
  };
```

(Only the closing `};` moves - everything above `tools:` is unchanged.)

- [ ] **Step 4: Add the lang key**

In `lang/en.json`, add next to the other `SceneOverride*` keys (after `"SceneOverridePalette": "Color palette",`):

```json
    "SceneOverrideTools": "Toolbar tools visible on this scene"
```

- [ ] **Step 5: Gate each tool's `visible` on `isToolVisibleOnScene()` in `init.js`**

Extend the settings import:

```js
import { MODULE_ID, registerSettings, isModuleEnabledOnScene } from "./settings.js";
```

to:

```js
import { MODULE_ID, registerSettings, isModuleEnabledOnScene, isToolVisibleOnScene } from "./settings.js";
```

Then update each tool definition inside `getSceneControlButtons`'s `tools: { ... }` object:

```js
      edit: {
        name: "edit",
        title: game.user.isGM ? "HEXCHRON.ToolEdit" : "HEXCHRON.ToolView",
        icon: "fa-solid fa-pen",
      },
      reveal: {
        name: "reveal",
        title: "HEXCHRON.ToolReveal",
        icon: "fa-solid fa-eye",
        visible: game.user.isGM,
      },
      revealStructure: {
        name: "revealStructure",
        title: "HEXCHRON.ToolRevealStructure",
        icon: "fa-solid fa-tower-observation",
        visible: game.user.isGM,
      },
      open: {
        name: "open",
        title: "HEXCHRON.ToolOpen",
        icon: "fa-solid fa-link",
      },
      align: {
        name: "align",
        title: "HEXCHRON.ToolAlign",
        icon: "fa-solid fa-crosshairs",
        visible: game.user.isGM,
      },
      import: {
        name: "import",
        title: "HEXCHRON.ToolImport",
        icon: "fa-solid fa-file-import",
        button: true,
        visible: game.user.isGM,
        onChange: () => openImportDialog(),
      },
      resetFog: {
        name: "resetFog",
        title: "HEXCHRON.ToolResetFog",
        icon: "fa-solid fa-broom",
        button: true,
        visible: game.user.isGM,
        onChange: () => confirmResetFog(),
      },
      overview: {
        name: "overview",
        title: "HEXCHRON.ToolOverview",
        icon: "fa-solid fa-chart-simple",
        button: true,
        visible: game.user.isGM,
        onChange: () => {
          if (hexOverviewApp?.rendered) hexOverviewApp.bringToFront();
          else {
            hexOverviewApp = new HexOverview();
            hexOverviewApp.render(true);
          }
        },
      },
      legend: {
        name: "legend",
        title: "HEXCHRON.ToolLegend",
        icon: "fa-solid fa-swatchbook",
        toggle: true,
        active: false,
        onChange: (event, active) => toggleLegend(active),
      },
```

becomes:

```js
      edit: {
        name: "edit",
        title: game.user.isGM ? "HEXCHRON.ToolEdit" : "HEXCHRON.ToolView",
        icon: "fa-solid fa-pen",
        visible: isToolVisibleOnScene("edit"),
      },
      reveal: {
        name: "reveal",
        title: "HEXCHRON.ToolReveal",
        icon: "fa-solid fa-eye",
        visible: game.user.isGM && isToolVisibleOnScene("reveal"),
      },
      revealStructure: {
        name: "revealStructure",
        title: "HEXCHRON.ToolRevealStructure",
        icon: "fa-solid fa-tower-observation",
        visible: game.user.isGM && isToolVisibleOnScene("revealStructure"),
      },
      open: {
        name: "open",
        title: "HEXCHRON.ToolOpen",
        icon: "fa-solid fa-link",
        visible: isToolVisibleOnScene("open"),
      },
      align: {
        name: "align",
        title: "HEXCHRON.ToolAlign",
        icon: "fa-solid fa-crosshairs",
        visible: game.user.isGM && isToolVisibleOnScene("align"),
      },
      import: {
        name: "import",
        title: "HEXCHRON.ToolImport",
        icon: "fa-solid fa-file-import",
        button: true,
        visible: game.user.isGM && isToolVisibleOnScene("import"),
        onChange: () => openImportDialog(),
      },
      resetFog: {
        name: "resetFog",
        title: "HEXCHRON.ToolResetFog",
        icon: "fa-solid fa-broom",
        button: true,
        visible: game.user.isGM && isToolVisibleOnScene("resetFog"),
        onChange: () => confirmResetFog(),
      },
      overview: {
        name: "overview",
        title: "HEXCHRON.ToolOverview",
        icon: "fa-solid fa-chart-simple",
        button: true,
        visible: game.user.isGM && isToolVisibleOnScene("overview"),
        onChange: () => {
          if (hexOverviewApp?.rendered) hexOverviewApp.bringToFront();
          else {
            hexOverviewApp = new HexOverview();
            hexOverviewApp.render(true);
          }
        },
      },
      legend: {
        name: "legend",
        title: "HEXCHRON.ToolLegend",
        icon: "fa-solid fa-swatchbook",
        toggle: true,
        active: false,
        visible: isToolVisibleOnScene("legend"),
        onChange: (event, active) => toggleLegend(active),
      },
```

- [ ] **Step 6: Syntax-check and validate JSON**

Run: `node --check scripts/settings.js && node --check scripts/scene-config.js && node --check scripts/init.js`
Expected: no output (success).

Run: `python3 -c "import json; json.load(open('lang/en.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add scripts/settings.js scripts/scene-config.js templates/scene-config-tab.hbs scripts/init.js lang/en.json
git commit -m "Add per-scene toolbar tool visibility to the Hex Chronicle Scene Config tab"
```

---

## Task 8: Scene tab — grid line style

**Files:**
- Modify: `scripts/settings.js`
- Modify: `scripts/render.js`
- Modify: `scripts/scene-config.js`
- Modify: `templates/scene-config-tab.hbs`

**Interfaces:**
- Produces: `getGridStyle(scene?: Scene): {lineType, color, width, opacity}` from `settings.js`, consumed by `render.js#drawGrid`.

- [ ] **Step 1: Add `getGridStyle()` to `settings.js`**

Add after `getAutoRevealRadius()`:

```js
/** Hardcoded fallback grid-line style, moved here from render.js so
 * getGridStyle() has somewhere to fall back to when a scene has no
 * override - these were render.js's GRID_COLOR/lineStyle constants before
 * per-scene grid styling existed. `width: null` means "derive from the
 * hex radius" (render.js's `Math.max(1, radius / 20)`), same as before -
 * there's no single fixed pixel width that makes sense across every
 * possible hex size. */
const DEFAULT_GRID_STYLE = { lineType: "solid", color: 0x707070, width: null, opacity: 0.6 };

export function getGridStyle(scene = canvas.scene) {
  const gridStyle = getSceneOverrides(scene).gridStyle;
  if (!gridStyle?.override) return DEFAULT_GRID_STYLE;
  return {
    lineType: gridStyle.lineType || DEFAULT_GRID_STYLE.lineType,
    color: typeof gridStyle.color === "string" ? toColorNumber(gridStyle.color) ?? DEFAULT_GRID_STYLE.color : DEFAULT_GRID_STYLE.color,
    width: typeof gridStyle.width === "number" ? gridStyle.width : DEFAULT_GRID_STYLE.width,
    opacity: typeof gridStyle.opacity === "number" ? gridStyle.opacity : DEFAULT_GRID_STYLE.opacity,
  };
}
```

(`toColorNumber` is already defined further down in this same file - function declarations are hoisted, so the forward reference is fine.)

- [ ] **Step 2: Rewrite `drawGrid()` in `render.js`**

Extend the settings import (already touched in Tasks 3/4):

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber } from "./settings.js";
```

to:

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber, getGridStyle } from "./settings.js";
```

Remove the now-unused constant (it moved into `settings.js#DEFAULT_GRID_STYLE` in Step 1):

```js
const GRID_COLOR = 0x707070;
```

Replace:

```js
function drawGrid(graphics, col, row, radius, origin) {
  const pts = hexShapePoints(col, row, radius, origin);
  graphics.lineStyle(Math.max(1, radius / 20), GRID_COLOR, 0.6);
  const flat = pts.flatMap((p) => [p.x, p.y]);
  graphics.drawPolygon(flat);
}
```

with:

```js
function drawGrid(graphics, col, row, radius, origin, scene) {
  const style = getGridStyle(scene);
  if (style.lineType === "none") return;
  const pts = hexShapePoints(col, row, radius, origin);
  const width = Math.max(1, style.width ?? radius / 20);
  if (style.lineType === "solid") {
    graphics.lineStyle(width, style.color, style.opacity);
    graphics.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
    return;
  }
  // "dashed"/"dotted": same segmented-stroke technique drawZones() already
  // uses for zone boundaries below, just on the hex's own outline instead
  // of a zone cluster's - dotted uses a short dash with a relatively large
  // gap so it reads as dots, not dashes.
  const [dash, gap] = style.lineType === "dotted" ? [Math.max(1, width), width * 3] : [width * 4, width * 3];
  strokeDashedPolyline(graphics, [...pts, pts[0]], { color: style.color, width, dash, gap, alpha: style.opacity });
}
```

Update `strokeDashedPolyline()`'s signature to accept the new `alpha` option:

```js
function strokeDashedPolyline(graphics, points, { color, width, dash = 15, gap = 15 }) {
  graphics.lineStyle(width, color, 1);
```

becomes:

```js
function strokeDashedPolyline(graphics, points, { color, width, dash = 15, gap = 15, alpha = 1 }) {
  graphics.lineStyle(width, color, alpha);
```

(The rest of `strokeDashedPolyline`'s body is unchanged. The `drawZones()` call site already passes no `alpha`, so it keeps its current fully-opaque zone boundaries.)

Finally, pass `scene` through the one call site inside `renderHexes()`:

```js
    drawGrid(gridLayer, col, row, radius, origin);
```

becomes:

```js
    drawGrid(gridLayer, col, row, radius, origin, scene);
```

- [ ] **Step 3: Add the fieldset to `templates/scene-config-tab.hbs`**

Append after the "Toolbar tools" fieldset added in Task 7:

```hbs

<fieldset>
  <legend>{{localize "HEXCHRON.SceneOverrideGridStyle"}}</legend>
  <div class="form-group">
    <label>{{localize "HEXCHRON.SceneOverrideEnable"}}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.gridStyle.override" {{checked gridStyle.override}} />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.SettingGridLineType"}}</label>
    <div class="form-fields">
      <select name="flags.hex-chronicle-vtt.sceneOverrides.gridStyle.lineType">
        <option value="solid" {{#if (eq gridStyle.lineType "solid")}}selected{{/if}}>{{localize "HEXCHRON.GridLineTypeSolid"}}</option>
        <option value="dashed" {{#if (eq gridStyle.lineType "dashed")}}selected{{/if}}>{{localize "HEXCHRON.GridLineTypeDashed"}}</option>
        <option value="dotted" {{#if (eq gridStyle.lineType "dotted")}}selected{{/if}}>{{localize "HEXCHRON.GridLineTypeDotted"}}</option>
        <option value="none" {{#if (eq gridStyle.lineType "none")}}selected{{/if}}>{{localize "HEXCHRON.GridLineTypeNone"}}</option>
      </select>
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.SettingGridColor"}}</label>
    <div class="form-fields">
      <input type="color" name="flags.hex-chronicle-vtt.sceneOverrides.gridStyle.color" value="{{gridStyle.color}}" />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.SettingGridWidth"}}</label>
    <div class="form-fields">
      <input type="number" name="flags.hex-chronicle-vtt.sceneOverrides.gridStyle.width" value="{{gridStyle.width}}" min="1" step="1" data-dtype="Number" />
    </div>
  </div>
  <div class="form-group">
    <label>{{localize "HEXCHRON.SettingGridOpacity"}}</label>
    <div class="form-fields">
      <input type="number" name="flags.hex-chronicle-vtt.sceneOverrides.gridStyle.opacity" value="{{gridStyle.opacity}}" min="0" max="1" step="0.05" data-dtype="Number" />
    </div>
  </div>
</fieldset>
```

`{{eq}}` is not a built-in Foundry Handlebars helper, so it needs registering. Add this to `scripts/scene-config.js` (not inside the render function - at module scope, so it only runs once):

```js
Handlebars.registerHelper("eq", (a, b) => a === b);
```

Place it right after the existing imports at the top of `scripts/scene-config.js`, before `const TAB_NAME = "hexChronicle";`.

- [ ] **Step 4: Add `gridStyle` to the context in `scene-config.js`**

In the `context` object (same one extended in Task 7), add a `gridStyle` entry after `tools`:

```js
    tools: Object.fromEntries(
      ["edit", "reveal", "revealStructure", "open", "align", "import", "resetFog", "overview", "legend"].map((name) => [
        name,
        overrides.tools?.[name] ?? true,
      ])
    ),
    gridStyle: {
      override: !!overrides.gridStyle?.override,
      lineType: overrides.gridStyle?.lineType ?? "solid",
      color: overrides.gridStyle?.color ?? "#707070",
      width: overrides.gridStyle?.width ?? "",
      opacity: overrides.gridStyle?.opacity ?? 0.6,
    },
  };
```

- [ ] **Step 5: Add the lang keys**

In `lang/en.json`, add after `"SceneOverrideTools"`:

```json
    "SceneOverrideTools": "Toolbar tools visible on this scene",
    "SceneOverrideGridStyle": "Grid line style",
    "SettingGridLineType": "Grid line type",
    "SettingGridColor": "Grid line color",
    "SettingGridWidth": "Grid line width (px)",
    "SettingGridOpacity": "Grid line opacity",
    "GridLineTypeSolid": "Solid",
    "GridLineTypeDashed": "Dashed",
    "GridLineTypeDotted": "Dotted",
    "GridLineTypeNone": "None"
```

- [ ] **Step 6: Syntax-check and validate JSON**

Run: `node --check scripts/settings.js && node --check scripts/render.js && node --check scripts/scene-config.js`
Expected: no output (success).

Run: `python3 -c "import json; json.load(open('lang/en.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add scripts/settings.js scripts/render.js scripts/scene-config.js templates/scene-config-tab.hbs lang/en.json
git commit -m "Add per-scene grid line style (type/color/width/opacity) to the Scene Config tab"
```

---

## Task 9: Scene tab — standalone zone visibility toggle

**Files:**
- Modify: `scripts/settings.js`
- Modify: `scripts/render.js`
- Modify: `scripts/scene-config.js`
- Modify: `templates/scene-config-tab.hbs`
- Modify: `README.md`

**Interfaces:**
- Produces: `isZoneVisibleToPlayers(scene?: Scene): boolean` from `settings.js`, consumed by `render.js#renderHexes`.

- [ ] **Step 1: Add `isZoneVisibleToPlayers()` to `settings.js`**

Add after `getGridStyle()`:

```js
/** Standalone per-scene toggle for showing zone boundaries to players -
 * deliberately NOT tied to structure-reveal or any other fog state (a
 * scene either always shows zone outlines to players or never does, no
 * per-hex granularity). Default false matches the module's previous
 * GM-only behavior. */
export function isZoneVisibleToPlayers(scene = canvas.scene) {
  return getSceneOverrides(scene).zonesVisibleToPlayers ?? false;
}
```

- [ ] **Step 2: Gate `drawZones()` on it in `render.js`**

Extend the settings import:

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber, getGridStyle } from "./settings.js";
```

to:

```js
import { MODULE_ID, getRadius, getOrigin, getPaletteOverride, toColorNumber, getGridStyle, isZoneVisibleToPlayers } from "./settings.js";
```

Replace:

```js
  if (isGM) {
    drawZones(zonesLayer, hexes, radius, origin, scene);
  }
```

with:

```js
  if (isGM || isZoneVisibleToPlayers(scene)) {
    drawZones(zonesLayer, hexes, radius, origin, scene);
  }
```

- [ ] **Step 3: Add the checkbox to `templates/scene-config-tab.hbs`**

Append after the "Grid line style" fieldset added in Task 8, as a standalone field (not inside any fieldset - matches the top-level "Enable Hex Chronicle on this scene" checkbox already at the top of the file):

```hbs

<div class="form-group">
  <label>{{localize "HEXCHRON.SceneZonesVisibleToPlayers"}}</label>
  <div class="form-fields">
    <input type="checkbox" name="flags.hex-chronicle-vtt.sceneOverrides.zonesVisibleToPlayers" {{checked zonesVisibleToPlayers}} />
  </div>
  <p class="hint">{{localize "HEXCHRON.SceneZonesVisibleToPlayersHint"}}</p>
</div>
```

- [ ] **Step 4: Add `zonesVisibleToPlayers` to the context in `scene-config.js`**

In the `context` object, add after `gridStyle`:

```js
    gridStyle: {
      override: !!overrides.gridStyle?.override,
      lineType: overrides.gridStyle?.lineType ?? "solid",
      color: overrides.gridStyle?.color ?? "#707070",
      width: overrides.gridStyle?.width ?? "",
      opacity: overrides.gridStyle?.opacity ?? 0.6,
    },
    zonesVisibleToPlayers: !!overrides.zonesVisibleToPlayers,
  };
```

- [ ] **Step 5: Add the lang keys**

In `lang/en.json`, add after the grid-style keys from Task 8:

```json
    "GridLineTypeNone": "None",
    "SceneZonesVisibleToPlayers": "Show zone outlines to players",
    "SceneZonesVisibleToPlayersHint": "Independent of structure reveal - when on, any player sees a hex's dashed zone outline as soon as the zone is drawn at all, on this scene only."
```

- [ ] **Step 6: Update the README's zone-visibility limitation note**

In `README.md`'s "Fine-grained terrain zones" section, change:

```markdown
The original 7-token vocabulary (`N`/`NE`/`SE`/`S`/`SW`/`NW`/`C`) from the
Python tool still works everywhere - typed into the text fallback, in
imported files, in old saved hexes - and is expanded to its fine
equivalent automatically every time it's read. Nothing needs migrating;
a hex only starts storing the new tokens once it's next saved.
```

to (same text, plus one new paragraph appended after it):

```markdown
The original 7-token vocabulary (`N`/`NE`/`SE`/`S`/`SW`/`NW`/`C`) from the
Python tool still works everywhere - typed into the text fallback, in
imported files, in old saved hexes - and is expanded to its fine
equivalent automatically every time it's read. Nothing needs migrating;
a hex only starts storing the new tokens once it's next saved.

Zone boundaries (the dashed outlines drawn around a cluster of hexes
sharing a zone tag) are GM-only by default, same as the map's own zones
list - a scene's Hex Chronicle Scene Config tab has a standalone "Show
zone outlines to players" toggle if you want players to see them anyway,
independent of structure reveal or terrain fog.
```

- [ ] **Step 7: Syntax-check and validate JSON**

Run: `node --check scripts/settings.js && node --check scripts/render.js && node --check scripts/scene-config.js`
Expected: no output (success).

Run: `python3 -c "import json; json.load(open('lang/en.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add scripts/settings.js scripts/render.js scripts/scene-config.js templates/scene-config-tab.hbs lang/en.json README.md
git commit -m "Add standalone per-scene zone-visibility-to-players toggle"
```

---

## Task 10: Documentation and manual verification checklist

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update README's "Per-scene settings" section**

In `README.md`, change:

```markdown
- Per-scene overrides for grid position/size, auto-reveal, and the color
  palette, each behind its own "Override for this scene" checkbox - left
  unchecked, that scene just uses the world-level setting above. The
  **Align Grid** canvas tool (see "Usage" above) writes directly into this
  scene's grid override when dragged, rather than the world setting - it's
  always dragged against one specific scene's background art, so writing
  world-wide would silently misalign every other scene using the same grid
  numbers.

## Verifying this build
```

to:

```markdown
- Per-scene overrides for grid position/size, auto-reveal, and the color
  palette, each behind its own "Override for this scene" checkbox - left
  unchecked, that scene just uses the world-level setting above. The
  **Align Grid** canvas tool (see "Usage" above) writes directly into this
  scene's grid override when dragged, rather than the world setting - it's
  always dragged against one specific scene's background art, so writing
  world-wide would silently misalign every other scene using the same grid
  numbers.
- Per-scene control over which toolbar tools are available (e.g. lock out
  "Edit Hex" on a scene whose map is finished, without hiding the rest of
  the toolbar).
- Grid line style: solid, dashed, dotted, or no line at all, plus its
  color/width/opacity - independent of the grid's position/size above.
- A standalone "Show zone outlines to players" toggle - unlike the grid and
  auto-reveal overrides, this isn't gated by anything else (structure
  reveal, terrain fog); a scene either shows zone outlines to players or it
  doesn't.

Custom biomes (terrain types) and structures (building icons), beyond the
module's built-in set, are managed world-wide from **Manage Biomes &
Structures** - a menu button in Foundry's "Configure Settings" (this
module's section), not part of the per-scene tab above, since a custom
biome/structure is available to every scene once defined. A biome is a
name + a color; a structure is a name + an image (chosen via Foundry's
file picker) - once added, both show up everywhere their built-in
counterparts already do: the hex editor's terrain dropdown and
mixed-terrain brush, the building-icon picker, the map render, and the
color palette.

## Verifying this build
```

- [ ] **Step 2: Add manual verification steps**

In `README.md`'s "Verifying this build" numbered list (currently ends at item 18, from the previous session's per-scene-settings work), add:

```markdown
19. On the Scene Config tab, uncheck a couple of tools (e.g. "Edit Hex" and
    "Hex Overview") and confirm exactly those buttons disappear from the
    toolbar for both GM and player, while the rest of the group stays.
20. Set the grid line type to each of Solid/Dashed/Dotted/None in turn,
    saving between each, and confirm the map's hex outlines actually change
    shape (a visible dash pattern for Dashed, a finer dotted pattern for
    Dotted, nothing drawn for None but hexes still clickable/hoverable) -
    then confirm a custom color/width/opacity applies too.
21. Turn on "Show zone outlines to players" on a scene with an authored
    zone, and confirm a connected player sees the dashed outline
    immediately (no structure-reveal needed) - turn it back off and confirm
    it disappears for the player again while the GM still sees it either
    way.
22. Open "Manage Biomes & Structures" from Configure Settings, add a custom
    biome (name + color) and a custom structure (name + an image via
    "Choose Image"), and confirm both appear in: the hex editor's terrain
    dropdown, the mixed-terrain brush palette (biome only), the building
    icon picker (structure only), and - once painted onto a hex and
    saved - the actual map render and the on-screen legend. Then remove
    both from the manager and confirm the already-painted hex falls back
    gracefully (unknown-terrain color / no icon, no crash) instead of
    breaking the render.
```

- [ ] **Step 3: Add a ROADMAP entry**

In `ROADMAP.md`, add a new dated section (in Portuguese, matching every other entry in this file) right before the existing "Configuração por cena..." section header (so the newest work stays at the top of that run of entries, immediately after the "Hex Overview" section and before the per-scene-config entry from the previous session):

```markdown
### Ampliação da aba de cena + registros de biomas/estruturas customizados - pendente de teste ao vivo
Continuação da aba "Hex Chronicle" na Scene Configuration (ver seção
seguinte): três novos overrides por cena e um subsistema novo de mundo
inteiro.
- **Controle por ferramenta**: cada ferramenta da toolbar (Editar, Revelar
  Terreno, Revelar Estrutura, Abrir Link, Align Grid, Import, Reset Fog,
  Overview, Legend) ganhou seu próprio checkbox de visibilidade por cena
  (`sceneOverrides.tools.<nome>`, `settings.js#isToolVisibleOnScene`).
- **Estilo de linha da grade**: tipo (sólida/tracejada/pontilhada/nenhuma),
  cor, espessura e opacidade, configuráveis por cena
  (`sceneOverrides.gridStyle`, `settings.js#getGridStyle`,
  `render.js#drawGrid` reescrito pra ramificar por tipo, reaproveitando o
  mesmo traço segmentado que os contornos de zona já usavam).
- **Zonas visíveis a jogadores**: toggle independente, não amarrado à
  revelação de estrutura (`sceneOverrides.zonesVisibleToPlayers`,
  `settings.js#isZoneVisibleToPlayers`) - confirmado explicitamente que são
  "duas coisas diferentes" durante o brainstorm desta feature.
- **Biomas e estruturas customizados** (`scripts/custom-registry.js`,
  `scripts/biome-structure-manager.js`): dois world settings `config:false`
  (`customBiomes`, `customStructures`), cada entrada só nome + cor (bioma)
  ou nome + imagem via `FilePicker` (estrutura), slug derivado
  automaticamente do nome. Gerenciados por uma janela própria
  (`BiomeStructureManager`) atrás de um `game.settings.registerMenu` em
  Configure Settings - mundo inteiro, não por cena, já que um bioma/
  estrutura definido vale pra qualquer cena. Integrado em todo lugar que
  antes só conhecia a lista fixa: `data-model.js#getAllTerrainTypes()`
  (dropdown de terreno + pincel de terreno misto), `render.js#palette()`
  (cores), `data-model.js#resolveIcon()`/`render.js#getIconTexture()`
  (resolução do ícone customizado via prefixo `custom:<slug>`, path
  completo do `FilePicker` em vez da convenção `assets/icons/building/`
  do módulo), `hex-icon-picker.js` (grade de ícones). Remover uma entrada
  customizada não migra os hexes que já a referenciam - cai na mesma
  tolerância de "tipo/ícone desconhecido" que um typo já tinha antes.
- **Não testado ao vivo ainda** (mesma limitação já registrada na seção
  seguinte) - ver os itens 19-22 do "Verifying this build" do README antes
  de considerar pronto.
```

- [ ] **Step 4: Syntax-check nothing broke (JSON/README are prose, but confirm no stray unclosed code fences)**

Run: `git diff --stat`
Expected: shows `README.md` and `ROADMAP.md` as the only two files changed in this task.

- [ ] **Step 5: Commit**

```bash
git add README.md ROADMAP.md
git commit -m "Document the scene tab expansion and custom biome/structure registries"
```

---

## Final check across all tasks

- [ ] Run every JS file's syntax check together as a final sanity pass:

```bash
for f in scripts/custom-registry.js scripts/data-model.js scripts/hex-editor.js scripts/hex-diagram.js scripts/settings.js scripts/render.js scripts/hex-icon-picker.js scripts/biome-structure-manager.js scripts/init.js scripts/scene-config.js; do
  node --check "$f" || echo "FAILED: $f"
done
```

Expected: no "FAILED" lines.

- [ ] Confirm `lang/en.json` is still valid JSON:

```bash
python3 -c "import json; json.load(open('lang/en.json'))" && echo OK
```

Expected: `OK`
