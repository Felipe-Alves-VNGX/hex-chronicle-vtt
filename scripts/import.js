/**
 * Bulk import of the original hex-chronicle file formats: Markdown files
 * named `XXYY-name.md` (YAML frontmatter, row=XX, col=YY - ported from
 * TileMetadata.from_file's regex) and `.yaml`/`.yml` files with one
 * document per hex keyed by a `"rowcol"` string. Parsing goes through the
 * same normalizeHexContent() the per-hex editor uses, so both paths agree
 * on the final shape.
 *
 * Uses a vendored js-yaml build (lib/js-yaml.esm.js, MIT) since Foundry
 * modules can't resolve bare npm imports at runtime - see plan §2.
 */
import * as yaml from "../lib/js-yaml.esm.js";
import { MODULE_ID } from "./settings.js";
import { hexKey, normalizeHexContent } from "./data-model.js";

const MD_NAME_RE = /^(-?\d{2})(-?\d{2})(?:-|_).*\.md$/i;
const YAML_KEY_RE = /^(-?\d{2})(-?\d{2})$/;

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return yaml.load(match[1]) ?? {};
}

/** Parses one File into a Map of "col,row" -> raw (un-normalized) content. */
export async function parseFile(file) {
  const text = await file.text();
  const results = new Map();

  if (/\.ya?ml$/i.test(file.name)) {
    const docs = yaml.loadAll(text);
    for (const doc of docs) {
      if (!doc || typeof doc !== "object") continue;
      for (const [key, value] of Object.entries(doc)) {
        const m = key.match(YAML_KEY_RE);
        if (!m) {
          console.warn(`${MODULE_ID} | "${key}" in ${file.name} is not a valid coordinate, skipping`);
          continue;
        }
        const row = Number(m[1]);
        const col = Number(m[2]);
        results.set(hexKey(col, row), value);
      }
    }
    return results;
  }

  const m = file.name.match(MD_NAME_RE);
  if (!m) {
    throw new Error(`${file.name} doesn't match "XXYY-name.md" or ".yaml/.yml"`);
  }
  const row = Number(m[1]);
  const col = Number(m[2]);
  results.set(hexKey(col, row), parseFrontmatter(text));
  return results;
}

/** Parses and merges a list of Files into the scene's `hexes` flag in one
 * write. Returns an array of per-file error messages (empty on full
 * success); a failing file doesn't abort the rest of the batch. */
export async function importFiles(files, scene = canvas.scene) {
  const merged = { ...(scene.getFlag(MODULE_ID, "hexes") ?? {}) };
  const errors = [];

  for (const file of files) {
    try {
      const parsed = await parseFile(file);
      for (const [key, raw] of parsed) {
        merged[key] = normalizeHexContent(raw);
      }
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  await scene.setFlag(MODULE_ID, "hexes", merged);
  await canvas.hexChronicle?.refresh();
  return errors;
}

export async function openImportDialog() {
  const renderTemplate = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/import-dialog.hbs`, {});

  await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("HEXCHRON.ImportTitle") },
    content,
    ok: {
      label: game.i18n.localize("HEXCHRON.Import"),
      callback: async (_event, button) => {
        const input = button.form.elements.namedItem("files");
        const files = [...(input?.files ?? [])];
        if (!files.length) return;
        const errors = await importFiles(files);
        if (errors.length) ui.notifications.warn(errors.join("; "));
        else ui.notifications.info(game.i18n.localize("HEXCHRON.ImportSuccess"));
      },
    },
  });
}
