// A small software rasteriser for the panel's text previews.
//
// UXP's canvas has no text, image or pattern support, so the live preview,
// the TextShapR cards and the font-face previews are drawn here: glyph
// outlines (opentype.js path commands) are flattened to polygons, filled with
// anti-aliased non-zero coverage, outlines are grown with a Euclidean
// distance transform (round joins for free), the soft outline is a blurred
// dilation, and everything is composited bottom-to-top in the same order as
// the inserted layer: soft halo, shadow, 2nd outline, outline, fill.
// Host-free; the result is RGBA bytes (see core/png.js for the data URL).

// --- geometry ---------------------------------------------------------------

/** opentype.js path commands -> list of closed polygons [[x, y], …]. */
export function flattenCommands(cmds, tol = 0.25) {
  const contours = [];
  let cur = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const seg = (len) => Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
  for (const c of cmds) {
    if (c.type === "M") {
      if (cur && cur.length > 2) contours.push(cur);
      cur = [[c.x, c.y]];
      cx = sx = c.x;
      cy = sy = c.y;
    } else if (c.type === "L") {
      if (!cur) cur = [[cx, cy]];
      cur.push([c.x, c.y]);
      cx = c.x;
      cy = c.y;
    } else if (c.type === "Q") {
      if (!cur) cur = [[cx, cy]];
      const n = seg(Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y]);
      }
      cx = c.x;
      cy = c.y;
    } else if (c.type === "C") {
      if (!cur) cur = [[cx, cy]];
      const n = seg(Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([
          u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      cx = c.x;
      cy = c.y;
    } else if (c.type === "Z") {
      if (cur && cur.length > 2) contours.push(cur);
      cur = null;
      cx = sx;
      cy = sy;
    }
  }
  if (cur && cur.length > 2) contours.push(cur);
  return contours;
}

export function rectContour(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function ellipseContour(cx, cy, rx, ry, steps = 48) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

export function translateContours(contours, dx, dy) {
  return contours.map((c) => c.map(([x, y]) => [x + dx, y + dy]));
}

// --- coverage ---------------------------------------------------------------

const SUB = 4;   // sub-scanlines per pixel row

/** Anti-aliased non-zero-winding coverage (0..1 per pixel) of polygons. */
export function fillCoverage(contours, w, h, into = null) {
  const cov = into || new Float32Array(w * h);
  const edges = [];
  for (const c of contours) {
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = c[i];
      const [x1, y1] = c[(i + 1) % n];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
    }
  }
  if (!edges.length) return cov;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    if (e[1] < minY) minY = e[1];
    if (e[3] > maxY) maxY = e[3];
  }
  const y0p = Math.max(0, Math.floor(minY));
  const y1p = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  const row = new Float32Array(w + 1);
  const wgt = 1 / SUB;
  for (let py = y0p; py <= y1p; py++) {
    row.fill(0);
    let any = false;
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of edges) {
        if (sy >= e[1] && sy < e[3]) {
          const t = (sy - e[1]) / (e[3] - e[1]);
          xs.push([e[0] + t * (e[2] - e[0]), e[4]]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (wind === 0) continue;
        let a = xs[k][0];
        let b = xs[k + 1][0];
        if (b <= 0 || a >= w) continue;
        a = Math.max(0, a);
        b = Math.min(w, b);
        const ia = Math.floor(a);
        const ib = Math.floor(b);
        any = true;
        if (ia === ib) {
          row[ia] += (b - a) * wgt;
        } else {
          row[ia] += (ia + 1 - a) * wgt;
          for (let x = ia + 1; x < ib; x++) row[x] += wgt;
          if (ib < w) row[ib] += (b - ib) * wgt;
        }
      }
    }
    if (!any) continue;
    const base = py * w;
    for (let x = 0; x < w; x++) {
      const v = cov[base + x] + row[x];
      cov[base + x] = v > 1 ? 1 : v;
    }
  }
  return cov;
}

// --- distance transform (Felzenszwalb & Huttenlocher) -----------------------

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (px) from every pixel centre to the nearest "inside" pixel
 *  (coverage >= 0.5); 0 inside. */
export function distanceField(cov, w, h) {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = cov[i] >= 0.5 ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Coverage of the shape grown by `r` px (a round-joined stroke of width 2r
 *  outside the glyphs, merged with the glyphs). */
export function dilate(cov, w, h, r, dist = null) {
  if (r <= 0) return Float32Array.from(cov);
  const d = dist || distanceField(cov, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = r + 1 - d[i];
    const grown = a <= 0 ? 0 : a >= 1 ? 1 : a;
    out[i] = Math.max(grown, cov[i]);
  }
  return out;
}

/** Approximate gaussian: three box-blur passes (sigma ~ radius / 2). */
export function blur(cov, w, h, radius) {
  if (radius <= 0) return cov;
  const r = Math.max(1, Math.round(radius / 2));
  let a = Float32Array.from(cov);
  let b = new Float32Array(w * h);
  const pass = (src, dst, horiz) => {
    const len = horiz ? w : h;
    const lines = horiz ? h : w;
    const step = horiz ? 1 : w;
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * w : l;
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const i = Math.min(len - 1, Math.max(0, k));
        acc += src[base + i * step];
      }
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = acc / (2 * r + 1);
        const add = Math.min(len - 1, i + r + 1);
        const rem = Math.max(0, i - r);
        acc += src[base + add * step] - src[base + rem * step];
      }
    }
  };
  for (let it = 0; it < 3; it++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  return a;
}

