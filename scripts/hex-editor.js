/**
 * Per-hex content editor. ApplicationV2 form (FormApplication is deprecated
 * and slated for removal in Foundry v16 - see plan). Mixed terrain, roads
 * and rivers each have a clickable diagram now (hex-diagram.js), but that's
 * layered on top of - not instead of - the original line-based text
 * fields, which stay reachable as a collapsed fallback:
 *
 *   mixedTerrain: "lake: C4\nmarsh: SW" (both the fine N1..N12/C1..C12
 *     tokens the diagram paints with, and the original N/NE/SE/S/SW/NW/C
 *     ones, work - see geometry.js/data-model.js)
 *   roads/rivers: "SW SE" (one path per line)
 *   zone: "secured, dangerous" (comma-separated) - also has a chip editor
 *     (zone-tag-editor.js) layered on top, same as the diagrams above
 *
 * The "link" field accepts a Foundry document UUID either typed by hand or
 * dropped from the sidebar (a Journal Entry, a specific page, or a Scene) -
 * same drag-and-drop convention Foundry's own document-link fields use.
 * "Structure revealed to players" is a shortcut for the same toggle the
 * "Reveal/Hide Structure" canvas tool provides (see fog.js), so the GM
 * doesn't have to leave the form to flip it.
 */
import { MODULE_ID } from "./settings.js";
import { normalizeHexContent, hexKey, getAllTerrainTypes } from "./data-model.js";
import { isStructureRevealed, setStructureRevealed } from "./fog.js";
import { openHexLink } from "./links.js";
import { attachTerrainDiagram, attachPathDiagram } from "./hex-diagram.js";
import { attachIconPicker } from "./hex-icon-picker.js";
import { attachZoneTagEditor } from "./zone-tag-editor.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function getDragEventData(event) {
  const impl = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return impl?.getDragEventData?.(event) ?? null;
}

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
    window: { title: "HEXCHRON.EditorTitle", contentClasses: ["hex-chronicle-editor"], resizable: true },
    position: { width: 420, height: 680 },
    form: { handler: HexEditor.#onSubmit, submitOnChange: false, closeOnSubmit: true },
  };

  static PARTS = {
    // "" (the part's own root element, i.e. .window-content itself) is what
    // needs to scroll now that the terrain/roads/rivers diagrams (see
    // hex-diagram.js) made the form taller than a lot of screens - without
    // this Foundry leaves overflow-y:hidden on window-content by default,
    // silently clipping everything below the fold (Save button included,
    // confirmed live) instead of scrolling to it.
    form: { template: `modules/${MODULE_ID}/templates/hex-editor.hbs`, scrollable: [""] },
  };

  get title() {
    return game.i18n.format("HEXCHRON.EditorTitle", { col: this.col, row: this.row });
  }

  async _prepareContext() {
    const scene = canvas.scene;
    const allHexes = scene.getFlag(MODULE_ID, "hexes") ?? {};
    const raw = allHexes[hexKey(this.col, this.row)] ?? {};
    const content = normalizeHexContent(raw);
    // Every zone tag already used elsewhere on this scene, offered as
    // autocomplete suggestions - see zone-tag-editor.js.
    const zoneTagSuggestions = new Set();
    for (const hexData of Object.values(allHexes)) {
      for (const tag of normalizeHexContent(hexData).zone) zoneTagSuggestions.add(tag);
    }
    return {
      col: this.col,
      row: this.row,
      // {{selectOptions}} uses the ARRAY INDEX as an <option>'s value when
      // given a plain array - confirmed live: picking "heavy_woods" (index
      // 2) silently saved terrain.type as "2", not "heavy_woods", for
      // every hex ever set through this dropdown. An object maps each
      // option's real value to its own label instead.
      terrainTypes: Object.fromEntries(getAllTerrainTypes().map((t) => [t, t])),
      terrainType: content.terrain.type ?? "",
      mixedTerrain: content.terrain.mixed.map((m) => `${m.type}: ${m.sides.join(" ")}`).join("\n"),
      alt: content.alt,
      notes: content.notes,
      icon: content.icon,
      roads: content.roads.join("\n"),
      rivers: content.rivers.join("\n"),
      zone: content.zone.join(", "),
      zoneTagSuggestions: [...zoneTagSuggestions].sort(),
      link: content.link,
      structureRevealed: isStructureRevealed(this.col, this.row, scene),
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const terrainDiagramRoot = this.element.querySelector(".hc-terrain-diagram-root");
    const terrainTypeSelect = this.element.querySelector('select[name="terrainType"]');
    const mixedTerrainField = this.element.querySelector('textarea[name="mixedTerrain"]');
    if (terrainDiagramRoot && terrainTypeSelect && mixedTerrainField) {
      attachTerrainDiagram(terrainDiagramRoot, { textarea: mixedTerrainField, terrainTypeSelect });
    }

    const pathDiagramRoot = this.element.querySelector(".hc-path-diagram-root");
    const roadsField = this.element.querySelector('textarea[name="roads"]');
    const riversField = this.element.querySelector('textarea[name="rivers"]');
    if (pathDiagramRoot && roadsField && riversField) {
      attachPathDiagram(pathDiagramRoot, { roadsTextarea: roadsField, riversTextarea: riversField });
    }

    const iconPickerRoot = this.element.querySelector(".hc-icon-picker-root");
    const iconInput = this.element.querySelector('input[name="icon"]');
    if (iconPickerRoot && iconInput) {
      attachIconPicker(iconPickerRoot, { input: iconInput });
    }

    const zoneEditorRoot = this.element.querySelector(".hc-zone-editor-root");
    const zoneInput = this.element.querySelector('input[name="zone"]');
    if (zoneEditorRoot && zoneInput) {
      attachZoneTagEditor(zoneEditorRoot, { input: zoneInput, suggestions: context.zoneTagSuggestions ?? [] });
    }

    const linkInput = this.element.querySelector('input[name="link"]');
    if (linkInput) {
      linkInput.addEventListener("dragover", (event) => event.preventDefault());
      linkInput.addEventListener("drop", (event) => {
        event.preventDefault();
        const data = getDragEventData(event);
        if (data?.uuid) linkInput.value = data.uuid;
      });
    }

    this.element.querySelector('[data-action="openLink"]')?.addEventListener("click", () => {
      openHexLink(linkInput?.value);
    });
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const raw = {
      terrain: {
        type: data.terrainType || undefined,
        mixed: parseMixedTerrain(data.mixedTerrain),
      },
      alt: data.alt,
      notes: data.notes,
      icon: data.icon,
      roads: splitLines(data.roads),
      rivers: splitLines(data.rivers),
      zone: data.zone
        ? data.zone.split(",").map((z) => z.trim()).filter(Boolean)
        : [],
      link: data.link,
    };
    const content = normalizeHexContent(raw);

    const scene = canvas.scene;
    await scene.setFlag(MODULE_ID, `hexes.${hexKey(this.col, this.row)}`, content);
    await setStructureRevealed(this.col, this.row, !!data.structureRevealed, scene);
    await canvas.hexChronicle?.refresh();
  }
}
