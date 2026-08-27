/**
 * GM-only dashboard over every authored hex in the currently viewed scene:
 * aggregate stats, filters, and a searchable table to read/act on hex
 * content at a glance without hunting for it on the map - the map-scale
 * equivalent of a Journal/Actor sidebar tab, scoped to this module's own
 * data. Replaces the earlier plain "Hex Directory".
 *
 * Reads the *raw* (un-gated) hex content via data-model's
 * normalizeHexContent() directly, not fog.js's getEffectiveContent() -
 * this window is GM-only (see init.js's `visible: game.user.isGM` on the
 * toolbar button that opens it), so there is nothing to hide from its own
 * user.
 *
 * "Dynamic": the list re-renders itself on both a hex-data change in the
 * viewed scene (updateScene) and a scene switch (canvasReady), so it never
 * goes stale while left open - no manual refresh button needed.
 */
import { MODULE_ID, getRadius, getOrigin } from "./settings.js";
import { parseHexKey, normalizeHexContent, applyHexPatches } from "./data-model.js";
import { tileCenter } from "./geometry.js";
import { HexEditor } from "./hex-editor.js";
import { isExplored, toggleHex, isStructureRevealed, toggleStructure, setExploredMany, setStructureRevealedMany } from "./fog.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

function coordLabel(col, row) {
  return `${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`;
}

