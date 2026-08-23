# Hex Overview — design spec

Status: approved for planning
Date: 2026-08-23

## Problem

The module already has a GM-only "Hex Directory" (`scripts/hex-directory.js`,
`templates/hex-directory.hbs`): a searchable table of every authored hex on
the current scene, with "go to" and "edit" row actions. It's too thin for
running a session from: no aggregate stats, no way to act on more than one
hex at a time, and no place to keep GM-only prose about a hex beyond the
short `alt` label.

## Goal

Replace the Hex Directory with a **Hex Overview**: a richer GM dashboard —
stats, filters, inline quick-edit, and batched bulk actions — reusing the
same data model, fog, and editor infrastructure. Same toolbar slot (GM-only
scene-control button), no new dependencies.

## Scope

In scope: a new `notes` field on the hex schema, the Hex Overview
application itself, bulk-write helpers in `fog.js`/`data-model.js`, wiring
into `init.js`, and dropping the old Hex Directory files.

Out of scope: exposing `notes` to players (it's never read by the
rendering/fog pipeline — GM-only by construction, no gating needed); a
mini-map view; rich text (notes stay plain `<textarea>`, consistent with
the rest of the schema).

## 1. `notes` field

`data-model.js`:
- `emptyHex()` gains `notes: ""`.
- `normalizeHexContent()` gains: `if (typeof raw.notes === "string" && raw.notes.trim()) out.notes = raw.notes.trim();` (mirrors the existing `alt` handling).
- `stripStructure()` is unaffected — `notes` was never gated because nothing player-facing ever reads it; leaving it present under `stripStructure`'s output is harmless since only GM-only code paths (the editor, the Overview) ever consume `notes`.

`hex-editor.js` / `hex-editor.hbs`: a new "GM Notes" `<textarea name="notes">`
in a new section (`SectionNotes`), populated/read the same way `alt` is
today (`_prepareContext` → `notes: content.notes`; `#onSubmit` → `notes:
data.notes`).

## 2. Bulk-write helpers

Both live next to the single-hex functions they parallel, same "batch into
one `setFlag` call" shape as `fog.js`'s existing `revealArea()`.

`fog.js`:
```js
export async function setExploredMany(cells, value, scene = canvas.scene) {
  const current = getExploredMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = value;
  return scene.setFlag(MODULE_ID, "explored", merged);
}

export async function setStructureRevealedMany(cells, value, scene = canvas.scene) {
  const current = getStructureRevealedMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = value;
  return scene.setFlag(MODULE_ID, "structuresRevealed", merged);
}
```

`data-model.js`:
```js
/** Applies a partial-field patch to each of several hexes in one write.
 * `patches` is [{ col, row, patch }], `patch` a partial raw hex object
 * (e.g. { alt: "..." } or { zone: [...] }) shallow-merged onto that hex's
 * existing raw content before normalization - same shape #onSubmit already
 * builds by hand, reused here for inline/bulk edits that don't go through
 * the full HexEditor form. */
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

Zone-tag add/remove is expressed as a patch per affected hex: read each
selected hex's current `zone` array from the already-loaded row data, add/
remove the tag, pass the result as that hex's `patch.zone`.

## 3. `HexOverview` application

New `scripts/hex-overview.js` (`HexOverview` class) + `templates/
hex-overview.hbs`, same `HandlebarsApplicationMixin(ApplicationV2)` shape as
`HexDirectory`, reusing `parseHexKey`/`normalizeHexContent`/`tileCenter`/
`HexEditor` the same way. Replaces `HexDirectory` outright — `hex-
directory.js` and `hex-directory.hbs` are deleted, not kept alongside it.

### State

Instance fields (survive re-render, unlike DOM state):
- `#selected: Set<string>` — selected hex keys (`"col,row"`).
- `#filters: { text: string, terrain: string|null, zone: string|null, hasNotes: boolean|null, hasLink: boolean|null, terrainRevealed: boolean|null, structureRevealed: boolean|null }`.

### `_prepareContext()`

Same base shape as today's `_prepareContext` (one row per authored hex,
sorted by row/col), extended per row with: `notes`, `notesPreview`
(first ~60 chars), `terrainRevealed`, `structureRevealed` (from
`fog.isExplored`/`isStructureRevealed`), `selected` (from `#selected`).
Also returns a `stats` object computed over all rows: total count, a
`{ terrain: count }` map, counts of revealed/unrevealed (both kinds),
counts with notes/link/icon. Filtering itself happens client-side in
`_onRender` (same pattern as today's `#applyFilter`, extended to check
all filter facets, not just a text substring), re-applying `#filters`
after every render so a bulk action's re-render doesn't reset the view.

