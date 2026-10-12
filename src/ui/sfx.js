// The SFX tab — port of TypeR-Krita's embedded SFX Helper (sfx/sfx_docker.py:
// MangaSFXDocker, SFXPreview, CollapsibleSection, classify_sfx).
//
// Same settings group ("MangaSFX") and keys (user_presets, font_rules,
// last_settings, language, view, usage, rule_lang, mode, separate_builtins,
// hidden_builtins_modes, hidden_builtins), its own UI language and string
// table. The SFX goes onto the page as an editable text layer with a layer
// style (host/sfx.js) — see there for why Photoshop needs no raster fallback.

import JSZip from "jszip";
import { h, clear, show, row, hint, Button, ActionButton, Check, Select, TextField, NumberField, ColorButton,
  promptBox, confirmBox, chooseBox, dialog, popupMenu, debounce } from "./dom.js";
import { trSfx, SFX_LANG_ORDER } from "./i18n.js";
import { SFX } from "../host/settings.js";
import { docInfo, selectionBounds, modal } from "../host/ps.js";
import { families as psFamilies } from "../host/fonts.js";
import { stylesFaces } from "../host/measure.js";
import { pickOpen, pickSave, readBytes } from "../host/files.js";
import { collectFiles } from "../host/fonts.js";
import { listPatternNames, patternPixels } from "../host/patterns.js";
import { loadImageFile } from "../host/fill.js";
import { insertSfxLayer, restyleSfxLayer, activeTextLayer, placeNoteList } from "../host/sfx.js";
import CFG from "../data/sfx_config.json" with { type: "json" };
import * as MODES from "../core/sfx/modes.js";
import { normalizeSfx, keywordMatches, ruleMatchesQuery } from "../core/sfx/rule_search.js";
import { FontIndex } from "../core/fontmatch.js";
import { glyphContours } from "../core/preview.js";
import { faceMetrics, advance } from "../core/measure.js";
import { renderStyled } from "../core/raster.js";
import { pngDataUrl } from "../core/png.js";
import { fontZipNames } from "../core/fontfiles.js";
import { decodeBytes } from "../core/readers.js";
import { isAlpha, isUpper } from "../core/py.js";

const { SFX_FONTS, SFX_PRESETS, SFX_RULES, DEFAULTS, SFX_MODES, SFX_MODE_NAMES, SHOW_ALL_SYSTEM_FONTS } = CFG;
export const RULE_LANGS = ["en", "de", "es", "fr", "pt", "it"];
export const RULE_LANG_NAMES = { en: "English", de: "Deutsch", es: "Español", fr: "Français", pt: "Português", it: "Italiano" };

const VIEW_DEFAULTS = {
  open: false, preview_show: true, preview_h: 56, suggest_show: true, font_show: true, style_show: true,
  outline_show: true, shadow_show: true, presets_show: true, rules_show: true, clear_after: false,
  collapse_preview: false, collapse_suggest: false, collapse_font: false, collapse_style: false,
  collapse_outline: false, collapse_shadow: false, collapse_presets: false, collapse_rules: false,
};
const SECTIONS = ["preview", "suggest", "font", "style", "outline", "shadow", "presets", "rules"];

// --- persistence (presets_store.py) --------------------------------------------

function jget(key, dflt) {
  let v = SFX.get(key, dflt);
  if (typeof v === "string" && v && (v[0] === "{" || v[0] === "[")) {
    try {
      v = JSON.parse(v);
    } catch (e) {
      v = dflt;
    }
  }
  return v === undefined || v === null || v === "" ? dflt : v;
}

const store = {
  presets: () => (Array.isArray(jget("user_presets", [])) ? jget("user_presets", []).filter((p) => p && p.name).map((p) => ({ ...p, user: true })) : []),
  rules: () => {
    const raw = jget("font_rules", []);
    if (Array.isArray(raw)) return raw.filter((r) => r && typeof r === "object");
    // very old format: {keyword: font}
    if (raw && typeof raw === "object") return Object.entries(raw).map(([k, f]) => ({ group: "", keywords: [k], fonts: [String(f)], lang: "*" }));
    return [];
  },
};

// --- sound-pattern heuristic (classify_sfx) ----------------------------------------

const HARD = new Set("bdgkpqt");
const SIB = new Set("fsz");
const NASAL = new Set("mn");
const LIQUID = new Set("lr");

function countSub(s, sub) {
  let n = 0;
  let i = s.indexOf(sub);
  while (i >= 0) {
    n += 1;
    i = s.indexOf(sub, i + sub.length);
  }
  return n;
}

/** Up to two group names for an unknown SFX, from how it sounds. */
export function classifySfx(word, available = null) {
  const raw = String(word || "").trim();
  const letters = Array.from(raw.toLowerCase()).filter((c) => isAlpha(c));
  if (letters.length < 2) return [];
  const s = letters.join("");
  const n = letters.length;
  const cnt = (set) => letters.filter((c) => set.has(c)).length;
  const hard = cnt(HARD);
  const sib = cnt(SIB) + countSub(s, "sh") + countSub(s, "wh");
  const nasal = cnt(NASAL);
  const liquid = cnt(LIQUID);
  const z = countSub(s, "z");
  const g = countSub(s, "g");
  const r = countSub(s, "r");
  const caps = isUpper(raw) && n >= 2;
  const bang = raw.includes("!");
  const onlyZ = letters.every((c) => c === "z");
  const endVowelRun = /([aeiouy])\1{2,}$/.test(s);
  const score = new Map();
  const add = (grp, pts) => {
    if (pts > 0) score.set(grp, (score.get(grp) || 0) + pts);
  };
  if (onlyZ) add("Breath / Sleep", 5);
  else if (z) add("Electric / Spark", 2 + z);
  if (hard >= 2) add("Boom / Explosion", hard + (caps ? 1 : 0) + (bang ? 1 : 0));
  if (hard >= 1 && n <= 5) add("Hit / Punch", hard + (caps ? 1 : 0));
  if (sib >= 1 && (s.includes("w") || s.includes("f") || countSub(s, "sh"))) add("Whoosh / Dash", sib + 1);
  if (endVowelRun) add("Scream / Shout", 3 + (caps ? 1 : 0) + (bang ? 1 : 0));
  if (g >= 1 && r >= 1) add("Roar / Growl", g + r + 1);
  if (countSub(s, "sp") || countSub(s, "dr") || countSub(s, "pl") || countSub(s, "bl") || countSub(s, "gl")) add("Water / Liquid", 2);
  if (nasal + liquid >= 2 && hard === 0 && !caps && !bang) add("Whisper / Silence", nasal + liquid);
  if (bang && !score.size) add("Scream / Shout", 2);
  if (!score.size) return [];
  // sorted(..., reverse=True) is stable: equal scores keep insertion order
  let ordered = [...score.entries()].map((e, i) => [e, i]).sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1])).map((x) => x[0]);
  if (available) ordered = ordered.filter(([grp]) => available.has(grp));
  if (!ordered.length) return [];
  const top = ordered[0][1];
  return ordered.filter(([, pts]) => pts >= Math.max(2, top * 0.6)).slice(0, 2).map(([grp]) => grp);
}

function elide(text, limit = 34) {
  const t = String(text || "");
  return t.length <= limit ? t : t.slice(0, limit - 1).trimEnd() + "…";
}

/** Heading + slider + number field, kept in sync (_slider_spin_row). */
function SliderSpin(parent, title, lo, hi, value, onChange) {
  const head = h("div", { class: "lbl bold", text: title });
  const slider = h("input", { type: "range", min: String(lo), max: String(hi), value: String(value), class: "grow" });
  const spin = NumberField({ min: lo, max: hi, value, onChange: (v) => {
    slider.value = String(v);
    onChange(v);
  } });
  slider.addEventListener("input", () => {
    spin.setNum(Number(slider.value));
    onChange(spin.num());
  });
  parent.append(head, row(slider, spin));
  const api = {
    head,
    num: () => spin.num(),
    setNum: (v) => {
      spin.setNum(v);
      slider.value = String(spin.num());
    },
    setEnabled: (on) => {
      spin.setEnabled(on);
      slider.disabled = !on;
    },
    setTitle: (t) => { head.textContent = t; },
  };
  return api;
}

export class SfxPanel {
  constructor(app) {
    this.app = app;
    this._lang = String(SFX.get("language", "") || "") || "en";
    this._user_presets = store.presets();
    this._font_rules = store.rules();
    this._pattern_path = "";
    this._pattern_ps_name = "";
    this._pattern_img = null;
    this._pending_state = jget("last_settings", {});
    this._view = { ...VIEW_DEFAULTS, ...Object.fromEntries(Object.entries(jget("view", {}) || {}).filter(([k]) => k in VIEW_DEFAULTS)) };
    this._usage = jget("usage", {}) || {};
    this._group_fonts_cache = null;
    const savedRl = String(SFX.get("rule_lang", "") || "");
    this._rule_lang = RULE_LANGS.includes(savedRl) ? savedRl : RULE_LANGS.includes(this._lang) ? this._lang : "en";
    this._rule_query = "";
    const savedMode = String(SFX.get("mode", "") || "");
    this._mode = SFX_MODES.includes(savedMode) ? savedMode : SFX_MODES[0] || "manga";
    const sep = SFX.get("separate_builtins", "");
    this._separate_builtins = sep === "" || sep === undefined ? true : sep === true || sep === "1" || sep === "true";
    this._hidden_modes = jget("hidden_builtins_modes", {}) || {};
    this._hidden_global = jget("hidden_builtins", []) || [];
    this._notes = [];
    this._font_index = null;
    this._migrate_rule_modes();
    this.el = h("div", { class: "sfx" });
    this._debounced = debounce(() => {
      this._update_preview();
      this._refresh_suggestions(this.text_input.text());
    }, 150);
    this._build_ui();
  }

