// Font FILES by family name — name-table based, not registry based.
//
// Port of the host-free parts of TypeR-Krita `typer_kr/fontfiles.py`: reading
// name IDs 1/2/4/16 (every language, .ttc/.otc collections included) out of
// the font file bytes, and FontFileIndex, which maps a wanted family to ALL
// its files through the fontmatch ladder plus a prefix-trim fallback. The
// host (host/fonts.js) lists the font folders, reads the bytes and keeps the
// mtime+size cache; bump CACHE_VERSION whenever the parser's output changes.

import { FontIndex, squash, splitCut, tokens } from "./fontmatch.js";

export const FONT_EXTS = [".ttf", ".otf", ".ttc", ".otc"];
export const CACHE_VERSION = 2;

const NID_FAMILY = 1;
const NID_SUBFAMILY = 2;
const NID_FULL = 4;
const NID_TYPO_FAMILY = 16;

const MAC_ROMAN_HIGH = "ÄÅÇÉÑÖÜáàâäãåçéè"
  + "êëíìîïñóòôöõúùûü"
  + "†°¢£§•¶ß®©™´¨≠ÆØ"
  + "∞±≤≥¥µ∂∑∏π∫ªºΩæø"
  + "¿¡¬√ƒ≈∆«»… ÀÃÕŒœ"
  + "–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ"
  + "‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ"
  + "ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

function decodeName(platformId, encodingId, raw) {
  try {
    if (platformId === 0 || platformId === 3) {
      // UTF-16 BE, errors ignored
      let s = "";
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const u = (raw[i] << 8) | raw[i + 1];
        s += String.fromCharCode(u);
      }
      // drop lone surrogates like Python's "ignore"
      return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
    }
    if (encodingId === 0) {
      let s = "";
      for (const b of raw) s += b < 0x80 ? String.fromCharCode(b) : MAC_ROMAN_HIGH[b - 0x80];
      return s;
    }
    let s = "";
    for (const b of raw) s += String.fromCharCode(b);
    return s;
  } catch (e) {
    return "";
  }
}

function cleanName(s) {
  return (s || "").replace(/[\x00-\x1f]/g, "").trim();
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/** [families Set, fulls Set] declared by the face whose table directory
 *  starts at `base` of the font bytes `b`. Odd files give empty sets. */
function namesOfFace(b, base) {
  const fams = new Set();
  const fulls = new Set();
  try {
    if (base + 12 > b.length) return [fams, fulls];
    const numTables = u16(b, base + 4);
    if (!(numTables > 0 && numTables < 512)) return [fams, fulls];
    let off = 0;
    let length = 0;
    for (let i = 0; i < numTables; i++) {
      const r = base + 12 + 16 * i;
      if (r + 16 > b.length) break;
      if (b[r] === 0x6e && b[r + 1] === 0x61 && b[r + 2] === 0x6d && b[r + 3] === 0x65) {  // 'name'
        off = u32(b, r + 8);
        length = u32(b, r + 12);
        break;
      }
    }
    if (!off || !length) return [fams, fulls];
    const data = b.subarray(off, off + Math.min(length, 1 << 22));
    if (data.length < 6) return [fams, fulls];
    const count = u16(data, 2);
    const strOff = u16(data, 4);
    if (count > 4096) return [fams, fulls];
    const allIds = new Map();
    const english = new Map();
    for (let i = 0; i < count; i++) {
      const p = 6 + 12 * i;
      if (p + 12 > data.length) break;
      const pid = u16(data, p);
      const eid = u16(data, p + 2);
      const lid = u16(data, p + 4);
      const nid = u16(data, p + 6);
      const ln = u16(data, p + 8);
      const noff = u16(data, p + 10);
      if (![NID_FAMILY, NID_SUBFAMILY, NID_FULL, NID_TYPO_FAMILY].includes(nid)) continue;
      const start = strOff + noff;
      const raw = data.subarray(start, start + ln);
      if (raw.length < ln) continue;
      const val = cleanName(decodeName(pid, eid, raw));
      if (!val) continue;
      if (!allIds.has(nid)) allIds.set(nid, new Set());
      allIds.get(nid).add(val);
      if ((pid === 3 && lid === 0x409) || (pid === 1 && lid === 0)) {
        if (!english.has(nid)) english.set(nid, val);
      }
    }
    for (const nid of [NID_FAMILY, NID_TYPO_FAMILY]) for (const v of allIds.get(nid) || []) fams.add(v);
    for (const v of allIds.get(NID_FULL) || []) fulls.add(v);
    const fam1 = english.get(NID_FAMILY);
    const sub1 = english.get(NID_SUBFAMILY);
    if (fam1 && sub1) fulls.add(`${fam1} ${sub1}`);
  } catch (e) {
    return [fams, fulls];
  }
  return [fams, fulls];
}

/** [families, fulls] (Sets) declared by a font file's bytes — handles
 *  .ttc/.otc bundles. */
export function fontFileNames(bytes) {
  const fams = new Set();
  const fulls = new Set();
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 12 && b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66) {  // 'ttcf'
      const num = u32(b, 8);
      if (!(num > 0 && num < 256)) return [fams, fulls];
      for (let i = 0; i < num; i++) {
        const o = u32(b, 12 + 4 * i);
        const [f, u] = namesOfFace(b, o);
        f.forEach((x) => fams.add(x));
        u.forEach((x) => fulls.add(x));
      }
    } else {
      const [f, u] = namesOfFace(b, 0);
      f.forEach((x) => fams.add(x));
      u.forEach((x) => fulls.add(x));
    }
  } catch (e) {
    // unreadable: nothing
  }
  return [fams, fulls];
}

