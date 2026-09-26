// Layer housekeeping: finding and removing TypeR's own layers.
//
// ⚠ Only layers whose name starts with the exact "TypeR NN — " prefix are
// ever removed (layout.isTyperLayerName), so a hand-made layer can never be
// eaten by "Replace previously inserted line" or "Undo batch".

import { ps, num } from "./ps.js";
import { isTyperLayerName } from "../core/layout.js";

function rectsOverlap(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Every layer of the document (groups descended), top to bottom. */
export function allLayers(doc = null) {
  const d = doc || ps().app.activeDocument;
  const out = [];
  const walk = (layers) => {
    for (const l of layers || []) {
      out.push(l);
      if (l.layers && l.layers.length) walk(l.layers);
    }
  };
  if (d) walk(d.layers);
  return out;
}

function boundsOf(layer) {
  try {
    const b = layer.boundsNoEffects || layer.bounds;
    const left = num(b.left);
    const top = num(b.top);
    return [left, top, num(b.right) - left, num(b.bottom) - top];
  } catch (e) {
    return [0, 0, 0, 0];
  }
}

/**
 * Remove earlier TypeR layers of the 1-based unit `layerIndex` (port of
 * _remove_existing_layers). With `box` [x, y, w, h] only layers that overlap
 * it are removed (one script line split over two bubbles keeps the other
 * piece); unreadable bounds count as overlapping. Must run inside a modal
 * scope. Returns how many were removed; never throws.
 */
export async function removeExistingLayers(layerIndex, box = null) {
  let removed = 0;
  try {
    for (const layer of allLayers()) {
      try {
        if (!isTyperLayerName(layer.name, layerIndex)) continue;
        if (box) {
          const r = boundsOf(layer);
          if (r[2] > 0 && r[3] > 0 && !rectsOverlap(r, box)) continue;
        }
        await layer.delete();
        removed += 1;
      } catch (e) {
        // a failed removal must not block the insert
      }
    }
  } catch (e) {
    // no document / API hiccup
  }
  return removed;
}

/** The TypeR layers of a unit (for putting a balloon underneath). */
export function typerLayersOf(layerIndex) {
  return allLayers().filter((l) => isTyperLayerName(l.name, layerIndex));
}
