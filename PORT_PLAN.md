# PORT_PLAN — TypeR for Krita → TypeR for Photoshop (UXP)

The Krita plugin (`../TypeR-Krita`) is the specification. Where this plan and
the Krita code disagree, the code wins. This file is the progress record: every
feature of `README.md`, `FEATURES.md` and the `LANG` table has a row, and the
port is finished when no row says **offen**.

Status values: **offen** (not started) · **portiert** (code exists) ·
**getestet** (covered by an automated test — `tests/`) · **PS-Test** (code
exists and runs against the mock host in `tests/ui_smoke.test.js`, but what
Photoshop *renders* can only be confirmed inside Photoshop — see
`tests/PS_CHECKLIST.md`).

Test run (2026-09-26): **12 test files, 59 tests, all green** —
`node "%LOCALAPPDATA%\typer-ps-dev\node_modules\vitest\vitest.mjs" run`.
Build: `node tools/build.mjs --ccx` → `dist/plugin/` + `dist/TypeR-2.0.0.ccx`.

Out of scope: `typer_lab/` and `typer_hybrid/` are separate experimental
Krita plugins (FEATURES.md: "Not part of TypeR"), and the Krita installer
scripts (`INSTALL.bat`, `install.sh`, …) are replaced by the `.ccx`.

---

## 1. Architecture decisions

| Topic | Decision | Why |
|---|---|---|
| Plugin type | UXP, manifest v5, `host.minVersion` 24.0 (Photoshop 2023), apiVersion 2 | CEP is deprecated |
| Language / build | Plain ES modules, bundled by esbuild (`tools/build.mjs`, target es2019, iife) into `dist/plugin/` | no framework runtime in the panel |
| UI toolkit | Spectrum UXP widgets (`sp-button`, `sp-checkbox`, `sp-picker`, `sp-textfield`, `sp-action-button`) wrapped in `ui/dom.js` with one API (value/checked/enabled/onChange) | native look, follows the PS theme |
| Layering | `src/core/` host-free (Node/Vitest), `src/host/` everything that touches Photoshop/UXP, `src/ui/` panels, `src/i18n/` strings | `core/` never imports `photoshop`/`uxp`; all host modules load through `host/ps.js hostRequire` |
| Strings | `lang.json` / `sfx_lang.json` generated from the Krita source (`tools/export_data.py`); Photoshop wording in `ps_overrides.json` (`tools/make_overrides.py`); new strings of the port in `ui/i18n.js PS_EXTRA` (en + de) | 1:1 copy, same fallback rule (missing → English) |
| Text layers | real Photoshop text layers (`make textLayer`), point text, engine line breaks as `\r`, explicit leading, one `textStyleRange` per bold run | editable with the Type tool |
| Measuring | opentype.js on the real font file + automatic per-cut calibration against Photoshop + char-width fallback (§4) | quality-critical |
| Previews / cards | software rasteriser `core/raster.js` → PNG data URL | UXP canvas has no `fillText`/`drawImage`/patterns/clip/transforms |
| Page overlay | page thumbnail `<img>` (Imaging API) + boxes as positioned elements | crisp, clickable |
| Persistence | `host/settings.js`: JSON files in the plugin data folder, same keys and value formats as kritarc (groups `typer_kr`, `MangaSFX`); big values in their own files | exports interchangeable with the Krita version |
| History | every insert = one `executeAsModal` with `suspendHistory` → one named step; measuring probes are rolled back; the batch never holds a modal scope across bubbles | Stop stays clickable |
| ZIP / XML | JSZip + `core/xml.js` | UXP has no `DOMParser` |

---

## 2. Feature matrix