  t(key, fmt = null) {
    return trSfx(key, fmt, this._lang);
  }

  _migrate_rule_modes() {
    let changed = false;
    for (const r of this._font_rules) {
      if (!r.mode) {
        r.mode = this._mode;
        changed = true;
      }
    }
    if (changed) this._save_rules();
  }

  _save_rules() {
    SFX.set("font_rules", this._font_rules);
  }

  _save_presets() {
    SFX.set("user_presets", this._user_presets.map((p) => {
      const q = { ...p };
      delete q.user;
      return q;
    }));
  }

  _families() {
    return psFamilies();
  }

  _index() {
    if (!this._font_index) this._font_index = new FontIndex(this._families());
    return this._font_index;
  }

  // ==================================================================
  //  UI (rebuilt completely on a language change, like Krita)
  // ==================================================================

  _section(key, title) {
    const head = h("div", { class: "sec-head", role: "button" });
    const arrow = h("span", { class: "arrow" });
    head.append(arrow, h("span", { text: title }));
    const body = h("div", { class: "sec-body" });
    const sec = h("div", { class: "sec" }, head, body);
    sec.body = body;
    sec.setCollapsed = (c) => {
      show(body, !c);
      arrow.textContent = c ? "▸" : "▾";
    };
    head.addEventListener("click", () => {
      const c = body.style.display !== "none";
      sec.setCollapsed(c);
      this._view["collapse_" + key] = c;
      SFX.set("view", this._view);
    });
    this["sec_" + key] = sec;
    return sec;
  }

  _colorBtn(color, title) {
    const b = ColorButton(color, {
      color,
      pick: (c) => this.app._pick_color(c, title || this.t("choose_color")),
      onChange: (c) => {
        b.setText(c);
        this._update_preview();
      },
    });
    b.setText(color);
    return b;
  }

  _build_ui() {
    const t = (k, f) => this.t(k, f);
    clear(this.el);
    const L = this.el;

    // --- language -------------------------------------------------------------
    this.lang_combo = Select(SFX_LANG_ORDER.map(([code, name]) => ({ label: name, value: code })), {
      onChange: (code) => {
        if (code && code !== this._lang) this._set_language(code);
      },
    });
    this.lang_combo.setValue(this._lang);
    L.appendChild(row(h("span", { class: "lbl", text: t("lang_label") + ":" }), this.lang_combo));

    // --- view panel -----------------------------------------------------------
    this.view_toggle = ActionButton(t("view_toggle"), { toggle: true, quiet: false, onToggle: (on) => {
      show(this.view_box, on);
      this._view = this._capture_view();
      SFX.set("view", this._view);
    } });
    this.view_toggle.setChecked(!!this._view.open);
    this.view_box = h("div", { class: "subbox" });
    const vchk = (key, label) => Check(label, { checked: !!this._view[key], onChange: () => this._on_view_changed() });
    this.v_preview_chk = vchk("preview_show", t("view_preview"));
    this.v_preview_h = NumberField({ min: 28, max: 600, step: 8, value: Math.trunc(this._view.preview_h), suffix: " px", onChange: () => this._on_view_changed() });
    this.v_suggest_chk = vchk("suggest_show", t("view_suggest"));
    this.v_font_chk = vchk("font_show", t("view_font"));
    this.v_style_chk = vchk("style_show", t("view_style"));
    this.v_outline_chk = vchk("outline_show", t("view_outline"));
    this.v_shadow_chk = vchk("shadow_show", t("view_shadow"));
    this.v_presets_chk = vchk("presets_show", t("view_presets"));
    this.v_rules_chk = vchk("rules_show", t("view_rules"));
    this.v_clear_after_chk = vchk("clear_after", t("view_clear_after"));
    this.compact_btn = Button(t("view_compact"), { tip: t("view_compact_tip"), onClick: () => this._on_compact() });
    this.view_reset_btn = Button(t("view_reset"), { onClick: () => this._on_view_reset() });
    this.view_box.append(hint(t("view_hint")),
      h("div", { class: "grid2" }, this.v_preview_chk, this.v_preview_h, this.v_suggest_chk, this.v_font_chk, this.v_style_chk,
        this.v_outline_chk, this.v_shadow_chk, this.v_presets_chk, this.v_rules_chk),
      this.v_clear_after_chk, row(this.compact_btn, this.view_reset_btn));
    show(this.view_box, !!this._view.open);
    L.append(this.view_toggle, this.view_box);

    // --- strategy ----------------------------------------------------------------
    this.strategy_combo = Select(MODES.STRATEGY_IDS.map((sid) => ({ label: t("strategy_" + sid), value: sid })), { onChange: () => this._on_strategy_changed() });
    this.strategy_hint = hint();
    L.append(row(h("span", { class: "lbl", text: t("strategy") }), this.strategy_combo), this.strategy_hint);
    this.note_meaning_input = TextField({ placeholder: t("note_meaning_ph") });
    this.note_list_btn = Button(t("note_place_list"), { tip: t("note_place_list_tip"), onClick: () => this._place_note_list() });
    this.note_row = row(h("span", { class: "lbl", text: t("note_meaning") }), this.note_meaning_input, this.note_list_btn);
    show(this.note_row, false);
    L.appendChild(this.note_row);

    // --- text ------------------------------------------------------------------------
    L.appendChild(h("div", { class: "lbl bold", text: t("sfx_text") }));
    this.text_input = TextField({
      placeholder: t("sfx_placeholder"),
      onChange: () => this._debounced(),
      onEnter: () => this._insert_sfx(),
      onEscape: () => {
        this.text_input.setText("");
        this._debounced();
      },
    });
    this.from_layer_btn = Button(t("from_layer"), { tip: t("from_layer_tip"), onClick: () => this._sfx_from_layer() });
    L.appendChild(row(this.text_input, this.from_layer_btn));
    this.upper_chk = Check(t("uppercase"), { checked: true, onChange: () => this._update_preview() });
    this.bold_chk = Check(t("bold"), { onChange: () => this._update_preview() });
    this.italic_chk = Check(t("italic"), { onChange: () => this._update_preview() });
    L.appendChild(h("div", { class: "flow" }, this.upper_chk, this.bold_chk, this.italic_chk));

    // --- preview ------------------------------------------------------------------------
    const sp = this._section("preview", t("preview"));
    this.preview_img = h("img", { class: "sfx-preview-img" });
    this.preview_badge = h("div", { class: "sfx-badge" });
    this.preview = h("div", { class: "sfx-preview" }, this.preview_img, this.preview_badge);
    sp.body.appendChild(this.preview);
    L.appendChild(sp);

    // --- suggestions -----------------------------------------------------------------------
    const sg = this._section("suggest", t("section_suggest"));
    this.suggest_box = h("div", { class: "suggest" });
    sg.body.appendChild(this.suggest_box);
    L.appendChild(sg);

    // --- font --------------------------------------------------------------------------------
    const sf = this._section("font", t("font"));
    this.font_input = TextField({
      onChange: (v) => {
        this._show_font_matches(v);
        this._update_preview();
      },
      onEnter: () => this._apply_typed_font(),
      onBlur: () => setTimeout(() => show(this.font_matches, false), 200),
    });
    this.font_quick_btn = ActionButton("▾", { quiet: false, onClick: () => popupMenu(this.font_quick_btn,
      this._quick_fonts().map((f) => ({ label: f, onClick: () => this._select_font(f) }))) });
    this.use_font_btn = Button(t("use_font_btn"), { tip: t("use_font_btn_tip"), onClick: () => this._apply_typed_font() });
    this.font_matches = h("div", { class: "font-matches" });
    show(this.font_matches, false);
    sf.body.append(row(this.font_input, this.font_quick_btn, this.use_font_btn), this.font_matches);
    L.appendChild(sf);

    // --- size & colours ----------------------------------------------------------------------------
    const ss = this._section("style", t("section_style"));
    const pv = () => this._update_preview();
    this.size = SliderSpin(ss.body, t("font_size"), 10, 600, DEFAULTS.size, pv);
    ss.body.appendChild(h("div", { class: "lbl bold", text: t("fill_color") }));
    this.fill_btn = this._colorBtn(DEFAULTS.fill);
    ss.body.appendChild(this.fill_btn);
    this.grad_chk = Check(t("gradient_fill"), { onChange: () => {
      this._update_grad_enabled();
      pv();
    } });
    this.fill2_btn = this._colorBtn(DEFAULTS.fill);
    ss.body.appendChild(row(this.grad_chk, this.fill2_btn));
    this.pattern_chk = Check(t("pattern_fill"), { onChange: () => {
      this._update_pattern_enabled();
      pv();
    } });
    this.pattern_btn = Button(t("pattern_choose"), { onClick: () => this._pick_pattern() });
    this.pattern_ps_btn = Button(t("pattern_krita"), { tip: t("pattern_krita_tip"), onClick: () => this._pick_ps_pattern() });
    this.pattern_clear_btn = ActionButton("✕", { tip: t("pattern_clear"), onClick: () => this._clear_pattern() });
    ss.body.appendChild(h("div", { class: "flow" }, this.pattern_chk, this.pattern_btn, this.pattern_ps_btn, this.pattern_clear_btn));
    this.pattern_scale = SliderSpin(ss.body, t("pattern_scale"), 10, 400, 100, pv);
    this.rot = SliderSpin(ss.body, t("rotation"), -180, 180, 0, pv);
    L.appendChild(ss);

    // --- outline --------------------------------------------------------------------------------------
    const so = this._section("outline", t("section_outline"));
    so.body.appendChild(h("div", { class: "lbl bold", text: t("outline_color") }));
    this.outline_btn = this._colorBtn(DEFAULTS.outline);
    so.body.appendChild(this.outline_btn);
    this.out = SliderSpin(so.body, t("outline_width"), 0, 60, DEFAULTS.outline_px, pv);
    so.body.appendChild(h("div", { class: "lbl bold", text: t("outline2_color") }));
    this.outline2_btn = this._colorBtn(DEFAULTS.outline2 || "#000000");
    so.body.appendChild(this.outline2_btn);
    this.out2 = SliderSpin(so.body, t("outline2_width"), 0, 80, DEFAULTS.outline2_px || 0, pv);
    this.soft_chk = Check(t("soft_outline"), { tip: t("soft_outline_tip"), onChange: () => {
      this._update_soft_enabled();
      pv();
    } });
    this.soft_pattern_chk = Check(t("soft_pattern"), { tip: t("soft_pattern_tip"), onChange: () => {
      this._update_soft_enabled();
      pv();
    } });
    this.soft_color_btn = this._colorBtn("#000000");
    so.body.appendChild(h("div", { class: "flow" }, this.soft_chk, this.soft_pattern_chk, this.soft_color_btn));
    this.soft_width = SliderSpin(so.body, t("soft_width"), 0, 40, 3, pv);
    this.soft_blur = SliderSpin(so.body, t("soft_blur"), 1, 60, 8, pv);
    L.appendChild(so);

    // --- shadow ------------------------------------------------------------------------------------------
    const sh = this._section("shadow", t("shadow"));
    this.shadow_chk = Check(t("shadow_enable"), { checked: !!DEFAULTS.shadow, onChange: () => {
      this._update_shadow_enabled();
      pv();
    } });
    this.shadow_btn = this._colorBtn(DEFAULTS.shadow_color || "#000000", t("shadow_color"));
    this.shadow_dx = NumberField({ min: -100, max: 100, value: Math.trunc(DEFAULTS.shadow_dx ?? 6), onChange: pv });
    this.shadow_dy = NumberField({ min: -100, max: 100, value: Math.trunc(DEFAULTS.shadow_dy ?? 6), onChange: pv });
    sh.body.append(this.shadow_chk, this.shadow_btn, h("div", { class: "lbl", text: t("shadow_offset") }), row(this.shadow_dx, this.shadow_dy));
    L.appendChild(sh);

    // --- presets -------------------------------------------------------------------------------------------
    const spr = this._section("presets", t("presets"));
    this.preset_box = h("div", { class: "grid2" });
    this.save_preset_btn = Button(t("save_preset_btn"), { tip: t("save_preset_tip"), onClick: () => this._save_current_as_preset() });
    spr.body.append(this.preset_box, this.save_preset_btn);
    L.appendChild(spr);

    // --- rules ---------------------------------------------------------------------------------------------------
    const sr = this._section("rules", t("font_suggestions"));
    this.mode_combo = Select(SFX_MODES.map((m) => ({ label: SFX_MODE_NAMES[m] || m, value: m })), { tip: t("mode_tip"), onChange: () => this._on_mode_changed() });
    this.mode_combo.setValue(this._mode);
    this.rule_lang_combo = Select(RULE_LANGS.map((c) => ({ label: RULE_LANG_NAMES[c] || c, value: c })), { onChange: () => this._on_rule_lang_changed() });
    this.rule_lang_combo.setValue(this._rule_lang);
    this.sep_builtins_chk = Check(t("builtins_per_mode"), { tip: t("builtins_per_mode_tip"), checked: this._separate_builtins, onChange: (on) => this._on_sep_builtins_changed(on) });
    this.hide_all_btn = Button(t("hide_all_builtins"), { tip: t("hide_all_builtins_tip"), onClick: () => this._hide_all_builtins() });
    this.restore_builtins_btn = Button(t("restore_builtins"), { tip: t("restore_builtins_tip"), onClick: () => this._restore_builtins() });
    this.rule_search = TextField({
      value: this._rule_query, placeholder: t("rule_search_ph"), tip: t("rule_search_tip"),
      onChange: (v) => {
        this._rule_query = v || "";
        this._rebuild_rules();
      },
      onEscape: () => {
        this.rule_search.setText("");
        this._rule_query = "";
        this._rebuild_rules();
      },
    });
    this.rules_box = h("div", { class: "rules" });
    this.rule_count_lbl = hint();
    show(this.rule_count_lbl, false);
    this.add_rule_btn = Button(t("add_rule_btn"), { tip: t("add_rule_tip"), onClick: () => this._add_font_rule() });
    sr.body.append(row(h("span", { class: "lbl", text: t("mode"), title: t("mode_tip") }), this.mode_combo),
      row(h("span", { class: "lbl", text: t("rule_lang") }), this.rule_lang_combo),
      this.sep_builtins_chk, row(this.hide_all_btn, this.restore_builtins_btn), hint(t("rules_hint")),
      this.rule_search, this.rules_box, this.rule_count_lbl, this.add_rule_btn);
    L.appendChild(sr);

    // --- insert / restyle / status / io / reset -----------------------------------------------------------------------
    this.insert_btn = Button(t("insert_btn"), { variant: "cta", onClick: () => this._insert_sfx() });
    this.insert_btn.classList.add("wide");
    this.restyle_btn = Button(t("restyle_btn"), { tip: t("restyle_tip"), onClick: () => this._restyle_sfx() });
    this.status_label = h("div", { class: "wrap" });
    this.import_btn = Button(t("import_btn"), { onClick: () => this._import_data() });
    this.export_btn = Button(t("export_btn"), { onClick: () => this._export_data() });
    this.reset_btn = Button(t("reset_btn"), { tip: t("reset_tip"), onClick: () => this._reset() });
    L.append(this.insert_btn, this.restyle_btn, this.status_label, row(this.import_btn, this.export_btn), this.reset_btn);

    this._update_grad_enabled();
    this._update_pattern_enabled();
    this._update_soft_enabled();
    this._update_shadow_enabled();
    this._rebuild_presets();
    this._rebuild_rules();
    this._on_strategy_changed();
    this._apply_state(this._pending_state);
    if (!this.font_input.text()) this.font_input.setText(SFX_FONTS[0] || "");
    this._apply_view();
    this._update_preview();
  }

