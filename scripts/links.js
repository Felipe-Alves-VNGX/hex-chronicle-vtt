/**
 * Resolves and opens a hex's `link` (a Foundry document UUID) - the
 * hex-chronicle equivalent of clicking a native Journal/Scene Note pin,
 * but attached directly to the hex instead of a separate canvas pin.
 * Shared by layer.js's "Open Link" tool and the preview button in
 * hex-editor.js.
 *
 * Uses Foundry's own `fromUuid()` + document sheets/`Scene#view()`, so
 * normal document permissions apply automatically - a player without at
 * least Limited permission on the target document simply gets Foundry's
 * usual "you do not have permission" behavior, no extra checks needed here.
 */
export async function openHexLink(uuid) {
  if (!uuid) {
    ui.notifications.info(game.i18n.localize("HEXCHRON.NoLink"));
    return;
  }

  let doc;
  try {
    doc = await fromUuid(uuid);
  } catch (err) {
    console.warn(`hex-chronicle-vtt | failed to resolve link "${uuid}"`, err);
  }

  if (!doc) {
    ui.notifications.warn(game.i18n.format("HEXCHRON.LinkNotFound", { uuid }));
    return;
  }

  if (doc.documentName === "Scene") {
    await doc.view();
    return;
  }

  if (doc.documentName === "JournalEntryPage") {
    await doc.parent?.sheet?.render(true, { pageId: doc.id });
    return;
  }

  if (doc.sheet) {
    doc.sheet.render(true);
    return;
  }

  ui.notifications.warn(game.i18n.format("HEXCHRON.LinkUnsupported", { uuid }));
}