/**
 * The parts of a font file that fontFileNames() reads — header, table
 * directories, the name tables — fetched with `readAt(offset, length)`
 * (async, returns Uint8Array) into an otherwise empty buffer of `size`
 * bytes. Indexing thousands of fonts this way reads kilobytes per file
 * instead of whole files (CJK faces are 20 MB+).
 */
export async function sparseFontHead(size, readAt) {
  const b = new Uint8Array(Math.max(0, size));
  const put = async (off, len) => {
    if (off < 0 || off >= size || len <= 0) return;
    const n = Math.min(len, size - off);
    const got = await readAt(off, n);
    b.set(got.subarray(0, Math.min(n, got.length)), off);
  };
  await put(0, 12);
  const faces = [];
  if (b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66) {
    const num = u32(b, 8);
    if (!(num > 0 && num < 256)) return b;
    await put(12, 4 * num);
    for (let i = 0; i < num; i++) faces.push(u32(b, 12 + 4 * i));
  } else {
    faces.push(0);
  }
  for (const base of faces) {
    await put(base, 12);
    const numTables = u16(b, base + 4);
    if (!(numTables > 0 && numTables < 512)) continue;
    await put(base + 12, 16 * numTables);
    for (let i = 0; i < numTables; i++) {
      const r = base + 12 + 16 * i;
      if (b[r] === 0x6e && b[r + 1] === 0x61 && b[r + 2] === 0x6d && b[r + 3] === 0x65) {
        await put(u32(b, r + 8), Math.min(u32(b, r + 12), 1 << 22));
        break;
      }
    }
  }
  return b;
}

/** Every installed font file, keyed by the names it declares. Lookups return
 *  ALL files of a family (Regular, Bold, Italic, …). `namesFn(path)` returns
 *  [families, fulls] (Sets or arrays) — the host feeds it from its cache. */
export class FontFileIndex {
  constructor(paths, namesFn) {
    this.byFamily = new Map();
    this.byFull = new Map();
    this._fullFams = new Map();
    this._sibling = new Map();
    this._squash = new Map();
    this._famNames = new Map();
    for (const path of paths) {
      const [fams0, fulls0] = namesFn(path);
      const fams = [...(fams0 || [])];
      const fulls = [...(fulls0 || [])];
      if (!fams.length && !fulls.length) continue;
      const lows = new Set();
      for (const fam of fams) {
        const low = fam.toLowerCase();
        lows.add(low);
        if (!this.byFamily.has(low)) this.byFamily.set(low, []);
        this.byFamily.get(low).push(path);
        if (!this._famNames.has(low)) this._famNames.set(low, fam);
        const sq = squash(fam);
        if (!this._squash.has(sq)) this._squash.set(sq, new Set());
        this._squash.get(sq).add(low);
        const [base] = splitCut(tokens(fam));
        if (base.length) {
          const key = [...base].sort().join("");
          if (!this._sibling.has(key)) this._sibling.set(key, new Set());
          this._sibling.get(key).add(low);
        }
      }
      for (const full of fulls) {
        const fl = full.toLowerCase();
        if (!this.byFull.has(fl)) this.byFull.set(fl, []);
        this.byFull.get(fl).push(path);
        if (lows.size) {
          if (!this._fullFams.has(fl)) this._fullFams.set(fl, new Set());
          lows.forEach((l) => this._fullFams.get(fl).add(l));
        }
      }
    }
    this._matcher = new FontIndex([...this._famNames.values()]);
  }

