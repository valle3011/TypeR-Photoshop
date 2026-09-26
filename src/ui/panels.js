// The customizable layout: tabs + movable panels.
//
// Port of TypeR-Krita's tab customization and PanelBox system (_new_panel,
// _PANEL_TITLES, _fill_panel_menu, _reorder_panel, _move_panel_to_tab,
// _drop_panel_rel, _detach_panel, _reattach_panel, _apply_panel_order, …)
// with the same setting keys (tabOrder, tabNames, uiTab, panelOrder,
// panelTabs, panelLocked, panelDetached, panelHeights, customize), so a
// saved layout survives restarts. Detaching moves a panel into one of the
// three extra panel entrypoints ("TypeR panel 1–3", the TyperExtraHost pool)
// or, when none can be shown, into a floating window.

import { h, show, clear, popupMenu, promptBox, modeless } from "./dom.js";
import { T } from "../host/settings.js";

export const PANEL_TITLES = {
  presets: "panel_presets", jp_en_table: "panel_table", live_preview: "panel_preview",
  script_box: "panel_script", nav_line: "panel_nav", active_field: "panel_active",
  font_picker: "panel_font", insert: "panel_insert", text_type: "panel_text_type",
  comments: "panel_comments", google: "panel_google", tt_fonts: "panel_tt_fonts",
  style_basic: "panel_style_basic", style_size: "panel_style_size", style_outline: "panel_style_outline",
  style_fill: "panel_style_fill", style_shadow: "panel_style_shadow", hyphenation: "panel_hyphenation",
  bubblr_detect: "panel_bubblr_detect", bubblr_batch: "panel_bubblr_batch", batch_mark: "panel_batch_mark",
  batch_overlay: "panel_batch_overlay", bubblr_overlay: "panel_bubblr_overlay",
  setup_general: "panel_setup_general", layout_sizes: "panel_layout_sizes", shapr_panel: "panel_shapr",
  balloon: "panel_balloon", sfx_panel: "panel_sfx", diagnostics: "panel_diagnostics", fonts_panel: "tab_fonts",
};

export const TAB_DEFAULTS = [
  ["type", "tab_type"], ["style", "tab_style"], ["setup", "tab_setup"], ["bubblr", "tab_bubblr"],
  ["batch", "tab_batch"], ["shapr", "tab_shapr"], ["sfx", "tab_sfx"], ["fonts", "tab_fonts"],
];

// the extra host panels (manifest entrypoints), filled by main.js
export const EXTRA_HOSTS = {};
export const MAX_DETACH_SLOTS = 3;

/** The tab bar + pages. Pages are kept alive when a tab is hidden. */
export class Tabs {
  constructor(app) {
    this.app = app;
    this.bar = h("div", { class: "tabbar" });
    this.stack = h("div", { class: "tabstack" });
    this.pages = {};           // id -> page element (scrolling)
    this.layouts = {};         // id -> inner content element
    this.buttons = {};         // id -> tab button
    this.visible = {};
    this.order = TAB_DEFAULTS.map(([id]) => id);
    this.current = "type";
    this.names = T.get("tabNames", {}) || {};
    this.onChange = null;
    for (const [id] of TAB_DEFAULTS) this._add(id);
  }

