// Fill the document's selection with a pattern or a gradient (Style tab ->
// "Fill the current selection"), and load pattern images from disk.
//
// Port of TypeR-Krita `_fill_selection_with_pattern`. Krita painted the tile
// into a new paint layer clipped to the selection. Photoshop can do better
// for a repeating pattern: a Pattern Fill layer whose mask Photoshop builds
// from the active selection, so the fill stays editable (scale, pattern,
// mask). A gradient is re-rendered at the exact selection size (dots stay
// round) and written as pixels, clipped by the selection mask — like Krita.

import { ps, uxp, batchPlay, modal, docInfo, selectionBounds } from "./ps.js";
import { selectionMask, newLayerFromRGBA, hasImaging } from "./pixels.js";
import { ensurePattern } from "./patterns.js";
import { readBytes } from "./files.js";
import { decodePng } from "../core/png.js";
import { makePatternGradient } from "../core/patterns.js";

/** Returns [ok, key]. tile = {w,h,rgba}; stretch = fit once (gradient);
 *  gradSpec re-renders the gradient at the selection size. */
export async function fillSelection(tile, { stretch = false, gradSpec = null, scale = 100, layerName = "TypeR pattern" } = {}) {
  if (!docInfo()) return [false, "st_no_doc"];
  if (!gradSpec && !tile) return [false, "fill_pattern_pick"];
  const sel = await selectionBounds();
  if (!sel || sel[2] <= 0 || sel[3] <= 0) return [false, "sel_none"];
  const [sx, sy, sw, sh] = sel;
  try {
    if (!gradSpec && !stretch) {
      // editable Pattern Fill layer; its mask comes from the selection
      await modal("TypeR: fill selection", async () => {
        const pat = await ensurePattern(tile, "TypeR fill");
        if (!pat) throw new Error("pattern");
        await batchPlay([{
          _obj: "make",
          _target: [{ _ref: "contentLayer" }],
          using: {
            _obj: "contentLayer",
            name: layerName,
            type: {
              _obj: "patternLayer",
              pattern: pat.id ? { _obj: "pattern", name: pat.name, ID: pat.id } : { _obj: "pattern", name: pat.name },
              scale: { _unit: "percentUnit", _value: scale },
              phase: { _obj: "paint", horizontal: sx, vertical: sy },
            },
          },
        }]);
      });
      return [true, "sel_filled"];
    }
    if (!hasImaging()) return [false, "sel_none"];
    await modal("TypeR: fill selection", async () => {
      const [x, y, w, h] = [sx, sy, sw, sh];
      let img;
      if (gradSpec) {
        img = makePatternGradient(gradSpec.kind, gradSpec.fg, gradSpec.bg, gradSpec.size, gradSpec.gap, gradSpec.angleDeg || 0, w, h);
      } else {
        img = stretchTile(tile, w, h);
      }
      const mask = await selectionMask([x, y, w, h]);
      if (mask) {
        for (let i = 0; i < w * h; i++) img.rgba[i * 4 + 3] = Math.round(img.rgba[i * 4 + 3] * mask[i] / 255);
      }
      await newLayerFromRGBA(layerName, img.rgba, x, y, w, h);
    });
    return [true, "sel_filled"];
  } catch (e) {
    return [false, "sel_none"];
  }
}

/** Bilinear stretch of a tile across w x h (one span, for a gradient). */
export function stretchTile(t, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = h > 1 ? (y / (h - 1)) * (t.h - 1) : 0;
    const y0 = Math.floor(fy);
    const y1 = Math.min(t.h - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = w > 1 ? (x / (w - 1)) * (t.w - 1) : 0;
      const x0 = Math.floor(fx);
      const x1 = Math.min(t.w - 1, x0 + 1);
      const dx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = t.rgba[(y0 * t.w + x0) * 4 + c];
        const b = t.rgba[(y0 * t.w + x1) * 4 + c];
        const cc = t.rgba[(y1 * t.w + x0) * 4 + c];
        const d = t.rgba[(y1 * t.w + x1) * 4 + c];
        out[(y * w + x) * 4 + c] = Math.round((a * (1 - dx) + b * dx) * (1 - dy) + (cc * (1 - dx) + d * dx) * dy);
      }
    }
  }
  return { w, h, rgba: out };
}

/**
 * An image file as a tile {w, h, rgba}, or null. PNG is decoded here; other
 * formats (JPEG, BMP, WebP, …) are opened by Photoshop in a scratch
 * document and read back through the Imaging API.
 */
export async function loadImageFile(path) {
  let bytes;
  try {
    bytes = await readBytes(path);
  } catch (e) {
    return null;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    try {
      return decodePng(bytes);
    } catch (e) {
      // fall through to Photoshop
    }
  }
  if (!hasImaging()) return null;
  let out = null;
  try {
    await modal("TypeR: read image", async () => {
      const { app } = ps();
      const back = app.activeDocument;
      const { localFileSystem } = uxp().storage;
      const entry = await localFileSystem.getEntryWithUrl("file:" + String(path).replace(/\\/g, "/"));
      const doc = await app.open(entry);
      try {
        const res = await ps().imaging.getPixels({ documentID: doc.id, componentSize: 8, applyAlpha: false, colorSpace: "RGB" });
        const img = res.imageData;
        const data = await img.getData({ chunky: true });
        const comps = img.components;
        const w = img.width;
        const h = img.height;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = data[i * comps];
          rgba[i * 4 + 1] = data[i * comps + (comps >= 3 ? 1 : 0)];
          rgba[i * 4 + 2] = data[i * comps + (comps >= 3 ? 2 : 0)];
          rgba[i * 4 + 3] = comps === 4 || comps === 2 ? data[i * comps + comps - 1] : 255;
        }
        img.dispose();
        out = { w, h, rgba };
      } finally {
        await doc.closeWithoutSaving();
        if (back) app.activeDocument = back;
      }
    }, { history: false });
  } catch (e) {
    return null;
  }
  return out;
}
