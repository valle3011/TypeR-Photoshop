// The TypeR panel controller — port of TyperDocker (typer_kr.py).
//
// State and behaviour live here (and in the mixins imported below, one per
// area, each a port of the corresponding TyperDocker methods); the widgets
// are attributes named like the Qt original (this.size_spin, this.font_picker
// …) so the port can be read side by side with the Krita code.

import { h, show, debounce } from "./dom.js";
import { tr, setLang, lang } from "./i18n.js";
import { T } from "../host/settings.js";
import { docInfo, hasPhotoshop, psVersion, selectionBounds, uxp } from "../host/ps.js";
import { insertTextLayer } from "../host/insert.js";
import { measuringEnv } from "../host/measure.js";
import * as LP from "../core/langpair.js";
import * as L from "../core/layout.js";
import * as TT from "../core/texttypes.js";
import { prepareText } from "../core/textprep.js";

export const VERSION = "2.0.5";

// BubblR (AI detection) is locked unless a `bubblr_dev` marker file sits in
// the plugin folder — exactly like the Krita build (see FEATURES.md).
export let BUBBLR_LOCKED = true;
export function setBubblrLocked(on) {
  BUBBLR_LOCKED = !!on;
}

export class TypeR {
  constructor(root) {
    this.root = root;
    // --- script state (mirrors the active session) ---
    this._pairs = [];
    this._pair_pages = [];
    this._pages = [];
    this._index = 0;
    this._done = new Set();
    this._script_path = "";
    this._script_comments = [];
    // --- colours ---
    this._color = "#000000";
    this._outline_color = "#ffffff";
    this._outline2_color = "#000000";
    this._shadow_color = "#000000";
    this._style_soft_color = "#000000";
    // --- patterns (tiles {w,h,rgba}) ---
    this._outline_pattern_path = "";
    this._outline_pattern_ps_name = "";
    this._outline_pattern_img = null;
    this._fill_pattern_path = "";
    this._fill_pattern_ps_name = "";
    this._fill_pattern_img = null;
    this._fill_pattern_stretch = false;
    this._fill_pattern_grad_spec = null;
    // --- presets ---
    this._lang = this._loadLang();
    setLang(this._lang);
    this._groups = {};
    this._group = "";
    this._char = "";
    this._preset_usage = {};
    this._main_chars_map = {};
    this._keybinds = {};
    // --- sessions ---
    this._sessions = [];
    this._active_sid = null;
    this._next_sid = 1;
    // --- BubblR / batch (one box list, several views) ---
    this._bp_boxes = [];
    this._bp_click_seq = [];
    this._bp_current = -1;
    this._bp_placed = new Set();
    this._bp_assign = [];
    this._bp_run = null;
    this._bp_last_units = [];
    this._bp_style = [];
    this._bp_overlays = [];
    this._bp_mode_btns = {};
    this._bp_page_thumb = null;
    this._last_insert_px = null;
    // --- panels ---
    this._panels = {};
    this._panel_tab = {};
    this._panel_home = {};
    this._detached = {};
    this._menv = new Map();             // family|ligatures -> measuring env (promise)
    this.status = null;
  }

  // -- language ---------------------------------------------------------------

  _tr(key, fmt = null) {
    return tr(key, fmt);
  }

  _loadLang() {
    const v = T.get("uiLang", "");
    return ["en", "de", "es", "fr", "pt", "it"].includes(v) ? v : "en";
  }

  _saveLang() {
    T.set("uiLang", this._lang);
  }

  _onLangChange(code) {
    this._lang = code || "en";
    setLang(this._lang);
    this._saveLang();
    this._retranslate();
    this._refresh_view();
  }

  // -- status line ------------------------------------------------------------

  _set_status(msg, error = false) {
    if (!this.status) return;
    this.status.textContent = msg;
    this.status.classList.toggle("error", !!error);
  }

  // -- style snapshot (settings key "settings", same keys as Krita) ------------

