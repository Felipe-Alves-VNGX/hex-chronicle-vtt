/**
 * The interactive canvas overlay. Registered into CONFIG.Canvas.layers
 * (see init.js) under the key "hexChronicle", with its own scene-control
 * group offering five tools: edit a hex's content (GM), reveal/hide a
 * hex's terrain (GM), reveal/hide a hex's structure (GM), open a hex's
 * linked Journal/Scene (everyone, subject to normal Foundry permissions),
 * and bulk-import a file (GM).
 *
 * NOTE: this targets the ApplicationV2-era Foundry API (v13/v14) described
 * in the plan. It has not been exercised inside a real Foundry client in
 * this environment (no Foundry install available here) - verify against a
 * live v13 or v14 world per the plan's verification section before relying
 * on it, and expect to adjust field names in the scene-controls hook if the
 * exact object shape has moved since this was written.
 */
import { getRadius, getOrigin } from "./settings.js";
import { pointToHex } from "./geometry.js";
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

  async _draw(options) {
    await super._draw(options);
    this.container = this.addChild(new PIXI.Container());
    this.hitArea = canvas.dimensions.rect;
    this.eventMode = "static";
    await this.refresh();
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

    const tool = ui.controls.control?.activeTool;

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
    new HexEditor({ col: hex.col, row: hex.row }).render(true);
  }
}
