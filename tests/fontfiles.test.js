// Name-table parser parity against the Krita parser on this machine's fonts
// (fixture from tools/export_fontnames.py; skipped when it is absent), plus
// the FontFileIndex lookup rules.
import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fontFileNames, FontFileIndex, collectFontFiles, fontZipNames, sparseFontHead } from "../src/core/fontfiles.js";
import { ROOT, makeChecker, deepEq } from "./helpers.js";

const FIX = path.join(ROOT, "tests", "fixtures", "fontnames.json");
const cmpPy = (a, b) => {
  // Python sorts strings by code point
  const A = Array.from(a);
  const B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i].codePointAt(0);
    const y = B[i].codePointAt(0);
    if (x !== y) return x - y;
  }
  return A.length - B.length;
};

test.skipIf(!fs.existsSync(FIX))("name tables parse like the Krita parser", () => {
  const want = JSON.parse(fs.readFileSync(FIX, "utf8"));
  const bad = [];
  for (const [p, [fams, fulls]] of Object.entries(want)) {
    if (!fs.existsSync(p)) continue;
    const [f, u] = fontFileNames(new Uint8Array(fs.readFileSync(p)));
    const gf = [...f].sort(cmpPy);
    const gu = [...u].sort(cmpPy);
    if (!deepEq(gf, fams) || !deepEq(gu, fulls)) bad.push({ p, gf, fams, gu, fulls });
  }
  expect(bad.slice(0, 3)).toEqual([]);
});

test.skipIf(!fs.existsSync(FIX))("reading only the name-table ranges gives the same names", async () => {
  const want = JSON.parse(fs.readFileSync(FIX, "utf8"));
  const paths = Object.keys(want).filter((p) => fs.existsSync(p)).slice(0, 400);
  const bad = [];
  let readBytes = 0;
  let fileBytes = 0;
  for (const p of paths) {
    const full = new Uint8Array(fs.readFileSync(p));
    fileBytes += full.length;
    const sparse = await sparseFontHead(full.length, async (off, len) => {
      readBytes += len;
      return full.subarray(off, off + len);
    });
    const a = fontFileNames(full);
    const b = fontFileNames(sparse);
    const norm = ([f, u]) => [[...f].sort(cmpPy), [...u].sort(cmpPy)];
    if (!deepEq(norm(a), norm(b))) bad.push(p);
  }
  expect(bad.slice(0, 5)).toEqual([]);
  expect(readBytes).toBeLessThan(fileBytes / 10);
});

test("FontFileIndex lookup", () => {
  const check = makeChecker();
  const table = {
    "C:/F/animeace.ttf": [["Anime Ace"], ["Anime Ace Regular"]],
    "C:/F/animeace_i.ttf": [["Anime Ace Italic"], ["Anime Ace Italic"]],
    "C:/F/animeace_b.ttf": [["Anime Ace"], ["Anime Ace Bold"]],
    "C:/F/badaboom.otf": [["BadaBoom Pro BB Regular"], ["BadaBoom Pro BB Regular"]],
    "C:/F/imag.ttf": [["ImaginaryFriendBBW00-Rg"], ["ImaginaryFriendBBW00-Rg"]],
    "C:/F/bahn.ttf": [["Bahnschrift"], ["Bahnschrift"]],
  };
  const idx = new FontFileIndex(Object.keys(table), (p) => table[p]);
  check("a family returns every cut (regular + bold + sibling italic family)",
    deepEq(idx.filesFor("Anime Ace").sort(), ["C:/F/animeace.ttf", "C:/F/animeace_b.ttf", "C:/F/animeace_i.ttf"]));
  check("full-name spelling resolves to the family files", idx.filesFor("BadaBoom Pro BB Regular").length === 1);
  check("the fontmatch ladder bridges repack names", deepEq(idx.filesFor("Imaginary Friend BB"), ["C:/F/imag.ttf"]));
  check("variable-font instance names trim to the base family", deepEq(idx.filesFor("Bahnschrift SemiBold Condensed"), ["C:/F/bahn.ttf"]));
  check("unknown family -> nothing", idx.filesFor("Nope Sans").length === 0);
  const [found, missing] = collectFontFiles(idx, ["Anime Ace", "anime ace", "", "Nope"]);
  check("collect: duplicates collapse, missing reported", Object.keys(found).length === 1 && deepEq(missing, ["Nope"]));
  const names = fontZipNames(["C:/a/x.ttf", "C:/b/x.ttf", "C:/a/x.ttf", "C:/a/y.otf"]);
  check("zip names: same base name from two folders survives numbered",
    deepEq(names.map((n) => n[1]), ["fonts/x.ttf", "fonts/x_1.ttf", "fonts/y.otf"]));
  expect(check.failed).toEqual([]);
});
