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

> **Status**: verified against a real Foundry v13 (Build 351) world as of
> v0.2.3. Confirmed working: the module loads and the layer registers with
> no errors, the Hex Chronicle scene-controls tab activates the layer, all
> four canvas-click tools (Edit, Reveal Terrain, Reveal Structure, Open
> Link) resolve the right hex and do the right thing, the editor form
> renders and saves correctly, and a scene with zero hexes now shows a
> starter grid instead of nothing. Not yet click-tested live: mixed terrain
> rendering, road/river curves, zone boundary dashing, and bulk import -
> these go through the same rendering/data-model code paths already
> exercised, but haven't been eyeballed directly. See "Verifying this
> build" below if you want to confirm them yourself.

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

- A new **Hex Chronicle** control group appears in the scene controls
  (left toolbar) when a scene is active.
- **Edit Hex** (GM only): click a hex cell to open its editor - terrain
  type, mixed terrain overrides, building icon, label, roads, rivers, and
  zones. See the field hints in the form; the metadata mirrors the original
  Markdown frontmatter format field-for-field.
- **Reveal/Hide Terrain** (GM only): click a hex to toggle whether players
  can see its terrain at all (see "Exploration / fog-of-war" below).
- **Reveal/Hide Structure** (GM only): click a hex to toggle whether its
  building icon/label/link are visible to players, independent of terrain
  exploration (see "Exploration / fog-of-war" below).
- **Open Link** (everyone): click a hex to open whatever Journal Entry,
  Journal page, or Scene it's linked to, subject to normal Foundry
  permissions (see "Linking hexes" below). A small dot in a hex's corner
  marks that it has a link.
- **Import Hex Files** (GM only): pick one or more `.md` (hex-chronicle
  frontmatter) or `.yaml`/`.yml` files - same format the original CLI tool
  reads - to populate the current scene in one shot.

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

- Hex radius (px) and grid origin (X/Y) - position the hex overlay anywhere
  on the scene; it doesn't depend on the Scene's own configured grid type.
- Auto-reveal on/off, and its radius in hex-rings.
- A JSON palette override to customize terrain/zone colors, e.g.:
  `{"terrain": {"plains": "#90ee90"}, "zone": {"dangerous": "#ff0000"}}`.

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
