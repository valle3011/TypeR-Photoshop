// The Setup tab: general settings, fonts per text type (+ missing fonts),
// Google account, layout & sizes, the Experimental section — and, new in the
// Photoshop port, Diagnostics (measuring self-test + calibration).
//
// Port of the Setup parts of TyperDocker.__init__, _show_missing_fonts,
// TextTypeFontsDialog, the view methods (_view_defaults … _on_view_reset)
// and the _on_enable_* switches.

import { h, clear, show, row, hint, hline, Button, Check, Select, TextField, NumberField, Collapsible,
  dialog, promptBox, chooseBox } from "./dom.js";
import { FontPicker } from "./widgets.js";
import { LANG_ORDER } from "./i18n.js";
import { BUBBLR_LOCKED } from "./app.js";
import { T } from "../host/settings.js";
import { docInfo } from "../host/ps.js";
import { hasImaging } from "../host/pixels.js";
import { calibrate, selfTest, forgetFaces } from "../host/measure.js";
import { families as psFamilies } from "../host/fonts.js";
import { FontIndex } from "../core/fontmatch.js";
import * as TT from "../core/texttypes.js";

const VIEW_DEFAULTS = {
  open: false,
  preview_show: true, preview_h: 120,
  editor_show: true, editor_h: 200,
  table_show: true, table_h: 240,
  fonts_show: true, fonts_h: 160,
  bubblr_show: true, bubblr_h: 280,
  bmap_show: true, bmap_h: 160,
};

/** Pick a font family in a dialog (Qt's QFontDialog.getFont). */
export async function pickFamily(app, title, initial = "") {
  let picker;
  const ok = await dialog(title, (body) => {
    picker = new FontPicker({ recents: app.font_picker ? app.font_picker.recents() : [], placeholder: app._tr("font_search_ph") });
    picker.setListHeight(260);
    if (initial) picker.setCurrentFamily(initial);
    body.appendChild(picker.el);
  }, [{ label: app._tr("cancel"), value: false }, { label: app._tr("ok"), value: true, variant: "cta" }], { width: 380, height: 460 });
  return ok ? picker.currentFamily() : null;
}