### Template layout

```
[stats bar: total · terrain chips w/ counts · revealed/structure counts · notes/link/icon counts]
[filter bar: search input, terrain <select>, zone <select>, 3x tri-state toggles]
[bulk action bar - hidden unless #selected is non-empty]
  Reveal Terrain / Hide Terrain / Reveal Structure / Hide Structure / + Zone tag / - Zone tag / Clear selection
[table]
  th: [checkbox-all] coord terrain zone notes link/icon revealed actions
  each row:
    - checkbox (data-action="select")
    - coord (unchanged)
    - terrain + mixed (unchanged)
    - zone: chips, each with an "×"; a small "+ tag" input at the end
    - notes: truncated text, click opens an inline <textarea> (same row,
      replaces the cell content until blur/Enter, then calls
      applyHexPatches and closes)
    - icon/link indicators (unchanged glyphs)
    - revealed: two clickable icons (eye = terrain, tower = structure),
      filled/outlined to show state, click = single-hex toggle
      (fog.toggleHex / fog.toggleStructure)
    - actions: go-to (unchanged), edit (unchanged, opens full HexEditor)
```

### Interactions

- **Row select** toggles membership in `#selected`; header checkbox
  selects/clears all *currently visible* (post-filter) rows.
- **Bulk actions** read `#selected`, resolve each key back to `[col, row]`
  via `parseHexKey`, call the relevant bulk helper (`setExploredMany`,
  `setStructureRevealedMany`, or `applyHexPatches` for zone tags), then
  clear `#selected` — the `updateScene` hook's re-render (already wired,
  same as `HexDirectory` today) picks up the result.
- **Inline label/notes edit** calls `applyHexPatches(scene, [{ col, row,
  patch: { alt } }])` (or `{ notes }`) on blur/Enter, single-hex, same
  helper as the bulk path with a one-element array.
- **Zone tag add/remove** (single row) is the same `applyHexPatches` call
  with a computed `zone` array — no separate helper needed.
- Reactivity hooks (`updateScene`, `canvasReady`) and the singleton-window
  pattern in `init.js` carry over unchanged from `HexDirectory`.

## 4. `init.js` wiring

Swap the `directory` tool's `onChange` to construct `HexOverview` instead
of `HexDirectory` (keep the singleton var, rename to `hexOverviewApp`).
Icon changes from `fa-table-list` to `fa-chart-simple` (reads as
"dashboard", distinct from the plain-list icon this is replacing). Title
key `HEXCHRON.ToolDirectory` → `HEXCHRON.ToolOverview`, `DirectoryTitle` →
`OverviewTitle`, etc. — rename the whole `Directory*` string family to
`Overview*` in `lang/en.json` since the old ones no longer exist, plus new
strings for the stats/filter/bulk-action labels and `SectionNotes`/
`FieldNotes`.

## 5. Styles

`styles/hex-chronicle.css`: rename `.hc-directory*` to `.hc-overview*`,
extend with rules for the stats bar (chip row), filter bar (inline
controls), bulk-action bar (sticky, appears/disappears), zone-tag chips
(with a remove "×"), and the inline-edit textarea (matches table row
height, no visual jump).

## Testing

No automated harness for this module (documented in the README) — verify
manually in a live Foundry v13 world, extending the existing manual-test
checklist:
1. Open Hex Overview from the toolbar; confirm stats/counts match what's
   actually authored on the scene.
2. Filter by terrain, by zone, and by each tri-state toggle; confirm the
   row count and the "no matches" state behave correctly, and that filters
   survive a re-render triggered by an edit elsewhere.
3. Edit a hex's label and notes inline; confirm it persists (reload the
   scene) and matches what the full `HexEditor` shows for that hex.
4. Add/remove a zone tag inline on one hex.
5. Select several hexes and run each bulk action (reveal/hide terrain,
   reveal/hide structure, add/remove zone tag); confirm exactly one
   `updateScene` per action (watch dev tools) and that the affected hexes'
   state is correct afterward, for both GM and a connected player client
   where relevant (terrain/structure reveal).
6. Confirm `notes` never appears anywhere in player-facing rendering
   (canvas draw, legend) — GM-only surfaces (Overview, HexEditor) are the
   only readers.
