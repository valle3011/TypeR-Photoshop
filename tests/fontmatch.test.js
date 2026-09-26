// Port of TypeR-Krita/test_fontmatch.py (+ difflib ratio spot checks).
import { test, expect } from "vitest";
import * as FM from "../src/core/fontmatch.js";
import { ratio } from "../src/core/difflib.js";
import { makeChecker, deepEq } from "./helpers.js";

const INSTALLED = [
  "Anime Ace", "Anime Ace 2.0 BB", "Anime Ace v3",
  "BadaBoom BB",
  "BoogersBB iCielTB",
  "Bold Wicker",
  "CCBattleCry", "CCBattleCry-Regular",
  "CCBeyondBelief", "CCBeyondBelief Heavy",
  "CC Wild Words",
  "CDX Amraam", "CDX Hollow", "Cdx Noodle Doodle", "CDX Seven Cent Pen",
  "CryptCreep Heavy BB",
  "ImaginaryFriendBBW00-Rg",
  "SS Cryptid",
  "Arial", "Comic Sans MS", "Impact",
];

test("difflib ratio matches CPython", () => {
  // values computed with CPython's difflib.SequenceMatcher(None, a, b).ratio()
  expect(ratio("abcd", "bcde")).toBeCloseTo(0.75, 12);
  expect(ratio("ccwildwords", "ccwildwordslower")).toBeCloseTo(0.8148148148148148, 12);
  expect(ratio("", "")).toBe(1.0);
  expect(ratio("private", "privet")).toBeCloseTo(0.7692307692307693, 12);
  expect(ratio("cdxamram", "cdxamraam")).toBeCloseTo(0.9411764705882353, 12);
});

