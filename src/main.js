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
import { uxp, ps } from "./host/ps.js";
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
//
// Photoshop hands the panel's node to create/show — depending on the UXP
// version as the node itself or as {node}. TypeR builds into its own <div>
// and attaches it wherever the panel lives (falling back to document.body),
// and it starts from create OR show, whichever comes first. Any start-up
// error is shown in the panel and written to typer-error.log in the data
// folder, so an empty panel can never hide what went wrong.

let appInstance = null;
let starting = null;
let mainRoot = null;

/** Breadcrumbs in Photoshop's UXP log (…\UXPLogs\*.log, "[console]"), so a
 *  panel that stays empty still says how far TypeR got. */
function trace(msg) {
  try {
    console.log("[TypeR] " + msg);   // eslint-disable-line no-console
  } catch (e) {
    // no console
  }
}

function describeNode(arg) {
  if (!arg) return String(arg);
  const kind = typeof arg.appendChild === "function" ? "node" : arg.node ? "{node}" : "object";
  const tag = (arg.tagName || (arg.node && arg.node.tagName) || "").toLowerCase();
  return kind + (tag ? " <" + tag + ">" : "");
}

function panelNode(arg) {
  const n = arg && arg.node && typeof arg.node.appendChild === "function" ? arg.node : arg;
  return n && typeof n.appendChild === "function" ? n : document.body;
}

function removeBootNote() {
  try {
    const boot = document.getElementById("typer-boot");
    if (boot) boot.remove();
  } catch (e) {
    // nothing to remove
  }
}

async function writeErrorLog(text) {
  try {
    const lfs = uxp().storage.localFileSystem;
    const folder = await lfs.getDataFolder();
    const f = await folder.createFile("typer-error.log", { overwrite: true });
    await f.write(text, { format: uxp().storage.formats.utf8 });
    return f.nativePath;
  } catch (e) {
    return null;
  }
}

function showFatal(e) {
  const msg = "TypeR could not start / konnte nicht starten:\n\n" + (e && e.stack ? e.stack : String(e));
  trace("FATAL " + msg);
  console.error(msg);   // eslint-disable-line no-console
  const target = mainRoot || document.body;
  try {
    const pre = document.createElement("pre");
    pre.className = "fatal";
    pre.textContent = msg;
    target.appendChild(pre);
  } catch (err) {
    // the DOM itself failed: the log file is all that is left
  }
  writeErrorLog(msg + "\n\nPhotoshop: " + (() => {
    try {
      return ps().app.version;
    } catch (err) {
      return "?";
    }
  })()).then((path) => {
    if (!path) return;
    try {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "Log: " + path;
      target.appendChild(note);
    } catch (err) {
      // shown on screen already
    }
  });
}

async function start(root) {
  trace("start: settings");
  await initSettings();
  trace("start: hyphenation");
  await preloadHyphenation();
  setBubblrLocked(!(await pluginFileExists("bubblr_dev")));
  trace("start: building the panel");
  appInstance = buildApp(root);
  trace("ready (" + root.querySelectorAll(".panel").length + " panels, " +
    Math.round(root.getBoundingClientRect ? root.getBoundingClientRect().height : -1) + " px high)");
  return appInstance;
}

/** Attach TypeR's root to the panel and start it once. */
function attachMain(arg) {
  const target = panelNode(arg);
  trace("attach: got " + describeNode(arg) + (target === document.body ? " -> document.body" : ""));
  try {
    window.__typerStarted = true;       // boot.js stops waiting
  } catch (e) {
    // no window (tests)
  }
  if (!mainRoot) {
    mainRoot = document.createElement("div");
    mainRoot.className = "typer-root";
  }
  removeBootNote();
  if (mainRoot.parentNode !== target) target.appendChild(mainRoot);
  if (!starting) {
    starting = start(mainRoot).catch((e) => {
      showFatal(e);
      return null;
    });
  }
}

function extraPanel(slot) {
  return {
    create(arg) {
      try {
        const node = panelNode(arg);
        let api = null;
        try {
          api = { show: () => uxp().entrypoints.getPanel(`typer_extra_${slot + 1}`).show() };
        } catch (e) {
          api = null;
        }
        if (!EXTRA_HOSTS[slot]) EXTRA_HOSTS[slot] = new ExtraHost(slot, node, api);
        EXTRA_HOSTS[slot].setHint(appInstance ? appInstance._tr("detach_host_hint") : "");
        if (appInstance) appInstance._apply_detached();
      } catch (e) {
        console.error("TypeR extra panel", e);   // eslint-disable-line no-console
      }
    },
    show(arg) {
      if (!EXTRA_HOSTS[slot]) this.create(arg);
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
  window.addEventListener("error", (ev) => {
    if (!appInstance) showFatal(ev && (ev.error || ev.message));
  });
  window.addEventListener("unhandledrejection", (ev) => {
    if (!appInstance) showFatal(ev && ev.reason);
  });
} catch (e) {
  // no window (tests)
}

try {
  window.__typerMainLoaded = true;      // read by boot.js
} catch (e) {
  // no window (tests)
}
trace("main.js loaded, v" + (() => {
  try {
    return uxp().versions.uxp;
  } catch (e) {
    return "?";
  }
})());

try {
  const { entrypoints } = uxp();
  trace("entrypoints.setup");
  entrypoints.setup({
    plugin: {
      destroy() {
        return flush();
      },
    },
    panels: {
      typer: {
        create(arg) {
          attachMain(arg);
        },
        show(arg) {
          attachMain(arg);
        },
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
