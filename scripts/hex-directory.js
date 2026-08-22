/**
 * GM-only directory of every authored hex in the currently viewed scene:
 * a searchable list to read a hex's content at a glance without hunting
 * for it on the map, jump the camera to it ("go to"), or open it in the
 * full editor - the map-scale equivalent of a Journal/Actor sidebar tab,
 * scoped to this module's own data.
 *
 * Reads the *raw* (un-gated) hex content via data-model's
 * normalizeHexContent() directly, not fog.js's getEffectiveContent() -
 * this window is GM-only (see init.js's `visible: game.user.isGM` on the
 * toolbar button that opens it), so there is nothing to hide from its own
 * user.
 *
 * "Dynamic" per the request that prompted this: the list re-renders itself
 * on both a hex-data change in the viewed scene (updateScene) and a scene
 * switch (canvasReady), so it never goes stale while left open - no manual
 * refresh button needed.
 */
import { MODULE_ID, getRadius, getOrigin } from "./settings.js";
import { parseHexKey, normalizeHexContent } from "./data-model.js";
import { tileCenter } from "./geometry.js";
import { HexEditor } from "./hex-editor.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function coordLabel(col, row) {
  return `${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`;
}

export class HexDirectory extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-directory",
    window: { title: "HEXCHRON.DirectoryTitle", icon: "fa-solid fa-table-list", resizable: true, contentClasses: ["hex-chronicle-directory"] },
    position: { width: 480, height: 640 },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-directory.hbs`, scrollable: [".hc-directory-list"] },
  };

  #hooks = [];

  #onUpdateScene = (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) this.render();
  };

  #onCanvasReady = () => this.render();

  async _prepareContext() {
    const scene = canvas.scene;
    const raw = scene?.getFlag(MODULE_ID, "hexes") ?? {};
    const rows = Object.entries(raw)
      .map(([key, data]) => {
        const { col, row } = parseHexKey(key);
        const content = normalizeHexContent(data);
        const mixed = content.terrain.mixed.map((m) => m.type).join(", ");
        const search = [coordLabel(col, row), content.terrain.type, mixed, content.alt, content.icon, content.zone.join(" ")]
          .join(" ")
          .toLowerCase();
        return {
          col,
          row,
          coordLabel: coordLabel(col, row),
          terrain: content.terrain.type || "-",
          mixed,
          alt: content.alt,
          icon: content.icon,
          zone: content.zone.join(", "),
          hasLink: !!content.link,
          search,
        };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);
    return { rows, hasHexes: rows.length > 0, sceneName: scene?.name ?? "" };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hooks.push(["updateScene", Hooks.on("updateScene", this.#onUpdateScene)]);
    this.#hooks.push(["canvasReady", Hooks.on("canvasReady", this.#onCanvasReady)]);
  }

  async close(options) {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks = [];
    return super.close(options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    for (const btn of this.element.querySelectorAll('[data-action="goto"]')) {
      btn.addEventListener("click", () => this.#gotoHex(Number(btn.dataset.col), Number(btn.dataset.row)));
    }
    for (const btn of this.element.querySelectorAll('[data-action="edit"]')) {
      btn.addEventListener("click", () => new HexEditor({ col: Number(btn.dataset.col), row: Number(btn.dataset.row) }).render(true));
    }

    const search = this.element.querySelector('input[name="search"]');
    search?.addEventListener("input", () => this.#applyFilter(search.value));
    if (search?.value) this.#applyFilter(search.value);
  }

  #gotoHex(col, row) {
    const { x, y } = tileCenter(col, row, getRadius(), getOrigin());
    canvas.animatePan({ x, y, duration: 400 });
    canvas.hexChronicle?.flashHex(col, row);
  }

  #applyFilter(text) {
    const query = text.trim().toLowerCase();
    let visible = 0;
    for (const row of this.element.querySelectorAll(".hc-directory-row")) {
      const match = !query || (row.dataset.search ?? "").includes(query);
      row.hidden = !match;
      if (match) visible++;
    }
    const empty = this.element.querySelector(".hc-directory-no-matches");
    if (empty) empty.hidden = visible > 0;
  }
}
