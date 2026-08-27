/**
 * Injects a "Hex Chronicle" tab into Foundry's own (core, not ours) Scene
 * Configuration sheet, so a GM can turn the module on/off for one scene and
 * override its grid/auto-reveal/palette settings without leaving that
 * dialog. There's no declarative API for adding a tab to a core
 * ApplicationV2 sheet we don't own, so this hooks `renderSceneConfig` and
 * injects DOM directly - the same technique other v13 modules use for this.
 *
 * All injected fields are named with dotted flag paths
 * (`flags.hex-chronicle-vtt....`) and live inside the sheet's own <form>, so
 * Foundry's normal submit handling (FormDataExtended -> expandObject ->
 * scene.update()) already persists them - no custom submit/save logic
 * needed here at all.
 */
import { MODULE_ID, getSceneOverrides, isModuleEnabledOnScene } from "./settings.js";

// Prefixed to avoid colliding with another module's (or a future Foundry
// core) generic "eq" helper - Handlebars helpers are registered globally.
Handlebars.registerHelper("hcEq", (a, b) => a === b);

const TAB_NAME = "hexChronicle";

export function registerSceneConfigTab() {
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
}

async function onRenderSceneConfig(app, element) {
  const root = element instanceof HTMLElement ? element : element[0];
  // Read the real tab-group name off an existing core tab instead of
  // assuming one (e.g. "sheet" vs "primary") - ApplicationV2#changeTab()
  // toggles `active` by querying `[data-group="<group>"]` live, so getting
  // this wrong would mean clicking our tab never hides the core tab that
  // was active before it (both rendered on top of each other).
  const existingTabPanel = root.querySelector(".tab[data-group]");
  const group = existingTabPanel?.dataset.group ?? "sheet";
  const nav = root.querySelector(`nav.tabs[data-group="${group}"]`) ?? root.querySelector("nav.tabs");
  const tabContainer = existingTabPanel?.parentElement;
  if (!nav || !tabContainer) {
    console.warn(`${MODULE_ID} | couldn't find Scene Config's tab nav/content to attach to - skipping the Hex Chronicle tab`);
    return;
  }

  const scene = app.document;
  const overrides = getSceneOverrides(scene);
  const context = {
    enabled: isModuleEnabledOnScene(scene),
    grid: {
      override: !!overrides.grid?.override,
      hexRadius: overrides.grid?.hexRadius ?? game.settings.get(MODULE_ID, "hexRadius"),
      originX: overrides.grid?.originX ?? game.settings.get(MODULE_ID, "originX"),
      originY: overrides.grid?.originY ?? game.settings.get(MODULE_ID, "originY"),
    },
    autoReveal: {
      override: !!overrides.autoReveal?.override,
      enabled: overrides.autoReveal?.enabled ?? game.settings.get(MODULE_ID, "autoReveal"),
      radius: overrides.autoReveal?.radius ?? game.settings.get(MODULE_ID, "autoRevealRadius"),
    },
    palette: {
      override: !!overrides.palette?.override,
      json: overrides.palette?.json ?? game.settings.get(MODULE_ID, "paletteOverride"),
    },
    tools: Object.fromEntries(
      ["edit", "reveal", "revealStructure", "open", "align", "import", "resetFog", "overview", "legend"].map((name) => [
        name,
        overrides.tools?.[name] ?? true,
      ])
    ),
    gridStyle: {
      override: !!overrides.gridStyle?.override,
      lineType: overrides.gridStyle?.lineType ?? "solid",
      color: overrides.gridStyle?.color ?? "#707070",
      width: overrides.gridStyle?.width ?? "",
      opacity: overrides.gridStyle?.opacity ?? 0.6,
    },
    zonesVisibleToPlayers: !!overrides.zonesVisibleToPlayers,
  };

  const renderTemplate = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const tabHtml = await renderTemplate(`modules/${MODULE_ID}/templates/scene-config-tab.hbs`, context);

  // Idempotent: a re-render of an already-open Scene Config (e.g. after a
  // validation error) re-fires this hook against the same DOM tree rather
  // than starting from a blank one, so drop any tab this hook previously
  // added before re-adding it with fresh values instead of stacking dupes.
  nav.querySelector(`:scope > [data-tab="${TAB_NAME}"]`)?.remove();
  tabContainer.querySelector(`:scope > .tab[data-tab="${TAB_NAME}"]`)?.remove();

  const navItem = document.createElement("a");
  navItem.className = "item";
  navItem.dataset.group = group;
  navItem.dataset.tab = TAB_NAME;
  navItem.innerHTML = `<i class="fa-solid fa-hexagon"></i> ${game.i18n.localize("HEXCHRON.ControlTitle")}`;
  navItem.addEventListener("click", (event) => {
    if (typeof app.changeTab === "function") app.changeTab(TAB_NAME, group, { event, navElement: nav });
  });
  nav.appendChild(navItem);

  const tabPanel = document.createElement("div");
  // "scrollable" isn't just a naming convention - Foundry's own core CSS
  // (`.scrollable { overflow: hidden auto; ... }`) is what actually makes a
  // `.scene-config .tab` (itself forced to `flex: 1; height: 0` by core CSS,
  // so it never grows past the dialog) scroll instead of clipping content
  // taller than the window. Every core tab template (e.g. basics.hbs) has
  // this class alongside "tab" for exactly that reason - without it, this
  // tab's own content below the fold was unreachable.
  tabPanel.className = "tab scrollable";
  tabPanel.dataset.group = group;
  tabPanel.dataset.tab = TAB_NAME;
  tabPanel.innerHTML = tabHtml;
  tabContainer.appendChild(tabPanel);
}