### 2.1 Core engine (`core/`, ported function by function)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| `layout.py` bold runs: `Word`, `make_runs`, `make_words`, `split_paragraphs`, `line_runs`, `runs_text`, `group_words` | `core/layout.js` | getestet |
| Liang hyphenation (`_Hyphenator`, patterns, mins, `hyphenate`, `split_word`, in-word breaks) | `core/layout.js` (patterns from `hyph/`, loader injected; preloaded at start in UXP) | getestet |
| `dehyphenate` + keep-hyphen suffixes | `core/layout.js` | getestet |
| `wrap_greedy` (ladder, max splits, retry, widows) | `core/layout.js` | getestet |
| `balance_even` DP | `core/layout.js` | getestet |
| `wrap_ellipse`, schedule, ellipse widths | `core/layout.js` | getestet |
| `fit_text` (rect/ellipse, hard breaks, hyphenation) | `core/layout.js` | getestet (parity, 480 fit cases) |
| `typer_layer_prefix`, `is_typer_layer_name` | `core/layout.js` | getestet |
| TextShapR fitters (`fit_lines_k/_width/fixed_lines/ellipse`) | `core/layout.js` | getestet |
| `score_arrangement` + profiles, `ideal_line_count`, rim/step/penalties | `core/layout.js` | getestet (parity: scores equal to 1e-9; a weight mutation fails the test) |
| `shape_row_width`, `line_row_targets` | `core/layout.js` | getestet |
| starved-fill rescue, `_dedup_similar`, `shape_candidates` | `core/layout.js` | getestet (parity, 384 shape cases) |
| `vertical_start`, `line_x_positions` | `core/layout.js` | getestet |
| Tategaki (`vertical_measurer`, `column_y_positions`, `horizontal_start`) | `core/layout.js` | getestet |
| `layoutmodel.py` | `core/layoutmodel.js` | getestet |
| `langpair.py` (all) | `core/langpair.js` | getestet |
| `balloons.py` | `core/balloons.js` | getestet |
| `texttypes.py` | `core/texttypes.js` | getestet |
| `fontmatch.py` + `difflib.SequenceMatcher.ratio` | `core/fontmatch.js` + `core/difflib.js` | getestet |
| `fontfav.py` | `core/fontfav.js` | getestet |
| `comments.py` | `core/comments.js` | getestet (+ docx load in the smoke test) |
| `bubbles.py` | `core/bubbles.js` | getestet |
| `sfx/modes.py`, `sfx/rule_search.py` | `core/sfx/` | getestet |
| `sfx/config.py` data | `src/data/sfx_config.json` (generated) | getestet (i18n/SFX tests read it) |
| `xlsx.py` writer | `core/xlsx.js` | getestet (Excel round trip in the smoke test) |
| Script readers (docx/odt/xlsx/grid, decode chain, `.doc/.xls` refusal, `split_lines`) | `core/readers.js` | getestet |
| Text prep (`tidy_text`, comic lettering, crossbar I, bold markup, `prepare_text`, `presets_to_table`) | `core/textprep.js` | getestet |
| `ai_backend.py` pure parts | `core/ai.js` | getestet |
| `gauth.py` (PKCE, token stamping, error wording) + `gdocs.py` parsing | `core/gauth.js` (own SHA-256: UXP has no WebCrypto) | portiert |
| `fontfiles.py` name tables, `FontFileIndex`, zip names | `core/fontfiles.js` (+ `sparseFontHead`: reads only header/directory/name table) | getestet (3000 real fonts identical to the Krita parser; sparse read identical, < 10 % of the bytes) |
| `imgfx.py` pattern tiles + gradients | `core/patterns.js` | getestet |
| — | `core/raster.js` preview renderer (coverage, EDT outlines, blur, patterns, gradient paint, faux bold) | getestet |
| — | `core/measure.js` Qt-like metrics measurer | getestet |
| — | `core/insertplan.js` (the decisions of `insert_text_layer`) | getestet |
| — | `core/psdesc.js` descriptors (text layer, styles, gradient overlay, rotate, restyle, shapes, selections) | getestet (via insert/smoke tests) |

