// Pure layout logic: line wrapping, even balancing, ellipse fitting (round
// speech bubbles) and auto-sizing.
//
// Port of TypeR-Krita `typer_kr/layout.py`, function by function. Deliberately
// free of any Photoshop dependency so it can be unit-tested in isolation.
// Text widths come from a `measurer(px)` function that returns:
//     [widthOf, spaceW, lineH, ascent, descent]
//
// Strings are handled by CODE POINT, like Python (see core/py.js), so bold
// masks and break indices line up with the Krita version exactly.

import {
  cps, cpLen, isAlpha, isAlnum, isUpper, split as pySplit, strip, rstrip,
  pySum, pyRound, pyInt, floorDiv, splitlines, WORD_CLASS,
} from "./py.js";

// ---------------------------------------------------------------------------
// Bold runs: internally text is represented as a sequence of [subtext, bold]
// runs so that individual words (or parts of them) can be bold. A "word"
// carries its full string (for width measurement) and its runs (for drawing).
// ---------------------------------------------------------------------------

export class Word {
  constructor(text, bold, runs) {
    this.text = text;     // full word string
    this.bold = bold;     // true if any character is bold
    this.runs = runs;     // list [[subtext, bold], ...]
  }

  toString() {
    return this.text;
  }
}

/** (text, mask) -> [[subtext, bold], ...] with equal-bold sections merged.
 *  mask: list of bool with the same length as text (in code points). */
export function makeRuns(text, mask) {
  const runs = [];
  const chars = Array.isArray(text) ? text : cps(text);
  const n = Math.min(chars.length, mask.length);
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const b = !!mask[i];
    if (runs.length && runs[runs.length - 1][1] === b) {
      runs[runs.length - 1] = [runs[runs.length - 1][0] + ch, b];
    } else {
      runs.push([ch, b]);
    }
  }
  return runs;
}

/** Split text into words at spaces; keep each word's bold runs. Multiple
 *  spaces are collapsed, like str.split(). */
export function makeWords(text, mask) {
  const words = [];
  let cur = [];
  let curm = [];
  const chars = cps(text);
  const n = Math.min(chars.length, mask.length);
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const b = mask[i];
    if (ch === " ") {
      if (cur.length) {
        words.push(new Word(cur.join(""), curm.some(Boolean), makeRuns(cur, curm)));
        cur = [];
        curm = [];
      }
    } else {
      cur.push(ch);
      curm.push(!!b);
    }
  }
  if (cur.length) {
    words.push(new Word(cur.join(""), curm.some(Boolean), makeRuns(cur, curm)));
  }
  return words;
}

/** Split (text, mask) at \n into [paragraph_text, paragraph_mask] pairs. */
export function splitParagraphs(text, mask) {
  const out = [];
  const chars = cps(text);
  let s = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\n") {
      out.push([chars.slice(s, i).join(""), mask.slice(s, i)]);
      s = i + 1;
    }
  }
  out.push([chars.slice(s).join(""), mask.slice(s)]);
  return out;
}

/** Join the words of a (wrapped) line into a single run list; words are
 *  separated by a space (the space inherits the bold property of the previous
 *  run end), and equal-bold runs are merged. */
export function lineRuns(words) {
  const runs = [];
  const push = (txt, b) => {
    if (runs.length && runs[runs.length - 1][1] === b) {
      runs[runs.length - 1] = [runs[runs.length - 1][0] + txt, b];
    } else {
      runs.push([txt, b]);
    }
  };
  words.forEach((wd, wi) => {
    if (wi > 0) push(" ", runs.length ? runs[runs.length - 1][1] : false);
    for (const [txt, b] of wd.runs) push(txt, b);
  });
  return runs;
}

/** Plain text of a run list. */
export function runsText(runs) {
  return runs.map((r) => r[0]).join("");
}

/** Split a flat word list into lines. `breakAfter` is a Set of 0-based word
 *  indices; a line ends after each such word. Used by TextShapR's manual
 *  break editor to regroup a chosen candidate. */
