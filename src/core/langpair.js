// Language detection (Japanese / English), pairing of source + translation,
// detection of "Page" markers, manga/preset helpers, script-tab helpers,
// main characters and preset keybinds.
//
// Port of TypeR-Krita `typer_kr/langpair.py`. Host-free, unit-tested.

import {
  cps, cpLen, isAlpha, isAlnum, isAscii, isSpace, split as pySplit, strip,
  splitlines, sortedBy, cmp, pyInt,
} from "./py.js";

/** Rough per-line language detection: 'ja', 'en' or 'other'. Kana is a strong
 *  signal for Japanese, so an embedded English name does not flip it. */
export function detectLang(text) {
  let kana = 0;
  let kanji = 0;
  let en = 0;
  for (const ch of text) {
    const o = ch.codePointAt(0);
    if ((o >= 0x3040 && o <= 0x30ff) || (o >= 0xff66 && o <= 0xff9d)) {
      kana += 1;                                   // Hiragana + Katakana (+ half-width)
    } else if ((o >= 0x4e00 && o <= 0x9fff) || (o >= 0x3400 && o <= 0x4dbf)) {
      kanji += 1;                                  // Kanji
    } else if (isAscii(ch) && isAlpha(ch)) {
      en += 1;
    }
  }
  if (kana > 0) return "ja";
  if (kanji > 0 && (en === 0 || kanji >= en)) return "ja";
  if (en > 0) return "en";
  if (kanji > 0) return "ja";
  return "other";
}

// ---------------------------------------------------------------------------
// Page markers
//
// A line like "Page 1", "PAGE 01", "--- Page 3 ---", "[Page 5]" or "Seite 1".
// Real page numbers never decrease, so the numbers are validated and only an
// increasing sequence is kept (an out-of-order "Page 5" between 3 and 4 is
// ordinary dialogue).
// ---------------------------------------------------------------------------

const WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\x1c-\\x1f";
const PAGE_DECOR = `[${WS}\\-=*_~#.:|/\\\\\\u2013\\u2014\\[\\](){}<>]*`;
const PAGE_RE = new RegExp(
  "^" + PAGE_DECOR
  + "(?:page|seite)(?![a-z])"                    // keyword, but not "pages"/"seiten"
  + `[${WS}.:=#\\-\\u2013\\u2014]*`              // optional separators
  + `([0-9]+(?:[${WS}]*[\\-\\u2013][${WS}]*[0-9]+)?)?`  // optional number, 5 or 4-5
  + PAGE_DECOR + "$",
  "iu");

/** Page label ('3' or '4-5') of a marker line, '' for a bare "Page", else
 *  null. Whitespace inside a range is removed ('4 - 5' -> '4-5'). */
export function pageMarker(line) {
  const m = PAGE_RE.exec(line || "");
  if (!m) return null;
  const num = m[1];
  if (!num) return "";
  return num.replace(new RegExp(`[${WS}]+`, "gu"), "");
}

/** Leading integer of a page label ('4' or '4-5' -> 4); null without one. */
export function pageNumber(label) {
  if (!label) return null;
  const m = /^[0-9]+/.exec(label);
  return m ? Number(m[0]) : null;
}

function bisectLeft(a, x) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Indices of a longest strictly-increasing subsequence of `nums`, chosen so
 *  an out-of-order spike (5 between 3 and 4) is the value that gets dropped. */
export function longestIncreasing(nums) {
  const tails = [];
  const tailVals = [];
  const prev = new Array(nums.length).fill(-1);
  nums.forEach((v, i) => {
    const pos = bisectLeft(tailVals, v);           // strictly increasing
    prev[i] = pos > 0 ? tails[pos - 1] : -1;
    if (pos === tailVals.length) {
      tailVals.push(v);
      tails.push(i);
    } else {
      tailVals[pos] = v;
      tails[pos] = i;
    }
  });
  const keep = [];
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k !== -1) {
    keep.push(k);
    k = prev[k];
  }
  keep.reverse();
  return keep;
}

