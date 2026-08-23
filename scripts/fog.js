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
import { hexKey, normalizeHexContent, stripStructure } from "./data-model.js";
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

/** Sets the same explored value for several hexes in one write - the Hex
 * Overview's bulk "Reveal/Hide Terrain" actions use this instead of one
 * toggleHex()/setFlag() per selected row. */
export async function setExploredMany(cells, value, scene = canvas.scene) {
  const current = getExploredMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = value;
  return scene.setFlag(MODULE_ID, "explored", merged);
}

export async function resetFog(scene = canvas.scene) {
  return scene.unsetFlag(MODULE_ID, "explored");
}

/** UI entry point for the "Reset Fog" scene-control button (layer.js/
 * init.js): confirms before wiping every hex's explored state back to
 * unknown for the whole party - resetFog() itself has no undo, so this is
 * the only guard against a stray click. */
export async function confirmResetFog(scene = canvas.scene) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("HEXCHRON.ResetFogTitle") },
    content: `<p>${game.i18n.localize("HEXCHRON.ResetFogConfirm")}</p>`,
  });
  if (!confirmed) return;
  await resetFog(scene);
  await canvas.hexChronicle?.refresh();
  ui.notifications.info(game.i18n.localize("HEXCHRON.ResetFogSuccess"));
}

/**
 * "Structure discovered" state - a second, independent fog layer gating
 * only a hex's *explicit building icon* (and its label/link, see
 * data-model.js's stripStructure), not its terrain. Lets a hex read as
 * "explored forest" to players while a hidden ruin/fort on it stays
 * unknown until the GM specifically reveals it - unlike terrain, this is
 * never auto-revealed by token movement, since "finding" a structure is
 * normally a deliberate narrative/GM decision, not just walking through
 * the hex.
 */
export function getStructureRevealedMap(scene = canvas.scene) {
  return scene?.getFlag(MODULE_ID, "structuresRevealed") ?? {};
}

export function isStructureRevealed(col, row, scene = canvas.scene) {
  return !!getStructureRevealedMap(scene)[hexKey(col, row)];
}

export async function toggleStructure(col, row, scene = canvas.scene) {
  const key = hexKey(col, row);
  const current = getStructureRevealedMap(scene);
  return scene.setFlag(MODULE_ID, "structuresRevealed", { ...current, [key]: !current[key] });
}

export async function setStructureRevealed(col, row, value, scene = canvas.scene) {
  const key = hexKey(col, row);
  const current = getStructureRevealedMap(scene);
  return scene.setFlag(MODULE_ID, "structuresRevealed", { ...current, [key]: !!value });
}

/** Bulk counterpart to setStructureRevealed(), same one-write shape as
 * setExploredMany() above. */
export async function setStructureRevealedMany(cells, value, scene = canvas.scene) {
  const current = getStructureRevealedMap(scene);
  const merged = { ...current };
  for (const [c, r] of cells) merged[hexKey(c, r)] = !!value;
  return scene.setFlag(MODULE_ID, "structuresRevealed", merged);
}

/** Raw, un-gated hex content (normalized), or null if nothing is authored
 * there yet. Only ever call this for GM-side logic; player-facing code
 * should use getEffectiveContent() below. */
export function getRawHexContent(col, row, scene = canvas.scene) {
  const raw = scene?.getFlag(MODULE_ID, "hexes")?.[hexKey(col, row)];
  return raw ? normalizeHexContent(raw) : null;
}

/** The content a given viewer is actually allowed to see for one hex: the
 * GM always sees everything; a non-GM viewer sees "unknown" terrain for an
 * unexplored hex, and - even once explored - has any structure (building
 * icon/label/link) stripped until it's been separately revealed. This is
 * the single source of truth for hex visibility, shared by render.js
 * (drawing) and layer.js (the "Open Link" tool, so it can't leak a link
 * the player shouldn't see yet). */
export function getEffectiveContent(col, row, scene = canvas.scene, isGM = game.user.isGM) {
  if (isGM) return getRawHexContent(col, row, scene) ?? normalizeHexContent({});
  if (!isExplored(col, row, scene)) return normalizeHexContent({ terrain: { type: "unknown" } });

  const content = getRawHexContent(col, row, scene) ?? normalizeHexContent({});
  if (content.icon && !isStructureRevealed(col, row, scene)) return stripStructure(content);
  return content;
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
