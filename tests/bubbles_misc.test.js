// Port of the balloons / bubbles / layoutmodel / SFX sections of
// TypeR-Krita/test_typer_logic.py.
import { test, expect } from "vitest";
import * as BL from "../src/core/balloons.js";
import * as BB from "../src/core/bubbles.js";
import * as LM from "../src/core/layoutmodel.js";
import * as MD from "../src/core/sfx/modes.js";
import * as RS from "../src/core/sfx/rule_search.js";
import * as AB from "../src/core/ai.js";
import { makeChecker, deepEq } from "./helpers.js";

const pathPoints = (d) => {
  const nums = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
};
const segDist = (p, a, b) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy;
  if (L2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0.0, Math.min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
};

test("balloon shape library", () => {
  const check = makeChecker();
  check("SHAPE_ORDER lists every shape exactly once",
    deepEq([...BL.SHAPE_ORDER].sort(), Object.keys(BL.SHAPES).sort()) && new Set(BL.SHAPE_ORDER).size === BL.SHAPE_ORDER.length);
  check("every shape maps to a text type", deepEq(Object.keys(BL.SHAPE_FOR_TYPE).sort(), Object.keys(BL.SHAPES).sort()));
  check("unknown shape -> None", BL.balloonPath("banana", 0, 0, 100, 70) === null);
  check("degenerate box -> None", BL.balloonPath("oval", 0, 0, 0, 70) === null);
  for (const s of BL.SHAPE_ORDER) {
    const d = BL.balloonPath(s, 10, 20, 200, 140);
    check(`${s}: produces a closed path`, d !== null && d.startsWith("M") && d.endsWith("Z"));
    const pts = pathPoints(d);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    check(`${s}: fills the box it was given`,
      Math.abs(Math.min(...xs) - 10) < 0.6 && Math.abs(Math.max(...xs) - 210) < 0.6
      && Math.abs(Math.min(...ys) - 20) < 0.6 && Math.abs(Math.max(...ys) - 160) < 0.6);
  }
  check("round shapes are smoothed into beziers", BL.balloonPath("cloud", 0, 0, 100, 70).includes("C"));
  check("angular shapes stay polygons", !BL.balloonPath("burst", 0, 0, 100, 70).includes("C"));
  check("a burst has deeper spikes than a radio balloon", BL.modBurst(0.0, 1) < BL.modRadio(0.0, 1));
  check("rough is deterministic", BL.balloonPath("rough", 0, 0, 100, 70) === BL.balloonPath("rough", 0, 0, 100, 70));
  check("rough is not a plain oval", BL.balloonPath("rough", 0, 0, 100, 70) !== BL.balloonPath("oval", 0, 0, 100, 70));
  check("cloud gets a circle trail, not a spike", deepEq(BL.tailPath("cloud", 0, 0, 100, 70).map((t) => t.kind), ["circle", "circle"]));
  check("oval gets a pointed tail", deepEq(BL.tailPath("oval", 0, 0, 100, 70).map((t) => t.kind), ["path"]));
  check("the tail hangs below the balloon box", Math.max(...pathPoints(BL.tailPath("oval", 0, 0, 100, 70)[0].d).map((p) => p[1])) > 70);
  for (const s of ["oval", "burst", "radio", "wavy", "rough", "robot"]) {
    const outline = BL.shapePoints(s, 0, 0, 100, 70);
    const tpts = pathPoints(BL.tailPath(s, 0, 0, 100, 70)[0].d);
    const onOutline = tpts.filter((p) => p[1] <= 70.001);
    const off = onOutline.filter((p) => Math.min(...outline.map((_, i) => segDist(p, outline[i], outline[(i + 1) % outline.length]))) > 0.01);
    check(`${s}: the tail base follows the balloon outline`, off.length === 0);
    check(`${s}: the tail base spans a real width`, Math.max(...onOutline.map((p) => p[0])) - Math.min(...onOutline.map((p) => p[0])) > 15);
    check(`${s}: the tail reaches below the balloon`, Math.max(...tpts.map((p) => p[1])) > 70);
  }
  const svg = BL.balloonSvg("oval", 10, 20, 200, 140, 800, 1200);
  check("balloon_svg wraps a document at image size", svg.startsWith("<svg") && svg.includes('width="800"') && svg.includes('height="1200"'));
  check("balloon_svg is opaque white with a black stroke", svg.includes('fill="#ffffff"') && svg.includes('stroke="#000000"'));
  check("only the whisper balloon is dashed",
    BL.balloonSvg("dashed", 0, 0, 100, 70, 100, 100).includes("stroke-dasharray") && !svg.includes("stroke-dasharray"));
  check("balloon_svg without a tail is just the balloon",
    (BL.balloonSvg("oval", 0, 0, 100, 70, 100, 100, "#ffffff", "#000000", 3.0, false).match(/<path/g) || []).length === 1);
  check("balloon_svg: unknown shape -> None", BL.balloonSvg("banana", 0, 0, 100, 70, 100, 100) === null);
  expect(check.failed).toEqual([]);
});

