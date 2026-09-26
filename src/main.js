// TypeR for Photoshop — plugin entry point.
//
// Registers the UXP entrypoints: the main "TypeR" panel and three extra
// panels ("TypeR panel 1–3") that host detached panels (the Krita build's
// TyperExtraHost pool). Builds the panel in the Krita docker's order (see
// TyperDocker.__init__): Setup, Type (with Presets), Style, BubblR, Batch,
// TextShapR, SFX, Fonts — then restores the layout, settings and sessions.

import { h } from "./ui/dom.js";
import { TypeR, setBubblrLocked } from "./ui/app.js";
import { Tabs, PanelMethods, ExtraHost, EXTRA_HOSTS, TAB_DEFAULTS } from "./ui/panels.js";
import { TypeTabMethods } from "./ui/typetab.js";
import { PresetMethods } from "./ui/presets.js";
import { StyleTabMethods } from "./ui/styletab.js";
import { SetupTabMethods } from "./ui/setuptab.js";
import { BatchMethods } from "./ui/batch.js";
import { FontsMethods } from "./ui/fontstab.js";
import { TextShapRWidget } from "./ui/shapr.js";
import { SfxPanel } from "./ui/sfx.js";
import { initSettings, flush, T } from "./host/settings.js";
import { uxp } from "./host/ps.js";
import { readPluginText, pluginFileExists } from "./host/files.js";
import { setHyphLoader, HYPH_LANGS } from "./core/layout.js";
import * as TT from "./core/texttypes.js";

const HYPH_FILES = ["hyph-en-us.pat.txt", "hyph-en-us.hyp.txt", "hyph-de-1996.pat.txt", "hyph-es.pat.txt",
  "hyph-fr.pat.txt", "hyph-it.pat.txt", "hyph-pt.pat.txt", "hyph-pt.hyp.txt"];

/** The layout engine's hyphenator reads patterns synchronously: load the
 *  bundled files once, up front. */
async function preloadHyphenation() {
  const cache = new Map();
  await Promise.all(HYPH_FILES.map(async (name) => {
    const txt = await readPluginText("hyph/" + name);
    if (txt !== null) cache.set(name, txt);
  }));
  setHyphLoader((name) => (cache.has(name) ? cache.get(name) : null));
  return HYPH_LANGS;
}

// --- the controller's remaining TyperDocker methods ---------------------------

const CoreMethods = {
  _retranslate() {
    for (const fn of this._retrans) {
      try {
        fn();
      } catch (e) {
        console.error("TypeR: retranslate", e);   // eslint-disable-line no-console
      }
    }
    this.tabs.retranslate();
    this._retranslate_panels();
    if (this.lang_combo) this.lang_combo.setValue(this._lang);
    this._refresh_pages_combo();
    this._update_text_preview();
  },

  _load_settings() {
    const d = T.get("settings", {});
    if (typeof d === "string") {
      try {
        return JSON.parse(d);
      } catch (e) {
        return {};
      }
    }
    return d || {};
  },

  _build_shapr_tab() {
    this.shapr_widget = new TextShapRWidget(this);
    const pb = this._new_panel("shapr_panel", "shapr");
    pb.body.appendChild(this.shapr_widget.el);
  },

  _build_sfx_tab() {
    const pb = this._new_panel("sfx_panel", "sfx");
    try {
      this.sfx_panel = new SfxPanel(this);
      pb.body.appendChild(this.sfx_panel.el);
    } catch (e) {
      this.sfx_panel = null;
      pb.body.appendChild(h("div", { class: "hint", text: "SFX Helper could not load:\n" + (e && e.message ? e.message : e) }));
    }
  },

  _load_ui_tab() {
    const v = T.get("uiTab", "type");
    if (typeof v === "number" || /^\d+$/.test(String(v))) {
      // the Krita build stored the index of the tab bar's default order
      return (TAB_DEFAULTS[Number(v)] || TAB_DEFAULTS[0])[0];
    }
    return String(v || "type");
  },

  _on_tab_shown(id) {
    if (id === "shapr" && this.shapr_widget) this.shapr_widget.refresh();
    if (id === "batch" && this._bp_run === null) this.batch_show_page(true);
  },
};

Object.assign(TypeR.prototype, PanelMethods, TypeTabMethods, PresetMethods, StyleTabMethods, SetupTabMethods,
  BatchMethods, FontsMethods, CoreMethods);