test("fontmatch ladder", () => {
  const check = makeChecker();
  const idx = new FM.FontIndex(INSTALLED);
  const fam = (n, fuzzy = true) => {
    const m = idx.resolve(n, fuzzy);
    return m ? m.family : null;
  };
  const tier = (n) => {
    const m = idx.resolve(n);
    return m ? m.tier : null;
  };
  check("camelCase splits into words", deepEq(FM.tokens("CCWildWords"), ["cc", "wild", "words"]));
  check("spaced spelling tokenises the same", deepEq(FM.tokens("CC Wild Words"), FM.tokens("CCWildWords")));
  check("version numbers stay in one piece", deepEq(FM.tokens("Anime Ace 2.0"), ["anime", "ace", "2.0"]));
  check("Fonts.com W-tag is debris", !FM.tokens("ImaginaryFriendBBW00-Rg").includes("w00"));
  check("iCiel branding is debris", !FM.tokens("BoogersBB iCielTB").includes("iciel"));
  check("OnlineWebFonts pointer prefix is ignored", deepEq(FM.tokens("☞CCBattleCry"), ["cc", "battle", "cry"]));
  check("squash drops spacing and case", FM.squash("CC Wild Words") === FM.squash("ccwildwords"));
  check("trailing Italic is a cut", deepEq(FM.splitCut(["anime", "ace", "italic"]), [["anime", "ace"], false, true]));
  check("trailing Regular is a cut", deepEq(FM.splitCut(["cc", "battle", "cry", "regular"])[0], ["cc", "battle", "cry"]));
  check("leading Bold is part of the name", deepEq(FM.splitCut(["bold", "wicker"]), [["bold", "wicker"], false, false]));
  check("a name that is only a cut word survives", deepEq(FM.splitCut(["regular"]), [["regular"], false, false]));

  check("tier 1 exact", fam("CDX Amraam") === "CDX Amraam" && tier("CDX Amraam") === "exact");
  check("tier 2 case-insensitive", fam("cdx amraam") === "CDX Amraam" && tier("cdx amraam") === "case");
  check("tier 3 squashed: CCWildWords -> CC Wild Words", fam("CCWildWords") === "CC Wild Words" && tier("CCWildWords") === "squash");
  check("tier 3 squashed: CDX NoodleDoodle -> Cdx Noodle Doodle", fam("CDX NoodleDoodle") === "Cdx Noodle Doodle");
  check("tier 4 tokens: Anime Ace Italic -> Anime Ace", fam("Anime Ace Italic") === "Anime Ace" && tier("Anime Ace Italic") === "tokens");
  check("tier 5 tags dropped: Anime Ace 2.0 -> Anime Ace 2.0 BB",
    fam("Anime Ace 2.0") === "Anime Ace 2.0 BB" && tier("Anime Ace 2.0") === "tokens-notags");
  check("tier 5: Imaginary Friend BB -> the W00 repack", fam("Imaginary Friend BB") === "ImaginaryFriendBBW00-Rg");
  check("tier 5: Boogers BB -> the iCiel repack", fam("Boogers BB") === "BoogersBB iCielTB");
  check("tier 5: Wild Words -> CC Wild Words", fam("Wild Words") === "CC Wild Words");
  let m = idx.resolve("Anime Ace Italic");
  check("italic cut is carried on the Match", m.italic && !m.bold);
  m = idx.resolve("CCBeyondBelief Heavy");
  check("a real family wins over cut-stripping", m.family === "CCBeyondBelief Heavy" && m.tier === "exact");
  check("duplicate registrations pick the shorter name", fam("CC Battle Cry") === "CCBattleCry");
  check("picking is stable across calls", fam("CC Battle Cry") === fam("CC Battle Cry"));
  check("BadaBoom Pro BB is not BadaBoom BB", fam("BadaBoom Pro BB") === null);
  check("CCWildWordsLower Italic is not CC Wild Words", fam("CCWildWordsLower Italic") === null);
  check("Astounder Round LC BB is not Astounder Round BB",
    new FM.FontIndex(["Astounder Round BB"]).resolve("Astounder Round LC BB") === null);
  check("CDX Sidewinder is not CDX Seven Cent Pen", fam("CDX Sidewinder") === null);
  check("a face nobody installed stays missing", fam("Telefante") === null);
  check("Comic Neue is not Comic Sans MS", fam("Comic Neue") === null);
  check("fuzzy can be switched off", fam("CDX Amram", false) === null);
  check("fuzzy rescues a typo when on", fam("CDX Amram") === "CDX Amraam");
  check("None resolves to nothing", idx.resolve(null) === null);
  check("blank resolves to nothing", idx.resolve("   ") === null);
  check("empty index resolves to nothing", new FM.FontIndex([]).resolve("Arial") === null);
  check("index tolerates blanks in the family list", new FM.FontIndex(["", null, "Arial"]).resolve("Arial") !== null);
  const custom = new FM.FontIndex(INSTALLED, { "Zud Juice": "Impact" });
  check("a caller alias bridges unrelated names", custom.familyOf("Zud Juice") === "Impact");
  check("an alias to something uninstalled still misses", new FM.FontIndex(["Arial"], { X: "Nope" }).resolve("X") === null);
  const wanted = ["CDX Amraam", "CCWildWords", "BadaBoom Pro BB", "Telefante"];
  const [res, ren, mis] = idx.report(wanted);
  check("report separates exact hits", deepEq(res, ["CDX Amraam"]));
  check("report lists forgiving hits with their Match",
    deepEq(ren.map(([w]) => w), ["CCWildWords"]) && ren[0][1].family === "CC Wild Words");
  check("report lists the genuinely missing", deepEq(mis, ["BadaBoom Pro BB", "Telefante"]));
  check("missing() keeps the original spelling", deepEq(idx.missing(wanted), ["BadaBoom Pro BB", "Telefante"]));
  check("is_available agrees with resolve", idx.isAvailable("CCWildWords") === true);
  check("family_of falls back", idx.familyOf("Telefante", "Arial") === "Arial");
  expect(check.failed).toEqual([]);
});
