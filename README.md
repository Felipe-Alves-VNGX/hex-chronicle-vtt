# Hex Chronicle (FoundryVTT)

An interactive hex-crawl map layer for FoundryVTT (v13/v14): draw a hex grid
directly on a Scene, edit each hex's terrain/icon/roads/rivers/zone through a
form, import existing hex-chronicle Markdown/YAML files in bulk, and let
players explore the map hex by hex with a simple fog-of-war.

This is a JavaScript port of **[hex-chronicle](https://github.com/)**, a
Python CLI tool by **Guillaume Fouillet** that generates static SVG hex maps
from the same file format. See [CREDITS.md](CREDITS.md) for full attribution
(hex-chronicle, its icon assets from game-icons.net, and the vendored
js-yaml library).

> **Status**: early port (see the project plan). The Foundry-API-facing code
> (canvas layer registration, ApplicationV2 forms, scene-controls hook) has
> not yet been exercised against a real running Foundry client - it was
> written against current v13/v14 API documentation but should be verified
> in a real world before relying on it. See "Verifying this build" below.

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
- **Reveal/Hide Hex** (GM only): click a hex to toggle whether players can
  see it (see "Exploration / fog-of-war" below).
- **Import Hex Files** (GM only): pick one or more `.md` (hex-chronicle
  frontmatter) or `.yaml`/`.yml` files - same format the original CLI tool
  reads - to populate the current scene in one shot.

## Exploration / fog-of-war

Hexes a group hasn't explored yet are drawn as "unknown" (gray, no
icon/label/roads/rivers) to non-GM players; the GM always sees everything.
Exploration is shared by the whole party (one state per hex, not per
player), and a hex can be revealed:

- **Manually**, with the "Reveal/Hide Hex" tool, or
- **Automatically**, when a player token moves into it (toggle in module
  settings, along with how many rings of neighboring hexes to reveal too).

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
   hexes render as "unknown", the reveal tool is hidden, and moving a token
   into a hex reveals it automatically (with auto-reveal on and the GM
   client connected).