  _collect_settings() {
    return {
      size: this.size_spin.num(),
      pad: this.pad_spin.num(),
      spacing: this.spacing_spin.num(),
      auto: this.auto_chk.isChecked(),
      round: this.round_chk.isChecked(),
      vertical: this.vertical_chk.isChecked(),
      outline: this.outline_chk.isChecked(),
      outline_w: this.outline_spin.num(),
      outline2_w: this.outline2_spin.num(),
      bold: this.bold_chk.isChecked(),
      italic: this.italic_chk.isChecked(),
      underline: this.underline_chk.isChecked(),
      ligatures: this.liga_chk.isChecked(),
      align: this.align_combo.value() || "center",
      valign: this.valign_combo.value() || "middle",
      case: this.case_combo.value() || "none",
      tidy: this.tidy_chk.isChecked(),
      comic: this.comic_chk.isChecked(),
      crossbar_i: this.crossbar_chk.isChecked(),
      color: this._color,
      outline_color: this._outline_color,
      outline2_color: this._outline2_color,
      shadow: this.shadow_chk.isChecked(),
      shadow_x: this.shadow_x_spin.num(),
      shadow_y: this.shadow_y_spin.num(),
      shadow_color: this._shadow_color,
      hyphenate: this.hyph_chk.isChecked(),
      hyph_lang: this.hyph_lang_combo.value() || "auto",
      outline_pattern_path: this._outline_pattern_path,
      outline_pattern_krita: this._outline_pattern_ps_name,
      outline_pattern_scale: this.outline_pattern_scale_spin.num(),
      outline_pattern_target: this.outline_pattern_target_combo.value() || "outline1",
      soft_outline: this.style_soft_chk.isChecked(),
      soft_outline_pattern: this.style_soft_pattern_chk.isChecked(),
      soft_outline_color: this._style_soft_color,
      soft_outline_w: this.style_soft_width_spin.num(),
      soft_outline_blur: this.style_soft_blur_spin.num(),
      fill_pattern_path: this._fill_pattern_path,
      fill_pattern_krita: this._fill_pattern_ps_name,
      fill_pattern_scale: this.fill_pattern_scale_spin.num(),
    };
  }

  _save_settings() {
    T.set("settings", this._collect_settings());
  }

