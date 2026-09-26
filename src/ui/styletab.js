// The Style tab: text type, basic style, size / spacing / fitting, outline
// (+ popup with 2nd outline, pattern and soft outline), selection fill,
// shadow (+ popup), hyphenation — and the pattern generator / library.
//
// Port of the Style-tab parts of TyperDocker.__init__ and of _update_*_btn,
// _ensure_*_pattern_img, _pick_*, _choose_krita_pattern (here: Photoshop's
// pattern presets), the saved-pattern library, _fill_selection_with_pattern,
// _run_pattern_generator (patterngen.PatternGeneratorDialog), the text-type
// methods and TextTypeFontsDialog.

import { h, clear, show, row, hint, label, Button, ActionButton, Check, Select, NumberField, ColorButton,
  promptBox, chooseBox, dialog, modeless } from "./dom.js";
import { T } from "../host/settings.js";
import { modal, docInfo } from "../host/ps.js";
import { pickOpen, writeBytes, makeDir, dataFolderPath, exists } from "../host/files.js";
import { listPatternNames, patternPixels } from "../host/patterns.js";
import { fillSelection, loadImageFile } from "../host/fill.js";
import { families as psFamilies } from "../host/fonts.js";
import * as L from "../core/layout.js";
import * as TT from "../core/texttypes.js";
import { PATTERN_KINDS, makePattern, makePatternGradient } from "../core/patterns.js";
import { encodePng, pngDataUrl } from "../core/png.js";
import { checker } from "../core/raster.js";
import { debounce } from "./dom.js";

const IMG_TYPES = ["png", "jpg", "jpeg", "bmp", "webp", "gif", "tif", "tiff", "psd"];
const baseName = (p) => String(p || "").split(/[\\/]/).pop();

/** A popup whose controls live on after it closes (Qt's reusable QDialog). */
function Popup(app, titleKey, content) {
  const holder = h("div", { class: "popup-holder" });
  show(holder, false);
  holder.appendChild(content);
  let win = null;
  return {
    holder,
    open() {
      if (win) return;
      win = modeless(app._tr(titleKey), (body, close) => {
        body.appendChild(content);
        const closeBtn = Button(app._tr("close"), { onClick: close });
        body.appendChild(row(h("span", { class: "grow" }), closeBtn));
      }, {
        onClose: () => {
          holder.appendChild(content);
          win = null;
        },
      });
    },
    close() {
      if (win) win.close();
    },
  };
}