export const SetupTabMethods = {
  _collapsible(parent, key, defaultOpen = true) {
    const c = Collapsible("", T.bool(key, defaultOpen), (on) => T.setBool(key, on));
    parent.appendChild(c);
    return c;
  },

  _build_setup_tab() {
    const t = (k, f) => this._tr(k, f);
    const lay = this.tabs.layouts.setup;

    // --- general ---------------------------------------------------------------
    const sg = this._new_panel("setup_general", "setup");
    this.setup_general_toggle = this._collapsible(sg.body, "setupGeneralOpen");
    const g = this.setup_general_toggle.body;
    this.lang_label = h("span", { class: "lbl" });
    this.lang_combo = Select(LANG_ORDER.map(([code, name]) => ({ label: name, value: code })), {
      onChange: (code) => this._onLangChange(code),
    });
    this.lang_combo.setValue(this._lang);
    this.replace_chk = Check("", { checked: T.bool("replaceExisting", true), onChange: (on) => T.setBool("replaceExisting", on) });
    this.by_char_chk = Check("", { checked: T.bool("presetsByCharacter", true), onChange: (on) => this._on_by_char_toggle(on) });
    this.main_chars_btn = Button("", { onClick: () => this.on_main_chars() });
    this.main_chars_hint = hint();
    g.append(row(this.lang_label, this.lang_combo), this.replace_chk, this.by_char_chk, this.main_chars_btn, this.main_chars_hint);
    this._rt(() => {
      this.setup_general_toggle.setTitle("⚙ " + t("setup_h_general"));
      this.lang_label.textContent = t("language");
      this.replace_chk.setText(t("replace_existing"));
      this.replace_chk.setTip(t("replace_existing_tip"));
      this.by_char_chk.setText(t("presets_by_char"));
      this.by_char_chk.setTip(t("presets_by_char_tip"));
      this.main_chars_btn.setText(t("mainchar_btn"));
      this.main_chars_hint.textContent = t("mainchar_hint");
    });

    // --- fonts per text type ----------------------------------------------------------
    const ttf = this._new_panel("tt_fonts", "setup");
    this.setup_fonts_toggle = this._collapsible(ttf.body, "setupFontsOpen");
    this.tt_fonts_hint = hint();
    this.tt_fonts_btn = Button("", { onClick: () => this.on_tt_fonts() });
    this.fav_missing_btn = Button("", { onClick: () => this._show_missing_fonts() });
    this.setup_fonts_toggle.body.append(this.tt_fonts_hint, this.tt_fonts_btn, this.fav_missing_btn);
    this._rt(() => {
      this.setup_fonts_toggle.setTitle("🅰 " + t("setup_h_fonts"));
      this.tt_fonts_hint.textContent = t("ttf_hint");
      this.tt_fonts_btn.setText(t("ttf_open"));
      this.fav_missing_btn.setText(t("missing_btn"));
    });

    // --- Google account ----------------------------------------------------------------------
    const gp = this._new_panel("google", "setup");
    this.setup_google_toggle = this._collapsible(gp.body, "setupGoogleOpen", false);
    const gl = this.setup_google_toggle.body;
    this.lbl_g_client = h("div", { class: "lbl" });
    this.g_client_edit = TextField({ value: this._g_client_id(), onBlur: (v) => T.set("gClientId", v.trim()), onEnter: (v) => T.set("gClientId", v.trim()) });
    this.g_sign_in_btn = Button("", { onClick: () => this.on_g_sign_in() });
    this.g_sign_out_btn = Button("", { onClick: () => this.on_g_sign_out() });
    this.g_status = h("div", {});
    this.g_hint = hint();
    this.lbl_g_image = h("div", { class: "lbl" });
    this.g_image_edit = TextField({});
    this.g_image_btn = Button("", { onClick: () => this.on_load_image_comments() });
    this.lbl_g_downloads = h("div", { class: "lbl" });
    this.g_downloads_edit = TextField({ value: String(T.get("downloadsDir", "") || ""), onBlur: (v) => T.set("downloadsDir", v.trim()) });
    gl.append(this.lbl_g_client, this.g_client_edit, row(this.g_sign_in_btn, this.g_sign_out_btn), this.g_status, this.g_hint,
      this.lbl_g_image, this.g_image_edit, this.g_image_btn, this.lbl_g_downloads, this.g_downloads_edit);
    this._rt(() => {
      this.setup_google_toggle.setTitle("🔑 " + t("setup_h_google"));
      this.lbl_g_client.textContent = t("g_client_label");
      this.g_client_edit.setPlaceholder(t("g_client_ph"));
      this.g_sign_in_btn.setText(t("g_sign_in"));
      this.g_sign_out_btn.setText(t("g_sign_out"));
      this.g_hint.textContent = t("g_hint");
      this.lbl_g_image.textContent = t("g_image_label");
      this.g_image_edit.setPlaceholder(t("g_image_ph"));
      this.g_image_btn.setText(t("g_image_btn"));
      this.lbl_g_downloads.textContent = t("g_downloads_label");
      this.g_downloads_edit.setPlaceholder(t("g_downloads_ph"));
      this._refresh_g_status();
    });

    // --- layout & sizes -------------------------------------------------------------------------------
    const lz = this._new_panel("layout_sizes", "setup");
    const v = { ...VIEW_DEFAULTS, ...(this._load_view()) };
    this.view_toggle = Collapsible("", !!v.open, () => this._save_view());
    lz.body.appendChild(this.view_toggle);
    this.view_hint = hint();
    const grid = h("div", { class: "grid2" });
    const viewRow = (chkAttr, spinAttr, lo, hi, val, on) => {
      this[chkAttr] = Check("", { checked: !!on, onChange: () => this._on_view_changed() });
      this[spinAttr] = NumberField({ min: lo, max: hi, step: 10, value: Math.trunc(val), suffix: " px", onChange: () => this._on_view_changed() });
      grid.append(this[chkAttr], this[spinAttr]);
    };
    viewRow("v_preview_chk", "v_preview_h", 40, 1200, v.preview_h, v.preview_show);
    viewRow("v_editor_chk", "v_editor_h", 40, 1200, v.editor_h, v.editor_show);
    viewRow("v_table_chk", "v_table_h", 60, 1600, v.table_h, v.table_show);
    viewRow("v_fonts_chk", "v_fonts_h", 40, 1200, v.fonts_h, v.fonts_show);
    viewRow("v_bubblr_chk", "v_bubblr_h", 80, 1600, v.bubblr_h, v.bubblr_show);
    viewRow("v_bmap_chk", "v_bmap_h", 60, 1600, v.bmap_h, v.bmap_show);
    this.view_reset_btn = Button("", { onClick: () => this._on_view_reset() });
    this.view_toggle.body.append(this.view_hint, grid, this.view_reset_btn);
    this._rt(() => {
      this.view_toggle.setTitle(t("view_toggle"));
      this.view_hint.textContent = t("view_hint");
      this.v_preview_chk.setText(t("view_preview"));
      this.v_editor_chk.setText(t("view_editor"));
      this.v_table_chk.setText(t("view_table"));
      this.v_fonts_chk.setText(t("view_fonts"));
      this.v_bubblr_chk.setText(t("view_bubblr"));
      this.v_bmap_chk.setText(t("view_bmap"));
      this.view_reset_btn.setText(t("view_reset"));
    });

    // --- diagnostics (Photoshop port) -------------------------------------------------------------------
    const dg = this._new_panel("diagnostics", "setup");
    this.diag_toggle = this._collapsible(dg.body, "setupDiagOpen", false);
    this.diag_hint = hint();
    this.diag_fonts_lbl = h("div", { class: "lbl" });
    this.diag_fonts_edit = TextField({ value: String(T.get("diagFonts", "") || "") });
    this.diag_run_btn = Button("", { onClick: () => this.on_diag_run() });
    this.diag_cal_btn = Button("", { onClick: () => this.on_diag_calibrate() });
    this.diag_out = h("pre", { class: "diag-out" });
    this.diag_toggle.body.append(this.diag_hint, this.diag_fonts_lbl, this.diag_fonts_edit, row(this.diag_run_btn, this.diag_cal_btn), this.diag_out);
    this._rt(() => {
      this.diag_toggle.setTitle("🩺 " + t("diag_title"));
      this.diag_hint.textContent = t("diag_hint");
      this.diag_fonts_lbl.textContent = t("diag_fonts");
      this.diag_run_btn.setText(t("diag_run"));
      this.diag_cal_btn.setText(t("diag_calibrate"));
    });

    // --- Experimental (not a panel, like Krita) ------------------------------------------------------------
    this.exp_toggle = Collapsible("", T.bool("expOpen", false), (on) => T.setBool("expOpen", on));
    lay.appendChild(this.exp_toggle);
    const ex = this.exp_toggle.body;
    const en = (attr, key, dflt, fn) => {
      this[attr] = Check("", { checked: T.bool(key, dflt), onChange: (on) => fn(on, true) });
      ex.appendChild(this[attr]);
    };
    en("enable_bubblr_chk", "enableBubblr", true, (on, s) => this._on_enable_bubblr(on, s));
    if (BUBBLR_LOCKED) {
      this.enable_bubblr_chk.setChecked(false);
      show(this.enable_bubblr_chk, false);
    }
    en("enable_batch_chk", "enableBatch", true, (on, s) => this._on_enable("batch", "enableBatch", on, s));
    en("enable_shapr_chk", "enableShapr", true, (on, s) => this._on_enable("shapr", "enableShapr", on, s));
    en("enable_sfx_chk", "enableSfx", true, (on, s) => this._on_enable("sfx", "enableSfx", on, s));
    en("enable_fonts_chk", "enableFonts", true, (on, s) => this._on_enable("fonts", "enableFonts", on, s));
    en("enable_balloon_chk", "enableBalloon", false, (on, s) => this._on_enable_balloon(on, s));
    en("enable_patterns_chk", "enablePatterns", false, (on, s) => this._on_enable_patterns(on, s));
    en("enable_texttypes_chk", "enableTextTypes", false, (on, s) => this._on_enable_texttypes(on, s));
    ex.appendChild(hline());
    this.customize_chk = Check("", { checked: T.bool("customize", false), onChange: (on) => this._on_customize_toggle(on) });
    this.customize_hint = hint();
    show(this.customize_hint, this.customize_chk.isChecked());
    // UXP has no draggable tab bar: tabs move with ◀ / ▶ in customize mode
    this.tab_move_combo = Select([], {});
    this.tab_move_row = row(this.tab_move_combo,
      Button("◀", { onClick: () => this._move_tab(-1) }), Button("▶", { onClick: () => this._move_tab(1) }));
    show(this.tab_move_row, this.customize_chk.isChecked());
    this.layout_reset_btn = Button("", { onClick: () => this.on_layout_reset() });
    ex.append(this.customize_chk, this.customize_hint, this.tab_move_row, this.layout_reset_btn);
    this._rt(() => {
      this.exp_toggle.setTitle("⚗ " + t("exp_section"));
      this.enable_bubblr_chk.setText(t("enable_bubblr"));
      this.enable_batch_chk.setText(t("enable_batch"));
      this.enable_batch_chk.setTip(t("enable_batch_tip"));
      this.enable_shapr_chk.setText(t("enable_shapr"));
      this.enable_sfx_chk.setText(t("enable_sfx"));
      this.enable_fonts_chk.setText(t("enable_fonts"));
      this.enable_balloon_chk.setText(t("enable_balloon"));
      this.enable_balloon_chk.setTip(t("enable_balloon_tip"));
      this.enable_patterns_chk.setText(t("enable_patterns"));
      this.enable_texttypes_chk.setText(t("enable_texttypes"));
      this.customize_chk.setText(t("customize_layout"));
      this.customize_hint.textContent = t("customize_hint");
      this.layout_reset_btn.setText(t("layout_reset"));
      this._refresh_tab_move_combo();
    });
  },

  _refresh_tab_move_combo() {
    if (!this.tab_move_combo) return;
    this.tab_move_combo.setItems(this.tabs.order.map((id) => ({ label: this.tabs.label(id), value: id })));
  },

  _move_tab(delta) {
    const id = this.tab_move_combo.value();
    if (!id) return;
    this.tabs.move(id, delta);
    this._refresh_tab_move_combo();
    this.tab_move_combo.setValue(id);
  },

  // -- enable switches ---------------------------------------------------------------

  _on_enable_bubblr(on, save = true) {
    this._on_enable("bubblr", "enableBubblr", on && !BUBBLR_LOCKED, save);
  },

  _on_enable_balloon(on, save = true) {
    if (!on && "balloon" in this._detached) this._reattach_panel("balloon");
    this._sync_gated_panels();
    if (save) T.setBool("enableBalloon", on);
  },

  _on_enable_patterns(on, save = true) {
    show(this._style_pattern_box, on);
    this._sync_gated_panels();
    if (save) T.setBool("enablePatterns", on);
    this._update_text_preview();
  },

  _on_enable_texttypes(on, save = true) {
    this._sync_gated_panels();
    if (save) T.setBool("enableTextTypes", on);
  },

  // -- view (sizes + show/hide) ---------------------------------------------------------

  _load_view() {
    const d = T.get("view", {});
    return d && typeof d === "object" ? d : {};
  },

  _save_view() {
    T.set("view", {
      open: this.view_toggle.isOpen(),
      preview_show: this.v_preview_chk.isChecked(), preview_h: this.v_preview_h.num(),
      editor_show: this.v_editor_chk.isChecked(), editor_h: this.v_editor_h.num(),
      table_show: this.v_table_chk.isChecked(), table_h: this.v_table_h.num(),
      fonts_show: this.v_fonts_chk.isChecked(), fonts_h: this.v_fonts_h.num(),
      bubblr_show: this.v_bubblr_chk.isChecked(), bubblr_h: this.v_bubblr_h.num(),
      bmap_show: this.v_bmap_chk.isChecked(), bmap_h: this.v_bmap_h.num(),
    });
  },

  _apply_view() {
    if (!this.preview) return;
    const pv = this.v_preview_chk.isChecked();
    show(this.lbl_preview, pv);
    show(this.preview.el, pv);
    this.preview.setHeight(this.v_preview_h.num());
    this.v_preview_h.setEnabled(pv);
    const ev = this.v_editor_chk.isChecked();
    show(this.lbl_script, ev);
    show(this.editor, ev);
    this.editor.style.height = `${this.v_editor_h.num()}px`;
    this.v_editor_h.setEnabled(ev);
    const tv = this.v_table_chk.isChecked();
    show(this.lbl_align, tv);
    show(this.table_wrap, tv);
    this.table_wrap.style.minHeight = `${this.v_table_h.num()}px`;
    this.v_table_h.setEnabled(tv);
    const fv = this.v_fonts_chk.isChecked();
    show(this.lbl_font, fv);
    show(this.font_picker.el, fv);
    this.font_picker.setListHeight(this.v_fonts_h.num());
    this.v_fonts_h.setEnabled(fv);
    // the page views fill their panel (resize the panel in customize mode)
    for (const ov of this._bp_overlays || []) show(ov.el, this.v_bubblr_chk.isChecked());
    this.v_bubblr_h.setEnabled(false);
    this.v_bmap_h.setEnabled(false);
  },

  _on_view_changed() {
    this._apply_view();
    this._save_view();
  },

  _on_view_reset() {
    const d = VIEW_DEFAULTS;
    this.v_preview_chk.setChecked(d.preview_show);
    this.v_preview_h.setNum(d.preview_h);
    this.v_editor_chk.setChecked(d.editor_show);
    this.v_editor_h.setNum(d.editor_h);
    this.v_table_chk.setChecked(d.table_show);
    this.v_table_h.setNum(d.table_h);
    this.v_fonts_chk.setChecked(d.fonts_show);
    this.v_fonts_h.setNum(d.fonts_h);
    this.v_bubblr_chk.setChecked(d.bubblr_show);
    this.v_bubblr_h.setNum(d.bubblr_h);
    this.v_bmap_chk.setChecked(d.bmap_show);
    this.v_bmap_h.setNum(d.bmap_h);
    this._apply_view();
    this._save_view();
  },

  // -- fonts per text type (TextTypeFontsDialog) ------------------------------------------

  async on_tt_fonts() {
    const t = (k, f) => this._tr(k, f);
    const installed = this._installed_families();
    let ov = { ...this._tt_overrides() };
    await dialog(t("ttf_title"), (body) => {
      const grid = h("div", { class: "ttf-grid" });
      let resetAll;
      const refresh = () => {
        clear(grid);
        for (const tid of TT.ids()) {
          const own = ov[tid];
          const fam = TT.effectiveFont(tid, installed, ov);
          const val = h("span", { class: own ? "" : "muted", text: own ? fam : t("ttf_default", { font: fam }) });
          const pick = Button(t("ttf_choose"), {
            onClick: async () => {
              const f = await pickFamily(this, t("ttf_pick_for", { name: this._tt_label(tid) }), fam);
              if (f) {
                ov[tid] = f;
                refresh();
              }
            },
          });
          let extra;
          if (TT.isCustom(tid)) {
            extra = Button(t("ttf_remove"), {
              tip: t("ttf_remove_tip"),
              onClick: () => {
                this._remove_custom_type(tid);
                delete ov[tid];
                refresh();
              },
            });
          } else {
            extra = Button(t("ttf_reset_one"), {
              tip: t("ttf_reset_one_tip"),
              onClick: () => {
                delete ov[tid];
                refresh();
              },
            });
            extra.setEnabled(!!own);
          }
          grid.append(h("span", { class: "lbl", text: this._tt_label(tid) }), val, pick, extra);
        }
        if (resetAll) resetAll.setEnabled(Object.values(ov).some((x) => x));
      };
      const add = Button(t("ttf_add"), {
        tip: t("ttf_add_tip"),
        onClick: async () => {
          let name = await promptBox(t("ttf_add"), t("ttf_add_name"), "");
          if (name === null || !name.trim()) return;
          name = name.trim();
          const choice = await chooseBox(t("ttf_add"), t("ttf_add_style_q"), [t("ttf_add_default"), t("ttf_add_current")], t("ok"), t("cancel"));
          if (choice === null || choice === undefined) return;
          if (choice === 1) {
            const style = this._collect_preset();
            const font = style.font || "";
            delete style.font;
            this._add_custom_type(name, font, style);
          } else {
            const f = await pickFamily(this, t("ttf_add"), installed[0] || "");
            this._add_custom_type(name, f || "");
          }
          refresh();
        },
      });
      resetAll = Button(t("ttf_reset_all"), {
        onClick: () => {
          ov = {};
          refresh();
        },
      });
      body.append(hint(t("ttf_intro")), grid, row(add, resetAll));
      refresh();
    }, [{ label: t("ttf_close"), value: true, variant: "cta" }], { width: 540, height: 520 });
    this._save_tt_overrides(Object.fromEntries(Object.entries(ov).filter(([, x]) => x)));
    this._on_text_type_changed();
  },

  // -- missing fonts report --------------------------------------------------------------------

  _font_index() {
    return new FontIndex(this._installed_families());
  },

  _missing_of(fonts) {
    return [...this._font_index().missing(this._dedup_ci(fonts))].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  },

  _all_referenced_fonts() {
    return [...this._favorite_fonts(), ...this._sfx_fonts(), ...this._main_preset_fonts()];
  },

  async _show_missing_fonts() {
    const t = (k, f) => this._tr(k, f);
    await dialog(t("missing_title"), (body) => {
      const menu = h("div", { class: "stack" });
      const page = h("div", { class: "stack" });
      const head = h("div", { class: "wrap" });
      const list = h("div", { class: "scroll-list" });
      const back = Button(t("missing_back"), {
        onClick: () => {
          show(page, false);
          show(menu, true);
        },
      });
      page.append(head, list, back);
      const showList = (title, fonts) => {
        const ref = this._dedup_ci(fonts);
        const [, renamed, missing] = this._font_index().report(ref);
        head.textContent = t("missing_head", { title, have: this._installed_families().length, ref: ref.length, missing: missing.length });
        clear(list);
        for (const [wanted, m] of [...renamed].sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1))) {
          list.appendChild(h("div", { class: "list-row", text: `${wanted}  →  ${m.family}` }));
        }
        if (missing.length) {
          for (const f of missing) list.appendChild(h("div", { class: "list-row", text: f }));
        } else if (!renamed.length) {
          list.appendChild(h("div", { class: "list-row muted", text: t("missing_none_line") }));
        }
        show(menu, false);
        show(page, true);
      };
      menu.append(hint(t("missing_intro")),
        Button(t("missing_fav"), { onClick: () => showList(t("missing_fav"), this._favorite_fonts()) }),
        Button(t("missing_sfx"), { onClick: () => showList(t("missing_sfx"), this._sfx_fonts()) }),
        Button(t("missing_all"), { onClick: () => showList(t("missing_all"), this._all_referenced_fonts()) }));
      show(page, false);
      body.append(menu, page);
    }, [{ label: t("close"), value: true, variant: "cta" }], { width: 380, height: 440 });
  },

  // -- diagnostics --------------------------------------------------------------------------------

  async on_diag_run() {
    const t = (k, f) => this._tr(k, f);
    if (!docInfo()) {
      this.diag_out.textContent = t("diag_need_doc");
      return;
    }
    let fams = this.diag_fonts_edit.text().split(",").map((s) => s.trim()).filter((s) => s);
    if (!fams.length && this.font_picker.currentFamily()) fams = [this.font_picker.currentFamily()];
    T.set("diagFonts", fams.join(", "));
    this.diag_out.textContent = t("diag_running");
    const lines = [this.versionLine(), t("diag_imaging", { state: hasImaging() ? t("diag_ok") : t("diag_fail") })];
    const res = await selfTest(fams);
    let allOk = true;
    for (const r of res) {
      allOk = allOk && r.ok;
      if (r.note) lines.push(`${r.ok ? t("diag_ok") : t("diag_fail")}  ${r.family}: ${r.note}`);
      else lines.push(`${r.ok ? t("diag_ok") : t("diag_fail")}  ${r.family}: ${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(2)} %  (raw ${r.raw.toFixed(2)} %)`);
    }
    this.diag_out.textContent = lines.join("\n");
    this.forgetMeasuring();
    this._set_status(allOk ? t("diag_ok") : t("diag_fail"), !allOk);
  },

  async on_diag_calibrate() {
    const t = (k, f) => this._tr(k, f);
    const fam = this.font_picker.currentFamily();
    if (!docInfo()) {
      this._set_status(t("diag_need_doc"), true);
      return;
    }
    if (!fam) {
      this._set_status(t("st_no_font"), true);
      return;
    }
    this._set_status(t("measuring"));
    const cal = await calibrate(fam, this.bold_chk.isChecked(), this.italic_chk.isChecked());
    forgetFaces();
    this.forgetMeasuring();
    if (!cal) {
      this._set_status(t("st_no_faces", { font: fam }), true);
      return;
    }
    this._set_status(t("diag_calibrated", { font: fam, w: cal.width.toFixed(4), s: cal.height.toFixed(4) }));
  },
};
