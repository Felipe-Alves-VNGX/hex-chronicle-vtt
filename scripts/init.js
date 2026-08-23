import { MODULE_ID, registerSettings } from "./settings.js";
import { HexChronicleLayer } from "./layer.js";
import { registerAutoRevealHook, confirmResetFog } from "./fog.js";
import { openImportDialog } from "./import.js";
import { HexOverview } from "./hex-overview.js";
import { toggleLegend } from "./hex-legend.js";

// Singleton so repeated clicks on the toolbar button re-focus the same
// window instead of stacking up duplicates.
let hexOverviewApp = null;

Hooks.once("init", () => {
  registerSettings();

  CONFIG.Canvas.layers.hexChronicle = {
    layerClass: HexChronicleLayer,
    group: "interface",
  };
});

Hooks.once("ready", () => {
  registerAutoRevealHook();

  // No hook fires for "the selected tool within an already-active control
  // group changed" - confirmed live that renderSceneControls only fires on
  // a *group* switch (e.g. tokens -> Hex Chronicle), not a same-group tool
  // click (e.g. edit -> align); #onChangeTool's lightweight `update()` path
  // apparently skips a full re-render. The only reliable signal is each
  // tool button's own aria-pressed attribute, so watch that directly.
  const controlsEl = document.getElementById("scene-controls");
  if (controlsEl) {
    const observer = new MutationObserver(() => canvas.hexChronicle?.updateAlignHandles());
    observer.observe(controlsEl, { attributes: true, attributeFilter: ["aria-pressed"], subtree: true });
  }
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
  // Confirmed live: this hook also fires on a same-group tool click (e.g.
  // switching from "edit" to "align"), not just on switching control
  // groups entirely - so this is enough to keep the align tool's drag
  // handles in sync with whether it's the one currently selected.
  canvas.hexChronicle?.updateAlignHandles();
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
      align: {
        name: "align",
        title: "HEXCHRON.ToolAlign",
        icon: "fa-solid fa-crosshairs",
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
      resetFog: {
        name: "resetFog",
        title: "HEXCHRON.ToolResetFog",
        icon: "fa-solid fa-broom",
        button: true,
        visible: game.user.isGM,
        onChange: () => confirmResetFog(),
      },
      overview: {
        name: "overview",
        title: "HEXCHRON.ToolOverview",
        icon: "fa-solid fa-chart-simple",
        button: true,
        visible: game.user.isGM,
        onChange: () => {
          if (hexOverviewApp?.rendered) hexOverviewApp.bringToFront();
          else {
            hexOverviewApp = new HexOverview();
            hexOverviewApp.render(true);
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