### 2.2 Photoshop host layer (`host/`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| `insert_text_layer` | `host/insert.js insertTextLayer()` — same parameters, `(ok, key, fmt)` | getestet (mock) · PS-Test |
| SVG `<text>` + tspans per bold run | one text layer, `textStyleRange` per run (UTF-16 offsets), real bold cut or faux bold | PS-Test |
| Outline / 2nd outline | Stroke outside (size = visible half) + hard Outer Glow (precise, spread 100 %); pattern on outline 2 → `frameFXMulti` | PS-Test |
| Shadow | Drop Shadow, spread 100 %, size = widest outline | PS-Test |
| Pattern / soft outline (Krita raster path) | pattern stroke + soft Drop Shadow at distance 0 — **text stays editable** | PS-Test |
| Fill pattern (vector clip group) | Pattern Overlay | PS-Test |
| Fill selection with pattern / gradient | `host/fill.js`: editable **Pattern Fill layer** masked by the selection (tile), pixel layer via Imaging (gradient re-rendered at size) | PS-Test |
| `_remove_existing_layers` (only `TypeR NN — `) | `host/layers.js` | getestet (smoke: foreign layers survive) |
| Selection bounds + mask | `selectionBounds` + `imaging.getSelection` (PS 24.2+), bounds fallback | PS-Test |
| `_select_box` | rect / ellipse selection | PS-Test |
| `grab_gray`, thumbnail | `imaging.getPixels` | PS-Test |
| QFontMetricsF measurer | `host/measure.js` (opentype.js, auto-calibration, fallback) | getestet (real Arial in the smoke test) · PS-Test (≤ 1 %) |
| Font list | `app.fonts` → families / styles / PostScript names | getestet (mock) |
| Font file index (cached by mtime+size) | `host/fonts.js` (partial reads when `fs.open/read` exist) | getestet |
| Balloon insert | `host/balloon.js`: shape layer with bezier path + tail, moved under the unit's text | getestet (mock) · PS-Test |
| Font install | folder with the fonts is opened + instruction (deviation 2) | portiert |
| Undo batch | removes the run's `TypeR NN — ` layers; each insert is its own history step | getestet |
| Colour picker | `host/color.js` `showColorPicker`, hex prompt fallback | PS-Test |
| SFX layers | `host/sfx.js`: one editable text layer + layer style; restyle in place; read text back; note list | getestet (mock) · PS-Test |
| Patterns | `host/patterns.js`: define from tile in a scratch doc, read ID back, list presets, pattern pixels | PS-Test |
| Google | `host/google.js` (fetch, token refresh, Docs lines, Drive comments) | portiert · PS-Test |
| BubblR AI | `host/bubblr.js` → `tools/bubblr_bridge.py` | portiert |

### 2.3 Panels & tabs (`ui/`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Tabs Type, Style, Setup, BubblR (locked), Batch, TextShapR, SFX, Fonts; last tab remembered; each scrolls | `ui/panels.js Tabs`, same ids, `uiTab` (old index values understood) | getestet |
| Tab switches in Setup › Experimental | same keys (`enableBubblr`, `enableBatch`, …) | getestet |
| Panel system: ⋮ menu (up/down, move to tab, detach/reattach), lock, height grip, drag & drop (also onto a tab), saved order/tabs/heights/locked/detached, reset | `ui/panels.js PanelMethods`; detach into `TypeR panel 1–3` entrypoints, else a floating window | getestet (move/reset/detach) |
| Tab rename (double-click, customize mode) / reorder | rename same; reorder with ◀ ▶ in customize mode (deviation 7) | portiert |
| Layout & sizes (`view`) | same keys | getestet |
| UI language ×6 | same (`uiLang`) | getestet (every language, no raw key) |
| Status line + build stamp | version · Photoshop · UXP | getestet |

