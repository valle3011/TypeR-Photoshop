// UI strings: the Krita plugin's LANG table 1:1 (src/i18n/lang.json), the SFX
// Helper's table (sfx_lang.json), and the Photoshop rewording on top
// (ps_overrides.json). Same fallback rule as the original: a key missing in
// the current language falls back to English, then to the key itself.

import LANG from "../i18n/lang.json" with { type: "json" };
import SFX_LANG from "../i18n/sfx_lang.json" with { type: "json" };
import OVR from "../i18n/ps_overrides.json" with { type: "json" };
import { format } from "../core/py.js";

export const LANG_ORDER = LANG.order;          // [[code, name], …]
export const SFX_LANG_ORDER = SFX_LANG.order;

// Strings the Photoshop port adds (no Krita equivalent). English + German;
// the other languages fall back to English like everywhere else.
const PS_EXTRA = {
  en: {
    st_font_missing_ps: "Photoshop does not know the font “{font}”.",
    st_no_faces: "The font file of “{font}” was not found; measuring it once in Photoshop…",
    diag_title: "Diagnostics",
    diag_hint: "Checks the parts that only Photoshop can answer: the font measuring against real text layers (≤ 1 % error), the Imaging API, the layer styles.",
    diag_run: "Run self-test",
    diag_fonts: "Fonts to check (comma separated):",
    diag_running: "Running… (a probe layer is created and rolled back each time)",
    diag_ok: "OK",
    diag_fail: "FAIL",
    diag_imaging: "Imaging API (selection masks, pixels): {state}",
    diag_version: "Photoshop {ver} · UXP {uxp}",
    diag_calibrate: "Calibrate current font",
    diag_calibrated: "Calibrated “{font}”: width ×{w}, size ×{s}.",
    diag_need_doc: "Open a document first (the probe needs one).",
    panel_diagnostics: "Diagnostics",
    fonts_install_hint: "Photoshop cannot install fonts from a plugin. The folder with the bundled fonts is open now: install them (right-click → Install / double-click on macOS), then restart Photoshop.",
    g_paste_title: "Finish Google sign-in",
    g_paste_prompt: "After allowing access, the browser shows an address starting with http://127.0.0.1 that does not load. Copy that whole address and paste it here:",
    g_paste_bad: "That address carries no sign-in code.",
    bp_bridge_missing: "The BubblR bridge is not running (tools/bubblr_bridge.py). Start it, then try again.",
    keys_focus_hint: "Keys work while the TypeR panel has the focus.",
    color_hex_title: "Colour",
    color_hex_prompt: "Hex colour (#rrggbb):",
    measuring: "Measuring the font…",
    index_progress: "Reading the installed fonts… {done} / {total}",
    panel_lock_tip: "Pin the panel so it cannot be dragged in customize mode",
    g_downloads_label: "Downloads folder (only if it was moved):",
    g_downloads_ph: "e.g. D:\\Downloads — empty = the usual one",
    fav_title: "Font favourites",
    fav_intro: "Star fonts and sort them into categories (Dialog, SFX, …). A font can be in several categories. Filter by category or search by name, then double-click to use it.",
    fav_all: "All favourites",
    fav_uncat: "(no category)",
    fav_search_ph: "Search font…",
    fav_add_current: "★ Add current font",
    fav_add: "Add font…",
    fav_edit_cats: "Categories…",
    fav_remove: "Remove",
    fav_manage: "Manage categories…",
    fav_apply: "Use font",
    fav_none: "No favourites yet. Add one with “★ Add current font”.",
    fav_pick_font: "Add a favourite font",
    fav_choose_cats: "Categories for this font:",
    fav_new_cat_ph: "New category…",
    fav_new_cat_add: "Add",
    fav_manage_title: "Manage categories",
    fav_rename: "Rename",
    fav_delete: "Delete",
    fav_delete_font_q: "Remove “{name}” from favourites?",
    fav_count: "{n} fonts",
    fav_ctx_edit: "Edit categories…",
    fav_ctx_delete: "Delete…",
    fav_size: "Aa",
    fav_size_tip: "Preview size — drag to see the fonts bigger.",
    fav_import: "Import…",
    fav_export: "Export…",
    fav_import_done: "Imported {n} new favourite fonts.",
    fav_export_done: "Exported {n} favourites with {fonts} font files ({missing} not found on this PC).",
    fav_import_bundle_done: "Imported {n} favourites.\nFonts: {skip} copied into the folder that is open now — install them from there, then restart Photoshop. {fail} failed.",
    fav_io_error: "Could not read/write the file:\n{err}",
    fav_missing_title: "Missing fonts",
    fav_missing_intro: "These favourite fonts are not installed on this computer. Install/download them so your text renders with the intended font:",
    fav_missing_none: "All favourite fonts are installed. ✓",
    fonts_install_title: "Install fonts",
    patgen_title: "Make a pattern",
    patgen_kind: "Pattern:",
    patgen_fg: "Ink colour",
    patgen_bg: "Background",
    patgen_transparent: "Transparent background",
    patgen_size: "Size",
    patgen_gap: "Gap",
    patgen_hstripes: "Horizontal stripes",
    patgen_vstripes: "Vertical stripes",
    patgen_checker: "Checkerboard",
    patgen_dots: "Dots (screentone)",
    patgen_grid: "Grid",
    patgen_crosshatch: "Cross-hatch",
    patgen_diagonal: "Diagonal lines",
    patgen_noise: "Sand / noise (grain)",
    patgen_sparkle: "Sparkles (stars)",
    yes: "Yes",
    no: "No",
    ok: "OK",
    cancel: "Cancel",
  },
  de: {
    st_font_missing_ps: "Photoshop kennt die Schrift „{font}“ nicht.",
    st_no_faces: "Die Schriftdatei von „{font}“ wurde nicht gefunden; sie wird einmal in Photoshop vermessen…",
    diag_title: "Diagnose",
    diag_hint: "Prüft, was nur Photoshop beantworten kann: die Schriftvermessung gegen echte Textebenen (≤ 1 % Abweichung), die Imaging-API, die Ebenenstile.",
    diag_run: "Selbsttest starten",
    diag_fonts: "Zu prüfende Schriften (durch Komma getrennt):",
    diag_running: "Läuft… (jedes Mal wird eine Probeebene angelegt und zurückgenommen)",
    diag_ok: "OK",
    diag_fail: "FEHLER",
    diag_imaging: "Imaging-API (Auswahlmasken, Pixel): {state}",
    diag_version: "Photoshop {ver} · UXP {uxp}",
    diag_calibrate: "Aktuelle Schrift kalibrieren",
    diag_calibrated: "„{font}“ kalibriert: Breite ×{w}, Größe ×{s}.",
    diag_need_doc: "Zuerst ein Dokument öffnen (die Probe braucht eins).",
    panel_diagnostics: "Diagnose",
    fonts_install_hint: "Photoshop kann aus einem Plugin keine Schriften installieren. Der Ordner mit den mitgelieferten Schriften ist jetzt geöffnet: installieren (Rechtsklick → Installieren / unter macOS Doppelklick), dann Photoshop neu starten.",
    g_paste_title: "Google-Anmeldung abschließen",
    g_paste_prompt: "Nach dem Erlauben zeigt der Browser eine Adresse, die mit http://127.0.0.1 beginnt und nicht lädt. Diese ganze Adresse kopieren und hier einfügen:",
    g_paste_bad: "In dieser Adresse steckt kein Anmeldecode.",
    bp_bridge_missing: "Die BubblR-Brücke läuft nicht (tools/bubblr_bridge.py). Starten, dann erneut versuchen.",
    keys_focus_hint: "Tasten wirken, solange das TypeR-Panel den Fokus hat.",
    color_hex_title: "Farbe",
    color_hex_prompt: "Hex-Farbe (#rrggbb):",
    measuring: "Schrift wird vermessen…",
    index_progress: "Installierte Schriften werden gelesen… {done} / {total}",
    panel_lock_tip: "Panel anheften, damit es sich im Anpassen-Modus nicht ziehen lässt",
    g_downloads_label: "Download-Ordner (nur falls verschoben):",
    g_downloads_ph: "z. B. D:\\Downloads — leer = der übliche",
    fav_title: "Schrift-Favoriten",
    fav_intro: "Schriften markieren und in Kategorien sortieren (Dialog, SFX, …). Eine Schrift kann in mehreren Kategorien sein. Nach Kategorie filtern oder nach Namen suchen, dann doppelklicken, um sie zu verwenden.",
    fav_all: "Alle Favoriten",
    fav_uncat: "(ohne Kategorie)",
    fav_search_ph: "Schrift suchen…",
    fav_add_current: "★ Aktuelle Schrift hinzufügen",
    fav_add: "Schrift hinzufügen…",
    fav_edit_cats: "Kategorien…",
    fav_remove: "Entfernen",
    fav_manage: "Kategorien verwalten…",
    fav_apply: "Schrift verwenden",
    fav_none: "Noch keine Favoriten. Mit „★ Aktuelle Schrift hinzufügen“ einen anlegen.",
    fav_pick_font: "Favoritenschrift hinzufügen",
    fav_choose_cats: "Kategorien für diese Schrift:",
    fav_new_cat_ph: "Neue Kategorie…",
    fav_new_cat_add: "Hinzufügen",
    fav_manage_title: "Kategorien verwalten",
    fav_rename: "Umbenennen",
    fav_delete: "Löschen",
    fav_delete_font_q: "„{name}“ aus den Favoriten entfernen?",
    fav_count: "{n} Schriften",
    fav_ctx_edit: "Kategorien bearbeiten…",
    fav_ctx_delete: "Löschen…",
    fav_size: "Aa",
    fav_size_tip: "Vorschaugröße – ziehen, um die Schriften größer zu sehen.",
    fav_import: "Importieren…",
    fav_export: "Exportieren…",
    fav_import_done: "{n} neue Favoritenschriften importiert.",
    fav_export_done: "{n} Favoriten mit {fonts} Schriftdateien exportiert ({missing} auf diesem PC nicht gefunden).",
    fav_import_bundle_done: "{n} Favoriten importiert.\nSchriften: {skip} in den jetzt geöffneten Ordner kopiert – dort installieren, dann Photoshop neu starten. {fail} fehlgeschlagen.",
    fav_io_error: "Die Datei konnte nicht gelesen/geschrieben werden:\n{err}",
    fav_missing_title: "Fehlende Schriften",
    fav_missing_intro: "Diese Favoritenschriften sind auf diesem Computer nicht installiert. Installieren/herunterladen, damit der Text mit der gewünschten Schrift erscheint:",
    fav_missing_none: "Alle Favoritenschriften sind installiert. ✓",
    fonts_install_title: "Schriften installieren",
    patgen_title: "Muster erstellen",
    patgen_kind: "Muster:",
    patgen_fg: "Tintenfarbe",
    patgen_bg: "Hintergrund",
    patgen_transparent: "Transparenter Hintergrund",
    patgen_size: "Größe",
    patgen_gap: "Abstand",
    patgen_hstripes: "Waagerechte Streifen",
    patgen_vstripes: "Senkrechte Streifen",
    patgen_checker: "Schachbrett",
    patgen_dots: "Punkte (Rasterfolie)",
    patgen_grid: "Gitter",
    patgen_crosshatch: "Kreuzschraffur",
    patgen_diagonal: "Diagonale Linien",
    patgen_noise: "Sand / Rauschen (Körnung)",
    patgen_sparkle: "Funkeln (Sterne)",
    yes: "Ja",
    no: "Nein",
    ok: "OK",
    cancel: "Abbrechen",
  },
};

