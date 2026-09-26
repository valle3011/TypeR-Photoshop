// The insert path end to end without Photoshop: planInsert (what
// insert_text_layer decides) + the batchPlay descriptors it becomes.
// Mirrors the "insert path" block of TypeR-Krita/test_integration.py, with
// the SVG checks translated to their layer-style equivalents.
import { test, expect } from "vitest";
import { planInsert } from "../src/core/insertplan.js";
import * as D from "../src/core/psdesc.js";
import * as L from "../src/core/layout.js";
import { makeChecker, monoMeasurer, installHyphLoader, deepEq } from "./helpers.js";

installHyphLoader();

const env = {
  docW: 800, docH: 600, selection: null,
  measurer: (spacing) => (px) => {
    const [w, s, lh, a, d] = monoMeasurer(px);
    return [w, s, lh * spacing, a, d];
  },
  capHeight: (px) => 0.7 * px,
};

const base = (kw = {}) => ({
  line: "THAT HE PISSES ME OFF, BUT", fontFamily: "Arial", fontPx: 72, autoFit: true, maxPx: 72,
  paddingFrac: 0.1, lineSpacing: 1.0, align: "center", valign: "middle", layerIndex: 1,
  box: [100, 100, 320, 320], ...kw,
});

test("insert plan", () => {
  const check = makeChecker();
  const r = planInsert(base(), env);
  check("insert succeeds", r.ok);
  const p = r.plan;
  check("the layer is named 'TypeR NN — snippet'", p.label.startsWith("TypeR 01 — ") && L.isTyperLayerName(p.label, 1));
  check("lines become paragraphs separated by \\r", p.text.split("\r").length === p.textLines.length);
  check("centre alignment anchors at the box centre", p.anchor.x === 260);
  check("the anchor's y is the first baseline", p.anchor.y === p.blockStart);
  check("auto-fit reports st_inserted_fit with px and line count",
    p.key === "st_inserted_fit" && p.fmt.px === Math.round(p.fontPx) && p.fmt.n === p.textLines.length);
  const left = planInsert(base({ align: "left" }), env).plan;
  check("left alignment anchors at the padded left edge", left.anchor.x === 100 + 320 * 0.1 / 2);
  const right = planInsert(base({ align: "right" }), env).plan;
  check("right alignment anchors at the padded right edge", right.anchor.x === 420 - 320 * 0.1 / 2);
  check("no active document -> (False, 'st_no_doc')", planInsert(base(), null).key === "st_no_doc");
  check("an empty line is refused", planInsert(base({ line: "   " }), env).key === "st_empty_line");
  check("only bold markers is empty too", planInsert(base({ line: "****" }), env).key === "st_empty_line");
  const sel = planInsert(base({ box: null }), { ...env, selection: [10, 20, 200, 100] }).plan;
  check("without a box the selection is the target", deepEq(sel.box, [10, 20, 200, 100]));
  const img = planInsert(base({ box: null }), env).plan;
  check("without box or selection the whole image is the target", deepEq(img.box, [0, 0, 800, 600]));
  const fixed = planInsert(base({ autoFit: false, fontPx: 30, line: "A\nB" }), env).plan;
  check("fixed size keeps the size and only the hard breaks", fixed.fontPx === 30 && fixed.textLines.length === 2 && fixed.key === "st_inserted");
  const bold = planInsert(base({ line: "we **are** here" }), env).plan;
  check("per-word bold becomes its own style run", bold.runs.some((x) => x.bold) && bold.runs.some((x) => !x.bold));
  check("style runs cover the whole text", bold.runs[0].from === 0 && bold.runs[bold.runs.length - 1].to === bold.text.length);
  const vert = planInsert(base({ vertical: true, line: "AAA BBB CCC" }), env).plan;
  check("vertical text uses the character-count measurer (columns)", vert.vertical && vert.textLines.length >= 1);
  check("vertical: the anchor is the first column's centre", vert.anchor.x === vert.blockStart);
  check("replace + numbering: unit 12 gives 'TypeR 12 — '", planInsert(base({ layerIndex: 12 }), env).plan.label.startsWith("TypeR 12 — "));
  check("no unit gives 'TypeR — '", planInsert(base({ layerIndex: null }), env).plan.label.startsWith("TypeR — "));
  const cased = planInsert(base({ line: "hello there", case: "upper" }), env).plan;
  check("letter case is applied before fitting", cased.text.replace(/\r/g, " ") === "HELLO THERE");
  expect(check.failed).toEqual([]);
});

