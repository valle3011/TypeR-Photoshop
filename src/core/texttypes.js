// Manga text-type catalogue.
//
// Port of TypeR-Krita `typer_kr/texttypes.py`. Every kind of text on a page
// has its own established look (Blambot's "Comic Book Grammar & Tradition",
// Nekyou, Insidescanlation). Fonts are *named, not shipped*: each entry lists
// candidates best-first and `resolveFont()` picks the first installed family
// through fontmatch.

import { FontIndex } from "./fontmatch.js";
import { isAlnum, strip } from "./py.js";

const SPEECH = ["CC Wild Words", "Wild Words", "Anime Ace 2.0", "Anime Ace BB",
  "Anime Ace", "Comic Neue", "Comic Sans MS", "Arial"];
const THOUGHT = ["CC Jim Lee", "Anime Ace 2.0", "Comic Neue", "Comic Sans MS", "Arial"];
const SHOUT = ["Zud Juice", "CC Wild Words", "Anime Ace 2.0", "Impact", "Arial Black", "Arial"];
const SMALL = ["Augie", "CC Wild Words", "Comic Neue", "Comic Sans MS", "Arial"];
const NARRATION = ["Tekton Pro", "Felt", "Flair", "Franklin Gothic Book", "Segoe UI", "Arial"];
const RADIO = ["Felt", "GF Matilda Bold", "Anime Ace 2.0", "Segoe UI", "Arial"];
const ROBOT = ["OCR A Extended", "Consolas", "Courier New", "Arial"];
const MONSTER = ["CC Zombie Guts", "Chiller", "Impact", "Arial Black", "Arial"];
const HAND = ["Ampersand", "Gooddog", "SF Grunge Sans", "Segoe Script", "Comic Sans MS", "Arial"];
const SFX = ["Badaboom BB", "CC Splashdown", "Impact", "Arial Black", "Arial"];
const DISPLAY = ["Bernard MT Condensed", "VAG Rounded BT", "Impact", "Arial Black", "Arial"];

const INK = "#000000";
const QUIET = "#444444";
const FAINT = "#555555";

const BUILTIN_TYPES = [
  // ---------------- inside the balloon: the voice ----------------
  { id: "dialogue", group: "balloon", fonts: SPEECH,
    style: { size: 13, case: "upper", bold: false, italic: false, color: INK, outline: false, align: "center", valign: "middle", round: true } },
  // Comics use bold-italic for emphasis; plain bold is a beginner tell.
  { id: "emphasis", group: "balloon", fonts: SPEECH,
    style: { size: 13, case: "upper", bold: true, italic: true, color: INK, outline: false, align: "center" } },
  { id: "thought", group: "balloon", fonts: THOUGHT,
    style: { size: 13, case: "upper", bold: false, italic: true, color: QUIET, outline: false, align: "center", round: true } },
  { id: "whisper", group: "balloon", fonts: SMALL,
    style: { size: 10, case: "lower", bold: false, italic: false, color: FAINT, outline: false, align: "center" } },
  { id: "shout", group: "balloon", fonts: SHOUT,
    style: { size: 17, case: "upper", bold: true, italic: false, color: INK, outline: false, align: "center" } },
  { id: "weak", group: "balloon", fonts: SMALL,
    style: { size: 10, case: "lower", bold: false, italic: true, color: QUIET, outline: false, align: "center" } },
  { id: "radio", group: "balloon", fonts: RADIO,
    style: { size: 12, case: "upper", bold: false, italic: true, color: INK, outline: false, align: "center" } },
  { id: "robot", group: "balloon", fonts: ROBOT,
    style: { size: 12, case: "upper", bold: true, italic: false, color: INK, outline: false, align: "center", round: false } },
  { id: "telepathy", group: "balloon", fonts: THOUGHT,
    style: { size: 12, case: "upper", bold: false, italic: true, color: QUIET, outline: false, align: "center" } },
  { id: "monster", group: "balloon", fonts: MONSTER,
    style: { size: 15, case: "upper", bold: true, italic: false, color: INK, outline: false, align: "center" } },
  // Sung dialogue is italic and framed by music notes (see wrapMarks).
  { id: "song", group: "balloon", fonts: SPEECH,
    style: { size: 13, case: "none", bold: false, italic: true, color: INK, align: "center" },
    wrap_marks: ["♪ ", " ♫"] },
  // Foreign speech is bracketed in angle brackets, often italic.
  { id: "foreign", group: "balloon", fonts: SPEECH,
    style: { size: 13, case: "upper", bold: false, italic: true, color: INK, align: "center" },
    wrap_marks: ["<", ">"] },
  { id: "distress", group: "balloon", fonts: SMALL,
    style: { size: 10, case: "lower", bold: false, italic: true, color: QUIET, align: "center" } },
  // ---------------- outside: boxes, art, margins ----------------
  { id: "narration", group: "outside", fonts: NARRATION,
    style: { size: 12, case: "upper", bold: false, italic: false, color: INK, outline: false, align: "center", round: false } },
  // Internal-monologue captions have largely replaced thought balloons.
  { id: "monologue", group: "outside", fonts: NARRATION,
    style: { size: 12, case: "upper", bold: false, italic: true, color: INK, align: "center", round: false } },
  { id: "offpanel", group: "outside", fonts: SPEECH,
    style: { size: 13, case: "upper", bold: false, italic: false, color: INK, align: "center" } },
  { id: "aside", group: "outside", fonts: HAND,
    style: { size: 11, case: "none", bold: false, italic: true, color: INK, outline: false, align: "center" } },
  // Sound effects sit on the artwork, so they need a white halo.
  { id: "sfx", group: "outside", fonts: SFX,
    style: { size: 30, case: "upper", bold: true, italic: false, color: INK, outline: true, outline_w: 3, outline_color: "#ffffff", align: "center" } },
  // Text on signs/cans/screens; usually needs warping onto the surface.
  { id: "signage", group: "outside", fonts: NARRATION,
    style: { size: 11, case: "upper", bold: false, italic: false, color: INK, outline: true, outline_w: 2, outline_color: "#ffffff", align: "center" } },
  { id: "display", group: "outside", fonts: DISPLAY,
    style: { size: 26, case: "upper", bold: true, italic: false, color: INK, outline: false, align: "center" } },
  // Translator's note: small, left aligned, under the panel.
  { id: "tn", group: "outside", fonts: NARRATION,
    style: { size: 9, case: "none", bold: false, italic: false, color: INK, align: "left", valign: "top" } },
];