### 2.4 Type tab (`ui/typetab.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Load docx/xlsx/xlsm/odt/txt/md/gdoc, paste, Analyze, skip empty, refuse .doc/.xls | same | getestet |
| Script tabs (rename, close ×/middle click, drag order, already-open, Untitled n, persisted with progress) | same; comments are persisted too (improvement) | getestet |
| Add line, save script back | same | portiert |
| Table, click/◀▶/double-click insert, counter, done marks, reset progress | same (+ ↑/↓/Enter in the table) | getestet |
| Page markers, indicator, jump | same | getestet |
| Active field + Bold toggle + JP reference | same | getestet |
| Comments panel, auto-hidden, links open in the browser | same | getestet |
| Live preview + ↻ | software renderer | getestet |
| Font picker (filter, ★ recents, selected-font preview, right-click → favourite/category, ★ button) | virtualised list | getestet |
| Text colour | PS colour picker (deviation 8) | PS-Test |
| Insert | same path | getestet |
| Balloon panel | same | getestet |
| BubblR stepper ◀/▶ | same | portiert |

### 2.5 Style tab (`ui/styletab.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Kind of text (types + custom), apply, missing-font hint | same | portiert |
| Bold/italic/underline/ligatures | same | getestet |
| Alignment, valign, case, tidy, comic + crossbar I | same | getestet |
| Size/padding/spacing 0–1000 %, auto-fit, round, vertical | same | getestet |
| Outline popup (colours, widths, pattern file/PS pattern/generate/library/clear, scale, target, soft outline) | modeless popup; PS pattern presets instead of Krita resources | getestet (generator) · PS-Test |
| Shadow popup | same | portiert |
| Fill panel (pattern for a selection) | same, Pattern Fill layer | PS-Test |
| Hyphenation + language | same | getestet |
| Pattern generator (9 kinds + smooth, colours, transparent, size/gap, gradient + direction, live preview, save to library, fill selection) | modeless dialog, live on the preview | getestet |
| Pattern library | PNGs in the data folder, `patternLibrary` | portiert |

### 2.6 Presets (`ui/presets.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Manga → Character → preset, old formats normalised, new/delete | same (`presets`) | getestet |
| ⋯ menu: save/delete/import/export bundle zip / json / xlsx, Excel font-guide import | same formats | getestet (json export, Excel import) |
| Simple mode (by character off) | same | portiert |
| Main characters (★, dialog, context menu) | same (`mainChars`) | portiert |
| Auto character / auto manga | same | getestet |
| Default preset + usage learning | same | getestet |
| Preset keybinds (`presetKeys`, one key ↔ one preset, `[key]`, moved message) | same, Qt key spelling; while the panel has focus (deviation 1) | getestet |
| Text-type fonts dialog | same (`ttFonts`, `ttCustom`), family picker dialog instead of QFontDialog | portiert |

### 2.7 TextShapR (`ui/shapr.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Modes, Auto shape, Live, Match size, Hyphenation, De-hyphenate | same | getestet |
| Cards (checker, ★, ✎, number, selection, sizes follow width) | PNG cards | getestet |
| Keys 1–9/0, Shift = apply + next, arrows | same (Digit codes, so Shift works on every layout) | portiert |
| Break editor, pinned arrangement | same | portiert |
| Selection silhouette (20 rows) | `core/selshape.js` from `imaging.getSelection` | getestet (core) · PS-Test |
| Apply / Apply + next / Best (baked breaks, capped px) | same path | getestet |

### 2.8 Batch tab (`ui/batch.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Page view, edit boxes, from selection (split parts), shape, SFX, order, detect (locked), clear, show page | same | getestet (boxes) · PS-Test (page view) |
| Assign 1:1, this page only, table, gaps, clear | same | getestet |
| Select all, take current line, assign by clicking, filter | same | portiert |
| Style per line (stamp/clear, restored after the run) | same | portiert |
| Fill all through the same insert path, Stop, Review each, Undo batch, confirm | same; the box goes into the insert path directly (deviation 9) | getestet |
| Overlay keys E . Q , Del S R | same | portiert |

### 2.9 BubblR tab (locked without the `bubblr_dev` marker)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Heuristic detection | `core/bubbles.js` on Imaging gray bytes | getestet (core) · PS-Test |
| AI detector | `tools/bubblr_bridge.py` + fetch (deviation 5) | portiert |
| Models, conf, SFX conf, show models, panel order, save/load boxes, training export, SFX word DB, RTL, tiling, selection follows | same | portiert |

