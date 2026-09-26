# -*- coding: utf-8 -*-
"""Parity fixture for the font name-table parser: runs the Krita
`fontfiles.font_file_names()` over the installed font files and writes
{path: [families, fulls]} to tests/fixtures/fontnames.json (machine-specific,
so the fixture is regenerated rather than committed).

Run from TypeR-Photoshop:  python tools/export_fontnames.py [limit]
"""
import importlib.util
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KRITA = os.environ.get("TYPER_KRITA") or os.path.join(os.path.dirname(ROOT), "TypeR-Krita")
PKG = os.path.join(KRITA, "typer_kr")

# fontfiles.py imports Qt only for installing; stub it so the parser loads.
pkg = types.ModuleType("typer_kr")
pkg.__path__ = [PKG]
sys.modules["typer_kr"] = pkg
qt = types.ModuleType("typer_kr._qt")
qt.QFontDatabase = None
sys.modules["typer_kr._qt"] = qt
spec = importlib.util.spec_from_file_location("typer_kr.fontmatch", os.path.join(PKG, "fontmatch.py"))
fm = importlib.util.module_from_spec(spec)
sys.modules["typer_kr.fontmatch"] = fm
spec.loader.exec_module(fm)
spec = importlib.util.spec_from_file_location("typer_kr.fontfiles", os.path.join(PKG, "fontfiles.py"))
ff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ff)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 600
    out = {}
    for i, p in enumerate(ff.all_font_paths()):
        if i >= limit:
            break
        fams, fulls = ff.font_file_names(p)
        out[p] = [sorted(fams), sorted(fulls)]
    path = os.path.join(ROOT, "tests", "fixtures", "fontnames.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False)
    print("wrote %d font files -> %s" % (len(out), path))


if __name__ == "__main__":
    main()