export const StyleTabMethods = {
  _build_style_tab() {
    const t = (k, f) => this._tr(k, f);
    const lay = this.tabs.layouts.style;
    const prev = () => this._update_text_preview();
    const styled = () => {
      this._update_text_preview();
      this._on_style_changed();
    };

    // --- text type -------------------------------------------------------------
    const tt = this._new_panel("text_type", "style");
    this.lbl_text_type = h("span", { class: "lbl" });
    this.text_type_combo = Select([], { onChange: () => this._on_text_type_changed() });
    this.text_type_apply_btn = Button("", { onClick: () => this.on_text_type_apply() });
    this.text_type_hint = hint();
    tt.body.append(row(this.lbl_text_type, this.text_type_combo), this.text_type_apply_btn, this.text_type_hint);
    this._texttype_panel = tt;
    this._rt(() => {
      this.lbl_text_type.textContent = t("text_type_label");
      this.text_type_apply_btn.setText(t("tt_apply"));
      this._rebuild_text_type_combo();
      this._on_text_type_changed();
    });

    // --- basic style ------------------------------------------------------------------
    const sb = this._new_panel("style_basic", "style");
    this.lbl_style = h("span", { class: "lbl" });
    this.bold_chk = Check("", { onChange: styled });
    this.italic_chk = Check("", { onChange: styled });
    this.underline_chk = Check("", { onChange: prev });
    this.liga_chk = Check("", { checked: true, onChange: styled });
    this.lbl_alignment = h("span", { class: "lbl" });
    this.align_combo = Select(["left", "center", "right"].map((v) => ({ label: v, value: v })), { onChange: styled });
    this.align_combo.setValue("center");
    this.lbl_valign = h("span", { class: "lbl" });
    this.valign_combo = Select(["top", "middle", "bottom"].map((v) => ({ label: v, value: v })), { onChange: styled });
    this.valign_combo.setValue("middle");
    this.case_label = h("span", { class: "lbl" });
    this.case_combo = Select(["none", "upper", "lower"].map((v) => ({ label: v, value: v })), { onChange: prev, class: "" });
    this.tidy_chk = Check("", { onChange: prev });
    this.comic_chk = Check("", {
      onChange: (on) => {
        this.crossbar_chk.setEnabled(on);
        prev();
      },
    });
    this.crossbar_chk = Check("", { onChange: prev });
    this.crossbar_chk.setEnabled(false);
    sb.body.append(
      h("div", { class: "flow" }, this.lbl_style, this.bold_chk, this.italic_chk, this.underline_chk, this.liga_chk),
      row(this.lbl_alignment, this.align_combo),
      row(this.lbl_valign, this.valign_combo),
      h("div", { class: "flow" }, this.case_label, this.case_combo, this.tidy_chk),
      h("div", { class: "flow" }, this.comic_chk, this.crossbar_chk));
    this._rt(() => {
      this.lbl_style.textContent = t("style");
      this.bold_chk.setText(t("bold"));
      this.italic_chk.setText(t("italic"));
      this.underline_chk.setText(t("underline"));
      this.liga_chk.setText(t("ligatures"));
      this.liga_chk.setTip(t("ligatures_tip"));
      this.lbl_alignment.textContent = t("align");
      ["align_left", "align_center", "align_right"].forEach((k, i) => this.align_combo.setLabelAt(i, t(k)));
      this.lbl_valign.textContent = t("valign_label");
      ["valign_top", "valign_middle", "valign_bottom"].forEach((k, i) => this.valign_combo.setLabelAt(i, t(k)));
      this.case_label.textContent = t("case_label");
      ["case_none", "case_upper", "case_lower"].forEach((k, i) => this.case_combo.setLabelAt(i, t(k)));
      this.tidy_chk.setText(t("tidy"));
      this.tidy_chk.setTip(t("tidy_tip"));
      this.comic_chk.setText(t("comic"));
      this.comic_chk.setTip(t("comic_tip"));
      this.crossbar_chk.setText(t("crossbar"));
      this.crossbar_chk.setTip(t("crossbar_tip"));
    });

    // --- size / spacing / auto-fit ---------------------------------------------------------
    const ss = this._new_panel("style_size", "style");
    this.size_label = h("span", { class: "lbl" });
    this.size_spin = NumberField({ min: 4, max: 2000, value: 72, onChange: styled });
    this.lbl_pad = h("span", { class: "lbl" });
    this.pad_spin = NumberField({ min: 0, max: 45, value: 12, onChange: styled });
    this.lbl_spacing = h("span", { class: "lbl" });
    this.spacing_spin = NumberField({ min: 0, max: 1000, value: 105, onChange: styled });
    this.auto_chk = Check("", { checked: true, onChange: () => this._on_auto_toggle() });
    this.round_chk = Check("", { onChange: () => this._on_auto_toggle() });
    this.vertical_chk = Check("", { onChange: styled });
    ss.body.append(
      h("div", { class: "grid2" }, this.size_label, this.size_spin, this.lbl_pad, this.pad_spin, this.lbl_spacing, this.spacing_spin),
      this.auto_chk, this.round_chk, this.vertical_chk);
    this._rt(() => {
      this.size_label.textContent = this.auto_chk.isChecked() ? t("size_max") : t("size_fixed");
      this.size_spin.setTip(t("size_tip"));
      this.lbl_pad.textContent = t("padding");
      this.pad_spin.setTip(t("padding_tip"));
      this.lbl_spacing.textContent = t("spacing");
      this.auto_chk.setText(t("auto"));
      this.auto_chk.setTip(t("auto_tip"));
      this.round_chk.setText(t("round"));
      this.round_chk.setTip(t("round_tip"));
      this.vertical_chk.setText(t("vertical"));
      this.vertical_chk.setTip(t("vertical_tip"));
    });

    // --- outline popup contents --------------------------------------------------------------
    this.outline_color_btn = ColorButton("", {
      color: this._outline_color,
      pick: (c) => this._pick_color(c, t("outline_color_dlg")),
      onChange: (c) => {
        this._outline_color = c;
        styled();
      },
    });
    this.lbl_outline_width = h("span", { class: "lbl" });
    this.outline_spin = NumberField({ min: 1, max: 200, value: 4, onChange: styled });
    this.outline2_color_btn = ColorButton("", {
      color: this._outline2_color,
      pick: (c) => this._pick_color(c, t("outline2_color_dlg")),
      onChange: (c) => {
        this._outline2_color = c;
        styled();
      },
    });
    this.lbl_outline2_width = h("span", { class: "lbl" });
    this.outline2_spin = NumberField({ min: 0, max: 200, value: 0, onChange: styled });
    this.lbl_outline_pattern = h("div", { class: "lbl" });
    this.outline_pattern_btn = Button("", { onClick: () => this._pick_outline_pattern_file() });
    this.outline_pattern_btn.classList.add("grow");
    this.outline_pattern_krita_btn = Button("", { onClick: () => this._pick_outline_pattern_krita() });
    this.outline_pattern_gen_btn = Button("", { onClick: () => this._generate_outline_pattern() });
    this.outline_pattern_saved_btn = Button("", { onClick: () => this._pick_outline_saved() });
    this.outline_pattern_clear_btn = ActionButton("✕", { onClick: () => this._clear_outline_pattern() });
    this.outline_pattern_scale_spin = NumberField({ min: 10, max: 400, value: 100, suffix: " %", onChange: prev });
    this.lbl_outline_pattern_target = h("span", { class: "lbl" });
    this.outline_pattern_target_combo = Select(["outline1", "outline2", "both"].map((v) => ({ label: v, value: v })), { onChange: prev });
    this.style_soft_chk = Check("", {
      onChange: () => {
        this._update_soft_enabled();
        prev();
      },
    });
    this.style_soft_pattern_chk = Check("", {
      onChange: () => {
        this._update_soft_enabled();
        prev();
      },
    });
    this.style_soft_color_btn = ColorButton("", {
      color: this._style_soft_color,
      pick: (c) => this._pick_color(c, t("style_soft")),
      onChange: (c) => {
        this._style_soft_color = c;
        prev();
      },
    });
    this.lbl_style_soft_w = h("span", { class: "lbl" });
    this.style_soft_width_spin = NumberField({ min: 0, max: 40, value: 3, onChange: prev });
    this.lbl_style_soft_blur = h("span", { class: "lbl" });
    this.style_soft_blur_spin = NumberField({ min: 1, max: 60, value: 8, onChange: prev });
    this._style_pattern_box = h("div", { class: "subbox" },
      this.lbl_outline_pattern,
      h("div", { class: "flow" }, this.outline_pattern_btn, this.outline_pattern_krita_btn, this.outline_pattern_gen_btn,
        this.outline_pattern_saved_btn, this.outline_pattern_clear_btn),
      this.outline_pattern_scale_spin,
      row(this.lbl_outline_pattern_target, this.outline_pattern_target_combo),
      h("div", { class: "flow" }, this.style_soft_chk, this.style_soft_pattern_chk, this.style_soft_color_btn),
      row(this.lbl_style_soft_w, this.style_soft_width_spin, this.lbl_style_soft_blur, this.style_soft_blur_spin));
    const outlineContent = h("div", { class: "popup-content" },
      row(this.outline_color_btn, this.lbl_outline_width, this.outline_spin),
      row(this.outline2_color_btn, this.lbl_outline2_width, this.outline2_spin),
      this._style_pattern_box);
    this.outline_dlg = Popup(this, "outline", outlineContent);
    lay.appendChild(this.outline_dlg.holder);

    const out = this._new_panel("style_outline", "style");
    this.outline_chk = Check("", {
      onChange: () => {
        this._on_outline_toggle();
        styled();
      },
    });
    this.outline_more_btn = Button("", { onClick: () => this.outline_dlg.open() });
    out.body.appendChild(row(this.outline_chk, this.outline_more_btn));
    this._rt(() => {
      this.outline_chk.setText(t("outline"));
      this.outline_chk.setTip(t("outline_tip"));
      this.outline_color_btn.setText(t("outline_color_btn"));
      this.lbl_outline_width.textContent = t("outline_width");
      this.outline2_color_btn.setText(t("outline2_color_btn"));
      this.lbl_outline2_width.textContent = t("outline2_width");
      this.outline_more_btn.setText(t("outline_more"));
      this.lbl_outline_pattern.textContent = t("outline_pattern_label");
      this.outline_pattern_krita_btn.setText(t("outline_pattern_krita"));
      this.outline_pattern_gen_btn.setText(t("pattern_generate"));
      this.outline_pattern_saved_btn.setText(t("pattern_saved"));
      this.lbl_outline_pattern_target.textContent = t("outline_pattern_target_label");
      ["outline_pattern_t1", "outline_pattern_t2", "outline_pattern_tboth"].forEach((k, i) => this.outline_pattern_target_combo.setLabelAt(i, t(k)));
      this._update_outline_pattern_btn();
      this.style_soft_chk.setText(t("style_soft"));
      this.style_soft_pattern_chk.setText(t("style_soft_pattern"));
      this.style_soft_color_btn.setText(t("style_soft"));
      this.lbl_style_soft_w.textContent = t("style_soft_w");
      this.lbl_style_soft_blur.textContent = t("style_soft_blur");
    });

    // --- selection fill -------------------------------------------------------------------------
    const fl = this._new_panel("style_fill", "style");
    this.fill_pattern_hint = hint();
    this.fill_pattern_btn = Button("", { onClick: () => this._pick_fill_pattern_file() });
    this.fill_pattern_btn.classList.add("grow");
    this.fill_pattern_krita_btn = Button("", { onClick: () => this._pick_fill_pattern_krita() });
    this.fill_pattern_gen_btn = Button("", { onClick: () => this._generate_fill_pattern() });
    this.fill_pattern_saved_btn = Button("", { onClick: () => this._pick_fill_saved() });
    this.fill_pattern_clear_btn = ActionButton("✕", { onClick: () => this._clear_fill_pattern() });
    this.fill_pattern_scale_spin = NumberField({ min: 10, max: 400, value: 100, suffix: " %" });
    this.fill_sel_btn = Button("", { onClick: () => this._fill_selection_current() });
    fl.body.append(this.fill_pattern_hint,
      h("div", { class: "flow" }, this.fill_pattern_btn, this.fill_pattern_krita_btn, this.fill_pattern_gen_btn,
        this.fill_pattern_saved_btn, this.fill_pattern_clear_btn),
      this.fill_pattern_scale_spin, this.fill_sel_btn);
    this._fill_panel = fl;
    this._rt(() => {
      this.fill_pattern_hint.textContent = t("fill_pattern_hint");
      this.fill_pattern_krita_btn.setText(t("outline_pattern_krita"));
      this.fill_pattern_gen_btn.setText(t("pattern_generate"));
      this.fill_pattern_saved_btn.setText(t("pattern_saved"));
      this.fill_sel_btn.setText(t("fill_apply_sel"));
      this._update_fill_pattern_btn();
    });

    // --- shadow ----------------------------------------------------------------------------------------
    this.shadow_color_btn = ColorButton("", {
      color: this._shadow_color,
      pick: (c) => this._pick_color(c, t("shadow_color_btn")),
      onChange: (c) => {
        this._shadow_color = c;
        styled();
      },
    });
    this.lbl_shadow_off = h("span", { class: "lbl" });
    this.shadow_x_spin = NumberField({ min: -100, max: 100, value: 3, onChange: styled });
    this.shadow_y_spin = NumberField({ min: -100, max: 100, value: 3, onChange: styled });
    this.shadow_dlg = Popup(this, "shadow", h("div", { class: "popup-content" },
      row(this.shadow_color_btn, this.lbl_shadow_off, this.shadow_x_spin, this.shadow_y_spin)));
    lay.appendChild(this.shadow_dlg.holder);
    const sh = this._new_panel("style_shadow", "style");
    this.shadow_chk = Check("", {
      onChange: () => {
        this._on_shadow_toggle();
        styled();
      },
    });
    this.shadow_more_btn = Button("", { onClick: () => this.shadow_dlg.open() });
    sh.body.appendChild(row(this.shadow_chk, this.shadow_more_btn));
    this._rt(() => {
      this.shadow_chk.setText(t("shadow"));
      this.shadow_chk.setTip(t("shadow_tip"));
      this.shadow_color_btn.setText(t("shadow_color_btn"));
      this.lbl_shadow_off.textContent = t("shadow_off");
      this.shadow_more_btn.setText(t("shadow_more"));
    });

    // --- hyphenation ----------------------------------------------------------------------------------------
    const hy = this._new_panel("hyphenation", "style");
    this.hyph_chk = Check("", { onChange: () => this._on_hyph_toggle() });
    this.lbl_hyph_lang = h("span", { class: "lbl" });
    this.hyph_lang_combo = Select(["auto", ...L.HYPH_LANGS].map((v) => ({ label: v, value: v })), { onChange: prev });
    hy.body.append(this.hyph_chk, row(this.lbl_hyph_lang, this.hyph_lang_combo));
    this._rt(() => {
      this.hyph_chk.setText(t("hyphenate"));
      this.hyph_chk.setTip(t("hyphenate_tip"));
      this.lbl_hyph_lang.textContent = t("hyph_lang");
      ["auto", ...L.HYPH_LANGS].forEach((c, i) => this.hyph_lang_combo.setLabelAt(i, t(c === "auto" ? "hyph_auto" : "hyph_" + c)));
    });

    this._style_timer = debounce(() => this._apply_style_changed(), 250);
    this._update_soft_enabled();
  },

  // -- toggles ----------------------------------------------------------------------

  _on_auto_toggle() {
    const auto = this.auto_chk.isChecked();
    this.size_label.textContent = auto ? this._tr("size_max") : this._tr("size_fixed");
    this.pad_spin.setEnabled(auto);
    this.round_chk.setEnabled(auto);
    if (this.hyph_chk) {
      this.hyph_chk.setEnabled(auto);
      this.hyph_lang_combo.setEnabled(auto && this.hyph_chk.isChecked());
    }
    this._update_text_preview();
    this._on_style_changed();
  },

  _on_hyph_toggle() {
    this.hyph_lang_combo.setEnabled(this.auto_chk.isChecked() && this.hyph_chk.isChecked());
    this._update_text_preview();
  },

  _on_outline_toggle() {
    const on = this.outline_chk.isChecked();
    for (const w of [this.outline_color_btn, this.outline_spin, this.outline2_color_btn, this.outline2_spin, this.outline_more_btn]) w.setEnabled(on);
  },

  _on_shadow_toggle() {
    const on = this.shadow_chk.isChecked();
    for (const w of [this.shadow_color_btn, this.shadow_x_spin, this.shadow_y_spin, this.shadow_more_btn]) w.setEnabled(on);
  },

  _update_outline_btn() {
    this.outline_color_btn.setColor(this._outline_color);
    this._update_text_preview();
  },

  _update_outline2_btn() {
    this.outline2_color_btn.setColor(this._outline2_color);
    this._update_text_preview();
  },

  _update_shadow_btn() {
    this.shadow_color_btn.setColor(this._shadow_color);
    this._update_text_preview();
  },

  _update_style_soft_btn() {
    this.style_soft_color_btn.setColor(this._style_soft_color);
  },

  _update_soft_enabled() {
    const on = this.style_soft_chk.isChecked();
    for (const w of [this.style_soft_pattern_chk, this.style_soft_width_spin, this.style_soft_blur_spin]) w.setEnabled(on);
    this.style_soft_color_btn.setEnabled(on && !this.style_soft_pattern_chk.isChecked());
  },

  /** A style control changed: re-fit TextShapR (debounced). */
  _on_style_changed() {
    if (!this.shapr_widget || !this._style_timer) return;
    this._style_timer();
  },

  _apply_style_changed() {
    try {
      if (this.shapr_widget) this.shapr_widget.restyle();
    } catch (e) {
      // a re-fit must never kill the UI
    }
  },

  // -- patterns: sources -------------------------------------------------------------

  _update_outline_pattern_btn() {
    const name = this._outline_pattern_path ? baseName(this._outline_pattern_path) : this._outline_pattern_ps_name;
    this.outline_pattern_btn.setText(name || this._tr("outline_pattern_pick"));
  },

  _update_fill_pattern_btn() {
    const name = this._fill_pattern_path ? baseName(this._fill_pattern_path) : this._fill_pattern_ps_name;
    this.fill_pattern_btn.setText(name || this._tr("fill_pattern_pick"));
  },

  /** The cached outline tile (sync; _load_pattern_images fills the cache). */
  _ensure_outline_pattern_img() {
    return this._outline_pattern_img || null;
  },

  _ensure_fill_pattern_img() {
    return this._fill_pattern_img || null;
  },

  /** Resolve saved pattern sources (file path / Photoshop pattern name) to
   *  tiles — async, once at startup and after a preset changed them. */
  async _load_pattern_images() {
    const load = async (path, psName) => {
      if (path && (await exists(path))) {
        const img = await loadImageFile(path);
        if (img) return img;
      }
      if (psName && docInfo()) {
        try {
          return await modal("TypeR: pattern", () => patternPixels(psName), { history: false });
        } catch (e) {
          return null;
        }
      }
      return null;
    };
    if (!this._outline_pattern_img && (this._outline_pattern_path || this._outline_pattern_ps_name)) {
      this._outline_pattern_img = await load(this._outline_pattern_path, this._outline_pattern_ps_name);
    }
    if (!this._fill_pattern_img && (this._fill_pattern_path || this._fill_pattern_ps_name)) {
      this._fill_pattern_img = await load(this._fill_pattern_path, this._fill_pattern_ps_name);
    }
    this._update_text_preview();
  },

  async _pick_image_file(titleKey) {
    const f = await pickOpen(IMG_TYPES);
    if (!f) return null;
    const img = await loadImageFile(f.path);
    if (!img) {
      this._set_status(this._tr("outline_pattern_bad"), true);
      return null;
    }
    return { img, path: f.path };
  },

  async _pick_outline_pattern_file() {
    const r = await this._pick_image_file("outline_pattern_pick");
    if (!r) return;
    this._outline_pattern_path = r.path;
    this._outline_pattern_ps_name = "";
    this._outline_pattern_img = r.img;
    this._update_outline_pattern_btn();
    this._update_text_preview();
  },

  async _pick_fill_pattern_file() {
    const r = await this._pick_image_file("fill_pattern_pick");
    if (!r) return;
    this._fill_pattern_path = r.path;
    this._fill_pattern_ps_name = "";
    this._fill_pattern_img = r.img;
    this._fill_pattern_stretch = false;
    this._fill_pattern_grad_spec = null;
    this._update_fill_pattern_btn();
    this._update_text_preview();
  },

  /** Pick one of Photoshop's pattern presets. Returns [name, tile] or [null, null]. */
  async _choose_ps_pattern() {
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return [null, null];
    }
    const names = await listPatternNames();
    if (!names.length) {
      this._set_status(this._tr("outline_pattern_none"), true);
      return [null, null];
    }
    const i = await chooseBox(this._tr("outline_pattern_krita"), "", names, this._tr("ok"), this._tr("cancel"));
    if (i === null || i === undefined) return [null, null];
    const nm = names[i];
    let tile = null;
    try {
      tile = await modal("TypeR: pattern", () => patternPixels(nm), { history: false });
    } catch (e) {
      tile = null;
    }
    if (!tile) {
      this._set_status(this._tr("outline_pattern_none"), true);
      return [null, null];
    }
    return [nm, tile];
  },

  async _pick_outline_pattern_krita() {
    const [nm, tile] = await this._choose_ps_pattern();
    if (!nm) return;
    this._outline_pattern_ps_name = nm;
    this._outline_pattern_path = "";
    this._outline_pattern_img = tile;
    this._update_outline_pattern_btn();
    this._update_text_preview();
  },

  async _pick_fill_pattern_krita() {
    const [nm, tile] = await this._choose_ps_pattern();
    if (!nm) return;
    this._fill_pattern_ps_name = nm;
    this._fill_pattern_path = "";
    this._fill_pattern_img = tile;
    this._fill_pattern_stretch = false;
    this._fill_pattern_grad_spec = null;
    this._update_fill_pattern_btn();
    this._update_text_preview();
  },

  _clear_outline_pattern() {
    this._outline_pattern_path = "";
    this._outline_pattern_ps_name = "";
    this._outline_pattern_img = null;
    this._update_outline_pattern_btn();
    this._update_text_preview();
  },

  _clear_fill_pattern() {
    this._fill_pattern_path = "";
    this._fill_pattern_ps_name = "";
    this._fill_pattern_img = null;
    this._fill_pattern_stretch = false;
    this._fill_pattern_grad_spec = null;
    this._update_fill_pattern_btn();
    this._update_text_preview();
  },

  // -- the saved-pattern library --------------------------------------------------------

  async _patterns_dir() {
    const base = (await dataFolderPath()).replace(/[\\/]$/, "") + "/TypeR-Patterns";
    await makeDir(base);
    return base;
  },

  async _save_generated_pattern(img) {
    try {
      const path = `${await this._patterns_dir()}/pattern_${Date.now()}.png`;
      await writeBytes(path, encodePng(img.rgba, img.w, img.h));
      return path;
    } catch (e) {
      return "";
    }
  },

  _load_pattern_library() {
    const data = T.get("patternLibrary", []);
    return Array.isArray(data) ? data.filter((e) => e && typeof e === "object" && e.path) : [];
  },

  _save_pattern_library(lib) {
    T.set("patternLibrary", lib);
  },

  async _save_pattern_to_library(img) {
    if (!img) return;
    let name = await promptBox(this._tr("patlib_title"), this._tr("patlib_name"), "");
    if (name === null) return;
    name = name.trim() || this._tr("patlib_unnamed");
    const path = await this._save_generated_pattern(img);
    if (!path) return;
    const lib = this._load_pattern_library();
    lib.push({ name, path });
    this._save_pattern_library(lib);
    this._set_status(this._tr("patlib_saved", { name }));
  },

  /** Picker over the saved-pattern library (with delete): [tile, path]. */
  async _pick_saved_pattern() {
    if (!this._load_pattern_library().length) {
      this._set_status(this._tr("patlib_empty"), true);
      return [null, null];
    }
    let chosen = null;
    const res = await dialog(this._tr("patlib_title"), (body, close) => {
      const grid = h("div", { class: "thumb-grid" });
      const fill = async () => {
        clear(grid);
        for (const e of this._load_pattern_library()) {
          const img = await loadImageFile(e.path);
          if (!img) continue;
          const thumb = h("img", { class: "thumb", src: pngDataUrl(img.rgba, img.w, img.h), title: e.name || "" });
          const cell = h("div", { class: "thumb-cell" + (chosen && chosen.path === e.path ? " selected" : "") }, thumb,
            h("div", { class: "thumb-label", text: e.name || "" }));
          cell.addEventListener("click", () => {
            chosen = { path: e.path, img };
            for (const c of grid.children) c.classList.toggle("selected", c === cell);
          });
          cell.addEventListener("dblclick", () => {
            chosen = { path: e.path, img };
            close(true);
          });
          grid.appendChild(cell);
        }
      };
      const del = Button(this._tr("patlib_delete"), {
        onClick: async () => {
          if (!chosen) return;
          this._save_pattern_library(this._load_pattern_library().filter((e) => e.path !== chosen.path));
          chosen = null;
          await fill();
        },
      });
      body.append(grid, row(del));
      fill();
    }, [{ label: this._tr("cancel"), value: false }, { label: this._tr("ok"), value: true, variant: "cta" }], { width: 430, height: 380 });
    if (!res || !chosen) return [null, null];
    return [chosen.img, chosen.path];
  },

  async _pick_outline_saved() {
    const [img, path] = await this._pick_saved_pattern();
    if (!img) return;
    this._outline_pattern_path = path;
    this._outline_pattern_ps_name = "";
    this._outline_pattern_img = img;
    this._update_outline_pattern_btn();
    this._update_text_preview();
  },

  async _pick_fill_saved() {
    const [img, path] = await this._pick_saved_pattern();
    if (!img) return;
    this._fill_pattern_path = path;
    this._fill_pattern_ps_name = "";
    this._fill_pattern_img = img;
    this._fill_pattern_stretch = false;
    this._fill_pattern_grad_spec = null;
    this._update_fill_pattern_btn();
    this._update_text_preview();
  },

  // -- fill the selection --------------------------------------------------------------------

  async _fill_selection_with_pattern(tile, stretch = false, gradSpec = null) {
    const [ok, key] = await fillSelection(tile, {
      stretch, gradSpec, scale: this.fill_pattern_scale_spin.num(), layerName: this._tr("sel_pattern_layer"),
    });
    this._set_status(this._tr(key), !ok);
  },

  _fill_selection_current() {
    const img = this._ensure_fill_pattern_img();
    if (!img) {
      this._set_status(this._tr("fill_pattern_pick"), true);
      return;
    }
    this._fill_selection_with_pattern(img, this._fill_pattern_stretch, this._fill_pattern_grad_spec);
  },

  // -- the pattern generator (patterngen.PatternGeneratorDialog) ------------------------------------

  _generate_fill_pattern() {
    this._run_pattern_generator(this._color, "fill");
  },

  _generate_outline_pattern() {
    this._run_pattern_generator(this._outline_color, "outline");
  },

  _run_pattern_generator(fg, target) {
    const t = (k) => {
      const s = this._tr(k);
      return s;
    };
    const prevState = target === "fill"
      ? [this._fill_pattern_path, this._fill_pattern_ps_name, this._fill_pattern_img]
      : [this._outline_pattern_path, this._outline_pattern_ps_name, this._outline_pattern_img];
    if (this._patgen_dlg) this._patgen_dlg.close();
    let fgc = fg || "#000000";
    let bgc = "#ffffff";
    const live = (tile) => {
      if (target === "fill") this._fill_pattern_img = tile;
      else this._outline_pattern_img = tile;
      this._update_text_preview();
    };
    const kind = Select([...PATTERN_KINDS, "smooth"].map((k) => ({ label: t("patgen_" + k), value: k })), { onChange: () => update() });
    const fgBtn = ColorButton(t("patgen_fg"), { color: fgc, pick: (c) => this._pick_color(c, t("patgen_fg")), onChange: (c) => { fgc = c; update(); } });
    const bgBtn = ColorButton(t("patgen_bg"), { color: bgc, pick: (c) => this._pick_color(c, t("patgen_bg")), onChange: (c) => { bgc = c; update(); } });
    const transparent = Check(t("patgen_transparent"), { onChange: () => update() });
    const size = NumberField({ min: 1, max: 200, value: 6, onChange: () => update() });
    const gap = NumberField({ min: 0, max: 200, value: 8, onChange: () => update() });
    const gradient = Check(t("patgen_gradient"), { onChange: () => update() });
    const dir = Select([["→", 0], ["↘", 45], ["↓", 90], ["↙", 135], ["←", 180], ["↖", 225], ["↑", 270], ["↗", 315]]
      .map(([l, a]) => ({ label: l, value: a })), { onChange: () => update() });
    const pv = h("img", { class: "patgen-preview" });
    const isGradient = () => gradient.isChecked();
    const gradSpec = () => (isGradient() ? {
      kind: kind.value(), fg: fgc, bg: transparent.isChecked() ? null : bgc, size: size.num(), gap: gap.num(), angleDeg: dir.value() || 0,
    } : null);
    const currentTile = () => {
      const bg = transparent.isChecked() ? null : bgc;
      if (isGradient()) return makePatternGradient(kind.value(), fgc, bg, size.num(), gap.num(), dir.value() || 0);
      return makePattern(kind.value() === "smooth" ? "dots" : kind.value(), fgc, bg, size.num(), gap.num());
    };
    let tileNow = null;
    const update = () => {
      const grad = isGradient();
      dir.setEnabled(grad);
      const smooth = grad && kind.value() === "smooth";
      size.setEnabled(!smooth);
      gap.setEnabled(!smooth);
      bgBtn.setEnabled(!transparent.isChecked());
      tileNow = currentTile();
      const W = 220;
      const H = 120;
      const bgPix = checker(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sx;
          let sy;
          if (grad) {
            sx = Math.min(tileNow.w - 1, Math.floor(x * tileNow.w / W));
            sy = Math.min(tileNow.h - 1, Math.floor(y * tileNow.h / H));
          } else {
            sx = x % tileNow.w;
            sy = y % tileNow.h;
          }
          const s = (sy * tileNow.w + sx) * 4;
          const d = (y * W + x) * 4;
          const a = tileNow.rgba[s + 3] / 255;
          for (let c = 0; c < 3; c++) bgPix[d + c] = Math.round(tileNow.rgba[s + c] * a + bgPix[d + c] * (1 - a));
          bgPix[d + 3] = 255;
        }
      }
      pv.src = pngDataUrl(bgPix, W, H);
      live(tileNow);
    };
    const finish = async (accepted) => {
      if (accepted && tileNow) {
        const path = await this._save_generated_pattern(tileNow);
        if (target === "fill") {
          this._fill_pattern_img = tileNow;
          this._fill_pattern_path = path;
          this._fill_pattern_ps_name = "";
          this._fill_pattern_stretch = isGradient();
          this._fill_pattern_grad_spec = gradSpec();
          this._update_fill_pattern_btn();
        } else {
          this._outline_pattern_img = tileNow;
          this._outline_pattern_path = path;
          this._outline_pattern_ps_name = "";
          this._update_outline_pattern_btn();
        }
      } else if (target === "fill") {
        [this._fill_pattern_path, this._fill_pattern_ps_name, this._fill_pattern_img] = prevState;
        this._update_fill_pattern_btn();
      } else {
        [this._outline_pattern_path, this._outline_pattern_ps_name, this._outline_pattern_img] = prevState;
        this._update_outline_pattern_btn();
      }
      this._update_text_preview();
      this._patgen_dlg = null;
    };
    let accepted = false;
    const win = modeless(t("patgen_title"), (body, close) => {
      body.append(
        row(h("span", { class: "lbl", text: t("patgen_kind") }), kind),
        row(fgBtn, bgBtn), transparent,
        row(label(t("patgen_size")), size, label(t("patgen_gap")), gap),
        row(gradient, dir), pv,
        Button(t("patgen_apply_sel"), { onClick: () => this._fill_selection_with_pattern(tileNow, isGradient(), gradSpec()) }),
        Button(t("patgen_save"), { onClick: () => this._save_pattern_to_library(tileNow) }),
        row(h("span", { class: "grow" }),
          Button(this._tr("cancel"), { onClick: () => close() }),
          Button(this._tr("ok"), { variant: "cta", onClick: () => { accepted = true; close(); } })));
    }, { onClose: () => finish(accepted) });
    this._patgen_dlg = win;
    update();
  },

  // -- text types ----------------------------------------------------------------------------------------

  _tt_overrides() {
    const d = T.get("ttFonts", {});
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  },

  _save_tt_overrides(d) {
    T.set("ttFonts", d || {});
  },

  _load_custom_types() {
    const d = T.get("ttCustom", []);
    return Array.isArray(d) ? d : [];
  },

  _save_custom_types(types) {
    T.set("ttCustom", types || []);
  },

  _tt_label(tid) {
    return TT.label(tid) || this._tr("tt_" + tid);
  },

  _rebuild_text_type_combo() {
    const prevVal = this.text_type_combo.value();
    this.text_type_combo.setItems([{ label: this._tr("tt_none"), value: "" }, ...TT.ids().map((tid) => ({ label: this._tt_label(tid), value: tid }))], false);
    if (!this.text_type_combo.setValue(prevVal)) this.text_type_combo.setIndex(0);
  },

  _add_custom_type(lbl, font, style = null) {
    lbl = (lbl || "").trim();
    if (!lbl) return null;
    const types = this._load_custom_types();
    const entry = { label: lbl, font: (font || "").trim() };
    if (style && typeof style === "object" && Object.keys(style).length) entry.style = style;
    types.push(entry);
    const registered = TT.registerCustom(types);
    this._save_custom_types(registered);
    this._rebuild_text_type_combo();
    return registered.length ? registered[registered.length - 1].id : null;
  },

  _remove_custom_type(tid) {
    const types = this._load_custom_types().filter((e) => e.id !== tid);
    const registered = TT.registerCustom(types);
    this._save_custom_types(registered);
    const ov = this._tt_overrides();
    if (tid in ov) {
      delete ov[tid];
      this._save_tt_overrides(ov);
    }
    this._rebuild_text_type_combo();
  },

  _installed_families() {
    try {
      return psFamilies();
    } catch (e) {
      return [];
    }
  },

  _on_text_type_changed() {
    const tid = this.text_type_combo.value() || "";
    if (!tid) {
      this.text_type_hint.textContent = "";
      return;
    }
    const want = TT.missingFont(tid, this._installed_families(), this._tt_overrides());
    this.text_type_hint.textContent = want ? this._tr("tt_missing_font", { font: want }) : "";
  },

  on_text_type_apply() {
    const tid = this.text_type_combo.value() || "";
    if (!tid) {
      this._set_status(this._tr("st_tt_pick"), true);
      return;
    }
    const style = TT.styleFor(tid, this._installed_families(), this._tt_overrides());
    if (!style) return;
    this._apply_preset(style);
    this._set_status(this._tr("st_tt_applied", { name: this._tt_label(tid) }));
  },
};
