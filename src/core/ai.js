// Pure parts of the BubblR AI bridge: parsing the detector's JSON, the YOLO
// training label. Port of the host-free functions of TypeR-Krita
// `typer_kr/ai_backend.py`. The detector itself is reached through
// tools/bubblr_bridge.py (see host/bubblr.js).

import { pyInt } from "./py.js";

export class AIRunError extends Error {}
export class AIUnavailableError extends Error {}

/** Box dicts (x/y/w/h int, kind bubble|sfx, score) from detect.py's JSON. */
export function parseDetectJson(text) {
  try {
    const data = JSON.parse(text);
    const raw = data.boxes;
    const boxes = [];
    for (const b of raw) {
      const kind = b.kind;
      if (kind !== "bubble" && kind !== "sfx") continue;
      const num = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new TypeError("bad number");
        return n;
      };
      boxes.push({
        x: pyInt(num(b.x)), y: pyInt(num(b.y)), w: pyInt(num(b.w)), h: pyInt(num(b.h)),
        kind, shape: "rect", fill: 1.0, score: Number(b.score !== undefined ? b.score : 0.0),
      });
    }
    return boxes;
  } catch (exc) {
    throw new AIRunError(`bad detector output: ${exc.message || exc}`);
  }
}

/** Panel boxes from panels.py's JSON (malformed entries skipped). */
export function parsePanelsJson(text) {
  const data = JSON.parse(text);
  const out = [];
  for (const p of data.panels || []) {
    const vals = [p.x, p.y, p.w, p.h].map(Number);
    if (vals.some((v) => !Number.isFinite(v))) continue;
    out.push({ x: pyInt(vals[0]), y: pyInt(vals[1]), w: pyInt(vals[2]), h: pyInt(vals[3]),
      score: Number(p.score !== undefined ? p.score : 1.0) });
  }
  return out;
}

export const KIND_CLASS = { bubble: 0, sfx: 1 };

/** YOLO label text: one `class cx cy w h` line per box, normalized/clamped. */
export function makeYoloLabel(boxes, imgW, imgH) {
  const clamp = (v) => Math.min(1.0, Math.max(0.0, v));
  const lines = boxes.map((b) => {
    const cls = KIND_CLASS[b.kind || "bubble"] ?? 0;
    const cx = clamp((b.x + b.w / 2.0) / imgW);
    const cy = clamp((b.y + b.h / 2.0) / imgH);
    const w = clamp(b.w / imgW);
    const h = clamp(b.h / imgH);
    return `${cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
  });
  return lines.length ? lines.join("\n") + "\n" : "";
}
