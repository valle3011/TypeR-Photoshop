// Boots the BUILT plugin (dist/plugin/main.js, as Photoshop loads it) in a
// mock UXP host and opens the panel the way Photoshop does: entrypoints.setup
// → create/show, with the panel node passed directly OR as {node} (both
// shapes occur across UXP versions). No document is open, as at a real
// start. The panel must show its tab bar and no start-up error.
// Skipped when the plugin has not been built (node tools/build.mjs).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./helpers.js";

const nodeRequire = createRequire(import.meta.url);
const { DEV_MODULES } = nodeRequire("../tools/devdir.cjs");
const { Window } = nodeRequire(DEV_MODULES + "/happy-dom");

const BUNDLE = path.join(ROOT, "dist", "plugin", "main.js");
const HYPH = path.join(ROOT, "hyph");

function boot({ setupThrows = false, noTextCodec = false, oldDom = false } = {}) {
  const win = new Window({ url: "http://localhost/", width: 360, height: 900 });
  const g = globalThis;
  for (const k of ["document", "HTMLElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "customElements",
    "HTMLDialogElement", "Image"]) {
    g[k] = win[k];
  }
  Object.defineProperty(g, "navigator", { value: win.navigator, configurable: true });
  g.window = win;
  if (oldDom) stripModernDom(win);
  let setupArg = null;
  const photoshop = {
    app: {
      version: "25.0.0",
      activeDocument: null,
      fonts: [{ family: "Arial", style: "Regular", postScriptName: "ArialMT", name: "Arial" }],
    },
    action: { batchPlay: async (d) => d.map(() => ({})) },
    core: { executeAsModal: async (fn) => fn({ hostControl: { suspendHistory: async () => 1, resumeHistory: async () => {} } }) },
    constants: {},
  };
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
              if (name !== "hyph") throw new Error("missing " + name);
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
      },
    },
    shell: { openExternal() {}, openPath() {} },
    entrypoints: {
      setup(arg) {
        if (setupThrows) throw new Error("setup refused (test)");
        setupArg = arg;
      },
      getPanel: () => ({ show() {} }),
    },
    versions: { uxp: "7.4.0" },
  };
  g.require = (id) => ({ photoshop, uxp, fs: null, os: null }[id]);
  // run the bundle like a <script> tag; optionally without TextEncoder/Decoder (UXP 7.1)
  const saved = [g.TextEncoder, g.TextDecoder];
  if (noTextCodec) {
    g.TextEncoder = undefined;
    g.TextDecoder = undefined;
  }
  new Function(fs.readFileSync(BUNDLE, "utf8"))();   // eslint-disable-line no-new-func
  const polyfilled = noTextCodec && typeof g.TextDecoder === "function" && typeof g.TextEncoder === "function";
  if (noTextCodec) [g.TextEncoder, g.TextDecoder] = saved;
  win.__polyfilled = polyfilled;
  return { win, setup: setupArg };
}

/** Make happy-dom look like UXP 7.1: no append/prepend/remove/closest/
 *  matches/replaceChildren, and classList.toggle ignores its force flag. */
function stripModernDom(win) {
  const probe = win.document.createElement("div");
  for (let p = Object.getPrototypeOf(probe); p; p = Object.getPrototypeOf(p)) {
    for (const k of ["append", "prepend", "remove", "closest", "matches", "replaceChildren"]) {
      if (Object.prototype.hasOwnProperty.call(p, k)) delete p[k];
    }
  }
  const listProto = Object.getPrototypeOf(probe.classList);
  const plain = listProto.toggle;
  listProto.toggle = function toggle(c) {
    return plain.call(this, c);
  };
}

async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(!fs.existsSync(BUNDLE))("the built plugin boots in a UXP-like host", () => {
  for (const shape of ["node", "{node}"]) {
    it(`opens the panel when create/show receive ${shape}`, async () => {
      const { win, setup } = boot();
      expect(setup, "entrypoints.setup was not called").toBeTruthy();
      expect(Object.keys(setup.panels)).toEqual(["typer", "typer_extra_1", "typer_extra_2", "typer_extra_3"]);
      const panel = win.document.createElement("div");
      win.document.body.appendChild(panel);
      const arg = shape === "node" ? panel : { node: panel };
      setup.panels.typer.create(arg);
      setup.panels.typer.show(arg);
      const tabs = await waitFor(() => panel.querySelector(".tabbar") || panel.querySelector(".fatal"));
      const fatal = panel.querySelector(".fatal");
      expect(fatal ? fatal.textContent : "", "start-up error").toBe("");
      expect(tabs, "no tab bar after start").toBeTruthy();
      expect(panel.querySelectorAll(".tabbar .tab").length).toBe(8);
      expect(panel.querySelector(".typer-root .page-inner .panel")).toBeTruthy();
      expect(win.document.getElementById("typer-boot")).toBe(null);
    }, 60000);
  }
  it("builds into the visible page when Photoshop never calls create/show (Photoshop 2023)", async () => {
    const { win, setup } = boot({ noTextCodec: true });
    expect(setup).toBeTruthy();
    expect(win.__polyfilled, "TextEncoder/TextDecoder polyfills installed").toBe(true);
    const tabs = await waitFor(() => win.document.body.querySelector(".tabbar") || win.document.body.querySelector(".fatal"));
    const fatal = win.document.body.querySelector(".fatal");
    expect(fatal ? fatal.textContent : "", "start-up error").toBe("");
    expect(tabs).toBeTruthy();
    expect(win.document.body.querySelectorAll(".tabbar .tab").length).toBe(8);
  }, 60000);

  it("still starts, and says why, when entrypoints.setup throws", async () => {
    const { win } = boot({ setupThrows: true });
    const tabs = await waitFor(() => win.document.body.querySelector(".tabbar"));
    expect(tabs).toBeTruthy();
    const fatal = await waitFor(() => win.document.body.querySelector(".fatal"));
    expect(fatal && fatal.textContent).toContain("setup refused (test)");
  }, 60000);
  it("starts on a DOM without append/remove/closest and with a force-less classList.toggle (UXP 7.1)", async () => {
    const { win } = boot({ oldDom: true, noTextCodec: true });
    const tabs = await waitFor(() => win.document.body.querySelector(".tabbar") || win.document.body.querySelector(".fatal"));
    const fatal = win.document.body.querySelector(".fatal");
    expect(fatal ? fatal.textContent : "", "start-up error").toBe("");
    expect(tabs).toBeTruthy();
    expect(win.document.body.querySelectorAll(".tabbar .tab").length).toBe(8);
    // exactly one tab is selected: classList.toggle(…, force) works
    expect(win.document.body.querySelectorAll(".tabbar .tab.selected").length).toBe(1);
  }, 60000);
});