function acceptedMarkerLines(lines) {
  const candidates = [];
  lines.forEach((ln, i) => {
    const label = pageMarker(ln);
    if (label !== null) candidates.push([i, label]);
  });
  const numbered = candidates.filter(([, lab]) => pageNumber(lab) !== null);
  const nums = numbered.map(([, lab]) => pageNumber(lab));
  const keepNumbered = new Set(longestIncreasing(nums).map((j) => numbered[j][0]));
  const accepted = new Set();
  const labels = new Map();
  for (const [i, lab] of candidates) {
    if (pageNumber(lab) === null || keepNumbered.has(i)) {
      accepted.add(i);
      labels.set(i, lab);
    }
  }
  return [accepted, labels];
}

/** Split raw `lines` into page segments at every genuine "Page N" marker.
 *  Returns [[label, contentLines], ...]; the leading segment has label ''.
 *  Unnumbered markers are auto-numbered; an explicit number resets the
 *  counter. */
export function splitPageSegments(lines) {
  const [accepted, labels] = acceptedMarkerLines(lines);
  const segments = [];
  let curLabel = "";
  let curLines = [];
  let auto = 0;
  let started = false;
  lines.forEach((ln, i) => {
    if (!accepted.has(i)) {
      curLines.push(ln);
      return;
    }
    if (started || curLines.length) segments.push([curLabel, curLines]);
    started = true;
    let label = labels.get(i);
    if (label === "") {
      auto += 1;
      label = String(auto);
    } else {
      auto = pageNumber(label);
    }
    curLabel = label;
    curLines = [];
  });
  segments.push([curLabel, curLines]);
  return segments;
}

// ---------------------------------------------------------------------------
// Line cleaning: column headers ("JP"/"EN") and bubble-type prefixes.
// ---------------------------------------------------------------------------

const HEADER_TOKENS = new Set([
  "jp", "en", "jpn", "eng", "jap", "japanese", "english",
  "raw", "tl", "translation", "source", "target", "kr", "kor", "cn",
]);

const TYPE_PREFIX_RE = new RegExp(
  `^[${WS}]*`
  + "(?:\\{\\}|\\[\\]|\\(\\)|<>|\"\"|“”|「」|『』|//|"
  + "SFX|FX|ST|TN|SE)"
  + `[${WS}]*[:：][${WS}]*`,
  "iu");

/** True for a standalone column header such as 'JP' or 'EN:'. */
export function isHeaderLine(text) {
  const t = strip(strip(strip(text), ":：")).toLowerCase();
  return HEADER_TOKENS.has(t);
}

/** Remove a known leading bubble-type tag like '{}: ', 'SFX: ' or '“”: '. */
export function stripTypePrefix(text) {
  return text.replace(TYPE_PREFIX_RE, "");
}

/** Drop column-header lines and strip bubble-type prefixes. */
export function cleanLines(lines) {
  const out = [];
  for (const t of lines) {
    if (strip(t) === "" || isHeaderLine(t)) continue;
    const c = stripTypePrefix(t);
    if (strip(c) === "") continue;
    out.push(c);
  }
  return out;
}

// A leading speaker label such as "Sakamoto: Hi there". Conservative.
const SPEAKER_RE = new RegExp(
  `^[${WS}]*([A-Za-z][A-Za-z .'\\-]{0,23}?)[${WS}]*:[${WS}]*([^${WS}][^\n]*)$`, "u");

/** [speaker, dialogue] for 'Speaker: dialogue', else [null, text]. */
export function splitSpeaker(text) {
  text = text || "";
  if (stripTypePrefix(text) !== text) return [null, text];   // 'SFX:' is no speaker
  const m = SPEAKER_RE.exec(text.replace(/\n$/, ""));
  if (!m) return [null, text];
  const name = strip(m[1], " .");
  const rest = strip(m[2]);
  if (!name || !rest) return [null, text];
  if (cps(name).some((ch) => /\p{Nd}/u.test(ch)) || isHeaderLine(name)) return [null, text];
  const n = pySplit(name).length;
  if (!(n >= 1 && n <= 4)) return [null, text];
  return [name, rest];
}

export function speakerName(text) {
  return splitSpeaker(text)[0];
}

// --- Drive image comments as a script source (#21) -------------------------

