// Installed fonts: Photoshop's list (families, styles, PostScript names), the
// name-table font FILE index (port of fontfiles.py, cached by mtime+size) and
// loading the actual cuts as opentype.js fonts for measuring and previews.

import * as opentype from "opentype.js";
import { ps } from "./ps.js";
import { listDir, stat, readBytes, envPaths, openForRanges } from "./files.js";
import { T } from "./settings.js";
import {
  FontFileIndex, fontFileNames, faceInfos, extractFace, pickStyles, CACHE_VERSION, FONT_EXTS, collectFontFiles, sparseFontHead,
} from "../core/fontfiles.js";
import { sortedBy } from "../core/py.js";
import { FontIndex } from "../core/fontmatch.js";

let familyMap = null;       // family -> [{style, psName, name}]
let familyList = [];
let fileIndex = null;
let indexBuilding = null;
const faceInfoCache = new Map();
const fontCache = new Map();

/** Re-read Photoshop's font list. */
export function reloadFamilies() {
  familyMap = new Map();
  try {
    for (const f of ps().app.fonts) {
      const fam = f.family || f.name;
      if (!fam) continue;
      if (!familyMap.has(fam)) familyMap.set(fam, []);
      familyMap.get(fam).push({ style: f.style || "", psName: f.postScriptName, name: f.name });
    }
  } catch (e) {
    // outside Photoshop: empty list
  }
  familyList = sortedBy([...familyMap.keys()], (s) => s.toLowerCase());
  return familyList;
}

/** Every installed family (sorted case-insensitively), like Qt's families(). */
export function families() {
  if (!familyMap) reloadFamilies();
  return familyList;
}

export function stylesOf(family) {
  if (!familyMap) reloadFamilies();
  return familyMap.get(family) || [];
}

/** The installed spelling of `family` (exact, else case-insensitive). */
export function installedFamily(family) {
  if (!familyMap) reloadFamilies();
  if (familyMap.has(family)) return family;
  const low = String(family || "").toLowerCase();
  return familyList.find((f) => f.toLowerCase() === low) || null;
}

let matcher = null;
export function fontIndex() {
  if (!matcher || matcher.families.length !== families().length) matcher = new FontIndex(families());
  return matcher;
}

/** The PS entries for a family's four cuts ({regular, bold, italic,
 *  boldItalic}, missing = null). */
export function cutsOf(family) {
  const fam = installedFamily(family);
  if (!fam) return { regular: null, bold: null, italic: null, boldItalic: null };
  return pickStyles(stylesOf(fam));
}

// --- the font FILE index ----------------------------------------------------

export function fontDirs() {
  const { win, home, sep } = envPaths();
  const j = (...p) => p.join(sep);
  if (win) {
    return [
      "C:\\Windows\\Fonts",
      j(home, "AppData", "Local", "Microsoft", "Windows", "Fonts"),
      j(home, "AppData", "Roaming", "Adobe", "CoreSync", "plugins", "livetype", "r"),
      j(home, "AppData", "Roaming", "Adobe", "CoreSync", "plugins", "livetype", ".r"),
      "C:\\Program Files\\Common Files\\Adobe\\Fonts",
    ];
  }
  return [
    "/System/Library/Fonts", "/Library/Fonts", j(home, "Library", "Fonts"),
    j(home, "Library", "Application Support", "Adobe", "CoreSync", "plugins", "livetype", ".r"),
    "/Library/Application Support/Adobe/Fonts",
  ];
}

async function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  const names = await listDir(dir);
  const livetype = /livetype/i.test(dir);
  for (const n of names) {
    const p = dir + (dir.includes("\\") ? "\\" : "/") + n;
    const st = await stat(p);
    if (!st) continue;
    if (st.isDir) await walk(p, out, depth + 1);
    else if (FONT_EXTS.some((e) => n.toLowerCase().endsWith(e)) || (livetype && !/\.\w{2,4}$/.test(n))) out.push([p, st]);
  }
}