let current = "en";

export function setLang(code) {
  current = LANG.lang[code] ? code : "en";
}

export function lang() {
  return current;
}

function lookup(tables, key) {
  for (const t of tables) {
    if (t && Object.prototype.hasOwnProperty.call(t, key)) return t[key];
  }
  return undefined;
}

/** TypeR string for `key` in the current language (fallback English). */
export function tr(key, fmtArgs = null) {
  const o = (OVR.typer || {});
  const s = lookup([
    (o[current] || {}), PS_EXTRA[current], LANG.lang[current],
    (o.en || {}), PS_EXTRA.en, LANG.lang.en,
  ], key);
  const v = s === undefined ? key : s;
  return fmtArgs ? format(v, fmtArgs) : v;
}

/** SFX Helper string (its own table, its own fallback to English). */
export function trSfx(key, fmtArgs = null, code = null) {
  const c = code || current;
  const o = (OVR.sfx || {});
  const s = lookup([(o[c] || {}), SFX_LANG.lang[c], (o.en || {}), SFX_LANG.lang.en], key);
  const v = s === undefined ? key : s;
  return fmtArgs ? format(v, fmtArgs) : v;
}

export function hasKey(key) {
  return lookup([LANG.lang.en, PS_EXTRA.en, (OVR.typer || {}).en], key) !== undefined;
}

export const LANGS = LANG.lang;