const bx = (x, y, w = 60, h = 40, tag = "") => ({ x, y, w, h, tag });

test("bubbles: detection + mapping", () => {
  const check = makeChecker();
  check("reading order RTL", deepEq(BB.readingOrder([bx(10, 100, 60, 40, "L"), bx(300, 110, 60, 40, "R")], true).map((b) => b.tag), ["R", "L"]));
  check("reading order LTR", deepEq(BB.readingOrder([bx(10, 100, 60, 40, "L"), bx(300, 110, 60, 40, "R")], false).map((b) => b.tag), ["L", "R"]));
  check("stacked rows top first", deepEq(BB.readingOrder([bx(10, 300, 60, 40, "B"), bx(300, 100, 60, 40, "T")], true).map((b) => b.tag), ["T", "B"]));
  const panels = [bx(0, 0, 200, 400, "Lpanel"), bx(220, 0, 200, 400, "Rpanel")];
  const pb = [bx(20, 20, 60, 40, "L1"), bx(20, 250, 60, 40, "L2"), bx(240, 30, 60, 40, "R1"), bx(240, 260, 60, 40, "R2")];
  check("panel order: right panel first (RTL), top-to-bottom in panel", deepEq(BB.orderByPanels(pb, panels, true).map((b) => b.tag), ["R1", "R2", "L1", "L2"]));
  check("panel order: LTR reads left panel first", deepEq(BB.orderByPanels(pb, panels, false).map((b) => b.tag), ["L1", "L2", "R1", "R2"]));
  check("panel order: no panels -> falls back to flat reading_order",
    deepEq(BB.orderByPanels(pb, [], true).map((b) => b.tag), BB.readingOrder(pb, true).map((b) => b.tag)));
  check("panel order: bubble outside all panels still kept", BB.orderByPanels([...pb, bx(900, 900, 60, 40, "X")], panels, true).length === 5);
  check("insert_gap shifts down", deepEq(BB.insertGap([0, 1, 2], 1), [0, -1, 1]));
  check("remove_gap round-trip", deepEq(BB.removeGap(BB.insertGap([0, 1, 2], 1), 1, 3), [0, 1, 2]));
  check("next_unplaced: first open box", BB.nextUnplaced([0, 1, 2], new Set(), 0) === 0);
  check("next_unplaced: skips done units", BB.nextUnplaced([0, 1, 2], new Set([0, 1]), 0) === 2);
  check("next_unplaced: skips gaps", BB.nextUnplaced([0, -1, 1], new Set([0]), 0) === 2);
  check("next_unplaced: starts at given index", BB.nextUnplaced([0, 1, 2], new Set(), 1) === 1);
  check("next_unplaced: no wrap at end", BB.nextUnplaced([0, 1], new Set([0, 1]), 0) === null);
  check("next_unplaced: empty assign", BB.nextUnplaced([], new Set(), 0) === null);

  const selMask = (w, h, rects) => {
    const m = new Uint8Array(w * h);
    for (const [x0, y0, rw, rh] of rects) for (let y = y0; y < y0 + rh; y++) m.fill(255, y * w + x0, y * w + x0 + rw);
    return m;
  };
  const two = BB.regionsFromMask(selMask(200, 100, [[10, 10, 40, 40], [120, 20, 60, 50]]), 200, 100);
  check("two marquee parts -> two boxes", two.length === 2);
  check("first part keeps its own box", deepEq([two[0].x, two[0].y, two[0].w, two[0].h], [10, 10, 40, 40]));
  check("second part keeps its own box", deepEq([two[1].x, two[1].y, two[1].w, two[1].h], [120, 20, 60, 50]));
  check("a filled rectangle is classified rect", two[0].shape === "rect");
  const off = BB.regionsFromMask(selMask(200, 100, [[10, 10, 40, 40]]), 200, 100, [500, 300]);
  check("origin puts the box in document coordinates", deepEq([off[0].x, off[0].y], [510, 310]));
  check("touching parts stay one box", BB.regionsFromMask(selMask(200, 100, [[10, 10, 40, 40], [50, 10, 40, 40]]), 200, 100).length === 1);
  check("antialiased speck is not a bubble", BB.regionsFromMask(selMask(200, 100, [[10, 10, 40, 40], [150, 50, 2, 2]]), 200, 100).length === 1);
  check("empty selection -> no boxes", BB.regionsFromMask(selMask(200, 100, []), 200, 100).length === 0);
  check("no mask at all -> no boxes", BB.regionsFromMask(new Uint8Array(0), 0, 0).length === 0);
  const ell = BB.regionsFromMask(BB.ellipseMask(120, 90), 120, 90);
  check("an elliptical marquee is classified round", ell.length === 1 && ell[0].shape === "round");
  check("the ellipse still reports its full bounding box", ell[0].w === 120 && ell[0].h === 90);

  const bub = [{ kind: "bubble" }, { kind: "bubble" }, { kind: "bubble" }];
  check("units map 1:1 in box order", deepEq(BB.assignUnits(bub, 3), [[0, 1, 2], false]));
  check("more units than bubbles is a mismatch", deepEq(BB.assignUnits(bub, 5), [[0, 1, 2], true]));
  check("more bubbles than units leaves the rest unassigned", deepEq(BB.assignUnits(bub, 2), [[0, 1, -1], true]));
  check("an SFX box does not eat a line", deepEq(BB.assignUnits([{ kind: "bubble" }, { kind: "sfx" }, { kind: "bubble" }], 2), [[0, -1, 1], false]));
  check("a box marked skip does not eat a line either",
    deepEq(BB.assignUnits([{ kind: "bubble" }, { kind: "bubble", skip: true }, { kind: "bubble" }], 2), [[0, -1, 1], false]));
  check("first_unit starts the run mid-script (page 2 onwards)", deepEq(BB.assignUnits([{ kind: "bubble" }, { kind: "bubble" }], 4, 2), [[2, 3], false]));
  check("no boxes -> nothing assigned", deepEq(BB.assignUnits([], 3), [[], true]));
  check("work list pairs box with unit", deepEq(BB.batchPairs([0, -1, 1], 2), [[0, 0], [2, 1]]));
  check("work list leaves out units already typeset", deepEq(BB.batchPairs([0, -1, 1], 2, [0]), [[2, 1]]));
  check("work list drops a unit index past the end of the script", deepEq(BB.batchPairs([0, 5], 2), [[0, 0]]));
  check("work list of an empty assignment is empty", deepEq(BB.batchPairs([], 3), []));

  const words = [...BB.SFX_SEED_WORDS, "zuzun"];
  check("plain sfx word matches", BB.isSfxLine("doki", words));
  check("elongation matches ('GOGOGOGO')", BB.isSfxLine("GOGOGOGO", words));
  check("stretched letters match ('Dokii')", BB.isSfxLine("Dokii", words));
  check("decorated sfx matches ('Doki doki!!')", BB.isSfxLine("Doki doki!!", words));
  check("parenthesized action matches ('(Grin grin)')", BB.isSfxLine("(Grin grin)", words));
  check("user word matches", BB.isSfxLine("zuzun~", words));
  check("dialog with sfx word mid-sentence does NOT match", !BB.isSfxLine("The boom was loud", words));
  check("plain dialog does NOT match", !BB.isSfxLine("Isn't that great Hiyori?", words));
  check("interjection dialog does NOT match", !BB.isSfxLine("yeah...!", words));
  check("SFX: tag always matches", BB.isSfxLine("SFX: rumble of the crowd", words));
  check("empty line does NOT match", !BB.isSfxLine("  ", words));
  check("katakana matches", BB.isSfxLine("ドキドキ", words));
  check("hiragana matches", BB.isSfxLine("どきどき", words));
  check("kana repetition matches", BB.isSfxLine("ゴゴゴゴ", words));
  check("prolongation dropped", BB.isSfxLine("ドーン", words));
  check("small tsu dropped", BB.isSfxLine("ドキッ!!", words));
  check("digraph works", BB.isSfxLine("ぴょんぴょん", words));
  check("mufufu matches", BB.isSfxLine("ムフフ…", words));
  check("niyaniya matches", BB.isSfxLine("ニヤニヤ", words));
  check("kanji is real dialogue", !BB.isSfxLine("何ですか", words));
  check("kana dialogue does NOT match", !BB.isSfxLine("これはドキドキします", words));
  check("kana_to_romaji basics",
    BB.kanaToRomaji("ドキドキ") === "dokidoki" && BB.kanaToRomaji("ぴょん") === "pyon"
    && BB.kanaToRomaji("シャキーン") === "shakin" && BB.kanaToRomaji("漢字") === null);
  let [kept, skipped] = BB.splitUnitsSfx(["Hi there!", "gogogogo", "(Grin grin)", "...Mama?"], words);
  check("unit slice skips sfx lines", deepEq(kept, [0, 3]) && skipped === 2);
  [kept, skipped] = BB.splitUnitsSfx([], words);
  check("empty unit slice", deepEq(kept, []) && skipped === 0);
  check("missing db -> seed only", deepEq(BB.sfxDbFrom(null), [BB.SFX_SEED_WORDS, []]));
  const data = BB.sfxDbData(["zuzun", " ", "gohh"]);
  const [seed2, user2] = BB.sfxDbFrom(JSON.parse(JSON.stringify(data)));
  check("db round trip keeps user words", deepEq(user2, ["zuzun", "gohh"]) && deepEq(new Set(seed2).size, new Set(BB.SFX_SEED_WORDS).size));

  const W = 300;
  const H = 300;
  const page = new Uint8Array(W * H).fill(90);
  const fill = (x, y, w, h, val) => { for (let yy = y; yy < y + h; yy++) page.fill(val, yy * W + x, yy * W + x + w); };
  fill(38, 38, 104, 84, 10);
  fill(40, 40, 100, 80, 255);
  for (let k = 0; k < 6; k++) fill(87, 52 + k * 12, 6, 6, 20);
  const found = BB.detectBubbles(page, W, H, { maxGridW: W });
  check("heuristic finds the bubble", found.length === 1 && Math.abs(found[0].x - 40) <= 2 && Math.abs(found[0].w - 100) <= 2 && found[0].kind === "bubble");

  check("shape_from_fill: full bbox -> rect", BB.shapeFromFill(1.0) === "rect");
  check("shape_from_fill: ellipse ratio -> round", BB.shapeFromFill(0.785) === "round");
  check("shape_from_fill: threshold boundary", BB.shapeFromFill(BB.RECT_FILL_RATIO) === "rect" && BB.shapeFromFill(BB.RECT_FILL_RATIO - 0.01) === "round");
  const em = BB.ellipseMask(10, 10);
  check("ellipse_mask: length = w*h", em.length === 100);
  check("ellipse_mask: centre inside (255)", em[5 * 10 + 5] === 255);
  check("ellipse_mask: corner outside (0)", em[0] === 0 && em[9] === 0);
  const frac = em.reduce((a, v) => a + v, 0) / 255.0 / 100.0;
  check("ellipse_mask: ~pi/4 fill ratio", frac >= 0.70 && frac <= 0.85);
  check("ellipse_mask: degenerate -> empty", BB.ellipseMask(0, 5).length === 0);

  const boxes = AB.parseDetectJson(JSON.stringify({ boxes: [
    { x: 1, y: 2, w: 30, h: 40, kind: "bubble", score: 0.9 },
    { x: 5, y: 6, w: 20, h: 10, kind: "panel", score: 0.8 }] }));
  check("detect JSON parsed, unknown kind skipped", boxes.length === 1 && boxes[0].w === 30);
  let raised = false;
  try { AB.parseDetectJson("{nope"); } catch (e) { raised = e instanceof AB.AIRunError; }
  check("malformed detect JSON raises", raised);
  const lines = AB.makeYoloLabel([{ x: 100, y: 100, w: 200, h: 100, kind: "bubble" }, { x: 0, y: 0, w: 50, h: 50, kind: "sfx" }], 400, 200).trim().split("\n");
  check("yolo label classes + normalization", lines.length === 2 && lines[0].startsWith("0 0.5") && lines[1].startsWith("1 "));
  expect(check.failed).toEqual([]);
});