### 2.10 SFX tab (`ui/sfx.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Strategies ignore/romaji/note/overlay/redraw, note list | same | getestet |
| Presets built-in + user (save/rename/keywords/overwrite/delete) | same (`MangaSFX` keys) | portiert |
| Rules, search, rule languages, modes, hidden built-ins per mode/global, add/edit/delete, edit built-in | same | getestet (suggestions) |
| Suggestions (rules, sound heuristic `classify_sfx`, learned usage, preset match), missing-font alternative | same | getestet |
| Style (font + quick fonts, size, fill, gradient, pattern, rotation, outlines, soft outline, shadow, UPPERCASE, bold/italic) | same, as layer styles on an editable text layer (improvement: no raster fallback) | getestet (mock) · PS-Test |
| Insert / restyle / from layer / reset / last style | same; restyle never deletes the layer | getestet |
| Export/import json + bundle | same format | portiert |
| View settings (compact, collapsible sections, preview height, clear after insert) | same | portiert |
| Own UI language | same (`language`) | portiert |

### 2.11 Fonts tab (`ui/fontstab.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| Favourites + categories, search, filter, face previews (progressive, cache 400), size slider, use, add current/dialog, remove, edit/manage categories, context menu | same (`fontFavorites`) | getestet |
| Export/import bundle, missing fonts dialog | same format | portiert |

### 2.12 Setup tab (`ui/setuptab.js`)

| Krita (spec) | Photoshop port | Status |
|---|---|---|
| General: language, replace existing (default on), presets by character, main characters | same | getestet |
| Fonts per text type + missing fonts report (favourites / SFX / all, renamed via the ladder) | same | portiert |
| Google: own client ID, sign in/out, status, image comments as script | PKCE; the user pastes the redirect address (deviation 3) | portiert · PS-Test |
| `.gdoc` → browser `.docx` export, Downloads watched | same; a moved Downloads folder is set in the Google panel (deviation 6) | portiert |
| `.gdoc` unreadable → DriveFS lookup | asks for the link (deviation 4) | portiert |
| — | **Diagnostics**: measuring self-test (≤ 1 %), calibrate current font, Imaging check, versions | PS-Test |

### 2.13 Quality items

| Item | Status |
|---|---|
| Python tests of the Qt-free modules ported to Vitest | getestet |
| Parity test (1243 cases, identical output) | getestet |
| i18n integrity (every used key exists, prefix keys, overrides only reword existing keys) | getestet |
| UI smoke test (whole panel in happy-dom against a mock Photoshop, 20 paths) | getestet |
| Measurer ≤ 1 % against Photoshop | PS-Test (`Setup › Diagnostics`) |
| Performance: debounced preview (100 ms) / TextShapR (250 ms), cached measuring, virtualised font list, partial font reads, progressive face rendering | getestet (logic) · PS-Test (feel) |
| Robust messages (no document / selection / font / bold face) | getestet |
| 300 px panel width, PS themes | PS-Test |
| `.ccx` build | getestet (`tools/build.mjs --ccx`) |

### 2.14 Final reconciliation against the Krita `LANG` table

Every key of the Krita table (626 en) was searched in `src/`. 38 are not used
by the port:

* **24 are dead in Krita too** (no `_tr` call left): `col_font`, `col_purpose`,
  `tab_presets`, `bp_place*`, `bp_src_*`, `bp_col_*`, `bp_up_tip`,
  `bp_down_tip`, `bp_gap_*_tip`, `st_bp_all_done`, `st_bp_no_script`,
  `st_bp_mismatch`, `st_bp_style_*`, `st_bp_no_rows`, `st_bp_placed`.
