// TextShapR: the current line wrapped into several candidate shapes as
// numbered cards; Apply inserts the chosen arrangement through the normal
// insert path. Port of TypeR-Krita `TextShapRWidget` + `ShapeCard`.

import { h, clear, show, hint, Button, ToggleButton, TextArea, debounce } from "./dom.js";
import { docInfo, selectionBounds, modal } from "../host/ps.js";
import { selectionMask } from "../host/pixels.js";
import { stylesFaces } from "../host/measure.js";
import * as L from "../core/layout.js";
import { parseBold } from "../core/textprep.js";
import { renderCard } from "../core/preview.js";
import { pngDataUrl } from "../core/png.js";
import { selShape } from "../core/selshape.js";

export const SHAPER_MIN_PX = 6;
const MODES = ["balanced", "round", "tall", "wide"];

export function candKey(cand) {
  try {
    return (cand.lines || []).map((r) => L.runsMarkup(r)).join("\u0000");
  } catch (e) {
    return "";
  }
}

export class TextShapRWidget {
  constructor(app) {
    this.app = app;
    const t = (k) => app._tr(k);
    this.el = h("div", { class: "shapr", tabindex: "0" });
    const bar = h("div", { class: "flow" });
    this._modeBtns = MODES.map((m, i) => {
      const b = ToggleButton("", {
        onToggle: () => {
          this._modeBtns.forEach((x, j) => x.setChecked(j === i));
          this._reshuffle();
        },
      });
      if (i === 0) b.setChecked(true);
      bar.appendChild(b);
      return b;
    });
    this.auto_shape_btn = ToggleButton("", { onToggle: () => this._reshuffle() });
    this.auto_shape_btn.setChecked(true);
    this.live_btn = ToggleButton("", { onToggle: (on) => on && this._live_preview() });
    this.match_btn = ToggleButton("", { onToggle: () => this._reshuffle() });
    this.hyph_btn = ToggleButton("", { onToggle: () => this._reshuffle() });
    this.hyph_btn.setChecked(app.hyph_chk.isChecked());
    this.dehyph_btn = ToggleButton("", { onToggle: () => this._reshuffle() });
    bar.append(this.auto_shape_btn, this.live_btn, this.match_btn, this.hyph_btn, this.dehyph_btn);
    this._empty = h("div", { class: "hint center" });
    this._grid = h("div", { class: "cards" });
    this._hint = hint();
    this.lbl_break = h("div", { class: "muted" });
    this.break_edit = TextArea({ class: "break-edit", onChange: () => this._on_break_text_changed() });
    this._brk_box = h("div", {}, this.lbl_break, this.break_edit);
    show(this._brk_box, false);
    this.best_btn = Button("", { onClick: () => this._select_best() });
    this.apply_btn = Button("", { onClick: () => this._apply(false) });
    this.apply_next_btn = Button("", { variant: "cta", onClick: () => this._apply(true) });
    const foot = h("div", { class: "row" }, this.best_btn, h("span", { class: "grow" }), this.apply_btn, this.apply_next_btn);
    this.el.append(bar, this._empty, this._grid, this._hint, this._brk_box, foot);
    this._cards = [];
    this._cands = [];
    this._sel = -1;
    this._text_key = null;
    this._custom = null;
    this._custom_index = 0;
    this._custom_hand = false;
    this._last_box = [1, 1];
    this._gen = 0;
    this._break_timer = debounce(() => this._live_preview(), 350);
    this._refreshSoon = debounce(() => this.refresh(), 60);
    this.el.addEventListener("keydown", (e) => this._key(e));
    app._rt(() => {
      MODES.forEach((m, i) => this._modeBtns[i].setText(t("shaper_" + m)));
      this.auto_shape_btn.setText(t("shaper_auto"));
      this.auto_shape_btn.setTip(t("shaper_auto_tip"));
      this.live_btn.setText(t("shaper_live"));
      this.live_btn.setTip(t("shaper_live_tip"));
      this.match_btn.setText(t("shaper_match"));
      this.match_btn.setTip(t("shaper_match_tip"));
      this.hyph_btn.setText(t("shaper_hyph"));
      this.dehyph_btn.setText(t("shaper_dehyph"));
      this.dehyph_btn.setTip(t("shaper_dehyph_tip"));
      this._empty.textContent = t("shaper_empty");
      this.lbl_break.textContent = t("shaper_break_label");
      this.break_edit.title = t("shaper_break_tip");
      this.best_btn.setText(t("shaper_best"));
      this.best_btn.setTip(t("shaper_best_tip"));
      this.apply_btn.setText(t("shaper_apply"));
      this.apply_next_btn.setText(t("shaper_apply_next"));
    });
  }

