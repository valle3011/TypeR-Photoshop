# -*- coding: utf-8 -*-
"""Parity fixtures: run the Krita (Python) engine on a fixed grid of cases and
write the results as JSON. tests/parity.test.js runs the JS port on the SAME
cases and demands identical output (line breaks, sizes, break indices, parsed
units) — scores within 1e-9, since exp/log/pow may differ in the last ulp
between libm and V8.

The measurer is a deterministic mock (per-character widths from the code
point), written identically in tests/parity.test.js, so the comparison tests
the engine and nothing else.

Run from TypeR-Photoshop:  python tools/export_parity.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KRITA = os.environ.get("TYPER_KRITA") or os.path.join(os.path.dirname(ROOT),
                                                      "TypeR-Krita")
PKG = os.path.join(KRITA, "typer_kr")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(PKG, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


L = _load("layout", "layout.py")
LP = _load("langpair", "langpair.py")


# --- the mock measurer (mirror in tests/parity.test.js) ---------------------
def char_w(ch, bold):
    w = 0.35 + (ord(ch) % 13) * 0.04
    if ch == " ":
        w = 0.3
    return w * (1.1 if bold else 1.0)


def make_measurer(spacing, gbold=False):
    def measurer(px):
        px = max(1, int(round(px)))

        def width_of(x):
            runs = getattr(x, "runs", None)
            if runs is None:
                if isinstance(x, (list, tuple)):
                    runs = x
                else:
                    return sum(char_w(c, gbold) * px for c in x)
            return sum(char_w(c, gbold or b) * px for (t, b) in runs for c in t)

        return (width_of, 0.3 * px, px * 1.17 * spacing, 0.8 * px, 0.2 * px)
    return measurer


TEXTS = [
    "Hello there!",
    "I can't believe you actually did that, you idiot!",
    "WHAT?! NO WAY!",
    "we should try to find a way to fix this before it gets worse",
    "THIS IS SO EMBARRASSING!",
    "Unbelievable",
    "Yagi-kun is waiting outside the station, as always.",
    "It was a trap. Now we have to run, and fast!",
    "Hmm... **really**? You think **so**?",
    "Spider- Man and embar- rassing words",
    "Ich kann das wirklich nicht glauben, Donnerwetter!",
    "Line one\nLine two is longer\nthree",
    "a b c d e f g h i j k l m n o p",
    "Why would anyone—anyone at all—do such a thing?",
    "Kuromiya-senpai… wait for me!",
    "OK",
]
BOXES = [(220, 140), (120, 300), (400, 120), (160, 160)]
MODES = ["balanced", "round", "tall", "wide"]


def cand_out(c):
    return {"px": c["px"], "k": c["k"],
            "lines": [L.runs_markup(r) for r in c["lines"]],
            "score": c.get("score")}


def main():
    out = {"shape": [], "fit": [], "hyph": [], "dehyph": [], "wrap": [],
           "pair": [], "misc": []}
    ellipse_rows = [0.35, 0.72, 0.93, 1.0, 0.94, 0.7, 0.33]

    # 1) shape_candidates: texts x boxes x modes x hyphenation (+ variants)
    for ti, text in enumerate(TEXTS):
        clean, mask = _parse_bold(text)
        for bi, (bw, bh) in enumerate(BOXES):
            for mode in MODES:
                for hy in (False, True):
                    if (ti + bi) % 2 and hy:
                        continue              # keep the grid at ~200 cases
                    rows = ellipse_rows if (ti % 3 == 0 and mode != "wide") else None
                    dh = (ti == 9)
                    lang = "de" if ti == 10 else "en"
                    m = make_measurer(1.05)
                    cands = L.shape_candidates(
                        clean, m, bw, bh, 64, 6, 0.12, mode=mode, hyphenate=hy,
                        lang=lang, mask=mask, limit=10, dehyphenate=dh,
                        inset=2.0 if ti % 4 == 1 else 0.0, shape_rows=rows)
                    out["shape"].append({
                        "text": clean, "mask": mask, "box": [bw, bh],
                        "mode": mode, "hyph": hy, "lang": lang, "dehyph": dh,
                        "inset": 2.0 if ti % 4 == 1 else 0.0, "rows": rows,
                        "result": [cand_out(c) for c in cands]})

    # 2) fit_text: rect/ellipse, hyphenation, spacing
    for ti, text in enumerate(TEXTS):
        clean, mask = _parse_bold(text)
        for (bw, bh) in BOXES[:3]:
            for shape in ("rect", "ellipse"):
                for hy in (False, True):
                    for spacing in (0.0, 1.0, 1.6):
                        if spacing == 0.0 and shape == "ellipse":
                            continue
                        r = L.fit_text(clean, make_measurer(spacing), bw, bh,
                                       80, 6, 0.1, shape, mask, hyphenate=hy,
                                       lang="en")
                        out["fit"].append({
                            "text": clean, "mask": mask, "box": [bw, bh],
                            "shape": shape, "hyph": hy, "spacing": spacing,
                            "result": None if r is None else {
                                "px": r[0],
                                "lines": [L.runs_markup(x) for x in r[1]],
                                "line_h": r[2], "fitted": r[5]}})

    # 3) hyphenate / dehyphenate on a word list, every bundled language
    words = ["embarrassing", "EMBARRASSING!", "(embarrassing)", "Yagi-kun",
             "well-known", "mother-in-law", "hyphenation", "typesetting",
             "Donaudampfschifffahrt", "Unglaublich", "extraordinario",
             "incroyablement", "inacreditável", "straordinariamente",
             "a-b", "SO!", "...", "Kuromiya-senpai", "self-control",
             "Übermäßigkeit", "naïveté", "co-operation", "x"]
    for w in words:
        for lang in ("en", "de", "es", "fr", "pt", "it"):
            out["hyph"].append({"word": w, "lang": lang,
                                "result": L.hyphenate(w, lang)})
    for s in ["embar- rassing", "Spider- Man", "X-ray vision", "Yagi- kun",
              "Tanaka- senpai", "onii- chan!", "trans- lation", "big- Bang",
              "no hyphen here", "a -b", "end-", "dou-  ble   space",
              "Straßen- bahn", "über- all"]:
        t, m = L.dehyphenate(s, [i % 3 == 0 for i in range(len(s))])
        out["dehyph"].append({"text": s, "result": [t, m]})

    # 4) wrap_greedy with hyphenation + limits
    for ti, text in enumerate(TEXTS):
        clean, mask = _parse_bold(text)
        ws = L.make_words(clean.replace("\n", " "),
                          mask[:len(clean)])
        wo, sp, _lh, _a, _d = make_measurer(1.0)(20)
        for max_w in (40.0, 75.5, 120.0, 300.0):
            for lim in ((2, 1), (0, 0), (1, 2)):
                lines = L.wrap_greedy(ws, wo, sp, max_w,
                                      lambda w: L.hyphenate(w.text, "en"),
                                      max_ladder=lim[0], max_word_splits=lim[1])
                out["wrap"].append({
                    "text": clean, "mask": mask, "max_w": max_w, "lim": lim,
                    "result": [L.runs_markup(L.line_runs(ln)) for ln in lines]})

    # 5) langpair parsing
    scripts = [
        ["Page 1", "こんにちは", "Hello", "ありがとう", "Thanks", "Page 2",
         "{}: 何ですか", "“”: What is it?"],
        ["Page 1", "JP\tEN", "こんにちは\tHello", "Vous êtes\tYou are",
         "Page 5", "Page 2", "SFX: boom", "ST: sign text"],
        ["--- Page 3 ---", "Sakamoto: Hi there", "[Page 5]", "Page 4",
         "line", "Page", "unnumbered follows", "Seite 7", "Turn the page"],
        ["JP", "EN", "日本語の文", "An English line", "Another", "もう一つ"],
        ["Only English", "Every line", "is its own unit"],
        ["Page 4-5", "spread line", "=== PAGE 12 ===", "last"],
        ["", "   ", "Act93: Takaya", "(): whisper", "//: note text",
         "TN: translator"],
    ]
    for sc in scripts:
        pairs, pp, pages = LP.pair_lines_paged(sc)
        out["pair"].append({"lines": sc, "result": {
            "pairs": [list(p) for p in pairs], "pair_pages": pp,
            "pages": [list(p) for p in pages]}})
    for t in ["こんにちは", "Hello", "漢字", "Mixed 日本 text", "12345", "",
              "ｶﾀｶﾅ", "Pokémon"]:
        out["misc"].append({"fn": "detect_lang", "args": [t],
                            "result": LP.detect_lang(t)})
    for t in ["Sakamoto: Hi there", "Act93: Takaya", "SFX: boom",
              "Mr. Smith: hello", "A B C D E: too many", "JP: header",
              "no colon here"]:
        out["misc"].append({"fn": "split_speaker", "args": [t],
                            "result": list(LP.split_speaker(t))})
    for t in ["Page 1", "PAGE 01", "Page1", "--- Page 3 ---", "[Page 5]",
              "=== PAGE 12 ===", "Page 4-5", "Seite 7", "Page", "Pages 3",
              "Turn the page", "page 4 - 5", "Seiten 2"]:
        out["misc"].append({"fn": "page_marker", "args": [t],
                            "result": LP.page_marker(t)})

    path = os.path.join(ROOT, "tests", "fixtures", "parity.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False)
    n = sum(len(v) for v in out.values())
    print("wrote %d parity cases (%d shape, %d fit) -> %s"
          % (n, len(out["shape"]), len(out["fit"]), path))


def _parse_bold(text):
    """Same as typer_kr.parse_bold (that module needs Qt to import)."""
    clean, mask, bold, i, n = [], [], False, 0, len(text)
    while i < n:
        if text[i] == "*" and i + 1 < n and text[i + 1] == "*":
            bold = not bold
            i += 2
            continue
        clean.append(text[i])
        mask.append(bold)
        i += 1
    return "".join(clean), mask


if __name__ == "__main__":
    sys.exit(main())
