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

function boot() {
  const win = new Window({ url: "http://localhost/", width: 360, height: 900 });
  const g = globalThis;
  for (const k of ["document", "HTMLElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "customElements",
    "HTMLDialogElement", "Image"]) {
    g[k] = win[k];
  }
  Object.defineProperty(g, "navigator", { value: win.navigator, configurable: true });
  g.window = win;
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
        setupArg = arg;
      },
      getPanel: () => ({ show() {} }),
    },
    versions: { uxp: "7.4.0" },
  };
  g.require = (id) => ({ photoshop, uxp, fs: null, os: null }[id]);
  // run the bundle like a <script> tag
  new Function(fs.readFileSync(BUNDLE, "utf8"))();   // eslint-disable-line no-new-func
  return { win, setup: setupArg };
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
});
