// The Batch tab (mark bubbles by hand, pair lines, fill the page in one run)
// and the BubblR tab (detect bubbles, reading order, training export).
//
// Port of TyperDocker._build_batch_tab / _build_bubblr_tab and every _bp_*
// method. Both tabs share ONE box list; each page view is a BubbleOverlay
// rendering it. The batch places every bubble through insert_arrangement —
// the same path as TextShapR's Apply and, below it, the Insert button — one
// bubble per tick, each insert its own modal scope and history step.

import { h, clear, show, row, hint, Button, ToggleButton, Check, Select, TextField, NumberField, TextArea,
  confirmBox, alertBox, dialog } from "./dom.js";
import { BubbleOverlay } from "./widgets.js";
import { BUBBLR_LOCKED } from "./app.js";
import { T } from "../host/settings.js";
import { docInfo, modal, selectionBounds, ps } from "../host/ps.js";
import { pageRGBA, pageGray, selectionMask, selectBox } from "../host/pixels.js";
import { removeExistingLayers } from "../host/layers.js";
import { pickOpen, pickSave } from "../host/files.js";
import * as BR from "../host/bubblr.js";
import * as BB from "../core/bubbles.js";
import { selShape, selectionFill } from "../core/selshape.js";
import { parseBold } from "../core/textprep.js";
import { pngDataUrl, encodePng } from "../core/png.js";
import { decodeBytes } from "../core/readers.js";

const BATCH_TICK_MS = 40;
const BP_MODES = { order: "st_bp_order_mode", sfx: "st_bp_sfx_mode", shape: "st_bp_shape_mode", edit: "st_bp_edit_mode" };

