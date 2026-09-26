// UI smoke test: builds the WHOLE panel in a DOM (happy-dom) against a mock
// Photoshop, then walks the everyday paths — every language, a script, the
// table, Insert, TextShapR, a batch run + its undo, the SFX tab, presets,
// the layout switches. It cannot prove what Photoshop renders (that is
// tests/PS_CHECKLIST.md); it proves the panel code runs and sends the
// descriptors it should.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const { DEV_MODULES } = nodeRequire("../tools/devdir.cjs");
const { Window } = nodeRequire(DEV_MODULES + "/happy-dom");

// --- the mock host ------------------------------------------------------------

const sent = [];              // every batchPlay descriptor
const dialogAnswers = [];     // queued answers for modal dialogs
let layers = [];              // the mock document's layers
let nextLayerId = 100;
let selection = null;         // {left, top, right, bottom} | null
const openQueue = [];         // files the next "open" pickers return
const saved = [];             // what the "save" pickers wrote

function mkLayer(name, kind = "text") {
  const l = {
    id: nextLayerId++, name, kind, layers: [],
    boundsNoEffects: { left: 0, top: 0, right: 10, bottom: 10 },
    async delete() {
      layers = layers.filter((x) => x !== l);
    },
    async move() {},
  };
  return l;
}

const doc = {
  id: 1, width: 1200, height: 1800, resolution: 72, mode: "RGBColorMode", name: "page.psd", path: "", bitsPerChannel: "bitDepth8",
  get layers() {
    return layers;
  },
  get activeLayers() {
    return layers.length ? [layers[0]] : [];
  },
};

const fontList = [];
for (const f of [["Arial", "Regular", "ArialMT"], ["Arial", "Bold", "Arial-BoldMT"], ["Arial", "Italic", "Arial-ItalicMT"],
  ["Arial", "Bold Italic", "Arial-BoldItalicMT"], ["Comic Sans MS", "Regular", "ComicSansMS"], ["Comic Sans MS", "Bold", "ComicSansMS-Bold"],
  ["Times New Roman", "Regular", "TimesNewRomanPSMT"]]) {
  fontList.push({ family: f[0], style: f[1], postScriptName: f[2], name: `${f[0]} ${f[1]}` });
}

async function batchPlay(descs) {
  const out = [];
  for (const d of descs) {
    sent.push(d);
    if (d._obj === "make" && d._target[0]._ref === "textLayer") {
      layers.unshift(mkLayer("text"));
      out.push({});
    } else if (d._obj === "make") {
      layers.unshift(mkLayer("shape", "shape"));
      out.push({});
    } else if (d._obj === "set" && d.to && d.to._obj === "layer" && d.to.name) {
      if (layers[0]) layers[0].name = d.to.name;
      out.push({});
    } else if (d._obj === "get" && d._target[0]._property === "selection") {
      out.push(selection ? { selection: { ...selection } } : {});
    } else if (d._obj === "get" && d._target[0]._property === "boundsNoEffects") {
      out.push({ boundsNoEffects: { left: 0, top: 0, right: 500, bottom: 80 } });
    } else if (d._obj === "get") {
      out.push({});
    } else {
      out.push({});
    }
  }
  return out;
}

const photoshop = {
  app: {
    version: "25.4.0",
    get activeDocument() {
      return doc;
    },
    set activeDocument(v) {},
    fonts: fontList,
  },
  action: { batchPlay },
  core: {
    async executeAsModal(fn) {
      return fn({ hostControl: { suspendHistory: async () => 7, resumeHistory: async () => {} } });
    },
  },
  constants: { ElementPlacement: { PLACEAFTER: "placeAfter" } },
};

// the UXP fs speaks "file:" URLs; Node's needs plain paths
const plain = (p) => String(p).replace(/^file:/, "");
const uxpFs = {
  readFile: async (p, o) => fs.promises.readFile(plain(p), o),
  writeFile: async (p, d, o) => fs.promises.writeFile(plain(p), typeof d === "string" ? d : Buffer.from(d), o),
  readdir: async (p) => fs.promises.readdir(plain(p)),
  lstat: async (p) => fs.promises.lstat(plain(p)),
  mkdir: async (p, o) => fs.promises.mkdir(plain(p), o),
  open: async (p) => fs.promises.open(plain(p), "r"),
  read: async (fd, buf, off, len, pos) => fd.read(buf, off, len, pos),
  close: async (fd) => fd.close(),
};