  _apply_settings(d) {
    if (!d || typeof d !== "object" || !Object.keys(d).length) return;
    try {
      const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
      const int = (v) => Math.trunc(Number(v));
      if (has("size")) this.size_spin.setNum(int(d.size));
      if (has("pad")) this.pad_spin.setNum(int(d.pad));
      if (has("spacing")) this.spacing_spin.setNum(int(d.spacing));
      if (has("auto")) this.auto_chk.setChecked(!!d.auto);
      if (has("round")) this.round_chk.setChecked(!!d.round);
      if (has("vertical")) this.vertical_chk.setChecked(!!d.vertical);
      if (has("outline")) this.outline_chk.setChecked(!!d.outline);
      if (has("outline_w")) this.outline_spin.setNum(int(d.outline_w));
      if (has("outline2_w")) this.outline2_spin.setNum(int(d.outline2_w));
      if (has("bold")) this.bold_chk.setChecked(!!d.bold);
      if (has("italic")) this.italic_chk.setChecked(!!d.italic);
      if (has("underline")) this.underline_chk.setChecked(!!d.underline);
      if (has("ligatures")) this.liga_chk.setChecked(!!d.ligatures);
      if (["none", "upper", "lower"].includes(d.case)) this.case_combo.setValue(d.case);
      else if (has("caps")) this.case_combo.setValue(d.caps ? "upper" : "none");      // old presets
      if (has("tidy")) this.tidy_chk.setChecked(!!d.tidy);
      if (has("comic")) this.comic_chk.setChecked(!!d.comic);
      if (has("crossbar_i")) this.crossbar_chk.setChecked(!!d.crossbar_i);
      this.crossbar_chk.setEnabled(this.comic_chk.isChecked());
      if (["left", "center", "right"].includes(d.align)) this.align_combo.setValue(d.align);
      if (["top", "middle", "bottom"].includes(d.valign)) this.valign_combo.setValue(d.valign);
      if (has("color")) {
        this._color = normHex(d.color);
        this._update_color_btn();
      }
      if (has("outline_color")) {
        this._outline_color = normHex(d.outline_color);
        this._update_outline_btn();
      }
      if (has("outline2_color")) {
        this._outline2_color = normHex(d.outline2_color);
        this._update_outline2_btn();
      }
      if (has("outline_pattern_path") || has("outline_pattern_krita")) {
        this._outline_pattern_path = d.outline_pattern_path || "";
        this._outline_pattern_ps_name = d.outline_pattern_krita || "";
        this._outline_pattern_img = null;
        this._update_outline_pattern_btn();
      }
      if (has("outline_pattern_scale")) this.outline_pattern_scale_spin.setNum(int(d.outline_pattern_scale));
      if (has("outline_pattern_target")) this.outline_pattern_target_combo.setValue(d.outline_pattern_target);
      if (has("soft_outline_color")) {
        this._style_soft_color = normHex(d.soft_outline_color);
        this._update_style_soft_btn();
      }
      if (has("soft_outline_w")) this.style_soft_width_spin.setNum(int(d.soft_outline_w));
      if (has("soft_outline_blur")) this.style_soft_blur_spin.setNum(int(d.soft_outline_blur));
      if (has("soft_outline_pattern")) this.style_soft_pattern_chk.setChecked(!!d.soft_outline_pattern);
      if (has("soft_outline")) this.style_soft_chk.setChecked(!!d.soft_outline);
      this._update_soft_enabled();
      if (has("fill_pattern_path") || has("fill_pattern_krita")) {
        this._fill_pattern_path = d.fill_pattern_path || "";
        this._fill_pattern_ps_name = d.fill_pattern_krita || "";
        this._fill_pattern_img = null;
        this._update_fill_pattern_btn();
      }
      if (has("fill_pattern_scale")) this.fill_pattern_scale_spin.setNum(int(d.fill_pattern_scale));
      if (has("shadow")) this.shadow_chk.setChecked(!!d.shadow);
      if (has("shadow_x")) this.shadow_x_spin.setNum(int(d.shadow_x));
      if (has("shadow_y")) this.shadow_y_spin.setNum(int(d.shadow_y));
      if (has("shadow_color")) {
        this._shadow_color = normHex(d.shadow_color);
        this._update_shadow_btn();
      }
      if (has("hyphenate")) this.hyph_chk.setChecked(!!d.hyphenate);
      if (["auto", ...L.HYPH_LANGS].includes(d.hyph_lang)) this.hyph_lang_combo.setValue(d.hyph_lang);
    } catch (e) {
      // a bad stored value must never break the panel
    }
  }

  _collect_preset() {
    const p = this._collect_settings();
    p.font = this.font_picker.currentFamily() || "";
    return p;
  }

  _apply_preset(p) {
    if (!p || typeof p !== "object") return;
    this._apply_settings(p);
    if (p.font) this.font_picker.setCurrentFamily(p.font);
    this._on_outline_toggle();
    this._on_shadow_toggle();
    this._on_auto_toggle();
    this._on_style_changed();
    this._update_text_preview();
  }

  // -- text helpers -----------------------------------------------------------

  _current_text() {
    const txt = this.active_edit ? this.active_edit.text() : "";
    if (txt.trim()) return txt;
    if (!this._pairs.length) return "";
    return LP.unitText(this._pairs[this._index]);
  }

  _unit_text(index) {
    if (!(index >= 0 && index < this._pairs.length)) return "";
    return LP.unitText(this._pairs[index]);
  }

