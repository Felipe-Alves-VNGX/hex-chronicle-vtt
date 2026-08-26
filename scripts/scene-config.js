/**
 * Injects a "Hex Chronicle" tab into Foundry's own Scene Config sheet, so
 * the per-scene toggle/grid style/custom biome-structure-zone sets (see
 * scene-settings.js) live where a GM already goes to configure a scene,
 * instead of a separate window. There's no supported API for a module to
 * add its own tab to a core V2 document sheet, so this hooks
 * `renderSceneConfig` and grafts the extra nav item + tab section onto the
 * live DOM, reusing whatever tab-group name/markup the sheet's own tabs
 * already use (read off an existing tab rather than hardcoded) so it stays
 * correct if core ever renames its "sheet"/"primary" tab group.
 *
 * The injected fields are plain `name="flags.MODULE_ID.xxx"` inputs sitting
 * inside the sheet's own <form> - Foundry's form submission already walks
 * every named field in the form (not just ones from its own template), so
 * saving needs no extra JS here; the sheet's existing Save button picks
 * them up like any of its native fields.
 *
 * NOTE: this targets ApplicationV2's documented tab-navigation contract
 * (nav items use `data-action="tab"` + `data-tab`/`data-group`, handled
 * generically by the base ApplicationV2 class). Unlike the rest of this
 * module's UI (see ROADMAP.md), this hasn't been exercised against a live
 * Foundry world - the DOM lookups below are written defensively (bail out
 * rather than half-inject if the expected tab markup isn't found) so a
 * shape mismatch fails quiet instead of breaking the Scene Config sheet.
 */
import { MODULE_ID } from "./settings.js";
import { GRID_STYLES, ZONE_PATTERNS } from "./scene-settings.js";

const EXAMPLE_BIOMES = '[\n  { "id": "swamp", "label": "Swamp", "color": "#4b5d3a" }\n]';
const EXAMPLE_STRUCTURES = '[\n  { "id": "watchtower", "label": "Watchtower", "icon": "fortin" }\n]';
const EXAMPLE_ZONES = '[\n  { "id": "dangerous", "label": "Dangerous", "pattern": "cross", "color": "#c0392b" }\n]';

export function registerSceneConfigTab() {
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
}

function renderTemplateFn() {
  return foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
}

async function onRenderSceneConfig(app) {
  const root = app.element;
  if (!root || root.querySelector(".hc-scene-tab")) return; // already injected this render

  const existingTabs = [...root.querySelectorAll(".tab[data-group]")];
  const nav = root.querySelector("nav.sheet-tabs[data-group], nav.tabs[data-group]");
  if (!nav || existingTabs.length === 0) return; // unexpected sheet shape - don't half-inject

  const group = nav.dataset.group;
  const scene = app.document;
  const flags = scene.flags?.[MODULE_ID] ?? {};

  const context = {
    moduleId: MODULE_ID,
    enabled: !!flags.enabled,
    gridColor: flags.grid?.color || "#707070",
    gridStyle: GRID_STYLES.includes(flags.grid?.style) ? flags.grid.style : "solid",
    gridWidth: Number.isFinite(flags.grid?.width) ? flags.grid.width : "",
    biomes: flags.biomes ?? "",
    structures: flags.structures ?? "",
    zones: flags.zones ?? "",
    // {{selectOptions}} uses the array index as the saved value for a plain
    // array (see hex-editor.js's terrainTypes for the same gotcha) - an
    // id->label object avoids it, same fix.
    gridStyleOptions: Object.fromEntries(GRID_STYLES.map((s) => [s, game.i18n.localize(`HEXCHRON.SceneGridStyle.${s}`)])),
    zonePatterns: ZONE_PATTERNS,
    examples: { biomes: EXAMPLE_BIOMES, structures: EXAMPLE_STRUCTURES, zones: EXAMPLE_ZONES },
  };

  const render = renderTemplateFn();
  if (!render) return;
  const html = await render(`modules/${MODULE_ID}/templates/scene-hex-tab.hbs`, context);

  const navItem = document.createElement("a");
  navItem.className = "item";
  navItem.dataset.action = "tab";
  navItem.dataset.group = group;
  navItem.dataset.tab = "hexChronicle";
  navItem.innerHTML = `<i class="fa-solid fa-hexagon"></i> ${game.i18n.localize("HEXCHRON.ControlTitle")}`;
  nav.appendChild(navItem);

  // Copy an existing (inactive) tab section's own base classing/hidden
  // state rather than guessing how this sheet shows/hides tabs - whatever
  // mechanism it uses (a CSS class, a `hidden` attribute, or both), a fresh
  // section built the same way as its siblings starts in the same state.
  const template = existingTabs.find((t) => !t.classList.contains("active")) ?? existingTabs[0];
  const section = document.createElement(template.tagName);
  section.className = template.className;
  section.classList.remove("active");
  section.classList.add("hc-scene-tab");
  section.hidden = template.hidden;
  section.dataset.tab = "hexChronicle";
  section.dataset.group = group;
  section.innerHTML = html;
  template.parentElement.appendChild(section);

  // Belt-and-suspenders: ApplicationV2's built-in data-action="tab" handling
  // should already do this, but since that's unverified live (see module
  // docstring), also wire the switch manually so the tab works even if it
  // doesn't.
  navItem.addEventListener("click", () => {
    for (const item of nav.querySelectorAll(":scope > [data-tab]")) item.classList.toggle("active", item === navItem);
    for (const sec of root.querySelectorAll(`.tab[data-group="${group}"]`)) {
      const isOurs = sec === section;
      sec.classList.toggle("active", isOurs);
      if ("hidden" in sec) sec.hidden = !isOurs;
    }
  });

  wireJsonValidation(section);
}

/** Non-blocking JSON hint on the biomes/structures/zones textareas - invalid
 * JSON is never fatal (scene-settings.js#getSceneBiomes and friends already
 * fall back to an empty list and warn to console, same as settings.js's
 * world-level paletteOverride), this just gives the GM a visible nudge
 * before they save instead of a silently-ignored typo. */
function wireJsonValidation(section) {
  for (const textarea of section.querySelectorAll("textarea[data-json]")) {
    const check = () => {
      const value = textarea.value.trim();
      let valid = true;
      if (value) {
        try {
          const parsed = JSON.parse(value);
          valid = Array.isArray(parsed);
        } catch {
          valid = false;
        }
      }
      textarea.classList.toggle("hc-json-invalid", !valid);
    };
    textarea.addEventListener("input", check);
    check();
  }
}
