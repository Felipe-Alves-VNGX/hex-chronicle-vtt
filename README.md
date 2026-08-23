# Hex Chronicle (FoundryVTT)

An interactive hex-crawl map layer for FoundryVTT (v13/v14): draw a hex grid
directly on a Scene, edit each hex's terrain/icon/roads/rivers/zone through a
form, import existing hex-chronicle Markdown/YAML files in bulk, and let
players explore the map hex by hex with a simple fog-of-war.

This is a JavaScript port of **[hex-chronicle](https://github.com/)**, a
Python CLI tool by **Guillaume Fouillet** that generates static SVG hex maps
from the same file format. See [CREDITS.md](CREDITS.md) for full attribution
(hex-chronicle, its icon assets from game-icons.net, and the vendored
js-yaml library), and [ROADMAP.md](ROADMAP.md) for what's done and what's
still planned.

> **Status**: extensively live-tested against a real Foundry v13 world,
> as both GM and player, across many sessions - not just the code paths,
> the actual UI. Every canvas tool, the visual hex editor (terrain/roads/
> rivers diagrams, icon picker with preview), bulk import (including
> negative coordinates and French cardinal aliases), fog-of-war in both
> layers, the hex overview, the on-screen legend, and the grid-alignment
> drag handles have all been exercised live, GM and player perspectives
> both checked where relevant. See [ROADMAP.md](ROADMAP.md) for the
> detailed, dated history of what was tested and what each round found.

## What's here

- A hex grid overlaid directly on a Scene, independent of Foundry's own
  grid settings - position and size it by eye with drag handles, or type
  exact numbers.
- A visual per-hex editor: paint mixed terrain and draw roads/rivers by
  clicking a diagram of the hex instead of writing `type: side1 side2`
  text by hand, and pick a building icon from a preview grid instead of
  typing a filename. The original text fields still work too, behind a
  collapsed "Edit as text" fallback.
- Two independent fog-of-war layers (terrain, and separately its
  building/label/link), manual or automatic reveal.
- A GM dashboard ("Hex Overview") with aggregate stats, filters, inline
  quick-edit, and batched bulk actions across every authored hex, plus an
  on-screen terrain/zone color legend.
- Bulk import from the original hex-chronicle tool's `.md`/`.yaml`/`.yml`
  files.

## Installing

**Via manifest URL** (once at least one release has been cut - see below):
in Foundry's "Install Module" dialog, paste

```
https://github.com/Felipe-Alves-VNGX/hex-chronicle-vtt/releases/latest/download/module.json
```

**Locally, without a release:** copy this folder into your Foundry
`Data/modules/` directory (keeping the folder name `hex-chronicle-vtt`, or
update `module.json`'s `id` to match if you rename it), then enable "Hex
Chronicle" in your world's Manage Modules.

## Cutting a release

The repo is private, so releases are for your own installs/testing, not
public distribution. `.github/workflows/release.yml` handles the Foundry
manifest+download convention automatically:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Pushing a `vX.Y.Z` tag triggers the workflow, which stamps that version
number into a copy of `module.json` (setting `download` to that tag's
`module.zip`, and `manifest` to the stable "latest release" URL above),
zips the module, and publishes both `module.zip` and the stamped
`module.json` as release assets. The `module.json` committed to the repo
is intentionally left with the "latest" manifest URL but no `download` -
that field is only meaningful per-release and is filled in by the
workflow, not by hand.

## Usage

A new **Hex Chronicle** control group appears in the scene controls (left
toolbar) when a scene is active. Hovering the canvas with any tool below
selected outlines whichever hex the cursor is over, so you can see what a
click will land on before committing to it.

- **Edit Hex** (GM; does nothing yet for players - see "Known limitations"
  in [ROADMAP.md](ROADMAP.md)): click a hex cell to open its editor -
  terrain type, mixed terrain, building icon, label, roads, rivers, zones,
  and GM-only notes. Mixed terrain and roads/rivers are painted/drawn on a clickable
  diagram of the hex (see "Fine-grained terrain zones" below); the
  building icon is picked from a preview grid. The original line-based
  text fields still work too, behind a collapsed "Edit as text" toggle -
  useful for hand-editing or pasting.
- **Reveal/Hide Terrain** (GM): click a hex to toggle whether players can
  see its terrain at all (see "Exploration / fog-of-war" below).
- **Reveal/Hide Structure** (GM): click a hex to toggle whether its
  building icon/label/link are visible to players, independent of terrain
  exploration (see "Exploration / fog-of-war" below).
- **Open Link** (everyone): click a hex to open whatever Journal Entry,
  Journal page, or Scene it's linked to, subject to normal Foundry
  permissions (see "Linking hexes" below). A small dot in a hex's corner
  marks that it has a link.
- **Align Grid** (GM): drag two on-canvas handles to reposition/resize the
  hex grid instead of typing `originX`/`originY`/`hexRadius` into the
  module settings - a red dot at the grid's origin, a blue dot to resize
  it, with a live preview grid over the scene's background art. Only
  writes once, when you release a handle - into this scene's grid override
  (see "Per-scene settings" below), not the world default.
- **Import Hex Files** (GM): pick one or more `.md` (hex-chronicle
  frontmatter) or `.yaml`/`.yml` files - same format the original CLI tool
  reads - to populate the current scene in one shot.
- **Reset Fog** (GM): clears every hex's explored state for the current
  scene, behind a confirmation dialog - it's irreversible and affects the
  whole party at once.
- **Hex Overview** (GM): a dashboard over every authored hex on the current
  scene - stats (terrain/notes/link/icon counts), combinable filters
  (terrain, zone, notes, link), inline click-to-edit for a hex's label/
  notes/zone tags, per-row terrain/structure reveal toggles, and batched
  bulk actions (reveal/hide terrain or structure, add/remove a zone tag)
  across a multi-row selection - all without hunting for hexes on the map
  or opening the full editor one at a time.
- **Toggle Legend** (everyone): shows/hides a small on-screen panel with
  the terrain colors and zone-position numbering actually used on the
  current scene (zone *tags* like "secured"/"dangerous" are GM-only in
  this panel too, matching the map itself).

## Fine-grained terrain zones

A hex isn't just one terrain type - "mixed terrain" lets part of a hex be
something else (a lake in the corner of a plains hex, say), positioned by
zone. Each hex is divided into **24 zones**: `N1`-`N12` ring the outer
half, `C1`-`C12` ring the center half - the on-screen legend's "Zone
positions" panel shows exactly where each number sits. Roads and rivers
anchor to the same 12 outer positions (`N1`-`N12`) plus the single center
point `C`.

The original 7-token vocabulary (`N`/`NE`/`SE`/`S`/`SW`/`NW`/`C`) from the
Python tool still works everywhere - typed into the text fallback, in
imported files, in old saved hexes - and is expanded to its fine
equivalent automatically every time it's read. Nothing needs migrating;
a hex only starts storing the new tokens once it's next saved.

## Exploration / fog-of-war

Fog-of-war has two independent layers, so a hex's terrain and whatever's
*built* on it can be revealed separately:

- **Terrain**: hexes a group hasn't explored yet are drawn as "unknown"
  (gray, no icon/label/roads/rivers/link) to non-GM players; the GM always
  sees everything. A hex's terrain can be revealed:
  - **Manually**, with the "Reveal/Hide Terrain" tool, or
  - **Automatically**, when a player token moves into it (toggle in module
    settings, along with how many rings of neighboring hexes to reveal too).
- **Structure**: even once a hex's terrain is explored, its building icon,
  label, and any linked Journal/Scene stay hidden from players until the
  GM separately reveals them - with the "Reveal/Hide Structure" tool, or
  the "Structure revealed to players" checkbox in the hex editor. This is
  never automatic (finding a hidden fort/ruin is normally a deliberate
  narrative beat, not just walking through the hex), and it only applies to
  hexes that actually have a building icon set - a hex with no icon has
  nothing to "discover" beyond its terrain.

Both are shared by the whole party (one state per hex, not per player).

**Secrecy is "soft"**: hex content isn't cryptographically hidden from
players - it lives in a normal Scene flag, which any client with scene
access can technically read via the browser console. Only the *rendering*
respects the fog. This is a deliberate v1 trade-off to avoid needing a
GM-authoritative socket relay; it's fine for the overwhelming majority of
groups, but if you need real secrecy, that would be a future enhancement,
not something this version provides.

Auto-reveal only takes effect while the GM's client is connected (the GM
client is the one that writes the "explored" flag, since only the GM has
write permission on the Scene by default).

## Linking hexes to Journals and Scenes

A hex can carry a `link` to a Journal Entry, a specific page in one, or a
Scene - the hex-chronicle equivalent of Foundry's native Journal/Scene Note
pins, but attached to the hex itself. In the hex editor, either paste a
document UUID into the "Linked Journal/Scene" field or drag the document
from the sidebar onto it (same convention Foundry's own document-link
fields use). The "Open Link" canvas tool - available to GM and players
alike - resolves and opens it: a Scene link calls `Scene#view()` to
activate it, a Journal Entry/page link opens its sheet. Normal Foundry
document permissions apply automatically, and a link is subject to the
same structure-reveal gating as a hex's icon (see above) - players can't
open a link they haven't discovered yet.

## Settings

World-level defaults, in Foundry's "Configure Settings":

- Hex radius (px) and grid origin (X/Y) - position the hex overlay anywhere
  on the scene; it doesn't depend on the Scene's own configured grid type.
- Auto-reveal on/off, and its radius in hex-rings.
- A JSON palette override to customize terrain/zone colors, e.g.:
  `{"terrain": {"plains": "#90ee90"}, "zone": {"dangerous": "#ff0000"}}`.

Any of these can be overridden per scene from a **Hex Chronicle** tab added
to Foundry's own Scene Configuration sheet (gear icon on a scene in the
Scenes sidebar) - see "Per-scene settings" below.

