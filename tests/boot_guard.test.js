// src/boot.js — the start guard that runs before main.js. When main.js cannot
// load (or never starts), the panel must say so instead of "TypeR is
// loading …" forever.

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./helpers.js";

const nodeRequire = createRequire(import.meta.url);
const { DEV_MODULES } = nodeRequire("../tools/devdir.cjs");
const { Window } = nodeRequire(DEV_MODULES + "/happy-dom");

const BOOT = fs.readFileSync(path.join(ROOT, "src", "boot.js"), "utf8");

function setup() {
  const win = new Window({ url: "http://localhost/" });
  win.document.body.innerHTML = '<div id="typer-boot">TypeR wird geladen …</div>';
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.require = (id) => ({
    photoshop: { app: { version: "24.1.0" } },
    uxp: { versions: { uxp: "7.0.0" }, entrypoints: { setup() {} } },
  }[id]);
  new Function(BOOT)();     // eslint-disable-line no-new-func
  return win;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("boot guard", () => {
  it("shows a load error of main.js in the panel", () => {
    const win = setup();
    const ev = new win.ErrorEvent("error", { message: "SyntaxError: Invalid regular expression", filename: "main.js", lineno: 1, colno: 42 });
    win.dispatchEvent(ev);
    const text = win.document.getElementById("typer-boot").textContent;
    expect(text).toContain("Invalid regular expression");
    expect(text).toContain("main.js:1:42");
  });

  it("reports what the host supports when TypeR never starts", () => {
    vi.useFakeTimers();
    const win = setup();
    vi.advanceTimersByTime(8100);
    const text = win.document.getElementById("typer-boot").textContent;
    expect(text).toContain("did not start");
    expect(text).toContain("Photoshop: 24.1.0");
    expect(text).toContain("UXP: 7.0.0");
    expect(text).toContain("main.js geladen/loaded: NEIN/NO");
  });

  it("stays quiet once TypeR has started", () => {
    vi.useFakeTimers();
    const win = setup();
    win.__typerStarted = true;
    vi.advanceTimersByTime(8100);
    expect(win.document.getElementById("typer-boot").textContent).toBe("TypeR wird geladen …");
  });
});
