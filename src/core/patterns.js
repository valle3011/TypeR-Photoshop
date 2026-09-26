// Generated screentone patterns and gradients as RGBA tiles.
//
// Port of TypeR-Krita `typer_kr/imgfx.py` (make_pattern, make_gradient,
// make_pattern_gradient), drawn with core/raster.js instead of QPainter. The
// tiles are seamless; host/patterns.js turns them into Photoshop patterns.

import { fillCoverage, rectContour, ellipseContour, paint, parseColor } from "./raster.js";

export const PATTERN_KINDS = ["dots", "hstripes", "vstripes", "diagonal", "crosshatch", "grid", "checker", "noise", "sparkle"];

function tile(w, h, bg) {
  const rgba = new Uint8Array(Math.max(1, w) * Math.max(1, h) * 4);
  if (bg) {
    const [r, g, b, a] = parseColor(bg);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { w: Math.max(1, w), h: Math.max(1, h), rgba };
}

function draw(t, contours, color) {
  const cov = fillCoverage(contours, t.w, t.h);
  paint(t.rgba, t.w, t.h, cov, color);
}

function star4(cx, cy, r) {
  const ri = r * 0.2;
  return [[cx, cy - r], [cx + ri, cy - ri], [cx + r, cy], [cx + ri, cy + ri],
    [cx, cy + r], [cx - ri, cy + ri], [cx - r, cy], [cx - ri, cy - ri]];
}

// the Python generator seeds random.Random; any fixed PRNG keeps tiles stable
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small, seamlessly tiling pattern tile {w, h, rgba}.
 * kind: one of PATTERN_KINDS; fg: ink colour; bg: background or null
 * (transparent); size: feature size (band, dot radius, cell); gap: spacing.
 */
export function makePattern(kind, fg = "#000000", bg = null, size = 8, gap = 8) {
  const s = Math.max(1, Math.trunc(size));
  const g = Math.max(0, Math.trunc(gap));
  if (kind === "hstripes" || kind === "vstripes") {
    const period = Math.max(2, s + g);
    const t = tile(period, period, bg);
    draw(t, [kind === "hstripes" ? rectContour(0, 0, period, s) : rectContour(0, 0, s, period)], fg);
    return t;
  }
  if (kind === "checker") {
    const cell = Math.max(1, s);
    const t = tile(cell * 2, cell * 2, bg);
    draw(t, [rectContour(0, 0, cell, cell), rectContour(cell, cell, cell, cell)], fg);
    return t;
  }
  if (kind === "dots") {
    const r = Math.max(1, s);
    const period = Math.max(2 * r + 1, 2 * r + g);
    const t = tile(period, period, bg);
    const c = period / 2.0;
    // centre dot + wrapped quarters at the corners keep the grid seamless
    draw(t, [[c, c], [0, 0], [period, 0], [0, period], [period, period]].map(([x, y]) => ellipseContour(x, y, r, r)), fg);
    return t;
  }
  if (kind === "grid" || kind === "crosshatch") {
    const period = Math.max(2, s + g);
    const t = tile(period, period, bg);
    const lw = Math.max(1, s);
    // the pen centred on the tile edge: half above/left, half wraps around
    draw(t, [rectContour(0, 0, period, lw / 2), rectContour(0, period - lw / 2, period, lw / 2),
      rectContour(0, 0, lw / 2, period), rectContour(period - lw / 2, 0, lw / 2, period)], fg);
    return t;
  }
  if (kind === "diagonal") {
    const period = Math.max(2, s + g);
    const t = tile(period, period, bg);
    const [r, gg, b, a] = parseColor(fg);
    for (let y = 0; y < period; y++) {
      for (let x = 0; x < period; x++) {
        if ((x + y) % period < s) {
          const i = (y * period + x) * 4;
          t.rgba[i] = r;
          t.rgba[i + 1] = gg;
          t.rgba[i + 2] = b;
          t.rgba[i + 3] = a;
        }
      }
    }
    return t;
  }
  if (kind === "noise") {
    const period = Math.max(16, (s + g) * 4);
    const t = tile(period, period, bg);
    const r = Math.max(0.6, s / 3.0);
    const dens = s / (s + g);
    const count = Math.max(1, Math.trunc(period * period * dens * 0.12 / (r * r)));
    const rnd = rng(1234 + period * 31 + Math.trunc(dens * 997));
    const contours = [];
    for (let k = 0; k < count; k++) {
      const x = rnd() * period;
      const y = rnd() * period;
      for (const ox of [0, -period, period]) {
        if (ox && !(x < r || x > period - r)) continue;
        for (const oy of [0, -period, period]) {
          if (oy && !(y < r || y > period - r)) continue;
          contours.push(ellipseContour(x + ox, y + oy, r, r, 12));
        }
      }
    }
    draw(t, contours, fg);
    return t;
  }
  if (kind === "sparkle") {
    const period = Math.max(6, s + g);
    const t = tile(period, period, bg);
    const r = Math.max(1.5, s * 0.9);
    const c = period / 2.0;
    draw(t, [[c, c], [0, 0], [period, 0], [0, period], [period, period]].map(([x, y]) => star4(x, y, r)), fg);
    return t;
  }
  const t = tile(Math.max(2, s), Math.max(2, s), fg);   // unknown -> a solid fg tile
  return t;
}

function lerpColor(c1, c2, t) {
  return [0, 1, 2, 3].map((i) => Math.round(c1[i] + (c2[i] - c1[i]) * t));
}

/** A linear c1 -> c2 gradient (meant to be stretched over a selection). */
export function makeGradient(c1 = "#000000", c2 = "#ffffff", angleDeg = 0, size = 256) {
  const s = Math.max(2, Math.trunc(size));
  const t = tile(s, s, null);
  linearFill(t, parseColor(c1), parseColor(c2), angleDeg, true);
  return t;
}

function linearFill(t, c1, c2, angleDeg, fromCentreHalf) {
  const a = angleDeg * Math.PI / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const cx = t.w / 2.0;
  const cy = t.h / 2.0;
  const ext = fromCentreHalf ? t.w / 2.0 : (Math.abs(dx) * t.w + Math.abs(dy) * t.h) / 2.0;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const proj = ((x + 0.5 - cx) * dx + (y + 0.5 - cy) * dy) / (2 * ext) + 0.5;
      const col = lerpColor(c1, c2, Math.min(1, Math.max(0, proj)));
      const i = (y * t.w + x) * 4;
      t.rgba[i] = col[0];
      t.rgba[i + 1] = col[1];
      t.rgba[i + 2] = col[2];
      t.rgba[i + 3] = col[3];
    }
  }
}