export function groupWords(words, breakAfter) {
  const lines = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    if (breakAfter.has(i)) {
      lines.push(cur);
      cur = [];
    }
  });
  if (cur.length) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Hyphenation (Liang's algorithm with bundled, freely-licensed TeX patterns)
//
// The pattern files live in the "hyph" folder and come from the free
// hyph-utf8 / tex-hyphen project (see hyph/LICENSE.txt). `hyphenate()` returns
// the linguistically valid break positions of a word; `splitWord()` splits a
// Word object there while keeping its bold runs intact.
// ---------------------------------------------------------------------------

// lang -> [pattern file, exception file or null]. All files are bundled and
// freely licensed (see hyph/LICENSE.txt).
export const HYPH_FILES = {
  en: ["hyph-en-us.pat.txt", "hyph-en-us.hyp.txt"],
  de: ["hyph-de-1996.pat.txt", null],
  es: ["hyph-es.pat.txt", null],
  fr: ["hyph-fr.pat.txt", null],
  pt: ["hyph-pt.pat.txt", "hyph-pt.hyp.txt"],
  it: ["hyph-it.pat.txt", null],
};
// language codes whose patterns ship with the plugin (UI offers only these)
export const HYPH_LANGS = ["en", "de", "es", "fr", "pt", "it"];
// per-language minimum letters before/after a break (from each file's header)
const HYPH_MINS = {
  en: [2, 3], de: [2, 2], es: [2, 2],
  fr: [2, 2], pt: [2, 3], it: [2, 2],
};
const hyphenators = new Map();       // lang -> Hyphenator (or false = failed)
const WORD_RE = new RegExp(
  `^[${WORD_CLASS}]+(?:['’-][${WORD_CLASS}]+)*$`, "u");

// How pattern files are read. The host installs a loader (UXP: the plugin
// folder, Node tests: the repo's hyph/ folder); it returns the file's text or
// null when it does not exist.
let hyphLoader = null;

export function setHyphLoader(fn) {
  hyphLoader = fn;
  hyphenators.clear();
}

/** Map a code/locale (e.g. 'de_DE', 'pt-BR') to a bundled language key. */
export function normLang(lang) {
  const code = String(lang || "").toLowerCase().replace(/-/g, "_").split("_")[0];
  return Object.prototype.hasOwnProperty.call(HYPH_FILES, code) ? code : "en";
}

const PTS = Symbol("points");

/** Liang's hyphenation algorithm over a tree of competing patterns. */
export class Hyphenator {
  constructor(patternLines, exceptionLines = []) {
    this.tree = new Map();
    for (let pat of patternLines) {
      pat = strip(pat);
      if (pat && !pat.startsWith("%")) this._insert(pat);
    }
    this.exceptions = new Map();
    for (let ex of exceptionLines) {
      ex = strip(ex).toLowerCase();
      if (!ex || ex.startsWith("%")) continue;
      const key = ex.replace(/-/g, "");
      const pts = [0];
      for (const piece of ex.split("-")) {
        const n = cpLen(piece);
        for (let i = 0; i < n - 1; i++) pts.push(0);
        pts.push(1);
      }
      if (pts.length) pts[pts.length - 1] = 0;   // never break after the last piece
      this.exceptions.set(key, pts);
    }
  }

  _insert(pattern) {
    // "a1bc3d" -> chars "abcd", points [0,1,0,3,0]
    const chars = cps(pattern.replace(/[0-9]/g, ""));
    const points = new Array(chars.length + 1).fill(0);
    let ci = 0;
    for (const ch of pattern) {
      if (ch >= "0" && ch <= "9") points[ci] = Number(ch);
      else ci += 1;
    }
    let node = this.tree;
    for (const c of chars) {
      let next = node.get(c);
      if (!next) {
        next = new Map();
        node.set(c, next);
      }
      node = next;
    }
    node.set(PTS, points);
  }

  /** Split `word` into its syllable pieces (lowercased internally). */
  split(word) {
    const w = word.toLowerCase();
    const wc = cps(w);
    let points;
    let offset;
    if (this.exceptions.has(w)) {
      points = this.exceptions.get(w);
      offset = 1;
    } else {
      const work = [".", ...wc, "."];
      points = new Array(work.length + 1).fill(0);
      for (let i = 0; i < work.length; i++) {
        let node = this.tree;
        for (let j = i; j < work.length; j++) {
          node = node.get(work[j]);
          if (node === undefined) break;
          const pts = node.get(PTS);
          if (pts && pts.length) {
            for (let off = 0; off < pts.length; off++) {
              if (pts[off] > points[i + off]) points[i + off] = pts[off];
            }
          }
        }
      }
      points[0] = 0;
      points[1] = 0;
      points[points.length - 1] = 0;
      points[points.length - 2] = 0;
      offset = 2;
    }
    const pieces = [""];
    wc.forEach((c, k) => {
      pieces[pieces.length - 1] += c;
      if ((points[k + offset] || 0) % 2) pieces.push("");
    });
    return pieces.filter((p) => p);
  }
}

function getHyphenator(lang) {
  lang = normLang(lang);
  if (hyphenators.has(lang)) return hyphenators.get(lang) || null;
  const [patName, hypName] = HYPH_FILES[lang];
  let h;
  try {
    const pat = hyphLoader ? hyphLoader(patName) : null;
    if (pat === null || pat === undefined) throw new Error("no patterns");
    let hyp = [];
    if (hypName) {
      const txt = hyphLoader(hypName);
      if (txt !== null && txt !== undefined) hyp = splitlines(txt);
    }
    h = new Hyphenator(splitlines(pat), hyp);
  } catch (e) {
    h = false;
  }
  hyphenators.set(lang, h);
  return h || null;
}

/** Span [start, end) of the actual word inside `word`, ignoring attached
 *  punctuation: quotes, brackets, "!", "?", ",", "…" and the like. Without
 *  this, everyday words would never hyphenate — "EMBARRASSING!" is not a
 *  plain word, but "EMBARRASSING" is. Indices are code points. */
export function coreSpan(word) {
  const c = cps(word);
  let i = 0;
  let j = c.length;
  while (i < j && !isAlpha(c[i])) i++;
  while (j > i && !isAlpha(c[j - 1])) j--;
  return [i, j];
}

// Characters that already ARE a break opportunity inside a word: a hyphen a
// writer put there ("Yagi-kun", "well-known") and the en-dash some scripts use
// for the same job. Breaking right after one needs no new hyphen at all.
export const INWORD_BREAK = "-‐‑–";

/**
 * Return the sorted character indices inside `word` where it may be broken
 * across lines, honoring a minimum of `left` letters before and `right` after.
 * When left/right are null the language's own minima are used. Attached
 * punctuation is ignored (and stays with its part when the word is split).
 *
 * A word that already carries a hyphen breaks AT that hyphen: "Yagi-kun" gives
 * "Yagi-" / "kun", never "Yagi--" / "kun" and never "Yag-" / "i-kun". So the
 * compound is split on its own hyphens first, each part is hyphenated
 * separately, and the position after each existing hyphen is offered as a
 * break in its own right (`splitWord` then adds no second hyphen).
 *
 * Empty list if the word is too short, not a plain word, or patterns are
 * unavailable.
 */
export function hyphenate(word, lang = "en", left = null, right = null) {
  const [dl, dr] = HYPH_MINS[normLang(lang)] || [2, 3];
  if (left === null || left === undefined) left = dl;
  if (right === null || right === undefined) right = dr;
  if (!word) return [];
  const [start, end] = coreSpan(word);
  const coreArr = cps(word).slice(start, end);
  const core = coreArr.join("");
  if (coreArr.length < left + right) return [];
  if (!WORD_RE.test(core)) return [];

  const ok = (pos) => left <= pos && pos <= coreArr.length - right;

  // the segments between the word's own hyphens, with their offsets in `core`
  const segments = [];
  let segStart = 0;
  const breaks = [];
  coreArr.forEach((ch, i) => {
    if (INWORD_BREAK.includes(ch)) {
      segments.push([segStart, coreArr.slice(segStart, i).join("")]);
      if (ok(i + 1)) breaks.push(start + i + 1);   // break AFTER the existing hyphen
      segStart = i + 1;
    }
  });
  segments.push([segStart, coreArr.slice(segStart).join("")]);

  const h = getHyphenator(lang);
  if (h !== null) {
    for (const [off, seg] of segments) {
      // a part still needs enough letters of its own to be worth splitting
      if (cpLen(seg) < left + right || !seg) continue;
      const pieces = h.split(seg);
      if (pieces.length < 2) continue;
      let pos = 0;
      for (const p of pieces.slice(0, -1)) {
        pos += cpLen(p);
        if (ok(off + pos)) breaks.push(start + off + pos);
      }
    }
  }
  return [...new Set(breaks)].sort((a, b) => a - b);
}

/** Split a Word at character index i; append a hyphen to the first part —
 *  unless it already ends with one, because the break landed on a hyphen the
 *  word already had ("Yagi-kun" -> "Yagi-" / "kun", not "Yagi--" / "kun").
 *  Returns [left, right] as Word objects, preserving the bold runs. */
export function splitWord(word, i) {
  let leftRuns = [];
  const rightRuns = [];
  let pos = 0;
  for (const [t, b] of word.runs) {
    const tc = cps(t);
    const end = pos + tc.length;
    if (end <= i) {
      leftRuns.push([t, b]);
    } else if (pos >= i) {
      rightRuns.push([t, b]);
    } else {
      const cut = i - pos;
      leftRuns.push([tc.slice(0, cut).join(""), b]);
      rightRuns.push([tc.slice(cut).join(""), b]);
    }
    pos = end;
  }
  if (leftRuns.length) {
    const [lt, lb] = leftRuns[leftRuns.length - 1];
    const last = cps(lt).pop();
    if (!(last !== undefined && INWORD_BREAK.includes(last))) {
      leftRuns[leftRuns.length - 1] = [lt + "-", lb];   // hyphen inherits previous bold
    }
  } else {
    leftRuns = [["-", false]];
  }
  const leftText = leftRuns.map((r) => r[0]).join("");
  const rightText = rightRuns.map((r) => r[0]).join("");
  const left = new Word(leftText, leftRuns.some((r) => r[1]), leftRuns);
  const right = new Word(rightText, rightRuns.some((r) => r[1]), rightRuns);
  return [left, right];
}

// A hyphen followed by whitespace and a letter: a word broken across a line in
// the SOURCE text (OCR, a previous typeset). The letters are left untouched; the
// match spans only the hyphen and the run of spaces, so the mask stays easy to
// realign.
const PY_S = "[\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a" +
  "\\u2028\\u2029\\u202f\\u205f\\u3000]";
const DEHYPH_RE = new RegExp(
  `(?<=[${WORD_CLASS}])-(${PY_S}+)(?=([${WORD_CLASS}]))`, "gu");

// Continuations that make the hyphen part of the NAME, not a line break.
// Japanese honorifics are lowercase, so the capitalisation rule below cannot
// see them and "Yagi- kun" would be rejoined as "Yagikun" — which is the same
// blindness to an existing hyphen that made the shaper write "Yagi--". These
// are the suffixes a manga script actually uses.
export const KEEP_HYPHEN_SUFFIX = new Set([
  "kun", "chan", "san", "sama", "senpai", "sempai", "sensei", "dono",
  "tan", "chin", "nee", "nii", "neesan", "niisan", "oneesan", "oniisan",
]);
const SUFFIX_RE = new RegExp(`^[${WORD_CLASS}]+`, "u");

/**
 * Undo source line-break hyphenation so the shaper can re-wrap freely: join
 * a word that was split across a line ("embar- rassing" -> "embarrassing").
 *
 * A capitalised continuation is kept as a hyphenated compound instead
 * ("Spider- Man" -> "Spider-Man"), on the assumption it is a real hyphenated
 * name rather than a broken word — as is a Japanese honorific, which is
 * lowercase and would otherwise be swallowed ("Yagi- kun" stays "Yagi-kun",
 * not "Yagikun"). Only a hyphen *followed by whitespace* is touched, so an
 * ordinary in-word hyphen ("X-ray") is left alone.
 *
 * Returns [newText, newMask] with the bold `mask` realigned to the shortened
 * text. This is the inverse of the `hyphenate`/`splitWord` pair above.
 */
export function dehyphenate(text, mask = null) {
  text = text || "";
  const chars = cps(text);
  let m = mask !== null && mask !== undefined ? Array.from(mask) : new Array(chars.length).fill(false);
  if (m.length < chars.length) m = m.concat(new Array(chars.length - m.length).fill(false));
  const outT = [];
  const outM = [];
  let last = 0;
  // regex positions are UTF-16 units; the mask is per code point
  const toCp = (unit) => cpLen(text.slice(0, unit));
  for (const mo of text.matchAll(DEHYPH_RE)) {
    const s = toCp(mo.index);
    const e = toCp(mo.index + mo[0].length);
    outT.push(chars.slice(last, s).join(""));
    outM.push(...m.slice(last, s));
    const tail = SUFFIX_RE.exec(chars.slice(e).join(""));
    const keep = isUpper(mo[2])                 // capitalised -> a real compound
      || (tail && KEEP_HYPHEN_SUFFIX.has(tail[0].toLowerCase()));
    if (keep) {
      outT.push("-");
      outM.push(m[s]);                          // the hyphen keeps its own bold bit
    }
    // lowercase continuation -> drop the hyphen and the spaces entirely
    last = e;
  }
  outT.push(chars.slice(last).join(""));
  outM.push(...m.slice(last));
  const newText = outT.join("");
  return [newText, outM.slice(0, cpLen(newText))];
}

/** Hyphenate `word` so its first part (incl. hyphen) is <= avail.
 *  Picks the latest valid break that still fits. Returns [left, right] or
 *  null. `hyph(word)` -> list of break indices. */
export function splitToFit(word, avail, widthOf, hyph) {
  const breaks = hyph(word);
  if (!breaks || !breaks.length) return null;
  let best = null;
  for (const b of breaks) {                   // ascending -> latest that fits
    const [left, right] = splitWord(word, b);
    if (widthOf(left) <= avail) best = [left, right];
    else break;
  }
  return best;
}

/** Typography polish: avoid a 'widow' - a last line holding a single word.
 *  Pull the last word of the previous line down so the last line has two words,
 *  but only when it still fits and the pulled word is not a hyphenation
 *  left-part (which must stay glued to its continuation). */
export function fixWidows(lines, widthOf, spaceW, maxW) {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last.length === 1 && prev.length >= 2) {
    const moved = prev[prev.length - 1];
    if (!String((moved && moved.text) || "").endsWith("-")) {
      const newLast = [moved, ...last];
      if (lineWidth(newLast, widthOf, spaceW) <= maxW + 0.5) {
        lines[lines.length - 2] = prev.slice(0, -1);
        lines[lines.length - 1] = newLast;
      }
    }
  }
  return lines;
}

