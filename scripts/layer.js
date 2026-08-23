/**
 * The interactive canvas overlay. Registered into CONFIG.Canvas.layers
 * (see init.js) under the key "hexChronicle", with its own scene-control
 * group. Most of that group's tools are one-shot dialogs/toggles handled
 * entirely in init.js (import, reset fog, the hex overview, the legend);
 * this layer only owns the tools that need direct canvas interaction:
 * edit a hex's content (GM), reveal/hide a hex's terrain (GM), reveal/hide
 * a hex's structure (GM), open a hex's linked Journal/Scene (everyone,
 * subject to normal Foundry permissions), and drag the grid's
 * origin/radius into alignment with custom background art (GM) - see
 * updateAlignHandles() below for that last one.
 *
 * NOTE: this targets the ApplicationV2-era Foundry API (v13/v14) described
 * in the plan. Exercised live against a real v13 world, both as GM and as
 * a non-GM player - see the inline comments below for what that live
 * testing turned up.
 */
import { getRadius, getOrigin, setOrigin, setRadius } from "./settings.js";
import { pointToHex, hexShapePoints, neighborsWithinRange } from "./geometry.js";
import { renderHexes } from "./render.js";
import { toggleHex, toggleStructure, getEffectiveContent } from "./fog.js";
import { HexEditor } from "./hex-editor.js";
import { openHexLink } from "./links.js";

