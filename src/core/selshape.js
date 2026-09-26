// The selection's silhouette for TextShapR and the batch.
//
// Port of TypeR-Krita `TextShapRWidget._sel_shape` and `_selection_fill`:
// a selection mask (one byte per pixel, 0 = unselected) becomes
// ('round' | 'rect', rows) where rows is the outline sampled top to bottom
// as SHAPE_ROWS width fractions normalised to the widest row.

import { pyInt, floorDiv } from "./py.js";

export const SHAPE_ROWS = 20;

/** [kind, rows|null] of a mask w x h. */
export function selShape(mask, w, h) {
  try {
    if (w <= 0 || h <= 0 || !mask || mask.length < w * h) return ["rect", null];
    const colStep = Math.max(1, floorDiv(w, 160));    // bound the work on huge selections
    const rows = [];
    for (let i = 0; i < SHAPE_ROWS; i++) {
      const y = Math.min(h - 1, pyInt((i + 0.5) / SHAPE_ROWS * h));
      const base = y * w;
      let marked = 0;
      let total = 0;
      for (let x = 0; x < w; x += colStep) {
        total += 1;
        if (mask[base + x]) marked += 1;
      }
      rows.push(total ? marked / total : 0.0);
    }
    const widest = rows.length ? Math.max(...rows) : 0.0;
    if (widest <= 0) return ["rect", null];
    const profile = rows.map((r) => r / widest);
    let s = 0;
    for (const r of rows) s += r;
    const frac = s / rows.length;                     // marked area / bounding box
    return [frac < 0.9 ? "round" : "rect", profile];
  } catch (e) {
    return ["rect", null];
  }
}

/** Fraction of the bounding box that is selected (subsampled); 1.0 on error. */
export function selectionFill(mask, w, h) {
  try {
    if (w <= 0 || h <= 0 || !mask || !mask.length) return 1.0;
    const n = mask.length;
    const step = Math.max(1, floorDiv(n, 20000));
    let marked = 0;
    let total = 0;
    for (let i = 0; i < n; i += step) {
      total += 1;
      if (mask[i]) marked += 1;
    }
    return total ? marked / total : 1.0;
  } catch (e) {
    return 1.0;
  }
}
