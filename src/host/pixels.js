// Pixels in and out of Photoshop via the Imaging API (Photoshop 24.2+):
// the selection mask, the page as gray bytes (BubblR detection), page
// thumbnails for the page views, and writing RGBA into a new pixel layer.
// Every call degrades gracefully when the API is missing.

import { ps, docInfo, batchPlay } from "./ps.js";
import * as D from "../core/psdesc.js";

export function hasImaging() {
  try {
    return !!(ps().imaging && ps().imaging.getPixels);
  } catch (e) {
    return false;
  }
}

async function dataOf(imageData) {
  try {
    return await imageData.getData({ chunky: true });
  } finally {
    try {
      imageData.dispose();
    } catch (e) {
      // already gone
    }
  }
}

/** The selection mask inside `bounds` [x, y, w, h] as Uint8Array (0 =
 *  unselected), or null when unavailable. Must run inside a modal scope. */
export async function selectionMask(bounds) {
  if (!hasImaging() || !bounds) return null;
  const info = docInfo();
  const [x, y, w, h] = bounds;
  try {
    const res = await ps().imaging.getSelection({
      documentID: info.id,
      sourceBounds: { left: x, top: y, right: x + w, bottom: y + h },
    });
    const img = res.imageData;
    const data = await dataOf(img);
    if (!data || data.length < w * h) return null;
    const comps = Math.max(1, Math.round(data.length / (w * h)));
    if (comps === 1) return data;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = data[i * comps];
    return out;
  } catch (e) {
    return null;
  }
}

/** Replace the selection with a mask (Uint8Array w*h) at (x, y). */
export async function putSelectionMask(mask, x, y, w, h) {
  if (!hasImaging() || !ps().imaging.putSelection) return false;
  try {
    const img = await ps().imaging.createImageDataFromBuffer(mask, {
      width: w, height: h, components: 1, colorSpace: "Grayscale", chunky: true,
    });
    await ps().imaging.putSelection({ documentID: docInfo().id, imageData: img, targetBounds: { left: x, top: y } });
    img.dispose();
    return true;
  } catch (e) {
    return false;
  }
}

/** The composite page as {rgba (w*h*4), w, h} at `targetW` (full size when
 *  null). */
export async function pageRGBA(targetW = null) {
  if (!hasImaging()) return null;
  const info = docInfo();
  const opts = { documentID: info.id, componentSize: 8, applyAlpha: true, colorSpace: "RGB" };
  if (targetW && targetW < info.w) opts.targetSize = { width: targetW, height: Math.max(1, Math.round(info.h * targetW / info.w)) };
  const res = await ps().imaging.getPixels(opts);
  const img = res.imageData;
  const w = img.width;
  const h = img.height;
  const comps = img.components;
  const data = await dataOf(img);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (comps >= 3) {
      rgba[i * 4] = data[i * comps];
      rgba[i * 4 + 1] = data[i * comps + 1];
      rgba[i * 4 + 2] = data[i * comps + 2];
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i * comps];
    }
    rgba[i * 4 + 3] = comps === 4 || comps === 2 ? data[i * comps + comps - 1] : 255;
  }
  return { rgba, w, h };
}

/** The page as gray bytes (green channel, like Krita's grab_gray). */
export async function pageGray() {
  const p = await pageRGBA(null);
  if (!p) return null;
  const gray = new Uint8Array(p.w * p.h);
  for (let i = 0; i < gray.length; i++) {
    const a = p.rgba[i * 4 + 3] / 255;
    gray[i] = Math.round(p.rgba[i * 4 + 1] * a + 255 * (1 - a));   // transparent = paper white
  }
  return { gray, w: p.w, h: p.h };
}

/** Write RGBA pixels into a NEW pixel layer named `name` at (x, y), clipped
 *  to the canvas. Must run inside a modal scope. Returns the layer id. */
export async function newLayerFromRGBA(name, rgba, x, y, w, h) {
  const info = docInfo();
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } }]);
  const layer = ps().app.activeDocument.activeLayers[0];
  const cx0 = Math.max(0, x);
  const cy0 = Math.max(0, y);
  const cx1 = Math.min(info.w, x + w);
  const cy1 = Math.min(info.h, y + h);
  if (cx1 <= cx0 || cy1 <= cy0) return layer.id;
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const buf = new Uint8Array(cw * ch * 4);
  for (let yy = 0; yy < ch; yy++) {
    const src = ((yy + cy0 - y) * w + (cx0 - x)) * 4;
    buf.set(rgba.subarray(src, src + cw * 4), yy * cw * 4);
  }
  const img = await ps().imaging.createImageDataFromBuffer(buf, {
    width: cw, height: ch, components: 4, colorSpace: "RGB", chunky: true, colorProfile: "sRGB IEC61966-2.1",
  });
  await ps().imaging.putPixels({ documentID: info.id, layerID: layer.id, imageData: img, targetBounds: { left: cx0, top: cy0 } });
  img.dispose();
  return layer.id;
}

/** Select a box as the document selection: an ellipse for a round bubble
 *  (not an SFX box), else a rectangle — like Krita's _select_box. */
export async function selectBox(b) {
  const x = Math.trunc(b.x);
  const y = Math.trunc(b.y);
  const w = Math.trunc(b.w);
  const h = Math.trunc(b.h);
  const round = b.shape === "round" && b.kind !== "sfx" && w * h > 0 && w * h <= 4000000;
  await batchPlay([round ? D.selectEllipse(x, y, w, h) : D.selectRect(x, y, w, h)]);
  return true;
}
