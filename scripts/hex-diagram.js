/**
 * Visual replacement for the hex editor's mixed-terrain/roads/rivers text
 * fields: a small clickable SVG diagram of one hexagon (the same 7 zones -
 * N/NE/SE/S/SW/NW/C - and 7 path anchors the canvas renderer itself draws
 * from, via the same pure geometry helpers). Interacting with the diagram
 * just writes the equivalent text into the existing textarea, so submission
 * (hex-editor.js's #onSubmit) and storage (data-model.js's
 * normalizeHexContent) never had to change - this is purely a friendlier
 * input method for the same field.
 *
 * The raw textarea stays reachable (see the <details> wrapper in
 * hex-editor.hbs) as a fallback for hand-editing or pasting, and both
 * directions stay in sync: painting/drawing updates the textarea, and
 * typing in the textarea re-parses and redraws the diagram.
 */
import { CARDINALS, zonePolygon, pathPoints, hexShapePoints, normalizeCardinal, isValidZone } from "./geometry.js";
import { TERRAIN_TYPES } from "./data-model.js";
import { palette } from "./render.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DISPLAY_RADIUS = 90;
const ORIGIN = { x: 0, y: 0 };

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function pointsAttr(points) {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function colorHex(num) {
  return "#" + (Number(num) >>> 0).toString(16).padStart(6, "0");
}

/** "type: side1 side2\n..." -> {cardinal: type}, last write per side wins. */
export function textToZoneMap(text) {
  const map = {};
  for (const rawLine of (text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [typePart, sidesPart] = line.split(":");
    const type = (typePart ?? "").trim().toLowerCase();
    if (!type) continue;
    for (const raw of (sidesPart ?? "").trim().split(/\s+/).filter(Boolean)) {
      let side;
      try {
        side = normalizeCardinal(raw);
      } catch {
        continue;
      }
      if (isValidZone(side)) map[side] = type;
    }
  }
  return map;
}

/** Inverse of textToZoneMap(): groups cardinals sharing a type into one
 * line each, in a stable N/NE/SE/S/SW/NW/C scan order. */
export function zoneMapToText(map) {
  const byType = new Map();
  for (const card of CARDINALS) {
    const type = map[card];
    if (!type) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(card);
  }
  return [...byType.entries()].map(([type, sides]) => `${type}: ${sides.join(" ")}`).join("\n");
}

/** "A B\n..." -> [[a,b], ...] */
export function textToPaths(text) {
  const paths = [];
  for (const rawLine of (text ?? "").split("\n")) {
    const tokens = rawLine.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 2) continue;
    try {
      const [a, b] = tokens.map(normalizeCardinal);
      if (isValidZone(a) && isValidZone(b)) paths.push([a, b]);
    } catch {
      /* malformed line - skip, matches the tolerant submit-time parser */
    }
  }
  return paths;
}

export function pathsToText(paths) {
  return paths.map(([a, b]) => `${a} ${b}`).join("\n");
}

/** Mounts the mixed-terrain zone painter into `root`, keeping `textarea` in
 * sync in both directions. `terrainTypeSelect` is only read (for the base
 * terrain color shown as a faint tint under unpainted zones) and listened
 * to, never written. */
export function attachTerrainDiagram(root, { textarea, terrainTypeSelect }) {
  let zoneMap = textToZoneMap(textarea.value);
  let armedType = TERRAIN_TYPES[0];

  const wrap = document.createElement("div");
  wrap.className = "hc-terrain-diagram";

  const svg = svgEl("svg", { viewBox: "-100 -95 200 190", class: "hc-hex-svg" });
  const polysByCard = {};
  for (const card of CARDINALS) {
    const poly = svgEl("polygon", {
      points: pointsAttr(zonePolygon(card, 0, 0, DISPLAY_RADIUS, ORIGIN)),
      class: "hc-zone",
      "data-tooltip": card,
    });
    poly.addEventListener("click", () => paintZone(card));
    polysByCard[card] = poly;
    svg.appendChild(poly);
  }
  svg.appendChild(svgEl("polygon", { points: pointsAttr(hexShapePoints(0, 0, DISPLAY_RADIUS, ORIGIN)), class: "hc-hex-outline", fill: "none" }));

  const paletteRow = document.createElement("div");
  paletteRow.className = "hc-brush-palette";
  const swatches = [];
  for (const type of TERRAIN_TYPES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-brush-swatch";
    btn.dataset.type = type;
    btn.style.setProperty("--hc-swatch-color", colorHex(palette().terrain[type] ?? palette().terrain.unknown));
    btn.dataset.tooltip = type.replace(/_/g, " ");
    btn.addEventListener("click", () => {
      armedType = type;
      updateArmed();
    });
    paletteRow.appendChild(btn);
    swatches.push(btn);
  }
  const eraserBtn = document.createElement("button");
  eraserBtn.type = "button";
  eraserBtn.className = "hc-brush-swatch hc-brush-eraser";
  eraserBtn.dataset.type = "";
  eraserBtn.dataset.tooltip = game.i18n.localize("HEXCHRON.TerrainBrushEraser");
  eraserBtn.innerHTML = '<i class="fa-solid fa-eraser"></i>';
  eraserBtn.addEventListener("click", () => {
    armedType = null;
    updateArmed();
  });
  paletteRow.appendChild(eraserBtn);
  swatches.push(eraserBtn);

  function updateArmed() {
    for (const btn of swatches) btn.classList.toggle("active", (btn.dataset.type || null) === armedType);
  }

  function paintZone(card) {
    if (zoneMap[card] === armedType && armedType) {
      delete zoneMap[card];
    } else if (armedType) {
      zoneMap[card] = armedType;
    } else {
      delete zoneMap[card];
    }
    sync();
    redraw();
  }

  function redraw() {
    const baseType = terrainTypeSelect.value;
    for (const card of CARDINALS) {
      const poly = polysByCard[card];
      const type = zoneMap[card];
      if (type) {
        poly.setAttribute("fill", colorHex(palette().terrain[type] ?? palette().terrain.unknown));
        poly.setAttribute("fill-opacity", "1");
      } else if (baseType) {
        poly.setAttribute("fill", colorHex(palette().terrain[baseType] ?? palette().terrain.unknown));
        poly.setAttribute("fill-opacity", "0.35");
      } else {
        poly.setAttribute("fill", "transparent");
        poly.setAttribute("fill-opacity", "0");
      }
    }
  }

  function sync() {
    textarea.value = zoneMapToText(zoneMap);
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  textarea.addEventListener("input", () => {
    zoneMap = textToZoneMap(textarea.value);
    redraw();
  });
  terrainTypeSelect.addEventListener("change", redraw);

  wrap.appendChild(svg);
  wrap.appendChild(paletteRow);
  root.replaceChildren(wrap);
  updateArmed();
  redraw();
}

/** Mounts the roads/rivers path editor into `root`. Click two anchors in
 * sequence to add a path between them; click an already-drawn path to
 * remove it. A small mode toggle switches which of the two textareas is
 * being edited (they share one diagram - roads and rivers use the same 7
 * anchors, just drawn/stored separately). */
export function attachPathDiagram(root, { roadsTextarea, riversTextarea }) {
  let roads = textToPaths(roadsTextarea.value);
  let rivers = textToPaths(riversTextarea.value);
  let mode = "roads";
  let pending = null;

  const pts = pathPoints(0, 0, DISPLAY_RADIUS, ORIGIN);

  const wrap = document.createElement("div");
  wrap.className = "hc-path-diagram";

  const modeRow = document.createElement("div");
  modeRow.className = "hc-path-mode-toggle";
  const roadBtn = document.createElement("button");
  roadBtn.type = "button";
  roadBtn.className = "hc-path-mode-btn";
  roadBtn.innerHTML = `<i class="fa-solid fa-route"></i> ${game.i18n.localize("HEXCHRON.PathModeRoads")}`;
  const riverBtn = document.createElement("button");
  riverBtn.type = "button";
  riverBtn.className = "hc-path-mode-btn";
  riverBtn.innerHTML = `<i class="fa-solid fa-water"></i> ${game.i18n.localize("HEXCHRON.PathModeRivers")}`;
  roadBtn.addEventListener("click", () => setMode("roads"));
  riverBtn.addEventListener("click", () => setMode("rivers"));
  modeRow.append(roadBtn, riverBtn);

  const svg = svgEl("svg", { viewBox: "-100 -95 200 190", class: "hc-hex-svg" });
  svg.appendChild(svgEl("polygon", { points: pointsAttr(hexShapePoints(0, 0, DISPLAY_RADIUS, ORIGIN)), class: "hc-hex-outline-faint", fill: "none" }));

  const pathsLayer = svgEl("g", { class: "hc-paths-layer" });
  const anchorsLayer = svgEl("g", { class: "hc-anchors-layer" });
  svg.append(pathsLayer, anchorsLayer);

  const anchorEls = {};
  for (const card of CARDINALS) {
    const p = pts[card];
    const circle = svgEl("circle", { cx: p.x, cy: p.y, r: card === "C" ? 7 : 6, class: "hc-anchor", "data-tooltip": card });
    circle.addEventListener("click", () => onAnchorClick(card));
    anchorEls[card] = circle;
    anchorsLayer.appendChild(circle);
  }

  function setMode(next) {
    mode = next;
    cancelPending();
    redraw();
  }

  function cancelPending() {
    if (pending) anchorEls[pending]?.classList.remove("pending");
    pending = null;
  }

  function onAnchorClick(card) {
    if (pending === null) {
      pending = card;
      anchorEls[card].classList.add("pending");
      return;
    }
    if (pending === card) {
      cancelPending();
      return;
    }
    (mode === "roads" ? roads : rivers).push([pending, card]);
    cancelPending();
    sync();
    redraw();
  }

  function pathD(a, b) {
    const pa = pts[a], pb = pts[b], pc = pts.C;
    return `M ${pa.x} ${pa.y} Q ${pc.x} ${pc.y} ${pb.x} ${pb.y}`;
  }

  function redraw() {
    roadBtn.classList.toggle("active", mode === "roads");
    riverBtn.classList.toggle("active", mode === "rivers");

    pathsLayer.replaceChildren();
    const list = mode === "roads" ? roads : rivers;
    const lineClass = mode === "roads" ? "hc-road-line" : "hc-river-line";
    list.forEach(([a, b], idx) => {
      const line = svgEl("path", { d: pathD(a, b), class: `hc-path-line ${lineClass}`, fill: "none", "data-tooltip": game.i18n.localize("HEXCHRON.PathRemoveHint") });
      line.addEventListener("click", (event) => {
        event.stopPropagation();
        list.splice(idx, 1);
        sync();
        redraw();
      });
      pathsLayer.appendChild(line);
    });
  }

  function sync() {
    roadsTextarea.value = pathsToText(roads);
    riversTextarea.value = pathsToText(rivers);
    roadsTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    riversTextarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  roadsTextarea.addEventListener("input", () => {
    roads = textToPaths(roadsTextarea.value);
    if (mode === "roads") redraw();
  });
  riversTextarea.addEventListener("input", () => {
    rivers = textToPaths(riversTextarea.value);
    if (mode === "rivers") redraw();
  });

  wrap.append(modeRow, svg);
  root.replaceChildren(wrap);
  redraw();
}
