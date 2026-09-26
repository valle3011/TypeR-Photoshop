// Measuring for the layout engine — the part the whole port's quality rests on.
//
//  1. primary: opentype.js on the real font file (core/measure.js), cached;
//  2. calibration: once per face, a hidden probe text layer is set in
//     Photoshop, its boundsNoEffects compared with the opentype prediction,
//     and the ratio stored as a correction (settings key `measureCal`); the
//     probe runs inside a rolled-back modal scope, so it leaves no layer and
//     no history entry. The same probe checks the px -> pt conversion for the
//     document's resolution (`sizeScale`);
//  3. fallback without a font file: per-character advances measured with a
//     probe layer ("H" + c + "H" minus "HH"), cached permanently (`charWidths`).

import { ps, batchPlay, modal, docInfo, num } from "./ps.js";
import { facesOf } from "./fonts.js";
import { T } from "./settings.js";
import { makeMeasurer, faceMetrics, capHeightPx } from "../core/measure.js";
import { pickFaces, glyphContours } from "../core/preview.js";
import { makeTextLayer, pxToPt, deleteLayerById } from "../core/psdesc.js";
import { pyRound, pyInt } from "../core/py.js";

const faceSets = new Map();     // family -> facesOf() result (promise)
const PROBE_TEXT = "The quick brown fox, HAMBURGEFONSTIV 0123";
const PROBE_PX = 100;

export function facesFor(family) {
  if (!faceSets.has(family)) faceSets.set(family, facesOf(family));
  return faceSets.get(family);
}

export function forgetFaces() {
  faceSets.clear();
}

/** {regular, bold, fauxBoldRuns, fauxItalic} for a style (core.pickFaces). */
export async function stylesFaces(family, bold, italic) {
  const fam = await facesFor(family);
  if (!fam.regular && !fam.bold && !fam.italic) return null;
  return pickFaces({ regular: fam.regular || fam.bold || fam.italic, bold: fam.bold, italic: fam.italic, boldItalic: fam.boldItalic },
    bold, italic);
}

/** The PS style run entries for a style: psName + synthetic flags. */
export async function styleRunInfo(family, bold, italic) {
  const fam = await facesFor(family);
  const c = fam.cuts;
  const pick = (want) => c[want];
  let entry;
  let synB = false;
  let synI = false;
  if (bold && italic) {
    entry = pick("boldItalic") || pick("bold") || pick("italic") || pick("regular");
    synB = !(pick("boldItalic") || pick("bold"));
    synI = !(pick("boldItalic") || pick("italic"));
  } else if (bold) {
    entry = pick("bold") || pick("regular");
    synB = !pick("bold");
  } else if (italic) {
    entry = pick("italic") || pick("regular");
    synI = !pick("italic");
  } else {
    entry = pick("regular") || pick("bold") || pick("italic");
  }
  if (!entry) return null;
  return { psName: entry.psName, family: fam.family, style: entry.style, syntheticBold: synB, syntheticItalic: synI };
}

function calStore() {
  const v = T.get("measureCal", null);
  return v && typeof v === "object" ? v : { faces: {}, sizeScale: {} };
}

export function calibrationFor(psName) {
  const c = calStore();
  return (c.faces && c.faces[psName]) || null;
}

/** Photoshop px per requested px at this resolution (1 when unknown). */
export function sizeScale(resolution) {
  const c = calStore();
  const v = c.sizeScale && c.sizeScale[String(Math.round(resolution))];
  return typeof v === "number" && v > 0 ? v : 1;
}

function inkBox(face, text, px) {
  const contours = glyphContours(face, text, 0, 0, px);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0, h: y1 - y0 };
}

