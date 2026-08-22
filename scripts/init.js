import { MODULE_ID, registerSettings } from "./settings.js";
import { HexChronicleLayer } from "./layer.js";
import { registerAutoRevealHook, confirmResetFog } from "./fog.js";
import { openImportDialog } from "./import.js";
import { HexDirectory } from "./hex-directory.js";
import { toggleLegend } from "./hex-legend.js";

// Singleton so repeated clicks on the toolbar button re-focus the same
// window instead of stacking up duplicates.
let hexDirectoryApp = null;

Hooks.once("init", () => {
  registerSettings();

  CONFIG.Canvas.layers.hexChronicle = {
    layerClass: HexChronicleLayer,
    group: "interface",
  };
});

Hooks.once("ready", () => {
  registerAutoRevealHook();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
    canvas.hexChronicle?.refresh();
  }
});

/**
 * Selecting our tab in the scene controls updates `ui.controls.control`
 * (confirmed live against a real v13 world), but - unlike core layers such
 * as "tokens" or "notes" - it does NOT automatically call
 * `canvas.hexChronicle.activate()`, so the canvas keeps whatever layer was
 * active before and our click handler never receives pointer events. This
 * hook closes that gap explicitly; core modules registering a custom layer
 * hit the same issue and use the same fix.
 */
Hooks.on("renderSceneControls", () => {
  if (ui.controls.control?.name === "hexChronicle" && canvas.activeLayer !== canvas.hexChronicle) {
    canvas.hexChronicle?.activate();
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  controls.hexChronicle = {
    name: "hexChronicle",
    title: "HEXCHRON.ControlTitle",
    layer: "hexChronicle",
    icon: "fa-solid fa-hexagon",
    visible: true,
    activeTool: "edit",
    tools: {
      edit: {
        name: "edit",
        title: game.user.isGM ? "HEXCHRON.ToolEdit" : "HEXCHRON.ToolView",
        icon: "fa-solid fa-pen",
      },
      reveal: {
        name: "reveal",
        title: "HEXCHRON.ToolReveal",
        icon: "fa-solid fa-eye",
        visible: game.user.isGM,
      },
      revealStructure: {
        name: "revealStructure",
        title: "HEXCHRON.ToolRevealStructure",
        icon: "fa-solid fa-tower-observation",
        visible: game.user.isGM,
      },
      open: {
        name: "open",
        title: "HEXCHRON.ToolOpen",
        icon: "fa-solid fa-link",
      },
      import: {
        name: "import",
        title: "HEXCHRON.ToolImport",
        icon: "fa-solid fa-file-import",
        button: true,
        visible: game.user.isGM,
        onChange: () => openImportDialog(),
      },
      resetFog: {
        name: "resetFog",
        title: "HEXCHRON.ToolResetFog",
        icon: "fa-solid fa-broom",
        button: true,
        visible: game.user.isGM,
        onChange: () => confirmResetFog(),
      },
      directory: {
        name: "directory",
        title: "HEXCHRON.ToolDirectory",
        icon: "fa-solid fa-table-list",
        button: true,
        visible: game.user.isGM,
        onChange: () => {
          if (hexDirectoryApp?.rendered) hexDirectoryApp.bringToFront();
          else {
            hexDirectoryApp = new HexDirectory();
            hexDirectoryApp.render(true);
          }
        },
      },
      legend: {
        name: "legend",
        title: "HEXCHRON.ToolLegend",
        icon: "fa-solid fa-swatchbook",
        toggle: true,
        active: false,
        // Visible to everyone - the panel itself only shows zones to the GM
        // (see hex-legend.js), but the terrain color key is useful for
        // players reading the map too.
        onChange: (event, active) => toggleLegend(active),
      },
    },
  };
});
