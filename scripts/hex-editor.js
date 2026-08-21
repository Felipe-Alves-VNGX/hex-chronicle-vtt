/**
 * Per-hex content editor. ApplicationV2 form (FormApplication is deprecated
 * and slated for removal in Foundry v16 - see plan). Mixed terrain,
 * roads and rivers are edited as small line-based text fields rather than
 * a fully dynamic add/remove-row UI, to keep the v1 form simple:
 *
 *   mixedTerrain: "lake: C\nmarsh: SW"
 *   roads/rivers: "SW SE" (one path per line)
 *   zone: "secured, dangerous" (comma-separated)
 */
import { MODULE_ID } from "./settings.js";
import { normalizeHexContent, hexKey, TERRAIN_TYPES } from "./data-model.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function splitLines(text) {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function parseMixedTerrain(text) {
  return splitLines(text).map((line) => {
    const [type, sides] = line.split(":");
    return { type: (type ?? "").trim(), sides: (sides ?? "").trim().split(/\s+/).filter(Boolean) };
  });
}

export class HexEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ col, row }, options = {}) {
    super(options);
    this.col = col;
    this.row = row;
  }

  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-editor",
    tag: "form",
    window: { title: "HEXCHRON.EditorTitle", contentClasses: ["hex-chronicle-editor"] },
    position: { width: 420 },
    form: { handler: HexEditor.#onSubmit, submitOnChange: false, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/hex-editor.hbs` },
  };

  get title() {
    return game.i18n.format("HEXCHRON.EditorTitle", { col: this.col, row: this.row });
  }

  async _prepareContext() {
    const scene = canvas.scene;
    const raw = scene.getFlag(MODULE_ID, "hexes")?.[hexKey(this.col, this.row)] ?? {};
    const content = normalizeHexContent(raw);
    return {
      col: this.col,
      row: this.row,
      terrainTypes: TERRAIN_TYPES,
      terrainType: content.terrain.type ?? "",
      mixedTerrain: content.terrain.mixed.map((m) => `${m.type}: ${m.sides.join(" ")}`).join("\n"),
      alt: content.alt,
      icon: content.icon,
      roads: content.roads.join("\n"),
      rivers: content.rivers.join("\n"),
      zone: content.zone.join(", "),
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const raw = {
      terrain: {
        type: data.terrainType || undefined,
        mixed: parseMixedTerrain(data.mixedTerrain),
      },
      alt: data.alt,
      icon: data.icon,
      roads: splitLines(data.roads),
      rivers: splitLines(data.rivers),
      zone: data.zone
        ? data.zone.split(",").map((z) => z.trim()).filter(Boolean)
        : [],
    };
    const content = normalizeHexContent(raw);

    const scene = canvas.scene;
    await scene.setFlag(MODULE_ID, `hexes.${hexKey(this.col, this.row)}`, content);
    await canvas.hexChronicle?.refresh();
  }
}
