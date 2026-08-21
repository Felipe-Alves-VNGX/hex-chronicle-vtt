import { MODULE_ID, registerSettings } from "./settings.js";
import { HexChronicleLayer } from "./layer.js";
import { registerAutoRevealHook } from "./fog.js";
import { openImportDialog } from "./import.js";

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
    },
  };
});
