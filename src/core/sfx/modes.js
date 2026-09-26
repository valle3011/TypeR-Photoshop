// The five ways to handle a Japanese sound effect: ignore / romaji / note /
// overlay / redraw — plus kana -> Hepburn romaji and the note markers.
//
// Port of TypeR-Krita `typer_kr/sfx/modes.py`. Host-free, tested.

import { cps } from "../py.js";

export const STRATEGIES = [
  { id: "ignore", translation: false, inserts: false },
  { id: "romaji", translation: false, inserts: true },
  { id: "note", translation: true, inserts: true },
  { id: "overlay", translation: true, inserts: true },
  { id: "redraw", translation: true, inserts: true },
];

export const STRATEGY_IDS = STRATEGIES.map((s) => s.id);
const BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

export function strategy(sid) {
  return BY_ID.get(sid) || null;
}

export function needsTranslation(sid) {
  const s = BY_ID.get(sid);
  return !!(s && s.translation);
}

export function insertsText(sid) {
  const s = BY_ID.get(sid);
  return !!(s && s.inserts);
}

// Circled numbers exist as single glyphs up to 20; past that "(21)".
const CIRCLED = cps("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳");

/** The marker for the `index`-th note (1-based). */
export function noteMarker(index) {
  if (index >= 1 && index <= CIRCLED.length) return CIRCLED[index - 1];
  return `(${index})`;
}

/** One line of the panel-edge SFX list: marker, original, romaji, meaning. */
export function noteLine(index, source, meaning = "") {
  const romaji = toRomaji(source);
  let line = `${noteMarker(index)} ${source}`;
  if (romaji && romaji !== source) line += ` = ${romaji}`;
  if (meaning) line += ` (${meaning})`;
  return line;
}

// --- kana -> romaji (Hepburn), long vowels doubled (no macrons) -----------

const ROMAJI = {
  "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
  "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
  "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
  "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
  "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
  "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
  "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
  "や": "ya", "ゆ": "yu", "よ": "yo",
  "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
  "わ": "wa", "ゐ": "i", "ゑ": "e", "を": "o", "ん": "n",
  "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
  "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
  "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
  "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
  "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
  "ゔ": "vu",
};

const YOUON = {
  "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo",
  "しゃ": "sha", "しゅ": "shu", "しょ": "sho",
  "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho",
  "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo",
  "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo",
  "みゃ": "mya", "みゅ": "myu", "みょ": "myo",
  "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo",
  "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo",
  "じゃ": "ja", "じゅ": "ju", "じょ": "jo",
  "ぢゃ": "ja", "ぢゅ": "ju", "ぢょ": "jo",
  "びゃ": "bya", "びゅ": "byu", "びょ": "byo",
  "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo",
  // foreign-sound clusters, common in SFX
  "ふぁ": "fa", "ふぃ": "fi", "ふぇ": "fe", "ふぉ": "fo",
  "うぃ": "wi", "うぇ": "we", "うぉ": "wo",
  "ゔぁ": "va", "ゔぃ": "vi", "ゔぇ": "ve", "ゔぉ": "vo",
  "てぃ": "ti", "でぃ": "di", "とぅ": "tu", "どぅ": "du",
  "しぇ": "she", "ちぇ": "che", "じぇ": "je",
  "つぁ": "tsa", "つぃ": "tsi", "つぇ": "tse", "つぉ": "tso",
};

const SMALL_VOWELS = { "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o" };
const SOKUON = "っ";
const PROLONG = "ー";
const VOWELS = "aiueo";

/** Katakana -> hiragana (the kana blocks sit 0x60 apart). */
function toHiragana(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
  }
  return out;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Transliterate Japanese kana to Hepburn romaji; everything that is not kana
 *  passes through untouched. */
export function toRomaji(text) {
  if (!text) return "";
  const src = cps(toHiragana(text));
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];

    // small tsu: double the consonant that follows
    if (ch === SOKUON) {
      let nxt = null;
      for (const size of [2, 1]) {
        const piece = src.slice(i + 1, i + 1 + size).join("");
        const tbl = size === 2 ? YOUON : ROMAJI;
        if (has(tbl, piece)) {
          nxt = tbl[piece];
          break;
        }
      }
      if (nxt && !VOWELS.includes(nxt[0])) {
        // "cch" is wrong; Hepburn doubles it as "tch" (matcha)
        out.push(nxt.startsWith("ch") ? "t" : nxt[0]);
      }
      i += 1;
      continue;
    }

    // long vowel mark: repeat the last vowel we produced
    if (ch === PROLONG) {
      const prev = out.join("");
      if (prev && VOWELS.includes(prev[prev.length - 1])) out.push(prev[prev.length - 1]);
      i += 1;
      continue;
    }

    const pair = src.slice(i, i + 2).join("");
    const pairArr = src.slice(i, i + 2);
    if (pairArr.length === 2 && has(YOUON, pair)) {
      out.push(YOUON[pair]);
      i += 2;
      continue;
    }

    // a small vowel we have no cluster for: graft it onto the base (ウァ -> wa)
    if (pairArr.length === 2 && has(SMALL_VOWELS, pairArr[1]) && has(ROMAJI, pairArr[0])) {
      const base = ROMAJI[pairArr[0]];
      out.push(VOWELS.includes(base[base.length - 1])
        ? base.slice(0, -1) + SMALL_VOWELS[pairArr[1]]
        : base + SMALL_VOWELS[pairArr[1]]);
      i += 2;
      continue;
    }

    if (has(ROMAJI, ch)) {
      out.push(ROMAJI[ch]);
      i += 1;
      continue;
    }
    if (has(SMALL_VOWELS, ch)) {         // stray small vowel
      out.push(SMALL_VOWELS[ch]);
      i += 1;
      continue;
    }
    if (ch === "・") {               // katakana middle dot separates words
      out.push(" ");
      i += 1;
      continue;
    }
    out.push(ch);                        // not kana: leave it alone
    i += 1;
  }
  return out.join("");
}
