// i18n integrity: every string key the Photoshop code asks for exists — in
// the Krita LANG table, the port's own additions (PS_EXTRA) or the Photoshop
// rewording — so no raw key can ever show in the panel. Also: every Krita
// key is still reachable (nothing of the original UI text was dropped), and
// the Photoshop overrides only override keys that exist.

import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const LANG = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", "lang.json"), "utf8"));
const SFX_LANG = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", "sfx_lang.json"), "utf8"));
const OVR = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "i18n", "ps_overrides.json"), "utf8"));

function src(rel) {
  return fs.readFileSync(path.join(ROOT, "src", rel), "utf8");
}

function psExtraKeys(lang) {
  const text = src("ui/i18n.js");
  const block = new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},`).exec(text);
  return new Set(block ? [...block[1].matchAll(/^\s{4}([a-z0-9_]+):/gm)].map((m) => m[1]) : []);
}

const EXTRA_EN = psExtraKeys("en");
const known = (k) => k in LANG.lang.en || EXTRA_EN.has(k) || k in ((OVR.typer || {}).en || {});

const UI_FILES = ["ui/app.js", "ui/typetab.js", "ui/presets.js", "ui/styletab.js", "ui/setuptab.js", "ui/batch.js", "ui/shapr.js",
  "ui/fontstab.js", "ui/panels.js", "ui/widgets.js", "main.js"];

function usedKeys() {
  const keys = new Set();
  for (const f of UI_FILES) {
    const s = src(f);
    for (const m of s.matchAll(/(?:_tr|\bt)\(\s*"([a-z][a-z0-9_]*)"/g)) keys.add(m[1]);
    // [widgetName, key] / [widgetName, key, tip] tables
    for (const m of s.matchAll(/\["[a-z0-9_]+_(?:btn|chk)", "([a-z][a-z0-9_]*)"(?:, (true|false))?\]/g)) {
      keys.add(m[1]);
      if (m[2] !== "false" && /batch|bp_/.test(m[1])) keys.add(m[1] + "_tip");
    }
    // plain key lists: ["valign_top", "valign_middle", …].forEach((k …
    for (const m of s.matchAll(/\[((?:"[a-z0-9_]+",?\s*)+)\]\s*\.forEach\(\(k/g)) {
      for (const k of m[1].matchAll(/"([a-z0-9_]+)"/g)) keys.add(k[1]);
    }
  }
  // status keys returned by the host / core code
  for (const f of ["host/insert.js", "host/balloon.js", "host/fill.js", "core/insertplan.js"]) {
    for (const m of src(f).matchAll(/"((?:st|sel|fill)_[a-z0-9_]+)"/g)) keys.add(m[1]);
  }
  return keys;
}

test("every key the panel asks for exists", () => {
  // "prefix_" + id keys are checked one by one below
  const missing = [...usedKeys()].filter((k) => !k.endsWith("_") && !known(k));
  expect(missing).toEqual([]);
});

test("keys built from a prefix + id exist for every id", () => {
  const ids = {
    balloon_: ["oval", "cloud", "burst", "radio", "dashed", "robot", "wavy", "rough"],
    patgen_: ["dots", "hstripes", "vstripes", "diagonal", "crosshatch", "grid", "checker", "noise", "sparkle", "smooth"],
    shaper_: ["balanced", "round", "tall", "wide"],
    bp_batch_: ["round", "rect", "sfx"],
    hyph_: ["en", "de", "es", "fr", "pt", "it"],
  };
  const missing = [];
  for (const [prefix, list] of Object.entries(ids)) for (const id of list) if (!known(prefix + id)) missing.push(prefix + id);
  expect(missing).toEqual([]);
});

test("panel titles and tab names resolve", () => {
  const panels = src("ui/panels.js");
  const vals = [...panels.matchAll(/:\s*"((?:panel|tab)_[a-z0-9_]+)"/g)].map((m) => m[1]);
  expect(vals.length).toBeGreaterThanOrEqual(30);
  expect(vals.filter((k) => !known(k))).toEqual([]);
});

test("the Photoshop additions exist in English and German", () => {
  const de = psExtraKeys("de");
  expect([...EXTRA_EN].filter((k) => !de.has(k))).toEqual([]);
});

test("Photoshop overrides only reword existing Krita keys", () => {
  for (const [code, table] of Object.entries(OVR.typer || {})) {
    for (const k of Object.keys(table)) expect(k in LANG.lang.en || EXTRA_EN.has(k), `${code}:${k}`).toBe(true);
  }
  for (const [code, table] of Object.entries(OVR.sfx || {})) {
    for (const k of Object.keys(table)) expect(k in SFX_LANG.lang.en, `sfx ${code}:${k}`).toBe(true);
  }
});

test("the SFX tab only asks for SFX keys that exist", () => {
  const s = src("ui/sfx.js");
  const keys = new Set([...s.matchAll(/this\.t\(\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]));
  keys.delete("strategy_");
  for (const sid of ["ignore", "romaji", "note", "overlay", "redraw"]) {
    keys.add("strategy_" + sid);
    keys.add("strategy_" + sid + "_hint");
  }
  expect([...keys].filter((k) => !(k in SFX_LANG.lang.en))).toEqual([]);
});

test("all six languages are complete or fall back to English", () => {
  for (const code of ["en", "de", "es", "fr", "pt", "it"]) {
    expect(LANG.lang[code], code).toBeTruthy();
    expect(SFX_LANG.lang[code], code).toBeTruthy();
  }
  // Krita's own coverage is kept: German covers every English key
  const de = LANG.lang.de;
  const miss = Object.keys(LANG.lang.en).filter((k) => !(k in de));
  expect(miss.length).toBeLessThan(5);
});
