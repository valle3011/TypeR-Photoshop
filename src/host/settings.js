// Persistent settings (the kritarc of the port).
//
// Same keys and same JSON value formats as the Krita plugin (group
// "typer_kr" for TypeR, "MangaSFX" for the SFX tab), so presets, favourites,
// keybinds and SFX data can travel between the two versions. Values live in
// memory; writes are debounced into JSON files in the plugin's data folder.
// Big values (sessions, presets, the font index cache) get their own file so
// one small toggle never rewrites megabytes.

import { uxp } from "./ps.js";

const BIG = new Set(["sessions", "presets", "fontIndex", "measureCal", "charWidths", "patternLibrary"]);
const store = { typer_kr: {}, MangaSFX: {} };
let folder = null;
let dirty = new Set();
let timer = null;
let memoryOnly = false;

function fileNameFor(group, key) {
  if (BIG.has(key)) return `${group}.${key}.json`;
  return `${group}.json`;
}

async function readJson(name) {
  try {
    const entry = await folder.getEntry(name);
    const txt = await entry.read({ format: uxp().storage.formats.utf8 });
    return JSON.parse(txt);
  } catch (e) {
    return undefined;
  }
}

async function writeJson(name, obj) {
  const f = await folder.createFile(name, { overwrite: true });
  await f.write(JSON.stringify(obj), { format: uxp().storage.formats.utf8 });
}

/** Load everything once at startup. Without UXP (tests) it stays in memory. */
export async function initSettings() {
  try {
    folder = await uxp().storage.localFileSystem.getDataFolder();
  } catch (e) {
    memoryOnly = true;
    return;
  }
  for (const group of Object.keys(store)) {
    const small = await readJson(`${group}.json`);
    if (small && typeof small === "object") Object.assign(store[group], small);
    for (const key of BIG) {
      const v = await readJson(`${group}.${key}.json`);
      if (v !== undefined) store[group][key] = v;
    }
  }
}

export function readSetting(group, key, dflt = undefined) {
  const g = store[group] || {};
  return Object.prototype.hasOwnProperty.call(g, key) ? g[key] : dflt;
}

export function writeSetting(group, key, value) {
  if (!store[group]) store[group] = {};
  store[group][key] = value;
  dirty.add(fileNameFor(group, key) + "\u0000" + group + "\u0000" + key);
  schedule();
}

export function removeSetting(group, key) {
  if (store[group]) delete store[group][key];
  dirty.add(fileNameFor(group, key) + "\u0000" + group + "\u0000" + key);
  schedule();
}

function schedule() {
  if (memoryOnly) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

/** Write every pending change now. */
export async function flush() {
  timer = null;
  if (memoryOnly || !folder) return;
  const files = new Map();
  for (const d of dirty) {
    const [file, group, key] = d.split("\u0000");
    files.set(file, [group, key]);
  }
  dirty = new Set();
  for (const [file, [group, key]] of files) {
    try {
      if (BIG.has(key)) {
        if (Object.prototype.hasOwnProperty.call(store[group], key)) await writeJson(file, store[group][key]);
        else await writeJson(file, null);
      } else {
        const small = {};
        for (const [k, v] of Object.entries(store[group])) if (!BIG.has(k)) small[k] = v;
        await writeJson(file, small);
      }
    } catch (e) {
      console.error("TypeR: settings write failed", file, e);   // eslint-disable-line no-console
    }
  }
}

// --- convenience for the TypeR group ---------------------------------------

export const T = {
  get: (key, dflt) => readSetting("typer_kr", key, dflt),
  set: (key, value) => writeSetting("typer_kr", key, value),
  bool: (key, dflt) => {
    const v = readSetting("typer_kr", key, dflt);
    return v === true || v === "true";
  },
  setBool: (key, on) => writeSetting("typer_kr", key, !!on),
};

export const SFX = {
  get: (key, dflt) => readSetting("MangaSFX", key, dflt),
  set: (key, value) => writeSetting("MangaSFX", key, value),
};

/** Test hook: replace the whole store (Node tests). */
export function _resetForTests(data = {}) {
  store.typer_kr = { ...(data.typer_kr || {}) };
  store.MangaSFX = { ...(data.MangaSFX || {}) };
  memoryOnly = true;
}
