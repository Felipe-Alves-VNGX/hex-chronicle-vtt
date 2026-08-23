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
import { getCustomStructures } from "./custom-registry.js";

// Matches assets/icons/building/*.svg exactly - keep in sync if icons are
// added or removed there.
export const BUILDING_ICONS = [
  "capitale", "cavaliers", "chevaucheurs", "fort", "fortin", "mages",
  "nains", "observatoire", "pont", "portail", "ruines", "sidhes",
  "temple", "village",
];

export function attachIconPicker(root, { input }) {
  const wrap = document.createElement("div");
  wrap.className = "hc-icon-picker";

  const grid = document.createElement("div");
  grid.className = "hc-icon-grid";
  wrap.appendChild(grid);

  const swatches = [];

  /** `key` is what actually gets written into the hex's `icon` field - a
   * bare filename for a built-in (resolved as `building/<key>.svg`) or a
   * custom structure's slug (resolved through the registry, see
   * data-model.js#resolveIcon). `label`/`src` override the tooltip/image
   * for a custom entry, whose real name and image path aren't derivable
   * from the key alone the way a built-in's are. */
  function makeSwatch(key, { label, src } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-icon-swatch";
    btn.dataset.icon = key;
    btn.dataset.tooltip = label ?? (key || game.i18n.localize("HEXCHRON.IconNone"));
    if (key) {
      const img = document.createElement("img");
      img.src = src ?? `modules/${MODULE_ID}/assets/icons/building/${key}.svg`;
      img.alt = label ?? key;
      btn.appendChild(img);
    } else {
      btn.classList.add("hc-icon-none");
      btn.innerHTML = '<i class="fa-solid fa-ban"></i>';
    }
    btn.addEventListener("click", () => {
      input.value = input.value.trim() === key ? "" : key;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    swatches.push(btn);
    grid.appendChild(btn);
  }

  makeSwatch("");
  for (const name of BUILDING_ICONS) makeSwatch(name);
  for (const [slug, structure] of Object.entries(getCustomStructures())) {
    makeSwatch(slug, { label: structure.name, src: structure.path });
  }

  function updateActive() {
    const current = input.value.trim();
    for (const btn of swatches) btn.classList.toggle("active", (btn.dataset.icon || "") === current);
  }

  input.addEventListener("input", updateActive);
  root.replaceChildren(wrap);
  updateActive();
}
