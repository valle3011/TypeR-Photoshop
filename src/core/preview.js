// Live preview + TextShapR card rendering (host-free).
//
// Port of TypeR-Krita `TextPreview` (_fit, _wrap_words, _hyph_split,
// paintEvent, _vertical_path, _paint_path) and `ShapeCard.paintEvent`, drawn
// with core/raster.js instead of QPainter. The preview fits the active line
// to the preview area with its OWN greedy wrap (same typographic limits as
// layout.wrapGreedy, no widow pass — exactly like the Krita preview), then
// draws it with every style effect in the inserted layer's order.

import * as L from "./layout.js";
import { parseBold, prepareText } from "./textprep.js";
import { flattenCommands, rectContour, renderStyled, checker } from "./raster.js";
import { faceMetrics, advance } from "./measure.js";
import { cps, floorDiv, pyRound, pyInt } from "./py.js";

const MARGIN = 10;
const FAUX_ITALIC_SLANT = 0.21;     // ~12°, Photoshop's faux italic

/** Glyph polygons of `text` set at (x, baseline) in `px`. */
export function glyphContours(face, text, x, baseline, px, opts = {}) {
  if (!text) return [];
  const path = face.getPath(text, x, baseline, px, {
    kerning: true, features: { liga: opts.ligatures !== false, rlig: true },
  });
  let cmds = path.commands;
  if (opts.fauxItalic) {
    const k = FAUX_ITALIC_SLANT;
    const sk = (px2, py2) => px2 + (baseline - py2) * k;
    cmds = cmds.map((c) => {
      const o = { ...c };
      if ("x" in o) o.x = sk(o.x, o.y);
      if ("x1" in o) o.x1 = sk(o.x1, o.y1);
      if ("x2" in o) o.x2 = sk(o.x2, o.y2);
      return o;
    });
  }
  return flattenCommands(cmds, 0.2);
}

/** The faces to use for a style: {main, bold, fauxBold, fauxItalic}. `fam`
 *  is {regular, bold, italic, boldItalic} (missing cuts = null). */
export function pickFaces(fam, bold, italic) {
  const reg = italic ? fam.italic || fam.regular : fam.regular;
  const bol = italic ? fam.boldItalic || fam.bold : fam.bold;
  return {
    regular: reg,
    bold: bol || reg,
    fauxBoldRuns: !bol,
    fauxItalic: italic && !(fam.italic || fam.boldItalic),
  };
}

// --- the preview's own wrap (TextPreview._wrap_words) -----------------------

function hyphSplit(word, avail, wordW, lang) {
  const breaks = L.hyphenate(word.text, lang);
  if (!breaks.length) return null;
  let best = null;
  for (const b of breaks) {
    const [left, right] = L.splitWord(word, b);
    if (wordW(left) <= avail) best = [left, right];
    else break;
  }
  return best;
}

export function wrapWords(paras, wordW, spaceW, availW, hyph = null) {
  const lines = [];
  for (const words of paras) {
    if (!words.length) {
      lines.push([]);
      continue;
    }
    let cur = [];
    let curW = 0.0;
    const queue = [...words];
    let guard = 0;
    let ladder = 0;
    let splits = 0;
    let pending = null;
    const maySplit = () => !!hyph && ladder < L.HYPH_MAX_LADDER && splits < L.HYPH_MAX_WORD_SPLITS;
    while (queue.length && guard < 100000) {
      guard += 1;
      const wd = queue.shift();
      if (wd !== pending) splits = 0;
      pending = null;
      const ww = wordW(wd);
      if (!cur.length) {
        if (ww <= availW) {
          cur = [wd];
          curW = ww;
          ladder = 0;
        } else {
          const res = maySplit() ? hyphSplit(wd, availW, wordW, hyph) : null;
          if (res) {
            const [left, right] = res;
            lines.push([left]);
            queue.unshift(right);
            cur = [];
            curW = 0.0;
            ladder += 1;
            splits += 1;
            pending = right;
          } else {
            cur = [wd];
            curW = ww;
            ladder = 0;
          }
        }
      } else if (curW + spaceW + ww <= availW) {
        cur.push(wd);
        curW += spaceW + ww;
      } else {
        const avail = availW - curW - spaceW;
        const res = maySplit() ? hyphSplit(wd, avail, wordW, hyph) : null;
        if (res) {
          const [left, right] = res;
          cur.push(left);
          lines.push(cur);
          queue.unshift(right);
          cur = [];
          curW = 0.0;
          ladder += 1;
          splits += 1;
          pending = right;
        } else if (ww > availW && maySplit()) {
          lines.push(cur);
          cur = [];
          curW = 0.0;
          ladder = 0;
          queue.unshift(wd);
          pending = wd;
        } else {
          lines.push(cur);
          cur = [wd];
          curW = ww;
          ladder = 0;
        }
      }
    }
    if (cur.length) lines.push(cur);
  }
  return lines;
}

/** Everything the preview needs for one px: word width fn, space, line
 *  height, ascent, descent (vertical: em-based). */
