// THE insert path: one text layer per call, one history step per insert.
//
// Port of TypeR-Krita `insert_text_layer()`. The decisions are made by
// core/insertplan.js (identical to Krita's); this file executes them in
// Photoshop: replace the unit's earlier layers, make ONE real text layer with
// the engine's line breaks baked in as "\r" (editable with the Type tool),
// name it "TypeR NN — …", and put outline / 2nd outline / shadow / soft
// outline / pattern into its layer style.
//
// Returns [ok, key, fmt] like the original; the UI translates `key`.

import { ps, batchPlay, modal, docInfo, selectionBounds } from "./ps.js";
import { measuringEnv, styleRunInfo, sizeScale, ensureCalibrated } from "./measure.js";
import { removeExistingLayers } from "./layers.js";
import { ensurePattern } from "./patterns.js";
import { planInsert } from "../core/insertplan.js";
import * as D from "../core/psdesc.js";

/**
 * p = insert_text_layer's parameters (camelCase), plus
 *   color, outline, outlineColor, outlinePx, outline2Color, outline2Px,
 *   shadow, shadowColor, shadowDx, shadowDy, replaceExisting,
 *   patternTile ({w,h,rgba,scale} | null), patternTarget, soft, softColor,
 *   softPx, softBlur, softPattern, fillPatternTile
 * opts = { historyName, env (a prepared measuringEnv), selection }
 */
export async function insertTextLayer(p, opts = {}) {
  const info = docInfo();
  if (!info) return [false, "st_no_doc", {}];
  if (!p.fontFamily) return [false, "st_no_font", {}];

  const selection = p.box ? null : (opts.selection !== undefined ? opts.selection : await selectionBounds());
  const menv = opts.env || await measuringEnv(p.fontFamily, { ligatures: p.ligatures, text: p.line });
  // first use of a cut: measure it once against Photoshop (the measurer reads
  // the stored correction every time it is built, so this applies right away)
  if (menv.hasFile && opts.calibrate !== false) {
    await ensureCalibrated(p.fontFamily, !!p.bold, !!p.italic);
    if (!p.bold && /\*\*/.test(p.line || "")) await ensureCalibrated(p.fontFamily, true, !!p.italic);
  }
  const planned = planInsert(p, {
    docW: info.w, docH: info.h, selection,
    measurer: (ls, b, i) => menv.measurer(ls, b, i),
    capHeight: (px, b, i) => menv.capHeight(px, b, i),
  });
  if (!planned.ok) return [false, planned.key, planned.fmt];
  const plan = planned.plan;

  const runPlain = await styleRunInfo(p.fontFamily, !!p.bold, !!p.italic);
  const runBold = await styleRunInfo(p.fontFamily, true, !!p.italic);
  if (!runPlain) return [false, "st_font_missing_ps", { font: p.fontFamily }];

  const scale = sizeScale(info.resolution);
  const runs = plan.runs.map((r) => ({ ...(r.bold ? runBold || runPlain : runPlain), from: r.from, to: r.to }));
  const make = D.makeTextLayer({
    text: plan.text,
    runs,
    sizePt: D.pxToPt(plan.fontPx, info.resolution) / scale,
    leadingPt: D.pxToPt(plan.lineH, info.resolution) / scale,
    color: p.color,
    align: plan.align,
    anchorPct: { x: 100 * plan.anchor.x / info.w, y: 100 * plan.anchor.y / info.h },
    underline: !!p.underline,
    ligatures: p.ligatures !== false,
    vertical: plan.vertical,
  });

  let replaced = 0;
  try {
    await modal(opts.historyName || "TypeR: insert", async () => {
      if (p.replaceExisting && p.layerIndex !== null && p.layerIndex !== undefined) {
        replaced = await removeExistingLayers(p.layerIndex, plan.box);
      }
      const hasPattern = !!(p.outline && p.patternTile);
      const outlinePattern = hasPattern ? await ensurePattern(p.patternTile, "TypeR outline") : null;
      const fillPattern = p.fillPatternTile ? await ensurePattern(p.fillPatternTile, "TypeR fill") : null;
      await batchPlay([make]);
      await batchPlay([D.renameLayer(plan.label)]);
      const fx = D.layerEffects({
        outline: !!p.outline,
        outlinePx: Number(p.outlinePx) || 0,
        outlineColor: p.outlineColor,
        outline2Px: Number(p.outline2Px) || 0,
        outline2Color: p.outline2Color,
        outlinePattern: outlinePattern ? { ...outlinePattern, scale: p.patternTile.scale || 100 } : null,
        patternTarget: p.patternTarget || "outline1",
        shadow: !!p.shadow,
        shadowColor: p.shadowColor,
        shadowDx: Number(p.shadowDx) || 0,
        shadowDy: Number(p.shadowDy) || 0,
        soft: !!(p.outline && p.soft),
        softPx: Number(p.softPx) || 0,
        softBlur: Number(p.softBlur) || 0,
        softColor: p.softColor,
        fillPattern: fillPattern ? { ...fillPattern, scale: p.fillPatternTile.scale || 100 } : null,
      });
      if (fx) await batchPlay([D.setLayerEffects(fx)]);
    });
  } catch (exc) {
    return [false, "st_create_fail", { exc: exc && exc.message ? exc.message : String(exc), replaced }];
  }
  return [true, plan.key, { ...plan.fmt, replaced, px: plan.fmt.px }];
}

/** The id of the layer just created (for a balloon placed underneath). */
export function activeLayerId() {
  try {
    return ps().app.activeDocument.activeLayers[0].id;
  } catch (e) {
    return null;
  }
}
