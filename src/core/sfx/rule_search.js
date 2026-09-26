// Matching helpers for SFX rules: normalizing stretched SFX spellings for the
// font suggestions, and the rule-list search box (`font:`/`group:`/`kw:`).
//
// Port of TypeR-Krita `typer_kr/sfx/rule_search.py`.

import { split as pySplit, cpLen } from "../py.js";

const FIELD_PREFIXES = {
  font: ["fonts"], f: ["fonts"],
  group: ["group"], g: ["group"],
  kw: ["keywords"],
};
const ALL_FIELDS = ["keywords", "fonts", "group"];

/** Lowercase, collapse every run of equal characters to ONE ("booooom" ->
 *  "bom"), drop everything but a-z/0-9 ("ka-boom!" -> "kabom"). A word of one
 *  repeated character keeps two ("zzz" -> "zz"). */
export function normalizeSfx(text) {
  const raw = (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  let s = raw.replace(/(.)\1+/g, "$1");
  if (cpLen(s) === 1 && cpLen(raw) >= 2) s = s + s;
  return s;
}

/** Squeezed keyword vs squeezed text: 1 char -> ignore, 2 chars -> exact,
 *  3+ -> substring. */
export function keywordMatches(keyword, textNorm) {
  const kw = normalizeSfx(keyword);
  if (kw.length < 2) return false;
  if (kw.length === 2) return textNorm === kw;
  return textNorm.includes(kw);
}

function splitToken(token) {
  const i = token.indexOf(":");
  if (i >= 0) {
    const head = token.slice(0, i);
    const rest = token.slice(i + 1);
    if (rest) {
      const fields = FIELD_PREFIXES[head];
      if (fields) return [rest, fields];
    }
  }
  return [token, ALL_FIELDS];
}

// str.casefold() is lower() plus a few full foldings (ß -> ss, …)
function casefold(s) {
  return (s || "").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ");
}

function tokenMatches(rule, token, fields) {
  const needle = casefold(token);
  if (fields.includes("keywords")) {
    const norm = normalizeSfx(token);
    for (const kw of rule.keywords || []) {
      if (casefold(kw || "").includes(needle)) return true;
      // same fuzzy matching as the suggestions: "BOOOOM!" finds "boom"
      if (norm && keywordMatches(kw, norm)) return true;
    }
  }
  if (fields.includes("fonts")) {
    for (const fo of rule.fonts || []) if (casefold(fo || "").includes(needle)) return true;
  }
  if (fields.includes("group")) {
    if (casefold(rule.group || "").includes(needle)) return true;
  }
  return false;
}

/** True if `rule` stays visible for the search text `query` (AND over words;
 *  `font:`/`f:`, `group:`/`g:`, `kw:` limit a word to one field). */
export function ruleMatchesQuery(rule, query) {
  const tokens = pySplit(query || "");
  if (!tokens.length) return true;
  for (const token of tokens) {
    const [text, fields] = splitToken(token);
    if (!text) continue;
    if (!tokenMatches(rule, text, fields)) return false;
  }
  return true;
}