export class HexOverview extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hex-chronicle-overview",
    window: { title: "HEXCHRON.OverviewTitle", icon: "fa-solid fa-chart-simple", resizable: true, contentClasses: ["hex-chronicle-overview"] },
    position: { width: 560, height: 680 },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-overview.hbs`, scrollable: [".hc-overview-list"] },
  };

  #hooks = [];

  #filters = { text: "", terrain: "", zoneTag: "", hasNotes: "any", hasLink: "any" };

  #selected = new Set();

  #onUpdateScene = (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) this.render();
  };

  #onCanvasReady = () => {
    this.#selected.clear();
    this.#filters = { text: "", terrain: "", zoneTag: "", hasNotes: "any", hasLink: "any" };
    this.render();
  };

  async _prepareContext() {
    const scene = canvas.scene;
    const raw = scene?.getFlag(MODULE_ID, "hexes") ?? {};
    const rows = Object.entries(raw)
      .map(([key, data]) => {
        const { col, row } = parseHexKey(key);
        const content = normalizeHexContent(data);
        const mixed = content.terrain.mixed.map((m) => m.type).join(", ");
        const search = [coordLabel(col, row), content.terrain.type, mixed, content.alt, content.icon, content.zone.join(" "), content.notes]
          .join(" ")
          .toLowerCase();
        return {
          col,
          row,
          coordLabel: coordLabel(col, row),
          terrain: content.terrain.type || "-",
          terrainRaw: content.terrain.type || "",
          mixed,
          alt: content.alt,
          icon: content.icon,
          zone: content.zone.join(", "),
          zoneList: content.zone,
          zoneKey: content.zone.join("|"),
          hasLink: !!content.link,
          hasNotes: !!content.notes,
          notes: content.notes,
          notesPreview: content.notes.length > 60 ? `${content.notes.slice(0, 60)}…` : content.notes,
          terrainRevealed: isExplored(col, row, scene),
          structureRevealed: isStructureRevealed(col, row, scene),
          search,
        };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);

    const terrainCounts = {};
    const zoneCounts = {};
    let withNotes = 0;
    let withLink = 0;
    let withIcon = 0;
    for (const r of rows) {
      if (r.terrainRaw) terrainCounts[r.terrainRaw] = (terrainCounts[r.terrainRaw] ?? 0) + 1;
      for (const z of r.zoneList) zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
      if (r.hasNotes) withNotes++;
      if (r.hasLink) withLink++;
      if (r.icon) withIcon++;
    }
    const stats = {
      total: rows.length,
      terrainCounts: Object.entries(terrainCounts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      withNotes,
      withLink,
      withIcon,
    };
    const terrainOptions = stats.terrainCounts.map((t) => t.type);
    const zoneOptions = Object.keys(zoneCounts).sort();

    return { rows, hasHexes: rows.length > 0, sceneName: scene?.name ?? "", stats, terrainOptions, zoneOptions };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hooks.push(["updateScene", Hooks.on("updateScene", this.#onUpdateScene)]);
    this.#hooks.push(["canvasReady", Hooks.on("canvasReady", this.#onCanvasReady)]);
  }

  async close(options) {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks = [];
    return super.close(options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    for (const cell of this.element.querySelectorAll('[data-action="editField"]')) {
      cell.addEventListener("click", () => this.#startInlineEdit(cell));
    }
    for (const btn of this.element.querySelectorAll('[data-action="goto"]')) {
      btn.addEventListener("click", () => this.#gotoHex(Number(btn.dataset.col), Number(btn.dataset.row)));
    }
    for (const btn of this.element.querySelectorAll('[data-action="edit"]')) {
      btn.addEventListener("click", () => new HexEditor({ col: Number(btn.dataset.col), row: Number(btn.dataset.row) }).render(true));
    }
    for (const btn of this.element.querySelectorAll('[data-action="toggleTerrain"]')) {
      btn.addEventListener("click", async () => {
        await toggleHex(Number(btn.dataset.col), Number(btn.dataset.row));
        await canvas.hexChronicle?.refresh();
      });
    }
    for (const btn of this.element.querySelectorAll('[data-action="toggleStructure"]')) {
      btn.addEventListener("click", async () => {
        await toggleStructure(Number(btn.dataset.col), Number(btn.dataset.row));
        await canvas.hexChronicle?.refresh();
      });
    }
    for (const btn of this.element.querySelectorAll('[data-action="removeZone"]')) {
      btn.addEventListener("click", () => {
        const container = btn.closest(".hc-overview-zones");
        this.#removeZoneTag(Number(container.dataset.col), Number(container.dataset.row), btn.dataset.tag);
      });
    }
    for (const btn of this.element.querySelectorAll('[data-action="addZone"]')) {
      btn.addEventListener("click", () => this.#startZoneAdd(btn.closest(".hc-overview-zones")));
    }

    const search = this.element.querySelector('input[name="search"]');
    if (search) {
      search.value = this.#filters.text;
      search.addEventListener("input", () => {
        this.#filters.text = search.value;
        this.#applyFilters();
      });
    }

    const terrainSelect = this.element.querySelector('select[name="filterTerrain"]');
    if (terrainSelect) {
      terrainSelect.value = this.#filters.terrain;
      terrainSelect.addEventListener("change", () => {
        this.#filters.terrain = terrainSelect.value;
        this.#applyFilters();
      });
    }

    const zoneSelect = this.element.querySelector('select[name="filterZone"]');
    if (zoneSelect) {
      zoneSelect.value = this.#filters.zoneTag;
      zoneSelect.addEventListener("change", () => {
        this.#filters.zoneTag = zoneSelect.value;
        this.#applyFilters();
      });
    }

    const notesSelect = this.element.querySelector('select[name="filterNotes"]');
    if (notesSelect) {
      notesSelect.value = this.#filters.hasNotes;
      notesSelect.addEventListener("change", () => {
        this.#filters.hasNotes = notesSelect.value;
        this.#applyFilters();
      });
    }

    const linkSelect = this.element.querySelector('select[name="filterLink"]');
    if (linkSelect) {
      linkSelect.value = this.#filters.hasLink;
      linkSelect.addEventListener("change", () => {
        this.#filters.hasLink = linkSelect.value;
        this.#applyFilters();
      });
    }

    this.#applyFilters();

    const selectAll = this.element.querySelector('[data-action="selectAll"]');
    selectAll?.addEventListener("change", () => {
      for (const row of this.element.querySelectorAll(".hc-overview-row:not([hidden])")) {
        const box = row.querySelector('[data-action="select"]');
        const key = `${box.dataset.col},${box.dataset.row}`;
        box.checked = selectAll.checked;
        if (selectAll.checked) this.#selected.add(key);
        else this.#selected.delete(key);
      }
      this.#updateBulkBar();
    });

    for (const box of this.element.querySelectorAll('[data-action="select"]')) {
      const key = `${box.dataset.col},${box.dataset.row}`;
      box.checked = this.#selected.has(key);
      box.addEventListener("change", () => {
        if (box.checked) this.#selected.add(key);
        else this.#selected.delete(key);
        this.#updateBulkBar();
      });
    }
    this.#updateBulkBar();

    this.element.querySelector('[data-action="bulkRevealTerrain"]')?.addEventListener("click", () => this.#bulkSetExplored(true));
    this.element.querySelector('[data-action="bulkHideTerrain"]')?.addEventListener("click", () => this.#bulkSetExplored(false));
    this.element.querySelector('[data-action="bulkRevealStructure"]')?.addEventListener("click", () => this.#bulkSetStructure(true));
    this.element.querySelector('[data-action="bulkHideStructure"]')?.addEventListener("click", () => this.#bulkSetStructure(false));
    this.element.querySelector('[data-action="bulkAddZone"]')?.addEventListener("click", (event) => this.#startBulkZoneTag(event.currentTarget, true));
    this.element.querySelector('[data-action="bulkRemoveZone"]')?.addEventListener("click", (event) => this.#startBulkZoneTag(event.currentTarget, false));
    this.element.querySelector('[data-action="bulkClear"]')?.addEventListener("click", () => this.#clearSelectionUI());
  }

  #startInlineEdit(cell) {
    if (cell.querySelector("textarea")) return;
    const col = Number(cell.dataset.col);
    const row = Number(cell.dataset.row);
    const field = cell.dataset.field;
    const original = cell.dataset.value ?? "";
    const originalHtml = cell.innerHTML;

    const textarea = document.createElement("textarea");
    textarea.value = original;
    textarea.rows = field === "notes" ? 3 : 1;
    textarea.className = "hc-overview-inline-editor";
    cell.innerHTML = "";
    cell.appendChild(textarea);
    textarea.focus();

    const commit = async () => {
      const scene = canvas.scene;
      await applyHexPatches(scene, [{ col, row, patch: { [field]: textarea.value } }]);
      // Don't rely solely on the updateScene hook: a no-op edit (value
      // unchanged) may produce no diff, so the hook never fires and the
      // textarea would otherwise be left stuck open. Foundry's
      // ApplicationV2 coalesces overlapping renders, so this is safe even
      // if the hook also triggers one.
      this.render();
    };
    const cancel = () => {
      cell.innerHTML = originalHtml;
    };

    textarea.addEventListener("blur", commit);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field !== "notes") {
        event.preventDefault();
        textarea.blur();
      }
      if (event.key === "Escape") {
        textarea.removeEventListener("blur", commit);
        cancel();
      }
    });
  }

  async #currentZoneList(col, row) {
    const scene = canvas.scene;
    const raw = scene.getFlag(MODULE_ID, "hexes")?.[`${col},${row}`] ?? {};
    return normalizeHexContent(raw).zone;
  }

  /** Replaces the "+" button in one row's zone-chip strip with a small
   * text input (autocomplete via the shared #hc-overview-zone-suggestions
   * datalist) instead of a native window.prompt() - Enter/blur commits,
   * Escape/an empty blur cancels back to the button, same inline-editing
   * feel as #startInlineEdit() above. */
  #startZoneAdd(container) {
    if (container.querySelector(".hc-overview-zone-input")) return;
    const addBtn = container.querySelector('[data-action="addZone"]');
    addBtn.hidden = true;

    const col = Number(container.dataset.col);
    const row = Number(container.dataset.row);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "hc-overview-zone-input";
    input.setAttribute("list", "hc-overview-zone-suggestions");
    input.placeholder = game.i18n.localize("HEXCHRON.ZoneTagAddPlaceholder");
    container.insertBefore(input, addBtn);
    input.focus();

    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      input.remove();
      addBtn.hidden = false;
    };
    const commit = async () => {
      if (settled) return;
      settled = true;
      const tag = input.value.trim();
      input.remove();
      addBtn.hidden = false;
      if (tag) await this.#addZoneTag(col, row, tag);
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        input.removeEventListener("blur", commit);
        cancel();
      }
    });
  }

  async #addZoneTag(col, row, tag) {
    const current = await this.#currentZoneList(col, row);
    if (current.includes(tag)) return;
    await applyHexPatches(canvas.scene, [{ col, row, patch: { zone: [...current, tag] } }]);
  }

  async #removeZoneTag(col, row, tag) {
    const current = await this.#currentZoneList(col, row);
    await applyHexPatches(canvas.scene, [{ col, row, patch: { zone: current.filter((z) => z !== tag) } }]);
  }

  #selectedCells() {
    return [...this.#selected].map((key) => {
      const { col, row } = parseHexKey(key);
      return [col, row];
    });
  }

  #updateBulkBar() {
    const bar = this.element.querySelector(".hc-overview-bulk-bar");
    if (!bar) return;
    bar.hidden = this.#selected.size === 0;
    const count = bar.querySelector(".hc-overview-bulk-count");
    if (count) count.textContent = game.i18n.format("HEXCHRON.OverviewBulkCount", { count: this.#selected.size });
  }

  #clearSelectionUI() {
    this.#selected.clear();
    for (const box of this.element.querySelectorAll('[data-action="select"]')) box.checked = false;
    const selectAll = this.element.querySelector('[data-action="selectAll"]');
    if (selectAll) selectAll.checked = false;
    this.#updateBulkBar();
  }

  async #bulkSetExplored(value) {
    await setExploredMany(this.#selectedCells(), value);
    await canvas.hexChronicle?.refresh();
    this.#clearSelectionUI();
  }

  async #bulkSetStructure(value) {
    await setStructureRevealedMany(this.#selectedCells(), value);
    await canvas.hexChronicle?.refresh();
    this.#clearSelectionUI();
  }

  /** Same inline-input swap as #startZoneAdd(), scoped to the bulk-action
   * bar instead of one row: replaces both zone buttons with a single text
   * input (autocomplete via the shared datalist) so the GM isn't stuck
   * typing into a bare window.prompt() for a bulk tag either. */
  #startBulkZoneTag(triggerBtn, add) {
    const group = triggerBtn.closest(".hc-overview-bulk-zone-group");
    if (group.querySelector(".hc-overview-bulk-zone-input")) return;
    const buttons = [...group.querySelectorAll("button")];
    for (const btn of buttons) btn.hidden = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "hc-overview-bulk-zone-input";
    input.setAttribute("list", "hc-overview-zone-suggestions");
    input.placeholder = game.i18n.localize("HEXCHRON.ZoneTagAddPlaceholder");
    group.appendChild(input);
    input.focus();

    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      input.remove();
      for (const btn of buttons) btn.hidden = false;
    };
    const commit = async () => {
      if (settled) return;
      settled = true;
      const tag = input.value.trim();
      input.remove();
      for (const btn of buttons) btn.hidden = false;
      if (tag) await this.#bulkZoneTag(add, tag);
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        input.removeEventListener("blur", commit);
        cancel();
      }
    });
  }

  async #bulkZoneTag(add, tag) {
    const scene = canvas.scene;
    const raw = scene.getFlag(MODULE_ID, "hexes") ?? {};
    const patches = this.#selectedCells().map(([col, row]) => {
      const existing = normalizeHexContent(raw[`${col},${row}`] ?? {}).zone;
      const zone = add ? (existing.includes(tag) ? existing : [...existing, tag]) : existing.filter((z) => z !== tag);
      return { col, row, patch: { zone } };
    });
    await applyHexPatches(scene, patches);
    this.#clearSelectionUI();
  }

  #gotoHex(col, row) {
    const { x, y } = tileCenter(col, row, getRadius(), getOrigin());
    canvas.animatePan({ x, y, duration: 400 });
    canvas.hexChronicle?.flashHex(col, row);
  }

  #applyFilters() {
    const { text, terrain, zoneTag, hasNotes, hasLink } = this.#filters;
    const query = text.trim().toLowerCase();
    let visible = 0;
    for (const row of this.element.querySelectorAll(".hc-overview-row")) {
      const matchesText = !query || (row.dataset.search ?? "").includes(query);
      const matchesTerrain = !terrain || row.dataset.terrain === terrain;
      const matchesZone = !zoneTag || (row.dataset.zones ?? "").split("|").includes(zoneTag);
      const matchesNotes = hasNotes === "any" || (hasNotes === "yes") === (row.dataset.hasNotes === "true");
      const matchesLink = hasLink === "any" || (hasLink === "yes") === (row.dataset.hasLink === "true");
      const match = matchesText && matchesTerrain && matchesZone && matchesNotes && matchesLink;
      row.hidden = !match;
      if (match) {
        visible++;
      } else {
        const box = row.querySelector('[data-action="select"]');
        if (box) {
          const key = `${box.dataset.col},${box.dataset.row}`;
          if (this.#selected.delete(key)) box.checked = false;
        }
      }
    }
    const empty = this.element.querySelector(".hc-overview-no-matches");
    if (empty) empty.hidden = visible > 0;
    this.#updateBulkBar();
  }
}
