# -*- coding: utf-8 -*-
"""Export the data tables of TypeR for Krita 1:1 into JSON for the Photoshop port.

The Krita plugin is the specification. Its UI strings (the `LANG` dict), the SFX
Helper strings, the built-in SFX rules/presets and the SFX word vocabulary are
DATA, not logic — hand-copying ~2000 lines of them would only invite typos.
This script imports the Krita modules (no Qt needed for these) and writes:

    src/i18n/lang.json          LANG + LANG_ORDER of typer_kr.py
    src/i18n/sfx_lang.json      sfx/i18n.py (_T + LANGUAGES)
    src/data/sfx_config.json    sfx/config.py (fonts, presets, defaults, rules, modes)
    src/data/sfx_seed_words.json  bubbles.SFX_SEED_WORDS

Run from the TypeR-Photoshop folder:  python tools/export_data.py
The Krita repo is expected next to it (../TypeR-Krita) or via TYPER_KRITA.
"""
import ast
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KRITA = os.environ.get("TYPER_KRITA") or os.path.join(os.path.dirname(ROOT),
                                                      "TypeR-Krita")
PKG = os.path.join(KRITA, "typer_kr")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _literal_assign(path, names):
    """Evaluate top-level `NAME = <literal>` assignments of a module WITHOUT
    importing it (typer_kr.py needs Krita + Qt to import)."""
    with open(path, encoding="utf-8-sig") as fh:
        tree = ast.parse(fh.read(), path)
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            if isinstance(t, ast.Name) and t.id in names:
                out[t.id] = ast.literal_eval(node.value)
    return out


def _dump(obj, rel):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    print("wrote", rel)


def main():
    d = _literal_assign(os.path.join(PKG, "typer_kr.py"),
                        {"LANG", "LANG_ORDER"})
    _dump({"order": d["LANG_ORDER"], "lang": d["LANG"]}, "src/i18n/lang.json")

    si = _literal_assign(os.path.join(PKG, "sfx", "i18n.py"),
                         {"_T", "LANGUAGES", "DEFAULT_LANG"})
    _dump({"order": si["LANGUAGES"], "default": si["DEFAULT_LANG"],
           "lang": si["_T"]}, "src/i18n/sfx_lang.json")

    cfg = _load("sfx_config", os.path.join(PKG, "sfx", "config.py"))
    _dump({
        "SFX_FONTS": cfg.SFX_FONTS,
        "SHOW_ALL_SYSTEM_FONTS": cfg.SHOW_ALL_SYSTEM_FONTS,
        "SFX_PRESETS": cfg.SFX_PRESETS,
        "DEFAULTS": cfg.DEFAULTS,
        "SFX_MODES": cfg.SFX_MODES,
        "SFX_MODE_NAMES": cfg.SFX_MODE_NAMES,
        "SFX_RULES": cfg.SFX_RULES,
    }, "src/data/sfx_config.json")

    words = _literal_assign(os.path.join(PKG, "bubbles.py"), {"SFX_SEED_WORDS"})
    _dump(list(words["SFX_SEED_WORDS"]), "src/data/sfx_seed_words.json")

    # bubbles.py kana tables + character sets (pure data; imported, not copied)
    bb = _load("bubbles", os.path.join(PKG, "bubbles.py"))
    _dump({
        "KANA_ROMAJI": bb.KANA_ROMAJI,
        "KANA_SMALL_Y": bb._KANA_SMALL_Y,
        "KANA_DROP": bb._KANA_DROP,
        "SFX_TAGS": list(bb._SFX_TAGS),
        "SFX_STRIP": bb._SFX_STRIP,
    }, "src/data/bubbles_kana.json")


if __name__ == "__main__":
    sys.exit(main())
