# TypeR for Photoshop

Manga typesetting in Photoshop: load the script, pick a line, drag a selection
into the bubble, press **Insert** — TypeR fits the line into the bubble
(balanced breaks, largest size that fits, centred, optional hyphenation) and
creates a real, editable Photoshop text layer named `TypeR NN — …`.

This is the Photoshop (UXP) port of **TypeR for Krita**, with the same tabs,
settings, presets, shortcuts and six UI languages (English, Deutsch, Español,
Français, Português, Italiano). Settings and export files use the Krita
version's formats, so presets, favourites and SFX data move between the two.

Requires **Photoshop 2023 (24.0) or newer**; page previews, selection shapes
and the Batch/BubblR page view need **24.2+** (Imaging API).

## Installation

* **Double-click** `TypeR-2.0.0.ccx` (Creative Cloud installs it), then
  *Plugins › TypeR › TypeR*.
* Or with the **UXP Developer Tool**: *Add Plugin* → `dist/plugin/manifest.json`
  → *Load* (for testing a build).

Build from source (Node 20+; dependencies live outside the project, see
`tools/devdir.cjs`):

```
node tools/build.mjs          # dist/plugin/
node tools/build.mjs --ccx    # + dist/TypeR-2.0.0.ccx
node tools/build.mjs --watch  # rebuild on change (use with the UDT "Watch")
```

## The panel

| Tab | What it is for |
|---|---|
| **Type** | the everyday loop: script tabs, source/translation table, navigation and pages, the active line (with **bold** words), comments, live preview, presets, font + colour, Insert, balloon tool |
| **Style** | kind of text, bold/italic/underline/ligatures, alignment, case, smart punctuation, comic lettering, size / padding / line spacing, auto-fit, round bubble, vertical text, outline (+ 2nd outline, pattern, soft outline), shadow, pattern fill for a selection, hyphenation |
| **Setup** | language, replace-on-reinsert, preset mode, main characters, fonts per text type, missing-fonts report, Google account, layout & sizes, **Diagnostics**, experimental switches, customizable layout |
| **Batch** | mark the bubbles of a page, pair a line with each, fill the page in one run (with review and undo) |
| **TextShapR** | the current line in up to ten shapes — pick one, edit its breaks, apply |
| **SFX** | the SFX Helper: five strategies for Japanese sound effects, font suggestions by rule and sound, presets, a fully styled SFX text layer |
| **Fonts** | starred fonts in categories, shown in their own face |
| **BubblR** | automatic bubble detection (locked in public builds) |

Every panel can be moved, reordered, pinned, resized or detached into one of
three extra panels (*Plugins › TypeR › TypeR panel 1–3*) once *Setup ›
Experimental › Customize layout* is on.

## Quick start

1. Open the page. *Load* the script (`.docx`, `.xlsx`, `.odt`, `.txt`, `.md`,
   Google `.gdoc`) or paste it and press *Analyze*.
2. Pick a font; optionally a preset (Manga → Character → style).
3. Drag a selection into the first bubble (an elliptical one for round
   bubbles), press **Insert**. TypeR moves on to the next line.
4. Double-click a table row to insert it directly; the green rows are done.

Every insert is one history step (*Edit › Undo*). Layers you made yourself are
never touched: only layers whose name starts with `TypeR NN — ` are replaced.

## Measuring

TypeR measures with the actual font file (the same advances and kerning
Photoshop uses) and calibrates each font cut once against Photoshop itself on
first use — a hidden probe layer that is rolled back, leaving no layer and no
history step. *Setup › Diagnostics* checks the result on any fonts (target:
≤ 1 % error) and shows the Photoshop/UXP versions.

## Differences to the Krita version

Photoshop plugins cannot do a few things Krita plugins can; TypeR works around
them (details: `PORT_PLAN.md` §3):

* Preset **keys** work while the TypeR panel has the focus.
* **Fonts in bundles** are copied into a folder that opens — install them from
  there (plugins cannot install fonts).
* **Google sign-in**: after allowing access, paste the browser's final
  `127.0.0.1` address into TypeR. The browser-export route needs no sign-in.
* **BubblR AI** runs through `tools/bubblr_bridge.py` (a local helper).
* Colours are picked with Photoshop's picker and apply on OK.

And some things are better: outlines, patterns, soft outlines and shadows are
layer styles, so text and SFX **stay editable**; pattern fills of a selection
are editable Pattern Fill layers; balloons sit under their text.

## Tests

```
node "%LOCALAPPDATA%\typer-ps-dev\node_modules\vitest\vitest.mjs" run
```

* `parity.test.js` — 1243 cases exported from the Krita engine
  (`tools/export_parity.py`) must come out identical.
* the Krita test suites (layout, pairing, font matching, favourites, bubbles,
  metamorphic) ported to Vitest.
* `ui_smoke.test.js` — builds the whole panel against a mock Photoshop and
  walks insert, TextShapR, batch + undo, SFX, presets, keys, sessions, import
  and export, layout.
* `i18n.test.js` — no string key can be missing in any language.

What only Photoshop can show is in `tests/PS_CHECKLIST.md`.

## Project layout

```
manifest.json           UXP manifest v5
src/main.js             entrypoints, builds the panel
src/core/               host-free engine (tested under Node)
src/host/               Photoshop / UXP access (batchPlay, files, fonts, pixels)
src/ui/                 tabs and panels
src/i18n/, src/data/    generated from the Krita sources (tools/export_data.py)
hyph/                   hyphenation patterns (see hyph/LICENSE.txt)
tools/                  build, data export, parity export, BubblR bridge
tests/                  Vitest suites + PS_CHECKLIST.md
```
