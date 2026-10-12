// The Type tab: script box + script tabs (sessions), the source/translation
// table, navigation + pages, the active field, comments, the live preview,
// the font picker + colour, Insert and the balloon tool.
//
// Port of the matching parts of TyperDocker.__init__ and its methods
// (_add_session … _refresh_view, on_load, the Google Docs path, analyze,
// on_add_line, on_save_script, navigation, pages, on_pick_color,
// on_insert_balloon, _show_current, _refresh_comments).

import { h, clear, show, row, hint, hline, debounce, Button, ActionButton, Check, Select, TextArea, ColorButton,
  promptBox, confirmBox, dialog, popupMenu } from "./dom.js";
import { FontPicker, TextPreview } from "./widgets.js";
import { T } from "../host/settings.js";
import { docInfo, selectionBounds, openExternal } from "../host/ps.js";
import { pickOpen, pickSave, writeText, readBytes, listDir, stat, envPaths } from "../host/files.js";
import { insertBalloon } from "../host/balloon.js";
import { pickColor } from "../host/color.js";
import * as G from "../host/google.js";
import * as GA from "../core/gauth.js";
import * as LP from "../core/langpair.js";
import * as CM from "../core/comments.js";
import * as BAL from "../core/balloons.js";
import { readScript, splitLines, OldDocError, NoContentError, decodeBytes } from "../core/readers.js";
import { toggleBold, LINKIFY } from "../core/textprep.js";