const DRIVE_ID = "[A-Za-z0-9_-]{20,}";
const DRIVE_URL_PATTERNS = [
  new RegExp("/file/d/(" + DRIVE_ID + ")"),
  new RegExp("[?&]id=(" + DRIVE_ID + ")"),
  new RegExp("/d/(" + DRIVE_ID + ")"),
];
const DRIVE_ID_ONLY = new RegExp("^" + DRIVE_ID + "$");

/** The Drive file id from a share URL, or a bare id passed through; ''. */
export function driveFileId(urlOrId) {
  const s = strip(urlOrId || "");
  if (!s) return "";
  if (DRIVE_ID_ONLY.test(s)) return s;
  for (const pat of DRIVE_URL_PATTERNS) {
    const m = pat.exec(s);
    if (m) return m[1];
  }
  return "";
}

/** A Drive image's comments as a TypeR script: one "\t<text>" row each. */
export function imageCommentsToScript(comments) {
  const lines = [];
  for (const c of comments) {
    const text = pySplit((c && c.text) || "").join(" ");
    if (!text) continue;
    lines.push("\t" + text);          // leading TAB => one unit, empty source
  }
  return lines.join("\n");
}

/** [source, translation] of an explicit 'source<TAB>translation' row. */
export function splitColumns(line) {
  if (!(line || "").includes("\t")) return null;
  const parts = (line || "").split("\t");
  const left = strip(parts[0]);
  const right = parts.slice(1).filter((p) => strip(p)).map((p) => strip(p)).join(" ");
  return [left, right];
}

/** Group lines into [source, translation] pairs (explicit columns and
 *  language-based pairing, freely mixed). */
export function pairLines(lines) {
  const pairs = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      pairs.push(...pairByLanguage(buf));
      buf = [];
    }
  };
  for (const raw of lines) {
    const cols = splitColumns(raw);
    if (cols === null) {
      buf.push(raw);
      continue;
    }
    let [src, tgt] = cols;
    if (isHeaderLine(src) && isHeaderLine(tgt)) continue;   // 'JP | EN' header row
    src = strip(stripTypePrefix(src));
    tgt = strip(stripTypePrefix(tgt));
    if (!src && !tgt) continue;
    flush();
    pairs.push([src, tgt]);
  }
  flush();
  return pairs;
}

function pairByLanguage(lines) {
  const toks = cleanLines(lines).map((t) => [detectLang(t), t]);
  const n = toks.length;
  if (n === 0) return [];
  let jaFirst = 0;
  let enFirst = 0;
  for (let i = 0; i + 1 < n; i++) {
    const la = toks[i][0];
    const lb = toks[i + 1][0];
    if (la === "ja" && lb === "en") jaFirst += 1;
    else if (la === "en" && lb === "ja") enFirst += 1;
  }
  const anyJa = toks.some(([l]) => l === "ja");
  const anyEn = toks.some(([l]) => l === "en");
  let head;
  if (!anyJa) head = "en";
  else if (!anyEn) head = "ja";
  else head = jaFirst >= enFirst ? "ja" : "en";

  const pairs = [];
  let i = 0;
  while (i < n) {
    const [lang, text] = toks[i];
    if (lang === head) {
      const headText = text;
      i += 1;
      const body = [];
      while (i < n && toks[i][0] !== head) {
        body.push(toks[i][1]);
        i += 1;
      }
      const bodyText = body.join(" ");
      pairs.push(head === "ja" ? [headText, bodyText] : [bodyText, headText]);
    } else {
      pairs.push(lang === "ja" ? [text, ""] : ["", text]);
      i += 1;
    }
  }
  return pairs;
}

/** Like pairLines, but per page segment. Returns [pairs, pairPages, pages]
 *  where pages is [[label, firstUnitIndex], ...] of segments with units. */
export function pairLinesPaged(lines) {
  const segments = splitPageSegments(lines);
  const pairs = [];
  const pairPages = [];
  const pages = [];
  for (const [label, segLines] of segments) {
    const segPairs = pairLines(segLines);
    if (!segPairs.length) continue;
    pages.push([label, pairs.length]);
    for (const p of segPairs) {
      pairs.push(p);
      pairPages.push(label);
    }
  }
  return [pairs, pairPages, pages];
}

