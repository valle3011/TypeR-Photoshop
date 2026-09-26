# TypeR for Photoshop — what is where, and how to switch it off

A map of the port, so a feature can be found by name. It mirrors the Krita
plugin's FEATURES.md; the Krita name of each piece is given so the two can be
read side by side. Grep the name, not the line.

## The shape of it

| File | What it is | Krita counterpart |
|---|---|---|
| `src/main.js` | UXP entrypoints, builds the panel in the docker's order | `TyperDocker.__init__`, `register()` |
| `src/ui/app.js` | the controller: state, settings snapshot, insert, insert_arrangement | `TyperDocker` |
| `src/ui/panels.js` | tabs + movable panels, detach hosts | `_new_panel`, `PanelBox`, `TyperExtraHost` |
| `src/ui/typetab.js` | Type tab, sessions, loading, Google Docs, pages, comments | Type-tab methods |
| `src/ui/presets.js` | presets, main characters, keybinds, import/export | preset methods, `MainCharsDialog`, `PresetKeyHook` |
| `src/ui/styletab.js` | Style tab, patterns, generator, library, text types | Style-tab methods, `patterngen.py` |
| `src/ui/setuptab.js` | Setup tab, view, missing fonts, text-type fonts, Diagnostics | Setup methods, `TextTypeFontsDialog` |
| `src/ui/shapr.js` | TextShapR | `TextShapRWidget`, `ShapeCard` |
| `src/ui/batch.js` | Batch + BubblR tabs | `_build_batch_tab`, `_build_bubblr_tab`, `_bp_*` |
| `src/ui/sfx.js` | SFX tab | `sfx/sfx_docker.py` |
| `src/ui/fontstab.js` | Fonts tab | `fontfav_ui.py` |
| `src/ui/widgets.js` | font picker, live preview, page overlay | `FontPicker`, `TextPreview`, `BubbleOverlay` |
| `src/core/layout.js` | the typesetting engine — **parity-tested** | `layout.py` |
| `src/core/*.js` | pairing, balloons, text types, font matching, favourites, comments, bubbles, readers, text prep, SFX modes/rules, xlsx, AI parsing | same-named `.py` files |
| `src/core/raster.js`, `preview.js`, `measure.js` | preview renderer + metrics | QPainter / QFontMetricsF |
| `src/core/insertplan.js`, `psdesc.js` | insert decisions + Photoshop descriptors | `insert_text_layer` |
| `src/host/*.js` | Photoshop access: insert, measure, fonts, layers, pixels, patterns, fill, balloon, SFX layers, colour, Google, BubblR bridge, settings, files | Krita API calls |

## Features (and their switches)

### Vertical text (tategaki)
*Style › Vertical text*. Upright columns right to left (`baselineDirection`
cross-stream), fitted with `vertical_measurer`. Off = unchanged horizontal text.

### Balloon shape library
Off by default: *Setup › Experimental › Balloon tools*. Eight shapes
(`core/balloons.js`) drawn as a Photoshop **shape layer** with its tail, placed
under the text of the current line. Uses the armed BubblR/Batch bubble, else
the selection.

### SFX strategies
*SFX › Strategy*: ignore / romaji / note / overlay / redraw
(`core/sfx/modes.js`). Note collects numbered lines; *Place list* sets them as
one text block.

### SFX rule search
Search box above the rules: plain words, `font:`, `group:`, `kw:`
(`core/sfx/rule_search.js`). Filters the display only.

### Text types
Experimental switch *Text types*. 21 kinds + your own (`core/texttypes.js`),
fonts per type in *Setup › Fonts per text type*.

### Main characters
*Setup › Main characters* or right-click the character dropdown. Starred
characters head the lists. Stored per manga (`mainChars`).

### Font bundles
Preset, favourite and SFX exports as `.zip` with every cut of every named font.
Importing copies the fonts into a folder that opens (Photoshop plugins cannot
install fonts).

### TextShapR
Balanced / Round / Tall / Wide, auto shape from the selection's silhouette,
live on canvas, match size, hyphenation, de-hyphenation, break editor. Scores
and candidates are identical to Krita's (parity test). Switch: *Enable
TextShapR*.

### Hyphenation
*Style › Hyphenation* with language Auto/en/de/es/fr/pt/it; Liang patterns in
`hyph/`, loaded once at start.

### BubblR
Locked unless a file named `bubblr_dev` is in the plugin folder. Heuristic
detection runs in the panel; the AI detector through `tools/bubblr_bridge.py`.

### Batch placement
*Batch* tab (*Enable Batch*). Boxes by hand / from a selection (split into its
parts) / detection; lines paired 1:1 (SFX boxes take none), gaps, per-line
style, *Fill all* through the normal insert path, *Review each*, *Undo batch*
(removes only the run's `TypeR NN — ` layers).

### Preset keybinds
Field under the preset dropdown; one key per preset per manga (`presetKeys`,
Qt's spelling like `Ctrl+1`). Active while the TypeR panel has the focus.

### Script comments
Word comments and Google Drive comments, anchored to their lines; the panel
hides itself when a line has none. Kept with the session.

### Diagnostics (new)
*Setup › Diagnostics*: measuring self-test against Photoshop, calibration of
the current font, Imaging API check, versions.

## Conventions

* **`core/` is host-free** and tested under Node; nothing there may import
  `photoshop` or `uxp`. Host modules load through `host/ps.js hostRequire`.
* **Strings**: `src/i18n/lang.json` / `sfx_lang.json` are generated — change the
  Krita source and rerun `tools/export_data.py`; Photoshop wording goes to
  `tools/make_overrides.py`, new strings to `PS_EXTRA` in `ui/i18n.js` (en + de;
  `tests/i18n.test.js` fails on any missing key).
* **Panels**: `_new_panel(id, tab)` + a `PANEL_TITLES` entry.
* **The insert path is one function** (`host/insert.js insertTextLayer`): the
  Insert button, TextShapR and the batch all go through it.
* **Layers are only ever removed** when their name starts with `TypeR NN — `.
* **`executeAsModal` wraps document changes only**, never UI waiting; the batch
  takes one modal scope per bubble.