// Typographic limits for hyphenation, shared with the preview wrap so both
// produce the same lines: at most this many lines in a row may end with a
// hyphen, and one word may be broken this often (1 = two parts).
export const HYPH_MAX_LADDER = 2;
export const HYPH_MAX_WORD_SPLITS = 1;

/**
 * Greedily wrap words into lines, each line <= maxW. With `hyph` (a callable
 * word -> break indices) a word that does not fit is split at a valid syllable
 * break instead of overflowing. A widow-avoidance pass keeps a lone word off
 * the last line when it can be paired without overflowing.
 *
 * Two typographic limits keep the result readable instead of shredded:
 * `maxLadder` is the classic "hyphen ladder" cap and `maxWordSplits` is how
 * often ONE word may be broken (1 = two parts). When a split is not allowed the
 * wrap simply does not split — the size search then settles one step smaller.
 * 0 = no limit.
 */
export function wrapGreedy(words, widthOf, spaceW, maxW, hyph = null,
  maxLadder = HYPH_MAX_LADDER, maxWordSplits = HYPH_MAX_WORD_SPLITS) {
  const lines = [[]];
  let curW = 0.0;
  const queue = Array.from(words);
  let guard = 0;
  let ladder = 0;                              // lines in a row ending with "-"
  let splits = 0;                              // splits of the word in hand
  let pending = null;                          // the tail of the word in hand

  const maySplit = () => (!!hyph
    && (maxLadder <= 0 || ladder < maxLadder)
    && (maxWordSplits <= 0 || splits < maxWordSplits));

  while (queue.length && guard < 100000) {
    guard += 1;
    const w = queue.shift();
    if (w !== pending) splits = 0;             // a fresh word, not a tail
    pending = null;
    const ww = widthOf(w);
    const cur = lines[lines.length - 1];
    if (!cur.length) {
      if (ww <= maxW) {
        cur.push(w);
        curW = ww;
        ladder = 0;
      } else {                                 // too wide for a whole line
        const res = maySplit() ? splitToFit(w, maxW, widthOf, hyph) : null;
        if (res) {
          const [left, right] = res;
          cur.push(left);
          lines.push([]);
          curW = 0.0;
          ladder += 1;
          splits += 1;
          pending = right;
          queue.unshift(right);
        } else {
          cur.push(w);                         // give up -> overflow (as before)
          curW = ww;
          ladder = 0;
        }
      }
    } else if (curW + spaceW + ww <= maxW) {
      cur.push(w);
      curW += spaceW + ww;
    } else {
      const avail = maxW - curW - spaceW;
      const res = maySplit() ? splitToFit(w, avail, widthOf, hyph) : null;
      if (res) {
        const [left, right] = res;
        cur.push(left);
        lines.push([]);
        curW = 0.0;
        ladder += 1;
        splits += 1;
        pending = right;
        queue.unshift(right);
      } else if (ww > maxW && maySplit()) {
        // Nothing of it fits into the rest of this line, and it is too wide
        // for a line of its own: start the new line and retry the word there,
        // where it can be split against the FULL width.
        lines.push([]);
        curW = 0.0;
        ladder = 0;
        pending = w;                           // same word: keep its split count
        queue.unshift(w);
      } else {
        lines.push([w]);
        curW = ww;
        ladder = 0;
      }
    }
  }
  if (lines.length && !lines[lines.length - 1].length) lines.pop();
  return fixWidows(lines, widthOf, spaceW, maxW);
}

/**
 * Split the words into exactly k lines so the lines are as equal in length
 * as possible (close to the average width). This avoids a single short last
 * line ('widows') and yields a calm, oval block shape.
 *
 * Minimizes the sum of squared deviation of each line from the target width
 * via dynamic programming. O(k * n^2).
 */