/**
 * A screentone-DENSITY gradient of `kind` at width x height: ink coverage
 * ramps from full at the tail of `angleDeg` to none at its head (the manga
 * tone fade). "smooth" = a plain colour fade. Render it 1:1 (never stretch —
 * the dots would turn into ovals).
 */
export function makePatternGradient(kind, fg = "#000000", bg = null, size = 6, gap = 8, angleDeg = 0, width = 256, height = 256) {
  const W = Math.max(2, Math.trunc(width));
  const H = Math.max(2, Math.trunc(height));
  const t = tile(W, H, bg);
  const fgc = parseColor(fg);
  if (kind === "smooth") {
    const light = bg ? parseColor(bg) : [fgc[0], fgc[1], fgc[2], 0];
    linearFill(t, fgc, light, angleDeg, false);
    return t;
  }
  const a = angleDeg * Math.PI / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const projs = [[0, 0], [0, H], [W, 0], [W, H]].map(([x, y]) => x * dx + y * dy);
  const pmin = Math.min(...projs);
  const span = (Math.max(...projs) - pmin) || 1.0;
  const coverage = (px2, py2) => {
    const ramp = (px2 * dx + py2 * dy - pmin) / span;
    const c = 1.0 - ramp;
    return c < 0 ? 0 : c > 1 ? 1 : c;
  };
  const s = Math.max(1, Math.trunc(size));
  const g = Math.max(0, Math.trunc(gap));
  const step = Math.max(2, s + g);
  const contours = [];
  if (kind === "dots" || kind === "checker" || kind === "sparkle") {
    const maxFeat = step * (kind === "dots" ? 0.72 : kind === "sparkle" ? 1.15 : 1.0);
    for (let cy = step / 2.0; cy < H + step; cy += step) {
      for (let cx = step / 2.0; cx < W + step; cx += step) {
        const f = coverage(cx, cy) * maxFeat;
        if (f < 0.6) continue;
        if (kind === "dots") contours.push(ellipseContour(cx, cy, f / 2, f / 2, 20));
        else if (kind === "sparkle") contours.push(star4(cx, cy, f / 2.0));
        else contours.push(rectContour(cx - f / 2, cy - f / 2, f, f));
      }
    }
  } else if (kind === "noise") {
    const r = Math.max(0.6, s / 3.0);
    const rnd = rng(4321 + W * 7 + H * 13);
    for (let gy = 0; gy < H; gy += step) {
      for (let gx = 0; gx < W; gx += step) {
        if (rnd() < coverage(gx, gy)) contours.push(ellipseContour(gx, gy, r, r, 10));
      }
    }
  } else if (kind === "diagonal") {
    for (let k = -H; k < W; k += step) {
      const cxx = Math.min(Math.max(k + H / 2.0, 0), W);
      const f = coverage(cxx, H / 2.0) * s;
      if (f < 0.6) continue;
      const hw = f / 2 / Math.SQRT2 * 2;
      contours.push([[k - hw / 2, 0], [k + hw / 2, 0], [k + H + hw / 2, H], [k + H - hw / 2, H]]);
    }
  } else if (kind === "hstripes" || kind === "vstripes") {
    const horiz = kind === "hstripes";
    const len = horiz ? W : H;
    for (let pos = step / 2.0; pos < (horiz ? H : W) + step; pos += step) {
      const f = coverage(horiz ? len / 2.0 : pos, horiz ? pos : len / 2.0) * step;
      if (f < 0.6) continue;
      contours.push(horiz ? rectContour(0, pos - f / 2, W, f) : rectContour(pos - f / 2, 0, f, H));
    }
  } else {
    for (let y = step / 2.0; y < H + step; y += step) {
      const f = coverage(W / 2.0, y) * s;
      if (f >= 0.6) contours.push(rectContour(0, y - f / 2, W, f));
    }
    for (let x = step / 2.0; x < W + step; x += step) {
      const f = coverage(x, H / 2.0) * s;
      if (f >= 0.6) contours.push(rectContour(x - f / 2, 0, f, H));
    }
  }
  // draw the features one by one so overlapping ones do not cancel out
  for (const c of contours) draw(t, [c], fg);
  return t;
}

/** Scale a tile (nearest neighbour) — used for pattern scale %. */
export function scaleTile(t, pct) {
  const s = Math.max(0.05, pct / 100);
  const w = Math.max(1, Math.round(t.w * s));
  const h = Math.max(1, Math.round(t.h * s));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(t.h - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(t.w - 1, Math.floor(x / s));
      out.set(t.rgba.subarray((sy * t.w + sx) * 4, (sy * t.w + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { w, h, rgba: out };
}
