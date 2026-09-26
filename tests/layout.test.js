// Port of the layout.py sections of TypeR-Krita/test_typer_logic.py.
// Every Python check has a JS check of the same name and meaning.
import { test, expect } from "vitest";
import * as LO from "../src/core/layout.js";
import { makeChecker, installHyphLoader, monoMeasurer as M, falses, deepEq } from "./helpers.js";
import { split as pySplit } from "../src/core/py.js";

installHyphLoader();

const texts = (cand) => cand.lines.map((r) => LO.runsText(r));
const arr = (px, ...t) => ({ px, k: t.length, lines: t.map((x) => [[x, false]]) });
const sortedDesc = (xs) => [...xs].sort((a, b) => b - a);

test("per-line x positions + vertical text", () => {
  const check = makeChecker();
  check("line_x_positions center pre-centers each line by width",
    deepEq(LO.lineXPositions([100.0, 60.0], "center", 10, 200, 300), [150, 170]));
  check("line_x_positions left = same left for all",
    deepEq(LO.lineXPositions([100.0, 60.0], "left", 10, 200, 300), [10, 10]));
  check("line_x_positions right = right edge minus width",
    deepEq(LO.lineXPositions([100.0, 60.0], "right", 10, 200, 300), [200, 240]));

  const vm = LO.verticalMeasurer(1.0);
  const [widthOf, spaceW] = vm(20);
  check("vertical_measurer: a run is characters * em, not advance widths", widthOf("abc") === 60);
  check("vertical_measurer: narrow and wide glyphs stack identically", widthOf("IIII") === widthOf("WWWW"));
  check("vertical_measurer: space advances a full em", spaceW === 20);
  check("vertical_measurer: line_h is the column advance = em * spacing", LO.verticalMeasurer(1.5)(20)[2] === 30);
  check("vertical_measurer: measures run lists too", widthOf([["ab", false], ["c", true]]) === 60);

  check("column_y_positions middle centers each column on its length",
    deepEq(LO.columnYPositions([100.0, 60.0], "middle", 10, 200, 300), [150, 170]));
  check("column_y_positions top = same top for all",
    deepEq(LO.columnYPositions([100.0, 60.0], "top", 10, 200, 300), [10, 10]));
  check("column_y_positions bottom = bottom edge minus length",
    deepEq(LO.columnYPositions([100.0, 60.0], "bottom", 10, 200, 300), [200, 240]));

  check("horizontal_start centers the block, first column rightmost", LO.horizontalStart("center", 0, 200, 0.0, 3, 20) === 120);
  check("horizontal_start right hugs the right edge", LO.horizontalStart("right", 0, 200, 0.0, 3, 20) === 190);
  check("horizontal_start left hugs the left edge", LO.horizontalStart("left", 0, 200, 0.0, 3, 20) === 50);
  check("horizontal_start honours padding", LO.horizontalStart("right", 0, 200, 0.1, 3, 20) === 180);
  const hs = LO.horizontalStart("center", 0, 200, 0.0, 3, 20);
  check("columns march leftwards from the first one", deepEq([0, 1, 2].map((i) => hs - i * 20), [120, 100, 80]));

  const vfit = LO.fitText("AAA BBB CCC", LO.verticalMeasurer(1.0), 120, 40, 20, 6, 0.0, "rect");
  check("fit_text with the vertical measurer wraps into columns", vfit !== null && vfit[1].length >= 2);
  expect(check.failed).toEqual([]);
});