  _prepared_text(text) {
    const out = prepareText(text, this.case_combo.value() || "none", this.tidy_chk.isChecked(),
      this.comic_chk.isChecked(), this.crossbar_chk.isChecked());
    return out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  _resolve_hyph(code, text) {
    if (code && code !== "auto") return code;
    if (L.HYPH_LANGS.includes(this._lang)) return this._lang;
    return accentLang(text) || "en";
  }

  _hyph_lang_for(text) {
    return this._resolve_hyph(this.hyph_lang_combo.value() || "auto", text);
  }

  _patterns_on() {
    return !!(this.enable_patterns_chk && this.enable_patterns_chk.isChecked());
  }

  /** The measuring env for the current font (cached per font + ligatures). */
  menvFor(family, ligatures = true) {
    const key = `${family}|${ligatures}`;
    if (!this._menv.has(key)) {
      const p = measuringEnv(family, { ligatures, text: this._current_text() }).catch((e) => {
        this._menv.delete(key);
        throw e;
      });
      this._menv.set(key, p);
    }
    return this._menv.get(key);
  }

  forgetMeasuring() {
    this._menv.clear();
  }

  /** Everything insert_text_layer takes from the live controls. */
  _insert_params(overrides = {}) {
    const p = {
      fontFamily: this.font_picker.currentFamily(),
      fontPx: this.size_spin.num(),
      color: this._color,
      autoFit: this.auto_chk.isChecked(),
      maxPx: this.size_spin.num(),
      paddingFrac: this.pad_spin.num() / 100.0,
      lineSpacing: this.spacing_spin.num() / 100.0,
      outline: this.outline_chk.isChecked(),
      outlineColor: this._outline_color,
      outlinePx: this.outline_spin.num(),
      bold: this.bold_chk.isChecked(),
      italic: this.italic_chk.isChecked(),
      underline: this.underline_chk.isChecked(),
      align: this.align_combo.value() || "center",
      case: this.case_combo.value() || "none",
      tidy: this.tidy_chk.isChecked(),
      shape: this.auto_chk.isChecked() && this.round_chk.isChecked() ? "ellipse" : "rect",
      shadow: this.shadow_chk.isChecked(),
      shadowColor: this._shadow_color,
      shadowDx: this.shadow_x_spin.num(),
      shadowDy: this.shadow_y_spin.num(),
      valign: this.valign_combo.value() || "middle",
      layerIndex: this._pairs.length ? this._index + 1 : null,
      hyphenate: this.hyph_chk.isChecked(),
      replaceExisting: this.replace_chk.isChecked(),
      box: null,
      comic: this.comic_chk.isChecked(),
      crossbarI: this.crossbar_chk.isChecked(),
      vertical: this.vertical_chk.isChecked(),
      ligatures: this.liga_chk.isChecked(),
      outline2Color: this._outline2_color,
      outline2Px: this.outline2_spin.num(),
      patternTile: this._patterns_on() && this.outline_chk.isChecked() ? this._outline_tile() : null,
      patternTarget: this.outline_pattern_target_combo.value() || "outline1",
      soft: this._patterns_on() && this.outline_chk.isChecked() && this.style_soft_chk.isChecked(),
      softColor: this._style_soft_color,
      softPx: this.style_soft_width_spin.num(),
      softBlur: this.style_soft_blur_spin.num(),
      softPattern: this.style_soft_pattern_chk.isChecked(),
      fillPatternTile: null,
    };
    return { ...p, ...overrides };
  }

  _outline_tile() {
    const img = this._ensure_outline_pattern_img && this._ensure_outline_pattern_img();
    return img ? { ...img, scale: this.outline_pattern_scale_spin.num() } : null;
  }

  _insert_msg(key, fmt) {
    if (fmt && fmt.px) this._last_insert_px = fmt.px;      // for TextShapR 'match size'
    let msg = this._tr(key, fmt || {});
    if (fmt && fmt.replaced) msg += "  " + this._tr("st_replaced");
    return msg;
  }

  /** The Insert button (port of on_insert). */
  async on_insert() {
    if (!this._pairs.length) {
      this._set_status(this._tr("st_nothing"), true);
      return false;
    }
    const family = this.font_picker.currentFamily();
    if (!family) {
      this._set_status(this._tr("st_no_font"), true);
      return false;
    }
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return false;
    }
    const text = this._current_text();
    const p = this._insert_params({ line: text, hyphLang: this._hyph_lang_for(text) });
    // When a BubblR bubble is armed, Insert fills THAT bubble.
    const linked = this._bp_link_active();
    if (linked) {
      const b = this._bp_boxes[this._bp_current];
      p.box = [b.x, b.y, b.w, b.h];
      if (this.auto_chk.isChecked()) p.shape = b.kind === "sfx" ? "rect" : b.shape === "round" ? "ellipse" : "rect";
    }
    let res;
    try {
      const env = await this.menvFor(family, p.ligatures);
      res = await insertTextLayer(p, { env });
    } catch (e) {
      res = [false, "st_create_fail", { exc: e && e.message ? e.message : String(e) }];
    }
    const [ok, key, fmt] = res;
    this._set_status(this._insert_msg(key, fmt), !ok);
    if (ok) {
      this.font_picker.noteUsed(family);
      this._save_recents();
      this._save_settings();
      this._done.add(this._index);
      this._mark_done_row(this._index);
      this._schedule_session_save();
      if (this._index < this._pairs.length - 1) this._index += 1;
      this._refresh_view();
      if (linked) {
        this._bp_placed.add(this._bp_current);
        const nxt = this._bp_next_bubble(this._bp_current + 1);
        this._bp_set_current(nxt !== null ? nxt : -1);
      }
    }
    return ok;
  }