  // ==================================================================
  //  view
  // ==================================================================

  _apply_view() {
    const chk = { preview: this.v_preview_chk, suggest: this.v_suggest_chk, font: this.v_font_chk, style: this.v_style_chk,
      outline: this.v_outline_chk, shadow: this.v_shadow_chk, presets: this.v_presets_chk, rules: this.v_rules_chk };
    for (const key of SECTIONS) {
      const sec = this["sec_" + key];
      show(sec, chk[key].isChecked());
      sec.setCollapsed(!!this._view["collapse_" + key]);
    }
    this.preview.style.height = `${this.v_preview_h.num()}px`;
    this.v_preview_h.setEnabled(this.v_preview_chk.isChecked());
    this._update_preview();
    if (this.v_suggest_chk.isChecked()) this._refresh_suggestions(this.text_input.text());
  }

  _capture_view() {
    return {
      ...this._view,
      open: this.view_toggle.isChecked(),
      preview_show: this.v_preview_chk.isChecked(), preview_h: this.v_preview_h.num(),
      suggest_show: this.v_suggest_chk.isChecked(), font_show: this.v_font_chk.isChecked(),
      style_show: this.v_style_chk.isChecked(), outline_show: this.v_outline_chk.isChecked(),
      shadow_show: this.v_shadow_chk.isChecked(), presets_show: this.v_presets_chk.isChecked(),
      rules_show: this.v_rules_chk.isChecked(), clear_after: this.v_clear_after_chk.isChecked(),
    };
  }

  _on_view_changed() {
    this._view = this._capture_view();
    SFX.set("view", this._view);
    this._apply_view();
  }

  _on_compact() {
    const compact = this.v_shadow_chk.isChecked() || this.v_rules_chk.isChecked();
    this.v_shadow_chk.setChecked(!compact);
    this.v_rules_chk.setChecked(!compact);
    this._on_view_changed();
  }

  _on_view_reset() {
    const keep = Object.fromEntries(Object.entries(this._view).filter(([k]) => k.startsWith("collapse_")));
    this._view = { ...VIEW_DEFAULTS, ...keep, open: this.view_toggle.isChecked() };
    SFX.set("view", this._view);
    this.v_preview_chk.setChecked(this._view.preview_show);
    this.v_preview_h.setNum(this._view.preview_h);
    this.v_suggest_chk.setChecked(this._view.suggest_show);
    this.v_font_chk.setChecked(this._view.font_show);
    this.v_style_chk.setChecked(this._view.style_show);
    this.v_outline_chk.setChecked(this._view.outline_show);
    this.v_shadow_chk.setChecked(this._view.shadow_show);
    this.v_presets_chk.setChecked(this._view.presets_show);
    this.v_rules_chk.setChecked(this._view.rules_show);
    this.v_clear_after_chk.setChecked(this._view.clear_after);
    this._apply_view();
  }

  _set_language(code) {
    this._pending_state = this._capture_state();
    this._lang = code;
    SFX.set("language", code);
    this._build_ui();
  }

  // ==================================================================
  //  strategy
  // ==================================================================

  _strategy() {
    return this.strategy_combo.val() || "redraw";
  }

  _on_strategy_changed() {
    const sid = this._strategy();
    this.strategy_hint.textContent = this.t("strategy_" + sid + "_hint");
    this.insert_btn.setText(MODES.insertsText(sid) ? this.t("insert_btn") : this.t("skip_btn"));
    this.text_input.setPlaceholder(sid === "romaji" || sid === "note" ? this.t("sfx_placeholder_jp") : this.t("sfx_placeholder"));
    show(this.note_row, sid === "note");
    this._update_note_btn();
    this._update_preview();
  }

  _update_note_btn() {
    const n = this._notes.length;
    this.note_list_btn.setEnabled(n > 0);
    this.note_list_btn.setText(this.t("note_place_list") + (n ? ` (${n})` : ""));
  }

