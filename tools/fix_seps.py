"""Replace raw U+2028/U+2029/U+0085 in JS sources with escapes (they are line
terminators inside JS regex literals)."""
import glob
import sys

ESC = {" ": "\\u2028", " ": "\\u2029", "\u0085": "\\x85"}
for f in glob.glob("src/**/*.js", recursive=True) + glob.glob("tests/*.js"):
    s = open(f, encoding="utf-8").read()
    t = "".join(ESC.get(c, c) for c in s)
    if t != s:
        open(f, "w", encoding="utf-8", newline="\n").write(t)
        print("fixed", f)
sys.exit(0)