test("layoutmodel", () => {
  const check = makeChecker();
  const panelsOf = (cfg, id) => (cfg.tabs.find((t) => t.id === id) || { panels: null }).panels;
  const sortedAll = (cfg) => [...LM.allPlacedPanels(cfg)].sort();
  const ALL = [...LM.PANELS].sort();
  const d = LM.defaultLayout();
  check("default: every panel present exactly once", deepEq(sortedAll(d), ALL));
  check("default: presets lives in Type (no Presets tab)", panelsOf(d, "type").includes("presets") && d.tabs.every((t) => t.id !== "presets"));
  check("default: locked", d.locked === true);
  const m = LM.movePanel(d, "presets", "style", 0);
  check("move_panel: presets now first in Style", panelsOf(m, "style")[0] === "presets" && !panelsOf(m, "type").includes("presets"));
  check("move_panel: still every panel once", deepEq(sortedAll(m), ALL));
  check("move_panel: unknown panel is a no-op", deepEq(sortedAll(LM.movePanel(d, "nope", "type")), ALL));
  const r = LM.reorderPanel(d, "type", 0, 3);
  check("reorder_panel: script_box moved to index 3", panelsOf(r, "type")[3] === "script_box");
  check("reorder_panel: no panel lost", deepEq(sortedAll(r), ALL));
  const rn = LM.renameTab(d, "type", "Main");
  check("rename_tab", panelsOf(rn, "type") !== null && rn.tabs.find((t) => t.id === "type").name === "Main");
  const [at, nid] = LM.addTab(d, "Extra");
  check("add_tab: new empty tab appended", deepEq(panelsOf(at, nid), []) && at.tabs.length === 7);
  const rm = LM.removeTab(d, "bubblr");
  check("remove_tab: tab gone, panels rehomed not lost", rm.tabs.every((t) => t.id !== "bubblr") && deepEq(sortedAll(rm), ALL));
  let one = LM.defaultLayout();
  for (const id of ["style", "bubblr", "setup", "shapr", "sfx"]) one = LM.removeTab(one, id);
  check("remove_tab: refuses to delete the last tab", LM.removeTab(one, "type").tabs.length === 1);
  const ord = LM.reorderTabs(d, ["setup", "bubblr"]);
  check("reorder_tabs: listed first, rest appended in order", deepEq(ord.tabs.map((t) => t.id), ["setup", "bubblr", "type", "style", "shapr", "sfx"]));
  const det = LM.detach(d, ["bubblr_overlay"], 0);
  check("detach: panel leaves its tab", !panelsOf(det, "bubblr").includes("bubblr_overlay") && LM.isDetached(det, "bubblr_overlay"));
  check("detach: nothing lost overall", deepEq(sortedAll(det), ALL));
  const rea = LM.reattach(det, ["bubblr_overlay"], "bubblr");
  check("reattach: back in a tab, none detached", panelsOf(rea, "bubblr").includes("bubblr_overlay") && rea.detached.length === 0);
  const pl = LM.setPanelLocked(d, "font_picker", true);
  check("set_panel_locked: pinned", LM.panelLocked(pl, "font_picker"));
  check("set_panel_locked: others free", !LM.panelLocked(pl, "script_box"));
  check("repair: empty dict -> valid default-ish", deepEq(sortedAll(LM.repair({})), ALL));
  check("repair: garbage -> valid", deepEq(sortedAll(LM.repair("nonsense")), ALL));
  const fixed = LM.repair({ tabs: [{ id: "type", panels: ["script_box", "ghost_panel", "script_box"] }], detached: [], locked: true });
  check("repair: drops unknown + duplicate panels",
    panelsOf(fixed, "type").filter((p) => p === "script_box").length === 1 && !LM.allPlacedPanels(fixed).includes("ghost_panel"));
  check("repair: re-homes every missing known panel", deepEq(sortedAll(fixed), ALL));
  check("repair: guarantees >= 1 tab", LM.repair({ tabs: [] }).tabs.length >= 1);
  const older = LM.repair(d, LM.PANELS.filter((p) => p !== "hyphenation"));
  check("repair: unknown-to-this-version panel dropped", !LM.allPlacedPanels(older).includes("hyphenation"));
  expect(check.failed).toEqual([]);
});