  _add(id) {
    const inner = h("div", { class: "page-inner" });
    const page = h("div", { class: "page" }, inner);
    this.pages[id] = page;
    this.layouts[id] = inner;
    this.stack.appendChild(page);
    const btn = h("div", { class: "tab", role: "tab", tabindex: "0" });
    btn.addEventListener("click", () => this.select(id));
    btn.addEventListener("dblclick", () => this._rename(id));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") this.select(id);
    });
    this.buttons[id] = btn;
    this.visible[id] = true;
    this.bar.appendChild(btn);
    show(page, false);
  }

  label(id) {
    const custom = this.names[id];
    if (custom) return custom;
    const nk = (TAB_DEFAULTS.find((t) => t[0] === id) || [])[1];
    return nk ? this.app._tr(nk) : id;
  }

  retranslate() {
    for (const id of Object.keys(this.buttons)) this.buttons[id].textContent = this.label(id);
  }

  setTabVisible(id, on) {
    this.visible[id] = !!on;
    show(this.buttons[id], !!on);
    if (!on && this.current === id) {
      const first = this.order.find((t) => this.visible[t]);
      if (first) this.select(first);
    }
  }

  isVisible(id) {
    return !!this.visible[id];
  }

  select(id, save = true) {
    if (!this.pages[id] || !this.visible[id]) return false;
    this.current = id;
    for (const [tid, page] of Object.entries(this.pages)) {
      show(page, tid === id);
      this.buttons[tid].classList.toggle("selected", tid === id);
    }
    if (save) T.set("uiTab", id);
    if (this.onChange) this.onChange(id);
    return true;
  }

  applyOrder(order) {
    const present = [...this.order];
    const wanted = order.filter((t) => present.includes(t));
    for (const t of present) if (!wanted.includes(t)) wanted.push(t);
    this.order = wanted;
    for (const id of wanted) this.bar.appendChild(this.buttons[id]);
  }

  saveOrder() {
    T.set("tabOrder", this.order.join(","));
  }

  move(id, delta) {
    const i = this.order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.order.length) return;
    this.order.splice(i, 1);
    this.order.splice(j, 0, id);
    this.applyOrder(this.order);
    this.saveOrder();
  }

  async _rename(id) {
    if (!this.app.customize_chk || !this.app.customize_chk.isChecked()) return;
    const name = await promptBox(this.app._tr("tab_rename_title"), this.app._tr("tab_rename_prompt"), this.label(id));
    if (name === null) return;
    const nk = (TAB_DEFAULTS.find((t) => t[0] === id) || [])[1];
    const trimmed = name.trim();
    if (trimmed && trimmed !== (nk ? this.app._tr(nk) : "")) this.names[id] = trimmed;
    else delete this.names[id];
    T.set("tabNames", this.names);
    this.retranslate();
  }
}

/** A relocatable panel: a header (shown in customize mode) with grip,
 *  title, lock and ⋮ menu above the body, plus a height grip. */
export class PanelBox {
  constructor(pid, app) {
    this.pid = pid;
    this.app = app;
    this.edit = false;
    this.locked = false;
    this.userHeight = 0;
    this.title = h("span", { class: "panel-title" });
    this.lockBtn = h("span", { class: "panel-icon", role: "button", title: "" }, "🔓");
    this.menuBtn = h("span", { class: "panel-icon", role: "button" }, "⋮");
    this.grip = h("span", { class: "panel-grip" }, "⠷");
    this.header = h("div", { class: "panel-header" }, this.grip, this.title, this.lockBtn, this.menuBtn);
    this.body = h("div", { class: "panel-body" });
    this.resizeGrip = h("div", { class: "panel-resize" });
    this.el = h("div", { class: "panel", "data-pid": pid }, this.header, this.body, this.resizeGrip);
    this.el._box = this;
    show(this.header, false);
    show(this.resizeGrip, false);
    this.lockBtn.addEventListener("click", () => app._set_panel_locked(pid, !this.locked));
    this.menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      popupMenu(this.menuBtn, app._panel_menu_items(pid));
    });
    this._wireDrag();
    this._wireResize();
  }

  setTitle(t) {
    this.title.textContent = t;
  }

  setEdit(on) {
    this.edit = !!on;
    show(this.header, this.edit);
    show(this.resizeGrip, this.edit);
    this.el.classList.toggle("editing", this.edit);
  }

  setLocked(on) {
    this.locked = !!on;
    this.lockBtn.textContent = this.locked ? "🔒" : "🔓";
    this.header.classList.toggle("locked", this.locked);
  }

  setUserHeight(px) {
    this.userHeight = px && px > 0 ? Math.trunc(px) : 0;
    this.el.style.height = this.userHeight ? `${this.userHeight}px` : "";
    this.el.style.overflow = this.userHeight ? "auto" : "";
  }

  _wireResize() {
    let ref = null;
    this.resizeGrip.addEventListener("pointerdown", (e) => {
      if (!this.edit) return;
      ref = [e.clientY, this.el.getBoundingClientRect().height];
      try {
        this.resizeGrip.setPointerCapture(e.pointerId);
      } catch (err) {
        // no capture
      }
      e.preventDefault();
    });
    this.resizeGrip.addEventListener("pointermove", (e) => {
      if (!ref) return;
      this.setUserHeight(Math.max(80, ref[1] + (e.clientY - ref[0])));
    });
    this.resizeGrip.addEventListener("pointerup", () => {
      if (!ref) return;
      ref = null;
      this.app._save_panel_heights();
    });
  }

  _wireDrag() {
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      if (!drag.started && Math.abs(e.clientY - drag.y) + Math.abs(e.clientX - drag.x) < 6) return;
      drag.started = true;
      this.el.classList.add("dragging");
      this.app._panel_drag_hover(this.pid, e.clientX, e.clientY);
    };
    const onUp = (e) => {
      if (!drag) return;
      const started = drag.started;
      drag = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      this.el.classList.remove("dragging");
      if (started) this.app._panel_drag_drop(this.pid, e.clientX, e.clientY);
    };
    this.header.addEventListener("pointerdown", (e) => {
      if (!this.edit || this.locked || e.target === this.lockBtn || e.target === this.menuBtn) return;
      drag = { x: e.clientX, y: e.clientY, started: false };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }
}