## Per-scene settings

The Scene Configuration sheet gets an extra **Hex Chronicle** tab (GM-only,
same as the rest of Scene Configuration):

- **Enable Hex Chronicle on this scene** - off by default only if you
  explicitly turn it off; on for every existing and new scene otherwise.
  Turning it off hides the entire Hex Chronicle toolbar group and its grid
  on that scene, for GM and players alike - useful for scenes that aren't
  hex-crawl maps (a tavern interior, a battle map, ...).
- Per-scene overrides for grid position/size, auto-reveal, and the color
  palette, each behind its own "Override for this scene" checkbox - left
  unchecked, that scene just uses the world-level setting above. The
  **Align Grid** canvas tool (see "Usage" above) writes directly into this
  scene's grid override when dragged, rather than the world setting - it's
  always dragged against one specific scene's background art, so writing
  world-wide would silently misalign every other scene using the same grid
  numbers.

## Verifying this build

There's no automated test harness for Foundry modules; verify manually in a
real v13 or v14 world:

1. Enable the module, create a Scene, open the Hex Chronicle controls.
2. Click a few hexes with "Edit Hex" and confirm the form opens, saves, and
   the hex redraws immediately.
3. Import the sample files in `test_files/` and compare the result against
   the original project's `hexgrid-example.svg` (terrain colors, mixed-zone
   slices, road/river curves, icons, coordinate numbers, and
   `test-zone-with-hole.yaml`'s dashed boundary with a hole).
