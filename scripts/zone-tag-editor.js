/**
 * Visual chip editor for a hex's zone tags, layered on top of - not instead
 * of - the original comma-separated text input (same integration pattern as
 * hex-diagram.js/hex-icon-picker.js): this only ever writes into the
 * existing `zone` text input, so submission and storage needed no changes.
 * The input stays reachable too, collapsed under "Edit as text" in the
 * template, for bulk paste/hand-editing.
 *
 * `suggestions` are every zone tag already used elsewhere on the current
 * scene, wired to the add field via a <datalist> - lets a GM reuse
 * "secured"/"dangerous" instead of retyping it (and risking a typo that
 * silently creates a near-duplicate tag).
 */
export function attachZoneTagEditor(root, { input, suggestions = [] }) {
  const wrap = document.createElement("div");
  wrap.className = "hc-zone-editor";

  const chipsRow = document.createElement("div");
  chipsRow.className = "hc-zone-chips";
  wrap.appendChild(chipsRow);

  const addRow = document.createElement("div");
  addRow.className = "hc-zone-add-row";
  const listId = `hc-zone-suggestions-${Math.random().toString(36).slice(2)}`;

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "hc-zone-add-input";
  addInput.setAttribute("list", listId);
  addInput.placeholder = game.i18n.localize("HEXCHRON.ZoneTagAddPlaceholder");
  addRow.appendChild(addInput);

  const datalist = document.createElement("datalist");
  datalist.id = listId;
  for (const tag of suggestions) {
    const option = document.createElement("option");
    option.value = tag;
    datalist.appendChild(option);
  }
  addRow.appendChild(datalist);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "hc-zone-add-btn";
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addRow.appendChild(addBtn);

  wrap.appendChild(addRow);

  function currentTags() {
    return input.value.split(",").map((z) => z.trim()).filter(Boolean);
  }

  function setTags(tags) {
    input.value = tags.join(", ");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    renderChips();
  }

  function renderChips() {
    const tags = currentTags();
    chipsRow.replaceChildren();
    if (tags.length === 0) {
      const empty = document.createElement("span");
      empty.className = "hc-zone-empty hint";
      empty.textContent = game.i18n.localize("HEXCHRON.ZoneTagsEmpty");
      chipsRow.appendChild(empty);
      return;
    }
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "hc-zone-chip";
      chip.textContent = tag;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.innerHTML = "&times;";
      remove.dataset.tooltip = game.i18n.localize("HEXCHRON.ZoneTagRemove");
      remove.addEventListener("click", () => setTags(tags.filter((t) => t !== tag)));
      chip.appendChild(remove);
      chipsRow.appendChild(chip);
    }
  }

  function tryAdd() {
    const value = addInput.value.trim();
    if (!value) return;
    const tags = currentTags();
    if (!tags.includes(value)) setTags([...tags, value]);
    addInput.value = "";
    addInput.focus();
  }

  addBtn.addEventListener("click", tryAdd);
  addInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      tryAdd();
    }
  });

  // The raw fallback textarea/input is still directly editable (bulk paste,
  // hand-typed legacy data) - re-render the chips whenever it changes
  // instead of only reacting to our own setTags() calls.
  input.addEventListener("input", renderChips);

  root.replaceChildren(wrap);
  renderChips();
}