export function shift(cov, w, h, dx, dy) {
  const out = new Float32Array(w * h);
  const ix = Math.round(dx);
  const iy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = y - iy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - ix;
      if (sx < 0 || sx >= w) continue;
      out[y * w + x] = cov[sy * w + sx];
    }
  }
  return out;
}

// --- colour + compositing --------------------------------------------------

export function parseColor(c) {
  if (Array.isArray(c)) return c;
  const s = String(c || "#000000").trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
  }
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16), 255];
  return [0, 0, 0, 255];
}

/** A light-gray checkerboard (shows light and dark text colours). */
export function checker(w, h, tile = 9) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dark = (Math.floor(y / tile) + Math.floor(x / tile)) % 2 === 1;
      const v = dark ? 0xdb : 0xee;
      const i = (y * w + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Paint `cov` onto `dst` (RGBA bytes) with a solid colour, or with a pattern
 *  {w, h, rgba, scale (percent)} tiled in canvas space. */
export function paint(dst, w, h, cov, paintSpec, opacity = 1) {
  const pat = paintSpec && paintSpec.rgba ? paintSpec : null;
  const grad = paintSpec && paintSpec.grad ? paintSpec.grad : null;
  const col = pat || grad ? null : parseColor(paintSpec);
  const g0 = grad ? parseColor(grad.top) : null;
  const g1 = grad ? parseColor(grad.bottom) : null;
  const s = pat ? Math.max(0.05, (pat.scale || 100) / 100) : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let a = cov[i];
      if (a <= 0) continue;
      let r;
      let g;
      let b;
      let ca;
      if (pat) {
        const tx = ((Math.floor(x / s) % pat.w) + pat.w) % pat.w;
        const ty = ((Math.floor(y / s) % pat.h) + pat.h) % pat.h;
        const p = (ty * pat.w + tx) * 4;
        r = pat.rgba[p];
        g = pat.rgba[p + 1];
        b = pat.rgba[p + 2];
        ca = pat.rgba[p + 3] / 255;
      } else if (grad) {
        const t = grad.y1 > grad.y0 ? Math.max(0, Math.min(1, (y + 0.5 - grad.y0) / (grad.y1 - grad.y0))) : 0;
        r = g0[0] + (g1[0] - g0[0]) * t;
        g = g0[1] + (g1[1] - g0[1]) * t;
        b = g0[2] + (g1[2] - g0[2]) * t;
        ca = (g0[3] + (g1[3] - g0[3]) * t) / 255;
      } else {
        [r, g, b] = col;
        ca = col[3] / 255;
      }
      a *= ca * opacity;
      if (a <= 0) continue;
      const o = i * 4;
      const da = dst[o + 3] / 255;
      const oa = a + da * (1 - a);
      if (oa <= 0) continue;
      dst[o] = Math.round((r * a + dst[o] * da * (1 - a)) / oa);
      dst[o + 1] = Math.round((g * a + dst[o + 1] * da * (1 - a)) / oa);
      dst[o + 2] = Math.round((b * a + dst[o + 2] * da * (1 - a)) / oa);
      dst[o + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

/**
 * Render styled text into `dst` (RGBA, w x h) the way the inserted layer
 * looks. `contours` are the glyph polygons (already positioned); `st` holds
 * the style scaled to the canvas:
 *   {color, fillPattern, outline: {on, w, color, w2, color2, pattern, target},
 *    shadow: {on, dx, dy, color}, soft: {on, w, blur, color, pattern}}
 * Outline widths are FULL stroke widths (Krita semantics: the visible outer
 * part is half of it). The shadow takes the widest outline, like the layer.
 */
export function renderStyled(dst, w, h, contours, st) {
  let glyph = fillCoverage(contours, w, h);
  // faux bold (no bold cut installed): thicken the strokes like Photoshop
  if (st.fauxBold && st.fauxBold > 0) glyph = dilate(glyph, w, h, st.fauxBold, distanceField(glyph, w, h));
  let dist = null;
  const needDist = (st.outline && st.outline.on && (st.outline.w > 0 || st.outline.w2 > 0))
    || (st.soft && st.soft.on) || (st.shadow && st.shadow.on);
  if (needDist) dist = distanceField(glyph, w, h);
  const o = st.outline || {};
  const o1 = o.on && o.w > 0 ? o.w / 2 : 0;
  const o2 = o.on && o.w2 > 0 ? o.w2 / 2 : 0;
  const widest = Math.max(o1, o2);
  const target = o.target || "outline1";
  const pat = o.pattern || null;

  if (st.soft && st.soft.on && (st.soft.w > 0 || st.soft.blur > 0)) {
    const halo = blur(dilate(glyph, w, h, (st.soft.w || 0) + widest, dist), w, h, st.soft.blur || 0);
    paint(dst, w, h, halo, st.soft.pattern && pat ? pat : st.soft.color);
  }
  if (st.shadow && st.shadow.on && (st.shadow.dx || st.shadow.dy)) {
    const base = widest > 0 ? dilate(glyph, w, h, widest, dist) : glyph;
    paint(dst, w, h, shift(base, w, h, st.shadow.dx, st.shadow.dy), st.shadow.color);
  }
  if (o2 > 0) {
    const use = pat && (target === "outline2" || target === "both") ? pat : o.color2;
    paint(dst, w, h, dilate(glyph, w, h, o2, dist), use);
  }
  if (o1 > 0) {
    const use = pat && (target === "outline1" || target === "both") ? pat : o.color;
    paint(dst, w, h, dilate(glyph, w, h, o1, dist), use);
  }
  paint(dst, w, h, glyph, st.fillPattern || st.color);
  return dst;
}