/** The bytes fontFileNames() needs: ranges when possible, else the file. */
async function fontHead(path, size) {
  const h = size > 256 * 1024 ? await openForRanges(path) : null;
  if (!h) return readBytes(path);
  try {
    return await sparseFontHead(size, (off, len) => h.read(off, len));
  } catch (e) {
    return readBytes(path);
  } finally {
    await h.close();
  }
}

/** Build (or reuse) the index; `progress(done, total)` for the slow first
 *  run. Cached in the data folder keyed by mtime+size. */
export async function ensureIndex(progress = null) {
  if (fileIndex) return fileIndex;
  if (indexBuilding) return indexBuilding;
  indexBuilding = (async () => {
    const files = [];
    for (const d of fontDirs()) await walk(d, files);
    const cache = T.get("fontIndex", null);
    const old = cache && cache.v === CACHE_VERSION ? cache.entries || {} : {};
    const fresh = {};
    const parsed = new Map();
    let dirty = false;
    for (let i = 0; i < files.length; i++) {
      const [p, st] = files[i];
      if (progress && !(i % 100)) progress(i, files.length);
      const key = p.toLowerCase();
      const hit = old[key];
      let fams;
      let fulls;
      if (Array.isArray(hit) && hit.length === 4 && hit[0] === st.mtime && hit[1] === st.size) {
        fams = hit[2];
        fulls = hit[3];
      } else {
        try {
          const [f, u] = fontFileNames(await fontHead(p, st.size));
          fams = [...f].sort();
          fulls = [...u].sort();
        } catch (e) {
          fams = [];
          fulls = [];
        }
        dirty = true;
      }
      fresh[key] = [st.mtime, st.size, fams, fulls];
      parsed.set(p, [fams, fulls]);
    }
    if (dirty || Object.keys(fresh).length !== Object.keys(old).length) T.set("fontIndex", { v: CACHE_VERSION, entries: fresh });
    fileIndex = new FontFileIndex(files.map((f) => f[0]), (p) => parsed.get(p) || [[], []]);
    indexBuilding = null;
    return fileIndex;
  })();
  return indexBuilding;
}

export function indexReady() {
  return fileIndex !== null;
}

export function invalidateIndex() {
  fileIndex = null;
}

/** {family: [paths]}, missing — every file of each wanted family. */
export async function collectFiles(fams, progress = null) {
  const idx = await ensureIndex(progress);
  return collectFontFiles(idx, fams);
}

async function infosOf(path) {
  if (faceInfoCache.has(path)) return faceInfoCache.get(path);
  let infos = [];
  try {
    infos = faceInfos(await readBytes(path));
  } catch (e) {
    infos = [];
  }
  faceInfoCache.set(path, infos);
  return infos;
}

async function loadFont(path, index) {
  const key = `${path}#${index}`;
  if (fontCache.has(key)) return fontCache.get(key);
  let font = null;
  try {
    font = opentype.parse(extractFace(await readBytes(path), index));
  } catch (e) {
    font = null;
  }
  fontCache.set(key, font);
  return font;
}

/** The opentype font whose PostScript name is `psName` among the family's
 *  files, or null (then the caller falls back to test-layer measuring). */
export async function loadCut(family, psName) {
  if (!psName) return null;
  const idx = await ensureIndex();
  const files = idx.filesFor(family);
  for (const p of files) {
    for (const info of await infosOf(p)) {
      if (info.psName === psName) return loadFont(p, info.index);
    }
  }
  return null;
}

/** All four cuts of a family as opentype fonts (null where missing) plus the
 *  PS entries used for the text layer's style runs. */
export async function facesOf(family) {
  const cuts = cutsOf(family);
  const out = { family: installedFamily(family) || family, cuts };
  for (const k of ["regular", "bold", "italic", "boldItalic"]) {
    out[k] = cuts[k] ? await loadCut(out.family, cuts[k].psName) : null;
  }
  return out;
}