/** The text that gets inserted: the translation if present, else the source. */
export function unitText(pair) {
  const [ja, en] = pair;
  return strip(en) ? en : ja;
}

// ---------------------------------------------------------------------------
// Loose normalization + manga detection
// ---------------------------------------------------------------------------

export function normLoose(text) {
  const out = [];
  for (const ch of (text || "").toLowerCase()) {
    out.push(isAlnum(ch) || isSpace(ch) ? ch : " ");
  }
  return strip(out.join("").replace(new RegExp(`[${WS}]+`, "gu"), " "));
}

const MANGA_HEADER_RE = new RegExp(
  `^[${WS}]*(?:title|manga|series|serie|titel|t[ií]tulo|titre|s[eé]rie|`
  + `titolo|obra|werk)[${WS}]*[:：][${WS}]*([^\n]+)$`, "iu");

function mangaHeaderValues(lines) {
  const vals = [];
  for (const ln of lines) {
    const m = MANGA_HEADER_RE.exec(ln || "");
    if (m) vals.push(m[1]);
  }
  return vals;
}

/** The saved manga name that best matches the loaded script, or null.
 *  Priority: file name > explicit header lines > first ~10 content lines. */
export function detectManga(savedNames, scriptText, filename = "") {
  const names = (savedNames || []).filter((n) => n && cpLen(strip(n)) >= 3);
  if (!names.length) return null;
  const namesSorted = sortedBy(names, (s) => cpLen(s), true);
  const firstHit = (haystack) => {
    const h = normLoose(haystack);
    if (!h) return null;
    for (const name of namesSorted) {
      if (h.includes(normLoose(name))) return name;
    }
    return null;
  };
  let base = (filename || "").replace(/.*[\\/]/s, "");
  base = base.replace(/\.[A-Za-z0-9]+$/, "");
  let hit = firstHit(base);
  if (hit) return hit;
  const lines = splitlines(scriptText || "").filter((ln) => strip(ln));
  hit = firstHit(mangaHeaderValues(lines.slice(0, 20)).join("\n"));
  if (hit) return hit;
  return firstHit(lines.slice(0, 10).join("\n"));
}

// ---------------------------------------------------------------------------
// Default preset picking
// ---------------------------------------------------------------------------

const DEFAULT_PRESET_KEYWORDS = [
  "normal talking", "normal speech", "normal", "talking", "speech", "default",
];

// ---------------------------------------------------------------------------
// Script "tabs" / sessions
// ---------------------------------------------------------------------------

/** Normalized, comparable form of an absolute file path (for de-duplicating
 *  open scripts). Windows paths compare case-insensitively with backslashes,
 *  like os.path.normcase(os.path.abspath(p)); '' stays ''. */