  async _place_note_list() {
    if (!docInfo()) {
      this._warn(this.t("st_no_doc"));
      return;
    }
    if (!this._notes.length) return;
    const size = Math.max(10, Math.round(this.size.num() * 0.28));
    const [ok, key, fmt] = await placeNoteList(this._notes, size);
    if (!ok) {
      this._warn(this.t(key, fmt));
      return;
    }
    this._info(this.t("st_notes_placed", { n: this._notes.length }));
    this._notes = [];
    this._update_note_btn();
  }

  _effective_text() {
    let txt = this.text_input.text().trim();
    if (this._strategy() === "romaji") txt = MODES.toRomaji(txt);
    if (this.upper_chk && this.upper_chk.isChecked()) txt = txt.toUpperCase();
    return txt;
  }

  _update_shadow_enabled() {
    const on = this.shadow_chk.isChecked();
    for (const w of [this.shadow_btn, this.shadow_dx, this.shadow_dy]) w.setEnabled(on);
  }

  _update_grad_enabled() {
    this.fill2_btn.setEnabled(this.grad_chk.isChecked());
  }

  _update_pattern_enabled() {
    const on = this.pattern_chk.isChecked();
    for (const w of [this.pattern_btn, this.pattern_ps_btn, this.pattern_clear_btn, this.pattern_scale]) w.setEnabled(on);
    const name = this._pattern_path ? this._pattern_path.split(/[\\/]/).pop() : this._pattern_ps_name || this.t("pattern_choose");
    this.pattern_btn.setText(elide(name, 20));
  }

  _update_soft_enabled() {
    const on = this.soft_chk.isChecked();
    for (const w of [this.soft_pattern_chk, this.soft_width, this.soft_blur]) w.setEnabled(on);
    this.soft_color_btn.setEnabled(on && !this.soft_pattern_chk.isChecked());
  }

  // --- pattern -----------------------------------------------------------------

  async _pick_pattern() {
    const f = await pickOpen(["png", "jpg", "jpeg", "bmp", "webp", "gif"]);
    if (!f) return;
    const img = await loadImageFile(f.path);
    if (!img) {
      this._warn(this.t("warn_pattern_bad"));
      return;
    }
    this._pattern_path = f.path;
    this._pattern_ps_name = "";
    this._pattern_img = img;
    if (!this.pattern_chk.isChecked()) this.pattern_chk.setChecked(true);
    this._update_pattern_enabled();
    this._update_preview();
  }

  async _pick_ps_pattern() {
    if (!docInfo()) {
      this._warn(this.t("st_no_doc"));
      return;
    }
    const names = await listPatternNames();
    if (!names.length) {
      this._warn(this.t("warn_no_krita_patterns"));
      return;
    }
    const i = await chooseBox(this.t("pattern_krita_title"), "", names, "OK", this.t("cancel"));
    if (i === null || i === undefined) return;
    let img = null;
    try {
      img = await modal("TypeR: pattern", () => patternPixels(names[i]), { history: false });
    } catch (e) {
      img = null;
    }
    if (!img) {
      this._warn(this.t("warn_pattern_bad"));
      return;
    }
    this._pattern_ps_name = names[i];
    this._pattern_path = "";
    this._pattern_img = img;
    if (!this.pattern_chk.isChecked()) this.pattern_chk.setChecked(true);
    this._update_pattern_enabled();
    this._update_preview();
  }

  _clear_pattern() {
    this._pattern_path = "";
    this._pattern_ps_name = "";
    this._pattern_img = null;
    this._update_pattern_enabled();
    this._update_preview();
  }

  async _load_pattern_img() {
    if (this._pattern_img) return this._pattern_img;
    if (this._pattern_path) this._pattern_img = await loadImageFile(this._pattern_path);
    if (!this._pattern_img && this._pattern_ps_name && docInfo()) {
      try {
        this._pattern_img = await modal("TypeR: pattern", () => patternPixels(this._pattern_ps_name), { history: false });
      } catch (e) {
        this._pattern_img = null;
      }
    }
    return this._pattern_img;
  }

  _pattern_active() {
    return this.pattern_chk.isChecked() && !!this._pattern_img;
  }

  _soft_outline_active() {
    return this.soft_chk.isChecked();
  }

  // --- the style snapshot for the host -----------------------------------------------

  _style(outlineOverride = null) {
    return {
      font: this.font_input.text().trim(),
      bold: this.bold_chk.isChecked(),
      italic: this.italic_chk.isChecked(),
      size: this.size.num(),
      fill: this.fill_btn.color(),
      fill2: this.grad_chk.isChecked() ? this.fill2_btn.color() : null,
      outline: this.outline_btn.color(),
      outlinePx: outlineOverride !== null ? outlineOverride : this.out.num(),
      outline2: this.outline2_btn.color(),
      outline2Px: this.out2.num(),
      shadow: this.shadow_chk.isChecked(),
      shadowColor: this.shadow_btn.color(),
      shadowDx: this.shadow_dx.num(),
      shadowDy: this.shadow_dy.num(),
      rotate: this.rot.num(),
      patternTile: this._pattern_active() ? { ...this._pattern_img, scale: this.pattern_scale.num() } : null,
      soft: this._soft_outline_active(),
      softColor: this.soft_color_btn.color(),
      softWidth: this.soft_width.num(),
      softBlur: this.soft_blur.num(),
      softPattern: this.soft_pattern_chk.isChecked(),
    };
  }

  // --- preview (SFXPreview) ------------------------------------------------------------

  async _update_preview() {
    if (!this.preview || !this.v_preview_chk || !this.v_preview_chk.isChecked()) return;
    const gen = (this._pv_gen = (this._pv_gen || 0) + 1);
    const w = Math.max(60, Math.floor(this.preview.clientWidth || 280));
    const hh = Math.max(28, this.v_preview_h.num());
    const text = this._effective_text();
    const fam = this.font_input.text().trim();
    const m = fam ? this._index().resolve(fam) : null;
    const missing = !!fam && !m;
    this.preview_badge.textContent = missing ? this.t("not_installed") : "";
    const rgba = sfxChecker(w, hh);
    if (text && !missing) {
      const faces = await stylesFaces(m.family, this.bold_chk.isChecked(), this.italic_chk.isChecked()).catch(() => null);
      if (gen !== this._pv_gen) return;
      if (faces) renderSfx(rgba, w, hh, text, faces, this.bold_chk.isChecked(), this._style());
    }
    this.preview_img.src = pngDataUrl(rgba, w, hh);
  }

  // --- state -------------------------------------------------------------------------------------

  _capture_state() {
    return {
      text: this.text_input.text(),
      font: this.font_input.text(),
      size: this.size.num(),
      fill: this.fill_btn.color(),
      outline: this.outline_btn.color(),
      outline_px: this.out.num(),
      outline2: this.outline2_btn.color(),
      outline2_px: this.out2.num(),
      pattern: this._pattern_path,
      pattern_krita: this._pattern_ps_name,
      pattern_on: this.pattern_chk.isChecked(),
      pattern_scale: this.pattern_scale.num(),
      soft_on: this.soft_chk.isChecked(),
      soft_pattern: this.soft_pattern_chk.isChecked(),
      soft_color: this.soft_color_btn.color(),
      soft_width: this.soft_width.num(),
      soft_blur: this.soft_blur.num(),
      uppercase: this.upper_chk.isChecked(),
      bold: this.bold_chk.isChecked(),
      italic: this.italic_chk.isChecked(),
      shadow: this.shadow_chk.isChecked(),
      shadow_color: this.shadow_btn.color(),
      shadow_dx: this.shadow_dx.num(),
      shadow_dy: this.shadow_dy.num(),
      // Photoshop port: the gradient + rotation survive a restart too
      gradient: this.grad_chk.isChecked(),
      fill2: this.fill2_btn.color(),
      rotate: this.rot.num(),
    };
  }

  _setColor(btn, c) {
    btn.setColor(c);
    btn.setText(c);
  }

  _apply_state(st) {
    if (!st || typeof st !== "object") return;
    if (st.text) this.text_input.setText(st.text);
    if (st.font) this._select_font(st.font, false);
    const num = (k, w) => {
      if (k in st && Number.isFinite(Number(st[k]))) w.setNum(Math.trunc(Number(st[k])));
    };
    num("size", this.size);
    num("outline_px", this.out);
    num("outline2_px", this.out2);
    num("shadow_dx", this.shadow_dx);
    num("shadow_dy", this.shadow_dy);
    num("rotate", this.rot);
    if (st.fill) this._setColor(this.fill_btn, st.fill);
    if (st.outline) this._setColor(this.outline_btn, st.outline);
    if (st.outline2) this._setColor(this.outline2_btn, st.outline2);
    if (st.shadow_color) this._setColor(this.shadow_btn, st.shadow_color);
    if (st.fill2) this._setColor(this.fill2_btn, st.fill2);
    if ("gradient" in st) this.grad_chk.setChecked(!!st.gradient);
    if ("uppercase" in st) this.upper_chk.setChecked(!!st.uppercase);
    if ("bold" in st) this.bold_chk.setChecked(!!st.bold);
    if ("italic" in st) this.italic_chk.setChecked(!!st.italic);
    if ("shadow" in st) this.shadow_chk.setChecked(!!st.shadow);
    this._restore_pattern(st);
    this._restore_soft(st);
    this._update_grad_enabled();
    this._update_shadow_enabled();
  }

  _restore_pattern(st) {
    this._pattern_path = st.pattern || "";
    this._pattern_ps_name = st.pattern_krita || "";
    this._pattern_img = null;
    if ("pattern_scale" in st && Number.isFinite(Number(st.pattern_scale))) this.pattern_scale.setNum(Math.trunc(Number(st.pattern_scale)));
    this.pattern_chk.setChecked(false);
    this._update_pattern_enabled();
    // on only if the image actually resolves (async: file read / PS pattern)
    if (st.pattern_on && (this._pattern_path || this._pattern_ps_name)) {
      this._load_pattern_img().then((img) => {
        if (img) {
          this.pattern_chk.setChecked(true);
          this._update_pattern_enabled();
          this._update_preview();
        }
      });
    }
  }