const HYPH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "hyph");
const uxp = {
  storage: {
    formats: { utf8: "utf8", binary: "binary" },
    localFileSystem: {
      async getDataFolder() {
        throw new Error("no data folder in tests");
      },
      async getPluginFolder() {
        return {
          async getEntry(name) {
            if (name !== "hyph") throw new Error("nope");
            return {
              async getEntry(file) {
                const p = path.join(HYPH, file);
                if (!fs.existsSync(p)) throw new Error("missing");
                return { read: async () => fs.readFileSync(p, "utf8") };
              },
            };
          },
        };
      },
      async getFileForOpening() {
        const f = openQueue.shift();
        if (!f) return null;
        return { name: f.name, nativePath: "C:\\mock\\" + f.name, read: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) };
      },
      async getFileForSaving(name) {
        return { name, nativePath: "C:\\mock\\" + name, write: async (d) => saved.push({ name, d }) };
      },
    },
  },
  shell: { openExternal() {}, openPath() {} },
  entrypoints: { setup() {}, getPanel: () => ({ show() {} }) },
  versions: { uxp: "7.4.0" },
};

let app = null;
let win = null;

beforeAll(async () => {
  win = new Window({ url: "http://localhost/", width: 420, height: 1200 });
  for (const k of ["document", "HTMLElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "customElements",
    "HTMLDialogElement", "Image"]) {
    globalThis[k] = win[k];
  }
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
  globalThis.window = win;
  globalThis.require = (id) => ({ photoshop, uxp, fs: uxpFs, os }[id]);
  // modal dialogs: answer from the queue (default: Cancel)
  const nativeShowModal = win.HTMLDialogElement.prototype.showModal;
  win.HTMLDialogElement.prototype.showModal = function showModal() {
    nativeShowModal.call(this);
    const answer = dialogAnswers.shift();
    setTimeout(() => {
      if (answer) answer(this);
      else this.close();
    }, 0);
  };
  const { initSettings } = await import("../src/host/settings.js");
  await initSettings();
  const main = await import("../src/main.js");
  const { setHyphLoader } = await import("../src/core/layout.js");
  setHyphLoader((name) => {
    const p = path.join(HYPH, name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  });
  const root = win.document.createElement("div");
  root.classList.add("typer-root");
  win.document.body.appendChild(root);
  app = main.buildApp(root);
}, 120000);

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function answerWith(text, pick = "cta") {
  dialogAnswers.push((dlg) => {
    const field = dlg.querySelector("sp-textfield, textarea");
    if (field && text !== null) field.value = text;
    const btn = dlg.querySelector(`.dlg-foot sp-button[variant="${pick}"]`);
    btn.click();
  });
}

describe("UI smoke", () => {
  it("builds every tab and panel", () => {
    expect(app).toBeTruthy();
    const pids = Object.keys(app._panels);
    for (const pid of ["script_box", "jp_en_table", "nav_line", "active_field", "comments", "live_preview", "presets", "font_picker",
      "insert", "balloon", "text_type", "style_basic", "style_size", "style_outline", "style_fill", "style_shadow", "hyphenation",
      "bubblr_detect", "bubblr_overlay", "batch_mark", "batch_overlay", "bubblr_batch", "shapr_panel", "sfx_panel", "fonts_panel",
      "setup_general", "tt_fonts", "google", "layout_sizes", "diagnostics"]) {
      expect(pids, pid).toContain(pid);
    }
    expect(app.tabs.order.length).toBe(8);
    expect(app.font_picker.families()).toContain("Arial");
    expect(app.sfx_panel).toBeTruthy();
    expect(app.fonts_panel).toBeTruthy();
  });

  it("retranslates into every UI language without a missing key showing", () => {
    for (const code of ["de", "es", "fr", "pt", "it", "en"]) {
      app._onLangChange(code);
      expect(app.insert_btn.textContent.length).toBeGreaterThan(0);
      expect(app.insert_btn.textContent).not.toBe("insert_btn");
      expect(app.tabs.buttons.type.textContent).not.toBe("tab_type");
    }
  });

  it("parses a script, navigates and fills the active field", async () => {
    app.editor.setText("Page 1\n鬼だ！\tIt's a demon!\nMiku: Run, now!\n\nPage 2\nThe end.");
    app.analyze();
    expect(app._pairs.length).toBeGreaterThanOrEqual(3);
    expect(app.table_body.children.length).toBe(app._pairs.length);
    expect(app.page_combo.count()).toBe(2);
    app.on_next();
    expect(app._index).toBe(1);
    expect(app.active_edit.text().length).toBeGreaterThan(0);
    app.on_prev();
    expect(app._index).toBe(0);
    await tick(150);
  });

  it("inserts a text layer through the Photoshop path", async () => {
    app.font_picker.setCurrentFamily("Arial");
    selection = { left: 100, top: 200, right: 500, bottom: 500 };
    sent.length = 0;
    const ok = await app.on_insert();
    expect(ok, app.status.textContent).toBe(true);
    const make = sent.find((d) => d._obj === "make" && d._target[0]._ref === "textLayer");
    expect(make).toBeTruthy();
    expect(make.using.textKey.length).toBeGreaterThan(0);
    expect(make.using.textStyleRange[0].textStyle.fontPostScriptName).toBe("ArialMT");
    const rename = sent.find((d) => d._obj === "set" && d.to && d.to.name);
    expect(rename.to.name.startsWith("TypeR 01 — ")).toBe(true);
    expect(app._done.has(0)).toBe(true);
    expect(app._index).toBe(1);
  });

  it("offers TextShapR cards for the current line", async () => {
    await app.shapr_widget.refresh();
    expect(app.shapr_widget._cands.length).toBeGreaterThan(0);
    expect(app.shapr_widget._grid.children.length).toBe(app.shapr_widget._cands.length);
  });

  it("runs a batch over hand-marked boxes and undoes it", async () => {
    selection = null;
    app._on_bp_box_added(100, 100, 300, 200);
    app._on_bp_box_added(500, 400, 300, 240);
    expect(app._bp_boxes.length).toBe(2);
    app.bp_batch_page_chk.setChecked(false);
    app.on_bp_batch_assign();
    expect(app._bp_assign.filter((u) => u >= 0).length).toBe(2);
    const before = layers.length;
    answerWith(null, "cta");              // "fill N bubbles?" -> Yes
    await app.on_bp_batch_start();
    for (let i = 0; i < 100 && app._bp_run; i++) await tick(20);
    expect(app._bp_run).toBe(null);
    expect(layers.length - before).toBe(2);
    expect(app._bp_last_units.length).toBe(2);
    // every batched layer went in with its own box, through the insert path
    const boxes = sent.filter((d) => d._obj === "make" && d._target[0]._ref === "textLayer").slice(-2);
    expect(boxes.length).toBe(2);
    // undo removes the units' TypeR layers (like Krita: all of them, also the
    // single insert of unit 1 from the test above) — and nothing else
    await app.on_bp_batch_undo();
    expect(layers.some((l) => /^TypeR 0[12] — /.test(l.name))).toBe(false);
  });

  it("never removes a layer without the TypeR prefix", async () => {
    const own = mkLayer("My hand-made layer");
    const own2 = mkLayer("TypeR 1 - not the prefix");
    layers.push(own, own2);
    app._bp_last_units = [0, 1, 2];
    await app.on_bp_batch_undo();
    expect(layers).toContain(own);
    expect(layers).toContain(own2);
  });

  it("inserts an SFX as one styled text layer", async () => {
    const s = app.sfx_panel;
    s.strategy_combo.setValue("redraw");
    s._on_strategy_changed();
    s.text_input.setText("boom");
    s._select_font("Arial", false);
    sent.length = 0;
    await s._insert_sfx();
    const make = sent.find((d) => d._obj === "make" && d._target[0]._ref === "textLayer");
    expect(make, s.status_label.textContent).toBeTruthy();
    expect(make.using.textKey).toBe("BOOM");
    const fx = sent.find((d) => d._obj === "set" && d.to && d.to._obj === "layerEffects");
    expect(fx.to.frameFX.size._value).toBe(8);          // visible outline = 8 px
    s._refresh_suggestions("BOOOOM");
    expect(s.suggest_box.children.length).toBeGreaterThan(0);
  });

  it("saves and re-applies a preset", async () => {
    app.size_spin.setNum(55);
    answerWith("Shout");
    await app.on_preset_save();
    expect(Object.keys(app._cur_presets())).toContain("Shout");
    app.size_spin.setNum(20);
    app.preset_combo.setValue("Shout");
    app._on_preset_selected();
    expect(app.size_spin.num()).toBe(55);
  });

  it("applies a TextShapR card through the insert path", async () => {
    selection = { left: 100, top: 200, right: 500, bottom: 500 };
    app._index = 2;
    app._refresh_view();
    await app.shapr_widget.refresh();
    app.shapr_widget._select(0, true);
    sent.length = 0;
    await app.shapr_widget._apply(false);
    const make = sent.find((d) => d._obj === "make" && d._target[0]._ref === "textLayer");
    expect(make, app.status.textContent).toBeTruthy();
    // the card's breaks are baked in as hard breaks
    expect(make.using.textKey.split("\r").length).toBe(app.shapr_widget._cands[0].lines.length);
  });

  it("draws a balloon as a shape layer under the text", async () => {
    app.enable_balloon_chk.setChecked(true, false);
    selection = { left: 100, top: 200, right: 500, bottom: 500 };
    sent.length = 0;
    await app.on_insert_balloon();
    const shape = sent.find((d) => d._obj === "make" && d._target[0]._ref === "contentLayer");
    expect(shape, app.status.textContent).toBeTruthy();
    expect(shape.using.shape.pathComponents.length).toBeGreaterThan(0);
  });

  it("switches presets by keybind while the panel has focus", async () => {
    app.preset_combo.setValue("Shout");
    app._sync_preset_key_edit();
    const kd = (key, code, mods = {}) => new win.KeyboardEvent("keydown", { key, code, bubbles: true, ...mods });
    app.preset_key_edit.dispatchEvent(kd("5", "Digit5", { ctrlKey: true }));
    expect(app._keybinds[app._group]["Ctrl+5"]).toBeTruthy();
    app.size_spin.setNum(11);
    app.root.dispatchEvent(kd("5", "Digit5", { ctrlKey: true }));
    expect(app.size_spin.num()).toBe(55);
    // plain typing in a text field is never taken as a key
    app.on_preset_key_clear();
    expect(app._keybinds[app._group] && app._keybinds[app._group]["Ctrl+5"]).toBeFalsy();
  });

  it("keeps several scripts as tabs and restores them", async () => {
    const n = app._sessions.length;
    app._new_untitled();
    expect(app._sessions.length).toBe(n + 1);
    app.editor.setText("Hello there.\nGeneral Kenobi!");
    app.analyze();
    app._save_sessions();
    const { T } = await import("../src/host/settings.js");
    const stored = T.get("sessions");
    expect(stored.sessions.length).toBeGreaterThanOrEqual(2);
    app._close_tab(app._active_sid);
    expect(app._sessions.length).toBe(n);
  });

  it("loads a .docx script with its comments", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    zip.file("word/document.xml", `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Page 1</w:t></w:r></w:p>
      <w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Where are you going?</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>
      <w:p><w:r><w:t>Home.</w:t></w:r></w:p></w:body></w:document>`);
    zip.file("word/comments.xml", `<w:comments ${W}><w:comment w:id="0" w:author="TL" w:date="2026-01-02T00:00:00Z"><w:p><w:r><w:t>Say it angrily</w:t></w:r></w:p></w:comment></w:comments>`);
    openQueue.push({ name: "chapter.docx", bytes: await zip.generateAsync({ type: "uint8array" }) });
    await app.on_load();
    expect(app._pairs.length, app.status.textContent).toBe(2);
    expect(app._script_comments.length).toBe(1);
    app._index = 0;
    app._refresh_view();
    expect(app.comments_view.textContent).toContain("Say it angrily");
  });

  it("imports an Excel font guide as presets and exports them again", async () => {
    const { writeXlsx } = await import("../src/core/xlsx.js");
    const bytes = await writeXlsx("Fonts", ["Character", "Normal", "Shout"], [["Miku", "Arial", "Comic Sans MS"], ["Rin", "Times New Roman", ""]]);
    openQueue.push({ name: "Fonts.xlsx", bytes });
    await app.on_preset_import_excel();
    expect(app._groups.mock).toBeTruthy();
    expect(app._groups.mock.Miku.Shout.font).toBe("Comic Sans MS");
    saved.length = 0;
    dialogAnswers.push((dlg) => {
      const pick = dlg.querySelector("sp-picker");
      pick.setIndex(1);                              // JSON
      dlg.querySelector('.dlg-foot sp-button[variant="cta"]').click();
    });
    await app.on_preset_export();
    expect(saved.length).toBe(1);
    expect(JSON.parse(saved[0].d).mock.Rin.Normal.font).toBe("Times New Roman");
  });

  it("generates a pattern and fills the text preview with it", async () => {
    app.enable_patterns_chk.setChecked(true, false);
    app.outline_chk.setChecked(true, false);
    app._generate_outline_pattern();
    expect(app._outline_pattern_img).toBeTruthy();
    expect(app._outline_pattern_img.w).toBeGreaterThan(0);
    app._patgen_dlg.close();
    await tick(10);
    const o = app._preview_opts("Hi");
    expect(o.outlinePattern === null || o.outlinePattern.w > 0).toBe(true);
    app.enable_patterns_chk.setChecked(false, false);
  });

  it("renders the live preview and the SFX preview with the real font", async () => {
    app.font_picker.setCurrentFamily("Arial");
    app.active_edit.setText("A **bold** test");
    await app.preview.paint();
    expect(app.preview.img.getAttribute("src").startsWith("data:image/png;base64,")).toBe(true);
    const s = app.sfx_panel;
    s.text_input.setText("krak");
    s.grad_chk.setChecked(true);
    s.rot.setNum(15);
    await s._update_preview();
    expect(s.preview_img.getAttribute("src").startsWith("data:image/png;base64,")).toBe(true);
    // restyle the active SFX text layer in place
    photoshop.action.batchPlay = async (descs) => {
      const out = await batchPlay(descs);
      return descs.map((d, i) => (d._obj === "get" && d._target[0]._ref === "layer"
        ? { layerID: 5, textKey: { textKey: "KRAK", transform: { xx: 1, xy: 0, yx: 0, yy: 1 } } } : out[i]));
    };
    sent.length = 0;
    await s._restyle_sfx();
    photoshop.action.batchPlay = batchPlay;
    expect(sent.some((d) => d._obj === "set" && d._target[0]._ref === "textLayer"), s.status_label.textContent).toBe(true);
    expect(sent.some((d) => d._obj === "transform")).toBe(true);
    expect(sent.some((d) => d._obj === "set" && d.to && d.to.gradientFill)).toBe(true);
  });

  it("stars fonts into categories on the Fonts tab", () => {
    app._star_font("Arial", "Dialog");
    expect(app.fonts_panel.favorite_fonts()).toContain("Arial");
    expect(app.fonts_panel.category_names()).toContain("Dialog");
    app._apply_favorite_font("Times New Roman");
    expect(app.font_picker.currentFamily()).toBe("Times New Roman");
  });

  it("detaches a panel into a floating window and back", () => {
    app._detach_panel("insert", "float");
    expect(app._detached.insert).toBe("float");
    app._reattach_panel("insert");
    expect(app._detached.insert).toBeUndefined();
    expect(app._panel_tab.insert).toBe("type");
  });

  it("switches the layout features on and off", () => {
    app.customize_chk.setChecked(true, false);
    expect(app._panels.insert.header.style.display).not.toBe("none");
    app._reorder_panel("insert", -1);
    app._move_panel_to_tab("balloon", "style");
    app.on_layout_reset();
    expect(app._panel_tab.balloon).toBe("type");
    app.customize_chk.setChecked(false, false);
    app.enable_patterns_chk.setChecked(true, false);
    expect(app._panels.style_fill.el.style.display).not.toBe("none");
    app.enable_patterns_chk.setChecked(false, false);
  });
});