  _filesForFamilies(lows) {
    const out = [];
    const seen = new Set();
    for (const low of lows) {
      for (const p of this.byFamily.get(low) || []) {
        const k = p.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(p);
        }
      }
    }
    return out;
  }

  _siblingsOf(low) {
    const fam = this._famNames.get(low) || low;
    const [base] = splitCut(tokens(fam));
    const key = base.length ? [...base].sort().join("") : "";
    const out = new Set(this._sibling.get(key) || [low]);
    out.add(low);
    return out;
  }

  _expand(lows) {
    const out = new Set();
    for (const low of lows) this._siblingsOf(low).forEach((x) => out.add(x));
    return this._filesForFamilies(out);
  }

  _trimPrefix(name) {
    let toks = name.trim().split(/\s+/);
    while (toks.length > 1) {
      toks = toks.slice(0, -1);
      const cand = toks.join(" ");
      const low = cand.toLowerCase();
      if (this.byFamily.has(low)) return this._expand([low]);
      const hit = this._squash.get(squash(cand));
      if (hit) return this._expand(hit);
    }
    return [];
  }

  /** All font files belonging to `family`, best effort. [] if unknown. */
  filesFor(family) {
    const name = (family || "").trim();
    if (!name) return [];
    const low = name.toLowerCase();
    if (this.byFamily.has(low)) return this._expand([low]);
    const hit = this._squash.get(squash(name));
    if (hit) return this._expand(hit);
    if (this.byFull.has(low)) {
      const fams = this._fullFams.get(low);
      if (fams && fams.size) return this._expand(fams);
      return [...this.byFull.get(low)];
    }
    const m = this._matcher.resolve(name);
    if (m) return this._expand([m.family.toLowerCase()]);
    return this._trimPrefix(name);
  }
}

// --- faces inside a file (for picking the exact cut Photoshop uses) --------

function faceNamesAt(b, base) {
  const out = { psName: "", family: "", subfamily: "", full: "", typoFamily: "", typoSubfamily: "" };
  const numTables = u16(b, base + 4);
  let off = 0;
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + 16 * i;
    if (r + 16 > b.length) break;
    if (b[r] === 0x6e && b[r + 1] === 0x61 && b[r + 2] === 0x6d && b[r + 3] === 0x65) {
      off = u32(b, r + 8);
      break;
    }
  }
  if (!off) return out;
  const data = b.subarray(off);
  const count = u16(data, 2);
  const strOff = u16(data, 4);
  const want = { 6: "psName", 1: "family", 2: "subfamily", 4: "full", 16: "typoFamily", 17: "typoSubfamily" };
  const prio = {};
  for (let i = 0; i < count; i++) {
    const p = 6 + 12 * i;
    if (p + 12 > data.length) break;
    const pid = u16(data, p);
    const eid = u16(data, p + 2);
    const lid = u16(data, p + 4);
    const nid = u16(data, p + 6);
    const key = want[nid];
    if (!key) continue;
    const raw = data.subarray(strOff + u16(data, p + 10), strOff + u16(data, p + 10) + u16(data, p + 8));
    const val = cleanName(decodeName(pid, eid, raw));
    if (!val) continue;
    // English Windows name first, then Mac Roman, then anything
    const rank = pid === 3 && lid === 0x409 ? 3 : pid === 1 && lid === 0 ? 2 : 1;
    if (!prio[key] || rank > prio[key]) {
      prio[key] = rank;
      out[key] = val;
    }
  }
  return out;
}

/** Every face of a font file with its names:
 *  [{index, psName, family, subfamily, full, typoFamily, typoSubfamily}]. */
export function faceInfos(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = [];
  try {
    if (b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66) {
      const num = u32(b, 8);
      for (let i = 0; i < num && i < 256; i++) out.push({ index: i, ...faceNamesAt(b, u32(b, 12 + 4 * i)) });
    } else {
      out.push({ index: 0, ...faceNamesAt(b, 0) });
    }
  } catch (e) {
    // odd file
  }
  return out;
}