  _restore_soft(st) {
    if (st.soft_color) this._setColor(this.soft_color_btn, st.soft_color);
    if ("soft_width" in st && Number.isFinite(Number(st.soft_width))) this.soft_width.setNum(Math.trunc(Number(st.soft_width)));
    if ("soft_blur" in st && Number.isFinite(Number(st.soft_blur))) this.soft_blur.setNum(Math.trunc(Number(st.soft_blur)));
    this.soft_pattern_chk.setChecked(!!st.soft_pattern);
    this.soft_chk.setChecked(!!st.soft_on);
    this._update_soft_enabled();
  }

  // ==================================================================
  //  presets
  // ==================================================================

  _preset_tooltip(p) {
    const lines = [
      this.t("tip_font", { v: p.font }), this.t("tip_size", { v: p.size }), this.t("tip_fill", { v: p.fill }),
      this.t("tip_outline", { c: p.outline, w: p.outline_px }),
    ];
    if ((p.keywords || []).length) lines.push(this.t("tip_keywords", { v: p.keywords.join(", ") }));
    lines.push(p.user ? this.t("tip_user_preset") : this.t("tip_builtin"));
    return lines.join("\n");
  }

  _apply_preset(p) {
    this._select_font(p.font);
    this.size.setNum(p.size);
    this.out.setNum(p.outline_px);
    this.out2.setNum(Math.trunc(p.outline2_px ?? DEFAULTS.outline2_px ?? 0));
    this._setColor(this.fill_btn, p.fill);
    this._setColor(this.outline_btn, p.outline);
    this._setColor(this.outline2_btn, p.outline2 || DEFAULTS.outline2 || "#000000");
    this.bold_chk.setChecked(!!p.bold);
    this.italic_chk.setChecked(!!p.italic);
    this.shadow_chk.setChecked(!!p.shadow);
    if (p.shadow_color) this._setColor(this.shadow_btn, p.shadow_color);
    this.shadow_dx.setNum(Math.trunc(p.shadow_dx ?? DEFAULTS.shadow_dx ?? 6));
    this.shadow_dy.setNum(Math.trunc(p.shadow_dy ?? DEFAULTS.shadow_dy ?? 6));
    this._restore_pattern(p);
    this._restore_soft(p);
    this._update_shadow_enabled();
    this._update_preview();
    this.status_label.textContent = this.t("st_preset_loaded", { name: p.name });
  }

  _all_presets() {
    return [...SFX_PRESETS.map((p) => ({ ...p, user: false })), ...this._user_presets];
  }