async function probeBounds(run, text, px) {
  const info = docInfo();
  const res = info.resolution;
  const d = makeTextLayer({
    text,
    runs: [{ from: 0, to: text.length, ...run }],
    sizePt: pxToPt(px, res),
    leadingPt: pxToPt(px * 1.2, res),
    color: "#000000",
    align: "left",
    anchorPct: { x: 5, y: 50 },
    ligatures: true,
  });
  await batchPlay([d]);
  const layer = ps().app.activeDocument.activeLayers[0];
  const r = await batchPlay([{ _obj: "get", _target: [{ _property: "boundsNoEffects" }, { _ref: "layer", _id: layer.id }] }]);
  const b = r[0].boundsNoEffects;
  await batchPlay([deleteLayerById(layer.id)]);
  return { w: num(b.right) - num(b.left), h: num(b.bottom) - num(b.top) };
}

/**
 * Calibrate one cut against Photoshop. Needs an open document (the probe
 * lives there for a moment). Returns {width, height} ratios or null.
 */
export async function calibrate(family, bold = false, italic = false) {
  const info = docInfo();
  if (!info) return null;
  const run = await styleRunInfo(family, bold, italic);
  const faces = await stylesFaces(family, bold, italic);
  if (!run || !faces) return null;
  const face = bold ? faces.bold : faces.regular;
  const want = inkBox(face, PROBE_TEXT, PROBE_PX);
  let got = null;
  await modal("TypeR measure", async () => {
    got = await probeBounds(run, PROBE_TEXT, PROBE_PX);
  }, { rollback: true });
  if (!got || !want.w || !want.h) return null;
  const heightRatio = got.h / want.h;
  const c = calStore();
  if (!c.faces) c.faces = {};
  if (!c.sizeScale) c.sizeScale = {};
  // the size check: a probe that comes out res/72 too big or small means the
  // px -> pt conversion must be scaled for this resolution
  c.sizeScale[String(Math.round(info.resolution))] = heightRatio;
  c.faces[run.psName] = { width: (got.w / want.w) / heightRatio, height: heightRatio, at: Date.now() };
  T.set("measureCal", c);
  return c.faces[run.psName];
}

/**
 * Calibrate a cut on its first use (once per PostScript name, stored in
 * `measureCal`). The probe runs in a rolled-back modal scope: no layer and
 * no history entry is left behind. Never throws; false when it could not.
 */
const calibrating = new Map();
export async function ensureCalibrated(family, bold = false, italic = false) {
  try {
    const run = await styleRunInfo(family, bold, italic);
    if (!run || calibrationFor(run.psName) || !docInfo()) return !!(run && calibrationFor(run.psName));
    if (!calibrating.has(run.psName)) {
      calibrating.set(run.psName, calibrate(family, bold, italic).catch(() => null).finally(() => calibrating.delete(run.psName)));
    }
    return !!(await calibrating.get(run.psName));
  } catch (e) {
    return false;
  }
}

// --- fallback: character advances from probe layers ---------------------------

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");

export async function measureCharWidths(family, bold, italic, extraChars = "") {
  const run = await styleRunInfo(family, bold, italic);
  if (!run || !docInfo()) return null;
  const all = T.get("charWidths", {}) || {};
  const table = { ...(all[run.psName] || {}) };
  const todo = [...new Set(Array.from(ASCII + extraChars))].filter((c) => !(c in table));
  if (!todo.length) return table;
  await modal("TypeR measure", async () => {
    const base = await probeBounds(run, "HH", PROBE_PX);
    for (const c of todo) {
      const b = await probeBounds(run, "H" + c + "H", PROBE_PX);
      table[c] = Math.max(0, b.w - base.w) / PROBE_PX;
    }
    table.__asc = 0.8;
    table.__desc = 0.2;
  }, { rollback: true });
  all[run.psName] = table;
  T.set("charWidths", all);
  return table;
}