/** A standalone sfnt (ArrayBuffer) for face `index` of a .ttc/.otc — what
 *  opentype.js can parse. Non-collections come back unchanged. */
export function extractFace(bytes, index = 0) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66)) {
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const base = u32(b, 12 + 4 * index);
  const numTables = u16(b, base + 4);
  const recs = [];
  let size = 12 + 16 * numTables;
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + 16 * i;
    const off = u32(b, r + 8);
    const len = u32(b, r + 12);
    recs.push({ r, off, len });
    size += (len + 3) & ~3;
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(b.subarray(base, base + 12), 0);
  let pos = 12 + 16 * numTables;
  recs.forEach((rec, i) => {
    out.set(b.subarray(rec.r, rec.r + 8), 12 + 16 * i);     // tag + checksum
    dv.setUint32(12 + 16 * i + 8, pos);
    dv.setUint32(12 + 16 * i + 12, rec.len);
    out.set(b.subarray(rec.off, rec.off + rec.len), pos);
    pos += (rec.len + 3) & ~3;
  });
  return out.buffer;
}

/** Which of a family's Photoshop styles is the regular / bold / italic /
 *  bold-italic cut. `styles` = [{style, psName}] as app.fonts reports them. */
export function pickStyles(styles) {
  const low = (s) => String(s || "").toLowerCase();
  const isBold = (s) => /\b(bold|black|heavy|extrabold|ultrabold)\b/.test(low(s)) && !/semi|demi/.test(low(s));
  const isItalic = (s) => /(italic|oblique|kursiv)/.test(low(s));
  const regularNames = ["regular", "normal", "roman", "book", "plain", "medium", "standard", ""];
  const byRank = (cands, pref) => {
    for (const p of pref) {
      const hit = cands.find((c) => low(c.style) === p);
      if (hit) return hit;
    }
    return cands[0] || null;
  };
  const plain = styles.filter((s) => !isBold(s.style) && !isItalic(s.style));
  const bolds = styles.filter((s) => isBold(s.style) && !isItalic(s.style));
  const italics = styles.filter((s) => !isBold(s.style) && isItalic(s.style));
  const boldItalics = styles.filter((s) => isBold(s.style) && isItalic(s.style));
  return {
    regular: byRank(plain, regularNames) || styles[0] || null,
    bold: byRank(bolds, ["bold"]),
    italic: byRank(italics, ["italic", "oblique"]),
    boldItalic: byRank(boldItalics, ["bold italic", "bolditalic", "bold oblique"]),
  };
}

/** Map each wanted family to ALL its files: [{family: [paths]}, missing]. */
export function collectFontFiles(index, families) {
  const wanted = [];
  const seen = new Set();
  for (const fam of families || []) {
    const f = (fam || "").trim();
    if (f && !seen.has(f.toLowerCase())) {
      seen.add(f.toLowerCase());
      wanted.push(f);
    }
  }
  const found = {};
  const missing = [];
  for (const fam of wanted) {
    const files = index.filesFor(fam);
    if (files.length) found[fam] = files;
    else missing.push(fam);
  }
  return [found, missing];
}

/** Zip member names for font files under `folder`: skips duplicates, keeps
 *  two different files with the same base name apart (numbered). Returns
 *  [[sourcePath, zipName], …]. */
export function fontZipNames(files, folder = "fonts/") {
  let paths = [];
  if (files && typeof files === "object" && !Array.isArray(files)) {
    for (const v of Object.values(files)) paths.push(...(typeof v === "string" ? [v] : v || []));
  } else {
    paths = [...(files || [])];
  }
  const done = new Set();
  const used = new Map();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const key = p.replace(/\//g, "\\").toLowerCase();
    if (done.has(key)) continue;
    done.add(key);
    const base = p.split(/[\\/]/).pop();
    let name = base;
    let i = 1;
    while (used.has(name.toLowerCase()) && used.get(name.toLowerCase()) !== key) {
      const dot = base.lastIndexOf(".");
      const root = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      name = `${root}_${i}${ext}`;
      i += 1;
    }
    used.set(name.toLowerCase(), key);
    out.push([p, folder + name]);
  }
  return out;
}