  _rebuild_presets() {
    clear(this.preset_box);
    for (const p of this._all_presets()) {
      const b = Button(elide(p.name, 18), { tip: this._preset_tooltip(p), onClick: () => this._apply_preset(p) });
      if (p.user) {
        b.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          popupMenu(e, [
            { label: this.t("menu_rename"), onClick: () => this._rename_user_preset(p) },
            { label: this.t("menu_edit_keywords"), onClick: () => this._edit_keywords(p) },
            { label: this.t("menu_overwrite"), onClick: () => this._overwrite_user_preset(p) },
            { separator: true },
            { label: this.t("menu_delete"), onClick: () => this._delete_user_preset(p) },
          ]);
        });
      }
      this.preset_box.appendChild(b);
    }
  }

  _current_settings_as_preset(name, keywords) {
    const st = this._capture_state();
    delete st.text;
    delete st.uppercase;
    return { name, ...st, keywords, user: true };
  }

  async _save_current_as_preset() {
    let name = await promptBox(this.t("dlg_save_title"), this.t("dlg_save_name"), "");
    if (name === null) return;
    name = name.trim();
    if (!name) {
      this._warn(this.t("warn_no_name"));
      return;
    }
    const kw = await promptBox(this.t("dlg_kw_opt_title"), this.t("dlg_kw_opt_label"), "");
    const keywords = kw && kw.trim() ? kw.split(",").map((k) => k.trim().toLowerCase()).filter((k) => k) : [];
    this._user_presets = this._user_presets.filter((p) => p.name !== name);
    this._user_presets.push(this._current_settings_as_preset(name, keywords));
    this._save_presets();
    this._rebuild_presets();
    this.status_label.textContent = this.t("st_preset_saved", { name });
  }

  async _rename_user_preset(p) {
    const old = p.name || "";
    let nw = await promptBox(this.t("dlg_rename_title"), this.t("dlg_rename_label"), old);
    if (nw === null) return;
    nw = nw.trim();
    if (!nw) {
      this._warn(this.t("warn_no_name"));
      return;
    }
    if (nw === old) return;
    if (this._user_presets.some((q) => q !== p && q.name === nw)) {
      this._warn(this.t("warn_name_exists", { name: nw }));
      return;
    }
    p.name = nw;
    this._save_presets();
    this._rebuild_presets();
    this.status_label.textContent = this.t("st_preset_renamed", { name: nw });
  }

  async _edit_keywords(p) {
    const txt = await promptBox(this.t("dlg_editkw_title"), this.t("dlg_editkw_label"), (p.keywords || []).join(", "));
    if (txt === null) return;
    p.keywords = txt.split(",").map((k) => k.trim().toLowerCase()).filter((k) => k);
    this._save_presets();
    this._rebuild_presets();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_keywords_updated", { name: p.name });
  }

  async _overwrite_user_preset(p) {
    if (!(await confirmBox(this.t("dlg_overwrite_title"), this.t("dlg_overwrite_q", { name: p.name }), this.app._tr("yes"), this.app._tr("no")))) return;
    const cur = this._current_settings_as_preset(p.name, p.keywords || []);
    Object.assign(p, cur);
    this._save_presets();
    this._rebuild_presets();
    this.status_label.textContent = this.t("st_preset_overwritten", { name: p.name });
  }

  async _delete_user_preset(p) {
    if (!(await confirmBox(this.t("dlg_delpreset_title"), this.t("dlg_delpreset_q", { name: p.name }), this.app._tr("yes"), this.app._tr("no")))) return;
    this._user_presets = this._user_presets.filter((q) => q !== p);
    this._save_presets();
    this._rebuild_presets();
    this.status_label.textContent = this.t("st_preset_deleted", { name: p.name });
  }

  // ==================================================================
  //  fonts
  // ==================================================================

  _recent_fonts(limit = 8) {
    const counts = new Map();
    for (const d of Object.values(this._usage)) {
      for (const [f, c] of Object.entries(d || {})) counts.set(f, (counts.get(f) || 0) + c);
    }
    return [...counts.entries()].map((e, i) => [e, i]).sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1])).map((x) => x[0][0]).slice(0, limit);
  }

  _quick_fonts() {
    const out = [];
    for (const f of [...SFX_FONTS, ...this._recent_fonts()]) if (f && !out.includes(f)) out.push(f);
    return out;
  }

  _show_font_matches(q) {
    clear(this.font_matches);
    const query = String(q || "").trim().toLowerCase();
    if (!query) {
      show(this.font_matches, false);
      return;
    }
    const quick = this._quick_fonts();
    const all = SHOW_ALL_SYSTEM_FONTS ? [...quick, ...this._families().filter((f) => !quick.includes(f))] : quick;
    const hits = all.filter((f) => f.toLowerCase().includes(query)).slice(0, 12);
    for (const f of hits) {
      const r = h("div", { class: "font-match", text: f });
      r.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._select_font(f);
        show(this.font_matches, false);
      });
      this.font_matches.appendChild(r);
    }
    show(this.font_matches, hits.length > 0);
  }

  _resolve_font(fam) {
    return this._index().resolve(fam);
  }

  _is_installed(fam) {
    return this._resolve_font(fam) !== null;
  }

  _best_alternative() {
    for (const fav of SFX_FONTS) {
      const m = this._resolve_font(fav);
      if (m) return m.family;
    }
    const fams = this._families();
    return fams.length ? fams[0] : "";
  }

  _select_font(name, warn = true) {
    if (name) {
      const m = this._resolve_font(name);
      if (m) {
        name = m.family;
      } else {
        const alt = this._best_alternative();
        if (warn) this._warn(this.t("st_font_missing", { font: name, alt: alt || "?" }));
        if (alt) name = alt;
      }
    }
    this.font_input.setText(name || "");
    this._update_preview();
  }

  _apply_typed_font() {
    const name = this.font_input.text().trim();
    if (name) this._select_font(name);
    show(this.font_matches, false);
  }

  // ==================================================================
  //  suggestions
  // ==================================================================

  _add_suggestion_btn(fnt) {
    const installed = this._is_installed(fnt);
    const b = Button(this.t("sug_font", { name: elide(fnt, 28) }), {
      tip: installed ? this.t("sug_font_tip", { name: fnt }) : this.t("sug_font_missing_tip", { name: fnt }),
      onClick: () => this._select_font(fnt),
    });
    if (!installed) b.classList.add("amber");
    this.suggest_box.appendChild(b);
  }

  _refresh_suggestions(text) {
    clear(this.suggest_box);
    if (!this.v_suggest_chk.isChecked()) return;
    const norm = normalizeSfx(text);
    const learned = this._learned_fonts(norm);
    let groups = this._suggested_groups(text);
    let guessed = false;
    if (!groups.length) {
      groups = this._heuristic_groups(text);
      guessed = groups.length > 0;
    }
    const preset = this._find_matching_preset(text);
    if (!learned.length && !groups.length && !preset) return;
    this.suggest_box.appendChild(h("div", { class: "wrap", text: guessed && !learned.length ? this.t("suggestions_guess") : this.t("suggestions") }));
    const shown = new Set();
    let remaining = 8;
    if (learned.length) {
      this.suggest_box.appendChild(h("div", { class: "lbl bold", text: this.t("suggestions_learned") }));
      for (const f of learned) {
        if (remaining <= 0) break;
        if (shown.has(f)) continue;
        shown.add(f);
        remaining -= 1;
        this._add_suggestion_btn(f);
      }
    }
    for (const [group, fonts] of groups) {
      if (remaining <= 0) break;
      const nf = fonts.filter((f) => !shown.has(f)).slice(0, remaining);
      if (!nf.length) continue;
      if (group) this.suggest_box.appendChild(h("div", { class: "lbl bold", text: group }));
      for (const f of nf) {
        shown.add(f);
        this._add_suggestion_btn(f);
      }
      remaining -= nf.length;
    }
    if (preset) {
      this.suggest_box.appendChild(Button(this.t("sug_preset", { name: preset.name, font: elide(preset.font, 22) }), {
        tip: this.t("sug_preset_tip"), onClick: () => this._apply_preset(preset),
      }));
    }
  }

  _group_fonts() {
    if (!this._group_fonts_cache) {
      const cache = new Map();
      for (const r of SFX_RULES) if (!cache.has(r.group || "")) cache.set(r.group || "", [...(r.fonts || [])]);
      this._group_fonts_cache = cache;
    }
    return this._group_fonts_cache;
  }

  _heuristic_groups(text) {
    const gf = this._group_fonts();
    const out = [];
    for (const g of classifySfx(text, new Set(gf.keys()))) {
      const fonts = gf.get(g) || [];
      if (fonts.length) out.push([g, [...fonts]]);
    }
    return out;
  }

  _learned_fonts(norm) {
    if (!norm) return [];
    const d = this._usage[norm] || {};
    return Object.entries(d).map((e, i) => [e, i]).sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1])).map((x) => x[0][0]);
  }

  _record_usage(text, font) {
    const norm = normalizeSfx(text);
    if (!norm || !font) return;
    const d = (this._usage[norm] = this._usage[norm] || {});
    d[font] = (d[font] || 0) + 1;
    if (Object.keys(d).length > 8) {
      this._usage[norm] = Object.fromEntries(Object.entries(d).map((e, i) => [e, i])
        .sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1])).slice(0, 8).map((x) => x[0]));
    }
    SFX.set("usage", this._usage);
  }

  _builtin_key(rule) {
    return (rule.group || "") + "\n" + (rule.lang || "*");
  }

  _hidden_arr() {
    if (this._separate_builtins) {
      if (!Array.isArray(this._hidden_modes[this._mode])) this._hidden_modes[this._mode] = [];
      return this._hidden_modes[this._mode];
    }
    return this._hidden_global;
  }

  _save_hidden() {
    if (this._separate_builtins) SFX.set("hidden_builtins_modes", this._hidden_modes);
    else SFX.set("hidden_builtins", this._hidden_global);
  }

  _all_rules() {
    const active = this._rule_lang;
    const langOk = (r) => {
      const l = r.lang || "*";
      return l === "*" || l === active;
    };
    const modeOk = (r) => !r.mode || r.mode === this._mode;
    const hidden = new Set(this._hidden_arr());
    return [
      ...SFX_RULES.filter((r) => langOk(r) && !hidden.has(this._builtin_key(r))).map((r) => [r, true]),
      ...this._font_rules.filter((r) => langOk(r) && modeOk(r)).map((r) => [r, false]),
    ];
  }

  _suggested_groups(text) {
    const norm = normalizeSfx(text);
    if (!norm) return [];
    const result = [];
    const index = new Map();
    for (const [rule] of this._all_rules()) {
      const matched = (rule.keywords || []).filter((kw) => keywordMatches(kw, norm));
      if (!matched.length) continue;
      const exact = matched.some((kw) => normalizeSfx(kw) === norm);
      const g = rule.group || "";
      if (!index.has(g)) {
        index.set(g, result.length);
        result.push([g, [], exact]);
      }
      const e = result[index.get(g)];
      e[2] = e[2] || exact;
      for (const f of rule.fonts || []) if (f && !e[1].includes(f)) e[1].push(f);
    }
    return result.map((e, i) => [e, i]).sort((a, b) => ((a[0][2] ? 0 : 1) - (b[0][2] ? 0 : 1)) || (a[1] - b[1])).map((x) => [x[0][0], x[0][1]]);
  }

  _find_matching_preset(text) {
    const norm = normalizeSfx(text);
    if (!norm) return null;
    for (const p of this._all_presets()) for (const kw of p.keywords || []) if (keywordMatches(kw, norm)) return p;
    return null;
  }

  _on_rule_lang_changed() {
    const code = this.rule_lang_combo.val();
    if (!code || code === this._rule_lang) return;
    this._rule_lang = code;
    SFX.set("rule_lang", code);
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
  }

  _on_mode_changed() {
    const code = this.mode_combo.val();
    if (!code || code === this._mode) return;
    this._mode = code;
    SFX.set("mode", code);
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
  }

  _on_sep_builtins_changed(on) {
    this._separate_builtins = !!on;
    SFX.set("separate_builtins", on ? "1" : "0");
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
  }

  _hide_all_builtins() {
    const arr = this._hidden_arr();
    for (const r of SFX_RULES) {
      const k = this._builtin_key(r);
      if (!arr.includes(k)) arr.push(k);
    }
    this._save_hidden();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_builtins_hidden");
  }

  _restore_builtins() {
    if (this._separate_builtins) this._hidden_modes[this._mode] = [];
    else this._hidden_global = [];
    this._save_hidden();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_builtins_restored");
  }

  _ordered_groups() {
    const order = [];
    let hasEmpty = false;
    for (const [r] of this._all_rules()) {
      const g = r.group || "";
      if (g === "") hasEmpty = true;
      else if (!order.includes(g)) order.push(g);
    }
    if (hasEmpty) order.push("");
    return order;
  }

  _existing_groups() {
    const seen = [];
    for (const [r] of this._all_rules()) {
      const g = (r.group || "").trim();
      if (g && !seen.includes(g)) seen.push(g);
    }
    return seen;
  }

  _rebuild_rules() {
    clear(this.rules_box);
    const all = this._all_rules();
    this.restore_builtins_btn.setEnabled(this._hidden_arr().length > 0);
    this.hide_all_btn.setEnabled(all.some(([, b]) => b));
    const query = this._rule_query.trim();
    const shown = all.filter(([r]) => ruleMatchesQuery(r, query));
    if (query) {
      this.rule_count_lbl.textContent = this.t("rules_count", { n: shown.length, total: all.length });
      show(this.rule_count_lbl, true);
    } else {
      show(this.rule_count_lbl, false);
    }
    if (!all.length) {
      this.rules_box.appendChild(hint(this.t("no_rules")));
      return;
    }
    if (!shown.length) {
      this.rules_box.appendChild(hint(this.t("no_rule_match", { q: query })));
      return;
    }
    for (const group of this._ordered_groups()) {
      const inGroup = shown.filter(([r]) => (r.group || "") === group);
      if (!inGroup.length) continue;
      this.rules_box.appendChild(h("div", { class: "lbl bold", text: group || this.t("group_none") }));
      for (const [rule, isBuiltin] of inGroup) {
        const kw = (rule.keywords || []).join(", ");
        const fo = (rule.fonts || []).join(", ");
        const full = `${kw}  →  ${fo}`;
        const mode = isBuiltin ? "" : rule.mode;
        const prefix = mode ? `[${SFX_MODE_NAMES[mode] || mode}] ` : "";
        const b = Button(`${prefix}${elide(kw, 22)}  →  ${elide(fo, 22)}`, {});
        b.classList.add("rule-btn");
        if (isBuiltin) {
          b.setTip(full + "\n" + this.t("rule_builtin_tip"));
          const first = (rule.fonts || [])[0];
          if (first) b.addEventListener("click", () => this._select_font(first));
          b.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            popupMenu(e, [
              { label: this.t("menu_edit"), onClick: () => this._edit_builtin_rule(rule) },
              { separator: true },
              { label: this.t("menu_hide"), onClick: () => this._hide_builtin_rule(rule) },
            ]);
          });
        } else {
          let tip = full + "\n" + this.t("rule_tip");
          if (mode) tip += "\n" + this.t("rule_mode_tip", { mode: SFX_MODE_NAMES[mode] || mode });
          b.setTip(tip);
          b.addEventListener("click", () => this._edit_font_rule(rule));
          b.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            popupMenu(e, [
              { label: this.t("menu_edit"), onClick: () => this._edit_font_rule(rule) },
              { separator: true },
              { label: this.t("menu_delete"), onClick: () => this._delete_font_rule(rule) },
            ]);
          });
        }
        this.rules_box.appendChild(b);
      }
    }
  }

  _hide_builtin_rule(rule) {
    const arr = this._hidden_arr();
    const k = this._builtin_key(rule);
    if (!arr.includes(k)) arr.push(k);
    this._save_hidden();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_builtin_hidden");
  }

  async _edit_builtin_rule(rule) {
    const res = await this._prompt_font_rule(rule.group || "", (rule.keywords || []).join(", "), (rule.fonts || []).join(", "));
    if (!res) return;
    const [group, keywords, fonts] = res;
    const arr = this._hidden_arr();
    const k = this._builtin_key(rule);
    if (!arr.includes(k)) arr.push(k);
    this._save_hidden();
    this._font_rules.push({ group, keywords, fonts, lang: rule.lang || "*", mode: this._mode });
    this._save_rules();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_rule_updated");
  }

  /** Every font family the SFX side names (for the Missing-fonts report). */
  referenced_fonts() {
    const seen = [];
    const add = (f) => {
      const s = String(f || "").trim();
      if (s && !seen.includes(s)) seen.push(s);
    };
    for (const p of SFX_PRESETS) add(p.font);
    for (const p of this._user_presets) add(p.font);
    for (const r of this._font_rules) for (const f of r.fonts || []) add(f);
    return seen;
  }

  async _ask_fonts(init) {
    let line;
    const ok = await dialog(this.t("dlg_rule_fonts_title"), (body) => {
      const pick = TextField({});
      const matches = h("div", { class: "font-matches" });
      show(matches, false);
      line = TextField({ value: init });
      const addCur = () => {
        const name = pick.text().trim();
        if (!name) return;
        const ex = line.text().split(",").map((f) => f.trim()).filter((f) => f);
        if (!ex.includes(name)) ex.push(name);
        line.setText(ex.join(", "));
      };
      pick.addEventListener("input", () => {
        clear(matches);
        const q = pick.text().trim().toLowerCase();
        const hits = q ? this._families().filter((f) => f.toLowerCase().includes(q)).slice(0, 10) : [];
        for (const f of hits) {
          const r = h("div", { class: "font-match", text: f });
          r.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            pick.setText(f);
            show(matches, false);
          });
          matches.appendChild(r);
        }
        show(matches, hits.length > 0);
      });
      body.append(hint(this.t("dlg_rule_fonts_label")), row(pick, Button(this.t("add_font_btn"), { onClick: addCur })), matches, line);
    }, [{ label: this.t("cancel"), value: false }, { label: "OK", value: true, variant: "cta" }], { width: 380 });
    return ok ? line.text() : null;
  }

  async _prompt_font_rule(groupInit, kwInit, fontsInit) {
    const items = [...this._existing_groups()];
    if (groupInit && !items.includes(groupInit)) items.unshift(groupInit);
    let group;
    const ok = await dialog(this.t("dlg_rule_group_title"), (body) => {
      group = TextField({ value: groupInit });
      const list = Select([{ label: "—", value: "" }, ...items.map((g) => ({ label: g, value: g }))], { onChange: (v) => group.setText(v || "") });
      body.append(hint(this.t("dlg_rule_group_label")), list, group);
    }, [{ label: this.t("cancel"), value: false }, { label: "OK", value: true, variant: "cta" }]);
    if (!ok) return null;
    const g = group.text().trim();
    const kwText = await promptBox(this.t("dlg_rule_kw_title"), this.t("dlg_rule_kw_label"), kwInit);
    if (kwText === null) return null;
    const keywords = kwText.split(",").map((k) => k.trim().toLowerCase()).filter((k) => k);
    if (!keywords.length) {
      this._warn(this.t("warn_no_keyword"));
      return null;
    }
    const fontsText = await this._ask_fonts(fontsInit);
    if (fontsText === null) return null;
    const fonts = fontsText.split(",").map((f) => f.trim()).filter((f) => f);
    if (!fonts.length) {
      this._warn(this.t("warn_no_font"));
      return null;
    }
    return [g, keywords, fonts];
  }

  async _add_font_rule() {
    const res = await this._prompt_font_rule("", "", this.font_input.text());
    if (!res) return;
    const [group, keywords, fonts] = res;
    this._font_rules.push({ group, keywords, fonts, lang: this._rule_lang, mode: this._mode });
    this._save_rules();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_rule_added");
  }

  async _edit_font_rule(rule) {
    const res = await this._prompt_font_rule(rule.group || "", (rule.keywords || []).join(", "), (rule.fonts || []).join(", "));
    if (!res) return;
    [rule.group, rule.keywords, rule.fonts] = res;
    this._save_rules();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_rule_updated");
  }

  async _delete_font_rule(rule) {
    if (!(await confirmBox(this.t("dlg_delrule_title"), this.t("dlg_delrule_q"), this.app._tr("yes"), this.app._tr("no")))) return;
    this._font_rules = this._font_rules.filter((r) => r !== rule);
    this._save_rules();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_rule_deleted");
  }

  // ==================================================================
  //  insert / restyle / read back
  // ==================================================================

  async _sfx_from_layer() {
    const cur = await activeTextLayer();
    if (!cur || !cur.text.trim()) {
      this._warn(this.t("st_no_layer_text"));
      return;
    }
    this.text_input.setText(cur.text.trim());
    this._debounced();
    try {
      this.text_input.focus();
    } catch (e) {
      // no focus
    }
  }

  async _restyle_sfx() {
    if (this.pattern_chk.isChecked()) await this._load_pattern_img();
    const text = this._effective_text();
    const [ok, key, fmt] = await restyleSfxLayer(text, this._style());
    if (!ok) {
      this._warn(this.t(key, fmt));
      return;
    }
    this._record_usage(text || "", this.font_input.text().trim());
    this.status_label.textContent = this.t("st_restyled");
  }

  async _insert_sfx() {
    const info = docInfo();
    if (!info) {
      this._warn(this.t("st_no_doc"));
      return;
    }
    const sid = this._strategy();
    if (!MODES.insertsText(sid)) {
      const raw = this.text_input.text().trim();
      this._info(this.t("st_sfx_ignored", { word: raw || "—" }));
      if (this.v_clear_after_chk.isChecked()) this.text_input.setText("");
      return;
    }
    let text;
    if (sid === "note") {
      const source = this.text_input.text().trim();
      if (!source) {
        this._warn(this.t("st_no_text"));
        return;
      }
      const idx = this._notes.length + 1;
      this._notes.push(MODES.noteLine(idx, source, this.note_meaning_input.text().trim()));
      this._update_note_btn();
      text = MODES.noteMarker(idx);
    } else {
      text = this._effective_text();
      if (!text) {
        this._warn(this.t("st_no_text"));
        return;
      }
    }
    if (this.pattern_chk.isChecked()) await this._load_pattern_img();
    let [bx, by, bw, bh] = [0, 0, info.w, info.h];
    const sel = await selectionBounds();
    if (sel && sel[2] > 0 && sel[3] > 0) [bx, by, bw, bh] = sel;
    const fsize = this.size.num();
    let size = fsize;
    let outlinePx = null;
    let tx;
    let ty;
    if (sid === "note") {
      size = Math.max(10, Math.round(fsize * 0.35));
      outlinePx = Math.max(2, this.out.num());
      tx = bx + size * 0.6;
      ty = by + size;
    } else if (sid === "romaji" || sid === "overlay") {
      size = Math.max(8, Math.round(fsize * 0.45));
      outlinePx = Math.max(2, this.out.num());
      tx = bx + bw / 2.0;
      ty = by + bh + size * 0.9;
    } else {
      tx = bx + bw / 2.0;
      ty = by + bh / 2.0 + size * 0.35;
    }
    ty = Math.min(ty, info.h - size * 0.3);
    ty = Math.max(ty, size);
    tx = Math.min(Math.max(tx, size * 0.5), info.w - size * 0.5);
    const [ok, key, fmt] = await insertSfxLayer(text, this._style(), tx, ty, { size, outlinePx });
    if (!ok) {
      this._warn(this.t(key, fmt));
      return;
    }
    const style = this._capture_state();
    delete style.text;
    SFX.set("last_settings", style);
    this._record_usage(text, this.font_input.text().trim());
    this.status_label.textContent = this.t("st_layer_created");
    if (this.v_clear_after_chk.isChecked()) {
      this.text_input.setText("");
      try {
        this.text_input.focus();
      } catch (e) {
        // no focus
      }
    }
  }

  // ==================================================================
  //  reset
  // ==================================================================

  async _reset() {
    const choice = await chooseBox(this.t("reset_title"), this.t("reset_q"), [this.t("reset_style"), this.t("reset_all")], "OK", this.t("cancel"));
    if (choice === null || choice === undefined) return;
    let msg;
    if (choice === 1) {
      this._user_presets = [];
      this._font_rules = [];
      this._hidden_modes = {};
      this._hidden_global = [];
      this._save_presets();
      this._save_rules();
      SFX.set("hidden_builtins_modes", {});
      SFX.set("hidden_builtins", []);
      this._rebuild_presets();
      this._rebuild_rules();
      msg = this.t("st_reset_all");
    } else {
      msg = this.t("st_reset_style");
    }
    this._reset_style_to_defaults();
    SFX.set("last_settings", {});
    this.status_label.textContent = msg;
  }

  _reset_style_to_defaults() {
    if (SFX_FONTS.length) this._select_font(SFX_FONTS[0], false);
    this.size.setNum(DEFAULTS.size);
    this.out.setNum(DEFAULTS.outline_px);
    this.out2.setNum(DEFAULTS.outline2_px || 0);
    this._setColor(this.fill_btn, DEFAULTS.fill);
    this._setColor(this.outline_btn, DEFAULTS.outline);
    this._setColor(this.outline2_btn, DEFAULTS.outline2 || "#000000");
    this.pattern_scale.setNum(100);
    this._clear_pattern();
    this.pattern_chk.setChecked(false);
    this.soft_chk.setChecked(false);
    this.soft_pattern_chk.setChecked(false);
    this.soft_width.setNum(3);
    this.soft_blur.setNum(8);
    this._setColor(this.soft_color_btn, "#000000");
    this._update_soft_enabled();
    this.shadow_chk.setChecked(!!DEFAULTS.shadow);
    this._setColor(this.shadow_btn, DEFAULTS.shadow_color || "#000000");
    this.shadow_dx.setNum(Math.trunc(DEFAULTS.shadow_dx ?? 6));
    this.shadow_dy.setNum(Math.trunc(DEFAULTS.shadow_dy ?? 6));
    this._update_shadow_enabled();
    this.grad_chk.setChecked(false);
    this._update_grad_enabled();
    this.rot.setNum(0);
    this.upper_chk.setChecked(true);
    this.bold_chk.setChecked(false);
    this.italic_chk.setChecked(false);
    this.text_input.setText("");
    this._update_preview();
  }

  _warn(msg) {
    this.status_label.textContent = "⚠ " + msg;
  }

  _info(msg) {
    this.status_label.textContent = msg;
  }

  // ==================================================================
  //  import / export
  // ==================================================================

  _exported_fonts() {
    const seen = [];
    const add = (f) => {
      const s = String(f || "").trim();
      if (s && !seen.includes(s)) seen.push(s);
    };
    for (const p of this._user_presets) add(p.font);
    for (const r of this._font_rules) for (const f of r.fonts || []) add(f);
    return seen;
  }

  async _export_data() {
    const choice = await chooseBox(this.t("export_title"), "", ["manga_sfx_presets.zip", "manga_sfx_presets.json"], "OK", this.t("cancel"));
    if (choice === null || choice === undefined) return;
    const data = { manga_sfx: 1, presets: this._user_presets.map((p) => {
      const q = { ...p };
      delete q.user;
      return q;
    }), font_rules: this._font_rules };
    const blob = JSON.stringify(data, null, 2);
    try {
      let path;
      if (choice === 1) {
        path = await pickSave("manga_sfx_presets.json", ["json"], blob);
      } else {
        const zip = new JSZip();
        zip.file("manga_sfx_presets.json", blob);
        let files = {};
        try {
          [files] = await collectFiles(this._exported_fonts());
        } catch (e) {
          files = {};
        }
        for (const [src, name] of fontZipNames(files)) {
          try {
            zip.file(name, await readBytes(src));
          } catch (e) {
            // unreadable font: skipped
          }
        }
        path = await pickSave("manga_sfx_presets.zip", ["zip"], await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
      }
      if (!path) return;
    } catch (e) {
      this._warn(this.t("st_export_fail", { err: e.message || e }));
      return;
    }
    this.status_label.textContent = this.t("st_exported", { p: this._user_presets.length, r: this._font_rules.length });
  }

  async _import_data() {
    const f = await pickOpen(["zip", "json"]);
    if (!f) return;
    let data;
    let fonts = [];
    try {
      if (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b) {
        const zip = await JSZip.loadAsync(f.bytes);
        const names = Object.keys(zip.files);
        const member = names.includes("manga_sfx_presets.json") ? "manga_sfx_presets.json" : names.find((n) => n.toLowerCase().endsWith(".json")) || "";
        data = member ? JSON.parse(await zip.file(member).async("string")) : {};
        for (const n of names) {
          if (n.startsWith("fonts/") && !n.endsWith("/")) fonts.push({ name: n.split("/").pop(), bytes: await zip.file(n).async("uint8array") });
        }
      } else {
        data = JSON.parse(decodeBytes(f.bytes));
      }
    } catch (e) {
      this._warn(this.t("st_import_fail", { err: e.message || e }));
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      this._warn(this.t("st_import_bad"));
      return;
    }
    const presets = this._sanitize_presets(data.presets || []);
    const rules = this._sanitize_rules(data.font_rules || []);
    for (const r of rules) if (!r.mode) r.mode = this._mode;
    if (!presets.length && !rules.length) {
      this._warn(this.t("st_import_empty"));
      return;
    }
    const choice = await chooseBox(this.t("import_title"), this.t("import_q", { p: presets.length, r: rules.length }),
      [this.t("import_merge"), this.t("import_replace")], "OK", this.t("cancel"));
    if (choice === null || choice === undefined) return;
    if (choice === 1) {
      this._user_presets = presets;
      this._font_rules = rules;
    } else {
      this._merge_presets(presets);
      this._merge_rules(rules);
    }
    this._save_presets();
    this._save_rules();
    if (fonts.length) {
      await this.app._install_fonts_and_refresh(fonts);
      this._font_index = null;
    }
    this._rebuild_presets();
    this._rebuild_rules();
    this._refresh_suggestions(this.text_input.text());
    this.status_label.textContent = this.t("st_imported", { p: presets.length, r: rules.length });
  }

  _sanitize_presets(raw) {
    if (!Array.isArray(raw)) return [];
    const int = (v, d) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && v !== null && v !== "" && v !== undefined ? n : d;
    };
    const out = [];
    for (const p of raw) {
      if (!p || typeof p !== "object" || !p.name) continue;
      const kws = p.keywords;
      out.push({
        name: String(p.name).trim(), font: String(p.font || ""),
        size: int(p.size, DEFAULTS.size), fill: String(p.fill || DEFAULTS.fill), outline: String(p.outline || DEFAULTS.outline),
        outline_px: int(p.outline_px, DEFAULTS.outline_px), outline2: String(p.outline2 || DEFAULTS.outline2 || "#000000"),
        outline2_px: int(p.outline2_px, DEFAULTS.outline2_px || 0), pattern: String(p.pattern || ""), pattern_krita: String(p.pattern_krita || ""),
        pattern_on: !!p.pattern_on, pattern_scale: int(p.pattern_scale, 100), soft_on: !!p.soft_on, soft_pattern: !!p.soft_pattern,
        soft_color: String(p.soft_color || "#000000"), soft_width: int(p.soft_width, 3), soft_blur: int(p.soft_blur, 8),
        bold: !!p.bold, italic: !!p.italic, shadow: !!p.shadow, shadow_color: String(p.shadow_color || DEFAULTS.shadow_color || "#000000"),
        shadow_dx: int(p.shadow_dx, DEFAULTS.shadow_dx ?? 6), shadow_dy: int(p.shadow_dy, DEFAULTS.shadow_dy ?? 6),
        keywords: Array.isArray(kws) ? kws.map((k) => String(k).trim().toLowerCase()).filter((k) => k) : [],
        user: true,
      });
    }
    return out;
  }

  _sanitize_rules(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
      if (!r || typeof r !== "object" || !Array.isArray(r.keywords) || !Array.isArray(r.fonts)) continue;
      const keywords = r.keywords.map((k) => String(k).trim().toLowerCase()).filter((k) => k);
      const fonts = r.fonts.map((f) => String(f).trim()).filter((f) => f);
      if (!keywords.length || !fonts.length) continue;
      out.push({ group: String(r.group || "").trim(), keywords, fonts, lang: String(r.lang || "").trim() || "*", mode: String(r.mode || "").trim() });
    }
    return out;
  }

  _merge_presets(imported) {
    const names = new Set(imported.map((p) => p.name));
    this._user_presets = [...this._user_presets.filter((p) => !names.has(p.name)), ...imported];
  }

  _merge_rules(imported) {
    const key = (r) => `${(r.group || "").trim().toLowerCase()}\u0000${r.lang || "*"}\u0000${r.mode || ""}`;
    const index = new Map();
    this._font_rules.forEach((r, i) => {
      if (!index.has(key(r))) index.set(key(r), i);
    });
    for (const r of imported) {
      const k = key(r);
      if (index.has(k)) {
        const tgt = this._font_rules[index.get(k)];
        for (const kw of r.keywords) if (!tgt.keywords.includes(kw)) tgt.keywords.push(kw);
        for (const f of r.fonts) if (!tgt.fonts.includes(f)) tgt.fonts.push(f);
      } else {
        index.set(k, this._font_rules.length);
        this._font_rules.push(r);
      }
    }
  }
}

