// The Fonts tab: starred fonts sorted into categories.
//
// Port of TypeR-Krita `fontfav_ui.py` (FontFavoritesPanel, _FontChooserDialog,
// _CategoryDialog, _ManageCategoriesDialog). Every row shows the family's
// name IN its own face; faces render progressively off the first paint
// (small batches on a timer, cache capped at 400) so the tab opens at once.

import JSZip from "jszip";
import { h, clear, show, row, hint, Button, Check, Select, TextField, alertBox, confirmBox, promptBox, dialog, popupMenu } from "./dom.js";
import { dark } from "./widgets.js";
import { T } from "../host/settings.js";
import { stylesFaces } from "../host/measure.js";
import { families as psFamilies, collectFiles } from "../host/fonts.js";
import { pickOpen, pickSave, readBytes } from "../host/files.js";
import { FavoritesStore, UNCATEGORIZED } from "../core/fontfav.js";
import { FontIndex } from "../core/fontmatch.js";
import { renderFaceSample } from "../core/preview.js";
import { pngDataUrl } from "../core/png.js";
import { fontZipNames } from "../core/fontfiles.js";
import { decodeBytes } from "../core/readers.js";

const FACE_CACHE_MAX = 400;

export class FontFavoritesPanel {
  constructor(app) {
    this.app = app;
    this._store = FavoritesStore.fromJson(this._load());
    this._faces = new Map();              // family -> data URL | false
    this._pending = [];
    this._timer = null;
    const px = Math.trunc(Number(this._store.uiGet("face_px", 16)));
    this._face_px = Number.isFinite(px) ? Math.max(10, Math.min(64, px)) : 16;
    this._sel = null;
    this.el = h("div", { class: "fonts-tab" });
    this._build();
    this._reload_categories();
    this._restore_filter();
    this._refresh_list();
  }

  t(key, fmt = null) {
    return this.app._tr(key, fmt);
  }

  _load() {
    const v = T.get("fontFavorites", "");
    return typeof v === "string" ? v : JSON.stringify(v || {});
  }

  _persist() {
    T.set("fontFavorites", this._store.toJson());
  }

  _build() {
    const t = (k, f) => this.t(k, f);
    this.intro = hint();
    this.cat_combo = Select([], { onChange: () => this._on_filter_changed() });
    this.search = TextField({ onChange: () => this._on_filter_changed() });
    this.size_lbl = h("span", { class: "lbl" });
    this.size_slider = h("input", { type: "range", min: "10", max: "64", value: String(this._face_px), class: "grow" });
    this.size_slider.addEventListener("change", () => this._on_face_size_changed(Number(this.size_slider.value)));
    this.list = h("div", { class: "fav-list", tabindex: "0" });
    this.list.addEventListener("keydown", (e) => {
      const rows = Array.from(this.list.children);
      const i = rows.findIndex((r) => r._fam === this._sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        if (rows[j]) this._select(rows[j]._fam);
      } else if (e.key === "Enter" && this._sel) {
        this._use(this._sel);
      }
    });
    this.count_lbl = h("div", { class: "muted small" });
    this.apply_btn = Button("", { onClick: () => this._sel && this._use(this._sel) });
    this.add_cur_btn = Button("", { onClick: () => this._add_current_font() });
    this.add_btn = Button("", { onClick: () => this._add_font_dialog() });
    this.edit_btn = Button("", { onClick: () => this._edit_categories() });
    this.remove_btn = Button("", { onClick: () => this._remove_current() });
    this.manage_btn = Button("", { onClick: () => this._manage_categories() });
    this.import_btn = Button("", { onClick: () => this._import_favorites() });
    this.export_btn = Button("", { onClick: () => this._export_favorites() });
    this.el.append(this.intro, row(this.cat_combo, this.search), row(this.size_lbl, this.size_slider), this.list, this.count_lbl,
      row(this.apply_btn, this.add_cur_btn), row(this.add_btn, this.edit_btn, this.remove_btn), this.manage_btn,
      row(this.import_btn, this.export_btn));
    this.app._rt(() => {
      this.intro.textContent = t("fav_intro");
      this.search.setPlaceholder(t("fav_search_ph"));
      this.size_lbl.textContent = t("fav_size");
      this.size_slider.title = t("fav_size_tip");
      this.apply_btn.setText(t("fav_apply"));
      this.add_cur_btn.setText(t("fav_add_current"));
      this.add_btn.setText(t("fav_add"));
      this.edit_btn.setText(t("fav_edit_cats"));
      this.remove_btn.setText(t("fav_remove"));
      this.manage_btn.setText(t("fav_manage"));
      this.import_btn.setText(t("fav_import"));
      this.export_btn.setText(t("fav_export"));
      this._reload_categories();
      this._refresh_list();
    });
  }

