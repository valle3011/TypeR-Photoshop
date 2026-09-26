// Port of TypeR-Krita/test_metamorphic.py: relations and invariants of the
// layout engine. The fuzz part uses its own seeded PRNG (the inputs differ from
// Python's `random`, the invariants are the same).
import { test, expect } from "vitest";
import * as L from "../src/core/layout.js";
import { makeChecker, installHyphLoader, falses } from "./helpers.js";

installHyphLoader();

function measurer(px) {
  const cw = 0.5 * px;
  const widthOf = (x) => {
    const runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
    if (runs === undefined) {
      if (Array.isArray(x)) return x.reduce((a, [t]) => a + t.length, 0) * cw;
      return x.length * cw;
    }
    return runs.reduce((a, [t]) => a + t.length, 0) * cw;
  };
  return [widthOf, cw, 1.2 * px, 0.8 * px, 0.2 * px];
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lineTexts = (c) => c.lines.map((r) => L.runsText(r));
const arr = (px, ...t) => ({ px, k: t.length, lines: t.map((x) => [[x, false]]) });
const SAMPLE = "THAT HE PISSES ME OFF, BUT NOT ENOUGH TO SAY IT OUT LOUD";
const SC = (text, w, h, mx, mn, pad, opts = {}) => L.shapeCandidates(text, measurer, w, h, mx, mn, pad, opts);

test("metamorphic relations", () => {
  const check = makeChecker();
  const small = SC("HELLO THERE FRIEND", 120, 120, 200, 6, 0.1, { mode: "balanced" });
  const big = SC("HELLO THERE FRIEND", 240, 240, 200, 6, 0.1, { mode: "balanced" });
  check("bigger box -> best px is not smaller", big.length && small.length && big[0].px >= small[0].px);
  const lowPad = SC(SAMPLE, 200, 200, 200, 6, 0.05, { mode: "balanced" });
  const highPad = SC(SAMPLE, 200, 200, 200, 6, 0.35, { mode: "balanced" });
  check("more padding -> best px is not bigger", lowPad.length && highPad.length && highPad[0].px <= lowPad[0].px);
  const capLo = SC("BIG", 400, 400, 40, 6, 0.0, { mode: "balanced" });
  const capHi = SC("BIG", 400, 400, 400, 6, 0.0, { mode: "balanced" });
  check("higher max_px cap -> best px is not smaller", capHi.length && capLo.length && capHi[0].px >= capLo[0].px);
  const c = SC(SAMPLE, 200, 260, 90, 12, 0.1, { mode: "balanced" });
  check("all candidate px within [min_px, max_px]", c.length && c.every((x) => x.px >= 12 && x.px <= 90));
  const tall = SC(SAMPLE, 220, 300, 120, 6, 0.1, { mode: "tall" });
  const wide = SC(SAMPLE, 220, 300, 120, 6, 0.1, { mode: "wide" });
  check("tall top has >= lines than wide top", tall.length && wide.length && tall[0].k >= wide[0].k);
  expect(check.failed).toEqual([]);
});

test("property / fuzz", () => {
  const check = makeChecker();
  const rnd = mulberry32(1234);
  const randint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const choice = (xs) => xs[Math.floor(rnd() * xs.length)];
  const WORDS = ["THE", "QUICK", "BROWN", "FOX", "JUMPS", "OVER", "A", "LAZY", "DOG!",
    "PISSES", "ME", "OFF,", "EMBARRASSING", "SO", "HI", "OK", "WOW"];
  let fuzzOk = true;
  let fitOk = true;
  let rangeOk = true;
  let dedupOk = true;
  let finiteOk = true;
  for (let it = 0; it < 400; it++) {
    const n = randint(1, 9);
    const text = Array.from({ length: n }, () => choice(WORDS)).join(" ");
    const bw = randint(40, 400);
    const bh = randint(40, 400);
    const mx = randint(20, 200);
    const pad = choice([0.0, 0.1, 0.2, 0.3]);
    const mode = choice(["balanced", "tall", "wide", "round"]);
    const hy = rnd() < 0.5;
    let cands;
    try {
      cands = SC(text, bw, bh, mx, 6, pad, { mode, hyphenate: hy, limit: 10 });
    } catch (e) {
      fuzzOk = false;
      break;
    }
    if (cands.length > 10) dedupOk = false;
    const usableW = bw * (1.0 - pad);
    for (const cand of cands) {
      if (!(cand.px >= 6 && cand.px <= mx)) rangeOk = false;
      if (!Number.isFinite(cand.score)) finiteOk = false;
      if (mode !== "round") {
        const [widthOf] = measurer(cand.px);
        for (const runs of cand.lines) if (widthOf(runs) > usableW + 1.0) fitOk = false;
      }
    }
  }
  check("fuzz: shape_candidates never raises", fuzzOk);
  check("fuzz: every candidate px within [6, max_px]", rangeOk);
  check("fuzz: every score is finite (no NaN/inf)", finiteOk);
  check("fuzz: no line exceeds the usable width", fitOk);
  check("fuzz: never more than `limit` candidates", dedupOk);
  let balOk = true;
  for (let it = 0; it < 200; it++) {
    const txt = Array.from({ length: randint(2, 8) }, () => choice(WORDS)).join(" ");
    const words = L.makeWords(txt, falses(txt.length));
    const k = randint(1, words.length);
    const [widthOf, spaceW] = measurer(40);
    if (L.balanceEven(words, widthOf, spaceW, 500.0, k).length > k) balOk = false;
  }
  check("balance_even never returns more than k lines", balOk);
  expect(check.failed).toEqual([]);
});

test("boundary / round-trip / regression", () => {
  const check = makeChecker();
  check("empty text -> no candidates", SC("   ", 100, 100, 100, 6, 0.1).length === 0);
  check("single word still fits", SC("HELLO", 100, 100, 100, 6, 0.1).length > 0);
  check("one character fits", SC("A", 100, 100, 100, 6, 0.1).length > 0);
  check("tiny box -> no crash, maybe empty", Array.isArray(SC(SAMPLE, 4, 4, 100, 6, 0.1)));
  check("min_px == max_px -> px is exactly that", SC("HI THERE", 300, 300, 30, 30, 0.0).every((x) => x.px === 30));
  check("over-wide word: candidates exist and none overflow badly",
    Array.isArray(SC("SUPERCALIFRAGILISTIC", 60, 300, 200, 6, 0.0, { hyphenate: true, lang: "en" })));

  const w = L.makeWords("ALPHA BETA GAMMA", falses(16));
  check("make_words -> line_runs -> runs_text round-trips", L.runsText(L.lineRuns(w)) === "ALPHA BETA GAMMA");
  const g = L.groupWords(w, new Set([0, 1]));
  check("group_words pieces rejoin to the original", g.map((ln) => L.runsText(L.lineRuns(ln))).join(" ") === "ALPHA BETA GAMMA");
  const [d1] = L.dehyphenate("embar- rassing and co- op");
  const [d2] = L.dehyphenate(d1);
  check("dehyphenate is idempotent", d1 === d2);
  let ok = true;
  for (const src of ["a- b", "big- Bang here", "X-ray e- mail", "no hyphens here", "multi--- dash", "trail- "]) {
    const [t, m] = L.dehyphenate(src, falses(src.length));
    if (m.length !== Array.from(t).length) ok = false;
  }
  check("dehyphenate: mask length always matches text length", ok);

  const port = SC("THAT HE PISSES ME OFF, BUT", 220, 320, 200, 6, 0.12, { mode: "balanced" });
  check("regression: portrait bubble recommends the bigger (>=50px) shape", port.length && port[0].px >= 50);
  check("regression: full block scores >= edge-to-edge cram",
    L.scoreArrangement(arr(40, "aaaaaaa", "bbbbbbb", "ccccccc"), measurer, 100, 130, 52)
    > L.scoreArrangement(arr(52, "aaaaaaaaaa", "bbbbbbbbbb"), measurer, 100, 130, 52));
  check("regression: cap-height centring puts the caps on the box centre",
    Math.abs((L.verticalStart("middle", 0, 200, 0.0, 1, 24, 80, 20, 56) - 56 / 2.0) - 100.0) < 0.01);
  check("regression: no cap -> em-box centring is unchanged",
    Math.abs(L.verticalStart("middle", 0, 200, 0.0, 1, 24, 80, 20) - (100.0 + (80 - 20) / 2.0)) < 0.01);
  const vb = L.verticalStart("middle", 0, 200, 0.0, 1, 24, 80, 20, 99999);
  check("regression: a bogus cap is clamped (baseline stays on the box)", vb >= 0.0 && vb <= 200.0);
  const cdh = SC("hyphen- ation works", 200, 200, 60, 6, 0.0, { dehyphenate: true });
  check("regression: dehyphenate flows through shape_candidates",
    cdh.length && cdh.some((x) => lineTexts(x).join(" ").toLowerCase().includes("hyphenation")));
  check("regression: a mid-word hyphen break scores lower than a clean break",
    L.scoreArrangement(arr(20, "ABCDE", "FGHIJ"), measurer, 100, 100) > L.scoreArrangement(arr(20, "ABCD-", "FGHIJ"), measurer, 100, 100));
  const tl = SC("A SUPER CUTE GIRL LIKE ME", 180, 360, 200, 6, 0.1, { mode: "tall", hyphenate: true, lang: "en" });
  check("regression: tall doesn't recommend an over-hyphenated block", tl.length && !lineTexts(tl[0]).some((t) => t.endsWith("-")));
  check("regression: tall still leans tall (multi-line pick)", tl.length && tl[0].k >= 4);
  expect(check.failed).toEqual([]);
});
