# Hex Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain "Hex Directory" GM window with a "Hex Overview" dashboard — aggregate stats, combinable filters, inline quick-edit, and batched bulk actions — plus a new GM-only `notes` field per hex.

**Architecture:** Same `HandlebarsApplicationMixin(ApplicationV2)` shape the module already uses (`HexEditor`, `HexDirectory`). New pure-data helpers land in the existing `data-model.js`/`fog.js` modules (batched single-`setFlag` writes, mirroring `fog.js`'s existing `revealArea()`); the new app (`hex-overview.js`) is UI/state only and calls those helpers. The old `HexDirectory` is deleted outright, not kept alongside.

**Tech Stack:** Vanilla JS ESM, FoundryVTT v13/v14 `ApplicationV2`/Handlebars, no build step, no test runner (this module is verified manually in a live Foundry world — see README "Verifying this build").

**Spec:** `docs/superpowers/specs/2026-08-23-hex-overview-design.md`

## Global Constraints

- No automated test harness exists for this module — every task's verification is a manual check in a live Foundry v13/v14 world, run from the browser console and/or the UI, matching the existing README checklist style. Do not invent a test runner.
- All bulk/multi-hex writes must be a single `scene.setFlag()` call, not one call per hex (existing pattern: `fog.js`'s `revealArea()`).
- `notes` is GM-only content: never read by `render.js`, `fog.js`'s `getEffectiveContent()`/`stripStructure()`, or any player-facing surface.
- New localization keys go in `lang/en.json` under the `HEXCHRON` namespace; follow the existing naming style (`Overview*`, `Field*`, `Section*`).
- Follow existing code style: no comments explaining *what*, only non-obvious *why* (see any existing file for tone).
- The `directory` toolbar button slot is reused, not duplicated — one button, now opening `HexOverview`.

---

### Task 1: `notes` field + `applyHexPatches` bulk-merge helper in `data-model.js`

**Files:**
- Modify: `scripts/data-model.js:83-85` (`emptyHex`), `scripts/data-model.js:123-149` (`normalizeHexContent`), append new export after `parseHexKey` (currently ends at line 177)
- Test: manual, via browser console in a running world (see Step 3)

**Interfaces:**
- Produces: `emptyHex()` now includes `notes: ""`; `normalizeHexContent(raw)` now reads/trims `raw.notes` into `out.notes`; new `applyHexPatches(scene, patches)` where `patches: Array<{ col: number, row: number, patch: object }>`, returns the `Promise` from `scene.setFlag(MODULE_ID, "hexes", merged)`.

- [ ] **Step 1: Add `notes` to the schema**

In `scripts/data-model.js`, change `emptyHex()`:

```js
export function emptyHex() {
  return { terrain: { type: undefined, mixed: [] }, alt: "", icon: "", roads: [], rivers: [], zone: [], link: "", notes: "" };
}
```

In `normalizeHexContent()`, right after the existing `alt`/`icon` block:

```js
  if (typeof raw.alt === "string" && raw.alt.trim()) out.alt = raw.alt.trim();
  if (typeof raw.icon === "string" && raw.icon.trim()) out.icon = raw.icon.trim();
  if (typeof raw.notes === "string" && raw.notes.trim()) out.notes = raw.notes.trim();
```

Also update the schema comment block at the top of the file (lines 9-17) to add `notes: "Some longer GM-only text",` to the example shape, and the field-list note that it's "GM-only, never gated/stripped since nothing player-facing reads it."

- [ ] **Step 2: Add `applyHexPatches`**

Append to `scripts/data-model.js`, after `parseHexKey`/`hexKey`:

```js
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
```

This needs `MODULE_ID` in scope — add the import at the top of `scripts/data-model.js`:

```js
import { MODULE_ID } from "./settings.js";
```

(Check first: `data-model.js` currently only imports from `./geometry.js` — confirm `settings.js` doesn't import back from `data-model.js`, which would create a cycle. It doesn't: `settings.js` only defines `MODULE_ID` and setting getters, no import of `data-model.js`.)

- [ ] **Step 3: Manual verification**

Load the module in a live Foundry v13/v14 world (enable it on a test world if not already), open the browser console on a scene with at least one authored hex, and run:

```js
const { normalizeHexContent, emptyHex, applyHexPatches, hexKey } = await import("/modules/hex-chronicle-vtt/scripts/data-model.js");
console.log(emptyHex()); // expect notes: "" present
console.log(normalizeHexContent({ notes: "  test note  " })); // expect notes: "test note" (trimmed)
await applyHexPatches(canvas.scene, [{ col: 0, row: 0, patch: { notes: "console test" } }]);
console.log(canvas.scene.getFlag("hex-chronicle-vtt", "hexes")["0,0"].notes); // expect "console test"
```

Confirm all three log lines match the comments, then manually remove the test note (open Hex `0,0` in the existing editor once Task 3 lands, or re-run `applyHexPatches` with `{ notes: "" }`) so it doesn't linger as test data — for now, just confirm the flag round-trips correctly.

- [ ] **Step 4: Commit**

```bash
git add scripts/data-model.js
git commit -m "Add notes field and applyHexPatches bulk-merge helper to the hex data model"
```

---

### Task 2: Bulk fog helpers `setExploredMany`/`setStructureRevealedMany` in `fog.js`

**Files:**
- Modify: `scripts/fog.js` (add two exports after `toggleHex`/`toggleStructure` respectively)

**Interfaces:**
- Consumes: `getExploredMap`, `getStructureRevealedMap`, `hexKey` (all already in `fog.js`/imported).
- Produces: `setExploredMany(cells, value, scene = canvas.scene)` and `setStructureRevealedMany(cells, value, scene = canvas.scene)`, both `cells: Array<[col, row]>`, `value: boolean`, returning the `scene.setFlag` promise.

- [ ] **Step 1: Add `setExploredMany`**

In `scripts/fog.js`, right after `toggleHex` (currently ending at line 50):

```js
/** Sets the same explored value for several hexes in one write - the Hex
 * Overview's bulk "Reveal/Hide Terrain" actions use this instead of one
 * toggleHex()/setFlag() per selected row. */
export async function setExploredMany(cells, value, scene = canvas.scene) {
  const current = getExploredMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = value;
  return scene.setFlag(MODULE_ID, "explored", merged);
}
```

- [ ] **Step 2: Add `setStructureRevealedMany`**

Right after `setStructureRevealed` (currently ending at line 99):

```js
/** Bulk counterpart to setStructureRevealed(), same one-write shape as
 * setExploredMany() above. */
export async function setStructureRevealedMany(cells, value, scene = canvas.scene) {
  const current = getStructureRevealedMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = !!value;
  return scene.setFlag(MODULE_ID, "structuresRevealed", merged);
}
```

- [ ] **Step 3: Manual verification**

In the browser console, on a scene with at least 2 authored hexes (e.g. `0,0` and `1,0`):

```js
const { setExploredMany, setStructureRevealedMany, isExplored, isStructureRevealed } = await import("/modules/hex-chronicle-vtt/scripts/fog.js");
await setExploredMany([[0,0],[1,0]], true);
console.log(isExplored(0,0), isExplored(1,0)); // expect true true
await setStructureRevealedMany([[0,0],[1,0]], true);
console.log(isStructureRevealed(0,0), isStructureRevealed(1,0)); // expect true true
await setExploredMany([[0,0],[1,0]], false);
await setStructureRevealedMany([[0,0],[1,0]], false);
console.log(isExplored(0,0), isExplored(1,0), isStructureRevealed(0,0), isStructureRevealed(1,0)); // expect false false false false
```

Confirm the canvas visually reflects the reveal changes too (unexplored hexes render "unknown" if you're logged in as a non-GM test client, or just trust the flag state as GM).

- [ ] **Step 4: Commit**

```bash
git add scripts/fog.js
git commit -m "Add setExploredMany/setStructureRevealedMany bulk fog helpers"
```

---

### Task 3: "GM Notes" field in the Hex Editor

**Files:**
- Modify: `scripts/hex-editor.js:75-98` (`_prepareContext`), `scripts/hex-editor.js:138-160` (`#onSubmit`)
- Modify: `templates/hex-editor.hbs` (new fieldset)
- Modify: `lang/en.json` (new keys `SectionNotes`, `FieldNotes`)

**Interfaces:**
- Consumes: `content.notes` from `normalizeHexContent()` (Task 1).
- Produces: nothing new consumed by later tasks — this is a leaf UI addition. (`HexOverview`, added in Task 4+, reads `notes` from scene flags directly via `normalizeHexContent`, not from this editor.)

- [ ] **Step 1: Add the field to `_prepareContext`**

In `scripts/hex-editor.js`, inside the returned object of `_prepareContext` (after the `alt: content.alt,` line):

```js
      alt: content.alt,
      notes: content.notes,
```

- [ ] **Step 2: Add the field to `#onSubmit`**

In `scripts/hex-editor.js`, inside the `raw` object built in `#onSubmit` (after `alt: data.alt,`):

```js
      alt: data.alt,
      notes: data.notes,
```

- [ ] **Step 3: Add the template section**

In `templates/hex-editor.hbs`, insert a new `<fieldset>` after the "Zones & Links" fieldset (right before the `<footer class="form-footer">` line):

```handlebars
  <fieldset>
    <legend><i class="fa-solid fa-note-sticky"></i> {{localize "HEXCHRON.SectionNotes"}}</legend>

    <div class="form-group stacked">
      <label>{{localize "HEXCHRON.FieldNotes"}}</label>
      <textarea name="notes" rows="4">{{notes}}</textarea>
    </div>
  </fieldset>
```

- [ ] **Step 4: Add localization keys**

In `lang/en.json`, add after `"SectionZonesLinks": "Zones & Links",`:

```json
    "SectionNotes": "GM Notes",
    "FieldNotes": "Notes (GM-only, never shown to players)",
```

(Keep valid JSON — add a trailing comma after the existing `"SectionZonesLinks"` line since it's no longer the last item before `"OpenLink"`.)

- [ ] **Step 5: Manual verification**

In a live world as GM: open any hex with "Edit Hex", confirm a new "GM Notes" section with a textarea appears below "Zones & Links". Type a multi-line note, click Save, reopen the same hex's editor, confirm the note persisted. Log in as a non-GM player test client, confirm nothing about notes is visible anywhere (no player-facing UI shows it — there isn't one to check beyond "it doesn't appear").

- [ ] **Step 6: Commit**

```bash
git add scripts/hex-editor.js templates/hex-editor.hbs lang/en.json
git commit -m "Add GM-only notes field to the hex editor"
```

---

### Task 4: `HexOverview` skeleton — replaces `HexDirectory`, same feature set

Ports today's Hex Directory (search, coord/terrain/label columns, go-to/edit actions) onto the new class/template/CSS names, with no new features yet — this task's deliverable is "identical behavior, new skin, old file gone," which is independently verifiable before piling more features onto it in later tasks.

**Files:**
- Create: `scripts/hex-overview.js` (copy-then-rename of `scripts/hex-directory.js`)
- Create: `templates/hex-overview.hbs` (copy-then-rename of `templates/hex-directory.hbs`)
- Delete: `scripts/hex-directory.js`, `templates/hex-directory.hbs`
- Modify: `scripts/init.js` (swap import, singleton var, tool button)
- Modify: `lang/en.json` (rename `Directory*` keys to `Overview*`)
- Modify: `styles/hex-chronicle.css` (rename `.hc-directory*`/`.hex-chronicle-directory` to `.hc-overview*`/`.hex-chronicle-overview`)

**Interfaces:**
- Produces: `export class HexOverview extends HandlebarsApplicationMixin(ApplicationV2)`, `id: "hex-chronicle-overview"`, template `modules/${MODULE_ID}/templates/hex-overview.hbs`. Later tasks extend this class's `_prepareContext`/`_onRender` and the template — do not change its public shape (constructor takes no args, same as `HexDirectory` today).

- [ ] **Step 1: Create `scripts/hex-overview.js`**

Write the full file (adapted from today's `hex-directory.js`, renamed class/id/comments):

```js
/**
 * GM-only dashboard over every authored hex in the currently viewed scene:
 * aggregate stats, filters, and a searchable table to read/act on hex
 * content at a glance without hunting for it on the map - the map-scale
 * equivalent of a Journal/Actor sidebar tab, scoped to this module's own
 * data. Replaces the earlier plain "Hex Directory".
 *
 * Reads the *raw* (un-gated) hex content via data-model's
 * normalizeHexContent() directly, not fog.js's getEffectiveContent() -
 * this window is GM-only (see init.js's `visible: game.user.isGM` on the
 * toolbar button that opens it), so there is nothing to hide from its own
 * user.
 *
 * "Dynamic": the list re-renders itself on both a hex-data change in the
 * viewed scene (updateScene) and a scene switch (canvasReady), so it never
 * goes stale while left open - no manual refresh button needed.
 */
import { MODULE_ID, getRadius, getOrigin } from "./settings.js";
import { parseHexKey, normalizeHexContent } from "./data-model.js";
import { tileCenter } from "./geometry.js";
import { HexEditor } from "./hex-editor.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function coordLabel(col, row) {
  return `${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`;
}

export class HexOverview extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-overview",
    window: { title: "HEXCHRON.OverviewTitle", icon: "fa-solid fa-chart-simple", resizable: true, contentClasses: ["hex-chronicle-overview"] },
    position: { width: 560, height: 680 },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-overview.hbs`, scrollable: [".hc-overview-list"] },
  };

  #hooks = [];

  #onUpdateScene = (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) this.render();
  };

  #onCanvasReady = () => this.render();

  async _prepareContext() {
    const scene = canvas.scene;
    const raw = scene?.getFlag(MODULE_ID, "hexes") ?? {};
    const rows = Object.entries(raw)
      .map(([key, data]) => {
        const { col, row } = parseHexKey(key);
        const content = normalizeHexContent(data);
        const mixed = content.terrain.mixed.map((m) => m.type).join(", ");
        const search = [coordLabel(col, row), content.terrain.type, mixed, content.alt, content.icon, content.zone.join(" "), content.notes]
          .join(" ")
          .toLowerCase();
        return {
          col,
          row,
          coordLabel: coordLabel(col, row),
          terrain: content.terrain.type || "-",
          mixed,
          alt: content.alt,
          icon: content.icon,
          zone: content.zone.join(", "),
          hasLink: !!content.link,
          search,
        };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);
    return { rows, hasHexes: rows.length > 0, sceneName: scene?.name ?? "" };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hooks.push(["updateScene", Hooks.on("updateScene", this.#onUpdateScene)]);
    this.#hooks.push(["canvasReady", Hooks.on("canvasReady", this.#onCanvasReady)]);
  }

  async close(options) {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks = [];
    return super.close(options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    for (const btn of this.element.querySelectorAll('[data-action="goto"]')) {
      btn.addEventListener("click", () => this.#gotoHex(Number(btn.dataset.col), Number(btn.dataset.row)));
    }
    for (const btn of this.element.querySelectorAll('[data-action="edit"]')) {
      btn.addEventListener("click", () => new HexEditor({ col: Number(btn.dataset.col), row: Number(btn.dataset.row) }).render(true));
    }

    const search = this.element.querySelector('input[name="search"]');
    search?.addEventListener("input", () => this.#applyFilter(search.value));
    if (search?.value) this.#applyFilter(search.value);
  }

  #gotoHex(col, row) {
    const { x, y } = tileCenter(col, row, getRadius(), getOrigin());
    canvas.animatePan({ x, y, duration: 400 });
    canvas.hexChronicle?.flashHex(col, row);
  }

  #applyFilter(text) {
    const query = text.trim().toLowerCase();
    let visible = 0;
    for (const row of this.element.querySelectorAll(".hc-overview-row")) {
      const match = !query || (row.dataset.search ?? "").includes(query);
      row.hidden = !match;
      if (match) visible++;
    }
    const empty = this.element.querySelector(".hc-overview-no-matches");
    if (empty) empty.hidden = visible > 0;
  }
}
```

- [ ] **Step 2: Create `templates/hex-overview.hbs`**

```handlebars
<div class="hc-overview">
  <header class="hc-overview-header">
    <input type="search" name="search" placeholder="{{localize 'HEXCHRON.OverviewSearchPlaceholder'}}" />
    <span class="hc-overview-count">{{rows.length}} {{localize "HEXCHRON.OverviewHexCount"}}</span>
  </header>

  {{#if hasHexes}}
  <div class="hc-overview-list">
    <table>
      <thead>
        <tr>
          <th class="hc-overview-col-coord">{{localize "HEXCHRON.OverviewColCoord"}}</th>
          <th>{{localize "HEXCHRON.OverviewColTerrain"}}</th>
          <th>{{localize "HEXCHRON.OverviewColLabel"}}</th>
          <th class="hc-overview-col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {{#each rows}}
        <tr class="hc-overview-row" data-search="{{this.search}}">
          <td class="hc-overview-coord">{{this.coordLabel}}</td>
          <td>
            <span class="hc-overview-terrain">{{this.terrain}}</span>
            {{#if this.mixed}}<span class="hc-overview-mixed">({{this.mixed}})</span>{{/if}}
            {{#if this.zone}}<div class="hc-overview-zones">{{this.zone}}</div>{{/if}}
          </td>
          <td>
            {{#if this.alt}}<span class="hc-overview-alt">{{this.alt}}</span>{{/if}}
            {{#if this.icon}}<i class="fa-solid fa-tower-observation" data-tooltip="{{this.icon}}"></i>{{/if}}
            {{#if this.hasLink}}<i class="fa-solid fa-link" data-tooltip="{{localize 'HEXCHRON.FieldLink'}}"></i>{{/if}}
          </td>
          <td class="hc-overview-actions">
            <button type="button" data-action="goto" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{localize 'HEXCHRON.OverviewGoto'}}">
              <i class="fa-solid fa-crosshairs"></i>
            </button>
            <button type="button" data-action="edit" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{localize 'HEXCHRON.ToolEdit'}}">
              <i class="fa-solid fa-pen"></i>
            </button>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    <p class="hc-overview-no-matches" hidden>{{localize "HEXCHRON.OverviewNoMatches"}}</p>
  </div>
  {{else}}
  <p class="hc-overview-empty">{{localize "HEXCHRON.OverviewEmpty"}}</p>
  {{/if}}
</div>
```

- [ ] **Step 3: Delete the old files**

```bash
git rm scripts/hex-directory.js templates/hex-directory.hbs
```

- [ ] **Step 4: Rewire `scripts/init.js`**

Change line 5 (`import { HexDirectory } from "./hex-directory.js";`) to:

```js
import { HexOverview } from "./hex-overview.js";
```

Change line 10 (`let hexDirectoryApp = null;`) to:

```js
let hexOverviewApp = null;
```

Change the `directory` tool block (lines 117-130) to:

```js
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
```

- [ ] **Step 5: Rename localization keys**

In `lang/en.json`, replace the `Directory*` block:

```json
    "ToolDirectory": "Hex Directory",
    "DirectoryTitle": "Hex Directory",
    "DirectorySearchPlaceholder": "Search coordinate, terrain, label, zone...",
    "DirectoryHexCount": "hexes",
    "DirectoryColCoord": "Hex",
    "DirectoryColTerrain": "Terrain",
    "DirectoryColLabel": "Label",
    "DirectoryGoto": "Go to hex",
    "DirectoryEmpty": "No hexes authored on this scene yet.",
    "DirectoryNoMatches": "No hexes match this search.",
```

with:

```json
    "ToolOverview": "Hex Overview",
    "OverviewTitle": "Hex Overview",
    "OverviewSearchPlaceholder": "Search coordinate, terrain, label, zone, notes...",
    "OverviewHexCount": "hexes",
    "OverviewColCoord": "Hex",
    "OverviewColTerrain": "Terrain",
    "OverviewColLabel": "Label",
    "OverviewGoto": "Go to hex",
    "OverviewEmpty": "No hexes authored on this scene yet.",
    "OverviewNoMatches": "No hexes match this search.",
```

- [ ] **Step 6: Rename CSS classes**

In `styles/hex-chronicle.css`, in the "Hex directory" block (lines 286-394), rename every `.hex-chronicle-directory`/`.hc-directory*` selector to `.hex-chronicle-overview`/`.hc-overview*` (mechanical rename, same rules, same values), and rename the section comment from `/* --- Hex directory --- */` to `/* --- Hex overview --- */`.

- [ ] **Step 7: Manual verification**

In a live world as GM: reload, confirm the old "Hex Directory" toolbar button is gone and a "Hex Overview" button (chart icon) is in the same slot. Click it, confirm the same table/search/go-to/edit behavior as before still works identically, and that editing a hex elsewhere still live-updates this window. Confirm no console errors on open/close/scene-switch.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Replace Hex Directory with Hex Overview (same behavior, new foundation)"
```

---

### Task 5: Stats bar + combinable filters

**Files:**
- Modify: `scripts/hex-overview.js` (`_prepareContext`, new `#filters` state, `_onRender`, new `#applyFilters`)
- Modify: `templates/hex-overview.hbs` (stats bar + filter controls)
- Modify: `lang/en.json` (new keys)
- Modify: `styles/hex-chronicle.css` (stats/filter bar rules)

**Interfaces:**
- Consumes: row shape from Task 4's `_prepareContext` (`col, row, coordLabel, terrain, mixed, alt, icon, zone, hasLink, search`), extended here with `terrainRaw` (lowercase, unlocalized terrain key, for filter matching — `content.terrain.type`), `zoneList` (`content.zone`, array), `hasNotes` (`!!content.notes`).
- Produces: `#filters` object on the instance (`{ text: string, terrain: string, zoneTag: string, hasNotes: "any"|"yes"|"no", hasLink: "any"|"yes"|"no" }`), a `#applyFilters()` method later tasks call to reapply state after any re-render (Task 6-9 all call this same method instead of the old `#applyFilter(text)`).

- [ ] **Step 1: Extend `_prepareContext` with stats and richer row fields**

In `scripts/hex-overview.js`, replace the `_prepareContext` body's row-mapping and return with:

```js
  async _prepareContext() {
    const scene = canvas.scene;
    const raw = scene?.getFlag(MODULE_ID, "hexes") ?? {};
    const rows = Object.entries(raw)
      .map(([key, data]) => {
        const { col, row } = parseHexKey(key);
        const content = normalizeHexContent(data);
        const mixed = content.terrain.mixed.map((m) => m.type).join(", ");
        const search = [coordLabel(col, row), content.terrain.type, mixed, content.alt, content.icon, content.zone.join(" "), content.notes]
          .join(" ")
          .toLowerCase();
        return {
          col,
          row,
          coordLabel: coordLabel(col, row),
          terrain: content.terrain.type || "-",
          terrainRaw: content.terrain.type || "",
          mixed,
          alt: content.alt,
          icon: content.icon,
          zone: content.zone.join(", "),
          zoneList: content.zone,
          zoneKey: content.zone.join("|"),
          hasLink: !!content.link,
          hasNotes: !!content.notes,
          search,
        };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);

    const terrainCounts = {};
    const zoneCounts = {};
    let withNotes = 0;
    let withLink = 0;
    let withIcon = 0;
    for (const r of rows) {
      if (r.terrainRaw) terrainCounts[r.terrainRaw] = (terrainCounts[r.terrainRaw] ?? 0) + 1;
      for (const z of r.zoneList) zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
      if (r.hasNotes) withNotes++;
      if (r.hasLink) withLink++;
      if (r.icon) withIcon++;
    }
    const stats = {
      total: rows.length,
      terrainCounts: Object.entries(terrainCounts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      withNotes,
      withLink,
      withIcon,
    };
    const terrainOptions = stats.terrainCounts.map((t) => t.type);
    const zoneOptions = Object.keys(zoneCounts).sort();

    return { rows, hasHexes: rows.length > 0, sceneName: scene?.name ?? "", stats, terrainOptions, zoneOptions };
  }
```

- [ ] **Step 2: Add filter state and replace the filter method**

In `scripts/hex-overview.js`, add a private field near `#hooks`:

```js
  #filters = { text: "", terrain: "", zoneTag: "", hasNotes: "any", hasLink: "any" };
```

Replace `#applyFilter(text)` entirely with:

```js
  #applyFilters() {
    const { text, terrain, zoneTag, hasNotes, hasLink } = this.#filters;
    const query = text.trim().toLowerCase();
    let visible = 0;
    for (const row of this.element.querySelectorAll(".hc-overview-row")) {
      const matchesText = !query || (row.dataset.search ?? "").includes(query);
      const matchesTerrain = !terrain || row.dataset.terrain === terrain;
      const matchesZone = !zoneTag || (row.dataset.zones ?? "").split("|").includes(zoneTag);
      const matchesNotes = hasNotes === "any" || (hasNotes === "yes") === (row.dataset.hasNotes === "true");
      const matchesLink = hasLink === "any" || (hasLink === "yes") === (row.dataset.hasLink === "true");
      const match = matchesText && matchesTerrain && matchesZone && matchesNotes && matchesLink;
      row.hidden = !match;
      if (match) visible++;
    }
    const empty = this.element.querySelector(".hc-overview-no-matches");
    if (empty) empty.hidden = visible > 0;
  }
```

- [ ] **Step 3: Wire the filter controls and restore state in `_onRender`**

In `scripts/hex-overview.js`, replace the tail of `_onRender` (the `search` input wiring block) with:

```js
    const search = this.element.querySelector('input[name="search"]');
    if (search) {
      search.value = this.#filters.text;
      search.addEventListener("input", () => {
        this.#filters.text = search.value;
        this.#applyFilters();
      });
    }

    const terrainSelect = this.element.querySelector('select[name="filterTerrain"]');
    if (terrainSelect) {
      terrainSelect.value = this.#filters.terrain;
      terrainSelect.addEventListener("change", () => {
        this.#filters.terrain = terrainSelect.value;
        this.#applyFilters();
      });
    }

    const zoneSelect = this.element.querySelector('select[name="filterZone"]');
    if (zoneSelect) {
      zoneSelect.value = this.#filters.zoneTag;
      zoneSelect.addEventListener("change", () => {
        this.#filters.zoneTag = zoneSelect.value;
        this.#applyFilters();
      });
    }

    const notesSelect = this.element.querySelector('select[name="filterNotes"]');
    if (notesSelect) {
      notesSelect.value = this.#filters.hasNotes;
      notesSelect.addEventListener("change", () => {
        this.#filters.hasNotes = notesSelect.value;
        this.#applyFilters();
      });
    }

    const linkSelect = this.element.querySelector('select[name="filterLink"]');
    if (linkSelect) {
      linkSelect.value = this.#filters.hasLink;
      linkSelect.addEventListener("change", () => {
        this.#filters.hasLink = linkSelect.value;
        this.#applyFilters();
      });
    }

    this.#applyFilters();
```

Also add `row.dataset.terrain`, `row.dataset.zones`, `row.dataset.hasNotes`, `row.dataset.hasLink` in the template (Step 4) so the selectors above have data to read.

- [ ] **Step 4: Update the template**

In `templates/hex-overview.hbs`, replace the `<header class="hc-overview-header">...</header>` block with:

```handlebars
  <header class="hc-overview-header">
    <input type="search" name="search" placeholder="{{localize 'HEXCHRON.OverviewSearchPlaceholder'}}" />
    <select name="filterTerrain">
      <option value="">{{localize "HEXCHRON.OverviewFilterAnyTerrain"}}</option>
      {{#each terrainOptions}}
      <option value="{{this}}">{{this}}</option>
      {{/each}}
    </select>
    <select name="filterZone">
      <option value="">{{localize "HEXCHRON.OverviewFilterAnyZone"}}</option>
      {{#each zoneOptions}}
      <option value="{{this}}">{{this}}</option>
      {{/each}}
    </select>
    <select name="filterNotes">
      <option value="any">{{localize "HEXCHRON.OverviewFilterNotesAny"}}</option>
      <option value="yes">{{localize "HEXCHRON.OverviewFilterNotesYes"}}</option>
      <option value="no">{{localize "HEXCHRON.OverviewFilterNotesNo"}}</option>
    </select>
    <select name="filterLink">
      <option value="any">{{localize "HEXCHRON.OverviewFilterLinkAny"}}</option>
      <option value="yes">{{localize "HEXCHRON.OverviewFilterLinkYes"}}</option>
      <option value="no">{{localize "HEXCHRON.OverviewFilterLinkNo"}}</option>
    </select>
  </header>

  <div class="hc-overview-stats">
    <span class="hc-overview-stat">{{stats.total}} {{localize "HEXCHRON.OverviewHexCount"}}</span>
    {{#each stats.terrainCounts}}
    <span class="hc-overview-stat-chip">{{this.type}} · {{this.count}}</span>
    {{/each}}
    <span class="hc-overview-stat">{{localize "HEXCHRON.OverviewStatNotes"}}: {{stats.withNotes}}</span>
    <span class="hc-overview-stat">{{localize "HEXCHRON.OverviewStatLink"}}: {{stats.withLink}}</span>
    <span class="hc-overview-stat">{{localize "HEXCHRON.OverviewStatIcon"}}: {{stats.withIcon}}</span>
  </div>
```

Then, in the row `<tr>` tag, add the new `data-*` attributes:

```handlebars
        <tr class="hc-overview-row" data-search="{{this.search}}" data-terrain="{{this.terrainRaw}}" data-zones="{{this.zoneKey}}" data-has-notes="{{this.hasNotes}}" data-has-link="{{this.hasLink}}">
```

Note: Handlebars renders booleans as the literal strings `"true"`/`"false"` in an attribute context, which is exactly what `#applyFilters()`'s `row.dataset.hasNotes === "true"` checks expect — no helper needed. `data-zones` uses `zoneKey` (the `|`-delimited join added to the row object above), matching `#applyFilters()`'s `matchesZone` split on `"|"`.

- [ ] **Step 5: Add localization keys**

In `lang/en.json`, add after the renamed `Overview*` block from Task 4:

```json
    "OverviewFilterAnyTerrain": "Any terrain",
    "OverviewFilterAnyZone": "Any zone",
    "OverviewFilterNotesAny": "Notes: any",
    "OverviewFilterNotesYes": "Has notes",
    "OverviewFilterNotesNo": "No notes",
    "OverviewFilterLinkAny": "Link: any",
    "OverviewFilterLinkYes": "Has link",
    "OverviewFilterLinkNo": "No link",
    "OverviewStatNotes": "With notes",
    "OverviewStatLink": "With link",
    "OverviewStatIcon": "With icon",
```

- [ ] **Step 6: Add styles**

In `styles/hex-chronicle.css`, after the renamed `.hc-overview-header` rules, add:

```css
.hc-overview-header {
  flex-wrap: wrap;
}

.hc-overview-header select {
  font-size: 0.78rem;
}

.hc-overview-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding-bottom: 0.5rem;
  flex: 0 0 auto;
}

.hc-overview-stat,
.hc-overview-stat-chip {
  font-size: 0.72rem;
  opacity: 0.75;
  background: var(--color-border-light-tertiary, rgba(255, 255, 255, 0.08));
  border-radius: 3px;
  padding: 0.1rem 0.4rem;
  white-space: nowrap;
}
```

- [ ] **Step 7: Manual verification**

In a live world as GM with several hexes of different terrain/zones/notes/links: open Hex Overview, confirm the stats bar shows correct total/terrain counts/notes/link/icon counts. Use each filter dropdown individually and in combination with the search box; confirm the row count and "no matches" message update correctly, and clearing a filter restores previously-hidden rows. Trigger an edit elsewhere (e.g. change a hex's terrain in the full editor) and confirm the Overview re-renders with your filters still applied (not reset to blank).

- [ ] **Step 8: Commit**

```bash
git add scripts/hex-overview.js templates/hex-overview.hbs lang/en.json styles/hex-chronicle.css
git commit -m "Add stats bar and combinable filters to Hex Overview"
```

---

### Task 6: Per-row reveal toggles (terrain + structure)

**Files:**
- Modify: `scripts/hex-overview.js` (`_prepareContext` row fields, `_onRender` wiring)
- Modify: `templates/hex-overview.hbs` (two new per-row buttons)
- Modify: `lang/en.json` (tooltips)
- Modify: `styles/hex-chronicle.css` (icon on/off states)

**Interfaces:**
- Consumes: `fog.js`'s `isExplored`, `toggleHex`, `isStructureRevealed`, `toggleStructure` (all pre-existing, single-hex).
- Produces: row fields `terrainRevealed: boolean`, `structureRevealed: boolean` (read by Task 9's selection logic indirectly through the DOM, not directly consumed as a JS interface).

- [ ] **Step 1: Import fog functions and extend row data**

In `scripts/hex-overview.js`, add to the import from `./fog.js` (new import line, since none exists yet):

```js
import { isExplored, toggleHex, isStructureRevealed, toggleStructure } from "./fog.js";
```

In `_prepareContext`'s row-mapping, add two fields to the returned row object (after `hasNotes`):

```js
          terrainRevealed: isExplored(col, row, scene),
          structureRevealed: isStructureRevealed(col, row, scene),
```

- [ ] **Step 2: Add the buttons to the template**

In `templates/hex-overview.hbs`, add a new `<th>`/`<td>` pair for "revealed" between the label column and the actions column:

```handlebars
          <th>{{localize "HEXCHRON.OverviewColRevealed"}}</th>
```

(insert right before `<th class="hc-overview-col-actions"></th>` in `<thead>`), and in the row body, right before the `<td class="hc-overview-actions">` cell:

```handlebars
          <td class="hc-overview-revealed">
            <button type="button" class="hc-overview-reveal-toggle {{#if this.terrainRevealed}}active{{/if}}" data-action="toggleTerrain" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{localize 'HEXCHRON.ToolReveal'}}">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button type="button" class="hc-overview-reveal-toggle {{#if this.structureRevealed}}active{{/if}}" data-action="toggleStructure" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{localize 'HEXCHRON.ToolRevealStructure'}}">
              <i class="fa-solid fa-tower-observation"></i>
            </button>
          </td>
```

- [ ] **Step 3: Wire the click handlers**

In `scripts/hex-overview.js`'s `_onRender`, add (near the existing `goto`/`edit` button wiring):

```js
    for (const btn of this.element.querySelectorAll('[data-action="toggleTerrain"]')) {
      btn.addEventListener("click", async () => {
        await toggleHex(Number(btn.dataset.col), Number(btn.dataset.row));
        await canvas.hexChronicle?.refresh();
      });
    }
    for (const btn of this.element.querySelectorAll('[data-action="toggleStructure"]')) {
      btn.addEventListener("click", async () => {
        await toggleStructure(Number(btn.dataset.col), Number(btn.dataset.row));
        await canvas.hexChronicle?.refresh();
      });
    }
```

(No manual re-render call needed here — the class's own `updateScene` hook, already wired since Task 4, re-renders the window when `toggleHex`/`toggleStructure`'s `setFlag` lands, but those write to the `explored`/`structuresRevealed` flag keys, not `flags.hex-chronicle-vtt.hexes` — check `#onUpdateScene`'s guard: `foundry.utils.hasProperty(changes, \`flags.${MODULE_ID}\`)` matches any key under the module's flags namespace, including `explored` and `structuresRevealed`, so the existing hook already covers this. No changes needed to `#onUpdateScene`.)

- [ ] **Step 4: Add localization key**

In `lang/en.json`, add `"OverviewColRevealed": "Revealed",` to the `Overview*` block.

- [ ] **Step 5: Add styles**

In `styles/hex-chronicle.css`:

```css
.hc-overview-reveal-toggle {
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  line-height: 1;
  opacity: 0.4;
}

.hc-overview-reveal-toggle.active {
  opacity: 1;
  color: var(--color-level-success, #3f8f4f);
}
```

- [ ] **Step 6: Manual verification**

As GM, open Hex Overview, click a hex's eye icon: confirm it toggles filled/dimmed, and (as a connected non-GM test client, or by checking `fog.isExplored` in console) confirm the actual explored state flipped. Same for the tower icon and `isStructureRevealed`. Confirm the main canvas map visually updates (unexplored hex renders "unknown" for a player client) without needing to close/reopen Hex Overview.

- [ ] **Step 7: Commit**

```bash
git add scripts/hex-overview.js templates/hex-overview.hbs lang/en.json styles/hex-chronicle.css
git commit -m "Add per-row terrain/structure reveal toggles to Hex Overview"
```

---

### Task 7: Inline quick-edit for label and notes

**Files:**
- Modify: `scripts/hex-overview.js` (import `applyHexPatches`, row fields, `_onRender` wiring, new `#startInlineEdit` method)
- Modify: `templates/hex-overview.hbs` (notes column, editable markup)
- Modify: `lang/en.json`
- Modify: `styles/hex-chronicle.css`

**Interfaces:**
- Consumes: `applyHexPatches(scene, patches)` from Task 1.
- Produces: nothing new consumed by later tasks (leaf feature), but establishes the click-to-edit DOM convention (`data-action="editField"`, `data-field`, `data-col`, `data-row`) that Task 8 (zone tags) follows for consistency.

- [ ] **Step 1: Import `applyHexPatches` and add row fields**

In `scripts/hex-overview.js`, add to the `./data-model.js` import:

```js
import { parseHexKey, normalizeHexContent, applyHexPatches } from "./data-model.js";
```

In `_prepareContext`'s row mapping, add (after `hasNotes`):

```js
          notes: content.notes,
          notesPreview: content.notes.length > 60 ? `${content.notes.slice(0, 60)}…` : content.notes,
```

- [ ] **Step 2: Update the template**

In `templates/hex-overview.hbs`, replace the label `<td>` (the one containing `this.alt`) with an editable version, and add a new "Notes" column. Update `<thead>` to add a `<th>{{localize "HEXCHRON.OverviewColNotes"}}</th>` right after the label column's `<th>`, then update the row body:

```handlebars
          <td class="hc-overview-editable" data-action="editField" data-field="alt" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{localize 'HEXCHRON.OverviewClickToEdit'}}">
            {{#if this.alt}}<span class="hc-overview-alt">{{this.alt}}</span>{{/if}}
            {{#if this.icon}}<i class="fa-solid fa-tower-observation" data-tooltip="{{this.icon}}"></i>{{/if}}
            {{#if this.hasLink}}<i class="fa-solid fa-link" data-tooltip="{{localize 'HEXCHRON.FieldLink'}}"></i>{{/if}}
          </td>
          <td class="hc-overview-editable hc-overview-notes" data-action="editField" data-field="notes" data-col="{{this.col}}" data-row="{{this.row}}" data-tooltip="{{this.notes}}">
            {{this.notesPreview}}
          </td>
```

- [ ] **Step 3: Wire click-to-edit**

In `scripts/hex-overview.js`, add to `_onRender`:

```js
    for (const cell of this.element.querySelectorAll('[data-action="editField"]')) {
      cell.addEventListener("click", () => this.#startInlineEdit(cell));
    }
```

Add the new private method:

```js
  #startInlineEdit(cell) {
    if (cell.querySelector("textarea")) return;
    const col = Number(cell.dataset.col);
    const row = Number(cell.dataset.row);
    const field = cell.dataset.field;
    const original = cell.dataset.tooltip ?? "";
    const originalHtml = cell.innerHTML;

    const textarea = document.createElement("textarea");
    textarea.value = field === "notes" ? original : (cell.querySelector(".hc-overview-alt")?.textContent ?? "");
    textarea.rows = field === "notes" ? 3 : 1;
    textarea.className = "hc-overview-inline-editor";
    cell.innerHTML = "";
    cell.appendChild(textarea);
    textarea.focus();

    const commit = async () => {
      const scene = canvas.scene;
      await applyHexPatches(scene, [{ col, row, patch: { [field]: textarea.value } }]);
    };
    const cancel = () => {
      cell.innerHTML = originalHtml;
    };

    textarea.addEventListener("blur", commit);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field !== "notes") {
        event.preventDefault();
        textarea.blur();
      }
      if (event.key === "Escape") {
        textarea.removeEventListener("blur", commit);
        cancel();
      }
    });
  }
```

(The `updateScene` hook re-renders the whole window once `applyHexPatches`'s `setFlag` resolves, which replaces `cell` in the DOM entirely — no manual DOM cleanup needed after `commit()`.)

- [ ] **Step 4: Add localization keys**

In `lang/en.json`: `"OverviewColNotes": "Notes",` and `"OverviewClickToEdit": "Click to edit",`.

- [ ] **Step 5: Add styles**

```css
.hc-overview-editable {
  cursor: text;
}

.hc-overview-notes {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
  font-size: 0.78rem;
}

.hc-overview-inline-editor {
  width: 100%;
  font: inherit;
  resize: vertical;
}
```

- [ ] **Step 6: Manual verification**

As GM, open Hex Overview, click a hex's label cell: confirm a single-line textarea appears pre-filled, type a new label, press Enter, confirm it saves (check the full `HexEditor` for that hex shows the same value) and the cell re-renders with the new text. Click a notes cell: confirm a multi-line textarea appears, edit, click elsewhere (blur) to commit, confirm persistence the same way. Press Escape mid-edit on both and confirm no write happens (value unchanged).

- [ ] **Step 7: Commit**

```bash
git add scripts/hex-overview.js templates/hex-overview.hbs lang/en.json styles/hex-chronicle.css
git commit -m "Add inline click-to-edit for hex label and notes in Hex Overview"
```

---

### Task 8: Zone-tag chips (single-row add/remove)

**Files:**
- Modify: `scripts/hex-overview.js` (`_onRender` wiring, new `#addZoneTag`/`#removeZoneTag` methods)
- Modify: `templates/hex-overview.hbs` (chip markup replacing the plain zone text)
- Modify: `lang/en.json`
- Modify: `styles/hex-chronicle.css`

**Interfaces:**
- Consumes: `applyHexPatches` (Task 1), `zoneList` row field (Task 5).
- Produces: nothing consumed by later tasks directly, but Task 9's bulk zone-tag action reuses the same `applyHexPatches`-based patch shape established here (`{ zone: [...] }`).

- [ ] **Step 1: Replace the zone display in the template**

In `templates/hex-overview.hbs`, inside the terrain `<td>`, replace:

```handlebars
            {{#if this.zone}}<div class="hc-overview-zones">{{this.zone}}</div>{{/if}}
```

with:

```handlebars
            <div class="hc-overview-zones" data-col="{{this.col}}" data-row="{{this.row}}">
              {{#each this.zoneList}}
              <span class="hc-overview-zone-chip">{{this}}<button type="button" data-action="removeZone" data-tag="{{this}}">×</button></span>
              {{/each}}
              <button type="button" class="hc-overview-zone-add" data-action="addZone" data-tooltip="{{localize 'HEXCHRON.OverviewAddZoneTag'}}">+</button>
            </div>
```

- [ ] **Step 2: Wire the handlers**

In `scripts/hex-overview.js`'s `_onRender`:

```js
    for (const btn of this.element.querySelectorAll('[data-action="removeZone"]')) {
      btn.addEventListener("click", () => {
        const container = btn.closest(".hc-overview-zones");
        this.#removeZoneTag(Number(container.dataset.col), Number(container.dataset.row), btn.dataset.tag);
      });
    }
    for (const btn of this.element.querySelectorAll('[data-action="addZone"]')) {
      btn.addEventListener("click", () => {
        const container = btn.closest(".hc-overview-zones");
        this.#addZoneTag(Number(container.dataset.col), Number(container.dataset.row));
      });
    }
```

Add the two private methods:

```js
  async #currentZoneList(col, row) {
    const scene = canvas.scene;
    const raw = scene.getFlag(MODULE_ID, "hexes")?.[`${col},${row}`] ?? {};
    return normalizeHexContent(raw).zone;
  }

  async #addZoneTag(col, row) {
    const tag = (window.prompt(game.i18n.localize("HEXCHRON.OverviewAddZoneTagPrompt")) ?? "").trim();
    if (!tag) return;
    const current = await this.#currentZoneList(col, row);
    if (current.includes(tag)) return;
    await applyHexPatches(canvas.scene, [{ col, row, patch: { zone: [...current, tag] } }]);
  }

  async #removeZoneTag(col, row, tag) {
    const current = await this.#currentZoneList(col, row);
    await applyHexPatches(canvas.scene, [{ col, row, patch: { zone: current.filter((z) => z !== tag) } }]);
  }
```

`MODULE_ID` is already imported at the top of `hex-overview.js` (from Task 4's carry-over of the original directory's imports) — confirm it's in the `./settings.js` import list; if not, add it.

- [ ] **Step 3: Add localization keys**

```json
    "OverviewAddZoneTag": "Add zone tag",
    "OverviewAddZoneTagPrompt": "Zone tag to add:",
```

- [ ] **Step 4: Add styles**

```css
.hc-overview-zone-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.68rem;
  opacity: 0.75;
  background: var(--color-border-light-tertiary, rgba(255, 255, 255, 0.08));
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  margin: 0.1rem 0.15rem 0 0;
}

.hc-overview-zone-chip button {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  opacity: 0.6;
}

.hc-overview-zone-add {
  border: none;
  background: none;
  opacity: 0.5;
  cursor: pointer;
  padding: 0 0.2rem;
}
```

- [ ] **Step 5: Manual verification**

As GM, open Hex Overview, on a hex with no zone tags click "+", enter a tag in the prompt, confirm a chip appears after re-render. Add a second tag, confirm both chips show. Click a chip's "×", confirm it's removed and the other stays. Open the full `HexEditor` for that hex and confirm its "Zones" field matches.

- [ ] **Step 6: Commit**

```bash
git add scripts/hex-overview.js templates/hex-overview.hbs lang/en.json styles/hex-chronicle.css
git commit -m "Add per-row zone-tag chips (add/remove) to Hex Overview"
```

---

### Task 9: Bulk selection + bulk action bar

**Files:**
- Modify: `scripts/hex-overview.js` (import bulk helpers, `#selected` state, checkbox wiring, bulk action bar wiring)
- Modify: `templates/hex-overview.hbs` (checkbox column, bulk action bar)
- Modify: `lang/en.json`
- Modify: `styles/hex-chronicle.css`

**Interfaces:**
- Consumes: `setExploredMany`, `setStructureRevealedMany` (Task 2), `applyHexPatches` (Task 1).
- Produces: none further (final feature task).

- [ ] **Step 1: Import bulk helpers**

In `scripts/hex-overview.js`, extend the `./fog.js` import:

```js
import { isExplored, toggleHex, isStructureRevealed, toggleStructure, setExploredMany, setStructureRevealedMany } from "./fog.js";
```

- [ ] **Step 2: Add selection state**

```js
  #selected = new Set();
```

- [ ] **Step 3: Add checkbox column to the template**

In `templates/hex-overview.hbs`, add to `<thead>` as the first column:

```handlebars
          <th class="hc-overview-col-select"><input type="checkbox" data-action="selectAll" /></th>
```

And as the first `<td>` in each row:

```handlebars
          <td class="hc-overview-select"><input type="checkbox" data-action="select" data-col="{{this.col}}" data-row="{{this.row}}" /></td>
```

Add the bulk action bar right after `<div class="hc-overview-stats">...</div>` and before `{{#if hasHexes}}`:

```handlebars
  <div class="hc-overview-bulk-bar" hidden>
    <span class="hc-overview-bulk-count"></span>
    <button type="button" data-action="bulkRevealTerrain">{{localize "HEXCHRON.OverviewBulkRevealTerrain"}}</button>
    <button type="button" data-action="bulkHideTerrain">{{localize "HEXCHRON.OverviewBulkHideTerrain"}}</button>
    <button type="button" data-action="bulkRevealStructure">{{localize "HEXCHRON.OverviewBulkRevealStructure"}}</button>
    <button type="button" data-action="bulkHideStructure">{{localize "HEXCHRON.OverviewBulkHideStructure"}}</button>
    <button type="button" data-action="bulkAddZone">{{localize "HEXCHRON.OverviewBulkAddZone"}}</button>
    <button type="button" data-action="bulkRemoveZone">{{localize "HEXCHRON.OverviewBulkRemoveZone"}}</button>
    <button type="button" data-action="bulkClear">{{localize "HEXCHRON.OverviewBulkClear"}}</button>
  </div>
```

- [ ] **Step 4: Wire checkboxes and the bar**

In `scripts/hex-overview.js`'s `_onRender`, add:

```js
    const selectAll = this.element.querySelector('[data-action="selectAll"]');
    selectAll?.addEventListener("change", () => {
      for (const row of this.element.querySelectorAll(".hc-overview-row:not([hidden])")) {
        const box = row.querySelector('[data-action="select"]');
        const key = `${box.dataset.col},${box.dataset.row}`;
        box.checked = selectAll.checked;
        if (selectAll.checked) this.#selected.add(key);
        else this.#selected.delete(key);
      }
      this.#updateBulkBar();
    });

    for (const box of this.element.querySelectorAll('[data-action="select"]')) {
      const key = `${box.dataset.col},${box.dataset.row}`;
      box.checked = this.#selected.has(key);
      box.addEventListener("change", () => {
        if (box.checked) this.#selected.add(key);
        else this.#selected.delete(key);
        this.#updateBulkBar();
      });
    }
    this.#updateBulkBar();

    this.element.querySelector('[data-action="bulkRevealTerrain"]')?.addEventListener("click", () => this.#bulkSetExplored(true));
    this.element.querySelector('[data-action="bulkHideTerrain"]')?.addEventListener("click", () => this.#bulkSetExplored(false));
    this.element.querySelector('[data-action="bulkRevealStructure"]')?.addEventListener("click", () => this.#bulkSetStructure(true));
    this.element.querySelector('[data-action="bulkHideStructure"]')?.addEventListener("click", () => this.#bulkSetStructure(false));
    this.element.querySelector('[data-action="bulkAddZone"]')?.addEventListener("click", () => this.#bulkZoneTag(true));
    this.element.querySelector('[data-action="bulkRemoveZone"]')?.addEventListener("click", () => this.#bulkZoneTag(false));
    this.element.querySelector('[data-action="bulkClear"]')?.addEventListener("click", () => {
      this.#selected.clear();
      this.#updateBulkBar();
      for (const box of this.element.querySelectorAll('[data-action="select"]')) box.checked = false;
      if (selectAll) selectAll.checked = false;
    });
```

Add the supporting private methods:

```js
  #selectedCells() {
    return [...this.#selected].map((key) => parseHexKey(key));
  }

  #updateBulkBar() {
    const bar = this.element.querySelector(".hc-overview-bulk-bar");
    if (!bar) return;
    bar.hidden = this.#selected.size === 0;
    const count = bar.querySelector(".hc-overview-bulk-count");
    if (count) count.textContent = game.i18n.format("HEXCHRON.OverviewBulkCount", { count: this.#selected.size });
  }

  async #bulkSetExplored(value) {
    await setExploredMany(this.#selectedCells(), value);
    await canvas.hexChronicle?.refresh();
    this.#selected.clear();
  }

  async #bulkSetStructure(value) {
    await setStructureRevealedMany(this.#selectedCells(), value);
    await canvas.hexChronicle?.refresh();
    this.#selected.clear();
  }

  async #bulkZoneTag(add) {
    const promptKey = add ? "HEXCHRON.OverviewAddZoneTagPrompt" : "HEXCHRON.OverviewRemoveZoneTagPrompt";
    const tag = (window.prompt(game.i18n.localize(promptKey)) ?? "").trim();
    if (!tag) return;
    const scene = canvas.scene;
    const raw = scene.getFlag(MODULE_ID, "hexes") ?? {};
    const patches = this.#selectedCells().map(([col, row]) => {
      const existing = normalizeHexContent(raw[`${col},${row}`] ?? {}).zone;
      const zone = add ? (existing.includes(tag) ? existing : [...existing, tag]) : existing.filter((z) => z !== tag);
      return { col, row, patch: { zone } };
    });
    await applyHexPatches(scene, patches);
    this.#selected.clear();
  }
```

Note `parseHexKey` returns `{ col, row }`, not a tuple — adjust `#selectedCells()` to return `[col, row]` pairs explicitly:

```js
  #selectedCells() {
    return [...this.#selected].map((key) => {
      const { col, row } = parseHexKey(key);
      return [col, row];
    });
  }
```

Header checkbox keys must match row checkbox keys exactly — use the same `${col},${row}` string both places (matches `hexKey()`'s format from `data-model.js`, though built inline here rather than imported, since only the string shape is needed for the `Set`, not the function itself).

- [ ] **Step 5: Add localization keys**

```json
    "OverviewBulkCount": "{count} selected",
    "OverviewBulkRevealTerrain": "Reveal Terrain",
    "OverviewBulkHideTerrain": "Hide Terrain",
    "OverviewBulkRevealStructure": "Reveal Structure",
    "OverviewBulkHideStructure": "Hide Structure",
    "OverviewBulkAddZone": "+ Zone Tag",
    "OverviewBulkRemoveZone": "− Zone Tag",
    "OverviewBulkClear": "Clear Selection",
    "OverviewRemoveZoneTagPrompt": "Zone tag to remove:",
```

- [ ] **Step 6: Add styles**

```css
.hc-overview-bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.4rem;
  margin-bottom: 0.4rem;
  background: var(--color-border-light-tertiary, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  flex: 0 0 auto;
}

.hc-overview-bulk-count {
  font-size: 0.78rem;
  opacity: 0.8;
  margin-right: 0.3rem;
}

.hc-overview-bulk-bar button {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  width: auto;
  height: auto;
}
```

- [ ] **Step 7: Manual verification**

As GM with 4+ authored hexes: select two rows via checkboxes, confirm the bulk bar appears with "2 selected". Click "Reveal Terrain", confirm both hexes' terrain-revealed state flips to true (check via the per-row eye icon from Task 6, or `fog.isExplored` in console) and the bar hides again (selection cleared) after the re-render. Repeat for "Hide Terrain", "Reveal/Hide Structure". Select two hexes, click "+ Zone Tag", enter a tag, confirm both hexes now show that chip; click "− Zone Tag" with the same tag name, confirm it's removed from both. Use "Select all" (header checkbox) with a filter active and confirm it only selects currently-visible rows, not hidden ones. Click "Clear Selection" and confirm all checkboxes uncheck and the bar hides.

- [ ] **Step 8: Commit**

```bash
git add scripts/hex-overview.js templates/hex-overview.hbs lang/en.json styles/hex-chronicle.css
git commit -m "Add bulk selection and batched bulk actions to Hex Overview"
```

---

### Task 10: Documentation pass

**Files:**
- Modify: `README.md` (Usage section's directory bullet, "What's here" list, status blurb)
- Modify: `ROADMAP.md` (add an entry for this feature, following its existing dated-history convention — read the file first to match its format)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`**

Replace the bullet in "What's here" (currently: `- A searchable directory to jump straight to any authored hex, and an\n  on-screen terrain/zone color legend.`) with:

```markdown
- A GM dashboard ("Hex Overview") with aggregate stats, filters, inline
  quick-edit, and batched bulk actions across every authored hex, plus an
  on-screen terrain/zone color legend.
```

Replace the "Hex Directory" bullet under "Usage" (`- **Hex Directory** (GM): ...`) with:

```markdown
- **Hex Overview** (GM): a dashboard over every authored hex on the current
  scene - stats (terrain/notes/link/icon counts), combinable filters
  (terrain, zone, notes, link), inline click-to-edit for a hex's label/
  notes/zone tags, per-row terrain/structure reveal toggles, and batched
  bulk actions (reveal/hide terrain or structure, add/remove a zone tag)
  across a multi-row selection - all without hunting for hexes on the map
  or opening the full editor one at a time.
```

Add `notes` to the field list in the "Usage" `**Edit Hex**` bullet (currently lists `terrain type, mixed terrain, building icon, label, roads, rivers, and zones` — append `, and GM-only notes`).

- [ ] **Step 2: Read and update `ROADMAP.md`**

Read the full current file to match its exact dated-entry format, then add a new entry following that same convention for "Replaced Hex Directory with Hex Overview: stats, filters, inline edit, bulk actions, GM notes field" dated 2026-08-23.

- [ ] **Step 3: Manual verification**

Read both files back and confirm no stale references to "Hex Directory" or `hex-directory.js`/`.hbs` remain anywhere in the repo:

```bash
grep -rn "hex-directory\|HexDirectory\|Hex Directory" --include="*.md" --include="*.js" --include="*.hbs" --include="*.json" .
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md ROADMAP.md
git commit -m "Document the Hex Overview dashboard in README and ROADMAP"
```