  _mode() {
    const i = this._modeBtns.findIndex((b) => b.isChecked());
    return MODES[Math.max(0, i)];
  }

  /** [w, h, hasDoc, shape, rows] — the selection, else the page, else a
   *  default box. */
  async _box() {
    const info = docInfo();
    if (!info) return [400.0, 300.0, false, null, null];
    const sel = await selectionBounds();
    if (sel && sel[2] > 0 && sel[3] > 0) {
      let kind = "rect";
      let rows = null;
      try {
        const mask = await modal("TypeR: read selection", () => selectionMask(sel), { history: false });
        [kind, rows] = selShape(mask, sel[2], sel[3]);
      } catch (e) {
        [kind, rows] = ["rect", null];
      }
      return [sel[2], sel[3], true, kind, rows];
    }
    return [info.w, info.h, true, null, null];
  }

  _outline_inset() {
    const d = this.app;
    if (!d.outline_chk.isChecked()) return 0.0;
    let px = Math.max(d.outline_spin.num(), d.outline2_spin.num()) / 2.0;
    if (d._patterns_on() && d.style_soft_chk.isChecked()) px += d.style_soft_width_spin.num() + 2.0 * d.style_soft_blur_spin.num();
    return px;
  }

  /** [measurer, mode, maxPx] for the current style and box shape (shared
   *  with the batch run, so a batched bubble fits exactly like the cards). */
  async _fit_params(selKind, maxPx = null) {
    const d = this.app;
    const env = await d.menvFor(d.font_picker.currentFamily(), d.liga_chk.isChecked());
    const measurer = env.measurer(d.spacing_spin.num() / 100.0, d.bold_chk.isChecked(), d.italic_chk.isChecked());
    let mode = this._mode();
    if (this.auto_shape_btn.isChecked() && selKind === "round") mode = "round";
    if (maxPx === null) {
      maxPx = d.size_spin.num();
      if (this.match_btn.isChecked() && d._last_insert_px) maxPx = Math.min(maxPx, Math.trunc(d._last_insert_px));
    }
    return [measurer, mode, maxPx];
  }

  /** Ranked arrangements for `clean` in a box — no widgets touched. */
  async candidates_for(clean, mask, boxW, boxH, selKind = null, selRows = null, maxPx = null, limit = 10) {
    const d = this.app;
    if (!d.font_picker.currentFamily() || !clean.trim()) return [];
    try {
      const [measurer, mode, mx] = await this._fit_params(selKind, maxPx);
      return L.shapeCandidates(clean, measurer, boxW, boxH, mx, SHAPER_MIN_PX, d.pad_spin.num() / 100.0, {
        mode, hyphenate: this.hyph_btn.isChecked(), lang: d._hyph_lang_for(clean), mask, limit,
        dehyphenate: this.dehyph_btn.isChecked(), inset: this._outline_inset(), shapeRows: selRows,
      });
    } catch (e) {
      return [];
    }
  }

  _card_dims(boxW, boxH) {
    const avail = Math.max(140, (this.el.clientWidth || 300) - 12);
    const cols = Math.max(1, Math.floor(avail / 210));
    const cw = Math.max(160, Math.min(440, Math.trunc(avail / cols) - 8));
    const ratio = boxW > 0 ? boxH / boxW : 0.62;
    const ch = Math.trunc(Math.max(90, Math.min(cw * 1.7, cw * ratio)));
    return [cw, ch];
  }

