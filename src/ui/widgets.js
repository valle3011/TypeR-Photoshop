// The panel's own widgets: FontPicker, TextPreview and BubbleOverlay.
// Ports of the Qt classes of the same names in typer_kr.py.

import { h, clear, show, debounce, TextField } from "./dom.js";
import { families as psFamilies, reloadFamilies } from "../host/fonts.js";
import { stylesFaces } from "../host/measure.js";
import { renderPreview, renderFaceSample } from "../core/preview.js";
import { pngDataUrl } from "../core/png.js";
import { checker } from "../core/raster.js";

/** True if the search term (case-insensitive) occurs in the family name. */
export function fontMatch(family, query) {
  const q = String(query || "").trim().toLowerCase();
  return q === "" || family.toLowerCase().includes(q);
}

/** Recently used fonts first, the rest in their original order. */
export function orderWithRecents(families, recents) {
  const seen = new Set();
  const out = [];
  const set = new Set(families);
  for (const r of recents) {
    if (set.has(r) && !seen.has(r)) {
      out.push(r);
      seen.add(r);
    }
  }
  for (const f of families) {
    if (!seen.has(f)) {
      out.push(f);
      seen.add(f);
    }
  }
  return out;
}

const ROW_H = 22;

/**
 * Fast, searchable font picker (port of FontPicker): a plain text list (only
 * the visible rows exist in the DOM), instant filter, recents on top with ★,
 * and a rendered preview only for the selected font.
 */