export let TEXT_TYPES = [...BUILTIN_TYPES];
let BY_ID = new Map(TEXT_TYPES.map((t) => [t.id, t]));

// Baseline look a user-defined type gets unless it carries its own style.
const CUSTOM_STYLE = { size: 13, case: "upper", bold: false, italic: false, color: INK, outline: false, align: "center", valign: "middle", round: true };

/** A safe, stable id from a label ('u_' prefix: never collides). */
export function normId(text) {
  let base = Array.from((text || "").toLowerCase()).map((c) => (isAlnum(c) ? c : "_")).join("");
  base = strip(base, "_") || "type";
  return "u_" + base;
}

/** Merge user-defined text types into the catalogue (idempotent). Returns the
 *  registered custom-type dicts (with final ids, full style) for persisting. */
export function registerCustom(entries) {
  TEXT_TYPES = [...BUILTIN_TYPES];
  const used = new Set(TEXT_TYPES.map((t) => t.id));
  const registered = [];
  for (const e of entries || []) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const label = strip(String(e.label || ""));
    let tid = strip(String(e.id || "")) || normId(label);
    if (!tid || !label) continue;
    while (used.has(tid)) tid += "_2";
    used.add(tid);
    let fonts = e.fonts;
    if (!Array.isArray(fonts)) fonts = e.font ? [e.font] : [];
    fonts = fonts.filter((f) => f).map((f) => String(f));
    if (!fonts.length) fonts = ["Arial"];
    const style = { ...CUSTOM_STYLE };
    if (e.style && typeof e.style === "object" && !Array.isArray(e.style)) Object.assign(style, e.style);
    const entry = { id: tid, group: String(e.group || "custom"), label, fonts, style, custom: true };
    TEXT_TYPES.push(entry);
    registered.push({ id: tid, label, font: fonts[0], fonts: [...fonts], style: { ...style }, group: entry.group });
  }
  BY_ID = new Map(TEXT_TYPES.map((t) => [t.id, t]));
  return registered;
}

export function isCustom(typeId) {
  const t = BY_ID.get(typeId);
  return !!(t && t.custom);
}

/** Display label for a custom type; null for built-ins (named via 'tt_<id>'). */
export function label(typeId) {
  const t = BY_ID.get(typeId);
  return t && t.custom ? t.label : null;
}

export function ids() {
  return TEXT_TYPES.map((t) => t.id);
}

export function get(typeId) {
  return BY_ID.get(typeId) || null;
}

let INDEX_CACHE = [null, null];

function index(installed) {
  const key = JSON.stringify(installed || []);
  if (INDEX_CACHE[0] !== key) INDEX_CACHE = [key, new FontIndex(installed || [])];
  return INDEX_CACHE[1];
}

/** First candidate that is actually installed (installed spelling), else the
 *  last candidate so a type always names something. */
export function resolveFont(candidates, installed) {
  const idx = index(installed);
  for (const fam of candidates) {
    const m = idx.resolve(fam);
    if (m !== null) return m.family;
  }
  return candidates.length ? candidates[candidates.length - 1] : "";
}

/** The face this type really wants, if it is not installed (null when the
 *  preferred font is present or the user picked their own). */
export function missingFont(typeId, installed, overrides = null) {
  if ((overrides || {})[typeId]) return null;
  const t = BY_ID.get(typeId);
  if (!t || !t.fonts.length) return null;
  if (index(installed).resolve(t.fonts[0]) !== null) return null;
  return resolveFont(t.fonts, installed) !== t.fonts[0] ? t.fonts[0] : null;
}

export function defaultFont(typeId, installed = []) {
  const t = BY_ID.get(typeId);
  return t ? resolveFont(t.fonts, installed) : "";
}

/** The font a type actually uses: the user's choice, else the default. */
export function effectiveFont(typeId, installed = [], overrides = null) {
  const own = (overrides || {})[typeId];
  if (own) return own;
  return defaultFont(typeId, installed);
}

/** Full style dict for a type (shaped like a TypeR preset). */
export function styleFor(typeId, installed = [], overrides = null) {
  const t = BY_ID.get(typeId);
  if (!t) return {};
  const style = { ...t.style };
  style.font = effectiveFont(typeId, installed, overrides);
  return style;
}

/** [prefix, suffix] a type frames its text with; ['', ''] otherwise. */
export function wrapMarks(typeId) {
  const t = BY_ID.get(typeId);
  return t ? [...(t.wrap_marks || ["", ""])] : ["", ""];
}