  /** Regenerate the candidates for the current line and rebuild the cards.
   *  The chosen card stays chosen while the text stays the same. */
  async refresh() {
    const d = this.app;
    if (!d.font_picker) return;
    const gen = ++this._gen;
    let prevKey = this._sel >= 0 && this._sel < this._cands.length ? candKey(this._cands[this._sel]) : null;
    let prevIndex = this._sel;
    const family = d.font_picker.currentFamily();
    const [clean, mask] = parseBold(d._prepared_text(d._current_text()));
    const [boxW, boxH, hasDoc, selKind, selRows] = await this._box();
    if (gen !== this._gen) return;
    const same = this._text_key === clean;
    this._text_key = clean;
    if (!same) {
      prevKey = null;
      prevIndex = -1;
      this._custom = null;
      this._custom_hand = false;
    }
    let cands = [];
    if (family && clean.trim()) {
      const [measurer, , maxPx] = await this._fit_params(selKind);
      cands = await this.candidates_for(clean, mask, boxW, boxH, selKind, selRows, maxPx, 10);
      if (this._custom) cands = this._readd_custom(cands, measurer, boxW, boxH, d.pad_spin.num() / 100.0, maxPx);
    }
    if (gen !== this._gen) return;
    this._cands = cands;
    this._sel = -1;
    clear(this._grid);
    this._cards = [];
    const have = cands.length > 0;
    show(this._empty, !have);
    for (const b of [this.apply_btn, this.apply_next_btn, this.best_btn]) b.setEnabled(have);
    this._hint.textContent = d._tr(hasDoc ? "shaper_hint" : "shaper_no_doc");
    if (!have) {
      show(this._brk_box, false);
      return;
    }
    this._last_box = [boxW, boxH];
    const [cw, ch] = this._card_dims(boxW, boxH);
    const scale = Math.min((cw - 12) / boxW, (ch - 12) / boxH);
    const o = d._preview_opts(clean);
    const faces = await stylesFaces(family, o.bold, o.italic).catch(() => null);
    if (gen !== this._gen) return;
    cands.forEach((cand, i) => {
      const custom = !!cand.custom;
      const img = h("img", { class: "card-img" });
      if (faces) img.src = pngDataUrl(renderCard(cand, o, faces, cw, ch, scale), cw, ch);
      const badge = h("span", { class: "card-num", text: String(i + 1) });
      const mark = h("span", { class: custom ? "card-custom" : "card-best", text: custom ? "✎" : i === 0 ? "★" : "" });
      const card = h("div", { class: "card", style: { width: `${cw}px`, height: `${ch}px` } }, img, badge, mark);
      card.addEventListener("click", () => {
        this._select(i, true);
        try {
          this.el.focus();
        } catch (e) {
          // no focus
        }
      });
      card._mark = mark;
      this._grid.appendChild(card);
      this._cards.push(card);
    });
    this._select(this._restore_index(prevKey, prevIndex));
  }

  _readd_custom(cands, measurer, boxW, boxH, padFrac, maxPx) {
    const wordLines = [];
    for (const ln of this._custom) {
      const [c, m] = parseBold(ln);
      const ws = L.makeWords(c, Array.from(m));
      if (ws.length) wordLines.push(ws);
    }
    if (!wordLines.length) return cands;
    const ins = 2.0 * this._outline_inset();
    let res = null;
    try {
      res = L.fitFixedLines(wordLines, measurer, boxW * (1.0 - padFrac) - ins, boxH * (1.0 - padFrac) - ins, maxPx, 6);
    } catch (e) {
      res = null;
    }
    if (!res) {
      this._custom = null;
      this._custom_hand = false;
      return cands;
    }
    const [px, wl] = res;
    const runs = wl.map((ws) => L.lineRuns(ws));
    const cand = { px, k: runs.length, lines: runs, words: wl.map((ws) => [...ws]), custom: !!this._custom_hand };
    const key = candKey(cand);
    if (cands.some((c) => candKey(c) === key)) return cands;
    let i = this._custom_index;
    if (!(i >= 0 && i <= cands.length)) i = cands.length;
    const out = [...cands];
    out.splice(i, 0, cand);
    return out;
  }