* **12 have no UXP counterpart**: `title` (the panel label comes from the
  manifest), the Qt file-dialog titles and filters (`file_dlg`, `file_filter`,
  `preset_file_save/open`, `preset_filter`, `preset_bundle_filter`,
  `preset_open_filter`, `xlsx_filter`, `preset_excel_open/filter` — UXP pickers
  take file types, no caption), `bp_pick_ai` (the bridge is given the ai folder).
* `st_not_found` and `st_bp_ai_missing` were wired in during the check.

Every section of Krita's README.md and FEATURES.md has a row above;
`tests/i18n.test.js` guards the other direction (no key the port asks for can be
missing).

---

## 3. Documented deviations

1. **Preset keybinds** fire while the TypeR panel has keyboard focus — UXP has
   no application-wide key hook like Krita's Qt event filter. The panel says so
   under the key field.
2. **Installing fonts** from a bundle: a UXP plugin cannot install fonts. The
   fonts are written to `<data folder>/fonts_to_install`, the folder is opened
   and the user installs them (then restarts Photoshop).
3. **Google sign-in**: UXP cannot listen on a loopback port. After consenting,
   the browser shows an unreachable `http://127.0.0.1:…/?code=…` page; the user
   pastes that address into TypeR. The no-sign-in route (browser `.docx` export
   picked up from Downloads) works as in Krita.
4. **DriveFS SQLite lookup** for unreadable `.gdoc` files: no SQLite in UXP;
   TypeR asks for the document link (Krita's own fallback).
5. **BubblR AI detector**: reached through `tools/bubblr_bridge.py` (localhost
   HTTP, 127.0.0.1:8765) because UXP cannot start processes. The SFX word DB
   lives in the setting `sfxDb`. The tab stays locked unless `bubblr_dev` exists.
6. **Moved Downloads folder**: Krita read it from the Windows registry; UXP
   cannot. `Setup › Google › Downloads folder` takes the path.
7. **Tab reordering**: a UXP tab strip cannot be dragged; in customize mode
   `Setup › Experimental` has ◀ ▶ to move a tab. Panels still drag & drop.
8. **Colour picking**: Photoshop's picker is a blocking dialog that reports only
   the final colour, so the colour applies on OK (Krita followed the drag live).
9. **Batch**: Krita selected each bubble and inserted into the selection; here
   the box goes straight into the same insert path (no selection churn in the
   history). Only *Review each* selects the bubble, so the cards read it.
10. **Undo**: every insert is one history step; a batch run is not one step
    (that would need one modal scope over the whole run and freeze the panel).
    *Undo batch* stays the one-click undo, as in Krita.
11. **Krita pattern resources** → Photoshop's pattern presets (listed through
    the preset manager, pixels read from a scratch document).

Improvements over Krita (Photoshop can do more): textured / soft-outlined text
and SFX stay editable text layers; *Fill selection* makes an editable Pattern
Fill layer; balloons sit under their text automatically; sessions keep their
comments; the SFX state keeps gradient and rotation; measuring calibrates itself.

---

## 4. Measuring (quality-critical)

* `host/measure.js measuringEnv()` builds `measurer(lineSpacing, bold, italic)
  → measurer(px) → [widthOf, spaceW, lineH, ascent, descent]` exactly like
  `_make_measurer`; bold runs use the bold face.
* Advances from opentype.js on the actual file (found through the ported
  `FontFileIndex`), kerning and ligatures as Photoshop applies them by default.
* Metrics like Qt: winAscent/winDescent, typo metrics with `USE_TYPO_METRICS`,
  else hhea; `lineH = (ascent + descent) × spacing`, sent as explicit leading.
* **Calibration**: the first insert with a cut (`ensureCalibrated`) sets a probe
  text layer in a rolled-back modal scope, compares its `boundsNoEffects` with
  the opentype ink box and stores width and size ratios per PostScript name and
  per document resolution (`measureCal`). No layer and no history entry remain.
* Fallback without a font file: per-character advances from probe layers,
  cached permanently (`charWidths`).
* Verification: `Setup › Diagnostics` measures a different sample than the
  calibration and reports the error per font (target ≤ 1 %).
