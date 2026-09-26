// Presets: Manga -> Character -> style preset, main characters, preset
// keybinds, auto manga / auto character, usage learning, import / export
// (JSON, bundle with fonts, Excel font guide).
//
// Port of the TyperDocker preset methods (_normalize … on_preset_import_excel,
// MainCharsDialog, PresetKeyHook). Same settings keys: presets, lastManga,
// presetUsage, mainChars, presetKeys, autoChar, autoManga, presetsByCharacter.

import JSZip from "jszip";
import { h, clear, show, row, hint, Button, ActionButton, Check, Select, TextField,
  promptBox, chooseBox, alertBox, dialog, popupMenu } from "./dom.js";
import { T } from "../host/settings.js";
import { pickOpen, pickSave, writeBytes, makeDir, dataFolderPath } from "../host/files.js";
import { collectFiles } from "../host/fonts.js";
import { openPath } from "../host/ps.js";
import { readBytes } from "../host/files.js";
import * as LP from "../core/langpair.js";
import { readXlsxGrid, decodeBytes } from "../core/readers.js";
import { writeXlsx } from "../core/xlsx.js";
import { presetsToTable } from "../core/textprep.js";
import { fontZipNames } from "../core/fontfiles.js";

const CFG_KEYS = ["size", "font", "color", "align", "valign", "case", "caps", "outline", "shadow", "spacing", "pad"];

const byLower = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// --- keys (Qt's QKeySequence spelling, so a binding reads the same) -------------

const NAMED = {
  " ": "Space", Enter: "Return", Escape: "Esc", Backspace: "Backspace", Tab: "Tab", Delete: "Del", Insert: "Ins",
  Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDown", ArrowLeft: "Left", ArrowRight: "Right",
  ArrowUp: "Up", ArrowDown: "Down",
};

/** "Ctrl+Alt+1" for a keydown event; "" for a lone modifier. */
export function keyEventString(e) {
  const k = e.key;
  if (["Control", "Alt", "Shift", "Meta", "OS", "AltGraph", "CapsLock"].includes(k)) return "";
  let name;
  const code = e.code || "";
  if (/^Digit\d$/.test(code)) name = code.slice(5);
  else if (/^Numpad\d$/.test(code)) name = code.slice(6);
  else if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  else if (/^F\d{1,2}$/.test(k)) name = k;
  else if (NAMED[k]) name = NAMED[k];
  else if (k && k.length === 1) name = k.toUpperCase();
  else return "";
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  return [...mods, name].join("+");
}

export function keyHasModifier(e) {
  return !!(e.ctrlKey || e.altKey || e.metaKey);
}

/** A field that records one key combination (QKeySequenceEdit). */
function KeyField(onDone) {
  const el = h("div", { class: "keyfield", tabindex: "0" });
  let key = "";
  let enabled = true;
  const paint = () => {
    el.textContent = key || "—";
    el.classList.toggle("empty", !key);
  };
  el.isRecorder = true;
  el.key = () => key;
  el.setKey = (k) => {
    key = k || "";
    paint();
  };
  el.setEnabled = (on) => {
    enabled = !!on;
    el.classList.toggle("disabled", !enabled);
  };
  el.setTip = (t) => { el.title = t || ""; };
  el.addEventListener("keydown", (e) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    const s = keyEventString(e);
    if (!s) return;
    key = s;
    paint();
    onDone(key);
  });
  el.addEventListener("focus", () => el.classList.add("recording"));
  el.addEventListener("blur", () => el.classList.remove("recording"));
  paint();
  return el;
}

