# Scene Config tab expansion + custom biome/structure registries — design spec

Status: approved for planning
Date: 2026-08-23

## Problem

The "Hex Chronicle" Scene Config tab (`scripts/scene-config.js`,
`templates/scene-config-tab.hbs`, added earlier this session) currently
covers: whole-module enable/disable per scene, and per-scene overrides for
grid position/size, auto-reveal, and color palette. The user wants five more
things:

- **A.** Per-scene control over which toolbar tools are available.
- **B.** Per-scene grid *line style* (type/color/width/opacity), not just
  the position/size the tab already has.
- **C.** A standalone per-scene toggle for showing zone boundaries to
  players — independent of the existing structure-reveal fog, not gated by
  it.
- **D.** GM-authored custom **biomes** (terrain types) beyond the 11 built
  into `data-model.js`/`render.js`.
- **E.** GM-authored custom **structures** (building icons) beyond the 14
  bundled under `assets/icons/building/`.

A/B/C are extensions of the existing scene tab (scene-scoped). D/E are a new
world-scoped subsystem: a registry of GM-defined entities, referenced by key
from any scene, managed from one place rather than re-declared per scene.

## Scope

In scope: the scene tab additions (A/B/C), the two world settings backing
D/E, a new management window for D/E reachable from a settings menu, and
every render/editor integration point that needs to consult the custom
registries (palette, terrain `<select>`, terrain-brush swatches, icon
picker, icon texture resolution).

