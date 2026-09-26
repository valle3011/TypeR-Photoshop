// The insert path, minus Photoshop: everything `insert_text_layer` decides.
//
// Port of TypeR-Krita `typer_kr.insert_text_layer()` up to the point where
// Krita builds its SVG: text preparation, the target box (explicit box >
// selection > whole image), fitting (auto-fit or fixed size, horizontal or
// tategaki), per-line alignment, the optical first baseline and the layer
// name. The result is a plan that host/insert.js turns into ONE Photoshop
// text layer; tests drive this exactly like Krita's integration suite drives
// its insert path.
//
// There is ONE insert path: the Insert button, TextShapR (Apply), the batch
// run and the SFX overlay all come through planInsert().

import * as L from "./layout.js";
import { prepareText, parseBold } from "./textprep.js";
import { cps, strip } from "./py.js";

/**
 * p (same parameters, same meaning as insert_text_layer):
 *   line, fontFamily, fontPx, autoFit, maxPx, paddingFrac, lineSpacing,
 *   bold, italic, underline, align, case, tidy, shape ('rect'|'ellipse'),
 *   valign, layerIndex (1-based unit | null), hyphenate, hyphLang,
 *   box ([x, y, w, h] | null), comic, crossbarI, vertical, ligatures
 * env:
 *   docW, docH, selection ([x, y, w, h] | null),
 *   measurer(lineSpacing, bold, italic) -> measurer(px),
 *   capHeight(px, bold, italic) -> px | null
 *
 * Returns {ok: false, key, fmt} or {ok: true, plan}.
 */
export function planInsert(p, env) {
  if (!env || env.docW === undefined) return { ok: false, key: "st_no_doc", fmt: {} };
  if (strip(p.line || "") === "") return { ok: false, key: "st_empty_line", fmt: {} };

  let line = prepareText(p.line, p.case || "none", !!p.tidy, !!p.comic, !!p.crossbarI);
  line = line.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const [clean, mask] = parseBold(line);
  if (strip(clean) === "") return { ok: false, key: "st_empty_line", fmt: {} };

  const imgW = env.docW;
  const imgH = env.docH;
  let boxX;
  let boxY;
  let boxW;
  let boxH;
  if (p.box) {
    [boxX, boxY, boxW, boxH] = p.box;
  } else if (env.selection) {
    [boxX, boxY, boxW, boxH] = env.selection;
  } else {
    [boxX, boxY, boxW, boxH] = [0, 0, imgW, imgH];
  }
  const cx = boxX + boxW / 2.0;
  const cy = boxY + boxH / 2.0;

  const spacing = p.lineSpacing;
  const measurer = p.vertical ? L.verticalMeasurer(spacing) : env.measurer(spacing, !!p.bold, !!p.italic);
  // ⚠ the fitter works "along the line, then across the lines", so vertical
  // text hands it the box TRANSPOSED — only correct together with the
  // vertical measurer above.
  const [fitW, fitH] = p.vertical ? [boxH, boxW] : [boxW, boxH];

  let fontPx;
  let textLines;
  let lineH;
  let ascent;
  let descent;
  let fitted;
  if (p.autoFit) {
    const result = L.fitText(clean, measurer, fitW, fitH, p.maxPx, 6, p.paddingFrac, p.shape || "rect", mask,
      !!p.hyphenate, p.hyphLang || "en");
    if (result === null) return { ok: false, key: "st_empty_line", fmt: {} };
    [fontPx, textLines, lineH, ascent, descent, fitted] = result;
  } else {
    fontPx = p.fontPx;
    textLines = L.splitParagraphs(clean, mask).map(([pt, pm]) => L.makeRuns(pt, pm));
    [, , lineH, ascent, descent] = measurer(fontPx);
    fitted = true;
  }

  const widthOf = measurer(fontPx)[0];
  const lineWidths = textLines.map((runs) => widthOf(runs));
  let linePos;
  let blockStart;
  let cap = null;
  if (p.vertical) {
    const padY = boxH * p.paddingFrac / 2.0;
    linePos = L.columnYPositions(lineWidths, p.valign, boxY + padY, cy, boxY + boxH - padY);
    blockStart = L.horizontalStart(p.align, boxX, boxW, p.paddingFrac, textLines.length, lineH);
  } else {
    const padX = boxW * p.paddingFrac / 2.0;
    linePos = L.lineXPositions(lineWidths, p.align, boxX + padX, cx, boxX + boxW - padX);
    // optical vertical centring: cap height instead of the em ascent
    try {
      cap = env.capHeight ? env.capHeight(fontPx, !!p.bold, !!p.italic) : null;
    } catch (e) {
      cap = null;
    }
    blockStart = L.verticalStart(p.valign, boxY, boxH, p.paddingFrac, textLines.length, lineH, ascent, descent, cap);
  }

  const snippet = strip(textLines.length ? cps(L.runsText(textLines[0])).slice(0, 24).join("") : "");
  const label = p.layerIndex !== null && p.layerIndex !== undefined
    ? L.typerLayerPrefix(p.layerIndex) + snippet
    : "TypeR — " + snippet;

  // Photoshop point text: one anchor per paragraph alignment. Horizontal text
  // anchors the first BASELINE at the aligned edge (left / centre / right),
  // so every line lands exactly where line_x_positions put it; vertical text
  // anchors the first column's centre line at the aligned end.
  let anchor;
  if (p.vertical) {
    const padY = boxH * p.paddingFrac / 2.0;
    const ay = p.valign === "top" ? boxY + padY : p.valign === "bottom" ? boxY + boxH - padY : cy;
    anchor = { x: blockStart, y: ay };
  } else {
    const padX = boxW * p.paddingFrac / 2.0;
    const ax = p.align === "left" ? boxX + padX : p.align === "right" ? boxX + boxW - padX : cx;
    anchor = { x: ax, y: blockStart };
  }

  // the text Photoshop receives: one paragraph per engine line, bold runs as
  // style ranges (UTF-16 offsets, as Photoshop counts them)
  const parts = [];
  const runs = [];
  let off = 0;
  textLines.forEach((rl, i) => {
    if (i > 0) {
      parts.push("\r");
      off += 1;
    }
    for (const [t, b] of rl) {
      if (!t) continue;
      runs.push({ from: off, to: off + t.length, bold: !!(p.bold || b) });
      parts.push(t);
      off += t.length;
    }
  });
  const text = parts.join("");
  // merge neighbouring runs of the same weight (and the \r between them)
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.to >= r.from - 1) last.to = r.to;
    else merged.push({ ...r });
  }
  if (merged.length) {
    merged[0].from = 0;
    for (let i = 1; i < merged.length; i++) merged[i].from = merged[i - 1].to;
    merged[merged.length - 1].to = text.length;
  }

  const px = Math.round(fontPx);
  let key;
  let fmt;
  if (p.autoFit && !fitted) {
    key = "st_inserted_min";
    fmt = { px };
  } else if (p.autoFit) {
    key = "st_inserted_fit";
    fmt = { px, n: textLines.length };
  } else {
    key = "st_inserted";
    fmt = {};
  }
  return {
    ok: true,
    plan: {
      box: [boxX, boxY, boxW, boxH],
      fontPx, lineH, ascent, descent, cap, fitted,
      textLines, linePos, lineWidths, blockStart,
      anchor, text, runs: merged,
      align: p.vertical ? p.valign : p.align,
      vertical: !!p.vertical,
      label,
      key, fmt,
    },
  };
}