export class FontPicker {
  constructor({ recents = [], placeholder = "", onChange = null, onContext = null } = {}) {
    this._all = psFamilies();
    const allSet = new Set(this._all);
    this._recents = recents.filter((r) => allSet.has(r));
    this._current = null;
    this._rows = [];          // visible (filtered) family list
    this._sel = -1;
    this.onChange = onChange;
    this.onContext = onContext;
    this.search = TextField({ placeholder, onChange: (t) => this._applyFilter(t) });
    this.list = h("div", { class: "fontlist", tabindex: "0" });
    this.spacer = h("div", { class: "fontlist-spacer" });
    this.list.appendChild(this.spacer);
    this.preview = h("div", { class: "fontpreview" });
    this.previewImg = h("img", { class: "fontpreview-img" });
    this.previewName = h("div", { class: "fontpreview-name" });
    this.preview.appendChild(this.previewImg);
    this.preview.appendChild(this.previewName);
    this.el = h("div", { class: "fontpicker" }, this.search, this.list, this.preview);
    this.list.addEventListener("scroll", () => this._renderRows());
    this.list.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = Math.max(0, Math.min(this._rows.length - 1, this._sel + (e.key === "ArrowDown" ? 1 : -1)));
        this._select(i, true);
      }
    });
    this.list.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const idx = this._rowAt(e.clientY);
      const fam = idx >= 0 ? this._rows[idx] : this._current;
      if (fam && this.onContext) this.onContext(fam, e);
    });
    this._renderPreview = debounce(() => this._paintPreview(), 60);
    this._rebuild();
  }

  families() {
    return orderWithRecents(this._all, this._recents);
  }

  currentFamily() {
    return this._current;
  }

  /** Select a font programmatically (presets): case-insensitive match; a font
   *  that is genuinely not installed is adopted by NAME anyway, so the
   *  preset's font is honoured instead of silently keeping the old one. */
  setCurrentFamily(family) {
    if (!family) return;
    family = String(family).trim();
    let target = family;
    if (!this._all.includes(family)) {
      const low = family.toLowerCase();
      const m = this._all.find((f) => f.toLowerCase() === low);
      if (m) target = m;
    }
    this.search.setText("");
    this._applyFilter("", false);
    const i = this._rows.indexOf(target);
    if (i >= 0) {
      this._select(i, true, true);
      return;
    }
    // not installed: adopt the name so inserts use the preset's font
    this._current = family;
    this._sel = -1;
    this._renderRows();
    this.previewName.textContent = `${family}  –  (?)`;
    this.previewImg.removeAttribute("src");
    if (this.onChange) this.onChange(family);
  }

  setRecents(r) {
    const allSet = new Set(this._all);
    this._recents = r.filter((x) => allSet.has(x));
  }

  reloadFamilies() {
    const cur = this._current;
    this._all = reloadFamilies();
    this.setRecents(this._recents);
    this._rebuild();
    if (cur) this.setCurrentFamily(cur);
  }

  noteUsed(family) {
    if (!family) return;
    this._recents = [family, ...this._recents.filter((r) => r !== family)].slice(0, 12);
  }

  recents() {
    return [...this._recents];
  }

  setPlaceholder(t) {
    this.search.setPlaceholder(t);
  }

  setListHeight(px) {
    this.list.style.height = `${px}px`;
    this._renderRows();
  }

  _rebuild() {
    this._applyFilter(this.search.text(), false);
    if (this._sel < 0 && this._rows.length && !this._current) this._select(0, true);
  }

  _applyFilter(text, keepSelection = true) {
    const ordered = orderWithRecents(this._all, this._recents);
    this._rows = ordered.filter((f) => fontMatch(f, text));
    this.spacer.style.height = `${this._rows.length * ROW_H}px`;
    const i = this._rows.indexOf(this._current);
    this._sel = i;
    if (keepSelection && i < 0 && this._rows.length) this._select(0, true);
    this._renderRows();
  }

  _rowAt(clientY) {
    const r = this.list.getBoundingClientRect();
    const y = clientY - r.top + this.list.scrollTop;
    const i = Math.floor(y / ROW_H);
    return i >= 0 && i < this._rows.length ? i : -1;
  }

  _renderRows() {
    for (const c of Array.from(this.list.children)) if (c !== this.spacer) c.remove();
    const top = this.list.scrollTop;
    const height = this.list.clientHeight || 160;
    const first = Math.max(0, Math.floor(top / ROW_H) - 2);
    const last = Math.min(this._rows.length, Math.ceil((top + height) / ROW_H) + 2);
    const recent = new Set(this._recents);
    for (let i = first; i < last; i++) {
      const fam = this._rows[i];
      const row = h("div", { class: "fontrow" + (i === this._sel ? " selected" : ""), style: { top: `${i * ROW_H}px` } },
        (recent.has(fam) ? "★ " : "") + fam);
      row.addEventListener("click", () => this._select(i, true));
      this.list.appendChild(row);
    }
  }

  _select(i, emit, scrollIntoView = false) {
    if (!(i >= 0 && i < this._rows.length)) return;
    this._sel = i;
    const fam = this._rows[i];
    const changed = fam !== this._current;
    this._current = fam;
    if (scrollIntoView || true) {
      const top = i * ROW_H;
      const vh = this.list.clientHeight || 160;
      if (top < this.list.scrollTop) this.list.scrollTop = top;
      else if (top + ROW_H > this.list.scrollTop + vh) this.list.scrollTop = top + ROW_H - vh;
    }
    this._renderRows();
    this.previewName.textContent = `${fam}  –  AaBb 123`;
    this._renderPreview();
    if (emit && changed && this.onChange) this.onChange(fam);
  }

  async _paintPreview() {
    const fam = this._current;
    if (!fam) return;
    try {
      const faces = await stylesFaces(fam, false, false);
      if (fam !== this._current) return;
      if (!faces) {
        this.previewImg.removeAttribute("src");
        return;
      }
      const w = Math.max(120, (this.preview.clientWidth || 260) - 8);
      const rgba = renderFaceSample(faces.regular, "AaBb 123 — " + fam, w, 34, dark() ? "#e8e8e8" : "#1a1a1a", 20);
      this.previewImg.src = pngDataUrl(rgba, w, 34);
    } catch (e) {
      this.previewImg.removeAttribute("src");
    }
  }
}

export function dark() {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(bg || "");
    if (m) return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 128;
  } catch (e) {
    // no style info
  }
  return true;
}

/**
 * Live preview (port of TextPreview): renders the active line with the
 * chosen font and every setting in the inserted layer's order. Debounced.
 */
export class TextPreview {
  constructor(app) {
    this.app = app;
    this._text = "";
    this.img = h("img", { class: "preview-img", draggable: "false" });
    this.msg = h("div", { class: "preview-empty" });
    this.el = h("div", { class: "preview" }, this.img, this.msg);
    this._height = 120;
    this.el.style.height = `${this._height}px`;
    this._render = debounce(() => this.paint(), 100);
  }

  setHeight(px) {
    this._height = px;
    this.el.style.height = `${px}px`;
    this._render();
  }

  setText(text) {
    this._text = text || "";
    this._render();
  }