test("TextShapR helpers", () => {
  const check = makeChecker();
  check("runs_markup wraps bold runs in **",
    LO.runsMarkup([["a ", false], ["b", true], [" c", false]]) === "a **b** c");
  check("runs_markup plain text unchanged", LO.runsMarkup([["hello", false]]) === "hello");

  const words = LO.makeWords("aa bb cc dd", falses(11));
  const r1 = LO.fitLinesK(words, M, 100, 100, 200, 1, 1);
  const r2 = LO.fitLinesK(words, M, 100, 100, 200, 1, 2);
  const r4 = LO.fitLinesK(words, M, 100, 100, 200, 1, 4);
  check("fit_lines_k k=1 gives one line", r1 !== null && r1[1].length === 1);
  check("fit_lines_k k=2 gives two lines", r2 !== null && r2[1].length === 2);
  check("fit_lines_k k=2 allows a bigger size than k=1", r2 !== null && r1 !== null && r2[0] > r1[0]);
  check("fit_lines_k k=4 = one word per line", r4 !== null && r4[1].length === 4 && r4[1].every((ws) => ws.length === 1));
  check("fit_lines_k k > word count -> None", LO.fitLinesK(words, M, 100, 100, 200, 1, 5) === null);

  const rw = LO.fitLinesWidth(words, M, 100, 100, 200, 1, 0.5);
  check("fit_lines_width narrower target -> more lines", rw !== null && rw[1].length >= 2 && rw[0] > 0);

  const [wmWid, wmSp] = M(10);
  const wl = LO.wrapGreedy(LO.makeWords("aa bb cc dd", falses(11)), wmWid, wmSp, 40.0);
  check("widow avoided: last line is not a lone word",
    deepEq(wl.map((ln) => ln.map((w) => w.text)), [["aa", "bb"], ["cc", "dd"]]));

  const gw = LO.makeWords("aa bb cc dd", falses(11));
  check("group_words splits at break-after indices",
    deepEq(LO.groupWords(gw, new Set([1])).map((ln) => ln.map((w) => w.text)), [["aa", "bb"], ["cc", "dd"]]));
  check("group_words with no breaks -> single line", LO.groupWords(gw, new Set()).length === 1);

  const cb = LO.shapeCandidates("aa bb cc dd", M, 100, 100, 200, 1, 0.0, { mode: "balanced" });
  check("balanced candidates exist", cb.length >= 3);
  check("balanced candidates ranked by quality score (best first)",
    deepEq(cb.map((c) => c.score), sortedDesc(cb.map((c) => c.score))));
  const cq = LO.shapeCandidates("stop right there criminal scum", M, 200, 150, 200, 1, 0.0);
  check("recommendation is quality-based, not merely the largest font",
    cq.length > 0 && cq[0].px !== Math.max(...cq.map((c) => c.px)));
  check("candidates are deduplicated", new Set(cb.map((c) => texts(c).join("|"))).size === cb.length);

  // score_arrangement
  const calm = arr(26, "aaaaa", "bbbbb", "ccccc");
  const cramped = arr(40, "aaaaa", "bbbbb");
  check("score prefers a calm ~60% fill over a cramped edge-to-edge block",
    LO.scoreArrangement(calm, M, 100, 100, 40) > LO.scoreArrangement(cramped, M, 100, 100, 40));
  check("score penalises a near-empty last line",
    LO.scoreArrangement(arr(20, "aaaa", "bbbb", "cccc"), M, 100, 100)
    > LO.scoreArrangement(arr(20, "aaaa", "bbbb", "c"), M, 100, 100));
  const dd = LO.dedupSimilar([arr(30, "aaaaa", "bbbbb"), arr(20, "aaaaa", "bbbbb"), arr(20, "aa", "bb bb cc")], M);
  check("dedup collapses a same-shape twin at another size", dd.length === 2);
  check("dedup keeps the first (best-ranked) of a group", dd[0].px === 30);
  check("score rewards a line break after punctuation",
    LO.scoreArrangement(arr(20, "well,", "okay"), M, 100, 100) > LO.scoreArrangement(arr(20, "well", "okay,"), M, 100, 100));
  check("score penalises a line that is only punctuation",
    LO.scoreArrangement(arr(20, "no", "oh way"), M, 100, 100) > LO.scoreArrangement(arr(20, "..", "oh way"), M, 100, 100));
  const long = arr(20, "aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb");
  check("score penalises lines longer than the reading measure",
    LO.scoreArrangement(long, M, 400, 400, null, 40) > LO.scoreArrangement(long, M, 400, 400, null, 10));
  check("score penalises a short interior line",
    LO.scoreArrangement(arr(20, "aaaaa", "bbbbb", "ccccc"), M, 100, 100)
    > LO.scoreArrangement(arr(20, "aaaaa", "b", "ccccc"), M, 100, 100));
  const four = arr(20, "aa", "bb", "cc", "dd");
  check("lineTarget rewards arrangements near the target line count",
    LO.scoreArrangement(four, M, 100, 100, null, null, 4) > LO.scoreArrangement(four, M, 100, 100, null, null, 1));

  // ideal line count
  const idealTall = LO.idealLineCount(1000, 20, 0.4);
  const idealWide = LO.idealLineCount(1000, 20, 3.5);
  check("a tall bubble asks for more lines than a wide one", idealTall > idealWide + 1);
  check("the ideal line count does not move with the font size",
    Math.abs(LO.idealLineCount(2000, 40, 1.0) - LO.idealLineCount(1000, 20, 1.0)) < 1e-9);
  check("the ideal line count stays inside the mode's band",
    LO.idealLineCount(10 ** 6, 20, 0.2, LO.profileFor("wide")) <= LO.profileFor("wide").lines[1]);
  check("what physically fits caps the ideal",
    LO.idealLineCount(10 ** 6, 20, 0.2, LO.profileFor("tall"), 3) <= 3);
  check("profile_for falls back to balanced for an unknown mode",
    LO.profileFor("nonsense") === LO.profileFor("balanced") && LO.profileFor("tall") !== LO.profileFor("balanced"));

  const tallText = "you really think you can beat me with a stunt like that";
  const tallcands = LO.shapeCandidates(tallText, M, 150, 380, 40, 6, 0.12, { mode: "balanced" });
  const [, , , tbw, tbh] = LO.arrMetrics(tallcands[0], M);
  check("a tall bubble gets a block that fills it", (tbw * tbh) / (150 * 0.88 * 380 * 0.88) > 0.55);
  const ladder = LO.shapeCandidates(tallText, M, 150, 380, 40, 6, 0.12, { mode: "tall" });
  check("tall mode stays inside its line band", ladder[0].k <= LO.profileFor("tall").lines[1]);
  const sane = arr(30, "you", "really", "think", "you can", "beat me", "with a", "stunt", "like", "that");
  const ladderArr = arr(30, "you", "really", "think", "you", "can", "beat", "me", "with a", "stunt", "like", "that");
  check("tall mode does not reward a ladder of one-word lines",
    LO.scoreArrangement(sane, M, 132, 334, 30, null, null, "tall")
    > LO.scoreArrangement(ladderArr, M, 132, 334, 30, null, null, "tall"));

  // smoothness, sentence breaks, phrase integrity
  const even = arr(20, "aaaaaaa", "aaaaaaa", "aaaaaaa");
  const taper = arr(20, "aaaaaaaaaaa", "aaaaaaa", "aaa");
  check("score prefers an even stack over a tapering one",
    LO.scoreArrangement(even, M, 200, 200) > LO.scoreArrangement(taper, M, 200, 200));
  const midsent = arr(20, "it was a trap. Now", "we have to run");
  const atstop = arr(20, "it was a trap.", "Now we have to run");
  check("score penalises a sentence starting at the end of a line",
    LO.scoreArrangement(atstop, M, 200, 200) > LO.scoreArrangement(midsent, M, 200, 200));
  check("the charge is on the mid-line sentence end itself",
    LO.sentenceBreakPenalty(["it was a trap. Now", "we have to run"]) === 1
    && LO.sentenceBreakPenalty(["it was a trap.", "Now we have to run"]) === 0);
  check("an avoidable phrase split is charged, a forced one is not",
    LO.phraseBreakPenalty(["what", "no", "way"], [40, 20, 30], 5, 400) > 0
    && LO.phraseBreakPenalty(["what", "no", "way"], [40, 20, 30], 5, 45) === 0);
  check("a clause end is always a fine place to break",
    LO.phraseBreakPenalty(["what?", "no", "way"], [40, 20, 30], 5, 400)
    < LO.phraseBreakPenalty(["what", "no", "way"], [40, 20, 30], 5, 400));
  const touch = arr(40, "aaaaa", "aaaaa");
  const clear = arr(34, "aaaaa", "aaaaa");
  check("score penalises a block that touches the bubble rim",
    LO.scoreArrangement(clear, M, 100, 120, 40) > LO.scoreArrangement(touch, M, 100, 120, 40));

  // sampled bubble outline
  const ellipse = [0.3, 0.7, 0.95, 1.0, 0.95, 0.7, 0.3];
  check("shape_row_width interpolates between samples",
    LO.shapeRowWidth(ellipse, 0.5) > 0.7 && LO.shapeRowWidth(ellipse, 0.5) <= 1.0 && LO.shapeRowWidth(ellipse, 0.0) < 0.5);
  check("shape_row_width answers 1.0 without an outline",
    LO.shapeRowWidth(null, 0.5) === 1.0 && LO.shapeRowWidth([], 0.2) === 1.0);
  check("shape_row_width never returns a zero target", LO.shapeRowWidth([0.0, 0.0], 0.5) >= LO.ROW_FLOOR);
  check("line_row_targets samples one width per line",
    LO.lineRowTargets(ellipse, 4).length === 4 && deepEq(LO.lineRowTargets(null, 3), [1, 1, 1]));
  const centred = LO.lineRowTargets(ellipse, 3, 30, 300);
  const spread = LO.lineRowTargets(ellipse, 3);
  check("a short block is measured against the middle of the bubble",
    Math.min(...centred) > 0.9 && Math.min(...spread) < 0.8);
  check("a block filling the bubble is measured across its whole height",
    deepEq(LO.lineRowTargets(ellipse, 3, 300, 300), spread));
  const lens = arr(20, "aaaaaa", "aaaaaaaa", "aaaaaa");
  const rect = arr(20, "aaaaaaa", "aaaaaaa", "aaaaaaa");
  const sc = (c, w, h, rows) => LO.scoreArrangement(c, M, w, h, null, null, null, null, null, rows);
  check("with an outline, a lens beats a rectangle in a round bubble", sc(lens, 200, 90, ellipse) > sc(rect, 200, 90, ellipse));
  check("without an outline the rectangle is still the even shape", sc(rect, 200, 90) > sc(lens, 200, 90));
  check("a small block in a big round bubble is judged rectangular", sc(rect, 200, 260, ellipse) > sc(lens, 200, 260, ellipse));
  const blk = arr(20, "aaaaaa", "aaaaaa");
  check("fill is judged against the outline, not the bounding box", sc(blk, 300, 300, ellipse) !== sc(blk, 300, 300));
  const withRows = LO.shapeCandidates("aa bb cc dd ee", M, 120, 120, 40, 6, 0.1, { shapeRows: ellipse });
  check("shape_candidates accepts an outline and still ranks by score",
    deepEq(withRows.map((c) => c.score), sortedDesc(withRows.map((c) => c.score))));
  const rc = LO.shapeCandidates("aa bb cc dd ee ff", M, 140, 140, 40, 6, 0.1, { mode: "round" });
  check("round mode ranks by score, not by size", deepEq(rc.map((c) => c.score), sortedDesc(rc.map((c) => c.score))));

  const starved = LO.shapeCandidates("Unbelievable", M, 60, 200, 40, 6, 0.1);
  check("a starved set is rescued with hyphenated alternatives",
    starved.length > 1 && starved.some((c) => LO.runsText(c.lines[0]).includes("-")));
  check("a healthy set is not hyphenated behind the user's back",
    !LO.shapeCandidates("aa bb cc dd", M, 200, 200, 40, 6, 0.1)
      .some((c) => c.lines.some((r) => LO.runsText(r).includes("-"))));

  // de-hyphenation
  check("dehyphenate rejoins a lowercase continuation", LO.dehyphenate("embar- rassing")[0] === "embarrassing");
  check("dehyphenate keeps a capitalised compound hyphenated", LO.dehyphenate("Spider- Man")[0] === "Spider-Man");
  check("dehyphenate leaves an ordinary in-word hyphen alone", LO.dehyphenate("X-ray vision")[0] === "X-ray vision");
  check("dehyphenate keeps a name + honorific hyphenated",
    LO.dehyphenate("Yagi- kun")[0] === "Yagi-kun" && LO.dehyphenate("Tanaka- senpai")[0] === "Tanaka-senpai"
    && LO.dehyphenate("onii- chan!")[0] === "onii-chan!");
  check("dehyphenate still rejoins an ordinary broken word", LO.dehyphenate("trans- lation")[0] === "translation");

  // existing hyphen breaks
  const yk = LO.makeWords("Yagi-kun", falses(8))[0];
  check("an existing hyphen is offered as the break point", deepEq(LO.hyphenate("Yagi-kun", "en"), [5]));
  const [yl, yr] = LO.splitWord(yk, 5);
  check("breaking at an existing hyphen adds no second hyphen", yl.text === "Yagi-" && yr.text === "kun");
  check("no double hyphen for any compound",
    ["well-known", "Spider-Man", "part-time-job", "mother-in-law"].every((w) =>
      LO.hyphenate(w, "en").every((i) => !LO.splitWord(LO.makeWords(w, falses(w.length))[0], i)[0].text.endsWith("--"))));
  check("both the hyphen and the parts' own breaks are offered", deepEq(LO.hyphenate("Spider-Man", "en"), [3, 7]));
  check("a plain word hyphenates exactly as before", deepEq(LO.hyphenate("embarrassing", "en"), [2, 5, 9]));
  check("punctuation after a compound does not move the break",
    deepEq(LO.hyphenate("Yagi-kun!", "en"), [5]) && deepEq(LO.hyphenate("Yagi-kun's", "en"), [5]));
  check("the minimum letters still apply across the hyphen", deepEq(LO.hyphenate("a-b", "en"), []));
  const hy = LO.shapeCandidates("Yagi-kun is waiting outside", M, 90, 260, 40, 6, 0.1, { hyphenate: true });
  check("the shaper never emits a doubled hyphen",
    hy.length > 0 && !hy.some((c) => c.lines.some((r) => LO.runsText(r).includes("--"))));
  const [ht, hm] = LO.dehyphenate("big- Bang", [false, false, false, false, false, true, true, true, true]);
  check("dehyphenate realigns the bold mask",
    ht === "big-Bang" && deepEq(hm, [false, false, false, false, true, true, true, true]));
  const cdh = LO.shapeCandidates("hyphen- ation works", M, 200, 200, 60, 1, 0.0, { dehyphenate: true });
  check("shape_candidates de-hyphenates when asked",
    cdh.length > 0 && cdh.every((c) => !texts(c).join(" ").includes("- "))
    && cdh.some((c) => texts(c).join(" ").toLowerCase().includes("hyphenation")));

  const ct = LO.shapeCandidates("aa bb cc dd", M, 100, 100, 200, 1, 0.0, { mode: "tall" });
  const cw = LO.shapeCandidates("aa bb cc dd", M, 100, 100, 200, 1, 0.0, { mode: "wide" });
  check("tall leans to at least as many lines as wide", ct.length && cw.length && ct[0].k >= cw[0].k);
  check("tall candidates ranked by score (best first)", deepEq(ct.map((c) => c.score), sortedDesc(ct.map((c) => c.score))));
  check("wide candidates ranked by score (best first)", deepEq(cw.map((c) => c.score), sortedDesc(cw.map((c) => c.score))));
  const cr = LO.shapeCandidates("aa bb cc dd ee ff", M, 120, 120, 200, 1, 0.0, { mode: "round" });
  check("round mode produces ellipse candidates", cr.length >= 1);
  const ch = LO.shapeCandidates("hyphenation hyphenation", M, 60, 300, 60, 1, 0.0, { mode: "balanced", hyphenate: true, lang: "en" });
  check("hyphenation toggle produces hyphenated lines", ch.some((c) => texts(c).some((t) => t.includes("-"))));

  check("hyphenate: plain word breaks at syllables", deepEq(LO.hyphenate("EMBARRASSING", "en"), [2, 5, 9]));
  check("hyphenate: trailing punctuation does not disable it", deepEq(LO.hyphenate("EMBARRASSING!", "en"), [2, 5, 9]));
  check("hyphenate: quotes/brackets shift the break indices", deepEq(LO.hyphenate("(embarrassing)", "en"), [3, 6, 10]));
  check("hyphenate: split keeps the punctuation on its part",
    deepEq(LO.splitWord(LO.makeWords("EMBARRASSING!", falses(13))[0], 5).map((w) => w.text), ["EMBAR-", "RASSING!"]));
  check("hyphenate: still nothing to break in a short word",
    deepEq(LO.hyphenate("SO!", "en"), []) && deepEq(LO.hyphenate("THIS", "en"), []));
  check("hyphenate: a word of only punctuation is no word",
    deepEq(LO.hyphenate("!!!", "en"), []) && deepEq(LO.hyphenate("...", "en"), []));
  const chp = LO.shapeCandidates("THIS IS SO EMBARRASSING!", M, 60, 300, 60, 1, 0.0, { mode: "balanced", hyphenate: true, lang: "en" });
  check("hyphenation splits a word with a trailing '!'", chp.some((c) => texts(c).some((t) => t.includes("-"))));

  const wrapTexts = (maxW, ladderCap = LO.HYPH_MAX_LADDER, splitsCap = LO.HYPH_MAX_WORD_SPLITS) => {
    const ws = LO.makeWords("THIS IS SO EMBARRASSING!", falses(24));
    const [wo, sp] = M(20);
    return LO.wrapGreedy(ws, wo, sp, maxW, (w) => LO.hyphenate(w.text, "en"), ladderCap, splitsCap)
      .map((ln) => LO.runsText(LO.lineRuns(ln)));
  };
  const maxHyphenRun = (ts) => {
    let best = 0;
    let run = 0;
    for (const t of ts) {
      run = t.endsWith("-") ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  };
  const hyphens = (ts) => ts.filter((t) => t.endsWith("-")).length;
  const narrow = [45.0, 55.0, 60.0, 70.0, 80.0, 90.0];
  check("a long word is hyphenated even after a filled line", narrow.every((w) => hyphens(wrapTexts(w)) >= 1));
  check("by default one word is broken only once", narrow.every((w) => hyphens(wrapTexts(w)) <= 1));
  check("hyphen ladder never exceeds two lines in a row",
    narrow.every((w) => maxHyphenRun(wrapTexts(w, LO.HYPH_MAX_LADDER, 0)) <= 2));
  check("without the limits the same wrap splits more often",
    narrow.some((w) => hyphens(wrapTexts(w, 0, 0)) > hyphens(wrapTexts(w))));
  check("limits never lose or add text",
    narrow.every((w) => wrapTexts(w).join("").replace(/-/g, "").replace(/ /g, "") === "THISISSOEMBARRASSING!"));

  const fx = LO.makeWords("aa bb cc dd", falses(11));
  const fixed = [fx.slice(0, 2), fx.slice(2)];
  const ff = LO.fitFixedLines(fixed, M, 100, 100, 200, 1);
  check("fit_fixed_lines keeps the given breaks",
    ff !== null && deepEq(ff[1].map((ln) => ln.map((w) => w.text)), [["aa", "bb"], ["cc", "dd"]]));
  check("fit_fixed_lines finds the same size as the balanced fit", ff !== null && r2 !== null && ff[0] === r2[0]);
  check("fit_fixed_lines: a smaller box yields a smaller size", LO.fitFixedLines(fixed, M, 50, 100, 200, 1)[0] < ff[0]);
  check("fit_fixed_lines: nothing to fit -> None",
    LO.fitFixedLines([], M, 100, 100, 200, 1) === null && LO.fitFixedLines(fixed, M, 1, 1, 200, 100) === null);
  check("empty text -> no candidates", LO.shapeCandidates("   ", M, 100, 100, 200, 1, 0.0).length === 0);
  check("candidate limit respected",
    LO.shapeCandidates("a b c d e f g h i j k l m n", M, 100, 100, 200, 1, 0.0, { limit: 5 }).length <= 5);

  // layer naming
  check("typer_layer_prefix zero-pads to two digits", LO.typerLayerPrefix(3) === "TypeR 03 — ");
  check("typer_layer_prefix keeps three digits", LO.typerLayerPrefix(123) === "TypeR 123 — ");
  check("is_typer_layer_name matches its own unit", LO.isTyperLayerName("TypeR 03 — DON'T MOVE", 3));
  check("is_typer_layer_name: other unit does not match", !LO.isTyperLayerName("TypeR 03 — DON'T MOVE", 13));
  check("is_typer_layer_name: 13 does not match a 3-layer", !LO.isTyperLayerName("TypeR 13 — HELLO", 3));
  check("is_typer_layer_name needs the full prefix (dash + spaces)",
    !LO.isTyperLayerName("TypeR03", 3) && !LO.isTyperLayerName("TypeR 03 -", 3));
  check("is_typer_layer_name: unrelated / empty names never match",
    !LO.isTyperLayerName("Background", 3) && !LO.isTyperLayerName("", 3) && !LO.isTyperLayerName(null, 3));
  check("is_typer_layer_name: single-digit unit zero-padded",
    LO.isTyperLayerName("TypeR 07 — text", 7) && !LO.isTyperLayerName("TypeR 7 — text", 7));

  const pick = cb[0];
  const baked = pick.lines.map((r) => LO.runsMarkup(r)).join("\n");
  const refit = LO.fitText(baked, M, 100, 100, pick.px, 1, 0.0);
  check("baked hard breaks reproduce the arrangement",
    refit !== null && refit[0] === pick.px && deepEq(refit[1].map((r) => LO.runsText(r)), texts(pick)));
  expect(check.failed).toEqual([]);
});

test("TextShapR line-break quality", () => {
  const check = makeChecker();
  check("_word_is_stop flags a dangling preposition/article",
    LO.wordIsStop("to") && LO.wordIsStop("the") && LO.wordIsStop("a"));
  check("_word_is_stop ignores content words", !LO.wordIsStop("homework") && !LO.wordIsStop("run"));
  check("a word that ends a clause is a fine break, not a stop", !LO.wordIsStop("to,") && !LO.wordIsStop("the."));
  check("_bare_last strips quotes/brackets + lowercases", LO.bareLast("(The") === "the" && LO.bareLast("to") === "to");

  const a = arr(40, "I run to", "the end");
  const b = arr(40, "I run ox", "the end");
  const d = LO.scoreArrangement(b, M, 200, 200) - LO.scoreArrangement(a, M, 200, 200);
  check("a line ending on a dangling stop-word scores lower", d > 0.29 && d < 0.31);

  const shp = LO.shapeCandidates("we should try to find a way to fix this before it gets worse", M, 260, 320, 200, 6, 0.1, { mode: "balanced" });
  const top = shp[0].lines.map((r) => LO.runsText(r));
  check("top shape keeps function words attached (no dangling stop-word)",
    !top.slice(0, -1).some((L) => {
      const p = pySplit(L);
      return p.length && LO.LINE_END_STOPS.has(LO.bareLast(p[p.length - 1]));
    }));
  check("top shape avoids a single-word widow last line", top.length < 2 || pySplit(top[top.length - 1]).length >= 2);

  const p0 = LO.shapeCandidates("BIG LOUD TEXT", M, 200, 100, 200, 6, 0.0);
  const p1 = LO.shapeCandidates("BIG LOUD TEXT", M, 200, 100, 200, 6, 0.0, { inset: 20 });
  check("an outline inset shrinks the fitted size (no overflow)", p0.length && p1.length && p1[0].px < p0[0].px);
  const pool = LO.shapeCandidates("make sure you plan out all of your summer homework tonight", M, 260, 320, 200, 6, 0.1);
  check("shaper offers several distinct shapes to choose from", new Set(pool.map((c) => c.k)).size >= 3);
  check("_word_is_conj flags a leading conjunction",
    LO.wordIsConj("but") && LO.wordIsConj("and") && !LO.wordIsConj("homework"));
  expect(check.failed).toEqual([]);
});