4. Reload the scene and confirm the map re-renders identically from the
   saved flag data.
5. Log in as a non-GM player in a second session and confirm unexplored
   hexes render as "unknown", the terrain/structure reveal tools are hidden,
   and moving a token into a hex reveals its terrain automatically (with
   auto-reveal on and the GM client connected).
6. On a hex with a building icon, confirm the player sees its terrain but
   not the icon/label/link marker until "Reveal/Hide Structure" is used (or
   the editor's checkbox is ticked) - then confirm it appears.
7. Set a hex's link to a Journal Entry (drag one from the sidebar onto the
   editor field) and confirm both GM and player can open it with "Open
   Link" once the hex/structure is visible to them.
8. Open Hex Overview from the toolbar and confirm its stats/counts match
   what's actually authored on the scene.
9. Filter by terrain, by zone, and by each tri-state toggle; confirm the
   row count and the "no matches" state behave correctly, and that filters
   survive a re-render triggered by an edit elsewhere.
10. Edit a hex's label and notes inline from Hex Overview; confirm it
    persists (reload the scene) and matches what the full "Edit Hex" form
    shows for that hex.
11. Add and remove a zone tag inline on one hex from Hex Overview.
12. Select several hexes in Hex Overview and run each bulk action (reveal/
    hide terrain, reveal/hide structure, add/remove zone tag); confirm
    exactly one scene update per action (watch dev tools) and that the
    affected hexes' state is correct afterward, for both GM and a
    connected player client where relevant (terrain/structure reveal).
13. Confirm a hex's notes never appear anywhere in player-facing rendering
    (canvas draw, legend) - Hex Overview and "Edit Hex" are the only
    GM-only surfaces that show them.
14. Open a Scene's Configuration sheet and confirm the "Hex Chronicle" tab
    appears alongside the core tabs, switches cleanly both ways (no overlap
    with a core tab's content), and its fields reflect that scene's current
    state.
15. Uncheck "Enable Hex Chronicle on this scene", save, and confirm the
    whole toolbar group disappears for both GM and a connected player, and
    the grid stops drawing; re-check it and confirm both come back.
16. Turn on the grid override, set a different radius/origin, save, and
    confirm the map redraws at the new size/position on that scene only -
    switch to another scene and confirm it still uses the world default (or
    its own override). Then use the Align Grid canvas tool on the
    overridden scene and confirm it updates that scene's override (not the
    world setting, and not another scene's grid).
17. Turn on the auto-reveal override with it disabled, move a player token
    into an unexplored hex on that scene, and confirm it does NOT auto
    reveal, while a scene without the override still does (per the world
    setting).
18. Turn on the palette override with different colors than the world
    setting, save, and confirm only that scene's terrain colors change
    (including in the hex editor's diagram and the legend for that scene).