/** Build the whole panel into `root`. */
export function buildApp(root) {
  const app = new TypeR(root);
  app._retrans = [];
  app._build_order = [];
  app._groups = app._load_groups();
  const last = app._load_last_manga();
  app._group = last.group || "";
  app._char = last.char || "";
  app._preset_usage = app._load_preset_usage();
  app._main_chars_map = app._load_main_chars();
  app._keybinds = app._load_keybinds();
  try {
    TT.registerCustom(app._load_custom_types());
  } catch (e) {
    // a bad stored value must never abort the panel
  }

  app.tabs = new Tabs(app);
  app.status = h("div", { class: "status" });
  app.build_lbl = h("div", { class: "build" });
  root.append(app.tabs.bar, app.tabs.stack, app.status, app.build_lbl);

  app._build_setup_tab();
  app._build_type_tab();
  app._build_style_tab();
  app._build_bubblr_tab();
  app._build_batch_tab();
  app._build_shapr_tab();
  app._build_sfx_tab();
  app._build_fonts_tab();
  app.build_lbl.textContent = app.versionLine();

  // enable switches (tabs are hidden, never destroyed)
  app._on_enable_bubblr(app.enable_bubblr_chk.isChecked(), false);
  app._on_enable("batch", "enableBatch", app.enable_batch_chk.isChecked(), false);
  app._on_enable("shapr", "enableShapr", app.enable_shapr_chk.isChecked(), false);
  app._on_enable("sfx", "enableSfx", app.enable_sfx_chk.isChecked(), false);
  app._on_enable("fonts", "enableFonts", app.enable_fonts_chk.isChecked(), false);
  app._on_enable_balloon(app.enable_balloon_chk.isChecked(), false);
  app._on_enable_patterns(app.enable_patterns_chk.isChecked(), false);
  app._on_enable_texttypes(app.enable_texttypes_chk.isChecked(), false);

  const order = String(T.get("tabOrder", "") || "").split(",").filter((x) => x);
  if (order.length) app.tabs.applyOrder(order);
  app._apply_panel_positions();
  app._apply_panel_order();
  app._on_customize_toggle(app.customize_chk.isChecked());

  app._apply_settings(app._load_settings());
  app._on_outline_toggle();
  app._on_shadow_toggle();
  app._on_auto_toggle();
  app._refresh_groups_combo();
  app._refresh_chars_combo();
  app._refresh_presets_combo();
  app._retranslate();
  app._init_first_session();
  app._refresh_view();
  app._apply_view();
  app._apply_preset_mode();
  app._load_pattern_images();
  app._install_key_hook(root);

  app.tabs.onChange = (id) => app._on_tab_shown(id);
  if (!app.tabs.select(app._load_ui_tab(), false)) app.tabs.select("type", false);
  // re-detach saved panels once the extra hosts had a chance to register
  setTimeout(() => app._apply_detached(), 0);
  return app;
}

// --- UXP entrypoints -------------------------------------------------------------

let appInstance = null;
let starting = null;

async function start(root) {
  await initSettings();
  await preloadHyphenation();
  setBubblrLocked(!(await pluginFileExists("bubblr_dev")));
  root.classList.add("typer-root");
  appInstance = buildApp(root);
  return appInstance;
}

function extraPanel(slot) {
  return {
    create(node) {
      let api = null;
      try {
        api = { show: () => uxp().entrypoints.getPanel(`typer_extra_${slot + 1}`).show() };
      } catch (e) {
        api = null;
      }
      EXTRA_HOSTS[slot] = new ExtraHost(slot, node, api);
      EXTRA_HOSTS[slot].setHint(appInstance ? appInstance._tr("detach_host_hint") : "");
      if (appInstance) appInstance._apply_detached();
    },
    destroy() {
      if (appInstance) {
        for (const [pid, s] of Object.entries(appInstance._detached)) if (s === slot) appInstance._reattach_panel(pid);
      }
      delete EXTRA_HOSTS[slot];
    },
  };
}

try {
  const { entrypoints } = uxp();
  entrypoints.setup({
    plugin: {
      destroy() {
        return flush();
      },
    },
    panels: {
      typer: {
        create(node) {
          if (!starting) {
            starting = start(node).catch((e) => {
              node.appendChild(h("pre", { class: "fatal", text: "TypeR could not start:\n" + (e && e.stack ? e.stack : e) }));
            });
          }
          return starting;
        },
        show() {},
        hide() {
          flush();
        },
        destroy() {
          return flush();
        },
      },
      typer_extra_1: extraPanel(0),
      typer_extra_2: extraPanel(1),
      typer_extra_3: extraPanel(2),
    },
  });
} catch (e) {
  // not running inside UXP (tests / bundling)
}