  _selected_category() {
    return this.cat_combo.value();
  }

  _reload_categories() {
    const keep = this._selected_category();
    const counts = this._store.categoryCounts();
    this.cat_combo.setItems([
      { label: this.t("fav_all"), value: null },
      ...this._store.categories().map((c) => ({ label: `${c} (${counts[c] || 0})`, value: c })),
      { label: this.t("fav_uncat"), value: UNCATEGORIZED },
    ], false);
    if (!this.cat_combo.setValue(keep === undefined ? null : keep)) this.cat_combo.setIndex(0);
  }

  _on_filter_changed() {
    this._refresh_list();
    this._store.uiSet("last_category", this._selected_category() ?? null);
    this._store.uiSet("last_search", this.search.text());
    this._persist();
  }

  _restore_filter() {
    const cat = this._store.uiGet("last_category", null);
    if (!this.cat_combo.setValue(cat)) this.cat_combo.setIndex(0);
    this.search.setText(this._store.uiGet("last_search", "") || "");
  }

  category_names() {
    return this._store.categories();
  }

  _refresh_list() {
    const fams = this._store.fontsInCategory(this._selected_category() ?? null, this.search.text());
    clear(this.list);
    for (const fam of fams) {
      const cats = this._store.fontCategories(fam);
      const img = h("img", { class: "fav-face" });
      const name = h("span", { class: "fav-name", text: fam });
      const catLbl = h("span", { class: "fav-cats", text: cats.length ? "· " + cats.join(", ") : "" });
      const r = h("div", { class: "fav-row", style: { minHeight: `${this._face_px + 12}px` } }, img, name, catLbl);
      r._fam = fam;
      r._img = img;
      r._name = name;
      r.addEventListener("click", () => this._select(fam));
      r.addEventListener("dblclick", () => this._use(fam));
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._select(fam);
        popupMenu(e, [
          { label: this.t("fav_ctx_edit"), onClick: () => this._edit_categories() },
          { separator: true },
          { label: this.t("fav_ctx_delete"), onClick: () => this._remove_current() },
        ]);
      });
      this._paint_face(r);
      this.list.appendChild(r);
    }
    if (fams.length) {
      this._select(fams.includes(this._sel) ? this._sel : fams[0]);
      this.count_lbl.textContent = this.t("fav_count", { n: fams.length });
    } else {
      this._sel = null;
      this.count_lbl.textContent = this.t("fav_none");
    }
    for (const b of [this.apply_btn, this.edit_btn, this.remove_btn]) b.setEnabled(fams.length > 0);
    this._prewarm(fams);
  }

  _select(fam) {
    this._sel = fam;
    for (const r of this.list.children) {
      r.classList.toggle("selected", r._fam === fam);
      if (r._fam === fam) {
        const top = r.offsetTop;
        if (top < this.list.scrollTop || top + r.offsetHeight > this.list.scrollTop + this.list.clientHeight) {
          this.list.scrollTop = Math.max(0, top - this.list.clientHeight / 3);
        }
      }
    }
  }

  // -- progressive face rendering --------------------------------------------------

  _paint_face(r) {
    const url = this._faces.get(r._fam);
    if (url) {
      r._img.src = url;
      show(r._img, true);
      show(r._name, false);
    } else {
      show(r._img, false);
      show(r._name, true);
    }
  }

  _prewarm(fams) {
    let budget = FACE_CACHE_MAX - (this._faces.size + this._pending.length);
    for (const f of fams) {
      if (budget <= 0) break;
      if (f && !this._faces.has(f) && !this._pending.includes(f)) {
        this._pending.push(f);
        budget -= 1;
      }
    }
    if (this._pending.length && !this._timer) this._timer = setTimeout(() => this._render_step(), 5);
  }

  async _render_step() {
    this._timer = null;
    const batch = this._pending.splice(0, 8);
    for (const fam of batch) {
      if (this._faces.has(fam)) continue;
      this._faces.set(fam, await this._make_face(fam));
    }
    // bounded cache: the oldest-rendered faces go first
    while (this._faces.size > FACE_CACHE_MAX) this._faces.delete(this._faces.keys().next().value);
    for (const r of this.list.children) if (batch.includes(r._fam)) this._paint_face(r);
    if (this._pending.length) this._timer = setTimeout(() => this._render_step(), 5);
  }

  async _make_face(fam) {
    try {
      const faces = await stylesFaces(fam, false, false);
      if (!faces || !faces.regular) return false;
      const px = this._face_px;
      const w = Math.min(1600, Math.max(40, Math.ceil(px * 0.62 * fam.length) + 12));
      const hh = px + 8;
      const rgba = renderFaceSample(faces.regular, fam, w, hh, dark() ? "#e6e6e6" : "#1a1a1a", px);
      return pngDataUrl(rgba, w, hh);
    } catch (e) {
      return false;
    }
  }

  _on_face_size_changed(v) {
    this._face_px = Math.trunc(v);
    this._faces.clear();
    this._pending = [];
    this._store.uiSet("face_px", this._face_px);
    this._persist();
    this._refresh_list();
  }

  // -- actions ---------------------------------------------------------------------------

  _use(fam) {
    try {
      this.app._apply_favorite_font(fam);
    } catch (e) {
      // the picker may be busy
    }
  }

  async _ask_font() {
    const fams = psFamilies();
    if (!fams.length) return null;
    let chosen = null;
    const ok = await dialog(this.t("fav_pick_font"), (body, close) => {
      const search = TextField({ placeholder: this.t("fav_search_ph") });
      const list = h("div", { class: "fav-list tall" });
      const fill = () => {
        clear(list);
        const toks = search.text().toLowerCase().split(/\s+/).filter((x) => x);
        const hits = fams.filter((f) => toks.every((tk) => f.toLowerCase().includes(tk))).slice(0, 300);
        for (const f of hits) {
          const r = h("div", { class: "fav-row" + (f === chosen ? " selected" : ""), text: f });
          r.addEventListener("click", () => {
            chosen = f;
            for (const c of list.children) c.classList.toggle("selected", c === r);
          });
          r.addEventListener("dblclick", () => {
            chosen = f;
            close(true);
          });
          list.appendChild(r);
        }
        if (hits.length && !hits.includes(chosen)) {
          chosen = hits[0];
          list.children[0].classList.add("selected");
        }
      };
      search.addEventListener("input", fill);
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && chosen) close(true);
      });
      body.append(search, list);
      fill();
    }, [{ label: this.t("cancel"), value: false }, { label: this.t("ok"), value: true, variant: "cta" }], { width: 360, height: 440 });
    return ok ? chosen : null;
  }

  async _add_current_font() {
    let fam = this.app.font_picker ? this.app.font_picker.currentFamily() : "";
    if (!fam) fam = await this._ask_font();
    if (!fam) return;
    this._store.addFont(fam);
    this._persist();
    this._reload_categories();
    this._sel = fam;
    this._refresh_list();
    this._select(fam);
    await this._edit_categories();
  }

  async _add_font_dialog() {
    const fam = await this._ask_font();
    if (!fam) return;
    this._store.addFont(fam);
    this._persist();
    this._reload_categories();
    this._sel = fam;
    this._refresh_list();
    this._select(fam);
    await this._edit_categories();
  }

  async _remove_current() {
    const fam = this._sel;
    if (!fam) return;
    if (!(await confirmBox(this.t("fav_remove"), this.t("fav_delete_font_q", { name: fam }), this.t("yes"), this.t("no")))) return;
    this._store.removeFont(fam);
    this._persist();
    this._reload_categories();
    this._refresh_list();
  }

  async _edit_categories() {
    const fam = this._sel;
    if (!fam) return;
    const checks = new Map();
    const selLow = new Set(this._store.fontCategories(fam).map((c) => c.toLowerCase()));
    const ok = await dialog(fam, (body) => {
      const box = h("div", { class: "scroll-list" });
      for (const c of this._store.categories()) {
        const cb = Check(c, { checked: selLow.has(c.toLowerCase()) });
        checks.set(c, cb);
        box.appendChild(cb);
      }
      const nw = TextField({ placeholder: this.t("fav_new_cat_ph") });
      const addNew = () => {
        const name = nw.text().trim();
        nw.setText("");
        if (!name || checks.has(name)) return;
        const cb = Check(name, { checked: true });
        checks.set(name, cb);
        box.appendChild(cb);
      };
      nw.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addNew();
      });
      body.append(h("div", { class: "lbl", text: this.t("fav_choose_cats") }), box, row(nw, Button(this.t("fav_new_cat_add"), { onClick: addNew })));
    }, [{ label: this.t("cancel"), value: false }, { label: this.t("ok"), value: true, variant: "cta" }], { width: 300, height: 360 });
    if (!ok) return;
    this._store.setFontCategories(fam, [...checks.entries()].filter(([, cb]) => cb.isChecked()).map(([c]) => c));
    this._persist();
    this._reload_categories();
    this._refresh_list();
    this._select(fam);
  }

  async _manage_categories() {
    await dialog(this.t("fav_manage_title"), (body) => {
      const list = h("div", { class: "scroll-list" });
      let cur = null;
      const reload = () => {
        clear(list);
        const counts = this._store.categoryCounts();
        for (const c of this._store.categories()) {
          const r = h("div", { class: "fav-row" + (c === cur ? " selected" : ""), text: `${c} (${counts[c] || 0})` });
          r.addEventListener("click", () => {
            cur = c;
            for (const x of list.children) x.classList.toggle("selected", x === r);
          });
          list.appendChild(r);
        }
      };
      const nw = TextField({ placeholder: this.t("fav_new_cat_ph") });
      const add = () => {
        const name = nw.text().trim();
        if (name) {
          this._store.addCategory(name);
          nw.setText("");
          reload();
        }
      };
      nw.addEventListener("keydown", (e) => {
        if (e.key === "Enter") add();
      });
      const ren = Button(this.t("fav_rename"), {
        onClick: async () => {
          if (!cur) return;
          const n = await promptBox(this.t("fav_rename"), this.t("fav_rename"), cur);
          if (n && n.trim()) {
            this._store.renameCategory(cur, n.trim());
            cur = n.trim();
            reload();
          }
        },
      });
      const del = Button(this.t("fav_delete"), {
        onClick: () => {
          if (!cur) return;
          this._store.removeCategory(cur);
          cur = null;
          reload();
        },
      });
      body.append(list, row(nw, Button(this.t("fav_new_cat_add"), { onClick: add })), row(ren, del));
      reload();
    }, [{ label: this.t("close"), value: true, variant: "cta" }], { width: 320, height: 400 });
    this._persist();
    this._reload_categories();
    this._refresh_list();
  }

  // -- import / export ------------------------------------------------------------------

  async _export_favorites() {
    const fams = this._store.fonts();
    this.app._set_status(this.t("font_scan"));
    let files = {};
    try {
      [files] = await collectFiles(fams);
    } catch (e) {
      files = {};
    }
    this.app._set_status("");
    const zip = new JSZip();
    zip.file("favourites.json", this._store.toJson());
    let nFiles = 0;
    for (const [src, name] of fontZipNames(files)) {
      try {
        zip.file(name, await readBytes(src));
        nFiles += 1;
      } catch (e) {
        // unreadable: skipped
      }
    }
    let path;
    try {
      path = await pickSave("font-favourites.zip", ["zip"], await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    } catch (e) {
      await alertBox(this.t("fav_export"), this.t("fav_io_error", { err: e.message || e }), this.t("ok"));
      return;
    }
    if (!path) return;
    const missing = fams.filter((f) => !(f in files));
    await alertBox(this.t("fav_export"), this.t("fav_export_done", { n: fams.length, fonts: nFiles, missing: missing.length }), this.t("ok"));
  }

  _resolver() {
    const idx = new FontIndex(psFamilies());
    return (n) => idx.isAvailable(n);
  }

  async _import_favorites() {
    const f = await pickOpen(["zip", "json"]);
    if (!f) return;
    let incoming = new FavoritesStore();
    const fonts = [];
    const isZip = f.bytes[0] === 0x50 && f.bytes[1] === 0x4b;
    try {
      if (isZip) {
        const zip = await JSZip.loadAsync(f.bytes);
        const names = Object.keys(zip.files);
        if (names.includes("favourites.json")) incoming = FavoritesStore.fromJson(await zip.file("favourites.json").async("string"));
        for (const n of names) {
          if (n.startsWith("fonts/") && !n.endsWith("/")) fonts.push({ name: n.split("/").pop(), bytes: await zip.file(n).async("uint8array") });
        }
      } else {
        incoming = FavoritesStore.fromJson(decodeBytes(f.bytes));
      }
    } catch (e) {
      await alertBox(this.t("fav_import"), this.t("fav_io_error", { err: e.message || e }), this.t("ok"));
      return;
    }
    const n = this._store.merge(incoming);
    let res = { installed: [], skipped: [], failed: [] };
    if (fonts.length) res = await this.app._install_fonts_and_refresh(fonts);
    this._persist();
    this._reload_categories();
    this._restore_filter();
    this._refresh_list();
    if (isZip) {
      await alertBox(this.t("fav_import"), this.t("fav_import_bundle_done", {
        n, inst: res.installed.length, skip: res.skipped.length, fail: res.failed.length,
      }), this.t("ok"));
    } else {
      await alertBox(this.t("fav_import"), this.t("fav_import_done", { n }), this.t("ok"));
    }
    if (!fonts.length) {
      const missing = incoming.missingFonts(psFamilies(), this._resolver());
      if (missing.length) await this._warn_missing(missing);
    }
  }

  async _warn_missing(missing) {
    await alertBox(this.t("fav_missing_title"), this.t("fav_missing_intro") + "\n\n• " + missing.join("\n• "), this.t("ok"));
  }

  async show_missing_fonts_dialog() {
    const missing = this._store.missingFonts(psFamilies(), this._resolver());
    if (missing.length) await this._warn_missing(missing);
    else await alertBox(this.t("fav_missing_title"), this.t("fav_missing_none"), this.t("ok"));
    return missing;
  }

  add_favorite(fam, categories = null) {
    if (!fam) return;
    this._store.addFont(fam, categories || []);
    this._persist();
    this._reload_categories();
    this._refresh_list();
  }

  favorite_fonts() {
    return this._store.fonts();
  }
}

