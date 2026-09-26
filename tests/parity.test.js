// Parity: the JS engine must reproduce the Python engine exactly.
// Fixtures come from tools/export_parity.py (run it after changing either side).
import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as LO from "../src/core/layout.js";
import * as LP from "../src/core/langpair.js";
import { pySum, cps } from "../src/core/py.js";
import { ROOT, installHyphLoader } from "./helpers.js";

installHyphLoader();
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "parity.json"), "utf8"));

// the mock measurer — mirror of export_parity.make_measurer
function charW(ch, bold) {
  let w = 0.35 + (ch.codePointAt(0) % 13) * 0.04;
  if (ch === " ") w = 0.3;
  return w * (bold ? 1.1 : 1.0);
}

function makeMeasurer(spacing, gbold = false) {
  return (px0) => {
    const px = Math.max(1, Math.trunc(pyRoundHalfEven(px0)));
    const widthOf = (x) => {
      let runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
      if (runs === undefined) {
        if (Array.isArray(x)) runs = x;
        else return pySum(cps(x).map((c) => charW(c, gbold) * px));
      }
      const vals = [];
      for (const [t, b] of runs) for (const c of cps(t)) vals.push(charW(c, gbold || b) * px);
      return pySum(vals);
    };
    return [widthOf, 0.3 * px, px * 1.17 * spacing, 0.8 * px, 0.2 * px];
  };
}

function pyRoundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const close = (a, b) => (a === null && b === null)
  || (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

test(`shape_candidates parity (${FIX.shape.length} cases)`, () => {
  const bad = [];
  for (const c of FIX.shape) {
    const res = LO.shapeCandidates(c.text, makeMeasurer(1.05), c.box[0], c.box[1], 64, 6, 0.12, {
      mode: c.mode, hyphenate: c.hyph, lang: c.lang, mask: c.mask, limit: 10,
      dehyphenate: c.dehyph, inset: c.inset, shapeRows: c.rows,
    });
    const got = res.map((x) => ({ px: x.px, k: x.k, lines: x.lines.map((r) => LO.runsMarkup(r)), score: x.score }));
    const same = got.length === c.result.length && got.every((g, i) =>
      g.px === c.result[i].px && g.k === c.result[i].k
      && JSON.stringify(g.lines) === JSON.stringify(c.result[i].lines)
      && close(g.score, c.result[i].score));
    if (!same) bad.push({ text: c.text, box: c.box, mode: c.mode, hyph: c.hyph, got, want: c.result });
  }
  expect(bad.slice(0, 3)).toEqual([]);
});

test(`fit_text parity (${FIX.fit.length} cases)`, () => {
  const bad = [];
  for (const c of FIX.fit) {
    const r = LO.fitText(c.text, makeMeasurer(c.spacing), c.box[0], c.box[1], 80, 6, 0.1, c.shape, c.mask, c.hyph, "en");
    const got = r === null ? null : { px: r[0], lines: r[1].map((x) => LO.runsMarkup(x)), line_h: r[2], fitted: r[5] };
    const want = c.result;
    const same = (got === null && want === null) || (got && want && got.px === want.px
      && JSON.stringify(got.lines) === JSON.stringify(want.lines) && close(got.line_h, want.line_h)
      && got.fitted === want.fitted);
    if (!same) bad.push({ c, got });
  }
  expect(bad.slice(0, 3)).toEqual([]);
});

test(`hyphenate / dehyphenate / wrap parity`, () => {
  const bad = [];
  for (const c of FIX.hyph) {
    const got = LO.hyphenate(c.word, c.lang);
    if (JSON.stringify(got) !== JSON.stringify(c.result)) bad.push({ c, got });
  }
  for (const c of FIX.dehyph) {
    const mask = cps(c.text).map((_, i) => i % 3 === 0);
    const got = LO.dehyphenate(c.text, mask);
    if (JSON.stringify(got) !== JSON.stringify(c.result)) bad.push({ c, got });
  }
  for (const c of FIX.wrap) {
    const clean = c.text.replace(/\n/g, " ");
    const ws = LO.makeWords(clean, c.mask.slice(0, cps(c.text).length));
    const [wo, sp] = makeMeasurer(1.0)(20);
    const lines = LO.wrapGreedy(ws, wo, sp, c.max_w, (w) => LO.hyphenate(w.text, "en"), c.lim[0], c.lim[1]);
    const got = lines.map((ln) => LO.runsMarkup(LO.lineRuns(ln)));
    if (JSON.stringify(got) !== JSON.stringify(c.result)) bad.push({ c, got });
  }
  expect(bad.slice(0, 3)).toEqual([]);
});

test(`langpair parity`, () => {
  const bad = [];
  for (const c of FIX.pair) {
    const [pairs, pp, pages] = LP.pairLinesPaged(c.lines);
    const got = { pairs, pair_pages: pp, pages };
    if (JSON.stringify(got) !== JSON.stringify(c.result)) bad.push({ c, got });
  }
  const fns = { detect_lang: LP.detectLang, split_speaker: LP.splitSpeaker, page_marker: LP.pageMarker };
  for (const c of FIX.misc) {
    const got = fns[c.fn](...c.args);
    if (JSON.stringify(got) !== JSON.stringify(c.result)) bad.push({ c, got });
  }
  expect(bad.slice(0, 5)).toEqual([]);
});