function tableMeasurer(table, lineSpacing) {
  return (px0) => {
    const px = Math.max(1, pyInt(pyRound(px0)));
    const w = (s) => Array.from(String(s)).reduce((a, c) => a + (table[c] !== undefined ? table[c] : 0.55), 0) * px;
    const widthOf = (x) => {
      let runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
      if (runs === undefined) {
        if (Array.isArray(x)) runs = x;
        else return w(x);
      }
      return runs.reduce((a, [t]) => a + w(t), 0);
    };
    const asc = (table.__asc || 0.8) * px;
    const desc = (table.__desc || 0.2) * px;
    return [widthOf, w(" "), (asc + desc) * lineSpacing, asc, desc];
  };
}

/**
 * The measurer the insert path, TextShapR and the batch use:
 * env.measurer(lineSpacing, bold, italic) and env.capHeight(px, bold, italic).
 * Resolves the faces once (async) and then answers synchronously.
 */
export async function measuringEnv(family, opts = {}) {
  const fam = await facesFor(family);
  const ligatures = opts.ligatures !== false;
  const hasFile = !!(fam.regular || fam.bold || fam.italic || fam.boldItalic);
  const facesByStyle = {};
  for (const b of [false, true]) {
    for (const i of [false, true]) {
      facesByStyle[`${b}${i}`] = hasFile
        ? pickFaces({ regular: fam.regular || fam.bold || fam.italic, bold: fam.bold, italic: fam.italic, boldItalic: fam.boldItalic }, b, i)
        : null;
    }
  }
  const fallback = hasFile ? null : await measureCharWidths(family, false, false, opts.text || "");
  const calOf = (bold, italic) => {
    const c = fam.cuts;
    const e = bold && italic ? c.boldItalic || c.bold : bold ? c.bold : italic ? c.italic : c.regular;
    const cal = e ? calibrationFor(e.psName) : null;
    return cal ? cal.width : 1;
  };
  return {
    hasFile,
    faces: (bold, italic) => facesByStyle[`${!!bold}${!!italic}`],
    measurer(lineSpacing, bold, italic) {
      if (!hasFile) return tableMeasurer(fallback || {}, lineSpacing);
      const f = facesByStyle[`${!!bold}${!!italic}`];
      return makeMeasurer({ regular: f.regular, bold: f.bold }, lineSpacing, bold, italic, {
        ligatures, cal: { regular: calOf(false, italic), bold: calOf(true, italic) },
      });
    },
    capHeight(px, bold, italic) {
      if (!hasFile) return null;
      const f = facesByStyle[`${!!bold}${!!italic}`];
      return capHeightPx(bold ? f.bold : f.regular, px);
    },
    metrics(bold, italic) {
      if (!hasFile) return null;
      const f = facesByStyle[`${!!bold}${!!italic}`];
      return faceMetrics(bold ? f.bold : f.regular);
    },
  };
}

/** The in-Photoshop measuring self-test (Setup › Diagnostics): for each
 *  font, predicted vs Photoshop ink width of a sample; |error| must be <= 1 %. */
export async function selfTest(familiesToTest) {
  const out = [];
  for (const family of familiesToTest) {
    try {
      const run = await styleRunInfo(family, false, false);
      const faces = await stylesFaces(family, false, false);
      if (!run || !faces) {
        out.push({ family, ok: false, note: "no font file" });
        continue;
      }
      const cal = calibrationFor(run.psName) || await calibrate(family);
      const sample = "Every bubble gets its line, WAVE AVATAR Tokyo 1990!";
      const want = inkBox(faces.regular, sample, 80);
      let got = null;
      await modal("TypeR measure", async () => {
        got = await probeBounds(run, sample, 80);
      }, { rollback: true });
      const scale = sizeScale(docInfo().resolution);
      const predicted = want.w * (cal ? cal.width : 1) * scale;
      const err = (got.w - predicted) / predicted;
      out.push({ family, ok: Math.abs(err) <= 0.01, errorPct: err * 100, raw: (got.w / (want.w * scale) - 1) * 100 });
    } catch (e) {
      out.push({ family, ok: false, note: String(e && e.message ? e.message : e) });
    }
  }
  return out;
}
