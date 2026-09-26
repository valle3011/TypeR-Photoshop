// Drawing the balloon itself as a Photoshop SHAPE layer.
//
// Port of TypeR-Krita `on_insert_balloon`. The outline comes from
// core/balloons.js (the same generator Krita uses); round shapes become
// smooth bezier anchors (the Catmull-Rom handles), angular ones corner points,
// and the tail (spike, bolt or thought circles) is part of the same shape.
// Unlike Krita, Photoshop keeps the stacking order, so the balloon is moved
// UNDER the unit's text layer when that one already exists.

import { ps, batchPlay, modal, docInfo } from "./ps.js";
import { typerLayersOf } from "./layers.js";
import { SHAPES, shapePoints, tailPath } from "../core/balloons.js";
import { ellipseContour } from "../core/raster.js";
import * as D from "../core/psdesc.js";

/** Returns [ok, key, fmt]. box = [x, y, w, h]. */
export async function insertBalloon(shape, box, { tail = true, layerIndex = null, fill = "#ffffff", stroke = "#000000", strokeW = 3.0 } = {}) {
  if (!docInfo()) return [false, "st_no_doc", {}];
  const [x, y, w, h] = box || [];
  const pts = box ? shapePoints(shape, x, y, w, h) : null;
  if (!pts) return [false, "st_balloon_no_box", {}];
  const spec = SHAPES[shape];
  const comps = [D.pathComponent(pts, spec.smooth ? D.catmullHandles(pts) : null)];
  if (tail) {
    for (const t of tailPath(shape, x, y, w, h)) {
      if (t.kind === "circle") {
        const ring = ellipseContour(t.cx, t.cy, t.r, t.r, 16);
        comps.push(D.pathComponent(ring, D.catmullHandles(ring)));
      } else {
        comps.push(D.pathComponent(t.points));
      }
    }
  }
  try {
    await modal("TypeR: balloon", async () => {
      await batchPlay([D.makeShapeLayer(comps, fill, stroke, strokeW, !!spec.dash)]);
      await batchPlay([D.renameLayer(`TypeR — balloon (${shape})`)]);
      // Photoshop keeps the order: put the balloon under the unit's text
      if (layerIndex !== null) {
        const texts = typerLayersOf(layerIndex);
        if (texts.length) {
          const { app, constants } = ps();
          const balloon = app.activeDocument.activeLayers[0];
          // PLACEAFTER = directly below the text layer in the stack
          await balloon.move(texts[texts.length - 1], constants.ElementPlacement.PLACEAFTER);
        }
      }
    });
  } catch (exc) {
    return [false, "st_balloon_fail", { exc: exc && exc.message ? exc.message : String(exc) }];
  }
  return [true, "st_balloon_inserted", { shape }];
}
