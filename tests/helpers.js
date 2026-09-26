// Shared test helpers: the Python suites use a flat `check(name, cond)` style;
// `suite()` keeps that style (so every Python check has a same-named JS check)
// while still failing the Vitest test with the list of failed checks.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setHyphLoader } from "../src/core/layout.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function installHyphLoader() {
  setHyphLoader((name) => {
    const p = path.join(ROOT, "hyph", name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  });
}

export function makeChecker() {
  const failed = [];
  let passed = 0;
  const check = (name, cond) => {
    if (cond) passed++;
    else failed.push(name);
  };
  check.failed = failed;
  check.count = () => passed;
  return check;
}

export function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A fake monospace measurer: every character is 0.5*px wide, lines 1.2*px. */
export function monoMeasurer(px) {
  const cw = 0.5 * px;
  const len = (s) => Array.from(s).length;
  const widthOf = (x) => {
    const runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
    if (runs === undefined) {
      if (Array.isArray(x)) return x.reduce((a, [t]) => a + len(t), 0) * cw;
      return len(x) * cw;
    }
    return runs.reduce((a, [t]) => a + len(t), 0) * cw;
  };
  return [widthOf, cw, 1.2 * px, 0.96 * px, 0.24 * px];
}

export const falses = (n) => new Array(n).fill(false);