/** Panel-management methods mixed into TypeR (ports of the Krita ones). */
export const PanelMethods = {
  _new_panel(pid, tabId) {
    const box = new PanelBox(pid, this);
    this._panels[pid] = box;
    this._panel_tab[pid] = tabId;
    this._panel_home[pid] = tabId;
    this._build_order.push(pid);
    this.tabs.layouts[tabId].appendChild(box.el);
    return box;
  },

  _panel_title(pid) {
    return this._tr(PANEL_TITLES[pid] || pid);
  },

  _retranslate_panels() {
    for (const [pid, box] of Object.entries(this._panels)) {
      box.setTitle(this._panel_title(pid));
      box.lockBtn.title = this._tr("panel_lock_tip");
    }
  },

  _panel_menu_items(pid) {
    if (pid in this._detached) {
      return [{ label: "⧉  " + this._tr("panel_reattach"), onClick: () => this._reattach_panel(pid) }];
    }
    const items = [
      { label: "▲  " + this._tr("panel_up"), onClick: () => this._reorder_panel(pid, -1) },
      { label: "▼  " + this._tr("panel_down"), onClick: () => this._reorder_panel(pid, 1) },
      { separator: true },
    ];
    const cur = this._panel_tab[pid];
    for (const tid of this.tabs.order) {
      if (tid === cur || !this.tabs.isVisible(tid)) continue;
      items.push({ label: this._tr("panel_move_to", { tab: this.tabs.label(tid) }), onClick: () => this._move_panel_to_tab(pid, tid) });
    }
    items.push({ separator: true });
    items.push({ label: "⧉  " + this._tr("panel_detach"), onClick: () => this._detach_panel(pid) });
    return items;
  },

  _panels_in_tab(tid) {
    const lay = this.tabs.layouts[tid];
    return Array.from(lay.children).filter((c) => c._box).map((c) => c._box.pid);
  },

  _reorder_panel(pid, delta) {
    const box = this._panels[pid];
    const tid = this._panel_tab[pid];
    const lay = this.tabs.layouts[tid];
    if (!box || !lay) return;
    const kids = Array.from(lay.children);
    const idx = kids.indexOf(box.el);
    const target = Math.max(0, Math.min(kids.length - 1, idx + delta));
    if (target === idx) return;
    lay.removeChild(box.el);
    const after = Array.from(lay.children);
    if (target >= after.length) lay.appendChild(box.el);
    else lay.insertBefore(box.el, after[target]);
    this._sync_gated_panels();
    this._save_panel_order();
  },

  _save_panel_order() {
    const order = {};
    for (const tid of Object.keys(this.tabs.layouts)) order[tid] = this._panels_in_tab(tid);
    T.set("panelOrder", order);
  },

  _apply_panel_order() {
    const order = T.get("panelOrder", {}) || {};
    for (const [tid, ids] of Object.entries(order)) {
      const lay = this.tabs.layouts[tid];
      if (!lay || !Array.isArray(ids)) continue;
      for (const pid of ids) {
        const box = this._panels[pid];
        if (box && box.el.parentNode === lay) lay.appendChild(box.el);
      }
      // panels the saved order does not know keep their place at the end
    }
    this._sync_gated_panels();
  },

  _move_panel_to_tab(pid, tid, save = true) {
    const box = this._panels[pid];
    const lay = this.tabs.layouts[tid];
    if (!box || !lay) return;
    lay.appendChild(box.el);
    this._panel_tab[pid] = tid;
    this._sync_gated_panels();
    if (save) {
      this._save_panel_tabs();
      this._save_panel_order();
    }
  },

  _panel_drag_hover(pid, x, y) {
    for (const box of Object.values(this._panels)) box.el.classList.remove("drop-top", "drop-bottom");
    const target = this._panel_at(x, y, pid);
    if (target) {
      const r = target.el.getBoundingClientRect();
      target.el.classList.add(y < r.top + r.height / 2 ? "drop-top" : "drop-bottom");
    }
  },

  _panel_at(x, y, exclude) {
    for (const [pid, box] of Object.entries(this._panels)) {
      if (pid === exclude || pid in this._detached) continue;
      if (!box.el.offsetParent) continue;
      const r = box.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return box;
    }
    return null;
  },

  _panel_drag_drop(pid, x, y) {
    for (const box of Object.values(this._panels)) box.el.classList.remove("drop-top", "drop-bottom");
    // dropped on a tab -> move into that tab
    for (const [tid, btn] of Object.entries(this.tabs.buttons)) {
      const r = btn.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        this._move_panel_to_tab(pid, tid);
        this.tabs.select(tid);
        return;
      }
    }
    const target = this._panel_at(x, y, pid);
    if (!target) return;
    const r = target.el.getBoundingClientRect();
    const after = y >= r.top + r.height / 2;
    const tid = this._panel_tab[target.pid];
    const lay = this.tabs.layouts[tid];
    const box = this._panels[pid];
    if (after) lay.insertBefore(box.el, target.el.nextSibling);
    else lay.insertBefore(box.el, target.el);
    this._panel_tab[pid] = tid;
    this._sync_gated_panels();
    this._save_panel_tabs();
    this._save_panel_order();
  },

  _set_panel_locked(pid, on) {
    const box = this._panels[pid];
    if (!box) return;
    box.setLocked(on);
    T.set("panelLocked", Object.entries(this._panels).filter(([, b]) => b.locked).map(([p]) => p));
  },

  _save_panel_heights() {
    const heights = {};
    for (const [pid, box] of Object.entries(this._panels)) if (box.userHeight > 0) heights[pid] = box.userHeight;
    T.set("panelHeights", heights);
  },

  _save_panel_tabs() {
    T.set("panelTabs", { ...this._panel_tab });
  },

  _apply_panel_positions() {
    const saved = T.get("panelTabs", {}) || {};
    for (const [pid, tid] of Object.entries(saved)) {
      if (this._panels[pid] && this.tabs.layouts[tid] && tid !== this._panel_tab[pid]) this._move_panel_to_tab(pid, tid, false);
    }
    const locked = new Set(T.get("panelLocked", []) || []);
    const heights = T.get("panelHeights", {}) || {};
    const edit = this.customize_chk.isChecked();
    for (const [pid, box] of Object.entries(this._panels)) {
      box.setLocked(locked.has(pid));
      box.setUserHeight(heights[pid] || 0);
      box.setEdit(edit);
    }
  },

  _free_detach_slot() {
    const used = new Set(Object.values(this._detached).filter((s) => typeof s === "number"));
    for (let s = 0; s < MAX_DETACH_SLOTS; s++) if (EXTRA_HOSTS[s] && !used.has(s)) return s;
    return null;
  },

  _detach_panel(pid, prefer = null) {
    const box = this._panels[pid];
    if (!box || pid in this._detached) return;
    const used = new Set(Object.values(this._detached).filter((s) => typeof s === "number"));
    let slot = typeof prefer === "number" && EXTRA_HOSTS[prefer] && !used.has(prefer) ? prefer : null;
    if (slot === null && prefer !== "float") slot = this._free_detach_slot();
    if (slot !== null) {
      const host = EXTRA_HOSTS[slot];
      host.showPlaceholder(false);
      host.body.insertBefore(box.el, host.body.firstChild);
      host.open();
      this._detached[pid] = slot;
    } else {
      const win = modeless(this._panel_title(pid), (body) => body.appendChild(box.el),
        { onClose: () => this._reattach_panel(pid, true) });
      this._float_windows = this._float_windows || {};
      this._float_windows[pid] = win;
      this._detached[pid] = "float";
    }
    box.setEdit(true);            // keep the header (⋮ Reattach) reachable
    this._sync_gated_panels();
    T.set("panelDetached", { ...this._detached });
  },

  _reattach_panel(pid, fromClose = false) {
    const box = this._panels[pid];
    if (!box || !(pid in this._detached)) return;
    const slot = this._detached[pid];
    delete this._detached[pid];
    if (slot === "float") {
      const win = (this._float_windows || {})[pid];
      if (win && !fromClose) win.close();
      delete (this._float_windows || {})[pid];
    } else {
      const host = EXTRA_HOSTS[slot];
      if (host && !Object.values(this._detached).includes(slot)) host.showPlaceholder(true);
    }
    const home = this._panel_home[pid] || "type";
    this._move_panel_to_tab(pid, home);
    box.setEdit(this.customize_chk.isChecked());
    T.set("panelDetached", { ...this._detached });
  },

  _apply_detached() {
    const saved = T.get("panelDetached", {}) || {};
    for (const [pid, slot] of Object.entries(saved)) {
      if (pid === "balloon" && !this.enable_balloon_chk.isChecked()) continue;
      if (this._panels[pid] && !(pid in this._detached)) this._detach_panel(pid, typeof slot === "number" ? slot : "float");
    }
    for (const host of Object.values(EXTRA_HOSTS)) host.setHint(this._tr("detach_host_hint"));
  },

  _on_customize_toggle(on) {
    for (const [pid, box] of Object.entries(this._panels)) box.setEdit(on || pid in this._detached);
    show(this.customize_hint, on);
    show(this.tab_move_row, on);
    T.setBool("customize", on);
  },

  on_layout_reset() {
    this.tabs.names = {};
    T.set("tabNames", {});
    this.tabs.applyOrder(TAB_DEFAULTS.map(([id]) => id));
    this.tabs.saveOrder();
    this.tabs.retranslate();
    for (const pid of Object.keys(this._detached)) this._reattach_panel(pid);
    for (const box of Object.values(this._panels)) {
      box.setLocked(false);
      box.setUserHeight(0);
    }
    // back to the build order of each home tab
    for (const pid of this._build_order) this._move_panel_to_tab(pid, this._panel_home[pid], false);
    for (const k of ["panelOrder", "panelTabs", "panelLocked", "panelDetached", "panelHeights"]) T.set(k, k === "panelLocked" ? [] : {});
    this._set_status(this._tr("layout_reset_done"));
  },

  _sync_gated_panels() {
    const box = this._panels.balloon;
    if (box && this.enable_balloon_chk) show(box.el, this.enable_balloon_chk.isChecked());
    if (this._panels.text_type && this.enable_texttypes_chk) show(this._panels.text_type.el, this.enable_texttypes_chk.isChecked());
    if (this._panels.style_fill && this.enable_patterns_chk) show(this._panels.style_fill.el, this.enable_patterns_chk.isChecked());
    if (this._comments_panel) show(this._comments_panel.el, !!this._comments_visible);
  },
};

/** An extra host panel (manifest entrypoint) for detached panels. */
export class ExtraHost {
  constructor(slot, node, panelApi) {
    this.slot = slot;
    this.node = node;
    this.panelApi = panelApi;
    this.placeholder = h("div", { class: "hint center" });
    this.body = h("div", { class: "extra-host" });
    clear(node);
    node.appendChild(this.body);
    this.body.appendChild(this.placeholder);
  }

  setHint(t) {
    this.placeholder.textContent = t;
  }

  showPlaceholder(on) {
    show(this.placeholder, on);
  }

  open() {
    try {
      if (this.panelApi && this.panelApi.show) this.panelApi.show();
    } catch (e) {
      // the user opens it from Plugins > TypeR
    }
  }
}
