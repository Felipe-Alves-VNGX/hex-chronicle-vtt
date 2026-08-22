/**
 * The interactive canvas overlay. Registered into CONFIG.Canvas.layers
 * (see init.js) under the key "hexChronicle", with its own scene-control
 * group offering five tools: edit a hex's content (GM), reveal/hide a
 * hex's terrain (GM), reveal/hide a hex's structure (GM), open a hex's
 * linked Journal/Scene (everyone, subject to normal Foundry permissions),
 * and bulk-import a file (GM).
 *
 * NOTE: this targets the ApplicationV2-era Foundry API (v13/v14) described
 * in the plan. Exercised live against a real v13 world, both as GM and as
 * a non-GM player - see the inline comments below for what that live
 * testing turned up.
 */
import { getRadius, getOrigin } from "./settings.js";
import { pointToHex, hexShapePoints } from "./geometry.js";
import { renderHexes } from "./render.js";
import { toggleHex, toggleStructure, getEffectiveContent } from "./fog.js";
import { HexEditor } from "./hex-editor.js";
import { openHexLink } from "./links.js";

const InteractionLayerBase = foundry.canvas?.layers?.InteractionLayer ?? globalThis.InteractionLayer;

export class HexChronicleLayer extends InteractionLayerBase {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "hexChronicle",
      zIndex: 200,
    });
  }

  container = null;
  highlight = null;
  #hoveredKey = null;

  async _draw(options) {
    await super._draw(options);
    this.container = this.addChild(new PIXI.Container());
    // Drawn as a sibling on top of `container`, not inside it, so refresh()
    // freely destroying/rebuilding container's children (see below) never
    // touches whatever's currently highlighted.
    this.highlight = this.addChild(new PIXI.Graphics());
    this.hitArea = canvas.dimensions.rect;
    // Starts inactive - _activate()/_deactivate() (below) are what actually
    // turn pointer handling on/off, driven by whichever scene-controls
    // group is currently selected.
    this.eventMode = "none";
    // A plain InteractionLayer (unlike PlaceablesLayer) never creates a
    // mouseInteractionManager, so nothing calls _onClickLeft() on its own
    // even though the method name/signature matches Foundry's convention -
    // confirmed live against a real v13 world (PIXI "pointerup" reaches the
    // layer fine; _onClickLeft simply never gets invoked without this).
    this.on("pointerup", this._onClickLeft.bind(this));
    this.on("pointermove", this._onHover.bind(this));
    this.on("pointerout", this._clearHighlight.bind(this));
    await this.refresh();
  }

  _activate() {
    super._activate();
    // Only steal pointer events from whatever's underneath (tokens, walls,
    // ...) while our own tool group is actually selected. Without this the
    // layer stayed interactive permanently (set once in _draw and never
    // revisited), so clicking anywhere on the canvas - with ANY tool from
    // ANY control group - hit our handler too, confirmed live.
    this.eventMode = "static";
  }

  _deactivate() {
    super._deactivate();
    this.eventMode = "none";
    this._clearHighlight();
  }

  /** Outlines whichever hex is currently under the cursor, so a viewer can
   * tell what a click will land on before committing to it - for every tool
   * in this group, GM or not (it's pure geometry, nothing content-gated
   * about it). Keyed by "col,row" to skip redrawing on every pixel of mouse
   * movement within the same cell. */
  _onHover(event) {
    if (!canvas.scene) return;
    const local = event.getLocalPosition(this);
    const hex = pointToHex(local.x, local.y, getRadius(), getOrigin());
    const key = hex ? `${hex.col},${hex.row}` : null;
    if (key === this.#hoveredKey) return;
    this.#hoveredKey = key;

    this.highlight.clear();
    if (!hex) return;
    const pts = hexShapePoints(hex.col, hex.row, getRadius(), getOrigin());
    const flat = pts.flatMap((p) => [p.x, p.y]);
    this.highlight.lineStyle(Math.max(2, getRadius() / 12), 0xffffff, 0.9);
    this.highlight.beginFill(0xffffff, 0.12);
    this.highlight.drawPolygon(flat);
    this.highlight.endFill();
  }

  _clearHighlight() {
    this.#hoveredKey = null;
    this.highlight?.clear();
  }

  async refresh() {
    if (!this.container || !canvas.scene) return;
    await renderHexes(this.container, canvas.scene, { isGM: game.user.isGM });
  }

  _onClickLeft(event) {
    super._onClickLeft(event);
    if (!canvas.scene) return;

    const local = event.getLocalPosition(this);
    const hex = pointToHex(local.x, local.y, getRadius(), getOrigin());
    if (!hex) return;

    // ui.controls.control.activeTool is just the control's static default
    // and is never updated after a tool click - confirmed live against a
    // real v13 world. The tool actually selected right now lives on
    // ui.controls.tool.name; ui.controls.activeTool is the old (now
    // deprecated-with-warning) accessor for the same value - fall back to
    // it only if .tool isn't there for some reason.
    const tool = ui.controls.tool?.name ?? ui.controls.activeTool;

    if (tool === "open") {
      // Available to everyone - getEffectiveContent() already strips the
      // link for anything the current viewer hasn't discovered yet, so
      // there's nothing extra to gate here.
      const content = getEffectiveContent(hex.col, hex.row, canvas.scene, game.user.isGM);
      openHexLink(content.link);
      return;
    }

    if (!game.user.isGM) return; // every other tool is GM-only in v1
    if (tool === "reveal") {
      toggleHex(hex.col, hex.row).then(() => this.refresh());
      return;
    }
    if (tool === "revealStructure") {
      toggleStructure(hex.col, hex.row).then(() => this.refresh());
      return;
    }
    // Explicit check, not a bare fallback: with the layer only interactive
    // while active (see _activate() above) this shouldn't be reachable
    // with an unrecognized tool anymore, but it's cheap insurance against
    // ever again silently opening the editor for a tool that isn't "edit".
    if (tool === "edit") {
      new HexEditor({ col: hex.col, row: hex.row }).render(true);
    }
  }
}