export function balanceEven(words, widthOf, spaceW, usableW, k) {
  const n = words.length;
  if (n === 0) return [];
  if (k <= 1) return [Array.from(words)];

  const w = words.map((x) => widthOf(x));
  const prefix = new Array(n + 1).fill(0.0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + w[i];

  const lineW = (i, j) => (prefix[j + 1] - prefix[i]) + spaceW * (j - i);

  // target width: average line width given k lines
  const target = (prefix[n] + spaceW * (n - k)) / k;

  const INF = Infinity;
  const dp = [];
  const nxt = [];
  for (let l = 0; l <= k; l++) {
    dp.push(new Array(n + 1).fill(INF));
    nxt.push(new Array(n + 1).fill(-1));
  }
  dp[0][n] = 0.0;

  for (let l = 1; l <= k; l++) {
    for (let i = n - 1; i >= 0; i--) {
      let best = INF;
      let bestj = -1;
      for (let j = i; j < n; j++) {
        const lw = lineW(i, j);
        const over = lw > usableW;
        if (over && j > i) break;
        const rem = dp[l - 1][j + 1];
        if (rem < INF) {
          // slight weighting: earlier lines should be fuller so a possibly
          // shorter line tends to end up at the bottom (the usual look).
          const weight = 1.0 + 0.04 * l;
          const d = target - lw;
          let cost = d * d * weight + rem;
          // phrase-aware break quality, scaled to the deviation cost so it
          // only decides between near-equally-balanced splits:
          const t2 = target * target;
          if (l > 1) {                           // interior line (has a break)
            if (wordIsStop(words[j])) {
              cost += 0.20 * t2;                  // don't dangle a function word
            } else if (endsClause(words[j])) {
              cost -= 0.06 * t2;                  // ended a clause: nice break
            } else if (j + 1 < n && wordIsConj(words[j + 1])) {
              cost -= 0.06 * t2;                  // next line starts 'and…/but…'
            }
          } else if (l === 1 && i === n - 1) {
            cost += 0.30 * t2;                    // single-word last line (widow)
          }
          if (cost < best) {
            best = cost;
            bestj = j;
          }
        }
        if (over) break;                          // single overlong word
      }
      dp[l][i] = best;
      nxt[l][i] = bestj;
    }
  }

  if (dp[k][0] === INF) return wrapGreedy(words, widthOf, spaceW, usableW);

  const lines = [];
  let i = 0;
  for (let l = k; l >= 1; l--) {
    const j = nxt[l][i];
    if (j < 0) break;
    lines.push(words.slice(i, j + 1));
    i = j + 1;
  }
  return lines;
}

/** Maximum line widths for k lines inside an ellipse (semi-axes a, b),
 *  vertically centered. Lines at the top/bottom are narrower. */
export function ellipseLineWidths(k, lineH, a, b) {
  const mid = (k - 1) / 2.0;
  const out = [];
  for (let i = 0; i < k; i++) {
    const dy = (i - mid) * lineH;
    const q = b > 0 ? dy / b : 0;
    const r = b > 0 ? 1.0 - q * q : -1.0;
    out.push(r > 0 ? 2.0 * a * Math.sqrt(r) : 0.0);
  }
  return out;
}

/** Total width of a line of words (with single spaces between them). */
export function lineWidth(words, widthOf, spaceW) {
  if (!words.length) return 0.0;
  return pySum(words.map((w) => widthOf(w))) + spaceW * (words.length - 1);
}

/** Wrap greedily where line i may be at most widths[i] wide (extra lines use
 *  the narrowest/last width). With `hyph` an over-wide word is split at a
 *  valid syllable break instead of failing. Returns null if a word still does
 *  not fit on its own line. */
export function wrapSchedule(words, widthOf, spaceW, widths, hyph = null) {
  const maxw = (i) => {
    if (!widths.length) return 0.0;
    return i < widths.length ? widths[i] : widths[widths.length - 1];
  };
  const lines = [];
  let cur = [];
  let curW = 0.0;
  const queue = Array.from(words);
  let guard = 0;
  while (queue.length && guard < 100000) {
    guard += 1;
    const word = queue.shift();
    const ww = widthOf(word);
    const limit = maxw(lines.length);
    if (!cur.length) {
      if (ww <= limit) {
        cur = [word];
        curW = ww;
      } else if (hyph) {
        const res = splitToFit(word, limit, widthOf, hyph);
        if (!res) return null;
        const [left, right] = res;
        lines.push([left]);
        queue.unshift(right);
        cur = [];
        curW = 0.0;
      } else {
        return null;
      }
    } else if (curW + spaceW + ww <= limit) {
      cur.push(word);
      curW += spaceW + ww;
    } else {
      // current line is full: close it and retry the word on a fresh line
      lines.push(cur);
      cur = [];
      curW = 0.0;
      queue.unshift(word);
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Wrap words so they fit inside an ellipse (semi-axes a, b). Fixed-point
 *  iteration over the line count, because the allowed widths depend on the
 *  (centered) line count. Only a self-consistent result is returned; otherwise
 *  null -> the caller picks a smaller font. */
export function wrapEllipse(words, widthOf, spaceW, a, b, lineH, hyph = null) {
  if (!words.length) return [];
  const init = wrapGreedy(words, widthOf, spaceW, 2.0 * a, hyph);
  let k = Math.max(1, init.length);
  for (let it = 0; it < 12; it++) {
    const widths = ellipseLineWidths(k, lineH, a, b);
    const res = wrapSchedule(words, widthOf, spaceW, widths, hyph);
    if (res === null) return null;
    if (res.length === k) return res;           // consistent
    k = res.length;
    if (k > 200) return null;
  }
  return null;                                  // did not converge -> smaller font
}

/**
 * Find the largest font size at which the wrapped text fits.
 *
 * shape='rect'    : rectangular box, evenly balanced lines. Embedded line
 *                   breaks (\n) are respected as hard breaks; each paragraph
 *                   is balanced on its own.
 * shape='ellipse' : inscribed ellipse (round speech bubble); lines at the
 *                   top/bottom become narrower. Hard breaks become spaces here.
 *
 * mask: optional list of bool with the same length as text - marks bold
 * characters. null -> nothing bold.
 *
 * hyphenate: when true, words that are too wide for a line are split at valid
 * syllable breaks (using `lang`'s patterns) instead of just forcing a smaller
 * font. Default false keeps the exact previous behavior.
 *
 * Returns: [fontPx, lines, lineH, ascent, descent, fitted] or null.
 * 'lines' is a list of run lists ([[subtext, bold], ...] per line).
 */
export function fitText(text, measurer, boxW, boxH, maxPx, minPx, padFrac,
  shape = "rect", mask = null, doHyphenate = false, lang = "en") {
  if (mask === null || mask === undefined) mask = new Array(cpLen(text)).fill(false);

  // word -> valid break indices (null disables hyphenation entirely)
  let hyphFn = null;
  if (doHyphenate) hyphFn = (wd) => hyphenateWordBreaks(wd, lang);

  const usableW = boxW * (1.0 - padFrac);
  const usableH = boxH * (1.0 - padFrac);

  let fits;
  let words = null;
  let paras = null;
  if (shape === "ellipse") {
    // \n counts as a space here
    const flat = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, " ");
    const fmask = Array.from(mask);
    // (the Python original keeps the mask as-is; the lengths only differ for
    // \r\n input, where zip() truncates exactly like makeWords does here)
    words = makeWords(flat, fmask);
    if (!words.length) return null;
    const a = usableW / 2.0;
    const b = usableH / 2.0;
    fits = (px) => {
      const [widthOf, spaceW, lineH] = measurer(px);
      const res = wrapEllipse(words, widthOf, spaceW, a, b, lineH, hyphFn);
      if (res === null) return null;
      if (res.length * lineH > usableH) return null;
      return res;
    };
  } else {
    const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const nmask = Array.from(mask);
    paras = splitParagraphs(norm, nmask).map(([pt, pm]) => makeWords(pt, pm));
    if (!paras.some((p) => p.length)) return null;
    fits = (px) => {
      const [widthOf, spaceW, lineH] = measurer(px);
      const allLines = [];
      for (const ws of paras) {
        if (!ws.length) {
          allLines.push([]);                     // intentional blank line
          continue;
        }
        allLines.push(...wrapGreedy(ws, widthOf, spaceW, usableW, hyphFn));
      }
      if (allLines.length * lineH > usableH) return null;
      // an unbreakable word wider than the box -> does not fit
      for (const ln of allLines) {
        if (lineWidth(ln, widthOf, spaceW) > usableW + 0.5) return null;
      }
      return allLines;
    };
  }

  let lo = pyInt(minPx);
  let hi = pyInt(maxPx);
  let best = null;
  while (lo <= hi) {
    const mid = floorDiv(lo + hi, 2);
    if (fits(mid) !== null) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  let fitted;
  if (best === null) {
    best = pyInt(minPx);
    fitted = false;
  } else {
    fitted = true;
  }

  const [widthOf, spaceW, lineH, ascent, descent] = measurer(best);
  let lineLists;
  if (shape === "ellipse") {
    let res = wrapEllipse(words, widthOf, spaceW, usableW / 2.0, usableH / 2.0, lineH, hyphFn);
    if (res === null) res = wrapGreedy(words, widthOf, spaceW, usableW, hyphFn);
    lineLists = res;
  } else {
    lineLists = [];
    for (const ws of paras) {
      if (!ws.length) {
        lineLists.push([]);
        continue;
      }
      // keep the even balancing for normal paragraphs; only fall back to the
      // hyphenating greedy wrap when a word is too wide to fit at all.
      if (hyphFn !== null && ws.some((w) => widthOf(w) > usableW)) {
        lineLists.push(...wrapGreedy(ws, widthOf, spaceW, usableW, hyphFn));
      } else {
        const k = wrapGreedy(ws, widthOf, spaceW, usableW).length;
        lineLists.push(...balanceEven(ws, widthOf, spaceW, usableW, k));
      }
    }
  }
  const lines = lineLists.map((ws) => lineRuns(ws));
  return [best, lines, lineH, ascent, descent, fitted];
}

/** Helper: break indices for a Word object (uses its plain text). */
export function hyphenateWordBreaks(word, lang = "en") {
  return hyphenate(word && word.text !== undefined ? word.text : String(word), lang);
}

// ---------------------------------------------------------------------------
// Layer naming
//
// Every inserted layer is named "TypeR NN — <snippet>" (NN = 1-based unit
// number). Building and matching that prefix lives here so the "replace
// previously inserted line" feature and the insert path share one definition.
// ---------------------------------------------------------------------------

/** Name prefix of the layer(s) TypeR inserted for the 1-based unit `index`,
 *  e.g. 3 -> 'TypeR 03 — '. */
export function typerLayerPrefix(index) {
  const n = pyInt(Number(index));
  const s = n < 0 ? "-" + String(-n).padStart(1, "0") : String(n).padStart(2, "0");
  return `TypeR ${s} — `;
}

/** True if `name` is a layer that TypeR created for unit `index`. The full
 *  prefix (including the em dash) must match, so hand-made layers or other
 *  units' layers are never mistaken. */
export function isTyperLayerName(name, index) {
  return String(name || "").startsWith(typerLayerPrefix(index));
}

// ---------------------------------------------------------------------------
// TextShapR: candidate text-shape arrangements
// ---------------------------------------------------------------------------

/** Run list -> plain text with `**` around the bold sections (the inverse of
 *  parseBold for one line). */
export function runsMarkup(runs) {
  return runs.map(([t, b]) => (b ? "**" + t + "**" : t)).join("");
}

/** Binary-search the largest integer px in [minPx, maxPx] for which
 *  `check(px)` returns a (non-null) result. Returns [px, result] or null. */
export function searchPx(check, maxPx, minPx) {
  let lo = pyInt(minPx);
  let hi = pyInt(maxPx);
  let best = null;
  while (lo <= hi) {
    const mid = floorDiv(lo + hi, 2);
    const res = check(mid);
    if (res !== null) {
      best = [mid, res];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Largest font size at which `words` balance into EXACTLY k lines that all
 *  fit. Returns [px, lines] or null. */
export function fitLinesK(words, measurer, usableW, usableH, maxPx, minPx, k) {
  if (!words.length || k < 1 || k > words.length) return null;
  const check = (px) => {
    const [widthOf, spaceW, lineH] = measurer(px);
    if (k * lineH > usableH) return null;
    const lines = balanceEven(words, widthOf, spaceW, usableW, k);
    if (lines.length !== k) return null;
    for (const ln of lines) {
      if (lineWidth(ln, widthOf, spaceW) > usableW + 0.5) return null;
    }
    return lines;
  };
  return searchPx(check, maxPx, minPx);
}

/** Greedy-wrap to a narrower target width (frac * usableW) and find the
 *  largest font size that fits the box. With `hyph`, over-wide words split at
 *  syllable breaks. Returns [px, lines] or null. */
export function fitLinesWidth(words, measurer, usableW, usableH, maxPx, minPx, frac, hyph = null) {
  if (!words.length) return null;
  const targetW = usableW * frac;
  const check = (px) => {
    const [widthOf, spaceW, lineH] = measurer(px);
    const lines = wrapGreedy(words, widthOf, spaceW, targetW, hyph);
    if (lines.length * lineH > usableH) return null;
    for (const ln of lines) {
      if (lineWidth(ln, widthOf, spaceW) > usableW + 0.5) return null;
    }
    return lines;
  };
  return searchPx(check, maxPx, minPx);
}

/** Largest font size at which the GIVEN arrangement fits the box. The line
 *  breaks are fixed: nothing is re-wrapped, only the size is searched. Used to
 *  re-fit a hand-edited arrangement after the style or box changed. */
export function fitFixedLines(wordLines, measurer, usableW, usableH, maxPx, minPx) {
  const lines = wordLines.filter((ws) => ws && ws.length);
  if (!lines.length) return null;
  const check = (px) => {
    const [widthOf, spaceW, lineH] = measurer(px);
    if (lines.length * lineH > usableH) return null;
    for (const ln of lines) {
      if (lineWidth(ln, widthOf, spaceW) > usableW + 0.5) return null;
    }
    return lines;
  };
  return searchPx(check, maxPx, minPx);
}

/** Largest font size at which the words fit an ellipse with semi-axes a, b. */
export function fitLinesEllipse(words, measurer, a, b, maxPx, minPx, hyph = null) {
  if (!words.length || a <= 0 || b <= 0) return null;
  const check = (px) => {
    const [widthOf, spaceW, lineH] = measurer(px);
    const lines = wrapEllipse(words, widthOf, spaceW, a, b, lineH, hyph);
    if (lines === null || lines.length * lineH > 2.0 * b) return null;
    return lines;
  };
  return searchPx(check, maxPx, minPx);
}

// sub-box scale factors that produce differently proportioned round bubbles
export const ROUND_BOXES = [[1.0, 1.0], [0.9, 1.0], [0.8, 1.0], [0.7, 1.0], [0.6, 1.0],
  [0.5, 1.0], [1.0, 0.85], [1.0, 0.7], [1.0, 0.55],
  [0.85, 0.85], [0.7, 0.85]];
// target-width fractions for the hyphenating width sweep
export const WIDTH_FRACS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.28, 0.22];

// The fill ratio (text-block area / usable area) that reads most comfortably in
// a speech bubble. The block is ideal anywhere in [TARGET_FILL, FILL_SWEET_MAX];
// only past the sweet max does it read as crowding the bubble rim.
export const TARGET_FILL = 0.72;
export const FILL_SWEET_MAX = 0.88;

// A line ending on one of these sits at a natural pause.
export const CLAUSE_END = ".,;:!?…";

// Short function words that dangle badly at the END of a line in lettering.
export const LINE_END_STOPS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "by", "for", "and", "or",
  "but", "nor", "as", "so", "if", "is", "it", "my", "our", "your", "i",
  "with", "from", "into", "onto", "than", "up",
]);
const TRIM_PUNCT = "\"'“”‘’.,;:!?—-…()[]{}*«»";

/** A word stripped of closing quotes/brackets and lower-cased, for stop-word
 *  tests. Returns '' when the word ends a clause (a fine place to break, so it
 *  must never count as a dangling stop word). */
export function bareLast(text) {
  const t = rstrip(String(text), "\"'“”‘’)]}»");
  const tc = cps(t);
  if (!tc.length || CLAUSE_END.includes(tc[tc.length - 1])) return "";
  return strip(t, TRIM_PUNCT).toLowerCase();
}

function wordText(word) {
  return word && typeof word === "object" && word.text !== undefined ? word.text : word;
}

export function wordIsStop(word) {
  return LINE_END_STOPS.has(bareLast(wordText(word)));
}

// Coordinating/subordinating conjunctions + relative pronouns: a line that
// STARTS with one of these reads well, so breaking right BEFORE it is good.
export const CONJ_START = new Set([
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though",
  "while", "when", "where", "which", "who", "since", "unless", "until", "if",
]);

export function wordIsConj(word) {
  return CONJ_START.has(bareLast(wordText(word)));
}

/** True if the word ends with clause punctuation (a natural break point). */
export function endsClause(word) {
  const t = cps(rstrip(String(wordText(word)), "\"'”’)]}»"));
  return t.length > 0 && CLAUSE_END.includes(t[t.length - 1]);
}

// Comfortable reading measure (legacy default, per-mode values in PROFILES).
export const MAX_LINE_CHARS = 30;
export const MIN_LINE_RATIO = 0.4;

// Legacy default kept so old callers that pass `lineTarget` keep working.
export const LINE_TARGET = 4;
export const LINE_TARGET_WEIGHT = 0.25;

// --- per-mode profiles ------------------------------------------------------
//   lines       soft band for the line count; outside it the count is charged
//   line_target where the mode leans WITHIN what the geometry allows
//   max_chars   reading measure, per mode
//   min_ratio   below this fraction of the longest line an interior line is a stub
export const PROFILES = {
  balanced: { lines: [2, 8], line_target: 4, max_chars: 26, min_ratio: 0.40 },
  round: { lines: [3, 7], line_target: 4, max_chars: 22, min_ratio: 0.38 },
  tall: { lines: [4, 12], line_target: 6, max_chars: 18, min_ratio: 0.36 },
  wide: { lines: [1, 5], line_target: 3, max_chars: 34, min_ratio: 0.50 },
};
// How far the line count may sit from the ideal before the charge bites, and
// the most it can ever cost. Capped deliberately.
export const LINE_SPREAD = 1.6;
export const LINE_PEN_MAX = 0.55;

/** The scoring profile for a shaper mode (unknown modes -> balanced). */
export function profileFor(mode) {
  return PROFILES[mode || "balanced"] || PROFILES.balanced;
}

/**
 * How many lines this text WANTS in a box of this shape:
 *     k = sqrt(total_w / (line_h * box_aspect))
 * Scale-free; clamped to the mode's band and to what actually fits.
 */
export function idealLineCount(totalW, lineH, boxAspect, profile = null, maxFit = null) {
  if (totalW <= 0 || lineH <= 0 || boxAspect <= 0) return 1.0;
  const k = Math.sqrt(totalW / (lineH * boxAspect));
  const prof = profile || PROFILES.balanced;
  let [lo, hi] = prof.lines;
  if (maxFit) {
    hi = Math.min(hi, Math.max(1, pyInt(maxFit)));
    lo = Math.min(lo, hi);
  }
  return Math.max(lo, Math.min(hi, k));
}

/** Geometry of an arrangement at its own fitted size:
 *  [px, k, lineWidths, blockW, blockH, lineH]. */
export function arrMetrics(cand, measurer) {
  const lines = cand.lines || [];
  const k = lines.length;
  const px = Math.max(1, pyInt(cand.px !== undefined ? cand.px : 1));
  const [widthOf, , lineH] = measurer(px);
  const lineWs = lines.map((runs) => widthOf(runs));
  const blockW = lineWs.length ? Math.max(...lineWs) : 0.0;
  return [px, k, lineWs, blockW, lineH * k, lineH];
}

// A sampled bubble outline never goes below this fraction of the widest row.
export const ROW_FLOOR = 0.12;

/** Normalised bubble width at relative height `t` (0 = top, 1 = bottom). */
export function shapeRowWidth(rows, t) {
  if (!rows || !rows.length) return 1.0;
  const n = rows.length;
  if (n === 1) return Math.max(ROW_FLOOR, Number(rows[0]));
  const x = Math.min(Math.max(Number(t), 0.0), 1.0) * (n - 1);
  const i = pyInt(x);
  if (i >= n - 1) return Math.max(ROW_FLOOR, Number(rows[n - 1]));
  const frac = x - i;
  const val = Number(rows[i]) * (1.0 - frac) + Number(rows[i + 1]) * frac;
  return Math.max(ROW_FLOOR, val);
}

/** The bubble's own width at each of `k` line positions (block vertically
 *  centred in the bubble). Falls back to spreading the lines over the full
 *  height when the block's geometry isn't given, and to 1.0 without an
 *  outline. */
export function lineRowTargets(rows, k, blockH = null, usableH = null) {
  if (k <= 0) return [];
  if (!rows || !rows.length) return new Array(k).fill(1.0);
  const out = [];
  if (blockH && usableH && usableH > 0) {
    const span = Math.min(Number(blockH), Number(usableH));
    const gap = Math.max(0.0, (usableH - span) / 2.0);   // vertically centred
    const lineH = span / k;
    for (let i = 0; i < k; i++) out.push(shapeRowWidth(rows, (gap + (i + 0.5) * lineH) / usableH));
    return out;
  }
  for (let i = 0; i < k; i++) out.push(shapeRowWidth(rows, (i + 0.5) / k));
  return out;
}

/** Charge for line breaks that tear a short phrase apart *avoidably*. */
export function phraseBreakPenalty(texts, lineWs, spaceW, usableW) {
  if (texts.length < 3) return 0.0;
  let pen = 0.0;
  for (let i = 0; i < texts.length - 1; i++) {
    const parts = pySplit(texts[i]);
    if (!parts.length || parts.length > 2) continue;
    if (endsClause(parts[parts.length - 1])) continue;   // a clause ended here
    const nxt = pySplit(texts[i + 1]);
    if (!nxt.length) continue;
    // width of this line + a space + the next line's first word
    const joined = lineWs[i] + spaceW
      + cpLen(nxt[0]) / Math.max(1, cpLen(texts[i + 1])) * lineWs[i + 1];
    if (joined <= usableW) pen += 1.0;
  }
  return pen;
}

/** Charge for an interior line that carries a sentence end with more words
 *  behind it (`a trap. Now`). */
export function sentenceBreakPenalty(texts) {
  let pen = 0;
  for (const t of texts.slice(0, -1)) {
    const stripped = cps(rstrip(t));
    for (let i = 0; i < stripped.length - 1; i++) {
      if (".!?…".includes(stripped[i]) && stripped[i + 1] === " ") {
        pen += 1;
        break;
      }
    }
  }
  return pen;
}

/**
 * Typographic quality of a candidate arrangement (higher = better).
 *
 * The four terms describing the SHAPE of the block outweigh the two describing
 * its bulk:
 *     shape   aspect 1.1 + balance 0.8 + step 0.6 + break quality 0.5 = 3.0
 *     bulk    fill 1.15 + size 1.0                                    = 2.15
 *
 * See layout.py `score_arrangement` for the full rationale of every term; the
 * weights and terms here are identical.
 */
export function scoreArrangement(cand, measurer, usableW, usableH, pxRef = null,
  maxChars = null, lineTarget = null, mode = null, totalW = null, shapeRows = null) {
  const lines = cand.lines || [];
  const [px, k, lineWs, blockW, blockH, lineH] = arrMetrics(cand, measurer);
  if (k === 0 || blockW <= 0 || usableW <= 0 || usableH <= 0) return -Infinity;
  const prof = profileFor(mode);
  if (maxChars === null || maxChars === undefined) maxChars = prof.max_chars;
  const minRatio = prof.min_ratio;

  const ref = pxRef ? Number(pxRef) : Number(px);
  const sizeTerm = ref > 0 ? Math.sqrt(px / ref) : 1.0;     // sqrt: diminishing

  // Fill: one smooth curve around the comfortable band, judged against the
  // bubble's real area when an outline is given.
  const rowTargets = shapeRows && shapeRows.length
    ? lineRowTargets(shapeRows, k, blockH, usableH) : null;
  let areaFrac = shapeRows && shapeRows.length ? pySum(shapeRows) / shapeRows.length : 1.0;
  areaFrac = Math.max(ROW_FLOOR, Math.min(1.0, areaFrac));

  const fill = (blockW * blockH) / (usableW * usableH * areaFrac);
  let fillTerm;
  if (fill <= FILL_SWEET_MAX) {
    const centre = 0.5 * (TARGET_FILL + FILL_SWEET_MAX);
    const z = (fill - centre) / 0.34;
    fillTerm = Math.exp(-(z * z));
    if (fill >= TARGET_FILL) fillTerm = Math.max(fillTerm, 0.92);
  } else {
    fillTerm = Math.max(0.10, 1.0 - (fill - FILL_SWEET_MAX) * 8.0);
  }

  // Rim clearance: a block touching the rim in EITHER direction is cramped;
  // with an outline every line is measured against the bubble's width at its
  // own height.
  let crowd;
  if (rowTargets) {
    const rel = lineWs.map((w, i) => w / (usableW * rowTargets[i]));
    crowd = Math.max(blockH / usableH, Math.max(...rel));
  } else {
    crowd = Math.max(blockW / usableW, blockH / usableH);
  }
  let crowdPen = 0.0;
  if (crowd > 0.90) {
    const c = (crowd - 0.90) / 0.10;
    crowdPen = c * c;
  }

  // every judgement about line LENGTHS is made relative to the bubble's width
  // at each line's own height
  const relWs = rowTargets ? lineWs.map((w, i) => w / rowTargets[i]) : Array.from(lineWs);
  const relMax = relWs.length ? Math.max(...relWs) : 0.0;
  const blockAspect = blockH > 0 ? blockW / blockH : 0.0;
  const boxAspect = usableW / usableH;
  let aspectTerm;
  if (blockAspect > 0 && boxAspect > 0) {
    const z = Math.log(blockAspect / boxAspect) / 0.9;
    aspectTerm = Math.exp(-(z * z));
  } else {
    aspectTerm = 0.0;
  }

  let balanceTerm = 1.0;
  if (k >= 2 && relMax > 0) {
    const avg = pySum(relWs) / k;
    const rag = Math.sqrt(pySum(relWs.map((w) => (w - avg) * (w - avg))) / k) / relMax;
    const z = rag / 0.42;
    balanceTerm = Math.exp(-(z * z));
  }

  // Line-to-line smoothness: what reads as ragged is the STEP between
  // neighbours, so charge that directly.
  let stepTerm = 1.0;
  if (k >= 3 && relMax > 0) {
    const steps = [];
    for (let i = 1; i < k; i++) steps.push(Math.abs(relWs[i] - relWs[i - 1]) / relMax);
    const stepRms = Math.sqrt(pySum(steps.map((s) => s * s)) / steps.length);
    const z = stepRms / 0.34;
    stepTerm = Math.exp(-(z * z));
  }

  let lastTerm = 1.0;
  if (k >= 2 && relMax > 0) {
    const lastFrac = relWs[relWs.length - 1] / relMax;
    if (lastFrac < 0.5) lastTerm = Math.min(1.0, 0.6 + 0.8 * lastFrac);
  }
  // a very short FIRST line (an orphan) reads as badly as a short last line
  let firstTerm = 1.0;
  if (k >= 3 && relMax > 0) {
    const firstFrac = relWs[0] / relMax;
    if (firstFrac < 0.5) firstTerm = Math.min(1.0, 0.6 + 0.8 * firstFrac);
  }

  // break quality: fraction of the internal breaks that land right after
  // clause punctuation, minus lines of only punctuation.
  const texts = lines.map((runs) => strip(runsText(runs)));
  const hasAlnum = (t) => cps(t).some((c) => isAlnum(c));
  const lastCh = (t) => {
    const c = cps(t);
    return c.length ? c[c.length - 1] : "";
  };
  let punctTerm = 0.0;
  if (k >= 2) {
    const good = texts.slice(0, -1)
      .filter((t) => t && CLAUSE_END.includes(lastCh(t)) && hasAlnum(t)).length;
    punctTerm = good / (k - 1);
  }
  const punctOnly = texts.filter((t) => t && !hasAlnum(t)).length;

  // reading measure: quadratic overflow past maxChars, summed over the lines.
  let over = 0.0;
  if (maxChars && maxChars > 0) {
    for (const t of texts) {
      const n = cpLen(t);
      if (n > maxChars) {
        const frac = (n - maxChars) / maxChars;
        over += frac * frac;
      }
    }
  }

  // interior stub lines: a short line between longer ones (not the last line)
  let short = 0.0;
  for (const w of relWs.slice(0, -1)) {
    const r = relMax ? w / relMax : 0.0;
    if (r < minRatio) {
      const d = (minRatio - r) / minRatio;
      short += d * d;
    }
  }

  // Line count against the ideal the bubble's proportions imply — capped.
  let targetPen;
  if (lineTarget) {
    targetPen = Math.pow(Math.abs(k - lineTarget), 1.5);
  } else {
    const total = totalW ? Number(totalW) : pySum(lineWs) + 0.0;
    let ideal = idealLineCount(total, lineH, boxAspect, prof,
      lineH ? usableH / lineH : null);
    // the mode leans within what the geometry allows, it does not overrule it
    const lean = prof.line_target - PROFILES.balanced.line_target;
    ideal = Math.max(prof.lines[0], Math.min(prof.lines[1], ideal + 0.5 * lean));
    const d = (k - ideal) / LINE_SPREAD;
    targetPen = Math.min(LINE_PEN_MAX, d * d) / LINE_TARGET_WEIGHT;
  }

  // hyphenation is a last resort
  const hyphPen = texts.slice(0, -1).filter((t) => t.endsWith("-")).length;

  // dangling function words at the end of an interior line
  let stopPen = 0;
  for (const t of texts.slice(0, -1)) {
    const parts = pySplit(t);
    if (parts.length && LINE_END_STOPS.has(bareLast(parts[parts.length - 1]))) stopPen += 1;
  }

  const [, spaceW] = measurer(px);
  const phrasePen = phraseBreakPenalty(texts, lineWs, spaceW, usableW);
  const sentencePen = sentenceBreakPenalty(texts);

  const quality = (1.0 * sizeTerm
    + 1.15 * fillTerm
    + 1.1 * aspectTerm
    + 0.8 * balanceTerm
    + 0.6 * stepTerm
    + 0.5 * punctTerm) * lastTerm * firstTerm;
  return (quality
    - 0.6 * over
    - 0.5 * punctOnly
    - 0.6 * short
    - 0.5 * hyphPen
    - 0.3 * stopPen
    - 0.45 * sentencePen
    - 0.4 * phrasePen
    - 0.5 * crowdPen
    - LINE_TARGET_WEIGHT * targetPen);
}

// Below this fill the whole candidate set counts as starved and the shaper
// retries with hyphenation on its own (see `shapeCandidates`).
export const STARVED_FILL = 0.25;

export function blockFill(cand, measurer, usableW, usableH) {
  const [, , , blockW, blockH] = arrMetrics(cand, measurer);
  if (usableW <= 0 || usableH <= 0) return 0.0;
  return (blockW * blockH) / (usableW * usableH);
}

/** Collapse near-identical arrangements so the picker offers *distinct*
 *  shapes (same line count + same relative width profile rounded to 10 %).
 *  Keeps the first of each group; `cands` must be sorted best-first. */
export function dedupSimilar(cands, measurer) {
  const kept = [];
  const seen = new Set();
  for (const c of cands) {
    const [, k, lineWs, blockW] = arrMetrics(c, measurer);
    const prof = blockW ? lineWs.map((w) => pyRound(w / blockW, 1)) : [];
    const sig = k + "|" + prof.map((v) => v.toFixed(1)).join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    kept.push(c);
  }
  return kept;
}

/**
 * Generate candidate arrangements of `text` for the TextShapR picker.
 *
 * mode: 'balanced' | 'tall' | 'wide' | 'round'.
 * hyphenate: allow syllable breaks (uses `lang`'s patterns).
 * dehyphenate: first rejoin words the source split across a line.
 * shapeRows: optional sampled outline of the selection — one normalised width
 *     per row, top to bottom. Absent, everything behaves rectangularly.
 *
 * Returns a list of {px, k, lines, words, score}, deduplicated, at most
 * `limit` entries, best first.
 */
export function shapeCandidates(text, measurer, boxW, boxH, maxPx, minPx, padFrac, opts = {}) {
  const {
    mode = "balanced", hyphenate: doHyph = false, lang = "en", mask: mask0 = null,
    limit = 10, dehyphenate: doDehyph = false, inset = 0.0, shapeRows = null,
  } = opts;
  let mask = mask0 === null || mask0 === undefined ? new Array(cpLen(text)).fill(false) : mask0;
  let flat = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, " ");
  if (doDehyph) [flat, mask] = dehyphenate(flat, Array.from(mask));
  const words = makeWords(flat, Array.from(mask));
  if (!words.length) return [];
  // `inset` (px per side) leaves room for a fixed-width outline/stroke so
  // outlined text doesn't overflow the bubble — subtracted as a constant.
  const usableW = boxW * (1.0 - padFrac) - 2.0 * Math.max(0.0, inset);
  const usableH = boxH * (1.0 - padFrac) - 2.0 * Math.max(0.0, inset);
  if (usableW <= 0 || usableH <= 0) return [];

  let hyphFn = null;
  if (doHyph) hyphFn = (wd) => hyphenateWordBreaks(wd, lang);

  const cands = [];
  const seen = new Set();

  const add = (res) => {
    if (res === null || res === undefined) return;
    const [px, wordLines] = res;
    const runs = wordLines.map((ws) => lineRuns(ws));
    const key = runs.map((r) => runsText(r)).join("\u0001");
    if (seen.has(key)) return;
    seen.add(key);
    // keep the word-level grouping too, so the manual break editor can regroup
    // this candidate without re-tokenising.
    cands.push({ px, k: runs.length, lines: runs, words: wordLines.map((ws) => Array.from(ws)) });
  };

  if (mode === "round") {
    const a = usableW / 2.0;
    const b = usableH / 2.0;
    for (const [fw, fh] of ROUND_BOXES) {
      add(fitLinesEllipse(words, measurer, a * fw, b * fh, maxPx, minPx, hyphFn));
    }
  } else if (doHyph) {
    // exact-k balancing cannot split words, so hyphenated candidates come from
    // greedily wrapping to a sweep of narrower target widths
    for (const f of WIDTH_FRACS) {
      add(fitLinesWidth(words, measurer, usableW, usableH, maxPx, minPx, f, hyphFn));
    }
  } else {
    // (a) the width-balanced shape for each line count
    for (let k = 1; k <= Math.min(words.length, 12); k++) {
      add(fitLinesK(words, measurer, usableW, usableH, maxPx, minPx, k));
    }
    // (b) a sweep of narrower target widths -> alternative proportions
    for (const f of WIDTH_FRACS) {
      add(fitLinesWidth(words, measurer, usableW, usableH, maxPx, minPx, f, null));
    }
    // (c) a few lens/oval shapes (short-long-short)
    const a0 = usableW / 2.0;
    const b0 = usableH / 2.0;
    for (const [fw, fh] of ROUND_BOXES.slice(0, 4)) {
      add(fitLinesEllipse(words, measurer, a0 * fw, b0 * fh, maxPx, minPx, null));
    }
  }

  // Starved set: when the best thing on offer leaves the bubble nearly empty,
  // retry the width sweep WITH syllable breaks even though the user did not
  // ask for them; the hyphen penalty keeps those out of the way whenever a
  // clean shape exists.
  if (cands.length && !doHyph && mode !== "round") {
    const bestFill = Math.max(...cands.map((c) => blockFill(c, measurer, usableW, usableH)));
    if (bestFill < STARVED_FILL) {
      const rescue = (wd) => hyphenateWordBreaks(wd, lang);
      for (const f of WIDTH_FRACS) {
        add(fitLinesWidth(words, measurer, usableW, usableH, maxPx, minPx, f, rescue));
      }
    }
  }

  if (!cands.length) return [];
  // Rank by the typographic quality score for EVERY mode (round included).
  const pxRef = Math.max(...cands.map((c) => c.px)) || 1;
  for (const c of cands) {
    c.score = scoreArrangement(c, measurer, usableW, usableH, pxRef, null, null, mode, null, shapeRows);
  }
  const order = cands.map((c, i) => [c, i]);
  order.sort((x, y) => {
    const a = -x[0].score;
    const b = -y[0].score;
    if (a < b) return -1;
    if (a > b) return 1;
    return x[1] - y[1];
  });
  return dedupSimilar(order.map((o) => o[0]), measurer).slice(0, limit);
}

/**
 * Baseline of the FIRST line depending on vertical alignment.
 *
 * `cap` (the font's cap height) makes the centering OPTICAL rather than by the
 * em box. Falls back to `ascent` when unknown.
 */
export function verticalStart(valign, boxY, boxH, padFrac, k, lineH, ascent, descent, cap = null) {
  // clamp the cap height to a sane share of the ascent
  const useCap = !!(cap && cap > 0 && ascent > 0);
  const c = useCap ? Math.max(0.55 * ascent, Math.min(Number(cap), ascent)) : ascent;
  const pad = boxH * padFrac / 2.0;
  if (valign === "top") return boxY + pad + c;
  if (valign === "bottom") return boxY + boxH - pad - descent - (k - 1) * lineH;
  const cy = boxY + boxH / 2.0;
  if (useCap) {
    // optical: centre the CAP block on the box centre
    return cy - ((k - 1) * lineH - c) / 2.0;
  }
  // no cap height known: centre the em box (ascent + descent)
  return cy - ((k - 1) * lineH + descent - ascent) / 2.0;
}

/** Absolute LEFT x for each line (the alignment is baked in per line).
 *  align: 'left' | 'right' | anything else = center. */
export function lineXPositions(lineWidths, align, left, center, right) {
  if (align === "left") return lineWidths.map(() => Number(left));
  if (align === "right") return lineWidths.map((w) => Number(right) - w);
  return lineWidths.map((w) => Number(center) - w / 2.0);
}

// --- vertical text (tategaki) ---------------------------------------------
// A "line" is a column running downwards, and successive columns march
// LEFTWARDS. The fitter is axis-agnostic, so vertical text reuses fitText with
// the box transposed and a measurer that measures DOWN the column.

/**
 * measurer(px) for vertical text.
 *
 * ⚠ THE POINT OF THIS FUNCTION: with upright orientation every glyph advances
 * by roughly one em DOWNWARDS, so a run's length along its column is
 * `characters * px`. A font's horizontal advance is the wrong tape measure here
 * — "I" and "W" differ wildly in width but stack to exactly the same height —
 * and feeding it to fitText makes wrap and auto-fit systematically wrong.
 */
export function verticalMeasurer(lineSpacing) {
  return (px0) => {
    const px = Math.max(1, pyInt(pyRound(px0)));
    const em = px;
    const widthOf = (x) => {
      let runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
      if (runs === undefined) {
        if (Array.isArray(x)) runs = x;          // a plain run list
        else return cpLen(String(x)) * em;       // a plain string
      }
      return pySum(runs.map(([t]) => cpLen(t))) * em;
    };
    return [widthOf, em, em * lineSpacing, em / 2.0, em / 2.0];
  };
}

const VALIGN_ANCHOR = { top: "left", bottom: "right" };

/** Absolute TOP y for each column of vertical text. */
export function columnYPositions(lineLengths, valign, top, center, bottom) {
  return lineXPositions(lineLengths, VALIGN_ANCHOR[valign] || "center", top, center, bottom);
}

/** Center x of the FIRST column of vertical-rl text (k columns total). */
export function horizontalStart(align, boxX, boxW, padFrac, k, lineH) {
  const pad = boxW * padFrac / 2.0;
  const blockW = k * lineH;
  let right;
  if (align === "left") right = boxX + pad + blockW;
  else if (align === "right") right = boxX + boxW - pad;
  else right = boxX + boxW / 2.0 + blockW / 2.0;
  return right - lineH / 2.0;
}
