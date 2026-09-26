// Pure speech-bubble detection, reading order, batch pairing and the SFX word
// classifier (host-free).
//
// Port of TypeR-Krita `typer_kr/bubbles.py`. Input is a grayscale grid
// (Uint8Array, one byte per pixel) plus its width/height; the Photoshop side
// converts the imaging API's pixels into that.
//
// Pipeline (see detectBubbles): downscale by integer stride -> threshold to a
// white mask -> connected components (4-neighbourhood BFS) -> filter to
// plausible bubbles -> split at necks -> merge overlapping boxes -> map back
// to full resolution and suggest a shape.

import SEED_WORDS from "../data/sfx_seed_words.json" with { type: "json" };
import KANA from "../data/bubbles_kana.json" with { type: "json" };
import { cps, isAlpha, isAscii, split as pySplit, sortedBy, pyInt, floorDiv, pySum } from "./py.js";

export const BRIGHT_THRESH = 215;
export const MIN_AREA_FRAC = 0.0005;
export const MAX_AREA_FRAC = 0.20;
export const MIN_ASPECT = 0.2;
export const MAX_ASPECT = 5.0;
export const MIN_FILL_RATIO = 0.55;
export const RECT_FILL_RATIO = 0.92;
export const MAX_BORDER_FRAC = 0.05;
export const DARK_THRESH = 80;
export const MIN_OUTLINE_FRAC = 0.55;
export const MIN_BOX_PX = 28;
export const MAX_GRID_W = 600;
export const CORE_FRAC = 0.55;
export const MIN_TEXT_FRAC = 0.01;
export const MAX_TEXT_FRAC = 0.45;
export const NECK_RATIO = 0.5;
export const MIN_LOBE_FRAC = 0.25;
export const SFX_DARK_THRESH = 100;
export const SFX_MIN_AREA = 6;
export const SFX_MAX_AREA = 800;
export const SFX_MIN_EXT = 3;
export const SFX_MAX_EXT = 60;
export const SFX_GAP_FACTOR = 1.2;
export const SFX_MIN_MEMBERS = 2;
export const SFX_PAD_FRAC = 0.20;
export const SFX_MAX_COMPONENTS = 600;

// --- grid helpers ------------------------------------------------------------

/** Sample `gray` with an integer stride so the result is at most `maxW` wide.
 *  Returns [grid, gw, gh, stride]. */
export function downscale(gray, width, height, maxW = MAX_GRID_W) {
  if (width <= 0 || height <= 0) return [new Uint8Array(0), 0, 0, 1];
  const stride = Math.max(1, floorDiv(width + maxW - 1, maxW));
  if (stride === 1) return [Uint8Array.from(gray.subarray ? gray.subarray(0, width * height) : gray.slice(0, width * height)), width, height, 1];
  const gw = floorDiv(width + stride - 1, stride);
  const rows = [];
  for (let y = 0; y < height; y += stride) rows.push(y);
  const gh = rows.length;
  const grid = new Uint8Array(gw * gh);
  rows.forEach((y, r) => {
    const base = y * width;
    let k = 0;
    for (let x = 0; x < width; x += stride) grid[r * gw + k++] = gray[base + x];
  });
  return [grid, gw, gh, stride];
}

/** 0/1 mask of the pixels whose value is >= thresh. */
export function thresholdMask(grid, thresh = BRIGHT_THRESH) {
  const out = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = grid[i] >= thresh ? 1 : 0;
  return out;
}

// --- connected components ----------------------------------------------------

/** Connected components of the 1-pixels in `mask` (4-neighbourhood, BFS).
 *  Returns [{area, bbox: [x0, y0, x1, y1] (inclusive), border}]. */
