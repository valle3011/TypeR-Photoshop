// Colour picking through Photoshop's own colour picker.
//
// Krita's QColorDialog applied the colour live while it was dragged; the
// Photoshop picker is a blocking native dialog that reports only the final
// colour, so the port applies it on OK (PORT_PLAN.md §3). showColorPicker is
// tried outside a modal scope first (it is UI waiting, not a document change);
// Photoshop versions that insist on a modal scope get one, without history.

import { batchPlay, modal } from "./ps.js";
import { hexToRgb } from "../core/psdesc.js";

function toHex(c) {
  if (!c) return null;
  const f = (v, float) => {
    let n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (float) n *= 255;
    return Math.max(0, Math.min(255, Math.round(n)));
  };
  let r;
  let g;
  let b;
  if (c.RGBFloatColor) {
    const x = c.RGBFloatColor;
    [r, g, b] = [f(x.red, true), f(x.grain !== undefined ? x.grain : x.green, true), f(x.blue, true)];
  } else {
    const x = c.color || c;
    if (x.red === undefined) return null;
    [r, g, b] = [f(x.red), f(x.grain !== undefined ? x.grain : x.green), f(x.blue)];
  }
  if ([r, g, b].some((v) => v === null)) return null;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Show the picker; resolves "#rrggbb" or null (cancelled / unavailable). */
export async function pickColor(initial = "#000000", title = "") {
  const c = hexToRgb(initial);
  const desc = {
    _obj: "showColorPicker",
    context: title || "",
    color: { _obj: "RGBColor", red: c.red, grain: c.green, blue: c.blue },
    dontRecord: true,
    forceNotify: true,
  };
  const read = (res) => {
    const d = Array.isArray(res) ? res[0] : res;
    if (!d || d.color === undefined && d.RGBFloatColor === undefined) return null;
    return toHex(d);
  };
  try {
    return read(await batchPlay([desc]));
  } catch (e) {
    let out = null;
    try {
      await modal("TypeR: colour", async () => {
        out = read(await batchPlay([desc]));
      }, { history: false });
    } catch (e2) {
      return undefined;               // no picker: caller falls back to hex entry
    }
    return out;
  }
}