  _restore_index(key, index) {
    if (key) {
      const i = this._cands.findIndex((c) => candKey(c) === key);
      if (i >= 0) return i;
    }
    if (index >= 0 && index < this._cands.length) return index;
    return 0;
  }

  async restyle() {
    await this.refresh();
    this._live_preview();
  }

  _select(index, user = false) {
    if (!(index >= 0 && index < this._cards.length)) return;
    this._sel = index;
    this._cards.forEach((c, i) => c.classList.toggle("selected", i === index));
    this._load_break_editor(index);
    if (user) {
      const cand = this._cands[index];
      this._custom = (cand.lines || []).map((r) => L.runsMarkup(r));
      this._custom_index = index;
      this._custom_hand = !!cand.custom;
      this._live_preview();
    }
  }

  _reshuffle() {
    this._custom = null;
    this._custom_hand = false;
    this.refresh();
  }

  _live_preview() {
    if (!this.live_btn.isChecked()) return;
    if (this._sel >= 0 && this._sel < this._cands.length) {
      this.app.insert_arrangement(this._cands[this._sel], false, true).catch(() => {});
    }
  }

  _load_break_editor(index) {
    const cand = this._cands[index];
    const lines = cand ? cand.lines : null;
    if (!lines || !lines.length) {
      show(this._brk_box, false);
      return;
    }
    this.break_edit.setText(lines.map((r) => L.runsMarkup(r)).join("\n"));
    show(this._brk_box, true);
  }

  _on_break_text_changed() {
    if (!(this._sel >= 0 && this._sel < this._cands.length)) return;
    const lines = this.break_edit.text().split("\n").filter((ln) => ln.trim());
    if (!lines.length) return;
    const runs = lines.map((ln) => {
      const [c, m] = parseBold(ln);
      return L.makeRuns(c, m);
    });
    const cand = this._cands[this._sel];
    cand.lines = runs;
    cand.k = runs.length;
    cand.custom = true;
    delete cand.words;
    this._custom = runs.map((r) => L.runsMarkup(r));
    this._custom_index = this._sel;
    this._custom_hand = true;
    this._repaint_card(this._sel);
    this._break_timer();
  }

  async _repaint_card(i) {
    const d = this.app;
    const card = this._cards[i];
    if (!card) return;
    const [boxW, boxH] = this._last_box;
    const [cw, ch] = this._card_dims(boxW, boxH);
    const scale = Math.min((cw - 12) / boxW, (ch - 12) / boxH);
    const o = d._preview_opts(this._text_key || "");
    const faces = await stylesFaces(d.font_picker.currentFamily(), o.bold, o.italic).catch(() => null);
    if (faces) card.querySelector("img").src = pngDataUrl(renderCard(this._cands[i], o, faces, cw, ch, scale), cw, ch);
    card._mark.className = "card-custom";
    card._mark.textContent = "✎";
  }

  _select_best() {
    if (this._cards.length) this._select(0, true);
  }

  async _apply(advance) {
    if (!(this._sel >= 0 && this._sel < this._cands.length)) return;
    const ok = await this.app.insert_arrangement(this._cands[this._sel], advance);
    if (ok && advance) this.refresh();
  }

  _key(e) {
    const tag = String((e.target && e.target.tagName) || "").toLowerCase();
    if (tag === "textarea") return;
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key) && this._cards.length) {
      e.preventDefault();
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const cur = this._sel >= 0 ? this._sel : 0;
      this._select(Math.max(0, Math.min(cur + step, this._cards.length - 1)), true);
      return;
    }
    // Shift turns the key into a symbol on most layouts: read the code
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code || "");
    if (m) {
      e.preventDefault();
      const digit = Number(m[1]);
      const index = digit === 0 ? 9 : digit - 1;
      if (index < this._cards.length) {
        this._select(index, true);
        if (e.shiftKey) this._apply(true);
      }
    }
  }
}