test("layer style mapping (Krita SVG copies -> Photoshop effects)", () => {
  const check = makeChecker();
  let fx = D.layerEffects({ outline: true, outlinePx: 6, outlineColor: "#ffffff" });
  check("single outline -> one stroke, outside, size = visible half", fx.frameFX && fx.frameFX.size._value === 3
    && fx.frameFX.style._value === "outsetFrame" && !fx.outerGlow);
  fx = D.layerEffects({ outline: true, outlinePx: 6, outlineColor: "#ffffff", outline2Px: 14, outline2Color: "#000000" });
  check("double outline -> stroke (inner, 3) + hard outer glow (outer, 7)",
    fx.frameFX.size._value === 3 && fx.outerGlow.blur._value === 7 && fx.outerGlow.chokeMatte._value === 100
    && fx.outerGlow.glowTechnique._value === "preciseMatte");
  check("no outline -> no layer style at all", D.layerEffects({ outline: false, outlinePx: 6 }) === null);
  check("outline OFF drops the 2nd outline too",
    D.layerEffects({ outline: false, outlinePx: 6, outline2Px: 14, outline2Color: "#000" }) === null);
  fx = D.layerEffects({ outline: true, outlinePx: 6, outline2Px: 14, shadow: true, shadowDx: 3, shadowDy: 4, shadowColor: "#333333" });
  check("shadow takes the widest outline, hard (spread 100%)", fx.dropShadow.blur._value === 7 && fx.dropShadow.chokeMatte._value === 100
    && Math.abs(fx.dropShadow.distance._value - 5) < 1e-9);
  const sa = D.shadowAngleDistance(3, 4);
  check("shadow angle: +x/+y (right/down) casts at the right angle",
    Math.abs(-Math.cos(sa.angle * Math.PI / 180) * sa.distance - 3) < 1e-9 && Math.abs(Math.sin(sa.angle * Math.PI / 180) * sa.distance - 4) < 1e-9);
  fx = D.layerEffects({ outline: true, outlinePx: 8, outlinePattern: { name: "Dots", id: "abc", scale: 100 }, patternTarget: "outline1" });
  check("pattern-filled outline -> stroke with pattern fill (text stays editable)", fx.frameFX.paintType._value === "pattern");
  fx = D.layerEffects({ outline: true, outlinePx: 8, outline2Px: 16, outline2Color: "#000", outlinePattern: { name: "Dots", id: "abc" }, patternTarget: "outline2" });
  check("a pattern on the 2nd outline -> two strokes, wider one last (underneath)",
    fx.frameFXMulti && fx.frameFXMulti.length === 2 && fx.frameFXMulti[1].size._value === 8 && fx.frameFXMulti[1].paintType._value === "pattern");
  fx = D.layerEffects({ outline: true, outlinePx: 4, soft: true, softPx: 3, softBlur: 8, softColor: "#000000" });
  check("soft outline -> a blurred zero-distance shadow", fx.dropShadow && fx.dropShadow.distance._value === 0 && fx.dropShadow.blur._value > 0);
  fx = D.layerEffects({ outline: true, outlinePx: 4, soft: true, softPx: 3, softBlur: 8, shadow: true, shadowDx: 2, shadowDy: 2 });
  check("shadow + soft outline -> two drop shadows", fx.dropShadowMulti && fx.dropShadowMulti.length === 2);
  fx = D.layerEffects({ fillPattern: { name: "Tone", id: "x" } });
  check("a pattern TEXT FILL -> pattern overlay on the editable text", fx.patternFill && fx.patternFill.pattern.name === "Tone");

  const mk = D.makeTextLayer({ text: "HELLO\rTHERE", runs: [{ from: 0, to: 11, psName: "ArialMT", family: "Arial", style: "Regular" }],
    sizePt: 24, leadingPt: 28, color: "#102030", align: "center", anchorPct: { x: 50, y: 40 }, underline: false, ligatures: false });
  const ts = mk.using.textStyleRange[0].textStyle;
  check("text layer: point text at the anchor", mk.using.textClickPoint.horizontal._value === 50 && mk.using.textClickPoint.vertical._value === 40);
  check("text layer: explicit leading (unclamped spacing)", ts.autoLeading === false && ts.leading._value === 28);
  check("text layer: colour uses 'grain' for green", ts.color.grain === 0x20 && ts.color.red === 0x10);
  check("text layer: ligatures follow the toggle", ts.ligature === false);
  check("text layer: paragraph alignment", mk.using.paragraphStyleRange[0].paragraphStyle.align._value === "center");
  const v = D.makeTextLayer({ text: "AB", sizePt: 10, leadingPt: 10, color: "#000", align: "top", anchorPct: { x: 1, y: 1 }, vertical: true });
  check("vertical text: vertical orientation, upright roman, valign mapped", v.using.textShape[0].orientation._value === "vertical"
    && v.using.textStyleRange[0].textStyle.baselineDirection._value === "crossStream"
    && v.using.paragraphStyleRange[0].paragraphStyle.align._value === "left");
  check("px -> pt at 300 ppi", Math.abs(D.pxToPt(300, 300) - 72) < 1e-9);
  expect(check.failed).toEqual([]);
});
