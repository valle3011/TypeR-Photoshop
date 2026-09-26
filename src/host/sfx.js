// SFX layers in Photoshop (the SFX Helper's insert / restyle / read-back).
//
// Krita built an SVG vector layer (fill, outline, 2nd outline and shadow as
// stacked text copies) and fell back to pixels for a texture fill or a soft
// outline. In Photoshop the SFX is ONE editable text layer whose layer style
// carries all of that — stroke, hard outer glow, drop shadow, soft glow,
// pattern overlay, gradient overlay — so even a textured SFX stays editable.
// Widths follow build_sfx_svg: `outline_px` is the VISIBLE thickness.

import { ps, batchPlay, modal, docInfo, num } from "./ps.js";
import { styleRunInfo, sizeScale } from "./measure.js";
import { installedFamily } from "./fonts.js";
import { ensurePattern } from "./patterns.js";
import * as D from "../core/psdesc.js";

function textDesc(text, run, sizePx, color, info, x, y, align = "center", leadingPx = null) {
  const scale = sizeScale(info.resolution);
  return D.makeTextLayer({
    text,
    runs: [{ from: 0, to: text.length, ...run }],
    sizePt: D.pxToPt(sizePx, info.resolution) / scale,
    leadingPt: D.pxToPt(leadingPx || sizePx * 1.2, info.resolution) / scale,
    color,
    align,
    anchorPct: { x: 100 * x / info.w, y: 100 * y / info.h },
    ligatures: true,
  });
}

/**
 * The style s = {font, bold, italic, size, fill, fill2 | null, outline,
 * outlinePx, outline2, outline2Px, shadow, shadowColor, shadowDx, shadowDy,
 * rotate, patternTile ({w,h,rgba,scale}) | null, soft, softColor, softWidth,
 * softBlur, softPattern}.
 */
async function effectsFor(s, outlinePx) {
  const pat = s.patternTile ? await ensurePattern(s.patternTile, "TypeR SFX") : null;
  return D.layerEffects({
    outline: outlinePx > 0,
    outlinePx: 2 * outlinePx,                   // layerEffects takes full widths
    outlineColor: s.outline,
    outline2Px: outlinePx > 0 ? 2 * (s.outline2Px || 0) : 0,
    outline2Color: s.outline2,
    shadow: !!s.shadow,
    shadowColor: s.shadowColor,
    shadowDx: s.shadowDx,
    shadowDy: s.shadowDy,
    soft: !!s.soft,
    softPx: s.softWidth,
    softBlur: s.softBlur,
    softColor: s.softColor,
    fillPattern: pat ? { ...pat, scale: s.patternTile.scale || 100 } : null,
    fillGradient: !pat && s.fill2 ? { top: s.fill, bottom: s.fill2 } : null,
  });
}

/** Insert the SFX word as a new text layer at (tx, ty) = centre / baseline.
 *  Returns [ok, key, fmt]. */
export async function insertSfxLayer(text, s, tx, ty, { size = null, outlinePx = null } = {}) {
  const info = docInfo();
  if (!info) return [false, "st_no_doc", {}];
  const fam = installedFamily(s.font) || s.font;
  const run = await styleRunInfo(fam, !!s.bold, !!s.italic);
  if (!run) return [false, "st_insert_fail", { err: s.font }];
  const px = size !== null ? size : s.size;
  const o1 = outlinePx !== null ? outlinePx : s.outlinePx;
  try {
    await modal("TypeR: SFX", async () => {
      await batchPlay([textDesc(text, run, px, s.fill, info, tx, ty)]);
      await batchPlay([D.renameLayer("SFX")]);
      const fx = await effectsFor(s, o1);
      if (fx) await batchPlay([D.setLayerEffects(fx)]);
      if (s.rotate) await batchPlay([D.rotateLayer(s.rotate)]);
    });
  } catch (e) {
    return [false, "st_insert_fail", { err: e && e.message ? e.message : String(e) }];
  }
  return [true, "st_layer_created", {}];
}

/** The active layer's text + rotation, or null when it is no text layer. */
export async function activeTextLayer() {
  try {
    const r = await batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }]);
    const d = r && r[0];
    if (!d || !d.textKey) return null;
    const tk = d.textKey;
    let angle = 0;
    const tr = tk.transform;
    if (tr && (tr.xx !== undefined)) angle = Math.atan2(num(tr.xy), num(tr.xx)) * 180 / Math.PI;
    return { id: d.layerID, text: String(tk.textKey || "").replace(/\r/g, "\n"), angle };
  } catch (e) {
    return null;
  }
}

/** Restyle the active SFX text layer in place (word, style, effects,
 *  rotation), keeping its position. Never deletes the layer. */
export async function restyleSfxLayer(text, s) {
  const info = docInfo();
  if (!info) return [false, "st_no_doc", {}];
  const cur = await activeTextLayer();
  if (!cur) return [false, "st_no_sfx_layer", {}];
  const fam = installedFamily(s.font) || s.font;
  const run = await styleRunInfo(fam, !!s.bold, !!s.italic);
  if (!run) return [false, "st_insert_fail", { err: s.font }];
  try {
    await modal("TypeR: restyle SFX", async () => {
      await batchPlay([D.restyleTextLayer(textDesc(text || cur.text, run, s.size, s.fill, info, 0, 0))]);
      const fx = await effectsFor(s, s.outlinePx);
      if (fx) await batchPlay([D.setLayerEffects(fx)]);
      else await batchPlay([{ _obj: "disableLayerStyle", _target: [D.TARGET_LAYER] }]).catch(() => {});
      const delta = (s.rotate || 0) - cur.angle;
      if (Math.abs(delta) > 0.01) await batchPlay([D.rotateLayer(delta)]);
    });
  } catch (e) {
    return [false, "st_insert_fail", { err: e && e.message ? e.message : String(e) }];
  }
  return [true, "st_restyled", {}];
}

/** The collected 'note' lines as one small text block at the page's
 *  bottom-left (port of _place_note_list). */
export async function placeNoteList(lines, size) {
  const info = docInfo();
  if (!info) return [false, "st_no_doc", {}];
  let fam = installedFamily("Segoe UI") || installedFamily("Arial") || "";
  let run = fam ? await styleRunInfo(fam, false, false) : null;
  if (!run) {
    const f = ps().app.fonts && ps().app.fonts[0];
    run = f ? { psName: f.postScriptName, family: f.family, style: f.style } : null;
  }
  if (!run) return [false, "st_insert_fail", { err: "font" }];
  const x = Math.trunc(info.w * 0.04);
  const y = Math.trunc(info.h - size * (lines.length + 1) * 1.35) + size;
  try {
    await modal("TypeR: SFX notes", async () => {
      await batchPlay([textDesc(lines.join("\r"), run, size, "#000000", info, x, y, "left", size * 1.35)]);
      await batchPlay([D.renameLayer("SFX notes")]);
    });
  } catch (e) {
    return [false, "st_insert_fail", { err: e && e.message ? e.message : String(e) }];
  }
  return [true, "st_notes_placed", { n: lines.length }];
}