Out of scope: per-scene biome/structure registries (confirmed world-scoped
only); extra fields on a biome/structure beyond name + color / name + icon;
migrating or renaming the 11 built-in biomes or 14 built-in structures;
letting a custom biome/structure be deleted while silently rewriting hexes
that reference it (a removed key just falls back to the existing "unknown
type"/"broken icon" tolerance the renderer already has - no new migration
logic needed, matches how a typo'd terrain type is already handled today).

## A. Per-scene tool visibility

New fieldset in `scene-config-tab.hbs`: one checkbox per toolbar tool
(`edit`, `reveal`, `revealStructure`, `open`, `align`, `import`, `resetFog`,
`overview`, `legend`), named
`flags.hex-chronicle-vtt.sceneOverrides.tools.<name>`. Default (flag absent)
is visible - matches current behavior for every existing scene.

`settings.js`: new `isToolVisibleOnScene(name, scene = canvas.scene)`:
```js
export function isToolVisibleOnScene(name, scene = canvas.scene) {
  const tools = getSceneOverrides(scene).tools;
  return tools?.[name] ?? true;
}
```

`init.js`'s `getSceneControlButtons` hook: each tool's existing `visible`
(today either `true`/omitted or `game.user.isGM`) becomes
`<existing expression> && isToolVisibleOnScene("<name>")`. The whole-group
`visible: isModuleEnabledOnScene(canvas.scene)` gate is unaffected - a
disabled module still hides everything regardless of per-tool flags.

## B. Grid line style

New fieldset "Grid line style" in the scene tab: override checkbox +
`lineType` (`<select>`: Solid/Dashed/Dotted/None) + `color` (native
`<input type="color">`) + `width` (number, px) + `opacity` (number 0-1).
Flags under `sceneOverrides.gridStyle.{override,lineType,color,width,opacity}`.

`settings.js`: new `getGridStyle(scene = canvas.scene)` returning
`{ lineType, color, width, opacity }`, falling back to the current
hardcoded values (`GRID_COLOR = 0x707070`, width `radius/20`, opacity
`0.6`, lineType `"solid"`) when not overridden - these hardcoded constants
move from `render.js` into this function as the default return value.

`render.js#drawGrid(graphics, col, row, radius, origin, scene)`:
```js
function drawGrid(graphics, col, row, radius, origin, scene) {
  const style = getGridStyle(scene);
  if (style.lineType === "none") return;
  const pts = hexShapePoints(col, row, radius, origin);
  const width = Math.max(1, style.width ?? radius / 20);
  const color = style.color ?? GRID_COLOR_DEFAULT;
  const alpha = style.opacity ?? 0.6;
  if (style.lineType === "solid") {
    graphics.lineStyle(width, color, alpha);
    graphics.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
    return;
  }
  // dashed/dotted: closed loop (repeat first point), reuse the same
  // segmented-stroke technique drawZones()/strokeDashedPolyline() already
  // use for zone boundaries - dashed uses a longer dash/gap, dotted a
  // short dash with a relatively larger gap so it reads as dots not dashes.
  const [dash, gap] = style.lineType === "dotted" ? [Math.max(1, width), width * 3] : [width * 4, width * 3];
  strokeDashedPolyline(graphics, [...pts, pts[0]], { color, width, dash, gap, alpha });
}
```
`strokeDashedPolyline` gains an optional `alpha` param (defaults to `1`,
its current implicit behavior) so this call site can pass the configured
opacity - the zone-boundary call site is unaffected since it doesn't pass
one.

`renderHexes()` passes `scene` down to `drawGrid` (it already has it).

## C. Zone visibility to players (standalone)

New checkbox in the scene tab, its own field (not nested under any other
fieldset): `flags.hex-chronicle-vtt.sceneOverrides.zonesVisibleToPlayers`
(boolean, default false - current GM-only behavior).

`settings.js`: `isZoneVisibleToPlayers(scene = canvas.scene)` → the raw
flag value (`?? false`).

`render.js#renderHexes`: `if (isGM) drawZones(...)` becomes
`if (isGM || isZoneVisibleToPlayers(scene)) drawZones(zonesLayer, hexes, radius, origin, scene)`.
This is deliberately **not** gated by structure-reveal or any other fog
state, per explicit confirmation - a scene either always shows zone
outlines to players or never does, with no per-hex granularity. Update the
README's "Limitações conhecidas" bullet about zones being GM-only to note
the new opt-in.

## D/E. Custom biome & structure registries

New world settings, both `scope: "world"`, `config: false` (managed by
their own window, not the generic settings list), `type: Object`,
`default: {}`:
- `customBiomes`: `{ [slug]: { name, color } }` — `color` a `"#rrggbb"` string.
- `customStructures`: `{ [slug]: { name, path } }` — `path` a Foundry
  Data-relative path (or full URL) chosen via `FilePicker`, used as-is (not
  prefixed with the module's own asset folder).

New file `scripts/custom-registry.js`:
```js
export function registerCustomRegistrySettings() { /* the two game.settings.register() calls above, plus a game.settings.registerMenu(...) opening BiomeStructureManager */ }
export function getCustomBiomes() { return game.settings.get(MODULE_ID, "customBiomes"); }
export function getCustomStructures() { return game.settings.get(MODULE_ID, "customStructures"); }
export function slugify(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
export async function addCustomBiome(name, color) { /* slugify, reject collision with TERRAIN_TYPES or existing key, setFlag-style game.settings.set with the merged object, return the slug or throw */ }
export async function removeCustomBiome(slug) { /* delete key, settings.set */ }
export async function addCustomStructure(name, path) { /* same shape, collision-checked against hex-icon-picker.js's BUILDING_ICONS list (add `export` to that const so it can be imported here instead of re-declared) */ }
export async function removeCustomStructure(slug) { /* same shape */ }
```
Collision/validation errors surface via `ui.notifications.warn(...)`
in the manager UI, not by throwing into the console silently - the add
action just no-ops with a warning toast on a bad name/duplicate.

### Integration points

`data-model.js`: new `getAllTerrainTypes()`:
```js
export function getAllTerrainTypes() {
  return [...TERRAIN_TYPES, ...Object.keys(getCustomBiomes())];
}
```
(imports `getCustomBiomes` from `custom-registry.js`). Replaces the bare
`TERRAIN_TYPES` import in `hex-editor.js` (terrain `<select>` options) and
`hex-diagram.js` (terrain-brush swatch palette) - both already re-derive
their option list at render/attach time, so no caching problem.

`render.js#palette(scene)`: merges custom biome colors in between the
hardcoded defaults and the existing scene/world palette override (highest
priority), so a scene's palette override can still repaint a custom biome's
default color:
```js
export function palette(scene = canvas.scene) {
  const custom = Object.fromEntries(Object.entries(getCustomBiomes()).map(([k, v]) => [k, toColorNumber(v.color)]));
  const override = getPaletteOverride(scene);
  return {
    terrain: { ...DEFAULT_TERRAIN_COLORS, ...custom, ...(override.terrain ?? {}) },
    zone: { ...DEFAULT_ZONE_COLORS, ...(override.zone ?? {}) },
  };
}
```
(`toColorNumber` already exists in `settings.js` but is currently private -
add `export` to its declaration so `render.js` can reuse it here instead of
duplicating the `#rrggbb`-to-number logic.)

`data-model.js#resolveIcon(content)`: an explicit `content.icon` now
resolves through the custom registry first:
```js
export function resolveIcon(content) {
  if (content.icon) {
    return getCustomStructures()[content.icon] ? `custom:${content.icon}` : `building/${content.icon}`;
  }
  ...unchanged terrain-icon fallback...
}
```

`render.js#getIconTexture(iconPath)`: branches on the `custom:` prefix
before building the module-relative URL:
```js
async function getIconTexture(iconPath) {
  if (textureCache.has(iconPath)) return textureCache.get(iconPath);
  const url = iconPath.startsWith("custom:")
    ? getCustomStructures()[iconPath.slice(7)]?.path
    : `modules/${MODULE_ID}/assets/icons/${iconPath}.svg`;
  if (!url) { textureCache.set(iconPath, null); return null; } // registry entry deleted since the hex was authored - same "missing icon" tolerance as a bad filename today
  ...unchanged load/validate/cache logic...
}
```

`hex-icon-picker.js`: after the built-in `BUILDING_ICONS` swatches, append
one swatch per `getCustomStructures()` entry, `img.src` set directly to its
stored `path` (no module-folder prefix) and `input.value` set to its slug
on click - same click handler shape as a built-in swatch.

### Manager window

New `scripts/biome-structure-manager.js` (`BiomeStructureManager`, GM-only
ApplicationV2 + `HandlebarsApplicationMixin`, opened via
`game.settings.registerMenu(MODULE_ID, "manageBiomesStructures", { type: BiomeStructureManager, restricted: true, ... })`)
and `templates/biome-structure-manager.hbs`. Two plain sections (not tabs -
both fit on screen together, unlike Scene Config's many core tabs):

- **Biomes**: existing custom entries as rows (color swatch, name, slug,
  delete button) + an "add" row (`<input type="color">`, name text input,
  add button). Same "write immediately, no form-wide Save" pattern as Hex
  Overview's bulk actions - each add/delete is its own `game.settings.set`
  call, then `this.render()`.
- **Structures**: same row shape, but "Choose Image" opens
  `foundry.applications.apps.FilePicker.implementation` (fallback
  `globalThis.FilePicker`, matching this codebase's existing
  optional-chaining convention for other v13-relocated APIs) with
  `type: "image"` and a callback that fills a hidden path field + a live
  `<img>` preview before the row's own add button is clicked.

Built-in biomes/structures are display-only reference lists underneath each
section (name + swatch/icon, no delete button) so a GM can see what's
already taken without cross-referencing the README.

## Testing

No automated harness (per README's existing convention) - manual
verification steps get appended to README's "Verifying this build" list
covering: per-scene tool hiding, each grid line type rendering distinctly,
the zone-visibility toggle working independent of structure reveal, adding
then using a custom biome (select dropdown, brush palette, palette colors,
legend), and adding then using a custom structure (icon picker, map
render, a removed structure falling back gracefully instead of crashing).
