/**
 * "Explored" state for hex-crawl fog-of-war (see plan §Exploração/fog-of-war).
 *
 * Secrecy is intentionally *soft*: full hex content still lives in the
 * `hexes` scene flag, readable by any client with scene access. This module
 * only gates *rendering* - unexplored hexes are drawn as "unknown" for
 * non-GM users (see render.js). A determined player could read the raw
 * flag data from the browser console; that trade-off (documented in the
 * README) is deliberate for v1 in exchange for not needing a GM-authoritative
 * socket relay.
 *
 * Exploration is shared by the whole party (one boolean per hex, not per
 * user), stored in its own flag key (separate from `hexes`) so resetting or
 * mass-revealing fog never touches authored content.
 *
 * Both reveal triggers below are only ever *acted on* by the GM's client
 * (game.user.isGM guards), since only the GM has write permission on the
 * Scene document - this avoids needing any custom socket protocol, at the
 * cost of auto-reveal only working while a GM client is connected.
 */
import { MODULE_ID, getRadius, getOrigin, isAutoRevealEnabled, getAutoRevealRadius } from "./settings.js";
import { hexKey } from "./data-model.js";
import { neighborsWithinRange, pointToHex } from "./geometry.js";

export function getExploredMap(scene = canvas.scene) {
  return scene?.getFlag(MODULE_ID, "explored") ?? {};
}

export function isExplored(col, row, scene = canvas.scene) {
  return !!getExploredMap(scene)[hexKey(col, row)];
}

export async function revealHex(col, row, scene = canvas.scene) {
  return revealArea(col, row, 0, scene);
}

export async function revealArea(col, row, radius, scene = canvas.scene) {
  const cells = neighborsWithinRange(col, row, radius);
  const current = getExploredMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = true;
  return scene.setFlag(MODULE_ID, "explored", merged);
}

export async function toggleHex(col, row, scene = canvas.scene) {
  const key = hexKey(col, row);
  const current = getExploredMap(scene);
  const merged = { ...current, [key]: !current[key] };
  return scene.setFlag(MODULE_ID, "explored", merged);
}

export async function resetFog(scene = canvas.scene) {
  return scene.unsetFlag(MODULE_ID, "explored");
}

/** Registers the automatic reveal-on-token-move trigger. Only the GM's
 * client acts on this hook (see module docstring above). Reacts to the
 * TokenDocument update itself (final position), not per-animation-frame
 * canvas refreshes, so it fires once per completed move regardless of
 * client-side movement animation. */
export function registerAutoRevealHook() {
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (!game.user.isGM) return;
    if (!isAutoRevealEnabled()) return;
    if (!("x" in changes) && !("y" in changes)) return;
    if (!tokenDoc.hasPlayerOwner) return;

    const gridSize = canvas.grid.size;
    const cx = tokenDoc.x + (tokenDoc.width * gridSize) / 2;
    const cy = tokenDoc.y + (tokenDoc.height * gridSize) / 2;
    const hex = pointToHex(cx, cy, getRadius(), getOrigin());
    if (!hex) return;

    revealArea(hex.col, hex.row, getAutoRevealRadius(), tokenDoc.parent).then(() => {
      canvas.hexChronicle?.refresh();
    });
  });
}
