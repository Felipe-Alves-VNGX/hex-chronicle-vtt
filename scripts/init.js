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