// --- the preview painter (SFXPreview) -------------------------------------------------------

/** The light-grey checkerboard behind the SFX preview. */
export function sfxChecker(w, hh, tile = 8) {
  const out = new Uint8Array(w * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dark = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 1;
      const v = dark ? 0x88 : 0x9a;
      const o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Fit the word into the area (6..240 px), centre it, rotate it about its
 *  optical centre and paint it: soft -> shadow -> outline2 -> outline -> fill. */
export function renderSfx(rgba, w, hh, text, faces, bold, s) {
  const face = bold ? faces.bold : faces.regular;
  const m = faceMetrics(face);
  const M = 8;
  const availW = Math.max(10, w - 2 * M);
  const availH = Math.max(10, hh - 2 * M);
  let lo = 6;
  let hi = 240;
  let best = 6;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const adv = advance(face, text, mid, true);
    const lh = (m.ascent + m.descent) * mid / m.upm;
    if (adv <= availW && lh <= availH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const fs = best;
  const asc = m.ascent * fs / m.upm;
  const lh = (m.ascent + m.descent) * fs / m.upm;
  const adv = advance(face, text, fs, true);
  const x = M + (availW - adv) / 2.0;
  const baseline = M + (availH - lh) / 2.0 + asc;
  let contours = glyphContours(face, text, x, baseline, fs, { fauxItalic: faces.fauxItalic });
  const angle = s.rotate || 0;
  if (angle) {
    const cx = x + adv / 2.0;
    const cy = baseline - asc / 2.0;
    const a = angle * Math.PI / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    contours = contours.map((c) => c.map(([px, py]) => [cx + (px - cx) * ca - (py - cy) * sa, cy + (px - cx) * sa + (py - cy) * ca]));
  }
  const scale = fs / Math.max(1, s.size);
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of contours) {
    for (const [, py] of c) {
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
  }
  const pat = s.patternTile ? { ...s.patternTile, scale: (s.patternTile.scale || 100) * scale } : null;
  renderStyled(rgba, w, hh, contours, {
    color: s.fill,
    fillPattern: pat || (s.fill2 ? { grad: { top: s.fill, bottom: s.fill2, y0, y1 } } : null),
    outline: {
      on: s.outlinePx > 0,
      w: s.outlinePx > 0 ? Math.max(0.5, 2 * s.outlinePx * scale) : 0,
      color: s.outline,
      w2: s.outlinePx > 0 && s.outline2Px > 0 ? Math.max(0.5, 2 * s.outline2Px * scale) : 0,
      color2: s.outline2,
      pattern: s.softPattern ? pat : null,
      target: "none",
    },
    shadow: { on: s.shadow, dx: s.shadowDx * scale, dy: s.shadowDy * scale, color: s.shadowColor },
    soft: { on: s.soft, w: s.softWidth * scale, blur: s.softBlur * scale, color: s.softColor, pattern: s.softPattern },
    fauxBold: faces.fauxBoldRuns && bold ? Math.max(0.3, fs * 0.02) : 0,
  });
  return rgba;
}