export const PresetMethods = {
  _build_presets_panel(body) {
    const t = (k, f) => this._tr(k, f);
    this.lbl_preset = h("div", { class: "lbl" });
    this.lbl_group = h("span", { class: "lbl" });
    this.group_combo = Select([], { onChange: () => this._on_group_selected() });
    this.group_new_btn = Button("", { onClick: () => this.on_group_new() });
    this.group_del_btn = Button("", { onClick: () => this.on_group_delete() });
    this.lbl_char = h("span", { class: "lbl" });
    this.char_combo = Select([], { onChange: () => this._on_char_selected() });
    this.char_combo.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this._char_context_menu(e);
    });
    this.char_new_btn = Button("", { onClick: () => this.on_char_new() });
    this.char_del_btn = Button("", { onClick: () => this.on_char_delete() });
    this.auto_char_chk = Check("", {
      checked: T.bool("autoChar", true),
      onChange: (on) => {
        T.setBool("autoChar", on);
        if (on) this._show_current();
      },
    });
    this.auto_manga_chk = Check("", { checked: T.bool("autoManga", true), onChange: (on) => T.setBool("autoManga", on) });
    // activated: re-picking the same preset re-applies it
    this.preset_combo = Select([], { activated: true, onChange: () => this._on_preset_selected() });
    this.preset_menu_btn = ActionButton("⋯", {
      quiet: false,
      onClick: () => popupMenu(this.preset_menu_btn, [
        { label: t("preset_save"), onClick: () => this.on_preset_save() },
        { label: t("preset_del"), onClick: () => this.on_preset_delete() },
        { separator: true },
        { label: t("preset_import"), onClick: () => this.on_preset_import() },
        { label: t("preset_import_excel"), onClick: () => this.on_preset_import_excel() },
        { label: t("preset_export"), onClick: () => this.on_preset_export() },
      ]),
    });
    this.lbl_preset_key = h("span", { class: "lbl" });
    this.preset_key_edit = KeyField(() => this._on_preset_key_edited());
    this.preset_key_clear_btn = ActionButton("✕", { onClick: () => this.on_preset_key_clear() });
    this.preset_key_hint = hint();
    this._char_row = row(this.lbl_char, this.char_combo, this.char_new_btn, this.char_del_btn);
    body.append(this.lbl_preset,
      row(this.lbl_group, this.group_combo, this.group_new_btn, this.group_del_btn),
      this._char_row, this.auto_char_chk, this.auto_manga_chk,
      row(this.preset_combo, this.preset_menu_btn),
      row(this.lbl_preset_key, this.preset_key_edit, this.preset_key_clear_btn),
      this.preset_key_hint);
    this._rt(() => {
      this.lbl_preset.textContent = t("style_label");
      this.lbl_group.textContent = t("group");
      this.group_new_btn.setText(t("group_new"));
      this.group_del_btn.setText(t("group_del"));
      this.lbl_char.textContent = t("char");
      this.char_new_btn.setText(t("char_new"));
      this.char_del_btn.setText(t("char_del"));
      this.auto_char_chk.setText(t("auto_char"));
      this.auto_char_chk.setTip(t("auto_char_tip"));
      this.auto_manga_chk.setText(t("auto_manga"));
      this.auto_manga_chk.setTip(t("auto_manga_tip"));
      this.lbl_preset_key.textContent = t("preset_key");
      this.preset_key_edit.setTip(t("preset_key_tip"));
      this.preset_key_clear_btn.setTip(t("preset_key_clear_tip"));
      this.preset_menu_btn.setTip(t("preset_actions"));
      this.preset_key_hint.textContent = t("keys_focus_hint");
      if (this.preset_combo.count()) this.preset_combo.setLabelAt(0, t("preset_none"));
    });
  },

  // -- storage ------------------------------------------------------------------

  _is_cfg(d) {
    return isObj(d) && CFG_KEYS.some((k) => k in d);
  },

  /** Any old format -> {Manga: {Character: {Name: config}}}. */
  _normalize(data) {
    if (!isObj(data) || !Object.keys(data).length) return {};
    const md = this._tr("group_default");
    const cd = this._tr("char_default");
    const onlyCfg = (o) => Object.fromEntries(Object.entries(o).filter(([, c]) => isObj(c)).map(([n, c]) => [String(n), c]));
    if (Object.values(data).some((v) => this._is_cfg(v))) return { [md]: { [cd]: onlyCfg(data) } };
    const two = Object.values(data).some((v) => isObj(v) && Object.values(v).some((vv) => this._is_cfg(vv)));
    const out = {};
    if (two) {
      for (const [g, presets] of Object.entries(data)) if (isObj(presets)) out[String(g)] = { [cd]: onlyCfg(presets) };
      return out;
    }
    for (const [m, chars] of Object.entries(data)) {
      if (!isObj(chars)) continue;
      out[String(m)] = {};
      for (const [ch, presets] of Object.entries(chars)) if (isObj(presets)) out[String(m)][String(ch)] = onlyCfg(presets);
    }
    return out;
  },

  _load_groups() {
    let v = T.get("presets", {});
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch (e) {
        v = {};
      }
    }
    return this._normalize(v);
  },

  _save_groups() {
    T.set("presets", this._groups);
  },

  _load_last_manga() {
    const d = T.get("lastManga", {});
    return isObj(d) ? d : {};
  },

  _save_last_manga() {
    T.set("lastManga", { group: this._group, char: this._char });
  },

  _ensure_levels() {
    if (!Object.keys(this._groups).length) this._groups = { [this._tr("group_default")]: {} };
    if (!(this._group in this._groups)) this._group = Object.keys(this._groups).sort(byLower)[0];
    const chars = this._groups[this._group];
    if (!Object.keys(chars).length) chars[this._tr("char_default")] = {};
    if (!(this._char in chars)) this._char = Object.keys(chars).sort(byLower)[0];
  },

  _cur_chars() {
    return this._groups[this._group] || {};
  },

  _cur_presets() {
    return this._cur_chars()[this._char] || {};
  },

  // -- preset mode ------------------------------------------------------------------

  _by_char() {
    return this.by_char_chk ? this.by_char_chk.isChecked() : true;
  },

  _on_by_char_toggle(on) {
    T.setBool("presetsByCharacter", on);
    this._apply_preset_mode();
  },

  _apply_preset_mode() {
    const byChar = this._by_char();
    show(this._char_row, byChar);
    show(this.auto_char_chk, byChar);
    this._refresh_presets_combo();
  },

  // -- main characters -------------------------------------------------------------------

  _load_main_chars() {
    const data = T.get("mainChars", {});
    if (!isObj(data)) return {};
    const out = {};
    for (const [m, names] of Object.entries(data)) {
      if (Array.isArray(names)) out[String(m)] = names.map(String).filter((n) => n.trim());
    }
    return out;
  },

  _save_main_chars() {
    T.set("mainChars", this._main_chars_map);
  },

  _main_chars(manga = null) {
    return [...(this._main_chars_map[manga || this._group] || [])];
  },

  _is_main_char(ch, manga = null) {
    const low = (ch || "").trim().toLowerCase();
    return this._main_chars(manga).some((c) => c.toLowerCase() === low);
  },

  _toggle_main_char(ch, manga = null) {
    ch = (ch || "").trim();
    if (!ch) return false;
    manga = manga || this._group;
    let names = [...(this._main_chars_map[manga] || [])];
    const low = ch.toLowerCase();
    let now;
    if (names.some((c) => c.toLowerCase() === low)) {
      names = names.filter((c) => c.toLowerCase() !== low);
      now = false;
    } else {
      names.push(ch);
      now = true;
    }
    if (names.length) this._main_chars_map[manga] = names;
    else delete this._main_chars_map[manga];
    this._save_main_chars();
    return now;
  },

  _forget_main_char(ch, manga = null) {
    manga = manga || this._group;
    const names = this._main_chars_map[manga];
    if (!names) return;
    const low = (ch || "").trim().toLowerCase();
    const rest = names.filter((c) => c.toLowerCase() !== low);
    if (rest.length) this._main_chars_map[manga] = rest;
    else delete this._main_chars_map[manga];
    this._save_main_chars();
  },

  /** Setup button: pick each manga's main characters (MainCharsDialog). */
  async on_main_chars() {
    const t = (k, f) => this._tr(k, f);
    const work = {};
    for (const [m, names] of Object.entries(this._main_chars_map)) work[m] = [...names];
    let boxes = {};
    let mangaSel = null;
    const collect = () => {
      const manga = mangaSel ? mangaSel.value() : "";
      if (!manga || !Object.keys(boxes).length) return;
      const chosen = Object.entries(boxes).filter(([, cb]) => cb.isChecked()).map(([n]) => n).sort(byLower);
      if (chosen.length) work[manga] = chosen;
      else delete work[manga];
    };
    const res = await dialog(t("mainchar_title"), (body) => {
      const list = h("div", { class: "scroll-list" });
      const build = () => {
        clear(list);
        boxes = {};
        const manga = mangaSel.value();
        const chars = this._groups[manga] || {};
        const starred = new Set((work[manga] || []).map((c) => c.toLowerCase()));
        const names = Object.keys(chars).map(String).sort(byLower);
        if (!names.length) list.appendChild(hint(t("mainchar_none")));
        for (const name of names) {
          const cb = Check(`${name}  (${Object.keys(chars[name] || {}).length})`, { checked: starred.has(name.toLowerCase()), onChange: collect });
          boxes[name] = cb;
          list.appendChild(cb);
        }
      };
      mangaSel = Select(Object.keys(this._groups).sort(byLower).map((g) => ({ label: g, value: g })), { onChange: build });
      mangaSel.setValue(this._group);
      const clearBtn = Button(t("mainchar_clear"), {
        onClick: () => {
          for (const cb of Object.values(boxes)) cb.setChecked(false);
          collect();
        },
      });
      body.append(hint(t("mainchar_intro")), row(h("span", { class: "lbl", text: t("mainchar_manga") }), mangaSel), list, row(clearBtn));
      build();
    }, [{ label: t("cancel"), value: false }, { label: t("ok"), value: true, variant: "cta" }]);
    if (!res) return;
    collect();
    this._main_chars_map = Object.fromEntries(Object.entries(work).filter(([, v]) => v.length));
    this._save_main_chars();
    this._refresh_chars_combo(this._char);
    this._refresh_presets_combo();
    this._set_status(this._tr("st_mainchar_saved", { n: this._main_chars().length, manga: this._group }));
  },

  _char_context_menu(e) {
    const ch = this.char_combo.value();
    if (!ch) return;
    const isMain = this._is_main_char(ch);
    popupMenu(e, [
      {
        label: this._tr(isMain ? "mainchar_ctx_remove" : "mainchar_ctx_add"),
        onClick: () => {
          const now = this._toggle_main_char(ch);
          this._refresh_chars_combo(ch);
          this._refresh_presets_combo();
          this._set_status(this._tr(now ? "st_mainchar_on" : "st_mainchar_off", { name: ch }));
        },
      },
      { separator: true },
      { label: this._tr("mainchar_btn"), onClick: () => this.on_main_chars() },
    ]);
  },

  _preset_ref(data) {
    if (Array.isArray(data) && data.length === 2) return [String(data[0]), String(data[1])];
    if (data) return [this._char, String(data)];
    return ["", ""];
  },

  _bucket_char() {
    this._ensure_levels();
    const chars = this._groups[this._group];
    const cd = this._tr("char_default");
    if (cd in chars) return cd;
    return Object.keys(chars).sort(byLower)[0];
  },

  // -- auto manga / auto character ------------------------------------------------------

  _maybe_auto_manga(text, filename = "") {
    if (!this.auto_manga_chk || !this.auto_manga_chk.isChecked()) return;
    const match = LP.detectManga(Object.keys(this._groups), text, filename || "");
    if (!match || match === this._group) return;
    this._group = match;
    this._char = "";
    this._refresh_groups_combo(match);
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    this._apply_default_preset();
    this._save_last_manga();
    this._set_status(this._tr("st_auto_manga", { name: match }));
  },

  _maybe_auto_character(text) {
    if (!this._by_char()) return text;
    if (!this.auto_char_chk || !this.auto_char_chk.isChecked()) return text;
    const [name, rest] = LP.splitSpeaker(text);
    if (!name) return text;
    const match = Object.keys(this._cur_chars()).find((ch) => ch.toLowerCase() === name.toLowerCase());
    if (!match) return text;
    if (match !== this._char) {
      this._char = match;
      this._refresh_chars_combo(match);
      this._apply_default_preset();
      this._set_status(this._tr("st_auto_char", { name: match }));
    }
    return rest;
  },

  // -- usage learning ------------------------------------------------------------------------

  _load_preset_usage() {
    const d = T.get("presetUsage", {});
    return isObj(d) ? d : {};
  },

  _save_preset_usage() {
    T.set("presetUsage", this._preset_usage);
  },

  _record_preset_usage(manga, ch, preset) {
    if (!(manga && ch && preset)) return;
    const m = (this._preset_usage[manga] = this._preset_usage[manga] || {});
    const c = (m[ch] = m[ch] || {});
    c[preset] = Math.trunc(Number(c[preset] || 0)) + 1;
    this._save_preset_usage();
  },

  _apply_default_preset() {
    if (!this._by_char()) {
      const entries = LP.flattenPresets(this._cur_chars());
      const byChar = this._preset_usage[this._group] || {};
      const usage = {};
      for (const [, ch, name] of entries) {
        const n = Math.trunc(Number(((byChar[ch] || {})[name]) || 0));
        if (n) usage[name] = (usage[name] || 0) + n;
      }
      const name = LP.defaultPresetFor(entries.map((e) => e[2]), usage);
      for (const [, ch, nm] of entries) {
        if (name && nm === name) {
          this._apply_preset(this._cur_chars()[ch][nm]);
          this._refresh_presets_combo([ch, nm]);
          return;
        }
      }
      this._refresh_presets_combo();
      return;
    }
    const presets = this._cur_presets();
    const usage = (this._preset_usage[this._group] || {})[this._char] || {};
    const name = LP.defaultPresetFor(Object.keys(presets), usage);
    if (name && name in presets) {
      this._apply_preset(presets[name]);
      this._refresh_presets_combo(name);
    } else {
      this._refresh_presets_combo();
    }
  },

  // -- manga level ------------------------------------------------------------------------------

  _refresh_groups_combo(select = null) {
    this._ensure_levels();
    const names = Object.keys(this._groups).sort(byLower);
    this.group_combo.setItems(names.map((g) => ({ label: g, value: g })), false);
    const target = select || this._group;
    if (this.group_combo.setValue(target)) this._group = target;
  },

  _on_group_selected() {
    const g = this.group_combo.value();
    if (g !== undefined && g in this._groups) {
      this._group = g;
      this._char = "";
      this._refresh_chars_combo();
      this._refresh_presets_combo();
      this._save_last_manga();
    }
  },

  async on_group_new() {
    let name = await promptBox(this._tr("group_new_dlg"), this._tr("group_name_prompt"), "");
    if (name === null) return;
    name = name.trim();
    if (!name) {
      this._set_status(this._tr("st_group_name_empty"), true);
      return;
    }
    if (!(name in this._groups)) this._groups[name] = { [this._tr("char_default")]: {} };
    this._group = name;
    this._char = "";
    this._save_groups();
    this._save_last_manga();
    this._refresh_groups_combo(name);
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    this._set_status(this._tr("st_group_saved", { name }));
  },

  on_group_delete() {
    const g = this.group_combo.value();
    if (g === undefined || !(g in this._groups)) {
      this._set_status(this._tr("st_group_none"), true);
      return;
    }
    delete this._groups[g];
    if (g in this._main_chars_map) {
      delete this._main_chars_map[g];
      this._save_main_chars();
    }
    LP.dropKeybinds(this._keybinds, g);
    this._save_keybinds();
    this._char = "";
    this._ensure_levels();
    this._save_groups();
    this._refresh_groups_combo();
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    this._set_status(this._tr("st_group_deleted", { name: g }));
  },

  // -- character level ----------------------------------------------------------------------------

  _refresh_chars_combo(select = null) {
    this._ensure_levels();
    const [main, rest] = LP.sortCharacters(Object.keys(this._cur_chars()), this._main_chars());
    const items = main.map((ch) => ({ label: "★ " + ch, value: ch }));
    if (main.length && rest.length) items.push({ separator: true });
    for (const ch of rest) items.push({ label: ch, value: ch });
    this.char_combo.setItems(items, false);
    const target = select || this._char;
    if (this.char_combo.setValue(target)) this._char = target;
  },

  _on_char_selected() {
    const ch = this.char_combo.value();
    if (ch !== undefined && ch in this._cur_chars()) {
      this._char = ch;
      this._apply_default_preset();
      this._save_last_manga();
    }
  },

  async on_char_new() {
    let name = await promptBox(this._tr("char_new_dlg"), this._tr("char_name_prompt"), "");
    if (name === null) return;
    name = name.trim();
    if (!name) {
      this._set_status(this._tr("st_char_name_empty"), true);
      return;
    }
    this._ensure_levels();
    if (!(name in this._groups[this._group])) this._groups[this._group][name] = {};
    this._char = name;
    this._save_groups();
    this._save_last_manga();
    this._refresh_chars_combo(name);
    this._refresh_presets_combo();
    this._set_status(this._tr("st_char_saved", { name }));
  },

  on_char_delete() {
    const ch = this.char_combo.value();
    if (ch === undefined || !(ch in this._cur_chars())) {
      this._set_status(this._tr("st_char_none"), true);
      return;
    }
    delete this._groups[this._group][ch];
    this._forget_main_char(ch);
    LP.dropKeybinds(this._keybinds, this._group, ch);
    this._save_keybinds();
    this._char = "";
    this._ensure_levels();
    this._save_groups();
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    this._set_status(this._tr("st_char_deleted", { name: ch }));
  },

  // -- preset level ------------------------------------------------------------------------------------

  _refresh_presets_combo(select = null) {
    const keyed = (label, ch, name) => {
      const key = LP.keybindFor(this._keybinds, this._group, ch, name);
      return key ? `${label}  [${key}]` : label;
    };
    const items = [{ label: this._tr("preset_none"), value: null }];
    if (this._by_char()) {
      for (const name of Object.keys(this._cur_presets()).sort(byLower)) items.push({ label: keyed(name, this._char, name), value: name });
    } else {
      const mains = this._main_chars();
      let prevMain = null;
      for (const [label, ch, name] of LP.flattenPresets(this._cur_chars(), mains)) {
        const isMain = this._is_main_char(ch);
        if (prevMain && !isMain) items.push({ separator: true });
        prevMain = isMain;
        items.push({ label: keyed(isMain ? "★ " + label : label, ch, name), value: [ch, name] });
      }
    }
    const prev = this.preset_combo.value();
    this.preset_combo.setItems(items, false);
    if (select !== null) this.preset_combo.setValue(select);
    else if (prev !== undefined && prev !== null) this.preset_combo.setValue(prev);
    this._sync_preset_key_edit();
  },

  _on_preset_selected() {
    const [ch, name] = this._preset_ref(this.preset_combo.value());
    this._sync_preset_key_edit();
    const presets = this._cur_chars()[ch] || {};
    if (name && name in presets) {
      this._apply_preset(presets[name]);
      this._record_preset_usage(this._group, ch, name);
      this._save_last_manga();
      this._set_status(this._tr("st_preset_applied", { name }));
    }
  },

  // -- keybinds -----------------------------------------------------------------------------------------

  _load_keybinds() {
    return LP.cleanKeybinds(T.get("presetKeys", {}) || {});
  },

  _save_keybinds() {
    T.set("presetKeys", this._keybinds);
  },

  _sync_preset_key_edit() {
    if (!this.preset_key_edit) return;
    const [ch, name] = this._preset_ref(this.preset_combo.value());
    this.preset_key_edit.setKey(LP.keybindFor(this._keybinds, this._group, ch, name) || "");
    this.preset_key_edit.setEnabled(!!name);
  },

  _on_preset_key_edited() {
    const [ch, name] = this._preset_ref(this.preset_combo.value());
    if (!name) {
      this._sync_preset_key_edit();
      this._set_status(this._tr("st_preset_none"), true);
      return;
    }
    const key = this.preset_key_edit.key();
    if (!key) return;
    const taken = LP.keybindTarget(this._keybinds, this._group, key);
    LP.setKeybind(this._keybinds, this._group, key, ch, name);
    this._save_keybinds();
    this._refresh_presets_combo(this._by_char() ? name : [ch, name]);
    if (taken[1] && !(taken[0] === ch && taken[1] === name)) {
      this._set_status(this._tr("st_key_moved", { key, old: taken[1], name }));
    } else {
      this._set_status(this._tr("st_key_set", { key, name }));
    }
  },

  on_preset_key_clear() {
    const [ch, name] = this._preset_ref(this.preset_combo.value());
    if (!name) {
      this._sync_preset_key_edit();
      return;
    }
    LP.setKeybind(this._keybinds, this._group, "", ch, name);
    this._save_keybinds();
    this._refresh_presets_combo(this._by_char() ? name : [ch, name]);
    this._set_status(this._tr("st_key_cleared", { name }));
  },

  /** Watch the panel's keys for preset bindings. UXP panels only receive
   *  keys while they have the focus (PORT_PLAN.md §3). */
  _install_key_hook(root) {
    if (this._key_hook) return;
    this._key_hook = (e) => {
      try {
        if (this.handle_preset_key(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (err) {
        // never let a bug here eat typing
      }
    };
    root.addEventListener("keydown", this._key_hook, true);
  },

  handle_preset_key(e) {
    if (e.repeat) return false;
    const binds = this._keybinds[this._group] || {};
    if (!Object.keys(binds).length) return false;
    const ref = binds[keyEventString(e)];
    if (!ref) return false;
    let el = e.target;
    while (el) {
      if (el.isRecorder) return false;             // a key being recorded
      el = el.parentNode;
    }
    const tag = String((e.target && e.target.tagName) || "").toLowerCase();
    const typing = ["textarea", "input", "sp-textfield", "sp-search"].includes(tag) || (e.target && e.target.isContentEditable);
    if (typing && !keyHasModifier(e)) return false;  // that is typing, not a key
    this._trigger_keybind(String(ref[0]), String(ref[1]));
    return true;
  },

  _trigger_keybind(ch, name) {
    const presets = this._cur_chars()[ch] || {};
    if (!(name in presets)) {
      LP.dropKeybinds(this._keybinds, this._group, ch, name);
      this._save_keybinds();
      this._refresh_presets_combo();
      this._set_status(this._tr("st_key_gone", { name }), true);
      return;
    }
    if (this._by_char() && ch && ch !== this._char) {
      this._char = ch;
      this._refresh_chars_combo(ch);
    }
    this._apply_preset(presets[name]);
    this._record_preset_usage(this._group, ch, name);
    this._save_last_manga();
    this._refresh_presets_combo(this._by_char() ? name : [ch, name]);
    this._set_status(ch ? this._tr("st_key_applied", { char: ch, name }) : this._tr("st_preset_applied", { name }));
  },

  // -- save / delete ------------------------------------------------------------------------------------------

  async on_preset_save() {
    const [, current] = this._preset_ref(this.preset_combo.value());
    let name = await promptBox(this._tr("preset_name_dlg"), this._tr("preset_name_prompt"), current);
    if (name === null) return;
    name = name.trim();
    if (!name) {
      this._set_status(this._tr("st_preset_name_empty"), true);
      return;
    }
    this._ensure_levels();
    const target = this._by_char() ? this._char : this._bucket_char();
    const chars = this._groups[this._group];
    chars[target] = chars[target] || {};
    chars[target][name] = this._collect_preset();
    this._save_groups();
    this._refresh_presets_combo(this._by_char() ? name : [target, name]);
    this._set_status(this._tr("st_preset_saved_in", { name, char: target }));
  },

  on_preset_delete() {
    const [ch, name] = this._preset_ref(this.preset_combo.value());
    const presets = this._cur_chars()[ch] || {};
    if (!name || !(name in presets)) {
      this._set_status(this._tr("st_preset_none"), true);
      return;
    }
    delete this._groups[this._group][ch][name];
    LP.dropKeybinds(this._keybinds, this._group, ch, name);
    this._save_keybinds();
    this._save_groups();
    this._refresh_presets_combo();
    this._set_status(this._tr("st_preset_deleted", { name }));
  },

  _count_presets() {
    let n = 0;
    for (const chars of Object.values(this._groups)) for (const pr of Object.values(chars)) n += Object.keys(pr).length;
    return n;
  },

  // -- export ----------------------------------------------------------------------------------------------------

  async on_preset_export() {
    const fmts = [this._tr("preset_fmt_bundle"), this._tr("preset_fmt_json"), this._tr("preset_fmt_xlsx")];
    const choice = await chooseBox(this._tr("preset_export_fmt_title"), this._tr("preset_export_fmt_prompt"), fmts,
      this._tr("ok"), this._tr("cancel"));
    if (choice === null || choice === undefined) return;
    const manga = this._group || "";
    try {
      if (choice === 0) {
        await this._export_presets_bundle(manga ? `TypeR presets (${manga}).zip` : "typer_presets.zip");
      } else if (choice === 2) {
        await this._export_presets_xlsx(manga ? `Fonts (${manga}).xlsx` : "Fonts.xlsx");
      } else {
        const path = await pickSave("typer_presets.json", ["json"], JSON.stringify(this._groups, null, 2));
        if (!path) return;
        this._set_status(this._tr("st_preset_exported", { n: this._count_presets() }));
      }
    } catch (exc) {
      this._set_status(this._tr("st_read_fail", { exc: exc && exc.message ? exc.message : exc }), true);
    }
  },

  _main_preset_fonts() {
    const out = [];
    for (const manga of Object.values(this._groups || {})) {
      for (const ch of Object.values(manga || {})) {
        for (const cfg of Object.values(ch || {})) {
          if (isObj(cfg)) {
            const f = String(cfg.font || "").trim();
            if (f) out.push(f);
          }
        }
      }
    }
    return out;
  },

  _dedup_ci(fonts) {
    const seen = new Set();
    const out = [];
    for (const f of fonts) {
      const fl = String(f || "").trim().toLowerCase();
      if (fl && !seen.has(fl)) {
        seen.add(fl);
        out.push(String(f).trim());
      }
    }
    return out;
  },

  preset_font_names() {
    return this._dedup_ci(this._main_preset_fonts());
  },

  /** presets.json plus every font file the presets name, as one .zip. */
  async _export_presets_bundle(suggested) {
    const fams = this.preset_font_names();
    this._set_status(this._tr("font_scan"));
    let files = {};
    let missing = [];
    try {
      [files, missing] = await collectFiles(fams, (d, n) => this._set_status(this._tr("index_progress", { done: d, total: n })));
    } catch (e) {
      files = {};
      missing = [...fams];
    }
    const zip = new JSZip();
    zip.file("presets.json", JSON.stringify(this._groups, null, 2));
    let nFiles = 0;
    for (const [src, name] of fontZipNames(files)) {
      try {
        zip.file(name, await readBytes(src));
        nFiles += 1;
      } catch (e) {
        // unreadable font file: skipped, like Krita's add_fonts_to_zip
      }
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const path = await pickSave(suggested, ["zip"], bytes);
    if (!path) {
      this._set_status("");
      return;
    }
    this._set_status(this._tr("st_preset_exported_bundle", { n: this._count_presets(), fonts: nFiles, missing: missing.length }));
    if (missing.length) {
      await alertBox(this._tr("fav_missing_title"), this._tr("fav_missing_intro") + "\n\n• " + missing.slice(0, 40).join("\n• ") +
        (missing.length > 40 ? "\n…" : ""), this._tr("ok"));
    }
  },

  async _export_presets_xlsx(suggested) {
    const chars = this._groups[this._group] || {};
    const [headers, rows] = presetsToTable(chars, (k) => this._tr(k), this._tr("xls_default_char"));
    const sheet = this._group || this._tr("xls_sheet_presets");
    const widths = [24, ...Array(Math.max(0, headers.length - 1)).fill(20)];
    const bytes = await writeXlsx(sheet, headers, rows, widths, 1, 1);
    const path = await pickSave(suggested, ["xlsx"], bytes);
    if (!path) return;
    this._set_status(this._tr("st_preset_exported_xlsx", { n: rows.length }));
  },

  // -- import ---------------------------------------------------------------------------------------------------------

  async on_preset_import() {
    const f = await pickOpen(["json", "zip"]);
    if (!f) return;
    let data;
    let fontEntries = [];
    try {
      if (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b) {
        [data, fontEntries] = await this._read_preset_bundle(f.bytes);
      } else {
        data = JSON.parse(decodeBytes(f.bytes));
      }
      if (!isObj(data)) throw new Error("not a preset object");
    } catch (e) {
      this._set_status(this._tr("st_preset_import_fail"), true);
      return;
    }
    const incoming = this._normalize(data);
    let count = 0;
    for (const [m, chars] of Object.entries(incoming)) {
      const dm = (this._groups[String(m)] = this._groups[String(m)] || {});
      for (const [ch, presets] of Object.entries(chars)) {
        const dc = (dm[String(ch)] = dm[String(ch)] || {});
        for (const [name, cfg] of Object.entries(presets)) {
          dc[String(name)] = cfg;
          count += 1;
        }
      }
    }
    this._save_groups();
    this._refresh_groups_combo();
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    if (fontEntries.length) {
      const res = await this._install_fonts_and_refresh(fontEntries);
      this._set_status(this._tr("st_preset_imported_bundle", { n: count, inst: res.installed.length, skip: res.skipped.length, fail: res.failed.length }));
    } else {
      this._set_status(this._tr("st_preset_imported", { n: count }));
    }
  },

  /** [preset data, [{name, bytes}]] from an exported .zip. */
  async _read_preset_bundle(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    const member = names.includes("presets.json") ? "presets.json" : names.find((n) => n.toLowerCase().endsWith(".json")) || "";
    const data = member ? JSON.parse(await zip.file(member).async("string")) : {};
    const fonts = [];
    for (const n of names) {
      if (n.startsWith("fonts/") && !n.endsWith("/")) fonts.push({ name: n.split("/").pop(), bytes: await zip.file(n).async("uint8array") });
    }
    return [data, fonts];
  },

  /** Photoshop cannot install fonts from a plugin: the bundled files go to
   *  a folder, the folder opens, and the user installs them from there
   *  (PORT_PLAN.md §3). Returns {installed, skipped, failed} like Krita. */
  async _install_fonts_and_refresh(entries) {
    const res = { installed: [], skipped: [], failed: [] };
    let dir;
    try {
      dir = (await dataFolderPath()).replace(/[\\/]$/, "") + "/fonts_to_install";
      await makeDir(dir);
    } catch (e) {
      res.failed = entries.map((x) => x.name || x);
      return res;
    }
    for (const ent of entries) {
      try {
        const bytes = ent.bytes || (await readBytes(ent));
        const name = ent.name || String(ent).split(/[\\/]/).pop();
        await writeBytes(`${dir}/${name}`, bytes);
        res.skipped.push(name);                 // copied, not installed
      } catch (e) {
        res.failed.push(ent.name || String(ent));
      }
    }
    openPath(dir);
    await alertBox(this._tr("fonts_install_title"), this._tr("fonts_install_hint"), this._tr("ok"));
    try {
      this.font_picker.reloadFamilies();
    } catch (e) {
      // picker not built yet
    }
    return res;
  },

  /** A character / style font-guide sheet (.xlsx) as presets. */
  async on_preset_import_excel() {
    const f = await pickOpen(["xlsx", "xlsm"]);
    if (!f) return;
    let rows;
    try {
      rows = await readXlsxGrid(f.bytes);
    } catch (e) {
      this._set_status(this._tr("st_preset_import_fail"), true);
      return;
    }
    let hdrI = -1;
    let charCol = -1;
    for (let i = 0; i < rows.length && hdrI < 0; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        if (String(rows[i][j]).trim().toLowerCase() === "character") {
          hdrI = i;
          charCol = j;
          break;
        }
      }
    }
    if (hdrI < 0) {
      this._set_status(this._tr("st_preset_excel_no_header"), true);
      return;
    }
    const header = rows[hdrI];
    const styleCols = [];
    for (let j = charCol + 1; j < header.length; j++) if (String(header[j]).trim()) styleCols.push([j, String(header[j]).trim()]);
    const parts = String(f.path || f.name).split(/[\\/]/);
    const manga = (parts.length > 1 ? parts[parts.length - 2] : "") || LP.splitext(f.name)[0];
    const dm = (this._groups[manga] = this._groups[manga] || {});
    let nPresets = 0;
    let nChars = 0;
    for (const r of rows.slice(hdrI + 1)) {
      if (charCol >= r.length) continue;
      const ch = String(r[charCol]).trim();
      if (!ch) continue;
      const dc = (dm[ch] = dm[ch] || {});
      let made = 0;
      for (const [j, style] of styleCols) {
        const font = j < r.length ? String(r[j]).trim() : "";
        if (font) {
          dc[style] = { font };
          made += 1;
        }
      }
      if (made) {
        nChars += 1;
        nPresets += made;
      } else if (!Object.keys(dc).length) {
        delete dm[ch];
      }
    }
    if (!nPresets) {
      this._set_status(this._tr("st_preset_excel_empty"), true);
      return;
    }
    this._group = manga;
    this._char = "";
    this._save_groups();
    this._save_last_manga();
    this._refresh_groups_combo(manga);
    this._refresh_chars_combo();
    this._refresh_presets_combo();
    this._set_status(this._tr("st_preset_excel_imported", { n: nPresets, c: nChars, manga }));
  },
};
