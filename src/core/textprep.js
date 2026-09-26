// Text preparation before setting: smart punctuation, comic-lettering
// grammar, crossbar I, **bold** markup, letter case — plus the presets →
// fonts-matrix table used by the .xlsx export.
//
// Port of the host-free text helpers in TypeR-Krita `typer_kr/typer_kr.py`
// (tidy_text, comic_letter, _fix_crossbar_i, parse_bold, toggle_bold,
// prepare_text, presets_to_table).

import { cps, isAlpha, sortedBy } from "./py.js";

const WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\x1c-\\x1f";

export const LINKIFY = /https?:\/\/[^\s<>"']+/g;

/** Typographic clean-up: straight quotes -> curly, ... -> …, -- -> —,
 *  multiple spaces -> one. `comic` keeps the double dash. */
export function tidyText(s, comic = false) {
  s = s.split("...").join("…");
  if (!comic) s = s.replace(/(?<!-)--(?!-)/g, "—");
  // opening double quote after line start / whitespace / bracket
  s = s.replace(new RegExp(`(^|[${WS}(\\[{<\\u2014])"`, "gu"), "$1“");
  s = s.split('"').join("”");
  s = s.replace(new RegExp(`(^|[${WS}(\\[{<\\u2014])'`, "gu"), "$1‘");
  s = s.split("'").join("’");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s;
}

// (?:\b[A-Za-z]\.){2,} with Python's Unicode word boundary
const ACRONYM = /(?:(?<![\p{L}\p{N}_])[A-Za-z]\.){2,}/gu;

/** Give the crossbar "I" only to the pronoun and to acronyms: comic fonts put
 *  the barred I on uppercase `I` and the plain stroke on lowercase `i`, so
 *  lowering every other capital I selects the right glyph. */
export function fixCrossbarI(s) {
  // spans in code points
  const spans = [];
  for (const m of s.matchAll(ACRONYM)) {
    const a = cps(s.slice(0, m.index)).length;
    spans.push([a, a + cps(m[0]).length]);
  }
  const inAcronym = (idx) => spans.some(([a, b]) => a <= idx && idx < b);
  const chars = cps(s);
  const n = chars.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    if (ch !== "I" || inAcronym(i)) {
      out.push(ch);
      continue;
    }
    const prev = i ? chars[i - 1] : "";
    const nxt = i + 1 < n ? chars[i + 1] : "";
    const startsWord = !(isAlpha(prev) || prev === "'" || prev === "’");
    // the pronoun: a standalone I, or I'm / I'll / I've / I'd
    if (startsWord && (nxt === "'" || nxt === "’" || !isAlpha(nxt))) out.push("I");
    else out.push("i");
  }
  return out.join("");
}

/** Comic-lettering grammar (Blambot): exactly three hugging dots, a double
 *  dash for interrupted speech, ?! instead of !?, one space. Runs AFTER the
 *  letter-case transform (the crossbar rule depends on the final case). */
export function comicLetter(s, crossbarI = false) {
  s = s.replace(/\.{2,}/g, "…");
  s = s.replace(/[ \t]*…[ \t]*/g, "…");
  s = s.replace(/[—–]/g, "--");
  s = s.replace(/-{3,}/g, "--");
  s = s.replace(/[ \t]*--[ \t]*/g, "--");
  s = s.split("!?").join("?!");
  s = s.replace(/[ \t]{2,}/g, " ");
  if (crossbarI) s = fixCrossbarI(s);
  return s;
}

/** `**bold**` marks bold sections. Returns [cleanText, mask] with one bool per
 *  code point. A single `*` is kept as-is. */
export function parseBold(text) {
  const clean = [];
  const mask = [];
  let bold = false;
  const t = cps(text);
  let i = 0;
  const n = t.length;
  while (i < n) {
    if (t[i] === "*" && i + 1 < n && t[i + 1] === "*") {
      bold = !bold;
      i += 2;
      continue;
    }
    clean.push(t[i]);
    mask.push(bold);
    i += 1;
  }
  return [clean.join(""), mask];
}

/** Add or remove `**` around the selection [start, end) (UTF-16 offsets, as a
 *  textarea reports them). Returns [newText, newStart, newEnd]. */
export function toggleBold(text, start, end) {
  if (start > end) [start, end] = [end, start];
  if (start === end) return [text, start, end];
  const sel = text.slice(start, end);
  // markers directly outside the selection -> remove them (clear bold)
  if (start >= 2 && text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**") {
    return [text.slice(0, start - 2) + sel + text.slice(end + 2), start - 2, end - 2];
  }
  // the selection itself is wrapped -> strip the markers
  if (sel.startsWith("**") && sel.endsWith("**") && sel.length >= 4) {
    const inner = sel.slice(2, -2);
    return [text.slice(0, start) + inner + text.slice(end), start, start + inner.length];
  }
  // otherwise: wrap it
  return [text.slice(0, start) + "**" + sel + "**" + text.slice(end), start + 2, end + 2];
}

/** Clean up, then letter case, then comic lettering. case: 'none' | 'upper' |
 *  'lower' (true behaves like 'upper', false like 'none'). */
export function prepareText(line, casing, tidy, comic = false, crossbarI = false) {
  let out = line;
  if (tidy) out = tidyText(out, comic);
  if (casing === true || casing === "upper") out = out.toUpperCase();
  else if (casing === "lower") out = out.toLowerCase();
  if (comic) out = comicLetter(out, crossbarI);
  return out;
}

/** Fonts matrix for ONE manga: first column the character, then one column
 *  per purpose (preset name, most-used first), cells = the font. Returns
 *  [headers, rows]. */
export function presetsToTable(chars, headerOf, defaultChar = "(default)") {
  const counts = new Map();
  for (const presets of Object.values(chars || {})) {
    for (const name of Object.keys(presets || {})) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const purposes = sortedBy([...counts.keys()], (n) => [-counts.get(n), String(n).toLowerCase()]);
  const headers = [headerOf("col_character"), ...purposes];
  const rows = [];
  for (const ch of sortedBy(Object.keys(chars || {}), (s) => String(s).toLowerCase())) {
    const presets = chars[ch] || {};
    const row = [String(ch).trim() ? ch : defaultChar];
    for (const p of purposes) {
      const cfg = presets[p];
      if (cfg === undefined || cfg === null) {
        row.push("");
      } else {
        const font = cfg && typeof cfg === "object" ? cfg.font || "" : cfg;
        row.push(font || "");
      }
    }
    rows.push(row);
  }
  return [headers, rows];
}