function metricsAt(o, faces, px) {
  const mr = faceMetrics(o.bold ? faces.bold : faces.regular);
  const scale = px / mr.upm;
  const ascent = mr.ascent * scale;
  const descent = mr.descent * scale;
  if (o.vertical) {
    const em = px;
    const wordW = (w) => w.runs.reduce((a, [t]) => a + cps(t).length, 0) * em;
    return { wordW, spaceW: em, lineH: px * o.spacing, ascent, descent };
  }
  const lig = o.ligatures !== false;
  const wordW = (w) => {
    let tot = 0.0;
    for (const [t, b] of w.runs) tot += advance((o.bold || b) ? faces.bold : faces.regular, t, px, lig);
    return tot;
  };
  return {
    wordW,
    spaceW: advance(o.bold ? faces.bold : faces.regular, " ", px, lig),
    lineH: (ascent + descent) * o.spacing,
    ascent,
    descent,
  };
}

function lineW(words, wordW, spaceW) {
  if (!words.length) return 0.0;
  return words.reduce((a, w) => a + wordW(w), 0) + spaceW * (words.length - 1);
}

/** Largest integer px (6..160) at which the wrapped words fit: [px, lines]. */
export function fitPreview(o, faces, paras, availW, availH) {
  let lo = 6;
  let hi = 160;
  let best = 6;
  let bestLines = [[]];
  const hyph = o.hyphenate ? o.hyphLang : null;
  const [along, across] = o.vertical ? [availH, availW] : [availW, availH];
  while (lo <= hi) {
    const mid = floorDiv(lo + hi, 2);
    const m = metricsAt(o, faces, mid);
    const lines = wrapWords(paras, m.wordW, m.spaceW, along, hyph);
    const totalAcross = m.lineH * lines.length;
    const maxAlong = lines.reduce((a, ws) => Math.max(a, lineW(ws, m.wordW, m.spaceW)), 0);
    if (totalAcross <= across && maxAlong <= along) {
      best = mid;
      bestLines = lines;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return [best, bestLines];
}

/** Style of the preview effects at `scale` (widths/offsets scale with the
 *  preview size, like Krita's _paint_path). */
function scaledStyle(o, scale) {
  return {
    color: o.color,
    fillPattern: o.fillPattern || null,
    outline: {
      on: o.outline,
      w: o.outline && o.outlinePx > 0 ? Math.max(0.5, o.outlinePx * scale) : 0,
      color: o.outlineColor,
      w2: o.outline && o.outline2Px > 0 ? Math.max(0.5, o.outline2Px * scale) : 0,
      color2: o.outline2Color,
      pattern: o.outlinePattern ? { ...o.outlinePattern, scale: (o.outlinePattern.scale || 100) * scale } : null,
      target: o.outlinePatternTarget || "outline1",
    },
    shadow: { on: o.shadow, dx: o.shadowDx * scale, dy: o.shadowDy * scale, color: o.shadowColor },
    soft: {
      on: !!o.soft, w: (o.softPx || 0) * scale, blur: (o.softBlur || 0) * scale,
      color: o.softColor, pattern: !!o.softPattern,
    },
  };
}

function lineContours(words, x, baseline, o, faces, px, m) {
  const out = [];
  let cx = x;
  const xStart = x;
  words.forEach((wd, wi) => {
    if (wi > 0) cx += m.spaceW;
    for (const [txt, b] of wd.runs) {
      const face = (o.bold || b) ? faces.bold : faces.regular;
      if (txt) {
        out.push(...glyphContours(face, txt, cx, baseline, px, { ligatures: o.ligatures, fauxItalic: faces.fauxItalic }));
        cx += advance(face, txt, px, o.ligatures !== false);
      }
    }
  });
  if (o.underline && words.length) {
    const th = Math.max(1.0, px * 0.06);
    out.push(rectContour(xStart, baseline + Math.max(1.0, px * 0.12), cx - xStart, th));
  }
  return out;
}

/**
 * Render the live preview: RGBA bytes of w x h, or {empty: true} when there
 * is no text. `o` is the style snapshot (see ui/state.js previewOptions):
 *   family faces, bold/italic/underline/ligatures, color, align/valign, case,
 *   tidy, comic, crossbarI, vertical, spacing, sizeRef, outline…, shadow…,
 *   hyphenate/hyphLang, pattern/soft options.
 */
export function renderPreview(text, o, faces, w, h) {
  const rgba = checker(w, h);
  let prepared = prepareText(text || "", o.case, o.tidy, o.comic, o.crossbarI);
  prepared = prepared.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const [clean, mask] = parseBold(prepared);
  if (!clean.trim() || !faces || !faces.regular) return { rgba, empty: true };
  const paras = L.splitParagraphs(clean, mask).map(([pt, pm]) => L.makeWords(pt, pm));
  const availW = Math.max(10, w - 2 * MARGIN);
  const availH = Math.max(10, h - 2 * MARGIN);
  const [fs, lines] = fitPreview(o, faces, paras, availW, availH);
  const m = metricsAt(o, faces, fs);
  const scale = fs / Math.max(1, o.sizeRef);
  const contours = [];
  if (o.vertical) {
    const em = fs;
    const blockW = m.lineH * lines.length;
    let right;
    if (o.align === "left") right = MARGIN + blockW;
    else if (o.align === "right") right = MARGIN + availW;
    else right = MARGIN + (availW + blockW) / 2.0;
    const cellBaseline = (em + m.ascent - m.descent) / 2.0;
    lines.forEach((words, i) => {
      const colLen = lineW(words, m.wordW, m.spaceW);
      let y;
      if (o.valign === "top") y = MARGIN;
      else if (o.valign === "bottom") y = MARGIN + (availH - colLen);
      else y = MARGIN + (availH - colLen) / 2.0;
      const cx = right - m.lineH / 2.0 - i * m.lineH;
      words.forEach((wd, wi) => {
        if (wi > 0) y += m.spaceW;
        for (const [txt, b] of wd.runs) {
          const face = (o.bold || b) ? faces.bold : faces.regular;
          for (const ch of cps(txt)) {
            const adv = advance(face, ch, fs, false);
            contours.push(...glyphContours(face, ch, cx - adv / 2.0, y + cellBaseline, fs, { fauxItalic: faces.fauxItalic }));
            y += em;
          }
        }
      });
    });
  } else {
    const blockH = m.lineH * lines.length;
    let y0;
    if (o.valign === "top") y0 = MARGIN + m.ascent;
    else if (o.valign === "bottom") y0 = MARGIN + (availH - blockH) + m.ascent;
    else y0 = MARGIN + (availH - blockH) / 2.0 + m.ascent;
    lines.forEach((words, i) => {
      const lw = lineW(words, m.wordW, m.spaceW);
      let x;
      if (o.align === "left") x = MARGIN;
      else if (o.align === "right") x = MARGIN + (availW - lw);
      else x = MARGIN + (availW - lw) / 2.0;
      contours.push(...lineContours(words, x, y0 + i * m.lineH, o, faces, fs, m));
    });
  }
  const st = scaledStyle(o, scale);
  if (faces.fauxBoldRuns && o.bold) {
    // no bold cut installed: Photoshop's faux bold thickens the strokes a bit
    st.fauxBold = Math.max(0.3, fs * 0.02);
  }
  renderStyled(rgba, w, h, contours, st);
  return { rgba, empty: false, px: fs, lines };
}

/** One TextShapR card (ShapeCard.paintEvent): the candidate's fixed lines at
 *  px*scale, placed with the insert path's own line_x_positions. */
export function renderCard(cand, o, faces, w, h, scale) {
  const rgba = checker(w, h);
  if (!faces || !faces.regular) return rgba;
  const fpx = Math.max(1, pyInt(pyRound(cand.px * scale)));
  const main = o.bold ? faces.bold : faces.regular;
  const mr = faceMetrics(main);
  const ascent = mr.ascent * fpx / mr.upm;
  const descent = mr.descent * fpx / mr.upm;
  const lineH = (ascent + descent) * o.spacing;
  const lig = o.ligatures !== false;
  const runW = (runs) => runs.reduce((a, [t, b]) => a + advance((o.bold || b) ? faces.bold : faces.regular, t, fpx, lig), 0);
  const lines = cand.lines;
  const blockH = lineH * lines.length;
  const y0 = (h - blockH) / 2.0 + ascent;
  const xs = L.lineXPositions(lines.map(runW), o.align, 6.0, w / 2.0, w - 6.0);
  const contours = [];
  lines.forEach((runs, i) => {
    let x = xs[i];
    const baseline = y0 + i * lineH;
    const xStart = x;
    for (const [txt, b] of runs) {
      const face = (o.bold || b) ? faces.bold : faces.regular;
      if (txt) {
        contours.push(...glyphContours(face, txt, x, baseline, fpx, { ligatures: lig, fauxItalic: faces.fauxItalic }));
        x += advance(face, txt, fpx, lig);
      }
    }
    if (o.underline && runs.length) {
      contours.push(rectContour(xStart, baseline + Math.max(1.0, fpx * 0.12), x - xStart, Math.max(1.0, fpx * 0.06)));
    }
  });
  const st = scaledStyle({ ...o, soft: false, fillPattern: null }, scale);
  renderStyled(rgba, w, h, contours, st);
  return rgba;
}

/** A one-line font face sample ("Family – AaBb 123") for the pickers. */
export function renderFaceSample(face, text, w, h, color = "#1a1a1a", px = 20, background = null) {
  const rgba = background ? background(w, h) : new Uint8Array(w * h * 4);
  if (!face) return rgba;
  const m = faceMetrics(face);
  const scale = px / m.upm;
  const baseline = (h + (m.ascent - m.descent) * scale) / 2;
  const contours = glyphContours(face, text, 4, baseline, px);
  renderStyled(rgba, w, h, contours, { color, outline: {}, shadow: {}, soft: {} });
  return rgba;
}