  /**
   * Insert a TextShapR candidate through the normal insert path: the chosen
   * breaks are baked in as hard breaks and the size capped at the card's px,
   * so the layer matches the card exactly (port of insert_arrangement).
   * `box` [x, y, w, h] is given by the batch (Krita selected the box first;
   * here the box goes straight into the same insert path).
   */
  async insert_arrangement(cand, advance, replace = null, box = null) {
    const family = this.font_picker.currentFamily();
    if (!family) {
      this._set_status(this._tr("st_no_font"), true);
      return false;
    }
    const baked = cand.lines.map((runs) => L.runsMarkup(runs)).join("\n");
    const p = this._insert_params({
      line: baked,
      fontPx: cand.px,
      autoFit: true,                 // respects the baked hard breaks
      maxPx: cand.px,                // cap at the card's size = WYSIWYG
      case: "none",                  // case/tidy were applied at candidate time
      tidy: false,
      comic: false,
      crossbarI: false,
      shape: "rect",                 // breaks are baked in -> rect reproduces them
      hyphenate: false,              // hyphens are already in the baked text
      vertical: false,
      replaceExisting: replace === null ? this.replace_chk.isChecked() : replace,
      box,
    });
    let res;
    try {
      const env = await this.menvFor(family, p.ligatures);
      res = await insertTextLayer(p, { env });
    } catch (e) {
      res = [false, "st_create_fail", { exc: e && e.message ? e.message : String(e) }];
    }
    const [ok, key, fmt] = res;
    this._set_status(this._insert_msg(key, fmt), !ok);
    if (ok) {
      this.font_picker.noteUsed(family);
      this._save_recents();
      this._save_settings();
      if (this._pairs.length) {
        this._done.add(this._index);
        this._mark_done_row(this._index);
        this._schedule_session_save();
        if (advance && this._index < this._pairs.length - 1) this._index += 1;
        this._refresh_view();
      }
    }
    // a batch in review mode is waiting for exactly this
    if (ok && this._bp_run && this._bp_run.waiting) this._bp_batch_continue();
    return ok;
  }

  // -- the main tabs' enable switches ----------------------------------------

  _on_enable(tabId, key, on, save = true) {
    this.tabs.setTabVisible(tabId, on);
    if (save) T.setBool(key, on);
  }

  // -- misc -------------------------------------------------------------------

  async selectionBox() {
    return selectionBounds();
  }

  versionLine() {
    const [a, b] = psVersion();
    let uxpv = "";
    try {
      uxpv = uxp().versions.uxp;
    } catch (e) {
      uxpv = "?";
    }
    return `TypeR v${VERSION} · Photoshop ${a}.${b} · UXP ${uxpv}`;
  }
}

export function normHex(c) {
  const s = String(c || "#000000").trim();
  const m = /^#?([0-9a-f]{6})/i.exec(s);
  if (m) return "#" + m[1].toLowerCase();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return ("#" + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3]).toLowerCase();
  return "#000000";
}

/** Very rough language guess from distinctive accents (only when the UI
 *  language has no bundled patterns). */
export function accentLang(text) {
  const t = text || "";
  if (/[ñ¡¿]/.test(t)) return "es";
  if (/[ãõ]/.test(t)) return "pt";
  if (/œ/.test(t)) return "fr";
  if (/[äöüßÄÖÜ]/.test(t)) return "de";
  return null;
}

export { h, show, debounce, TT, hasPhotoshop, lang };
