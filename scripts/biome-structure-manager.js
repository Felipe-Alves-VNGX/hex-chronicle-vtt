/**
 * GM-only world-scoped manager for custom biomes (terrain types) and
 * structures (building icons) - see custom-registry.js for the settings
 * these read/write. Reached via a settings menu (registerRegistryMenu()
 * below), not the module's own scene-controls toolbar, since it manages
 * world data, not anything about the current scene.
 *
 * Same "write immediately, no form-wide Save button" pattern as Hex
 * Overview's bulk actions - every add/remove is its own game.settings.set
 * call (inside custom-registry.js), followed by a re-render of this
 * window's own list.
 */
import { MODULE_ID } from "./settings.js";
import { TERRAIN_TYPES } from "./data-model.js";
import { BUILDING_ICONS } from "./hex-icon-picker.js";
import {
  getCustomBiomes,
  getCustomStructures,
  addCustomBiome,
  removeCustomBiome,
  addCustomStructure,
  removeCustomStructure,
} from "./custom-registry.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function getFilePickerImpl() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

// "heavy_woods" -> "Heavy Woods" - only used to make the built-in list read
// naturally; the actual stored/compared value is still the raw slug.
function titleCase(slug) {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export class BiomeStructureManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-registry-manager",
    window: {
      title: "HEXCHRON.RegistryManagerTitle",
      icon: "fa-solid fa-shapes",
      resizable: true,
      contentClasses: ["hex-chronicle-registry-manager"],
    },
    position: { width: 480, height: 620 },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/biome-structure-manager.hbs`, scrollable: [""] },
  };

  #newStructurePath = "";
  #newStructureName = "";

  async _prepareContext() {
    const customBiomes = Object.entries(getCustomBiomes()).map(([slug, biome]) => ({ slug, ...biome }));
    const customStructures = Object.entries(getCustomStructures()).map(([slug, structure]) => ({ slug, ...structure }));
    return {
      builtinBiomes: TERRAIN_TYPES.map((slug) => ({ slug, name: titleCase(slug) })),
      customBiomes,
      hasCustomBiomes: customBiomes.length > 0,
      builtinStructures: BUILDING_ICONS.map((slug) => ({
        slug,
        name: titleCase(slug),
        src: `modules/${MODULE_ID}/assets/icons/building/${slug}.svg`,
      })),
      customStructures,
      hasCustomStructures: customStructures.length > 0,
      newStructurePath: this.#newStructurePath,
      newStructureName: this.#newStructureName,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // Live swatch preview next to the color picker, since the native
    // <input type="color"> swatch is tiny and inconsistent across
    // browsers - this one updates as the GM picks, before "Add" is clicked.
    const newBiomeColor = this.element.querySelector('input[name="newBiomeColor"]');
    const newBiomePreview = this.element.querySelector('[data-preview="new-biome"]');
    if (newBiomeColor && newBiomePreview) {
      newBiomeColor.addEventListener("input", () => {
        newBiomePreview.style.backgroundColor = newBiomeColor.value;
      });
    }

    this.element.querySelector('[data-action="addBiome"]')?.addEventListener("click", async () => {
      const nameInput = this.element.querySelector('input[name="newBiomeName"]');
      const colorInput = this.element.querySelector('input[name="newBiomeColor"]');
      const slug = await addCustomBiome(nameInput.value, colorInput.value, TERRAIN_TYPES);
      if (slug) this.render();
    });

    for (const btn of this.element.querySelectorAll('[data-action="removeBiome"]')) {
      btn.addEventListener("click", async () => {
        await removeCustomBiome(btn.dataset.slug);
        this.render();
      });
    }

    this.element.querySelector('[data-action="chooseStructureImage"]')?.addEventListener("click", () => {
      // Stash the currently-typed name before opening the picker - this.render()
      // in the callback below rebuilds the whole template from _prepareContext(),
      // and the name input isn't otherwise round-tripped through it (only the
      // path is), so without this the re-render would silently wipe out
      // whatever the GM had already typed.
      this.#newStructureName = this.element.querySelector('input[name="newStructureName"]').value;
      const FilePickerImpl = getFilePickerImpl();
      new FilePickerImpl({
        type: "image",
        callback: (path) => {
          this.#newStructurePath = path;
          this.render();
        },
      }).render(true);
    });

    this.element.querySelector('[data-action="addStructure"]')?.addEventListener("click", async () => {
      const nameInput = this.element.querySelector('input[name="newStructureName"]');
      const slug = await addCustomStructure(nameInput.value, this.#newStructurePath, BUILDING_ICONS);
      if (slug) {
        this.#newStructurePath = "";
        this.#newStructureName = "";
        this.render();
      }
    });

    for (const btn of this.element.querySelectorAll('[data-action="removeStructure"]')) {
      btn.addEventListener("click", async () => {
        await removeCustomStructure(btn.dataset.slug);
        this.render();
      });
    }
  }
}

export function registerRegistryMenu() {
  game.settings.registerMenu(MODULE_ID, "manageBiomesStructures", {
    name: "HEXCHRON.RegistryMenuName",
    label: "HEXCHRON.RegistryMenuLabel",
    hint: "HEXCHRON.RegistryMenuHint",
    icon: "fa-solid fa-shapes",
    type: BiomeStructureManager,
    restricted: true,
  });
}