const SCRIPT_TYPES = ["txt", "md", "docx", "odt", "xlsx", "xlsm", "csv", "tsv", "gdoc", "doc", "rtf"];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const TypeTabMethods = {
  /** Register a retranslate hook (run by every _retranslate, including the
   *  first one at the end of the build — like Krita's _retranslate). */
  _rt(fn) {
    this._retrans.push(fn);
    return fn;
  },

  _build_type_tab() {
    const t = (k, f) => this._tr(k, f);
    const lay = this.tabs.layouts.type;

    // --- script panel -------------------------------------------------------
    const sb = this._new_panel("script_box", "type");
    this.load_btn = Button("", { onClick: () => this.on_load() });
    this.lbl_script = h("div", { class: "lbl" });
    this.script_tabs = h("div", { class: "script-tabs" });
    this.editor = TextArea({ class: "script-editor", onChange: () => this._schedule_session_save() });
    this.skip_empty = Check("", { checked: true, onChange: () => this.analyze() });
    this.analyze_btn = Button("", { onClick: () => this.analyze() });
    this.add_line_btn = Button("", { onClick: () => this.on_add_line() });
    this.save_script_btn = Button("", { onClick: () => this.on_save_script() });
    sb.body.append(this.load_btn, this.lbl_script, this.script_tabs, this.editor,
      row(this.skip_empty, this.analyze_btn), row(this.add_line_btn, this.save_script_btn));
    this._rt(() => {
      this.load_btn.setText(t("load_btn"));
      this.lbl_script.textContent = t("script_label");
      this.editor.setPlaceholder(t("editor_ph"));
      this.skip_empty.setText(t("skip_empty"));
      this.analyze_btn.setText(t("analyze_btn"));
      this.add_line_btn.setText(t("add_line_btn"));
      this.save_script_btn.setText(t("save_script_btn"));
    });

    // --- the source / translation table --------------------------------------
    this.lbl_align = h("div", { class: "lbl" });
    lay.append(hline(), this.lbl_align);
    this.table_head = h("tr", {}, h("th"), h("th"));
    this.table_body = h("tbody");
    this.table = h("table", { class: "pairs" }, h("thead", {}, this.table_head), this.table_body);
    this.table_wrap = h("div", { class: "pairs-wrap", tabindex: "0" }, this.table);
    this.table_wrap.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!this._pairs.length) return;
        this._index = Math.max(0, Math.min(this._pairs.length - 1, this._index + (e.key === "ArrowDown" ? 1 : -1)));
        this._on_table_select(this._index);
      } else if (e.key === "Enter") {
        this.on_insert();
      }
    });
    const tp = this._new_panel("jp_en_table", "type");
    tp.body.appendChild(this.table_wrap);
    this._rt(() => {
      this.lbl_align.textContent = t("align_label");
      this.table_head.children[0].textContent = t("col_source");
      this.table_head.children[1].textContent = t("col_translation");
    });

    // --- navigation -------------------------------------------------------------
    const nav = this._new_panel("nav_line", "type");
    this.prev_btn = Button("", { onClick: () => this.on_prev() });
    this.next_btn = Button("", { onClick: () => this.on_next() });
    this.reset_btn = Button("", { onClick: () => this.on_reset_progress() });
    this.counter = h("span", { class: "counter grow center", text: "0 / 0" });
    nav.body.appendChild(row(this.prev_btn, this.counter, this.next_btn, this.reset_btn));
    this.bubble_prev_btn = ActionButton("◀", { onClick: () => this._bp_step(-1) });
    this.bubble_next_btn = ActionButton("▶", { onClick: () => this._bp_step(1) });
    this.bubble_lbl = h("span", { class: "grow center" });
    this.bubble_nav_widget = row(this.bubble_prev_btn, this.bubble_lbl, this.bubble_next_btn);
    show(this.bubble_nav_widget, false);
    nav.body.appendChild(this.bubble_nav_widget);
    this.lbl_page = h("span", { class: "lbl" });
    this.page_combo = Select([], { activated: true, onChange: (v) => this.on_jump_page(v) });
    this.page_status = h("span", { class: "muted" });
    nav.body.appendChild(row(this.lbl_page, this.page_combo, this.page_status));
    this._rt(() => {
      this.prev_btn.setText(t("prev"));
      this.next_btn.setText(t("next"));
      this.reset_btn.setText(t("reset_btn"));
      this.bubble_prev_btn.setTip(t("bubble_prev_tip"));
      this.bubble_next_btn.setTip(t("bubble_next_tip"));
      this.lbl_page.textContent = t("page_jump");
    });

    // --- active field -------------------------------------------------------------
    const act = this._new_panel("active_field", "type");
    this.active_edit = TextArea({ class: "active-edit", onChange: () => this._update_text_preview() });
    this.bold_sel_btn = Button("", { onClick: () => this.on_bold_selection() });
    this.jp_ref = h("div", { class: "muted wrap" });
    act.body.append(this.active_edit, row(this.bold_sel_btn), this.jp_ref);
    this._rt(() => {
      this.active_edit.setPlaceholder(t("active_ph"));
      this.bold_sel_btn.setText(t("bold_sel"));
      this.bold_sel_btn.setTip(t("bold_sel_tip"));
    });

    // --- comments -------------------------------------------------------------------
    const cm = this._new_panel("comments", "type");
    this.comments_view = h("div", { class: "comments" });
    this.comments_view.addEventListener("click", (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (a && a.getAttribute("href")) {
        e.preventDefault();
        openExternal(a.getAttribute("href"));
      }
    });
    cm.body.appendChild(this.comments_view);
    this._comments_panel = cm;
    this._comments_visible = false;

    // --- live preview -----------------------------------------------------------------
    const pv = this._new_panel("live_preview", "type");
    this.lbl_preview = h("span", { class: "muted" });
    this.preview_refresh_btn = ActionButton("↻", { onClick: () => this.preview.paint() });
    this.preview = new TextPreview(this);
    pv.body.append(row(this.lbl_preview, h("span", { class: "grow" }), this.preview_refresh_btn), this.preview.el);
    this._rt(() => {
      this.lbl_preview.textContent = t("preview_label");
      this.preview_refresh_btn.setTip(t("preview_refresh_tip"));
    });

    // --- presets (built by the presets module into this panel) ----------------------------
    const pp = this._new_panel("presets", "type");
    this._build_presets_panel(pp.body);

    // --- font + colour ------------------------------------------------------------------------
    const fp = this._new_panel("font_picker", "type");
    this.lbl_font = h("div", { class: "lbl" });
    this.font_picker = new FontPicker({
      recents: this._load_recents(),
      placeholder: t("font_search_ph"),
      onChange: () => {
        this._update_text_preview();
        this._on_style_changed();
      },
      onContext: (fam, e) => this._font_context_menu(fam, e),
    });
    this.fav_add_btn = Button("", { onClick: () => this._star_current_font() });
    this.color_btn = ColorButton("", {
      color: this._color,
      pick: (c) => this._pick_color(c, t("color_dlg")),
      onChange: (c) => {
        this._color = c;
        this._on_style_changed();
        this._update_text_preview();
      },
    });
    fp.body.append(this.lbl_font, this.font_picker.el, row(this.fav_add_btn), row(this.color_btn));
    this._rt(() => {
      this.lbl_font.textContent = t("font");
      this.font_picker.setPlaceholder(t("font_search_ph"));
      this.fav_add_btn.setText(t("fav_star_current"));
      this.fav_add_btn.setTip(t("fav_star_current_tip"));
      this.color_btn.setText(t("color_btn"));
    });

    // --- insert ------------------------------------------------------------------------------------
    const ins = this._new_panel("insert", "type");
    this.insert_btn = Button("", { variant: "cta", onClick: () => this.on_insert() });
    this.insert_btn.classList.add("grow");
    ins.body.appendChild(row(this.insert_btn));
    this._rt(() => this.insert_btn.setText(t("insert_btn")));

    // --- balloon ------------------------------------------------------------------------------------
    const bal = this._new_panel("balloon", "type");
    this.balloon_combo = Select(BAL.SHAPE_ORDER.map((s) => ({ label: s, value: s })), { onChange: () => this._on_balloon_changed() });
    this.balloon_tail_chk = Check("", { checked: true });
    this.balloon_btn = Button("", { onClick: () => this.on_insert_balloon() });
    this.balloon_hint = hint();
    bal.body.append(row(this.balloon_combo, this.balloon_tail_chk), this.balloon_btn, this.balloon_hint);
    this._rt(() => {
      BAL.SHAPE_ORDER.forEach((s, i) => this.balloon_combo.setLabelAt(i, t("balloon_" + s)));
      this.balloon_tail_chk.setText(t("balloon_tail"));
      this.balloon_tail_chk.setTip(t("balloon_tail_tip"));
      this.balloon_btn.setText(t("balloon_insert"));
      this.balloon_btn.setTip(t("balloon_insert_tip"));
      this._on_balloon_changed();
    });

    this._session_save = debounce(() => this._save_sessions(), 800);
  },

  // -- colours ---------------------------------------------------------------------

  /** Photoshop's colour picker; a hex prompt where it is unavailable. */
  async _pick_color(initial, title) {
    const c = await pickColor(initial, title);
    if (c !== undefined) return c;
    const s = await promptBox(this._tr("color_hex_title"), this._tr("color_hex_prompt"), initial);
    if (s === null) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
    return m ? "#" + m[1].toLowerCase() : null;
  },

  _update_color_btn() {
    if (this.color_btn) this.color_btn.setColor(this._color);
  },

  // -- sessions (script tabs) -------------------------------------------------------

  _session_index(sid) {
    return this._sessions.findIndex((s) => s.id === sid);
  },

  _render_script_tabs() {
    clear(this.script_tabs);
    for (const s of this._sessions) {
      const close = h("span", { class: "stab-close", title: "×" }, "×");
      const el = h("div", { class: "stab" + (s.id === this._active_sid ? " selected" : ""), title: s.path || s.name },
        h("span", { class: "stab-name", text: s.name }), close);
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this._close_tab(s.id);
      });
      el.addEventListener("pointerdown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this._close_tab(s.id);
          return;
        }
        if (e.button !== 0 || e.target === close) return;
        this._tab_drag = { sid: s.id, x: e.clientX, moved: false };
      });
      el.addEventListener("pointerenter", () => {
        const d = this._tab_drag;
        if (!d || d.sid === s.id) return;
        const a = this._session_index(d.sid);
        const b = this._session_index(s.id);
        const [moved] = this._sessions.splice(a, 1);
        this._sessions.splice(b, 0, moved);
        d.moved = true;
        this._render_script_tabs();
        this._schedule_session_save();
      });
      el.addEventListener("pointerup", () => {
        const d = this._tab_drag;
        this._tab_drag = null;
        if (!d || d.moved) return;
        this._on_tab_changed(s.id);
      });
      el.addEventListener("dblclick", () => this._rename_tab(s.id));
      this.script_tabs.appendChild(el);
    }
    if (!this._tab_drag_wired) {
      this._tab_drag_wired = true;
      document.addEventListener("pointerup", () => {
        this._tab_drag = null;
      });
    }
  },

  _snapshot_active() {
    const i = this._session_index(this._active_sid);
    if (i < 0) return;
    const s = this._sessions[i];
    s.text = this.editor.text();
    s.pairs = this._pairs;
    s.pair_pages = this._pair_pages;
    s.pages = this._pages;
    s.index = this._index;
    s.done = this._done;
    s.path = this._script_path;
    s.comments = this._script_comments;
  },

  _restore_by_sid(sid) {
    const i = this._session_index(sid);
    if (i < 0) return;
    const s = this._sessions[i];
    this._active_sid = sid;
    this._script_path = s.path;
    this._pairs = s.pairs;
    this._pair_pages = s.pair_pages;
    this._script_comments = s.comments || [];
    this._pages = s.pages;
    this._index = s.index;
    this._done = s.done;
    this.editor.setText(s.text);
    this._populate_table();
    this._refresh_pages_combo();
    this._render_script_tabs();
    this._refresh_view();
  },

  _add_session(name, path, text, doAnalyze, comments = []) {
    this._snapshot_active();
    const sid = this._next_sid++;
    this._sessions.push({ id: sid, name, path, text, pairs: [], pair_pages: [], pages: [], index: 0, done: new Set(), comments: [] });
    this._active_sid = sid;
    this._script_path = path;
    this._script_comments = comments;
    this.editor.setText(text);
    if (doAnalyze) {
      this.analyze();
    } else {
      this._pairs = [];
      this._pair_pages = [];
      this._pages = [];
      this._index = 0;
      this._done = new Set();
      this._populate_table();
      this._refresh_pages_combo();
      this._refresh_view();
    }
    this._snapshot_active();
    this._render_script_tabs();
    this._schedule_session_save();
  },

  _new_untitled() {
    const name = LP.uniqueUntitled(this._sessions.map((s) => s.name), this._tr("tab_untitled"));
    this._add_session(name, "", "", false);
  },

  _init_first_session() {
    if (this._sessions.length) return;
    if (this._restore_sessions()) return;
    this._new_untitled();
  },

  _schedule_session_save() {
    if (this._session_save) this._session_save();
  },

  _save_sessions() {
    try {
      this._snapshot_active();
      const out = { active: this._active_sid, sessions: [] };
      for (const s of this._sessions) {
        if (!(s.text || "").trim() && !(s.pairs || []).length) continue;
        out.sessions.push({
          sid: s.id,
          name: s.name || "",
          path: s.path || "",
          text: s.text || "",
          pairs: (s.pairs || []).map((p) => [...p]),
          pair_pages: [...(s.pair_pages || [])],
          pages: (s.pages || []).map((p) => [...p]),
          index: Math.trunc(s.index || 0),
          done: [...(s.done || [])].map(Number).sort((a, b) => a - b),
          // Photoshop port: the notes survive a restart too (Krita drops them)
          comments: (s.comments || []).map((c) => (c.toJSON ? c.toJSON() : c)),
        });
      }
      if (JSON.stringify(out).length > 4000000) return;
      T.set("sessions", out);
    } catch (e) {
      // never raises
    }
  },

  _restore_sessions() {
    let data = T.get("sessions", null);
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        data = null;
      }
    }
    const saved = data && Array.isArray(data.sessions) ? data.sessions : null;
    if (!saved || !saved.length) return false;
    let activeSid = null;
    for (const sd of saved) {
      const sid = this._next_sid++;
      this._sessions.push({
        id: sid,
        name: sd.name || this._tr("tab_untitled"),
        path: sd.path || "",
        text: sd.text || "",
        pairs: (sd.pairs || []).map((p) => (Array.isArray(p) ? p : [p, ""])),
        pair_pages: [...(sd.pair_pages || [])],
        pages: [...(sd.pages || [])],
        index: Math.trunc(sd.index || 0),
        done: new Set((sd.done || []).map(Number)),
        comments: CM.fromJSON(sd.comments || []),
      });
      if (sd.sid === data.active) activeSid = sid;
    }
    this._active_sid = null;
    this._restore_by_sid(activeSid !== null ? activeSid : this._sessions[0].id);
    return true;
  },

  _on_tab_changed(sid) {
    if (sid === null || sid === this._active_sid) return;
    this._snapshot_active();
    this._restore_by_sid(sid);
    this._schedule_session_save();
  },

  _close_tab(sid) {
    this._snapshot_active();
    const i = this._session_index(sid);
    if (i < 0) return;
    const wasActive = sid === this._active_sid;
    this._sessions.splice(i, 1);
    if (!this._sessions.length) {
      this._active_sid = null;
      this._new_untitled();
      this._schedule_session_save();
      return;
    }
    if (wasActive) {
      const next = this._sessions[Math.min(i, this._sessions.length - 1)];
      this._active_sid = null;
      this._restore_by_sid(next.id);
    } else {
      this._render_script_tabs();
    }
    this._schedule_session_save();
  },

  async _rename_tab(sid) {
    const i = this._session_index(sid);
    if (i < 0) return;
    const name = await promptBox(this._tr("tab_rename_dlg"), this._tr("tab_rename_prompt"), this._sessions[i].name);
    if (name === null || !name.trim()) return;
    this._sessions[i].name = name.trim();
    this._render_script_tabs();
    this._schedule_session_save();
  },

  // -- loading -------------------------------------------------------------------------

  async on_load() {
    let f;
    try {
      f = await pickOpen(SCRIPT_TYPES);
    } catch (e) {
      this._set_status(this._tr("st_read_fail", { exc: e.message || e }), true);
      return;
    }
    if (!f) return;
    const existing = LP.findSessionByPath(this._sessions, f.path);
    if (existing >= 0) {
      this._on_tab_changed(this._sessions[existing].id);
      this._set_status(this._tr("st_already_open", { name: LP.basename(f.path) }));
      return;
    }
    if (GA.isGdoc(f.path)) {
      await this._load_gdoc(f.path, f.bytes);
      return;
    }
    let text;
    try {
      text = await readScript(f.name, f.bytes);
    } catch (exc) {
      if (exc instanceof OldDocError) this._set_status(this._tr("st_old_doc", { fmt: exc.fmt }), true);
      else if (/ENOENT|not found|no such file/i.test(String(exc && exc.message))) this._set_status(this._tr("st_not_found"), true);
      else if (exc instanceof NoContentError) this._set_status(this._tr("st_no_content"), true);
      else if (/zip|central directory|end of data/i.test(String(exc && exc.message))) this._set_status(this._tr("st_bad_zip"), true);
      else this._set_status(this._tr("st_read_fail", { exc: exc && exc.message ? exc.message : exc }), true);
      return;
    }
    const cs = /\.docx$/i.test(f.name) ? await CM.fromDocx(f.bytes) : [];
    this._add_session(LP.defaultTabLabel(f.path), f.path, text, true, cs);
    if (cs.length) this._set_status(this._tr("st_loaded_c", { name: LP.basename(f.path), n: this._pairs.length, c: cs.length }));
    else this._set_status(this._tr("st_loaded", { name: LP.basename(f.path), n: this._pairs.length }));
  },

  // ---- Google Docs ----

  _g_client_id() {
    return String(T.get("gClientId", "") || "").trim();
  },

  _g_token() {
    const v = T.get("gToken", {});
    if (typeof v === "string") {
      try {
        return JSON.parse(v) || {};
      } catch (e) {
        return {};
      }
    }
    return v || {};
  },

  _g_store_token(tok) {
    T.set("gToken", tok || {});
  },

  async on_g_sign_in() {
    const cid = this._g_client_id();
    if (!cid) {
      this._set_status(this._tr("st_g_no_client"), true);
      return;
    }
    let state;
    try {
      state = G.beginSignIn(cid);
    } catch (e) {
      this._set_status(e.message || String(e), true);
      return;
    }
    this._set_status(this._tr("st_g_wait"));
    const pasted = await promptBox(this._tr("g_paste_title"), this._tr("g_paste_prompt"), "", { multiline: true });
    if (pasted === null) {
      this._set_status(this._tr("st_g_out"));
      return;
    }
    try {
      const tok = await G.finishSignIn(state, pasted);
      if (!tok) {
        this._set_status(this._tr("g_paste_bad"), true);
        return;
      }
      this._g_store_token(tok);
    } catch (e) {
      this._set_status(e.message || String(e), true);
      return;
    }
    this._refresh_g_status();
    this._set_status(this._tr("st_g_ok"));
  },

  on_g_sign_out() {
    this._g_store_token({});
    this._refresh_g_status();
    this._set_status(this._tr("st_g_out"));
  },

  _refresh_g_status() {
    if (!this.g_status) return;
    this.g_status.textContent = this._g_token().refresh_token ? this._tr("g_state_in") : this._tr("g_state_out");
  },

  async _g_ready_token() {
    const cid = this._g_client_id();
    if (!cid) {
      this._set_status(this._tr("st_g_no_client"), true);
      return null;
    }
    let tok = this._g_token();
    if (!tok.refresh_token) {
      this._set_status(this._tr("st_g_not_signed_in"), true);
      return null;
    }
    try {
      tok = await G.ensure(tok, cid);
    } catch (e) {
      this._set_status(e.message || String(e), true);
      return null;
    }
    this._g_store_token(tok);
    return tok;
  },

  /** Where a browser is likely to drop the export. (No registry access in
   *  UXP: a moved Downloads folder is found only via Setup's hint.) */
  _download_dirs() {
    const { home, sep } = envPaths();
    if (!home) return [];
    const extra = String(T.get("downloadsDir", "") || "").trim();
    const dirs = [];
    if (extra) dirs.push(extra);
    dirs.push(home + sep + "Downloads", home + sep + "Download");
    return [...new Set(dirs)];
  },

  async _docx_snapshot() {
    const seen = {};
    const { sep } = envPaths();
    for (const d of this._download_dirs()) {
      for (const n of await listDir(d)) {
        if (!/\.(docx|odt)$/i.test(n)) continue;
        const p = d + sep + n;
        const s = await stat(p);
        if (s) seen[p] = [s.mtime, s.size];
      }
    }
    return seen;
  },

  async _offer_export(docId) {
    const go = await confirmBox(this._tr("g_export_title"), this._tr("g_export_msg"), this._tr("g_export_open"), this._tr("g_export_cancel"));
    if (!go) return;
    this._exp_before = await this._docx_snapshot();
    this._exp_deadline = Date.now() + 120000;
    this._exp_last_size = null;
    openExternal(GA.exportUrl(docId));
    this._set_status(this._tr("st_g_waiting_dl"));
    this._stop_export_watch();
    this._exp_timer = setInterval(() => this._check_export(), 700);
  },

  _stop_export_watch() {
    if (this._exp_timer) clearInterval(this._exp_timer);
    this._exp_timer = null;
  },

  async _check_export() {
    if (this._exp_busy) return;
    this._exp_busy = true;
    try {
      const now = await this._docx_snapshot();
      const before = this._exp_before || {};
      const fresh = Object.keys(now).filter((p) => !(p in before) || now[p][0] > before[p][0]);
      if (fresh.length) {
        const newest = fresh.reduce((a, b) => (now[b][0] > now[a][0] ? b : a));
        const size = now[newest][1];
        if (this._exp_last_size !== size) {
          this._exp_last_size = size;       // still downloading
          return;
        }
        this._stop_export_watch();
        this._exp_last_size = null;
        await this._load_exported(newest);
        return;
      }
      if (Date.now() > (this._exp_deadline || 0)) {
        this._stop_export_watch();
        this._set_status(this._tr("st_g_dl_timeout"), true);
      }
    } finally {
      this._exp_busy = false;
    }
  },

  async _load_exported(path) {
    let text;
    let bytes;
    try {
      bytes = await readBytes(path);
      text = await readScript(LP.basename(path), bytes);
    } catch (exc) {
      if (/ENOENT|not found|no such file/i.test(String(exc && exc.message))) {
        this._set_status(this._tr("st_not_found"), true);
        return;
      }
      this._set_status(this._tr("st_read_fail", { exc: exc && exc.message ? exc.message : exc }), true);
      return;
    }
    const cs = /\.docx$/i.test(path) ? await CM.fromDocx(bytes) : [];
    this._add_session(LP.defaultTabLabel(path), path, text, true, cs);
    this._set_status(this._tr("st_g_loaded", { name: LP.basename(path), n: this._pairs.length, c: cs.length }));
  },

  async _ask_doc_id() {
    const text = await promptBox(this._tr("g_ask_id_title"), this._tr("g_ask_id_prompt"), "");
    if (text === null) return "";
    const id = LP.driveFileId(text);
    if (!id) this._set_status(this._tr("st_g_bad_link"), true);
    return id;
  },

  async _load_gdoc(path, bytes) {
    let docId = "";
    try {
      docId = GA.stubDocId(decodeBytes(bytes || (await readBytes(path))));
    } catch (e) {
      // Drive for Desktop hands out no .gdoc bytes: the link is the way in
      docId = await this._ask_doc_id();
      if (!docId) return;
    }
    const tok = await this._g_ready_token();
    if (!tok) {
      await this._offer_export(docId);
      return;
    }
    this._set_status(this._tr("st_g_loading"));
    let lines;
    let cs;
    try {
      [lines, cs] = await G.load(docId, tok);
    } catch (e) {
      if (e instanceof GA.AuthError) this._set_status(e.message, true);
      else this._set_status(this._tr("st_read_fail", { exc: e.message || e }), true);
      return;
    }
    this._add_session(LP.defaultTabLabel(path), path, lines.join("\n"), true, cs);
    this._set_status(this._tr("st_g_loaded", { name: LP.basename(path), n: this._pairs.length, c: cs.length }));
  },

  async on_load_image_comments() {
    const fileId = LP.driveFileId(this.g_image_edit.text().trim());
    if (!fileId) {
      this._set_status(this._tr("st_img_no_id"), true);
      return;
    }
    const tok = await this._g_ready_token();
    if (!tok) return;
    this._set_status(this._tr("st_g_loading"));
    let cs;
    try {
      cs = await G.fetchComments(fileId, tok);
    } catch (e) {
      if (e instanceof GA.AuthError) this._set_status(e.message, true);
      else this._set_status(this._tr("st_read_fail", { exc: e.message || e }), true);
      return;
    }
    if (!cs.length) {
      this._set_status(this._tr("st_img_none"), true);
      return;
    }
    cs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const text = LP.imageCommentsToScript(cs);
    this._add_session(this._tr("img_tab_label"), "", text, true);
    this._set_status(this._tr("st_img_loaded", { c: cs.filter((c) => (c.text || "").trim()).length }));
  },

  // -- parse + table ----------------------------------------------------------------------

  analyze() {
    const lines = splitLines(this.editor.text(), this.skip_empty.isChecked());
    [this._pairs, this._pair_pages, this._pages] = LP.pairLinesPaged(lines);
    this._index = 0;
    this._done = new Set();
    this._maybe_auto_manga(this.editor.text(), this._script_path);
    if (this._script_comments && this._script_comments.length) {
      CM.anchorToUnits(this._script_comments, this._pairs.map((p) => LP.unitText(p) + " " + (p[0] || "")));
    }
    this._populate_table();
    this._refresh_pages_combo();
    this._refresh_view();
    this._schedule_session_save();
  },

  _populate_table() {
    clear(this.table_body);
    this._pairs.forEach(([ja, en], r) => {
      const tr = h("tr", { class: this._done.has(r) ? "done" : "" }, h("td", { text: ja }), h("td", { text: en }));
      tr.addEventListener("click", () => {
        this._index = r;
        this._on_table_select(r);
      });
      tr.addEventListener("dblclick", () => this.on_insert());
      this.table_body.appendChild(tr);
    });
    this._sync_table_selection();
  },

  _sync_table_selection() {
    const rows = this.table_body.children;
    for (let r = 0; r < rows.length; r++) rows[r].classList.toggle("selected", r === this._index);
    const cur = rows[this._index];
    if (cur) {
      const top = cur.offsetTop;
      const wrap = this.table_wrap;
      if (top < wrap.scrollTop + 20 || top + cur.offsetHeight > wrap.scrollTop + wrap.clientHeight) {
        wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 3);
      }
    }
  },

  _on_table_select(r) {
    this._index = r;
    this._show_current();
    this._refresh_comments();
    this._sync_table_selection();
    this._bp_batch_line_clicked(r);
  },

  async on_add_line() {
    const text = await promptBox(this._tr("add_line_dlg"), this._tr("add_line_prompt"), "", { multiline: true });
    if (text === null || !text.trim()) return;
    let cur = this.editor.text();
    if (cur && !cur.endsWith("\n")) cur += "\n";
    this.editor.setText(cur + text.trim() + "\n");
    this._pairs.push(["", text.trim()]);
    const pp = this._pair_pages;
    if (pp) pp.push(pp.length ? pp[pp.length - 1] : 0);
    this._index = this._pairs.length - 1;
    this._populate_table();
    this._refresh_pages_combo();
    this._refresh_view();
    this._snapshot_active();
    this._set_status(this._tr("st_line_added"));
  },

  async on_save_script() {
    const text = this.editor.text();
    const path = this._script_path;
    const isText = !!path && /\.(txt|md)$/i.test(path);
    let target;
    try {
      if (isText) {
        const ok = await confirmBox(this._tr("save_script_dlg"), this._tr("save_script_confirm", { name: LP.basename(path) }),
          this._tr("yes"), this._tr("no"));
        if (!ok) return;
        await writeText(path, text);
        target = path;
      } else {
        const def = path ? LP.splitext(LP.basename(path))[0] + ".txt" : "script.txt";
        target = await pickSave(def, ["txt", "md"], text);
        if (!target) return;
      }
    } catch (e) {
      this._set_status(this._tr("st_save_script_fail", { err: e.message || String(e) }), true);
      return;
    }
    this._script_path = target;
    const base = LP.basename(target);
    const i = this._session_index(this._active_sid);
    if (i >= 0) {
      this._sessions[i].path = target;
      this._sessions[i].name = base;
      this._render_script_tabs();
    }
    this._snapshot_active();
    this._set_status(this._tr("st_script_saved", { name: base }));
  },

  on_prev() {
    if (this._pairs.length) this._index = (this._index - 1 + this._pairs.length) % this._pairs.length;
    this._refresh_view();
  },

  on_next() {
    if (this._pairs.length) this._index = (this._index + 1) % this._pairs.length;
    this._refresh_view();
  },

  on_reset_progress() {
    this._done = new Set();
    this._repaint_done();
    this._show_current();
    this._set_status(this._tr("st_progress_reset"));
  },

  // -- pages -------------------------------------------------------------------------------

  _page_labels() {
    return this._pages.filter(([label]) => label).map(([label]) => label);
  },

  _current_page_label() {
    return this._index >= 0 && this._index < this._pair_pages.length ? this._pair_pages[this._index] : "";
  },

  _page_unit_range() {
    const n = this._pairs.length;
    const pp = this._pair_pages;
    if (!n) return [0, 0];
    if (pp.length !== n) return [0, n];
    const label = this._current_page_label();
    let first = null;
    let last = null;
    pp.forEach((p, i) => {
      if (p === label) {
        if (first === null) first = i;
        last = i;
      }
    });
    if (first === null) return [0, n];
    return [first, last + 1];
  },

  _refresh_pages_combo() {
    const labels = this._page_labels();
    this.page_combo.setItems(this._pages.filter(([label]) => label)
      .map(([label, first]) => ({ label: this._tr("page_item", { label }), value: first })), false);
    const has = labels.length > 0;
    show(this.lbl_page, has);
    show(this.page_combo, has);
    show(this.page_status, has);
    this._sync_page_indicator();
  },

  on_jump_page(first) {
    if (first === undefined || first === null) return;
    this._index = Math.trunc(first);
    this._refresh_view();
  },

  _sync_page_indicator() {
    const labels = this._page_labels();
    if (!labels.length) {
      this.page_status.textContent = "";
      return;
    }
    const cur = this._current_page_label();
    const i = labels.indexOf(cur);
    if (i >= 0) {
      this.page_status.textContent = this._tr("page_status", { cur, n: labels.length });
      this.page_combo.setIndex(i);
    } else {
      this.page_status.textContent = this._tr("page_status_intro");
    }
  },

  _mark_done_row(r) {
    const tr = this.table_body.children[r];
    if (tr) tr.classList.add("done");
  },

  _repaint_done() {
    const rows = this.table_body.children;
    for (let r = 0; r < rows.length; r++) rows[r].classList.toggle("done", this._done.has(r));
  },

  // -- active field + preview -----------------------------------------------------------------

  on_bold_selection() {
    const ta = this.active_edit;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      this._set_status(this._tr("st_bold_no_sel"));
      return;
    }
    const [text, ns, ne] = toggleBold(ta.text(), start, end);
    ta.setText(text);
    try {
      ta.focus();
      ta.setSelectionRange(Math.max(0, ns), Math.max(0, ne));
    } catch (e) {
      // selection API missing
    }
    this._update_text_preview();
  },

  _update_text_preview() {
    if (!this.preview) return;
    try {
      this.preview.setText(this._current_text());
    } catch (e) {
      // never break on a preview
    }
  },

  /** The live preview's style snapshot (TextPreview._opts). */
  _preview_opts(text) {
    const po = this._patterns_on() && this.outline_chk.isChecked();
    return {
      bold: this.bold_chk.isChecked(),
      italic: this.italic_chk.isChecked(),
      underline: this.underline_chk.isChecked(),
      ligatures: this.liga_chk.isChecked(),
      color: this._color,
      align: this.align_combo.val() || "center",
      valign: this.valign_combo.val() || "middle",
      case: this.case_combo.val() || "none",
      tidy: this.tidy_chk.isChecked(),
      comic: this.comic_chk.isChecked(),
      crossbarI: this.crossbar_chk.isChecked(),
      vertical: this.vertical_chk.isChecked(),
      spacing: this.spacing_spin.num() / 100.0,
      sizeRef: Math.max(1, this.size_spin.num()),
      outline: this.outline_chk.isChecked(),
      outlineColor: this._outline_color,
      outlinePx: this.outline_spin.num(),
      outline2Color: this._outline2_color,
      outline2Px: this.outline2_spin.num(),
      shadow: this.shadow_chk.isChecked(),
      shadowColor: this._shadow_color,
      shadowDx: this.shadow_x_spin.num(),
      shadowDy: this.shadow_y_spin.num(),
      hyphenate: this.hyph_chk.isChecked() && this.auto_chk.isChecked(),
      hyphLang: this._hyph_lang_for(text),
      outlinePattern: po ? this._outline_tile() : null,
      outlinePatternTarget: po ? this.outline_pattern_target_combo.val() || "outline1" : "outline1",
      soft: po && this.style_soft_chk.isChecked(),
      softPx: this.style_soft_width_spin.num(),
      softBlur: this.style_soft_blur_spin.num(),
      softColor: this._style_soft_color,
      softPattern: this.style_soft_pattern_chk.isChecked(),
      fillPattern: null,
    };
  },

  // -- BubblR stepper on the Type tab -------------------------------------------------------------

  _bp_link_active() {
    return this._bp_boxes.length > 0 && this._bp_current >= 0 && this._bp_current < this._bp_boxes.length;
  },

  _bp_step(delta) {
    if (!this._bp_boxes.length) return;
    const cur = this._bp_current >= 0 ? this._bp_current : 0;
    this._bp_set_current(Math.max(0, Math.min(cur + delta, this._bp_boxes.length - 1)));
  },

  _bp_update_nav() {
    if (!this.bubble_nav_widget) return;
    const have = this._bp_boxes.length > 0;
    show(this.bubble_nav_widget, have);
    if (have) {
      const cur = this._bp_current >= 0 ? this._bp_current + 1 : 0;
      this.bubble_lbl.textContent = this._tr("bubble_of", { cur, n: this._bp_boxes.length });
    }
  },

  // -- balloon -------------------------------------------------------------------------------------

  _on_balloon_changed() {
    const sid = this.balloon_combo.val() || "";
    const tid = BAL.SHAPE_FOR_TYPE[sid];
    this.balloon_hint.textContent = tid ? this._tr("balloon_hint", { kind: this._tr("tt_" + tid) }) : "";
  },

  async on_insert_balloon() {
    if (!docInfo()) {
      this._set_status(this._tr("st_no_doc"), true);
      return;
    }
    let box;
    if (this._bp_link_active()) {
      const b = this._bp_boxes[this._bp_current];
      box = [b.x, b.y, b.w, b.h];
    } else {
      const sel = await selectionBounds();
      if (!sel) {
        this._set_status(this._tr("st_balloon_no_box"), true);
        return;
      }
      box = sel;
    }
    const shape = this.balloon_combo.val() || "oval";
    const [ok, key, fmt] = await insertBalloon(shape, box, {
      tail: this.balloon_tail_chk.isChecked(),
      layerIndex: this._pairs.length ? this._index + 1 : null,
    });
    this._set_status(this._tr(key, ok ? { shape: this._tr("balloon_" + shape) } : fmt), !ok);
  },

  // -- the current line -----------------------------------------------------------------------------

  _show_current() {
    const total = this._pairs.length;
    if (!total) {
      this.counter.textContent = "0 / 0";
      this.active_edit.setText("");
      this.jp_ref.textContent = "";
      this._sync_page_indicator();
      this._update_text_preview();
      return;
    }
    this.counter.textContent = `${this._index + 1} / ${total}   ✓ ${this._done.size}`;
    const [ja, en] = this._pairs[this._index];
    let main = en.trim() ? en : ja;
    main = this._maybe_auto_character(main);
    this.active_edit.setText(main);
    this.jp_ref.textContent = en.trim() && ja.trim() ? "JP: " + ja : "";
    this._sync_page_indicator();
    this._update_text_preview();
  },

  _refresh_comments() {
    const panel = this._comments_panel;
    if (!panel) return;
    const cs = CM.forUnit(this._script_comments || [], this._index, this._pair_pages);
    this._comments_visible = cs.length > 0;
    if (!cs.length) {
      show(panel.el, false);
      return;
    }
    const parts = cs.map((c) => {
      const where = c.scope === CM.SCOPE_PAGE ? this._tr("cm_page") : this._tr("cm_line");
      const head = [c.author, c.date, where].filter((x) => x).join(" · ");
      let body = esc(c.text).replace(/\n/g, "<br>");
      body = body.replace(new RegExp(LINKIFY.source, "g"), (m) => `<a href="${m}">${m}</a>`);
      for (const r of c.replies) body += `<br><span class="muted">↳ ${esc(r)}</span>`;
      return `<div class="comment"><span class="muted small">${esc(head)}</span><br>${body}</div>`;
    });
    this.comments_view.innerHTML = parts.join("");
    show(panel.el, true);
  },

  _refresh_view() {
    this._refresh_comments();
    this._show_current();
    if (this._pairs.length) this._sync_table_selection();
  },

  // -- recents ----------------------------------------------------------------------------------------

  _load_recents() {
    const v = T.get("recentFonts", []);
    if (Array.isArray(v)) return v;
    return String(v || "").split("|").filter((x) => x);
  },

  _save_recents() {
    T.set("recentFonts", this.font_picker.recents());
  },
};

export { popupMenu, dialog };