/** The TypeR-side glue methods (ports of _apply_favorite_font, _star_font,
 *  _font_context_menu, _favorite_fonts, _sfx_fonts). */
export const FontsMethods = {
  _build_fonts_tab() {
    const pb = this._new_panel("fonts_panel", "fonts");
    try {
      this.fonts_panel = new FontFavoritesPanel(this);
      pb.body.appendChild(this.fonts_panel.el);
    } catch (e) {
      this.fonts_panel = null;
      pb.body.appendChild(hint("Font favourites could not load:\n" + (e && e.message ? e.message : e)));
    }
  },

  _apply_favorite_font(fam) {
    if (!fam) return;
    try {
      this.font_picker.setCurrentFamily(fam);
    } catch (e) {
      // picker busy
    }
    this._set_status(this._tr("st_font_applied", { name: fam }));
  },

  _star_current_font() {
    this._star_font(this.font_picker.currentFamily());
  },

  _star_font(fam, category = null) {
    if (!fam || !this.fonts_panel) return;
    this.fonts_panel.add_favorite(fam, category ? [category] : null);
    this._set_status(this._tr("st_font_starred", { name: fam }));
  },

  _font_context_menu(fam, e) {
    if (!fam) return;
    const items = [{ label: this._tr("fav_star_current"), onClick: () => this._star_font(fam) }];
    const cats = this.fonts_panel ? this.fonts_panel.category_names() : [];
    if (cats.length) {
      items.push({ separator: true });
      for (const c of cats) items.push({ label: "→ " + c, onClick: () => this._star_font(fam, c) });
    }
    popupMenu(e, items);
  },

  _favorite_fonts() {
    return this.fonts_panel ? this.fonts_panel.favorite_fonts() : [];
  },

  _sfx_fonts() {
    return this.sfx_panel ? this.sfx_panel.referenced_fonts() : [];
  },
};