export function normScriptPath(path) {
  if (!path) return "";
  const s = String(path);
  const win = /^[A-Za-z]:/.test(s) || s.includes("\\");
  const parts = s.replace(/\\/g, "/").split("/");
  const out = [];
  parts.forEach((p, i) => {
    if (p === "." || (p === "" && i > 0 && i < parts.length - 1)) return;
    if (p === "..") {
      if (out.length > 1 || (out.length === 1 && out[0] !== "")) out.pop();
      return;
    }
    out.push(p);
  });
  let res = out.join("/");
  if (win) res = res.replace(/\//g, "\\").toLowerCase();
  return res;
}

/** Index of the session whose 'path' matches `path` (normalized), or -1. */
export function findSessionByPath(sessions, path) {
  const key = normScriptPath(path);
  if (!key) return -1;
  const list = sessions || [];
  for (let i = 0; i < list.length; i++) {
    if (normScriptPath((list[i] || {}).path || "") === key) return i;
  }
  return -1;
}

export function basename(path) {
  const s = String(path || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** os.path.splitext -> [root, ext]: the extension needs a non-dot character
 *  before the last dot of the base name (".bashrc" has none). */
export function splitext(path) {
  const p = String(path || "");
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dot = p.lastIndexOf(".");
  if (dot > sep) {
    for (let i = sep + 1; i < dot; i++) {
      if (p[i] !== ".") return [p.slice(0, dot), p.slice(dot)];
    }
  }
  return [p, ""];
}

/** Tab label from a file path: file name without directory/extension. */
export function defaultTabLabel(path) {
  const name = splitext(basename(path || ""))[0];
  return name || "Untitled";
}

/** 'Untitled', 'Untitled 2', … not in `existing`. */
export function uniqueUntitled(existing, base = "Untitled") {
  const taken = new Set(existing || []);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function favSet(favorites) {
  // like Python's str(f): None becomes "None" (and so "none")
  if (!favorites) return new Set();
  const out = new Set();
  for (const f of favorites) {
    const s = strip(f === null || f === undefined ? "None" : String(f));
    if (s) out.add(s.toLowerCase());
  }
  return out;
}

/** Character names for a dropdown: [main, rest], both sorted
 *  case-insensitively. */
export function sortCharacters(names, favorites = null) {
  const favs = favSet(favorites);
  const main = [];
  const rest = [];
  for (const n of names || []) {
    const s = String(n);
    (favs.has(s.toLowerCase()) ? main : rest).push(s);
  }
  const key = (s) => s.toLowerCase();
  return [sortedBy(main, key), sortedBy(rest, key)];
}

/** Flatten {character: {preset: cfg}} into sorted [label, character, name]
 *  for the simple (no character level) preset mode. */
export function flattenPresets(chars, favorites = null) {
  if (!chars || typeof chars !== "object" || Array.isArray(chars)) return [];
  const favs = favSet(favorites);
  const entries = [];
  const counts = new Map();
  for (const [ch, presets] of Object.entries(chars)) {
    if (!presets || typeof presets !== "object" || Array.isArray(presets)) continue;
    for (const name of Object.keys(presets)) {
      const key = String(name).toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      entries.push([String(ch), String(name)]);
    }
  }
  const out = entries.map(([ch, name]) => {
    const label = counts.get(name.toLowerCase()) === 1 ? name : `${name} (${ch})`;
    return [label, ch, name];
  });
  return sortedBy(out, (e) => [favs.has(e[1].toLowerCase()) ? 0 : 1, e[0].toLowerCase(), e[1].toLowerCase()]);
}

/** The best 'default' preset name for a character, or null. */
export function defaultPresetFor(presetNames, usage = null) {
  const names = (presetNames || []).filter((n) => n && strip(String(n)).toLowerCase() !== "none");
  if (!names.length) return null;
  const norm = new Map(names.map((n) => [n, normLoose(n)]));
  for (const kw of DEFAULT_PRESET_KEYWORDS) {
    const hits = sortedBy(names.filter((n) => norm.get(n).includes(kw)), (s) => s.toLowerCase());
    if (hits.length) return hits[0];
  }
  if (usage) {
    const used = sortedBy(names.filter((n) => usage[n]), (n) => [-(usage[n] || 0), n.toLowerCase()]);
    if (used.length) return used[0];
  }
  return sortedBy(names, (s) => s.toLowerCase())[0];
}

// ---------------------------------------------------------------------------
// Preset keybinds: {manga: {key: [character, preset]}}; one key drives one
// preset, and one preset answers to one key.
// ---------------------------------------------------------------------------

const isDict = (d) => d && typeof d === "object" && !Array.isArray(d);

/** The stored keybind map with everything unreadable dropped. */
export function cleanKeybinds(data) {
  const out = {};
  if (!isDict(data)) return out;
  for (const [manga, binds] of Object.entries(data)) {
    if (!isDict(binds)) continue;
    const keep = {};
    for (const [key, ref] of Object.entries(binds)) {
      const k = strip(String(key));
      if (!k || !Array.isArray(ref) || ref.length !== 2) continue;
      const ch = strip(String(ref[0]));
      const name = strip(String(ref[1]));
      if (name) keep[k] = [ch, name];
    }
    if (Object.keys(keep).length) out[String(manga)] = keep;
  }
  return out;
}

/** Point `key` at [char, name] under `manga`; an empty key only unbinds.
 *  Mutates and returns `binds`. */
export function setKeybind(binds, manga, key, char, name) {
  if (!manga || !name) return binds;
  const m = String(manga);
  if (!isDict(binds[m])) binds[m] = {};
  const per = binds[m];
  char = String(char);
  name = String(name);
  for (const [k, ref] of Object.entries(per)) {        // this preset had another key
    if (String(ref[0]) === char && String(ref[1]) === name) delete per[k];
  }
  key = strip(String(key || ""));
  if (key) per[key] = [char, name];                    // and the key had another preset
  if (!Object.keys(per).length) delete binds[m];
  return binds;
}

/** Forget the bindings of a deleted manga / character / preset. */
export function dropKeybinds(binds, manga, char = null, name = null) {
  const m = String(manga);
  const per = binds[m];
  if (!per || !Object.keys(per).length) return binds;
  if (char === null || char === undefined) {
    delete binds[m];
    return binds;
  }
  for (const [k, ref] of Object.entries(per)) {
    if (String(ref[0]) === String(char) && (name === null || name === undefined || String(ref[1]) === String(name))) {
      delete per[k];
    }
  }
  if (!Object.keys(per).length) delete binds[m];
  return binds;
}

/** The key bound to this preset, or ''. */
export function keybindFor(binds, manga, char, name) {
  if (!name) return "";
  for (const [k, ref] of Object.entries(binds[String(manga)] || {})) {
    if (String(ref[0]) === String(char) && String(ref[1]) === String(name)) return k;
  }
  return "";
}

/** [character, preset] this key already drives, else ['', '']. */
export function keybindTarget(binds, manga, key) {
  const ref = (binds[String(manga)] || {})[strip(String(key || ""))];
  return ref ? [String(ref[0]), String(ref[1])] : ["", ""];
}

/** Every binding of one manga as sorted [key, character, preset]. */
export function keybindsOf(binds, manga) {
  const per = binds[String(manga)] || {};
  return sortedBy(Object.entries(per).map(([k, r]) => [k, String(r[0]), String(r[1])]), (e) => e[0].toLowerCase());
}

// ---------------------------------------------------------------------------
// BubblR/batch helpers
// ---------------------------------------------------------------------------

/** Absolute script-table row indices of the units on page `label`
 *  (null = no page filter -> every row). */
export function rowsForPage(pairPages, label) {
  if (label === null || label === undefined) return pairPages.map((_, i) => i);
  const out = [];
  pairPages.forEach((p, i) => {
    if (p === label) out.push(i);
  });
  return out;
}

const pyIntOf = (v) => pyInt(Number(v));
const bool = (v) => !!v && v !== "" && !(Array.isArray(v) && !v.length);

/** Map a style snapshot (settings keys + font, colours as hex) to
 *  insertTextLayer keyword values; missing keys fall back to UI defaults. */
export function styleInsertKwargs(style) {
  style = isDict(style) ? style : {};
  const get = (k, d) => (k in style ? style[k] : d);
  const auto = bool(get("auto", true));
  const size = pyIntOf(get("size", 60));
  return {
    font_family: get("font", "") || "",
    font_px: size,
    color: get("color", "#000000"),
    auto_fit: auto,
    max_px: size,
    padding_frac: pyIntOf(get("pad", 10)) / 100.0,
    line_spacing: pyIntOf(get("spacing", 100)) / 100.0,
    outline: bool(get("outline", false)),
    outline_color: get("outline_color", "#ffffff"),
    outline_px: Number(get("outline_w", 0)),
    bold: bool(get("bold", false)),
    italic: bool(get("italic", false)),
    underline: bool(get("underline", false)),
    align: get("align", null) || "center",
    case: get("case", null) || "none",
    tidy: bool(get("tidy", false)),
    shape: auto && get("round", null) ? "ellipse" : "rect",
    shadow: bool(get("shadow", false)),
    shadow_color: get("shadow_color", "#000000"),
    shadow_dx: Number(get("shadow_x", 0)),
    shadow_dy: Number(get("shadow_y", 0)),
    valign: get("valign", null) || "middle",
    hyphenate: bool(get("hyphenate", false)),
    hyph_lang: get("hyph_lang", "auto"),
  };
}

export { cmp };
