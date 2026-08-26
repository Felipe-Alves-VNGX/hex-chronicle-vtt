/**
 * Visual picker for the hex editor's "Building icon" field: a grid of the
 * module's own building icons (assets/icons/building/*.svg) with an actual
 * preview, instead of typing a filename by hand and hoping it's spelled
 * right. Same integration pattern as hex-diagram.js - this only ever
 * writes into the existing `icon` text input, so submission and storage
 * needed no changes. The input stays visible and directly editable too,
 * for a custom/hand-typed icon that isn't in this list.
 */
import { MODULE_ID } from "./settings.js";
import { getSceneStructures, structureIconSrc } from "./scene-settings.js";

// Matches assets/icons/building/*.svg exactly - keep in sync if icons are
// added or removed there.
const BUILDING_ICONS = [
  "capitale", "cavaliers", "chevaucheurs", "fort", "fortin", "mages",
  "nains", "observatoire", "pont", "portail", "ruines", "sidhes",
  "temple", "village",
];

export function attachIconPicker(root, { input, scene = canvas.scene }) {
  const wrap = document.createElement("div");
  wrap.className = "hc-icon-picker";

  const grid = document.createElement("div");
  grid.className = "hc-icon-grid";
  wrap.appendChild(grid);

  const swatches = [];

  function makeSwatch(name, { src, tooltip } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-icon-swatch";
    btn.dataset.icon = name;
    btn.dataset.tooltip = tooltip ?? name ?? game.i18n.localize("HEXCHRON.IconNone");
    if (name) {
      const img = document.createElement("img");
      img.src = src ?? `modules/${MODULE_ID}/assets/icons/building/${name}.svg`;
      img.alt = name;
      btn.appendChild(img);
    } else {
      btn.classList.add("hc-icon-none");
      btn.innerHTML = '<i class="fa-solid fa-ban"></i>';
    }
    btn.addEventListener("click", () => {
      input.value = input.value.trim() === name ? "" : name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    swatches.push(btn);
    grid.appendChild(btn);
  }

  makeSwatch("");
  for (const name of BUILDING_ICONS) makeSwatch(name);
  // This scene's own custom structure set (scene-settings.js), additive to
  // the module's built-in icons - a GM can still hand-type an icon that's
  // in neither list, the text input next to this grid stays editable too.
  for (const structure of getSceneStructures(scene)) {
    const src = structureIconSrc(structure.icon);
    if (!src) continue;
    makeSwatch(structure.id, { src, tooltip: structure.label || structure.id });
  }

  function updateActive() {
    const current = input.value.trim();
    for (const btn of swatches) btn.classList.toggle("active", (btn.dataset.icon || "") === current);
  }

  input.addEventListener("input", updateActive);
  root.replaceChildren(wrap);
  updateActive();
}
