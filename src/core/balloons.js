// Speech-balloon shape library.
//
// Port of TypeR-Krita `typer_kr/balloons.py`. Every shape is a closed ring of
// points around the box's center whose radius is modulated per angle, then
// joined with straight lines (angular shapes) or smoothed into bezier curves
// (round ones). Host-free: the Photoshop side turns the path into a shape
// layer (see host/balloon.js).

import { fixed, pyMod, pySum } from "./py.js";

const f2 = (v) => fixed(v, 2);

/** A closed smooth path through `points` (Catmull-Rom as cubic beziers). */
function catmullRom(points) {
  const n = points.length;
  let d = `M${f2(points[0][0])},${f2(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[pyMod(i - 1, n)];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6.0;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6.0;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6.0;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6.0;
    d += `C${f2(c1x)},${f2(c1y)} ${f2(c2x)},${f2(c2y)} ${f2(p2[0])},${f2(p2[1])}`;
  }
  return d + "Z";
}

/** Same curve as catmullRom, as structured segments (for Photoshop paths). */
export function catmullRomSegments(points) {
  const n = points.length;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[pyMod(i - 1, n)];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    segs.push({
      from: p1,
      c1: [p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0],
      c2: [p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0],
      to: p2,
    });
  }
  return segs;
}

export function polygon(points) {
  let d = `M${f2(points[0][0])},${f2(points[0][1])}`;
  for (const [px, py] of points.slice(1)) d += `L${f2(px)},${f2(py)}`;
  return d + "Z";
}

/** The small deterministic generator used for jitter (seeded, so a 'rough'
 *  balloon looks the same every time it is inserted). */
export function lcg(seed) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280.0;
  };
}

/** Points of a closed ring on the unit circle, radius modulated by mod(a, i). */
function ring(mod, steps) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = i / steps * Math.PI * 2.0;
    const r = mod(a, i);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** Map the generated points onto the target box exactly. */
function fit(points, x, y, w, h) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sx = x1 > x0 ? w / (x1 - x0) : 1.0;
  const sy = y1 > y0 ? h / (y1 - y0) : 1.0;
  return points.map(([px, py]) => [x + (px - x0) * sx, y + (py - y0) * sy]);
}

export const modOval = () => 1.0;
// 4.5 lobes around the ring: the classic thought-bubble scallop
export const modCloud = (a) => 0.86 + 0.14 * Math.abs(Math.cos(a * 4.5));
// long spikes alternating with a deep inset = an explosion
export const modBurst = (a, i) => (i % 2 ? 0.6 : 1.02);
// the same idea as burst but shallow and even: an electronic voice
export const modRadio = (a, i) => (i % 2 ? 0.82 : 1.0);
// a slow 7-per-turn wobble: the deflated, weak voice
export const modWavy = (a) => 0.94 + 0.07 * Math.sin(a * 7);

export const SHAPES = {
  oval: { mod: modOval, steps: 48, smooth: true },
  dashed: { mod: modOval, steps: 48, smooth: true, dash: true },
  cloud: { mod: modCloud, steps: 44, smooth: true },
  burst: { mod: modBurst, steps: 22, smooth: false },
  radio: { mod: modRadio, steps: 32, smooth: false },
  wavy: { mod: modWavy, steps: 60, smooth: true },
  rough: { mod: null, steps: 26, smooth: false, seed: 7 },
  robot: { mod: null, steps: 0, smooth: false },
};

// stable order for the UI: the everyday shapes first
export const SHAPE_ORDER = ["oval", "cloud", "burst", "radio", "dashed", "robot", "wavy", "rough"];

// which text type each shape belongs to (texttypes ids), for the UI hint
export const SHAPE_FOR_TYPE = {
  oval: "dialogue", cloud: "thought", burst: "shout",
  radio: "radio", dashed: "whisper", robot: "robot",
  wavy: "weak", rough: "monster",
};

/** The fitted outline points of `shape`, or null. */
export function shapePoints(shape, x, y, w, h) {
  const spec = Object.prototype.hasOwnProperty.call(SHAPES, shape) ? SHAPES[shape] : null;
  if (!spec || w <= 0 || h <= 0) return null;
  if (shape === "robot") {
    // a rectangle with its corners cut off — the synthetic-voice balloon
    const c = Math.min(w, h) * 0.18;
    return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c],
      [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
  }
  let pts;
  if (spec.seed !== undefined && spec.seed !== null) {
    const rnd = lcg(spec.seed);
    pts = ring(() => 0.8 + rnd() * 0.3, spec.steps);
  } else {
    pts = ring(spec.mod, spec.steps);
  }
  return fit(pts, x, y, w, h);
}

/** The SVG path data for `shape` filling the box (x, y, w, h). */
export function balloonPath(shape, x, y, w, h) {
  const pts = shapePoints(shape, x, y, w, h);
  if (pts === null) return null;
  return SHAPES[shape].smooth ? catmullRom(pts) : polygon(pts);
}

/** Where the outline crosses x=xt on its BOTTOM side: [[x, y], segIndex]. */
function bottomCrossing(pts, xt) {
  const n = pts.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a[0] === b[0] || (a[0] - xt) * (b[0] - xt) > 0) continue;
    const t = (xt - a[0]) / (b[0] - a[0]);
    const py = a[1] + t * (b[1] - a[1]);
    if (best === null || py > best[0][1]) best = [[xt, py], i];
  }
  return best;
}

/** The outline vertices from segment iFrom to segment iTo, one way round. */
function walk(pts, iFrom, iTo, forward) {
  const n = pts.length;
  const out = [];
  let i = forward ? (iFrom + 1) % n : iFrom;
  const stop = forward ? iTo : (iTo + 1) % n;
  while (out.length <= n) {
    out.push(pts[i]);
    if (i === stop) break;
    i = forward ? (i + 1) % n : pyMod(i - 1, n);
  }
  return out;
}

/** The stretch of outline between the two tail-base crossings that runs
 *  along the BOTTOM of the balloon. */
function baseArc(pts, iL, iR) {
  if (iL === iR) return [];
  const fwd = walk(pts, iL, iR, true);
  const bwd = walk(pts, iL, iR, false);
  const mean = (a) => (a.length ? pySum(a.map((p) => p[1])) / a.length : 0.0);
  return mean(fwd) >= mean(bwd) ? fwd : bwd;
}

/** Tail pieces (hanging off the bottom-left) as [{kind:'circle'|'path', ...}].
 *  Path tails also carry their `points` (for Photoshop). The base follows the
 *  balloon's own outline, so the tail never draws a chord through it. */
export function tailPath(shape, x, y, w, h) {
  const pts = shapePoints(shape, x, y, w, h);
  if (pts === null) return [];
  const tipX = x + w * 0.16;
  const tipY = y + h * 1.30;
  if (shape === "cloud") {
    // a thought trail: shrinking circles instead of a spike
    return [
      { kind: "circle", cx: x + w * 0.30, cy: y + h * 1.06, r: Math.min(w, h) * 0.085 },
      { kind: "circle", cx: tipX, cy: y + h * 1.24, r: Math.min(w, h) * 0.05 },
    ];
  }
  const cl = bottomCrossing(pts, x + w * 0.26);
  const cr = bottomCrossing(pts, x + w * 0.50);
  if (cl === null || cr === null) return [];
  const [pL, iL] = cl;
  const [pR, iR] = cr;
  const base = [pL, ...baseArc(pts, iL, iR), pR];
  let poly;
  if (shape === "radio" || shape === "robot") {
    // a lightning bolt: the voice arrives through a wire
    const midY = (pR[1] + tipY) / 2.0;
    poly = base.concat([[x + w * 0.44, midY], [x + w * 0.30, midY],
      [tipX, tipY], [x + w * 0.26, midY + h * 0.04], [x + w * 0.20, midY]]);
  } else {
    poly = base.concat([[tipX, tipY]]);
  }
  return [{ kind: "path", d: polygon(poly), points: poly }];
}

/** A complete SVG document with the balloon (white fill, black stroke). */
export function balloonSvg(shape, x, y, w, h, imgW, imgH, fill = "#ffffff",
  stroke = "#000000", strokeW = 3.0, tail = true) {
  const d = balloonPath(shape, x, y, w, h);
  if (d === null) return null;
  let dash = "";
  if (SHAPES[shape].dash) {
    // a whisper's outline is broken, not solid
    dash = ` stroke-dasharray="${fixed(strokeW * 2.5, 1)} ${fixed(strokeW * 2.0, 1)}"`;
  }
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${f2(strokeW)}" stroke-linejoin="round"`;
  let body = `<path d="${d}" ${common}${dash}/>`;
  if (tail) {
    for (const t of tailPath(shape, x, y, w, h)) {
      if (t.kind === "circle") {
        body += `<circle cx="${f2(t.cx)}" cy="${f2(t.cy)}" r="${f2(t.r)}" ${common}/>`;
      } else {
        body += `<path d="${t.d}" ${common}/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${imgW}" height="${imgH}">${body}</svg>`;
}
