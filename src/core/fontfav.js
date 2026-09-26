// Font favourites with categories (host-free core).
//
// Port of TypeR-Krita `typer_kr/fontfav.py`. Many-to-many: a font can sit in
// several categories and a category groups several fonts. JSON format v1:
//   {"version": 1, "categories": [...], "fonts": {family: [cats]}, "ui": {...}}
// — identical to the Krita version so exports are interchangeable.

import { strip, sortedBy, split as pySplit } from "./py.js";

export const VERSION = 1;
/** Sentinel category meaning "favourites without any category". */
export const UNCATEGORIZED = "\u0000__uncategorized__";

function norm(s) {
  return typeof s === "string" ? strip(s) : "";
}

/** Every whitespace token of `query` is a substring of `name` (ci). */
export function match(name, query) {
  const q = norm(query).toLowerCase();
  if (!q) return true;
  const low = (name || "").toLowerCase();
  return pySplit(q).every((tok) => low.includes(tok));
}

const ci = (f) => f.toLowerCase();

export class FavoritesStore {
  constructor() {
    this._categories = [];
    this._fonts = new Map();       // family -> ordered categories
    this._ui = {};
  }

  static fromJson(text) {
    const store = new FavoritesStore();
    if (!text) return store;
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return store;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return store;
    for (const cat of data.categories || []) store.addCategory(cat);
    const fonts = data.fonts || {};
    if (fonts && typeof fonts === "object" && !Array.isArray(fonts)) {
      for (const [fam0, cats0] of Object.entries(fonts)) {
        const fam = norm(fam0);
        if (!fam) continue;
        store.addFont(fam, Array.isArray(cats0) ? cats0 : []);
      }
    }
    const ui = data.ui;
    if (ui && typeof ui === "object" && !Array.isArray(ui)) store._ui = { ...ui };
    return store;
  }

  toJson() {
    const fonts = {};
    for (const [fam, cats] of this._fonts) fonts[fam] = [...cats];
    return JSON.stringify({ version: VERSION, categories: [...this._categories], fonts, ui: { ...this._ui } });
  }

  uiGet(key, dflt = null) {
    return key in this._ui ? this._ui[key] : dflt;
  }

  uiSet(key, value) {
    this._ui[key] = value;
  }

  categories() {
    return [...this._categories];
  }

  _findCategory(name) {
    const low = norm(name).toLowerCase();
    if (!low) return null;
    for (const c of this._categories) if (c.toLowerCase() === low) return c;
    return null;
  }

  addCategory(name) {
    name = norm(name);
    if (!name) return null;
    const existing = this._findCategory(name);
    if (existing) return existing;
    this._categories.push(name);
    return name;
  }

  renameCategory(oldName, newName) {
    const cur = this._findCategory(oldName);
    const nw = norm(newName);
    if (!cur || !nw) return null;
    const clash = this._findCategory(nw);
    if (clash && clash !== cur) {
      // merge: fold cur into the existing one
      this._categories = this._categories.filter((c) => c !== cur);
      for (const [fam, cats] of this._fonts) {
        this._fonts.set(fam, dedupKeepOrder(cats.map((c) => (c === cur ? clash : c))));
      }
      return clash;
    }
    this._categories = this._categories.map((c) => (c === cur ? nw : c));
    for (const [fam, cats] of this._fonts) this._fonts.set(fam, cats.map((c) => (c === cur ? nw : c)));
    return nw;
  }

  removeCategory(name) {
    const cur = this._findCategory(name);
    if (!cur) return false;
    this._categories = this._categories.filter((c) => c !== cur);
    for (const [fam, cats] of this._fonts) this._fonts.set(fam, cats.filter((c) => c !== cur));
    return true;
  }

  fonts() {
    return sortedBy([...this._fonts.keys()], ci);
  }

  isFavorite(family) {
    return typeof family === "string" ? this._fonts.has(norm(family)) : false;
  }

  addFont(family, categories = null) {
    family = norm(family);
    if (!family) return null;
    if (!this._fonts.has(family)) this._fonts.set(family, []);
    for (const cat of categories || []) {
      const canon = this.addCategory(cat);
      const list = this._fonts.get(family);
      if (canon && !list.includes(canon)) list.push(canon);
    }
    return family;
  }

  removeFont(family) {
    family = norm(family);
    return this._fonts.delete(family);
  }

  fontCategories(family) {
    return [...(this._fonts.get(norm(family)) || [])];
  }

  setFontCategories(family, categories) {
    family = norm(family);
    if (!family) return null;
    this._fonts.set(family, []);
    for (const cat of categories || []) {
      const canon = this.addCategory(cat);
      const list = this._fonts.get(family);
      if (canon && !list.includes(canon)) list.push(canon);
    }
    return family;
  }

  toggle(family, category) {
    family = norm(family);
    if (!family) return false;
    const canon = this.addCategory(category);
    if (!canon) return false;
    if (!this._fonts.has(family)) this._fonts.set(family, []);
    const list = this._fonts.get(family);
    if (list.includes(canon)) {
      this._fonts.set(family, list.filter((c) => c !== canon));
      return false;
    }
    list.push(canon);
    return true;
  }

  fontsInCategory(category = null, search = "") {
    let pool;
    if (category === UNCATEGORIZED) {
      pool = [...this._fonts.keys()].filter((f) => !this._fonts.get(f).length);
    } else if (!category) {
      pool = [...this._fonts.keys()];
    } else {
      const canon = this._findCategory(category);
      if (!canon) return [];
      pool = [...this._fonts.keys()].filter((f) => this._fonts.get(f).includes(canon));
    }
    pool = pool.filter((f) => match(f, search));
    return sortedBy(pool, ci);
  }

  missingFonts(installed, resolve = null) {
    if (resolve) return sortedBy([...this._fonts.keys()].filter((f) => !resolve(f)), ci);
    const inst = new Set((installed || []).map((f) => (f || "").toLowerCase()));
    return sortedBy([...this._fonts.keys()].filter((f) => !inst.has(f.toLowerCase())), ci);
  }

  merge(other) {
    if (!other) return 0;
    const before = new Set(this._fonts.keys());
    for (const c of other.categories()) this.addCategory(c);
    for (const fam of other.fonts()) this.addFont(fam, other.fontCategories(fam));
    let n = 0;
    for (const f of this._fonts.keys()) if (!before.has(f)) n += 1;
    return n;
  }

  categoryCounts() {
    const counts = {};
    for (const c of this._categories) counts[c] = 0;
    for (const cats of this._fonts.values()) {
      for (const c of cats) if (c in counts) counts[c] += 1;
    }
    return counts;
  }
}

function dedupKeepOrder(seq) {
  const seen = new Set();
  const out = [];
  for (const x of seq) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