  async paint() {
    const a = this.app;
    const w = Math.max(120, Math.floor(this.el.clientWidth || 280));
    const hgt = Math.max(40, this._height);
    const o = a._preview_opts(this._text);
    const family = a.font_picker ? a.font_picker.currentFamily() : "";
    let faces = null;
    try {
      faces = family ? await stylesFaces(family, o.bold, o.italic) : null;
    } catch (e) {
      faces = null;
    }
    const res = renderPreview(this._text, o, faces, w, hgt);
    if (res.empty) {
      show(this.msg, true);
      this.msg.textContent = faces || !family ? a._tr("preview_empty") : a._tr("st_no_faces", { font: family });
    } else {
      show(this.msg, false);
    }
    this.img.src = pngDataUrl(res.rgba, w, hgt);
  }
}

/**
 * The page view with numbered boxes (port of BubbleOverlay): the page
 * thumbnail as an <img>, boxes as positioned elements. Plain click selects,
 * Ctrl+click renumbers, right-click removes; in edit mode drag on empty
 * canvas draws a box, drag a box to move it, drag a corner to resize.
 */
export class BubbleOverlay {
  static HANDLE = 9;

  constructor({ onClick, onRemove, onAdd, onChange, onKey }) {
    this.cb = { onClick, onRemove, onAdd, onChange, onKey };
    this._docW = 1;
    this._docH = 1;
    this._boxes = [];
    this._pending = {};
    this._current = -1;
    this._edit = false;
    this._drag = null;
    this.img = h("img", { class: "ov-img", draggable: "false" });
    this.layer = h("div", { class: "ov-layer" });
    this.rubber = h("div", { class: "ov-rubber" });
    this.el = h("div", { class: "overlay", tabindex: "0" }, this.img, this.layer, this.rubber);
    show(this.rubber, false);
    this.el.addEventListener("pointerdown", (e) => this._down(e));
    this.el.addEventListener("pointermove", (e) => this._move(e));
    this.el.addEventListener("pointerup", (e) => this._up(e));
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const i = this._hit(e);
      if (i >= 0 && this.cb.onRemove) this.cb.onRemove(i);
    });
    this.el.addEventListener("keydown", (e) => this.cb.onKey && this.cb.onKey(e));
  }

  setEditMode(on) {
    this._edit = !!on;
    this._drag = null;
    this.el.classList.toggle("edit", this._edit);
    this.redraw();
  }

  setPage(dataUrl, docW, docH) {
    this._docW = Math.max(1, docW);
    this._docH = Math.max(1, docH);
    if (dataUrl) this.img.src = dataUrl;
    this.redraw();
  }

  setBoxes(boxes, pending = {}, current = -1) {
    this._boxes = boxes;
    this._pending = pending || {};
    this._current = current;
    this.redraw();
  }

  _target() {
    const w = this.el.clientWidth || 1;
    const hh = this.el.clientHeight || 1;
    const scale = Math.min(w / this._docW, hh / this._docH);
    const tw = this._docW * scale;
    const th = this._docH * scale;
    return { x: (w - tw) / 2, y: (hh - th) / 2, w: tw, h: th, scale };
  }

  redraw() {
    const t = this._target();
    Object.assign(this.img.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` });
    clear(this.layer);
    this._boxes.forEach((b, k) => {
      const pending = this._pending[k];
      const cls = pending !== undefined ? "pending" : b.kind === "sfx" ? "sfx" : "bubble";
      const el = h("div", { class: `ov-box ${cls}` + (k === this._current ? " current" : "") + (b.shape === "round" ? " round" : ""),
        style: { left: `${t.x + b.x * t.scale}px`, top: `${t.y + b.y * t.scale}px`, width: `${b.w * t.scale}px`, height: `${b.h * t.scale}px` } },
      h("span", { class: "ov-badge", text: String(pending !== undefined ? pending : k + 1) }));
      if (this._edit) {
        for (const c of ["nw", "ne", "sw", "se"]) el.appendChild(h("span", { class: `ov-handle ${c}` }));
      }
      this.layer.appendChild(el);
    });
  }

  _toDoc(e) {
    const t = this._target();
    const r = this.el.getBoundingClientRect();
    return [(e.clientX - r.left - t.x) / t.scale, (e.clientY - r.top - t.y) / t.scale];
  }

  _hit(e) {
    const [x, y] = this._toDoc(e);
    let best = -1;
    let bestArea = null;
    this._boxes.forEach((b, k) => {
      if (b.x <= x && x <= b.x + b.w && b.y <= y && y <= b.y + b.h) {
        const area = b.w * b.h;
        if (bestArea === null || area < bestArea) {
          best = k;
          bestArea = area;
        }
      }
    });
    return best;
  }

  _handleAt(e) {
    const t = this._target();
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = null;
    let bestArea = null;
    for (let k = 0; k < this._boxes.length; k++) {
      const b = this._boxes[k];
      const x0 = t.x + b.x * t.scale;
      const y0 = t.y + b.y * t.scale;
      const x1 = x0 + b.w * t.scale;
      const y1 = y0 + b.h * t.scale;
      const corners = { nw: [x0, y0], ne: [x1, y0], sw: [x0, y1], se: [x1, y1] };
      for (const [name, [cx, cy]] of Object.entries(corners)) {
        if (Math.abs(px - cx) <= BubbleOverlay.HANDLE && Math.abs(py - cy) <= BubbleOverlay.HANDLE) return [k, name];
      }
      if (x0 <= px && px <= x1 && y0 <= py && py <= y1) {
        const area = b.w * b.h;
        if (bestArea === null || area < bestArea) {
          best = [k, "move"];
          bestArea = area;
        }
      }
    }
    return best;
  }

  _rectOf(d) {
    if (!d) return null;
    const norm = (ax, ay, bx, by) => [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
    if (d.mode === "new") return norm(d.x0, d.y0, d.cx, d.cy);
    if (d.mode === "move") return [d.bx + (d.cx - d.px), d.by + (d.cy - d.py), d.bw, d.bh];
    return norm(d.fx, d.fy, d.cx, d.cy);
  }

  _down(e) {
    try {
      this.el.focus();
    } catch (err) {
      // no focus
    }
    if (e.button === 2) return;
    if (!this._edit) {
      const i = this._hit(e);
      if (i >= 0 && this.cb.onClick) this.cb.onClick(i, !!(e.ctrlKey || e.metaKey));
      return;
    }
    const [dx, dy] = this._toDoc(e);
    const hit = this._handleAt(e);
    if (hit === null) {
      this._drag = { mode: "new", x0: dx, y0: dy, cx: dx, cy: dy };
    } else if (hit[1] === "move") {
      const b = this._boxes[hit[0]];
      this._drag = { mode: "move", idx: hit[0], bx: b.x, by: b.y, bw: b.w, bh: b.h, px: dx, py: dy, cx: dx, cy: dy };
    } else {
      const [idx, corner] = hit;
      const b = this._boxes[idx];
      const fx = corner === "nw" || corner === "sw" ? b.x + b.w : b.x;
      const fy = corner === "nw" || corner === "ne" ? b.y + b.h : b.y;
      this._drag = { mode: "resize", idx, fx, fy, cx: dx, cy: dy };
    }
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch (err) {
      // no capture
    }
    this._paintRubber();
  }

  _move(e) {
    if (!this._edit || !this._drag) return;
    [this._drag.cx, this._drag.cy] = this._toDoc(e);
    this._paintRubber();
  }

  _paintRubber() {
    const r = this._rectOf(this._drag);
    if (!r) {
      show(this.rubber, false);
      return;
    }
    const t = this._target();
    Object.assign(this.rubber.style, { left: `${t.x + r[0] * t.scale}px`, top: `${t.y + r[1] * t.scale}px`, width: `${r[2] * t.scale}px`, height: `${r[3] * t.scale}px` });
    show(this.rubber, true);
  }

  _up() {
    if (!this._edit || !this._drag) return;
    const d = this._drag;
    this._drag = null;
    show(this.rubber, false);
    const rect = this._rectOf(d);
    if (!rect) return;
    let [x, y, w, hh] = rect;
    if (w < 8 || hh < 8) return;          // ignore stray clicks / tiny boxes
    x = Math.max(0, Math.min(x, this._docW - 1));
    y = Math.max(0, Math.min(y, this._docH - 1));
    w = Math.min(w, this._docW - x);
    hh = Math.min(hh, this._docH - y);
    if (d.mode === "new") {
      if (this.cb.onAdd) this.cb.onAdd(x, y, w, hh);
    } else if (this.cb.onChange) {
      this.cb.onChange(d.idx, x, y, w, hh);
    }
  }
}

export function checkerUrl(w, hh) {
  return pngDataUrl(checker(w, hh), w, hh);
}
