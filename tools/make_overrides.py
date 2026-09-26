# -*- coding: utf-8 -*-
"""Photoshop wording for the Krita-specific UI strings.

The LANG tables are copied 1:1 from the Krita plugin (tools/export_data.py);
the few strings that name Krita, its vector layers or its pattern resources
are rephrased here for Photoshop. The UI looks up src/i18n/ps_overrides.json
first, then lang.json, then English — the same fallback rule as the original.

Hand-written translations for en/de; the other languages get the mechanical
Krita -> Photoshop substitution (they fall back to English for most keys
anyway). Run after export_data.py:  python tools/make_overrides.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

MANUAL = {
    "en": {
        "title": "TypeR for Photoshop",
        "preset_key_tip": "Press a key combination to switch to this character + style while the TypeR panel has the focus — no need to walk the dropdowns when the speaker changes. Keybinds belong to the manga, so the same keys are free again in the next series. (Photoshop gives a panel no keys while the canvas has the focus.)",
        "outline_pattern_krita": "Photoshop pattern…",
        "outline_pattern_none": "No Photoshop patterns found.",
        "bp_selfollow_tip": "The current bubble's rect becomes the Photoshop selection, so Insert/TextShapR on the Type tab work on it too. Off: your selection is never touched.",
        "fav_import_bundle_done": "Imported {n} favourites. Fonts: {inst} copied to the install folder, {skip} already there, {fail} failed. Photoshop cannot install fonts from a plugin: install the opened fonts, then restart Photoshop.",
        "st_preset_imported_bundle": "Imported {n} presets. Fonts: {inst} copied to the install folder, {skip} already there, {fail} failed. Install the opened fonts (Photoshop cannot do it from a plugin), then restart Photoshop.",
    },
    "de": {
        "title": "TypeR für Photoshop",
        "preset_key_tip": "Tastenkombination drücken, um auf diese Figur + diesen Stil zu wechseln, solange das TypeR-Panel den Fokus hat — kein Klicken durch die Auswahllisten, wenn jemand anderes spricht. Tasten gehören zum Manga, in der nächsten Serie sind sie wieder frei. (Photoshop gibt einem Panel keine Tasten, solange die Arbeitsfläche den Fokus hat.)",
        "outline_pattern_krita": "Photoshop-Muster…",
        "outline_pattern_none": "Keine Photoshop-Muster gefunden.",
        "bp_selfollow_tip": "Das Rechteck der aktuellen Bubble wird zur Photoshop-Auswahl, damit auch Insert/TextShapR vom Type-Tab darauf arbeiten. Aus: deine Auswahl wird nie angefasst.",
        "fav_import_bundle_done": "{n} Favoriten importiert. Schriften: {inst} in den Installationsordner kopiert, {skip} schon vorhanden, {fail} fehlgeschlagen. Photoshop kann aus einem Plugin keine Schriften installieren: die geöffneten Schriften installieren, dann Photoshop neu starten.",
        "st_preset_imported_bundle": "{n} Presets importiert. Schriften: {inst} in den Installationsordner kopiert, {skip} schon vorhanden, {fail} fehlgeschlagen. Die geöffneten Schriften installieren (Photoshop kann das nicht aus einem Plugin), dann Photoshop neu starten.",
    },
}

SFX_MANUAL = {
    "en": {
        "from_layer_tip": "Read the SFX word from the active text layer",
        "st_no_sfx_layer": "Select an SFX text layer first.",
        "pattern_krita": "From Photoshop",
        "pattern_krita_tip": "Use a pattern saved in Photoshop",
        "pattern_krita_title": "Choose a Photoshop pattern",
        "warn_no_krita_patterns": "No Photoshop patterns found.",
        "st_svg_fail": "Photoshop could not create the layer.",
        "st_layer_created": "New text layer “SFX” created.",
    },
    "de": {
        "from_layer_tip": "SFX-Wort aus der aktiven Textebene lesen",
        "st_no_sfx_layer": "Bitte zuerst eine SFX-Textebene auswählen.",
        "pattern_krita": "Aus Photoshop",
        "pattern_krita_tip": "Ein in Photoshop gespeichertes Muster verwenden",
        "pattern_krita_title": "Photoshop-Muster wählen",
        "warn_no_krita_patterns": "Keine Photoshop-Muster gefunden.",
        "st_svg_fail": "Photoshop konnte die Ebene nicht anlegen.",
        "st_layer_created": "Neue Textebene „SFX“ angelegt.",
    },
}


def mechanical(table, manual):
    out = {}
    for lang, keys in table.items():
        o = dict(manual.get(lang, {}))
        for k, v in keys.items():
            if k in o or not isinstance(v, str):
                continue
            if "Krita" in v:
                o[k] = re.sub(r"Krita", "Photoshop", v)
        if o:
            out[lang] = o
    return out


def main():
    lang = json.load(open(os.path.join(ROOT, "src", "i18n", "lang.json"), encoding="utf-8"))["lang"]
    sfx = json.load(open(os.path.join(ROOT, "src", "i18n", "sfx_lang.json"), encoding="utf-8"))["lang"]
    data = {"typer": mechanical(lang, MANUAL), "sfx": mechanical(sfx, SFX_MANUAL)}
    path = os.path.join(ROOT, "src", "i18n", "ps_overrides.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print("wrote", path, {k: {l: len(v) for l, v in d.items()} for k, d in data.items()})


if __name__ == "__main__":
    main()
