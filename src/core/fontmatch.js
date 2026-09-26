// Tolerant font-family matching (host-free core).
//
// Port of TypeR-Krita `typer_kr/fontmatch.py`. Resolves a wanted name against
// the installed families through a ladder of increasingly forgiving
// comparisons, stopping at the first tier that hits:
//
//     1  exact
//     2  case-insensitive
//     3  squashed          -- letters and digits only: CCWildWords == CC Wild Words
//     4  tokens            -- word set, trailing cut stripped
//     5  tokens, no tags   -- foundry/repack tags dropped too
//     6  fuzzy             -- character-level near miss, guarded
//
// Words that carry identity (pro, lower, lc, condensed) are never dropped, so
// "BadaBoom Pro BB" stays different from "BadaBoom BB".

import { ratio } from "./difflib.js";
import { strip, sortedBy, cpLen } from "./py.js";

const ITALIC = new Set(["italic", "ital", "oblique", "kursiv"]);
const BOLD = new Set(["bold", "bld", "semibold", "demibold", "extrabold", "ultrabold", "heavy", "black"]);
const STYLE = new Set([...ITALIC, ...BOLD,
  "regular", "reg", "normal", "roman", "book", "medium", "med", "light",
  "extralight", "ultralight", "thin"]);

// Foundry initials and repack leftovers (a LAST-RESORT tier).
const TAGS = new Set(["bb", "cc", "cdx", "ss", "lhf", "djb", "itc", "ff", "bt", "mt",
  "rg", "tb", "std", "com", "web", "webfont"]);

// Web-shop debris: Fonts.com "W00"/"W1G" licence tags, repack branding.
const DEBRIS = /W\d[\dA-Za-z](?![a-z])/g;
const DEBRIS_WORDS = /iCiel|PERSONAL[ _-]?USE|DEMO|TRIAL/gi;

// Split on spaces/punctuation AND camelCase humps, keeping "2.0" together.
const TOKEN = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+(?:[.,]\d+)*/g;

export const BUILTIN_ALIASES = {
  "cc wild words lower": "CCWildWordsLower",
  "wild words": "CC Wild Words",
  badaboom: "BadaBoom BB",
};

/** A resolved family plus the cut that was asked for in the name. */
export class Match {
  constructor(family, bold = false, italic = false, tier = "exact", score = 1.0) {
    this.family = family;
    this.bold = bold;
    this.italic = italic;
    this.tier = tier;
    this.score = score;
  }

  get exact() {
    return this.tier === "exact" || this.tier === "case";
  }
}

function clean(name) {
  const s = (name || "").replace(DEBRIS_WORDS, " ");
  return s.replace(DEBRIS, " ");
}

/** Lower-case word list of `name`, camelCase humps split apart. */
export function tokens(name) {
  return (clean(name).match(TOKEN) || []).map((t) => t.toLowerCase());
}

/** Letters and digits only, lower-cased. */
export function squash(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Peel trailing cut words off a token list: [remaining, bold, italic]. */
export function splitCut(toks) {
  const out = [...toks];
  let bold = false;
  let italic = false;
  while (out.length > 1 && STYLE.has(out[out.length - 1])) {
    const t = out.pop();
    if (ITALIC.has(t)) italic = true;
    else if (BOLD.has(t)) bold = true;
  }
  return [out, bold, italic];
}

function key(toks, dropTags) {
  let t = toks;
  if (dropTags) t = t.filter((x) => !TAGS.has(x));
  return [...t].sort().join("");
}

function significant(toks) {
  return new Set(toks.filter((t) => !STYLE.has(t) && !TAGS.has(t)));
}

function push(map, k, v) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

/** Lookup table over the installed families. */
export class FontIndex {
  constructor(families, aliases = null) {
    this.families = (families || []).filter((f) => f && strip(f));
    this.aliases = { ...BUILTIN_ALIASES };
    if (aliases) {
      for (const [k, v] of Object.entries(aliases)) this.aliases[strip(k || "").toLowerCase()] = v;
    }
    this._exact = new Set(this.families);
    this._ci = new Map();
    this._squash = new Map();
    this._tok = new Map();
    this._tokNotags = new Map();
    this._sig = new Map();
    for (const fam of this.families) {
      push(this._ci, fam.toLowerCase(), fam);
      push(this._squash, squash(fam), fam);
      const [base] = splitCut(tokens(fam));
      push(this._tok, key(base, false), fam);
      push(this._tokNotags, key(base, true), fam);
      this._sig.set(fam, significant(base));
    }
  }

  /** Deterministic winner: closest spelling, then shorter, then alphabetical. */
  _pick(cands, wanted) {
    if (cands.length === 1) return cands[0];
    const w = squash(wanted);
    return sortedBy(cands, (f) => [-ratio(w, squash(f)), cpLen(f), f])[0];
  }

  _fuzzy(wanted, base, threshold) {
    const w = squash(wanted);
    if (w.length < 4) return null;
    const wantSig = significant(base);
    let best = null;
    let bestScore = 0.0;
    for (const fam of this.families) {
      if (this._sig.get(fam).size !== wantSig.size) continue;
      const score = ratio(w, squash(fam));
      if (score > bestScore) {
        best = fam;
        bestScore = score;
      }
    }
    if (best !== null && bestScore >= threshold) return [best, bestScore];
    return null;
  }

  /** Best installed family for `name`, or null. */
  resolve(name, fuzzy = true, threshold = 0.90) {
    if (!name || !strip(name)) return null;
    name = strip(name);
    if (this._exact.has(name)) return new Match(name, false, false, "exact");
    let hit = this._ci.get(name.toLowerCase());
    if (hit) return new Match(this._pick(hit, name), false, false, "case");
    const alias = this.aliases[name.toLowerCase()];
    if (alias) {
      const sub = this.resolve(alias, false);
      if (sub) {
        sub.tier = "alias";
        return sub;
      }
    }
    hit = this._squash.get(squash(name));
    if (hit) return new Match(this._pick(hit, name), false, false, "squash");
    const toks = tokens(name);
    const [base, bold, italic] = splitCut(toks);
    if (!base.length) return null;
    hit = this._tok.get(key(base, false));
    if (hit) return new Match(this._pick(hit, name), bold, italic, "tokens");
    hit = this._tokNotags.get(key(base, true));
    if (hit) return new Match(this._pick(hit, name), bold, italic, "tokens-notags");
    if (fuzzy) {
      const got = this._fuzzy(name, base, threshold);
      if (got) return new Match(got[0], bold, italic, "fuzzy", got[1]);
    }
    return null;
  }

  familyOf(name, fallback = null, fuzzy = true) {
    const m = this.resolve(name, fuzzy);
    return m ? m.family : fallback;
  }

  isAvailable(name, fuzzy = true) {
    return this.resolve(name, fuzzy) !== null;
  }

  missing(names, fuzzy = true) {
    return (names || []).filter((n) => !this.isAvailable(n, fuzzy));
  }

  /** [resolved, renamed, missing] for a batch of wanted names. */
  report(names, fuzzy = true) {
    const resolved = [];
    const renamed = [];
    const missing = [];
    for (const n of names || []) {
      const m = this.resolve(n, fuzzy);
      if (m === null) missing.push(n);
      else if (m.exact) resolved.push(n);
      else renamed.push([n, m]);
    }
    return [resolved, renamed, missing];
  }
}