function short(text, n = 40) {
  const t = String(text || "").replace(/\n/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/** [kind, rows] of a box as TextShapR would read it from the selection the
 *  Krita batch made (ellipse for a round bubble, else the full rectangle). */
export function boxShape(b) {
  const w = Math.max(1, Math.trunc(b.w));
  const hh = Math.max(1, Math.trunc(b.h));
  const round = b.shape === "round" && b.kind !== "sfx" && w * hh <= 4000000;
  const mask = round ? BB.ellipseMask(w, hh) : new Uint8Array(w * hh).fill(255);
  return selShape(mask, w, hh);
}

export const BatchMethods = {
  // ======================================================================
  //  Batch tab
  // ======================================================================

  _build_batch_tab() {
    const t = (k, f) => this._tr(k, f);
    const mk = this._new_panel("batch_mark", "batch");
    this.batch_add_sel_btn = Button("", { onClick: () => this.on_bp_add_from_selection() });
    this.batch_edit_btn = this._mode_btn("edit");
    this.batch_shape_btn = this._mode_btn("shape");
    this.batch_sfxmark_btn = this._mode_btn("sfx");
    this.batch_order_btn = this._mode_btn("order");
    this.batch_detect_btn = Button("", { onClick: () => this.on_bp_detect() });
    show(this.batch_detect_btn, !BUBBLR_LOCKED);
    this.batch_clear_btn = Button("", { onClick: () => this.on_batch_clear_boxes() });
    this.batch_page_btn = Button("", { onClick: () => this.batch_show_page() });
    this.batch_mark_hint = hint();
    mk.body.append(h("div", { class: "flow" }, this.batch_add_sel_btn, this.batch_edit_btn, this.batch_shape_btn,
      this.batch_sfxmark_btn, this.batch_order_btn, this.batch_detect_btn, this.batch_clear_btn, this.batch_page_btn), this.batch_mark_hint);
    this._rt(() => {
      for (const [name, key] of [["batch_add_sel_btn", "batch_add_sel"], ["batch_edit_btn", "batch_edit"], ["batch_shape_btn", "batch_shape"],
        ["batch_sfxmark_btn", "batch_sfxmark"], ["batch_order_btn", "batch_order"], ["batch_detect_btn", "batch_detect"],
        ["batch_clear_btn", "batch_clear"], ["batch_page_btn", "batch_page"]]) {
        this[name].setText(t(key));
        this[name].setTip(t(key + "_tip"));
      }
      this.batch_mark_hint.textContent = t("batch_mark_hint");
    });

    const ovp = this._new_panel("batch_overlay", "batch");
    this.batch_overlay = this._new_bubble_overlay();
    ovp.body.appendChild(this.batch_overlay.el);
    this._rt(() => { this.batch_overlay.el.title = t("bp_overlay_tip"); });

    const bt = this._new_panel("bubblr_batch", "batch");
    this.bp_batch_assign_btn = Button("", { onClick: () => this.on_bp_batch_assign() });
    this.bp_batch_gap_btn = Button("", { onClick: () => this.on_bp_batch_gap() });
    this.bp_batch_ungap_btn = Button("", { onClick: () => this.on_bp_batch_ungap() });
    this.bp_batch_clear_btn = Button("", { onClick: () => this.on_bp_batch_clear() });
    this.bp_batch_page_chk = Check("", { checked: true, onChange: () => this.on_bp_batch_assign() });
    this.bp_batch_style_chk = Check("", { checked: T.bool("batchStyle", false), onChange: (on) => this._on_bp_batch_style_toggle(on) });
    this.bp_batch_all_btn = Button("", { onClick: () => this._bp_batch_select_all() });
    this.bp_batch_take_btn = Button("", { onClick: () => this.on_bp_batch_take_line() });
    this.bp_batch_pick_btn = ToggleButton("", { onToggle: (on) => this._on_bp_batch_pick_toggle(on) });
    this.bp_batch_stamp_btn = Button("", { onClick: () => this.on_bp_batch_stamp_style() });
    this.bp_batch_unstamp_btn = Button("", { onClick: () => this.on_bp_batch_clear_style() });
    this.bp_batch_search = TextField({ onChange: () => this._bp_batch_refresh() });
    this.bp_batch_head = h("tr", {}, ...Array.from({ length: 5 }, () => h("th")));
    this.bp_batch_body = h("tbody");
    this.bp_batch_table = h("table", { class: "batch-table" }, h("thead", {}, this.bp_batch_head), this.bp_batch_body);
    this._bp_batch_selected = new Set();
    this._bp_batch_cur = -1;
    this.bp_batch_start_btn = Button("", { variant: "cta", onClick: () => this.on_bp_batch_start() });
    this.bp_batch_start_btn.setEnabled(false);
    this.bp_batch_stop_btn = Button("", { onClick: () => this.on_bp_batch_stop() });
    this.bp_batch_stop_btn.setEnabled(false);
    this.bp_batch_review_chk = Check("", {});
    this.bp_batch_undo_btn = Button("", { onClick: () => this.on_bp_batch_undo() });
    this.bp_batch_undo_btn.setEnabled(false);
    this.bp_batch_status = hint();
    bt.body.append(
      h("div", { class: "flow" }, this.bp_batch_assign_btn, this.bp_batch_gap_btn, this.bp_batch_ungap_btn, this.bp_batch_clear_btn,
        this.bp_batch_page_chk, this.bp_batch_style_chk),
      h("div", { class: "flow" }, this.bp_batch_all_btn, this.bp_batch_take_btn, this.bp_batch_pick_btn, this.bp_batch_stamp_btn,
        this.bp_batch_unstamp_btn),
      this.bp_batch_search, h("div", { class: "batch-wrap" }, this.bp_batch_table),
      h("div", { class: "flow" }, this.bp_batch_start_btn, this.bp_batch_stop_btn, this.bp_batch_review_chk, this.bp_batch_undo_btn),
      this.bp_batch_status);
    this._rt(() => {
      for (const [name, key] of [["bp_batch_assign_btn", "bp_batch_assign"], ["bp_batch_gap_btn", "bp_batch_gap"],
        ["bp_batch_ungap_btn", "bp_batch_ungap"], ["bp_batch_clear_btn", "bp_batch_clear"], ["bp_batch_page_chk", "bp_batch_page"],
        ["bp_batch_style_chk", "bp_batch_style"], ["bp_batch_all_btn", "bp_batch_all"], ["bp_batch_take_btn", "bp_batch_take"],
        ["bp_batch_pick_btn", "bp_batch_pick"], ["bp_batch_stamp_btn", "bp_assign"], ["bp_batch_unstamp_btn", "bp_unassign"],
        ["bp_batch_start_btn", "bp_batch_start"], ["bp_batch_stop_btn", "bp_batch_stop"], ["bp_batch_review_chk", "bp_batch_review"],
        ["bp_batch_undo_btn", "bp_batch_undo"]]) {
        this[name].setText(t(key));
        this[name].setTip(t(key + "_tip"));
      }
      this.bp_batch_search.setPlaceholder(t("bp_batch_search_ph"));
      ["bp_batch_col_bubble", "bp_batch_col_line", "bp_batch_col_text", "bp_batch_col_font", "bp_batch_col_preset"]
        .forEach((k, i) => { this.bp_batch_head.children[i].textContent = t(k); });
      this._bp_batch_refresh();
    });
  },

  _mode_btn(name) {
    const b = ToggleButton("", { onToggle: (on) => this._on_bp_mode_toggle(name, on) });
    (this._bp_mode_btns[name] = this._bp_mode_btns[name] || []).push(b);
    return b;
  },

  on_batch_clear_boxes() {
    if (!this._bp_boxes.length) return;
    this._bp_boxes = [];
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
    this._set_status(this._tr("st_batch_boxes_cleared"));
  },

  /** Show the open document in the page views (no detection needed). */
  async batch_show_page(quiet = false) {
    const info = docInfo();
    if (!info) {
      if (!quiet) this._set_status(this._tr("st_no_doc"), true);
      return false;
    }
    let p;
    try {
      p = await modal("TypeR: read page", () => pageRGBA(600), { history: false });
    } catch (e) {
      p = null;
    }
    if (!p) {
      if (!quiet) this._set_status(this._tr("st_bp_unsupported", { model: "?", depth: "?" }), true);
      return false;
    }
    this._bp_set_page(pngDataUrl(p.rgba, p.w, p.h), info.w, info.h);
    return true;
  },

  // ======================================================================
  //  BubblR tab
  // ======================================================================

  _build_bubblr_tab() {
    const t = (k, f) => this._tr(k, f);
    const det = this._new_panel("bubblr_detect", "bubblr");
    this.bp_backend_combo = Select([{ label: "heur", value: "heur" }, { label: "ai", value: "ai" }], { onChange: () => this._on_bp_backend() });
    this.bp_backend_combo.setValue(T.get("bpBackend", "") || "heur");
    this.bp_detect_btn = Button("", { onClick: () => this.on_bp_detect() });
    this.bp_add_sel_btn = Button("", { onClick: () => this.on_bp_add_from_selection() });
    this.bp_reset_btn = Button("", { onClick: () => this.on_bp_reset_order() });
    this.bp_order_btn = this._mode_btn("order");
    this.bp_sfxmark_btn = this._mode_btn("sfx");
    this.bp_shape_btn = this._mode_btn("shape");
    this.bp_edit_btn = this._mode_btn("edit");
    this.bp_panelorder_btn = Button("", { onClick: () => this.on_bp_panel_order() });
    this.bp_save_btn = Button("", { onClick: () => this.on_bp_save_boxes() });
    this.bp_load_btn = Button("", { onClick: () => this.on_bp_load_boxes() });
    this.bp_model_lbl = h("span", { class: "lbl" });
    const models = ["auto", "baseline", "finetuned", "kitsumed", "hybrid"];
    this.bp_model_combo = Select(models.map((m) => ({ label: m, value: m })), { onChange: (v) => T.set("bpModel", v || "auto") });
    this.bp_model_combo.setValue(T.get("bpModel", "auto") || "auto");
    this.bp_models_btn = Button("", { onClick: () => this.on_bp_show_models() });
    this.bp_conf_lbl = h("span", { class: "lbl" });
    this.bp_conf_spin = NumberField({ min: 5, max: 95, value: Math.trunc(Number(T.get("bpConf", 40))) || 40, suffix: " %", onChange: (v) => T.set("bpConf", v) });
    this.bp_sfxconf_lbl = h("span", { class: "lbl" });
    this.bp_sfxconf_spin = NumberField({ min: 5, max: 95, value: Math.trunc(Number(T.get("bpSfxConf", 20))) || 20, suffix: " %", onChange: (v) => T.set("bpSfxConf", v) });
    this.bp_text_chk = Check("", { checked: T.bool("bpReqText", true), onChange: (on) => T.setBool("bpReqText", on) });
    this.bp_sfx_chk = Check("", { checked: T.bool("bpSfx", false), onChange: (on) => T.setBool("bpSfx", on) });
    this.bp_rtl_chk = Check("", { checked: T.bool("bpRtl", true), onChange: (on) => this._on_bp_rtl(on) });
    this.bp_tile_chk = Check("", { checked: T.bool("bpTile", false), onChange: (on) => T.setBool("bpTile", on) });
    this.bp_selfollow_chk = Check("", { checked: T.bool("bpSelFollow", true), onChange: (on) => T.setBool("bpSelFollow", on) });
    this.bp_sfx_db_btn = Button("", { onClick: () => this.on_bp_sfx_db() });
    this.bp_hint_lbl = hint();
    this.bp_export_btn = Button("", { onClick: () => this.on_bp_export_training() });
    det.body.append(
      h("div", { class: "flow" }, this.bp_backend_combo, this.bp_detect_btn, this.bp_add_sel_btn, this.bp_reset_btn, this.bp_order_btn,
        this.bp_sfxmark_btn, this.bp_shape_btn, this.bp_edit_btn, this.bp_panelorder_btn, this.bp_save_btn, this.bp_load_btn),
      h("div", { class: "flow" }, this.bp_model_lbl, this.bp_model_combo, this.bp_models_btn, this.bp_conf_lbl, this.bp_conf_spin,
        this.bp_sfxconf_lbl, this.bp_sfxconf_spin),
      h("div", { class: "flow" }, this.bp_text_chk, this.bp_sfx_chk, this.bp_rtl_chk, this.bp_tile_chk),
      h("div", { class: "flow" }, this.bp_selfollow_chk, this.bp_sfx_db_btn),
      this.bp_hint_lbl, row(this.bp_export_btn));
    const ovp = this._new_panel("bubblr_overlay", "bubblr");
    this.bp_overlay = this._new_bubble_overlay();
    ovp.body.appendChild(this.bp_overlay.el);
    this._rt(() => {
      this.bp_backend_combo.setLabelAt(0, t("bp_backend_heur"));
      this.bp_backend_combo.setLabelAt(1, t("bp_backend_ai"));
      this.bp_backend_combo.setTip(t("bp_backend_tip"));
      const pairs = [["bp_detect_btn", "bp_detect", false], ["bp_add_sel_btn", "bp_add_sel", true], ["bp_reset_btn", "bp_reset", true],
        ["bp_order_btn", "bp_order", true], ["bp_sfxmark_btn", "bp_sfxmark", true], ["bp_shape_btn", "bp_shapemark", true],
        ["bp_edit_btn", "bp_edit", true], ["bp_panelorder_btn", "bp_panelorder", true], ["bp_save_btn", "bp_save_boxes", true],
        ["bp_load_btn", "bp_load_boxes", true], ["bp_models_btn", "bp_models", true], ["bp_text_chk", "bp_chk_text", true],
        ["bp_sfx_chk", "bp_chk_sfx", true], ["bp_rtl_chk", "bp_rtl", true], ["bp_tile_chk", "bp_tile", true],
        ["bp_selfollow_chk", "bp_selfollow", true], ["bp_sfx_db_btn", "bp_sfx_db", true], ["bp_export_btn", "bp_export", true]];
      for (const [name, key, tip] of pairs) {
        this[name].setText(t(key));
        if (tip) this[name].setTip(t(key + "_tip"));
      }
      this.bp_model_lbl.textContent = t("bp_model");
      ["bp_model_auto", "bp_model_baseline", "bp_model_finetuned", "bp_model_kitsumed", "bp_model_hybrid"]
        .forEach((k, i) => this.bp_model_combo.setLabelAt(i, t(k)));
      this.bp_model_combo.setTip(t("bp_model_tip"));
      this.bp_conf_lbl.textContent = t("bp_conf");
      this.bp_conf_spin.setTip(t("bp_conf_tip"));
      this.bp_sfxconf_lbl.textContent = t("bp_sfxconf");
      this.bp_sfxconf_spin.setTip(t("bp_conf_tip"));
      this.bp_overlay.el.title = t("bp_overlay_tip");
      this.bp_hint_lbl.textContent = t("bp_hint");
    });
    this._on_bp_backend();
  },

  _new_bubble_overlay() {
    const ov = new BubbleOverlay({
      onClick: (i, ctrl) => this._on_bp_box_clicked(i, ctrl),
      onRemove: (i) => this._on_bp_box_removed(i),
      onAdd: (x, y, w, hh) => this._on_bp_box_added(x, y, w, hh),
      onChange: (i, x, y, w, hh) => this._on_bp_box_changed(i, x, y, w, hh),
      onKey: (e) => {
        const k = e.key;
        const map = { e: () => this._bp_step(1), ".": () => this._bp_step(1), q: () => this._bp_step(-1), ",": () => this._bp_step(-1),
          Delete: () => this._bp_delete_current(), Backspace: () => this._bp_delete_current(),
          s: () => this._bp_toggle_current_sfx(), r: () => this._bp_toggle_current_shape() };
        const fn = map[k.length === 1 ? k.toLowerCase() : k];
        if (fn && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          fn();
        }
      },
    });
    this._bp_overlays.push(ov);
    if (this._bp_page_thumb) ov.setPage(...this._bp_page_thumb);
    if (typeof ResizeObserver !== "undefined") {
      try {
        new ResizeObserver(() => ov.redraw()).observe(ov.el);
      } catch (e) {
        // no observer: redraw happens on the next refresh
      }
    }
    return ov;
  },

  _on_bp_backend() {
    const mode = this.bp_backend_combo.val() || "heur";
    T.set("bpBackend", mode);
    show(this.bp_text_chk, mode === "heur");
  },

  // -- SFX word database (user words in the setting 'sfxDb') ---------------------

  _bp_user_sfx_words() {
    const v = T.get("sfxDb", []);
    return Array.isArray(v) ? v : [];
  },

  _bp_sfx_words() {
    return [...BB.SFX_SEED_WORDS, ...this._bp_user_sfx_words().filter((w) => w)];
  },

  async on_bp_sfx_db() {
    let edit;
    const ok = await dialog(this._tr("bp_sfx_db"), (body) => {
      edit = TextArea({ height: 260 });
      edit.setText(this._bp_user_sfx_words().join("\n"));
      body.append(hint(this._tr("bp_sfx_dlg_hint")), edit);
    }, [{ label: this._tr("cancel"), value: false }, { label: this._tr("ok"), value: true, variant: "cta" }], { width: 320, height: 380 });
    if (!ok) return;
    T.set("sfxDb", edit.text().split("\n").map((w) => w.trim()).filter((w) => w));
  },

  // -- batch: which line goes into which bubble ------------------------------------

  _bp_batch_range() {
    if (this.bp_batch_page_chk.isChecked() && this._pages.length) return this._page_unit_range();
    return [0, this._pairs.length];
  },

  on_bp_batch_assign() {
    const [first, last] = this._bp_batch_range();
    const [assign, mismatch] = BB.assignUnits(this._bp_boxes, last, first);
    this._bp_assign = assign;
    this._bp_batch_refresh();
    const n = this._bp_assign.filter((u) => u >= 0).length;
    if (mismatch) this._bp_batch_note("st_bp_batch_mismatch", { n, lines: Math.max(0, last - first), boxes: this._bp_boxes.length });
    else this._bp_batch_note("st_bp_batch_assigned", { n });
  },

  on_bp_batch_clear() {
    this._bp_assign = new Array(this._bp_boxes.length).fill(-1);
    this._bp_batch_refresh();
    this._bp_batch_note("st_bp_batch_cleared");
  },

  on_bp_batch_gap() {
    const r = this._bp_batch_cur;
    if (r < 0 || !this._bp_assign.length) {
      this._bp_batch_note("st_bp_batch_pick_row");
      return;
    }
    this._bp_assign = BB.insertGap(this._bp_assign, r);
    this._bp_batch_refresh();
  },

  on_bp_batch_ungap() {
    const r = this._bp_batch_cur;
    if (r < 0 || !this._bp_assign.length) {
      this._bp_batch_note("st_bp_batch_pick_row");
      return;
    }
    this._bp_assign = BB.removeGap(this._bp_assign, r, this._pairs.length);
    this._bp_batch_refresh();
  },

  _bp_batch_note(key, fmt = {}) {
    this.bp_batch_status.textContent = this._tr(key, fmt);
  },

  _bp_batch_rows() {
    const rows = [...this._bp_batch_selected].sort((a, b) => a - b);
    if (rows.length) return rows;
    return this._bp_batch_cur >= 0 ? [this._bp_batch_cur] : [];
  },

  _bp_batch_select_all() {
    this._bp_batch_selected = new Set(this._bp_boxes.map((_, i) => i));
    this._bp_batch_paint_selection();
  },

  _bp_batch_select_row(r, e = null) {
    if (e && (e.ctrlKey || e.metaKey)) {
      if (this._bp_batch_selected.has(r)) this._bp_batch_selected.delete(r);
      else this._bp_batch_selected.add(r);
    } else if (e && e.shiftKey && this._bp_batch_cur >= 0) {
      const [a, b] = [Math.min(r, this._bp_batch_cur), Math.max(r, this._bp_batch_cur)];
      for (let i = a; i <= b; i++) this._bp_batch_selected.add(i);
    } else {
      this._bp_batch_selected = new Set([r]);
    }
    this._bp_batch_cur = r;
    this._bp_batch_paint_selection();
    // a single row arms that bubble, so the page view highlights it
    if (this._bp_batch_rows().length === 1 && r >= 0 && r < this._bp_boxes.length && r !== this._bp_current) this._bp_set_current(r);
  },

  _bp_batch_paint_selection() {
    const rows = this.bp_batch_body.children;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("selected", this._bp_batch_selected.has(i));
      rows[i].classList.toggle("current", i === this._bp_batch_cur);
    }
  },

  on_bp_batch_take_line() {
    const rows = this._bp_batch_rows();
    if (!rows.length) {
      this._bp_batch_note("st_bp_batch_pick_row");
      return;
    }
    let unit = this._index;
    for (const r of rows) {
      if (unit < this._pairs.length) {
        this._bp_assign[r] = unit;
        unit += 1;
      } else {
        this._bp_assign[r] = -1;
      }
    }
    this._bp_batch_refresh();
    this._bp_batch_note("st_bp_batch_took", { n: rows.length });
  },

  _on_bp_batch_pick_toggle(on) {
    if (on) {
      this._bp_batch_note("st_bp_batch_pick_mode");
      if (this._bp_batch_cur < 0 && this._bp_boxes.length) this._bp_batch_select_row(0);
    }
  },

  /** A line was clicked in the Type table while 'assign by clicking' is on. */
  _bp_batch_line_clicked(unit) {
    if (!this.bp_batch_pick_btn || !this.bp_batch_pick_btn.isChecked()) return false;
    const r = this._bp_batch_cur;
    if (!(r >= 0 && r < this._bp_assign.length)) return false;
    this._bp_assign[r] = unit;
    let nxt = r + 1;
    while (nxt < this._bp_boxes.length && this._bp_boxes[nxt].kind === "sfx") nxt += 1;
    this._bp_batch_refresh();
    if (nxt < this._bp_boxes.length) {
      this._bp_batch_select_row(nxt);
    } else {
      this.bp_batch_pick_btn.setChecked(false);
      this._bp_batch_note("st_bp_batch_pick_done");
    }
    return true;
  },

  on_bp_batch_stamp_style() {
    const rows = this._bp_batch_rows();
    if (!rows.length) {
      this._bp_batch_note("st_bp_batch_pick_row");
      return;
    }
    if (!this.bp_batch_style_chk.isChecked()) {
      this.bp_batch_style_chk.setChecked(true);
      T.setBool("batchStyle", true);
    }
    const style = {};
    const fam = this.font_picker.currentFamily();
    if (fam) style.font = fam;
    const data = this.preset_combo.val();
    if (data !== undefined && data !== null) style.preset = data;
    for (const r of rows) if (r >= 0 && r < this._bp_style.length) this._bp_style[r] = { ...style };
    this._bp_batch_refresh();
    this._bp_batch_note("st_bp_batch_styled", { n: rows.length });
  },

  on_bp_batch_clear_style() {
    const rows = this._bp_batch_rows();
    if (!rows.length) {
      this._bp_batch_note("st_bp_batch_pick_row");
      return;
    }
    for (const r of rows) if (r >= 0 && r < this._bp_style.length) this._bp_style[r] = {};
    this._bp_batch_refresh();
    this._bp_batch_note("st_bp_batch_unstyled", { n: rows.length });
  },

  _on_bp_batch_style_toggle(on) {
    T.setBool("batchStyle", on);
    this._bp_batch_refresh();
  },

  _bp_batch_unit_select(r, first, last) {
    const query = this.bp_batch_search.text().trim().toLowerCase();
    const want = r < this._bp_assign.length ? this._bp_assign[r] : -1;
    const items = [{ label: this._tr("bp_batch_none"), value: -1 }];
    for (let u = first; u < last; u++) {
      const text = this._unit_text(u);
      if (query && !text.toLowerCase().includes(query) && u !== want) continue;
      items.push({ label: `${u + 1}  ${short(text)}`, value: u });
    }
    const sel = Select(items, {
      class: "cell-select",
      onChange: (v) => {
        this._bp_assign[r] = v === undefined || v === null ? -1 : Math.trunc(v);
        this._bp_batch_fill_preview(r);
        this._bp_batch_update_buttons();
      },
    });
    if (!sel.setValue(want)) sel.setIndex(0);
    return sel;
  },

  _bp_batch_font_select(r) {
    const items = [{ label: this._tr("bp_batch_none"), value: "" }, ...this.font_picker.families().map((f) => ({ label: f, value: f }))];
    const sel = Select(items, { class: "cell-select", onChange: (v) => this._on_bp_batch_style_pick(r, "font", v) });
    if (!sel.setValue((this._bp_style[r] || {}).font || "")) sel.setIndex(0);
    return sel;
  },

  _bp_batch_preset_select(r) {
    const items = [{ label: this._tr("bp_batch_none"), value: null }];
    const vals = this.preset_combo.values();
    vals.forEach((v, i) => {
      if (v !== null && v !== undefined) items.push({ label: this.preset_combo.labelAt(i), value: v });
    });
    const sel = Select(items, { class: "cell-select", onChange: (v) => this._on_bp_batch_style_pick(r, "preset", v) });
    const want = (this._bp_style[r] || {}).preset;
    if (want === undefined || !sel.setValue(want)) sel.setIndex(0);
    return sel;
  },

  _on_bp_batch_style_pick(r, key, value) {
    if (!(r >= 0 && r < this._bp_style.length)) return;
    const style = { ...(this._bp_style[r] || {}) };
    if (value) style[key] = value;
    else delete style[key];
    this._bp_style[r] = style;
  },

  _bp_batch_fill_preview(r) {
    const tr = this.bp_batch_body.children[r];
    if (!tr) return;
    const u = r < this._bp_assign.length ? this._bp_assign[r] : -1;
    const text = u >= 0 ? this._unit_text(u).replace(/\n/g, " ").trim() : "";
    tr.children[2].textContent = text;
    tr.children[2].title = text;
  },

  _bp_batch_refresh() {
    if (!this.bp_batch_body) return;
    const n = this._bp_boxes.length;
    if (this._bp_assign.length !== n) this._bp_assign = [...this._bp_assign, ...new Array(n).fill(-1)].slice(0, n);
    if (this._bp_style.length !== n) this._bp_style = [...this._bp_style, ...Array.from({ length: n }, () => ({}))].slice(0, n);
    const [first, last] = this._bp_batch_range();
    const styled = this.bp_batch_style_chk.isChecked();
    this._bp_batch_selected = new Set([...this._bp_batch_selected].filter((r) => r < n));
    if (this._bp_batch_cur >= n) this._bp_batch_cur = -1;
    clear(this.bp_batch_body);
    this._bp_boxes.forEach((b, r) => {
      const kind = b.kind || "bubble";
      const lbl = `${r + 1}  ${kind === "sfx" ? this._tr("bp_batch_sfx") : this._tr("bp_batch_" + (b.shape || "rect"))}`;
      const c0 = h("td", { class: "nowrap", text: lbl });
      const c1 = h("td", {}, this._bp_batch_unit_select(r, first, last));
      const c2 = h("td", { class: "muted ellipsis" });
      const c3 = h("td", {}, styled ? this._bp_batch_font_select(r) : null);
      const c4 = h("td", {}, styled ? this._bp_batch_preset_select(r) : null);
      const tr = h("tr", {}, c0, c1, c2, c3, c4);
      show(c3, styled);
      show(c4, styled);
      c0.addEventListener("click", (e) => this._bp_batch_select_row(r, e));
      c2.addEventListener("click", (e) => this._bp_batch_select_row(r, e));
      this.bp_batch_body.appendChild(tr);
      this._bp_batch_fill_preview(r);
    });
    show(this.bp_batch_head.children[3], styled);
    show(this.bp_batch_head.children[4], styled);
    this._bp_batch_paint_selection();
    this._bp_batch_update_buttons();
  },

  _bp_batch_update_buttons() {
    if (!this.bp_batch_start_btn) return;
    const running = this._bp_run !== null;
    const pairs = BB.batchPairs(this._bp_assign, this._pairs.length);
    this.bp_batch_start_btn.setEnabled(pairs.length > 0 && !running);
    this.bp_batch_stop_btn.setEnabled(running);
    for (const w of [this.bp_batch_assign_btn, this.bp_batch_gap_btn, this.bp_batch_ungap_btn, this.bp_batch_clear_btn, this.bp_batch_page_chk]) {
      w.setEnabled(!running);
    }
  },

  // -- batch: the run -------------------------------------------------------------------

  async on_bp_batch_start() {
    if (this._bp_run) return;
    if (!docInfo()) {
      this._bp_batch_note("st_no_doc");
      return;
    }
    if (!this.font_picker.currentFamily()) {
      this._bp_batch_note("st_no_font");
      return;
    }
    const pairs = BB.batchPairs(this._bp_assign, this._pairs.length);
    if (!pairs.length) {
      this._bp_batch_note("st_bp_batch_nothing");
      return;
    }
    const review = this.bp_batch_review_chk.isChecked();
    if (!review) {
      const ok = await confirmBox(this._tr("bp_batch_confirm_title"), this._tr("bp_batch_confirm", { n: pairs.length }),
        this._tr("yes"), this._tr("no"));
      if (!ok) return;
    }
    this._bp_run = {
      pairs, at: 0, done: 0, skipped: 0, units: [], review, waiting: false,
      back_to: this._index, restyled: false,
      style: this._collect_settings(), font: this.font_picker.currentFamily(),
    };
    this._bp_batch_update_buttons();
    setTimeout(() => this._bp_batch_tick(), 0);
  },

  on_bp_batch_stop() {
    if (this._bp_run) this._bp_batch_finish(true);
  },

  /** Place one bubble, then hand control back to the panel. */
  async _bp_batch_tick() {
    const run = this._bp_run;
    if (!run) return;
    if (run.at >= run.pairs.length) {
      this._bp_batch_finish();
      return;
    }
    const [boxIndex, unit] = run.pairs[run.at];
    run.at += 1;
    this._bp_batch_note("st_bp_batch_running", { cur: run.at, n: run.pairs.length });
    const next = (ms = 0) => setTimeout(() => this._bp_batch_tick(), ms);
    if (!(boxIndex >= 0 && boxIndex < this._bp_boxes.length)) {
      run.skipped += 1;
      next();
      return;
    }
    const b = this._bp_boxes[boxIndex];
    this._bp_current = boxIndex;
    this._bp_refresh_overlay();
    this._bp_update_nav();
    this._index = unit;
    if (this._bp_apply_row_style(boxIndex)) run.restyled = true;
    const shapr = this.shapr_widget;
    const [clean, mask] = parseBold(this._prepared_text(this._unit_text(unit)));
    const [kind, rows] = boxShape(b);
    const cands = await shapr.candidates_for(clean, mask, b.w, b.h, kind, rows, null, run.review ? 10 : 1);
    if (this._bp_run !== run) return;          // stopped meanwhile
    if (!cands.length) {
      run.skipped += 1;
      next();
      return;
    }
    if (run.review) {
      // hand the bubble to the user: the cards come up for this box (the
      // box becomes the selection so they read it), Apply continues the run
      run.waiting = true;
      run.box = boxIndex;
      run.unit = unit;
      try {
        await modal("TypeR: select bubble", () => selectBox(b), { history: false });
      } catch (e) {
        // the cards then show the old selection
      }
      this.tabs.select("shapr");
      await shapr.refresh();
      shapr._select_best();
      const msg = this._tr("st_bp_batch_review", { cur: run.at, n: run.pairs.length });
      this._bp_batch_note("st_bp_batch_review", { cur: run.at, n: run.pairs.length });
      this._set_status(msg);
      return;
    }
    const ok = await this.insert_arrangement(cands[0], false, true, [b.x, b.y, b.w, b.h]);
    if (this._bp_run !== run) return;
    if (ok) {
      run.done += 1;
      run.units.push(unit);
      this._bp_placed.add(boxIndex);
    } else {
      run.skipped += 1;
    }
    next(BATCH_TICK_MS);
  },

  _bp_apply_row_style(r) {
    const style = (r >= 0 && r < this._bp_style.length ? this._bp_style[r] : null) || {};
    if (!Object.keys(style).length) return false;
    if (style.preset !== undefined && style.preset !== null) {
      const [ch, name] = this._preset_ref(style.preset);
      const preset = (this._cur_chars()[ch] || {})[name];
      if (preset && typeof preset === "object") this._apply_preset(preset);
    }
    if (style.font) this.font_picker.setCurrentFamily(style.font);
    return true;
  },

  /** Called from insert_arrangement when a reviewed bubble was applied. */
  _bp_batch_continue() {
    const run = this._bp_run;
    if (!run || !run.waiting) return;
    run.waiting = false;
    run.done += 1;
    run.units.push(run.unit !== undefined ? run.unit : this._index);
    this._bp_placed.add(run.box !== undefined ? run.box : this._bp_current);
    setTimeout(() => this._bp_batch_tick(), BATCH_TICK_MS);
  },

  _bp_batch_finish(stopped = false) {
    const run = this._bp_run;
    this._bp_run = null;
    if (!run) return;
    if (run.restyled) {
      try {
        this._apply_settings(run.style);
        if (run.font) this.font_picker.setCurrentFamily(run.font);
        this._on_outline_toggle();
        this._on_shadow_toggle();
        this._on_auto_toggle();
      } catch (e) {
        // best effort
      }
    }
    this._bp_last_units = [...run.units];
    this.bp_batch_undo_btn.setEnabled(this._bp_last_units.length > 0);
    this._bp_batch_update_buttons();
    this._bp_batch_refresh();
    this._bp_batch_note(stopped ? "st_bp_batch_stopped" : "st_bp_batch_done", { n: run.done, skipped: run.skipped });
  },

  /** Delete exactly the `TypeR NN — ` layers the last batch wrote. */
  async on_bp_batch_undo() {
    const units = this._bp_last_units || [];
    if (!docInfo() || !units.length) return;
    let removed = 0;
    try {
      await modal(this._tr("bp_batch_undo"), async () => {
        for (const u of units) removed += await removeExistingLayers(u + 1);
      });
    } catch (e) {
      // partial undo is still reported
    }
    for (const u of units) this._done.delete(u);
    this._repaint_done();
    this._bp_last_units = [];
    this._bp_placed = new Set();
    this.bp_batch_undo_btn.setEnabled(false);
    this._bp_batch_note("st_bp_batch_undone", { n: removed });
  },

  // -- current bubble + selection sync -----------------------------------------------------

  async _select_box(b) {
    if (!docInfo()) return false;
    try {
      await modal("TypeR: select bubble", () => selectBox(b), { history: false });
      return true;
    } catch (e) {
      return false;
    }
  },

  _bp_apply_selection() {
    if (!this.bp_selfollow_chk || !this.bp_selfollow_chk.isChecked()) return;
    if (this._bp_run) return;                      // the batch passes boxes itself
    if (!(this._bp_current >= 0 && this._bp_current < this._bp_boxes.length)) return;
    this._select_box(this._bp_boxes[this._bp_current]);
  },

  _bp_set_current(idx) {
    if (!(idx >= 0 && idx < this._bp_boxes.length)) idx = -1;
    this._bp_current = idx;
    this._bp_refresh_overlay();
    this._bp_apply_selection();
    this._bp_update_nav();
  },

  _bp_reset_state() {
    this._bp_placed = new Set();
    this._bp_assign = new Array(this._bp_boxes.length).fill(-1);
    this._bp_set_current(this._bp_boxes.length ? 0 : -1);
    this._bp_batch_refresh();
  },

  _bp_next_bubble(start) {
    for (let k = Math.max(0, start); k < this._bp_boxes.length; k++) if (!this._bp_placed.has(k)) return k;
    return null;
  },

  // -- detection ---------------------------------------------------------------------------

  async _bp_read_gray() {
    try {
      return await modal("TypeR: read page", () => pageGray(), { history: false });
    } catch (e) {
      return null;
    }
  },

  _bp_refine_shapes(boxes, gray, w, hh) {
    for (const b of boxes) {
      if (b.kind !== "bubble") continue;
      const step = Math.max(1, Math.trunc(((b.w * b.h) / 20000.0) ** 0.5));
      let white = 0;
      let total = 0;
      for (let y = b.y; y < Math.min(hh, b.y + b.h); y += step) {
        const base = y * w;
        for (let x = b.x; x < Math.min(w, b.x + b.w); x += step) {
          total += 1;
          if (gray[base + x] >= BB.BRIGHT_THRESH) white += 1;
        }
      }
      const frac = white / (total || 1);
      b.shape = frac >= 0.9 ? "rect" : "round";
      b.fill = frac;
      delete b.poly;
      if (frac < 0.9) {
        try {
          const poly = BB.contourInBox(gray, w, hh, [b.x, b.y, b.w, b.h]);
          if (poly && poly.length >= 3) b.poly = poly;
        } catch (e) {
          // never let shape refine crash
        }
      }
    }
  },

  async _bp_detect_ai(gray, w, hh) {
    let boxes;
    try {
      boxes = await BR.detect(encodePng(grayToRgba(gray, w, hh), w, hh), {
        tile: this.bp_tile_chk.isChecked() ? "auto" : "off",
        model: this.bp_model_combo.val() || "auto",
        conf: this.bp_conf_spin.num() / 100.0,
        sfxConf: this.bp_sfxconf_spin.num() / 100.0,
      });
    } catch (e) {
      if (e instanceof BR.BridgeMissing) this._set_status(this._tr("bp_bridge_missing"), true);
      else if (e instanceof BR.AiMissing) this._set_status(this._tr("st_bp_ai_missing"), true);
      else this._set_status(this._tr("st_bp_ai_error", { msg: e.message || e }), true);
      return null;
    }
    if (!this.bp_sfx_chk.isChecked()) boxes = boxes.filter((b) => b.kind !== "sfx");
    this._bp_refine_shapes(boxes, gray, w, hh);
    return boxes;
  },

  async on_bp_detect() {
    const info = docInfo();
    if (!info) {
      this._set_status(this._tr("st_no_doc"), true);
      return;
    }
    const g = await this._bp_read_gray();
    if (!g) {
      this._set_status(this._tr("st_bp_unsupported", { model: "?", depth: "?" }), true);
      return;
    }
    const { gray, w, h: hh } = g;
    let boxes;
    if ((this.bp_backend_combo.val() || "heur") === "ai") {
      boxes = await this._bp_detect_ai(gray, w, hh);
      if (!boxes) return;
    } else {
      boxes = BB.detectBubbles(gray, w, hh, { requireText: this.bp_text_chk.isChecked() });
      if (this.bp_sfx_chk.isChecked()) boxes = [...boxes, ...BB.detectTextBlocks(gray, w, hh, boxes)];
    }
    this._bp_boxes = BB.readingOrder(boxes, this.bp_rtl_chk.isChecked());
    this._bp_click_seq = [];
    await this.batch_show_page(true);
    this._bp_reset_state();
    this._bp_refresh();
    if (this._bp_boxes.length) this._set_status(this._tr("st_bp_detected", { n: this._bp_boxes.length }));
    else this._set_status(this._tr("st_bp_none"), true);
  },

  _on_bp_rtl(on) {
    T.setBool("bpRtl", on);
    if (this._bp_boxes.length) {
      this._bp_boxes = BB.readingOrder(this._bp_boxes, on);
      this._bp_click_seq = [];
      this._bp_reset_state();
      this._bp_refresh();
    }
  },

  on_bp_reset_order() {
    if (this._bp_boxes.length) this._bp_boxes = BB.readingOrder(this._bp_boxes, this.bp_rtl_chk.isChecked());
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
  },

  _doc_base() {
    try {
      const { app } = ps();
      const t = app.activeDocument ? app.activeDocument.title : "";
      return String(t || "page").replace(/\.[^.]+$/, "");
    } catch (e) {
      return "page";
    }
  },

  async on_bp_save_boxes() {
    if (!this._bp_boxes.length) {
      this._set_status(this._tr("st_bp_export_none"), true);
      return;
    }
    const base = docInfo() ? this._doc_base() : "boxes";
    try {
      const path = await pickSave(base + ".bubblr.json", ["json"], JSON.stringify({ boxes: this._bp_boxes }));
      if (path) this._set_status(this._tr("st_bp_saved", { name: path.split(/[\\/]/).pop() }));
    } catch (e) {
      this._set_status(String(e.message || e), true);
    }
  },

  async on_bp_load_boxes() {
    const f = await pickOpen(["json"]);
    if (!f) return;
    let boxes;
    try {
      const data = JSON.parse(decodeBytes(f.bytes));
      const raw = data && !Array.isArray(data) && data.boxes ? data.boxes : data;
      boxes = raw.map((b) => ({
        x: Math.trunc(b.x), y: Math.trunc(b.y), w: Math.trunc(b.w), h: Math.trunc(b.h),
        kind: b.kind || "bubble", shape: b.shape || "rect", score: Number(b.score !== undefined ? b.score : 1.0),
      }));
      if (boxes.some((b) => ![b.x, b.y, b.w, b.h].every(Number.isFinite))) throw new Error("bad box");
    } catch (e) {
      this._set_status(String(e.message || e), true);
      return;
    }
    this._bp_boxes = boxes;
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
    this._set_status(this._tr("st_bp_loaded", { n: boxes.length }));
  },

  async on_bp_panel_order() {
    if (!this._bp_boxes.length) {
      this._set_status(this._tr("st_bp_export_none"), true);
      return;
    }
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return;
    }
    const g = await this._bp_read_gray();
    if (!g) {
      this._set_status(this._tr("st_bp_unsupported", { model: "?", depth: "?" }), true);
      return;
    }
    this._set_status(this._tr("st_bp_panels_wait"));
    let panels;
    try {
      panels = await BR.detectPanels(encodePng(grayToRgba(g.gray, g.w, g.h), g.w, g.h));
    } catch (e) {
      if (e instanceof BR.BridgeMissing) this._set_status(this._tr("bp_bridge_missing"), true);
      else if (e instanceof BR.AiMissing) this._set_status(this._tr("st_bp_ai_missing"), true);
      else this._set_status(this._tr("st_bp_ai_error", { msg: e.message || e }), true);
      return;
    }
    this._bp_boxes = BB.orderByPanels(this._bp_boxes, panels, this.bp_rtl_chk.isChecked());
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
    this._set_status(this._tr("st_bp_panels", { n: panels.length }));
  },

  async on_bp_show_models() {
    let info;
    try {
      info = await BR.info();
    } catch (e) {
      await alertBox(this._tr("bp_models_title"), e instanceof BR.BridgeMissing ? this._tr("bp_bridge_missing") : this._tr("bp_models_none"), this._tr("ok"));
      return;
    }
    if (!info.ai_dir) {
      await alertBox(this._tr("bp_models_title"), this._tr("bp_models_none"), this._tr("ok"));
      return;
    }
    const rows = (info.models || []).map((m) => `  ${String(m.choice).padEnd(10)} ${String(m.fname).padEnd(34)} ${m.state}`);
    const msg = `${this._tr("bp_models_dir")}\n${info.models_dir}\n\n${rows.join("\n")}\n\n${this._tr("bp_models_trainer")}`;
    const open = await confirmBox(this._tr("bp_models_title"), msg, this._tr("bp_models_open"), this._tr("close"));
    if (open) BR.openModels().catch(() => {});
  },

  // -- boxes from the selection -------------------------------------------------------------

  async on_bp_add_from_selection() {
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return;
    }
    const sel = await selectionBounds();
    if (!sel || sel[2] <= 0 || sel[3] <= 0) {
      this._set_status(this._tr("st_bp_no_sel"), true);
      return;
    }
    const added = await this._boxes_from_selection(sel);
    if (!added.length) {
      this._set_status(this._tr("st_bp_no_sel"), true);
      return;
    }
    this._bp_boxes.push(...added);
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
    this._set_status(this._tr(added.length > 1 ? "st_bp_added_n" : "st_bp_added", { n: this._bp_boxes.length, k: added.length }));
    if (!this._bp_page_thumb) this.batch_show_page(true);
  },

  /** One box per unconnected part of the selection (shift-drag over five
   *  balloons = five boxes); the bounding box when the mask is unreadable. */
  async _boxes_from_selection(sel) {
    const [x, y, w, hh] = sel;
    let mask = null;
    try {
      mask = await modal("TypeR: read selection", () => selectionMask(sel), { history: false });
    } catch (e) {
      mask = null;
    }
    if (mask && mask.length >= w * hh) {
      try {
        const boxes = BB.regionsFromMask(mask, w, hh, [x, y]);
        if (boxes.length) return BB.readingOrder(boxes, this.bp_rtl_chk.isChecked());
      } catch (e) {
        // fall back to the bounding box
      }
    }
    const fill = mask ? selectionFill(mask, w, hh) : 1.0;
    return [{ x, y, w, h: hh, kind: "bubble", shape: BB.shapeFromFill(fill), fill }];
  },

  // -- overlay interaction ------------------------------------------------------------------------

  _bp_sync_mode_btns(name, on) {
    for (const b of this._bp_mode_btns[name] || []) if (b.isChecked() !== on) b.setChecked(on);
  },

  _bp_exclusive_modes(keep) {
    for (const name of Object.keys(this._bp_mode_btns)) {
      if (name !== keep) {
        this._bp_sync_mode_btns(name, false);
        this._bp_apply_mode(name, false);
      }
    }
  },

  _bp_mode_on(name) {
    return (this._bp_mode_btns[name] || []).some((b) => b.isChecked());
  },

  _bp_apply_mode(name, on) {
    if (name === "edit") {
      for (const ov of this._bp_overlays) ov.setEditMode(on);
    } else if (name === "order" && !on && this._bp_click_seq.length) {
      this._bp_click_seq = [];
      this._bp_refresh_overlay();
    }
  },

  _on_bp_mode_toggle(name, on) {
    this._bp_sync_mode_btns(name, on);
    if (on) {
      this._bp_exclusive_modes(name);
      this._set_status(this._tr(BP_MODES[name]));
    }
    this._bp_apply_mode(name, on);
  },

  _on_bp_box_added(x, y, w, hh) {
    this._bp_boxes.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh), kind: "bubble", shape: "rect", score: 1.0 });
    this._bp_click_seq = [];
    this._bp_refresh();
    this._bp_batch_refresh();
    this._bp_set_current(this._bp_boxes.length - 1);
  },

  _on_bp_box_changed(idx, x, y, w, hh) {
    if (!(idx >= 0 && idx < this._bp_boxes.length)) return;
    const b = this._bp_boxes[idx];
    b.x = Math.round(x);
    b.y = Math.round(y);
    b.w = Math.round(w);
    b.h = Math.round(hh);
    delete b.poly;
    this._bp_refresh_overlay();
  },

  _bp_delete_current() {
    if (this._bp_current >= 0 && this._bp_current < this._bp_boxes.length) this._on_bp_box_removed(this._bp_current);
  },

  _bp_toggle_current_sfx() {
    if (this._bp_current >= 0 && this._bp_current < this._bp_boxes.length) {
      const b = this._bp_boxes[this._bp_current];
      b.kind = b.kind === "sfx" ? "bubble" : "sfx";
      this._bp_refresh_overlay();
      this._bp_batch_refresh();
    }
  },

  _bp_toggle_current_shape() {
    if (this._bp_current >= 0 && this._bp_current < this._bp_boxes.length) {
      const b = this._bp_boxes[this._bp_current];
      b.shape = b.shape === "round" ? "rect" : "round";
      delete b.poly;
      this._bp_refresh_overlay();
      this._bp_batch_refresh();
    }
  },

  _on_bp_box_clicked(idx, ctrl) {
    if (!ctrl && this._bp_mode_on("sfx")) {
      if (idx >= 0 && idx < this._bp_boxes.length) {
        const b = this._bp_boxes[idx];
        b.kind = b.kind === "sfx" ? "bubble" : "sfx";
        this._bp_refresh_overlay();
        this._bp_batch_refresh();
      }
      return;
    }
    if (!ctrl && this._bp_mode_on("shape")) {
      if (idx >= 0 && idx < this._bp_boxes.length) {
        const b = this._bp_boxes[idx];
        b.shape = b.shape === "round" ? "rect" : "round";
        delete b.poly;
        this._bp_refresh_overlay();
        this._bp_batch_refresh();
      }
      return;
    }
    const ordering = ctrl || this._bp_mode_on("order");
    if (!ordering) {
      this._bp_set_current(idx);
      return;
    }
    if (this._bp_click_seq.includes(idx)) return;
    this._bp_click_seq.push(idx);
    if (this._bp_click_seq.length === this._bp_boxes.length) {
      this._bp_boxes = this._bp_click_seq.map((i) => this._bp_boxes[i]);
      this._bp_click_seq = [];
      this._on_bp_mode_toggle("order", false);
      this._bp_reset_state();
      this._bp_refresh();
      this._set_status(this._tr("st_bp_renumbered"));
      return;
    }
    this._bp_refresh_overlay();
  },

  _on_bp_box_removed(idx) {
    this._bp_boxes.splice(idx, 1);
    this._bp_click_seq = [];
    this._bp_reset_state();
    this._bp_refresh();
  },

  _bp_set_page(dataUrl, docW, docH) {
    this._bp_page_thumb = [dataUrl, docW, docH];
    for (const ov of this._bp_overlays) ov.setPage(dataUrl, docW, docH);
  },

  _bp_refresh_overlay() {
    const pending = {};
    this._bp_click_seq.forEach((b, n) => { pending[b] = n + 1; });
    for (const ov of this._bp_overlays) ov.setBoxes(this._bp_boxes, pending, this._bp_current);
  },

  _bp_refresh() {
    this._bp_refresh_overlay();
    this._bp_update_nav();
  },

  // -- training-data export ----------------------------------------------------------------------

  async on_bp_export_training() {
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return;
    }
    if (!this._bp_boxes.length) {
      this._set_status(this._tr("st_bp_export_none"), true);
      return;
    }
    const g = await this._bp_read_gray();
    if (!g) {
      this._set_status(this._tr("st_bp_unsupported", { model: "?", depth: "?" }), true);
      return;
    }
    const base = this._doc_base().replace(/[^\p{L}\p{N}_-]/gu, "_") || "page";
    const stem = `${base}_${Math.trunc(Date.now() / 1000)}`;
    try {
      const path = await BR.exportTraining(stem, encodePng(grayToRgba(g.gray, g.w, g.h), g.w, g.h), this._bp_boxes, g.w, g.h);
      this._set_status(this._tr("st_bp_exported", { name: String(path).split(/[\\/]/).pop() }));
    } catch (e) {
      if (e instanceof BR.BridgeMissing) this._set_status(this._tr("bp_bridge_missing"), true);
      else if (e instanceof BR.AiMissing) this._set_status(this._tr("st_bp_ai_missing"), true);
      else this._set_status(this._tr("st_bp_ai_error", { msg: e.message || e }), true);
    }
  },
};

export function grayToRgba(gray, w, hh) {
  const out = new Uint8Array(w * hh * 4);
  for (let i = 0; i < w * hh; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}