test("SFX strategies + romaji + rule search", () => {
  const check = makeChecker();
  check("the five strategies, cheapest first", deepEq(MD.STRATEGY_IDS, ["ignore", "romaji", "note", "overlay", "redraw"]));
  check("only 'ignore' puts nothing on the page", deepEq(MD.STRATEGY_IDS.filter((s) => !MD.insertsText(s)), ["ignore"]));
  check("ignore and romaji need no English word", deepEq(MD.STRATEGY_IDS.filter((s) => !MD.needsTranslation(s)), ["ignore", "romaji"]));
  check("unknown strategy is not claimed", MD.strategy("banana") === null && !MD.insertsText("banana") && !MD.needsTranslation("banana"));
  const R = MD.toRomaji;
  check("romaji: katakana -> dokan", R("ドカン") === "dokan");
  check("romaji: hiragana too", R("どかん") === "dokan");
  check("romaji: gogogo", R("ゴゴゴ") === "gogogo");
  check("romaji: dokidoki", R("ドキドキ") === "dokidoki");
  check("romaji: gachan", R("ガチャン") === "gachan");
  check("romaji: zaa (prolong)", R("ザーッ") === "zaa");
  check("romaji: doon doubles the vowel, no macron", R("ドーン") === "doon");
  check("romaji: shiin", R("シーン") === "shiin");
  check("romaji: ba (trailing sokuon has nothing to double)", R("バッ") === "ba");
  check("romaji: dokkan", R("ドッカン") === "dokkan");
  check("romaji: bishitto", R("ビシッと") === "bishitto");
  check("romaji: sokuon before ch becomes 't', not 'c'", R("まっちゃ") === "matcha");
  check("romaji: kya", R("キャ") === "kya");
  check("romaji: ja", R("ジャ") === "ja");
  check("romaji: shugoo", R("シュゴー") === "shugoo");
  check("romaji: fa", R("ファ") === "fa");
  check("romaji: vo", R("ヴォ") === "vo");
  check("romaji: ti", R("ティ") === "ti");
  check("romaji: latin passes through", R("BOOM!") === "BOOM!");
  check("romaji: mixed keeps the non-kana", R("ドンbang") === "donbang");
  check("romaji: kanji is left alone", R("音ドン") === "音don");
  check("romaji: empty stays empty", R("") === "" && R(null) === "");
  check("romaji: middle dot becomes a space", R("ド・ン") === "do n");
  check("note_marker: circled numbers to 20", MD.noteMarker(1) === "①" && MD.noteMarker(20) === "⑳");
  check("note_marker: past 20 falls back, never renumbers", MD.noteMarker(21) === "(21)");
  check("note_line: marker, original, romaji, meaning", MD.noteLine(1, "ドキ", "heartbeat") === "① ドキ = doki (heartbeat)");
  check("note_line: meaning is optional", MD.noteLine(2, "ドキ") === "② ドキ = doki");
  check("note_line: no romaji repeat when there is nothing to transliterate", MD.noteLine(3, "BOOM") === "③ BOOM");

  check("normalize_sfx: stretched writings collapse", RS.normalizeSfx("BOOOOM") === RS.normalizeSfx("BOOM") && RS.normalizeSfx("BOOM") === "bom");
  check("normalize_sfx: punctuation drops out", RS.normalizeSfx("ka-boom!") === "kabom");
  check("normalize_sfx: a single repeated char keeps two", RS.normalizeSfx("zzz") === "zz" && RS.normalizeSfx("zzzz") === "zz");
  check("normalize_sfx: empty stays empty", RS.normalizeSfx("") === "" && RS.normalizeSfx(null) === "");
  check("keyword_matches: 3+ chars match as substring", RS.keywordMatches("boom", RS.normalizeSfx("KA-BOOOOM!")));
  check("keyword_matches: 2 chars only as a whole word",
    RS.keywordMatches("ow", RS.normalizeSfx("OW")) && !RS.keywordMatches("ow", RS.normalizeSfx("POW")));
  check("keyword_matches: 1 char is ignored", !RS.keywordMatches("a", RS.normalizeSfx("aaah")));
  const rule = { group: "Boom / Explosion", keywords: ["boom", "kaboom"], fonts: ["CC Shout Out", "Impact"] };
  const q = (x) => RS.ruleMatchesQuery(rule, x);
  check("rule_matches_query: empty query keeps every rule", q("") && q("   ") && q(null));
  check("rule_matches_query: keyword substring", q("boo"));
  check("rule_matches_query: font name, case-insensitive", q("shout"));
  check("rule_matches_query: group name", q("explosion"));
  check("rule_matches_query: fuzzy SFX spelling finds the keyword", q("BOOOOM!") && q("ka-boom"));
  check("rule_matches_query: no hit -> False", !q("whoosh"));
  check("rule_matches_query: several words are ANDed", q("boom impact") && !q("boom whoosh"));
  check("rule_matches_query: font: prefix limits the field", q("font:impact") && !q("font:boom"));
  check("rule_matches_query: group: prefix limits the field", q("group:boom") && !q("group:impact"));
  check("rule_matches_query: kw: prefix limits the field", q("kw:kaboom") && !q("kw:impact"));
  check("rule_matches_query: unknown prefix is no field filter, just text", !q("size:impact"));
  check("rule_matches_query: a rule without fonts/group survives",
    RS.ruleMatchesQuery({ keywords: ["thud"] }, "thud") && !RS.ruleMatchesQuery({ keywords: ["thud"] }, "boom"));
  expect(check.failed).toEqual([]);
});