const ALIGN_PREVIEW_RANGE = 4;
const ORIGIN_HANDLE_COLOR = 0xff3366;
const RADIUS_HANDLE_COLOR = 0x33ccff;

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
  alignHandles = null;
  #hoveredKey = null;
  #flashTimeout = null;
  #dragTarget = null; // "origin" | "radius" | null
  #dragOrigin = null;
  #dragRadius = null;

  async _draw(options) {
    await super._draw(options);
    this.container = this.addChild(new PIXI.Container());
    // Drawn as a sibling on top of `container`, not inside it, so refresh()
    // freely destroying/rebuilding container's children (see below) never
    // touches whatever's currently highlighted.
    this.highlight = this.addChild(new PIXI.Graphics());
    // Same reasoning: the align tool's drag handles (see updateAlignHandles
    // below) live on top of everything else and are rebuilt independently
    // of a content refresh().
    this.alignHandles = this.addChild(new PIXI.Container());
    this.alignHandles.visible = false;
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
    this.alignHandles.visible = false;
  }

  /** Outlines whichever hex is currently under the cursor, so a viewer can
   * tell what a click will land on before committing to it - for every tool
   * in this group, GM or not (it's pure geometry, nothing content-gated
   * about it). Keyed by "col,row" to skip redrawing on every pixel of mouse
   * movement within the same cell. */
  _onHover(event) {
    if (!canvas.scene) return;
    if (this.#dragTarget) {
      this._updateDrag(event);
      return;
    }
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

  /** One-off highlight flash for a specific hex, in a different color from
   * the hover outline so it reads as "the camera just centered here" rather
   * than "your cursor is here". Works even while this layer isn't the
   * active control (the graphics object is always present - only pointer
   * event handling is gated by activation) - used by the hex overview's
   * "go to" button so a GM gets visual confirmation of where the camera
   * jumped to. */
  flashHex(col, row, duration = 1200) {
    if (!this.highlight) return;
    const radius = getRadius();
    const origin = getOrigin();
    const pts = hexShapePoints(col, row, radius, origin);
    const flat = pts.flatMap((p) => [p.x, p.y]);
    this.highlight.clear();
    this.highlight.lineStyle(Math.max(2, radius / 10), 0xffcc00, 1);
    this.highlight.beginFill(0xffcc00, 0.15);
    this.highlight.drawPolygon(flat);
    this.highlight.endFill();

    clearTimeout(this.#flashTimeout);
    this.#flashTimeout = setTimeout(() => {
      // Don't clobber a real hover outline that started during the flash.
      if (this.#hoveredKey === null) this.highlight.clear();
    }, duration);
  }

  async refresh() {
    if (!this.container || !canvas.scene) return;
    await renderHexes(this.container, canvas.scene, { isGM: game.user.isGM });
  }

  /** Shows/hides the align tool's two drag handles + preview grid, called
   * from init.js's renderSceneControls hook (which - confirmed live - fires
   * on every tool click, not just switching control groups, so this stays
   * correct whether the GM just entered "align" or just left it for another
   * tool in this same group). GM-only, same as the tool's own `visible`
   * gate in init.js. */
  updateAlignHandles() {
    if (!this.alignHandles) return;
    const isAlignTool = ui.controls.control?.name === "hexChronicle" && (ui.controls.tool?.name ?? ui.controls.activeTool) === "align";
    this.alignHandles.visible = isAlignTool && game.user.isGM;
    if (this.alignHandles.visible) this._drawAlignHandles();
    else {
      this.#dragTarget = null;
      this.#dragOrigin = null;
      this.#dragRadius = null;
    }
  }

  /** Preview grid (a few rings around the col=0,row=0 hex, so the GM can
   * see how it sits against the scene's background art) plus the two
   * draggable handles - red for origin, blue for radius, connected by a
   * thin line so the relationship between them reads clearly. Uses
   * whatever's currently being dragged (#dragOrigin/#dragRadius) if a drag
   * is in progress, otherwise the real committed settings. */
  _drawAlignHandles() {
    this.alignHandles.removeChildren().forEach((c) => c.destroy({ children: true }));
    const origin = this.#dragOrigin ?? getOrigin();
    const radius = this.#dragRadius ?? getRadius();

    const grid = new PIXI.Graphics();
    grid.lineStyle(Math.max(1, radius / 30), ORIGIN_HANDLE_COLOR, 0.6);
    for (const [c, r] of neighborsWithinRange(0, 0, ALIGN_PREVIEW_RANGE)) {
      const pts = hexShapePoints(c, r, radius, origin);
      grid.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
    }
    this.alignHandles.addChild(grid);

    const link = new PIXI.Graphics();
    link.lineStyle(1, 0xffffff, 0.6).moveTo(origin.x, origin.y).lineTo(origin.x + radius, origin.y);
    this.alignHandles.addChild(link);

    const originHandle = this._makeAlignHandle(ORIGIN_HANDLE_COLOR, 11, "grab");
    originHandle.position.set(origin.x, origin.y);
    originHandle.on("pointerdown", (event) => this._startDrag("origin", event));
    this.alignHandles.addChild(originHandle);

    const radiusHandle = this._makeAlignHandle(RADIUS_HANDLE_COLOR, 9, "ew-resize");
    radiusHandle.position.set(origin.x + radius, origin.y);
    radiusHandle.on("pointerdown", (event) => this._startDrag("radius", event));
    this.alignHandles.addChild(radiusHandle);
  }

  _makeAlignHandle(color, size, cursor) {
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0xffffff, 1).beginFill(color, 1).drawCircle(0, 0, size).endFill();
    g.eventMode = "static";
    g.cursor = cursor;
    return g;
  }

  _startDrag(target, event) {
    event.stopPropagation();
    this.#dragTarget = target;
    this.#dragOrigin = { ...getOrigin() };
    this.#dragRadius = getRadius();
  }

  _updateDrag(event) {
    const local = event.getLocalPosition(this);
    if (this.#dragTarget === "origin") {
      this.#dragOrigin = { x: local.x, y: local.y };
    } else if (this.#dragTarget === "radius") {
      // Horizontal distance from the origin handle - matches how the
      // radius handle is positioned (origin.x + radius, origin.y) and
      // keeps the gesture a simple, predictable "drag right to grow".
      this.#dragRadius = Math.max(10, local.x - this.#dragOrigin.x);
    }
    this._drawAlignHandles();
  }

  /** Commits the in-progress drag to the world settings - once, on
   * release, not per pointermove frame (see settings.js's setOrigin/
   * setRadius docs for why). Their own onChange already refreshes the
   * normal hex content layer; this only needs to redraw the handles
   * themselves at their new, now-real position. */
  async _commitDrag() {
    const target = this.#dragTarget;
    this.#dragTarget = null;
    if (target === "origin") {
      await setOrigin(this.#dragOrigin.x, this.#dragOrigin.y);
    } else if (target === "radius") {
      await setRadius(this.#dragRadius);
    }
    this.#dragOrigin = null;
    this.#dragRadius = null;
    this._drawAlignHandles();
  }

  _onClickLeft(event) {
    if (this.#dragTarget) {
      this._commitDrag();
      return;
    }
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
