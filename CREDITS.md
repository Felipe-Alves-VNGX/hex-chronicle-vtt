# Credits

## hex-chronicle

This module ports the hex-grid rendering logic (terrain zones, mixed terrain,
roads/rivers, zone boundaries, coordinate numbering) and the concept of a
7-zone hexagon subdivision from **hex-chronicle**, a Python CLI tool by
**Guillaume FOUILLET**.

- Original project: hex-chronicle (Python)
- License: MIT, Copyright (c) 2022 Guillaume FOUILLET - see `LICENSE-hex-chronicle`
  for the verbatim original text.

All geometry in `scripts/geometry.js` and the zone-boundary algorithm concept
in `scripts/zone-cluster.js` are a direct translation of
`classes/hexagon_renderer.py` and `classes/grid_renderer.py` from that
project.

## Icons

The building and terrain icons under `assets/icons/` are copied from
hex-chronicle's `svg_templates/icons/`, which the original project itself
credits to:

- **game-icons.net** - https://game-icons.net/

Please respect game-icons.net's own licensing terms (CC BY 3.0 for most
icons on that site) if you redistribute or modify these assets further.

## Third-party code

- **js-yaml** (`lib/js-yaml.esm.js`), MIT license - used to parse the
  imported `.md`/`.yaml`/`.yml` files client-side. See `lib/js-yaml.LICENSE`.