export function findComponents(mask, width, height) {
  const n = width * height;
  const visited = new Uint8Array(n);
  const comps = [];
  const lastRow = height - 1;
  const lastCol = width - 1;
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || visited[start]) continue;
    visited[start] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let area = 0;
    let border = 0;
    let x0 = start % width;
    let x1 = x0;
    let y0 = floorDiv(start, width);
    let y1 = y0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      area += 1;
      if (x < x0) x0 = x;
      else if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      else if (y > y1) y1 = y;
      if (x === 0 || x === lastCol || y === 0 || y === lastRow) border += 1;
      let j;
      if (x > 0) {
        j = i - 1;
        if (mask[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (x < lastCol) {
        j = i + 1;
        if (mask[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y > 0) {
        j = i - width;
        if (mask[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y < lastRow) {
        j = i + width;
        if (mask[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
      }
    }
    comps.push({ area, bbox: [x0, y0, x1, y1], border });
  }
  return comps;
}

// --- filtering ----------------------------------------------------------------

function outlineDarkFrac(mask, width, height, bbox, gray, fullW, fullH, stride, darkThresh = DARK_THRESH) {
  const [x0, y0, x1, y1] = bbox;
  let dark = 0;
  let total = 0;
  const cache = new Map();
  const blockDark = (gx, gy) => {
    const i = gy * width + gx;
    let hit = cache.get(i);
    if (hit === undefined) {
      const bx0 = gx * stride;
      const by0 = gy * stride;
      const bx1 = Math.min(bx0 + stride, fullW);
      const by1 = Math.min(by0 + stride, fullH);
      hit = false;
      for (let yy = by0; yy < by1 && !hit; yy++) {
        const base = yy * fullW;
        for (let xx = bx0; xx < bx1; xx++) {
          if (gray[base + xx] <= darkThresh) {
            hit = true;
            break;
          }
        }
      }
      cache.set(i, hit);
    }
    return hit;
  };
  for (let y = y0; y <= y1; y++) {
    const base = y * width;
    for (let x = x0; x <= x1; x++) {
      const i = base + x;
      if (!mask[i]) continue;
      if (x > 0 && !mask[i - 1]) { total += 1; dark += blockDark(x - 1, y) ? 1 : 0; }
      if (x < width - 1 && !mask[i + 1]) { total += 1; dark += blockDark(x + 1, y) ? 1 : 0; }
      if (y > 0 && !mask[i - width]) { total += 1; dark += blockDark(x, y - 1) ? 1 : 0; }
      if (y < height - 1 && !mask[i + width]) { total += 1; dark += blockDark(x, y + 1) ? 1 : 0; }
    }
  }
  return total === 0 ? 0.0 : dark / total;
}

function coreTextFrac(gray, fullW, fullH, bbox, stride, darkThresh = DARK_THRESH, coreFrac = CORE_FRAC, maxSamples = 20000) {
  const [x0, y0, x1, y1] = bbox;
  const fx0 = x0 * stride;
  const fy0 = y0 * stride;
  const fx1 = Math.min(fullW, (x1 + 1) * stride);
  const fy1 = Math.min(fullH, (y1 + 1) * stride);
  const bw = fx1 - fx0;
  const bh = fy1 - fy0;
  const cw = Math.max(1, pyInt(bw * coreFrac));
  const ch = Math.max(1, pyInt(bh * coreFrac));
  const cx0 = fx0 + floorDiv(bw - cw, 2);
  const cy0 = fy0 + floorDiv(bh - ch, 2);
  let step = 1;
  if (cw * ch > maxSamples) step = Math.max(1, pyInt(Math.sqrt((cw * ch) / maxSamples)));
  let dark = 0;
  let total = 0;
  for (let y = cy0; y < cy0 + ch; y += step) {
    const base = y * fullW;
    for (let x = cx0; x < cx0 + cw; x += step) {
      total += 1;
      if (gray[base + x] <= darkThresh) dark += 1;
    }
  }
  return total === 0 ? 0.0 : dark / total;
}

/** Keep only the components that plausibly are speech bubbles. */
export function filterComponents(comps, mask, width, height, gray, fullW, fullH, stride = 1, opts = {}) {
  const {
    minAreaFrac = MIN_AREA_FRAC, maxAreaFrac = MAX_AREA_FRAC, minAspect = MIN_ASPECT,
    maxAspect = MAX_ASPECT, minFill = MIN_FILL_RATIO, maxBorderFrac = MAX_BORDER_FRAC,
    minBoxPx = MIN_BOX_PX, requireOutline = true, darkThresh = DARK_THRESH,
    minOutlineFrac = MIN_OUTLINE_FRAC, requireText = true, minTextFrac = MIN_TEXT_FRAC,
    maxTextFrac = MAX_TEXT_FRAC,
  } = opts;
  const pageArea = width * height;
  const borderLen = 2 * (width + height) || 1.0;
  const out = [];
  for (const c of comps) {
    const area = c.area;
    let frac = area / pageArea;
    if (frac < minAreaFrac || frac > maxAreaFrac) continue;
    const [x0, y0, x1, y1] = c.bbox;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw * stride < minBoxPx || bh * stride < minBoxPx) continue;
    const aspect = bw / bh;
    if (aspect < minAspect || aspect > maxAspect) continue;
    const fill = area / (bw * bh);
    if (fill < minFill) continue;
    if (c.border / borderLen > maxBorderFrac) continue;
    if (requireOutline) {
      frac = outlineDarkFrac(mask, width, height, c.bbox, gray, fullW, fullH, stride, darkThresh);
      if (frac < minOutlineFrac) continue;
    }
    if (requireText) {
      frac = coreTextFrac(gray, fullW, fullH, c.bbox, stride, darkThresh);
      if (frac < minTextFrac || frac > maxTextFrac) continue;
    }
    out.push({ bbox: c.bbox, area, fill });
  }
  return out;
}

// --- merging -------------------------------------------------------------------

function intersection(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1;
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

/** Merge candidates overlapping by more than `overlapFrac` of the smaller box
 *  (nested boxes, a bubble split by its tail). Repeats until stable. */
export function mergeBoxes(cands, overlapFrac = 0.10) {
  const boxes = cands.map((c) => ({ ...c }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < boxes.length && !changed; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const inter = intersection(a.bbox, b.bbox);
        if (inter === 0) continue;
        const [ax0, ay0, ax1, ay1] = a.bbox;
        const [bx0, by0, bx1, by1] = b.bbox;
        const sa = (ax1 - ax0 + 1) * (ay1 - ay0 + 1);
        const sb = (bx1 - bx0 + 1) * (by1 - by0 + 1);
        if (inter < overlapFrac * Math.min(sa, sb)) continue;
        const nb = [Math.min(ax0, bx0), Math.min(ay0, by0), Math.max(ax1, bx1), Math.max(ay1, by1)];
        const area = a.area + b.area;
        const nw = (nb[2] - nb[0] + 1) * (nb[3] - nb[1] + 1);
        boxes[i] = { bbox: nb, area, fill: Math.min(1.0, area / nw) };
        boxes.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return boxes;
}

// --- neck splitting (joined double bubbles) ---------------------------------

function regionProfiles(mask, width, bbox) {
  const [x0, y0, x1, y1] = bbox;
  const rows = [];
  const cols = new Array(x1 - x0 + 1).fill(0);
  let area = 0;
  for (let y = y0; y <= y1; y++) {
    const base = y * width;
    let cnt = 0;
    for (let x = x0; x <= x1; x++) {
      if (mask[base + x]) {
        cnt += 1;
        cols[x - x0] += 1;
      }
    }
    rows.push(cnt);
    area += cnt;
  }
  return [rows, cols, area];
}

/** Index of the thinnest waist between two lobes of `profile`, or null. */
export function findWaist(profile, neckRatio = NECK_RATIO, minLobeFrac = MIN_LOBE_FRAC) {
  const n = profile.length;
  const lobe = Math.max(1, pyInt(n * minLobeFrac));
  if (n < 2 * lobe + 1) return null;
  const pre = new Array(n).fill(0);
  let m = 0;
  profile.forEach((v, i) => {
    m = Math.max(m, v);
    pre[i] = m;
  });
  const suf = new Array(n).fill(0);
  m = 0;
  for (let i = n - 1; i >= 0; i--) {
    m = Math.max(m, profile[i]);
    suf[i] = m;
  }
  let best = null;
  let bestV = null;
  for (let i = lobe; i < n - lobe; i++) {
    const limit = neckRatio * Math.min(pre[i - 1], suf[i + 1]);
    if (profile[i] < limit && (bestV === null || profile[i] < bestV)) {
      best = i;
      bestV = profile[i];
    }
  }
  return best;
}

function lineIsSingleRun(mask, width, bbox, index, horizontal) {
  const [x0, y0, x1, y1] = bbox;
  let total = 0;
  let longest = 0;
  let run = 0;
  let from;
  let to;
  let val;
  if (horizontal) {
    const base = (y0 + index) * width;
    from = x0;
    to = x1;
    val = (k) => mask[base + k];
  } else {
    const col = x0 + index;
    from = y0;
    to = y1;
    val = (k) => mask[k * width + col];
  }
  for (let k = from; k <= to; k++) {
    if (val(k)) {
      total += 1;
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  if (total === 0) return false;
  return longest >= 0.8 * total;
}

/** Split the white region in `bbox` at neck(s) into candidate dicts. */
export function splitAtNecks(mask, width, bbox, depth = 2, neckRatio = NECK_RATIO,
  minLobeFrac = MIN_LOBE_FRAC, minFill = MIN_FILL_RATIO, minSize = 4) {
  const [rows, cols, area] = regionProfiles(mask, width, bbox);
  const [x0, y0, x1, y1] = bbox;
  if (area === 0) return [];
  const fill = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
  const unsplit = [{ bbox, area, fill }];
  if (depth <= 0) return unsplit;
  for (const [horizontal, profile] of [[true, rows], [false, cols]]) {
    const w = findWaist(profile, neckRatio, minLobeFrac);
    if (w === null) continue;
    if (!lineIsSingleRun(mask, width, bbox, w, horizontal)) continue;
    const b1 = horizontal ? [x0, y0, x1, y0 + w - 1] : [x0, y0, x0 + w - 1, y1];
    const b2 = horizontal ? [x0, y0 + w + 1, x1, y1] : [x0 + w + 1, y0, x1, y1];
    const halves = [];
    let ok = true;
    for (const hb of [b1, b2]) {
      const [hrows, hcols, harea] = regionProfiles(mask, width, hb);
      if (harea === 0) {
        ok = false;
        break;
      }
      const ys = [];
      hrows.forEach((v, i) => { if (v) ys.push(i); });
      const xs = [];
      hcols.forEach((v, i) => { if (v) xs.push(i); });
      const tight = [hb[0] + xs[0], hb[1] + ys[0], hb[0] + xs[xs.length - 1], hb[1] + ys[ys.length - 1]];
      const tw = tight[2] - tight[0] + 1;
      const th = tight[3] - tight[1] + 1;
      const hfill = harea / (tw * th);
      if (tw < minSize || th < minSize || hfill < minFill) {
        ok = false;
        break;
      }
      halves.push(tight);
    }
    if (!ok) continue;
    const out = [];
    for (const hb of halves) out.push(...splitAtNecks(mask, width, hb, depth - 1, neckRatio, minLobeFrac, minFill, minSize));
    return out;
  }
  return unsplit;
}

// --- top-level detection -----------------------------------------------------

/** Detect speech bubbles in a full-resolution grayscale page; boxes in
 *  full-resolution coordinates {x, y, w, h, kind:'bubble', shape, fill}. */
export function detectBubbles(gray, width, height, opts = {}) {
  const {
    brightThresh = BRIGHT_THRESH, maxGridW = MAX_GRID_W, rectFill = RECT_FILL_RATIO,
    requireOutline = true, requireText = true, minBoxPx = MIN_BOX_PX, splitNecks = true,
    ...filterKw
  } = opts;
  const [grid, gw, gh, stride] = downscale(gray, width, height, maxGridW);
  if (gw === 0 || gh === 0) return [];
  const mask = thresholdMask(grid, brightThresh);
  const comps = findComponents(mask, gw, gh);
  let cands = filterComponents(comps, mask, gw, gh, gray, width, height, stride,
    { requireOutline, requireText, minBoxPx, ...filterKw });
  if (splitNecks) {
    const minSize = Math.max(2, floorDiv(minBoxPx, stride));
    const split = [];
    for (const c of cands) split.push(...splitAtNecks(mask, gw, c.bbox, 2, NECK_RATIO, MIN_LOBE_FRAC, MIN_FILL_RATIO, minSize));
    cands = split;
  }
  cands = mergeBoxes(cands);
  return cands.map((c) => {
    const [x0, y0, x1, y1] = c.bbox;
    return {
      x: x0 * stride, y: y0 * stride, w: (x1 - x0 + 1) * stride, h: (y1 - y0 + 1) * stride,
      kind: "bubble", shape: c.fill >= rectFill ? "rect" : "round", fill: c.fill,
    };
  });
}

// --- free text / SFX detection -----------------------------------------------

function boxesOverlap(fx0, fy0, fx1, fy1, box) {
  return !(fx1 <= box.x || box.x + box.w <= fx0 || fy1 <= box.y || box.y + box.h <= fy0);
}

/** Best-effort detection of free text (SFX drawn on the art): clusters of dark
 *  character-sized blobs outside the bubbles -> boxes with kind 'sfx'. */
export function detectTextBlocks(gray, width, height, bubbles = [], opts = {}) {
  const {
    darkThresh = SFX_DARK_THRESH, maxGridW = MAX_GRID_W, minArea = SFX_MIN_AREA, maxArea = SFX_MAX_AREA,
    minExt = SFX_MIN_EXT, maxExt = SFX_MAX_EXT, gapFactor = SFX_GAP_FACTOR, minMembers = SFX_MIN_MEMBERS,
    padFrac = SFX_PAD_FRAC, maxComponents = SFX_MAX_COMPONENTS,
  } = opts;
  const [grid, gw, gh, stride] = downscale(gray, width, height, maxGridW);
  if (gw === 0 || gh === 0) return [];
  const dmask = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) dmask[i] = grid[i] <= darkThresh ? 1 : 0;
  const comps = findComponents(dmask, gw, gh);
  const chars = [];
  for (const c of comps) {
    if (!(c.area >= minArea && c.area <= maxArea)) continue;
    const [x0, y0, x1, y1] = c.bbox;
    const ext = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    if (!(ext >= minExt && ext <= maxExt)) continue;
    const fx0 = x0 * stride;
    const fy0 = y0 * stride;
    const fx1 = (x1 + 1) * stride;
    const fy1 = (y1 + 1) * stride;
    if (bubbles.some((b) => boxesOverlap(fx0, fy0, fx1, fy1, b))) continue;
    chars.push([x0, y0, x1, y1, ext]);
  }
  if (chars.length < minMembers || chars.length > maxComponents) return [];
  const parent = chars.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < chars.length; i++) {
    const [ax0, ay0, ax1, ay1, aext] = chars[i];
    for (let j = i + 1; j < chars.length; j++) {
      const [bx0, by0, bx1, by1, bext] = chars[j];
      const gapX = Math.max(0, bx0 - ax1 - 1, ax0 - bx1 - 1);
      const gapY = Math.max(0, by0 - ay1 - 1, ay0 - by1 - 1);
      if (Math.max(gapX, gapY) < gapFactor * Math.max(aext, bext)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  const clusters = new Map();
  chars.forEach((c, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(c);
  });
  const out = [];
  for (const members of clusters.values()) {
    if (members.length < minMembers) continue;
    let x0 = Math.min(...members.map((m) => m[0]));
    let y0 = Math.min(...members.map((m) => m[1]));
    let x1 = Math.max(...members.map((m) => m[2]));
    let y1 = Math.max(...members.map((m) => m[3]));
    const padX = pyInt((x1 - x0 + 1) * padFrac);
    const padY = pyInt((y1 - y0 + 1) * padFrac);
    x0 = Math.max(0, x0 - padX);
    y0 = Math.max(0, y0 - padY);
    x1 = Math.min(gw - 1, x1 + padX);
    y1 = Math.min(gh - 1, y1 + padY);
    out.push({
      x: x0 * stride, y: y0 * stride, w: (x1 - x0 + 1) * stride, h: (y1 - y0 + 1) * stride,
      kind: "sfx", shape: "rect", fill: 1.0,
    });
  }
  return out;
}

// --- reading order -------------------------------------------------------------

/** Sort boxes into reading order: rows top-to-bottom (a box joins the row
 *  while it overlaps >= 50 % of the smaller height), within a row by centre x
 *  (descending for RTL manga). */
export function readingOrder(boxes, rtl = true) {
  if (!boxes || !boxes.length) return [];
  const byY = sortedBy(boxes, (b) => b.y + b.h / 2.0);
  const rows = [];
  let row = [byY[0]];
  let rowTop = byY[0].y;
  let rowBot = byY[0].y + byY[0].h;
  for (const b of byY.slice(1)) {
    const top = b.y;
    const bot = b.y + b.h;
    const overlap = Math.min(bot, rowBot) - Math.max(top, rowTop);
    const smaller = Math.min(bot - top, rowBot - rowTop);
    if (smaller > 0 && overlap >= 0.5 * smaller) {
      row.push(b);
      rowTop = Math.min(rowTop, top);
      rowBot = Math.max(rowBot, bot);
    } else {
      rows.push(row);
      row = [b];
      rowTop = top;
      rowBot = bot;
    }
  }
  rows.push(row);
  const out = [];
  for (const r of rows) out.push(...sortedBy(r, (b) => b.x + b.w / 2.0, rtl));
  return out;
}

function bestPanel(box, panels) {
  if (!panels.length) return null;
  const bx0 = box.x;
  const by0 = box.y;
  const bx1 = bx0 + box.w;
  const by1 = by0 + box.h;
  const barea = box.w * box.h || 1.0;
  let best = null;
  let bestOv = 0.0;
  panels.forEach((p, i) => {
    const ix0 = Math.max(bx0, p.x);
    const iy0 = Math.max(by0, p.y);
    const ix1 = Math.min(bx1, p.x + p.w);
    const iy1 = Math.min(by1, p.y + p.h);
    const ov = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0) / barea;
    if (ov > bestOv) {
      best = i;
      bestOv = ov;
    }
  });
  if (best !== null && bestOv >= 0.15) return best;
  const cx = bx0 + box.w / 2.0;
  const cy = by0 + box.h / 2.0;
  let ndist = null;
  let nidx = null;
  panels.forEach((p, i) => {
    const px = p.x + p.w / 2.0;
    const py = p.y + p.h / 2.0;
    const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (ndist === null || d < ndist) {
      ndist = d;
      nidx = i;
    }
  });
  return nidx;
}

/** Panel-aware reading order (panels in reading order, bubbles within). */
export function orderByPanels(boxes, panels, rtl = true) {
  if (!panels || !panels.length) return readingOrder(boxes, rtl);
  const orderedPanels = readingOrder(panels, rtl);
  const buckets = orderedPanels.map(() => []);
  const leftover = [];
  for (const b of boxes) {
    const idx = bestPanel(b, orderedPanels);
    (idx === null ? leftover : buckets[idx]).push(b);
  }
  const out = [];
  for (const bucket of buckets) out.push(...readingOrder(bucket, rtl));
  out.push(...readingOrder(leftover, rtl));
  return out;
}

// --- script mapping -----------------------------------------------------------------

export function mapUnits(bubbleCount, units) {
  const n = Math.min(bubbleCount, units.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push([i, i]);
  return [pairs, bubbleCount !== units.length];
}

export function nextUnplaced(assign, doneUnits, start) {
  for (let k = Math.max(0, start); k < assign.length; k++) {
    const u = assign[k];
    if (u >= 0 && !doneUnits.has(u)) return k;
  }
  return null;
}

// --- batch placement ---------------------------------------------------------

export const SEL_MIN_REGION_FRAC = 0.0005;
export const SEL_MIN_REGION_PX = 9;

/** One box per disjoint marked region of a selection mask (one byte per
 *  pixel, 0 = unselected). `origin` is the mask's top-left in document
 *  coordinates. Reading order is deliberately NOT applied. */
export function regionsFromMask(mask, width, height, origin = [0, 0], maxGridW = MAX_GRID_W,
  rectFill = RECT_FILL_RATIO, minRegionFrac = SEL_MIN_REGION_FRAC, kind = "bubble") {
  if (width <= 0 || height <= 0 || !mask || !mask.length) return [];
  const [grid, gw, gh, stride] = downscale(mask, width, height, maxGridW);
  if (gw === 0 || gh === 0) return [];
  const binary = thresholdMask(grid, 1);
  const comps = findComponents(binary, gw, gh);
  const floor = Math.max(SEL_MIN_REGION_PX, pyInt(minRegionFrac * gw * gh));
  const [ox, oy] = origin;
  const out = [];
  for (const c of comps) {
    if (c.area < floor) continue;
    const [x0, y0, x1, y1] = c.bbox;
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    const fill = area ? c.area / area : 0.0;
    out.push({
      x: ox + x0 * stride, y: oy + y0 * stride, w: (x1 - x0 + 1) * stride, h: (y1 - y0 + 1) * stride,
      kind, shape: shapeFromFill(fill, rectFill), fill,
    });
  }
  return out;
}

/** Map units to boxes 1:1 in box order; SFX/skip boxes consume no unit.
 *  Returns [assign, mismatch]. */
export function assignUnits(boxes, unitCount, firstUnit = 0, skipKinds = ["sfx"]) {
  const assign = [];
  let unit = firstUnit;
  let wanted = 0;
  for (const b of boxes || []) {
    if (skipKinds.includes(b.kind) || b.skip) {
      assign.push(-1);
      continue;
    }
    wanted += 1;
    if (unit < unitCount) {
      assign.push(unit);
      unit += 1;
    } else {
      assign.push(-1);
    }
  }
  const available = Math.max(0, unitCount - firstUnit);
  return [assign, wanted !== available];
}

/** Work list [[boxIndex, unitIndex], …] for a batch run. */
export function batchPairs(assign, unitCount, skipUnits = []) {
  const skip = new Set(skipUnits || []);
  const pairs = [];
  (assign || []).forEach((u, i) => {
    if (u === null || u === undefined || u < 0 || u >= unitCount || skip.has(u)) return;
    pairs.push([i, u]);
  });
  return pairs;
}

export function shapeFromFill(fill, rectFill = RECT_FILL_RATIO) {
  return fill >= rectFill ? "rect" : "round";
}

/** Row-major mask (Uint8Array w*h): 255 inside the ellipse filling the box. */
export function ellipseMask(w, h) {
  w = pyInt(w);
  h = pyInt(h);
  if (w <= 0 || h <= 0) return new Uint8Array(0);
  const data = new Uint8Array(w * h);
  const rx = w / 2.0;
  const ry = h / 2.0;
  for (let py = 0; py < h; py++) {
    const ny = (py + 0.5 - ry) / ry;
    const ny2 = ny * ny;
    if (ny2 > 1.0) continue;
    const base = py * w;
    for (let px = 0; px < w; px++) {
      const nx = (px + 0.5 - rx) / rx;
      if (nx * nx + ny2 <= 1.0) data[base + px] = 255;
    }
  }
  return data;
}

// --- real bubble outline from the pixels (for AI boxes) ----------------------

const NB8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

function componentAtCenter(mask, gw, gh) {
  const n = gw * gh;
  const cx = floorDiv(gw, 2);
  const cy = floorDiv(gh, 2);
  let seed = -1;
  let seedD = null;
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      const dx = (i % gw) - cx;
      const dy = floorDiv(i, gw) - cy;
      const d = dx * dx + dy * dy;
      if (seedD === null || d < seedD) {
        seedD = d;
        seed = i;
      }
    }
  }
  if (seed < 0) return [null, 0];
  const member = new Uint8Array(n);
  member[seed] = 1;
  const stack = [seed];
  let area = 0;
  while (stack.length) {
    const i = stack.pop();
    area += 1;
    const x = i % gw;
    if (x > 0 && mask[i - 1] && !member[i - 1]) { member[i - 1] = 1; stack.push(i - 1); }
    if (x < gw - 1 && mask[i + 1] && !member[i + 1]) { member[i + 1] = 1; stack.push(i + 1); }
    if (i - gw >= 0 && mask[i - gw] && !member[i - gw]) { member[i - gw] = 1; stack.push(i - gw); }
    if (i + gw < n && mask[i + gw] && !member[i + gw]) { member[i + gw] = 1; stack.push(i + gw); }
  }
  return [member, area];
}

function traceBoundary(member, gw, gh, maxSteps = 200000) {
  let start = -1;
  for (let i = 0; i < gw * gh; i++) {
    if (member[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const sx = start % gw;
  const sy = floorDiv(start, gw);
  const white = (x, y) => x >= 0 && x < gw && y >= 0 && y < gh && member[y * gw + x];
  const contour = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let back = 6;
  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (let k = 1; k < 9; k++) {
      const d = (back + k) % 8;
      const nx = cx + NB8[d][0];
      const ny = cy + NB8[d][1];
      if (white(nx, ny)) {
        back = (d + 4) % 8;
        cx = nx;
        cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break;
    if (cx === sx && cy === sy) break;
    contour.push([cx, cy]);
  }
  return contour;
}

/** Ramer-Douglas-Peucker polyline simplification (iterative). */
export function rdp(pts, eps) {
  const n = pts.length;
  if (n < 3) return [...pts];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const denom = Math.sqrt(dx * dx + dy * dy) || 1.0;
    let idx = -1;
    let dmax = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const dist = Math.abs((px - ax) * dy - (py - ay) * dx) / denom;
      if (dist > dmax) {
        dmax = dist;
        idx = i;
      }
    }
    if (idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx]);
      stack.push([idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Trace the real outline of the bubble inside box [x, y, bw, bh]; a closed
 *  polygon of [x, y] page points, or null. */
export function contourInBox(gray, w, h, box, thresh = BRIGHT_THRESH, target = 150, maxPoints = 48, minPoints = 6) {
  let x0 = pyInt(box[0]);
  let y0 = pyInt(box[1]);
  let bw = pyInt(box[2]);
  let bh = pyInt(box[3]);
  x0 = Math.max(0, Math.min(x0, w - 1));
  y0 = Math.max(0, Math.min(y0, h - 1));
  bw = Math.min(bw, w - x0);
  bh = Math.min(bh, h - y0);
  if (bw < 6 || bh < 6) return null;
  let scale = Math.max(bw, bh) / target;
  if (scale < 1.0) scale = 1.0;
  const rnd = (v) => {
    const f = Math.floor(v);
    const d = v - f;
    return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
  };
  const gw = Math.max(2, pyInt(rnd(bw / scale)));
  const gh = Math.max(2, pyInt(rnd(bh / scale)));
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const sy = Math.min(h - 1, y0 + pyInt(gy * scale));
    const row = sy * w;
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(w - 1, x0 + pyInt(gx * scale));
      if (gray[row + sx] >= thresh) mask[gy * gw + gx] = 1;
    }
  }
  const [member, area] = componentAtCenter(mask, gw, gh);
  if (!member || area < 6) return null;
  if (area >= gw * gh * 0.985) return null;           // fills the whole box -> a rectangle
  let contour = traceBoundary(member, gw, gh);
  if (contour.length < minPoints) return null;
  contour = rdp(contour, Math.max(1.5, Math.min(gw, gh) * 0.03));
  if (contour.length < minPoints) return null;
  if (contour.length > maxPoints) {
    const stepc = contour.length / maxPoints;
    const c2 = [];
    for (let i = 0; i < maxPoints; i++) c2.push(contour[pyInt(i * stepc)]);
    contour = c2;
  }
  return contour.map(([gx, gy]) => [
    Math.min(w - 1, x0 + pyInt((gx + 0.5) * scale)),
    Math.min(h - 1, y0 + pyInt((gy + 0.5) * scale)),
  ]);
}

// ---------------------------------------------------------------------------
// SFX word database (script-line classification)
// ---------------------------------------------------------------------------

export const SFX_SEED_WORDS = SEED_WORDS;
export const KANA_ROMAJI = KANA.KANA_ROMAJI;
const KANA_SMALL_Y = KANA.KANA_SMALL_Y;
const KANA_DROP = KANA.KANA_DROP;
const SFX_TAGS = KANA.SFX_TAGS;
const SFX_STRIP = new Set(cps(KANA.SFX_STRIP));

/** Transliterate a pure-kana token to romaji, or null for anything else. */
export function kanaToRomaji(token) {
  const t = cps(token);
  const out = [];
  let i = 0;
  const n = t.length;
  while (i < n) {
    const ch = t[i];
    if (KANA_DROP.includes(ch)) {
      i += 1;
      continue;
    }
    const base = KANA_ROMAJI[ch];
    if (base === undefined) return null;
    const nxt = i + 1 < n ? t[i + 1] : "";
    if (nxt in KANA_SMALL_Y && base.endsWith("i")) {
      const small = KANA_SMALL_Y[nxt];
      if (base === "shi" || base === "chi" || base === "ji") out.push(base.slice(0, -1) + small.slice(1));
      else out.push(base.slice(0, -1) + small);
      i += 2;
      continue;
    }
    out.push(base);
    i += 1;
  }
  return out.join("");
}

/** Collapse runs of the same letter: 'boooom' -> 'bom'. */
export function squeeze(word) {
  const out = [];
  for (const ch of word) if (!out.length || out[out.length - 1] !== ch) out.push(ch);
  return out.join("");
}

function sfxTokenMatches(token, squeezedWords) {
  for (const w of squeezedWords) {
    if (token === w) return true;
    if (token.length > w.length && token.split(w).join("") === "") return true;
  }
  return false;
}

const isAlphaStr = (s) => s.length > 0 && cps(s).every((c) => isAlpha(c));

/** True when the script line consists ONLY of known SFX vocabulary (or starts
 *  with an 'SFX:'/'ST:' tag). */
export function isSfxLine(text, words) {
  const t = (text || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  for (const tag of SFX_TAGS) if (low.startsWith(tag)) return true;
  const cleaned = cps(low).map((ch) => (SFX_STRIP.has(ch) ? " " : ch)).join("");
  const tokens = pySplit(cleaned);
  if (!tokens.length) return false;
  const squeezedWords = words.filter((w) => w).map((w) => squeeze(w.toLowerCase()));
  for (let tok of tokens) {
    if (!isAlphaStr(tok)) return false;              // numbers/mixed junk: not SFX
    if (!isAscii(tok)) {
      tok = kanaToRomaji(tok);                      // kana SFX match the romaji words
      if (!tok) return false;
    }
    if (!sfxTokenMatches(squeeze(tok), squeezedWords)) return false;
  }
  return true;
}

/** [keptIndices, skippedCount] — units classified as SFX get no bubble. */
export function splitUnitsSfx(texts, words) {
  const kept = [];
  texts.forEach((t, i) => {
    if (!isSfxLine(t, words)) kept.push(i);
  });
  return [kept, texts.length - kept.length];
}

/** [seed, user] from a parsed sfx_db.json object (null -> seed only). The
 *  file's 'words' are MERGED with the built-in seed. */
export function sfxDbFrom(data) {
  let seed = [...SFX_SEED_WORDS];
  let user = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (Array.isArray(data.words)) {
      const extra = data.words.filter((w) => w).map((w) => String(w));
      seed = sortedBy([...new Set([...seed, ...extra])], (s) => s);
    }
    if (Array.isArray(data.user)) user = data.user.filter((w) => w).map((w) => String(w));
  }
  return [seed, user];
}

/** The object to write as sfx_db.json. */
export function sfxDbData(userWords, seedWords = null) {
  return {
    words: [...(seedWords !== null ? seedWords : SFX_SEED_WORDS)],
    user: userWords.map((w) => String(w).trim()).filter((w) => w),
  };
}

/** Insert a gap at `row`: that bubble gets no line, later ones shift down. */
export function insertGap(assign, row) {
  if (!(row >= 0 && row < assign.length)) return [...assign];
  return [...assign.slice(0, row), -1, ...assign.slice(row, -1)];
}

/** Remove a gap at `row`: later ones shift up; the last row takes the next
 *  unused unit (or -1). */
export function removeGap(assign, row, unitCount) {
  if (!(row >= 0 && row < assign.length)) return [...assign];
  const used = assign.filter((u) => u >= 0);
  let nxt = used.length ? Math.max(...used) + 1 : 0;
  if (nxt >= unitCount) nxt = -1;
  return [...assign.slice(0, row), ...assign.slice(row + 1), nxt];
}

export { pySum };
