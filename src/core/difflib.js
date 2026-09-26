// Exact port of CPython's difflib.SequenceMatcher.ratio() (no isjunk).
//
// fontmatch.py uses SequenceMatcher(None, a, b).ratio() both for its fuzzy
// tier and for breaking ties between candidates; an "almost the same" ratio
// would pick different fonts, so this follows Lib/difflib.py line by line,
// autojunk heuristic included.

import { cps } from "./py.js";

export class SequenceMatcher {
  constructor(a = "", b = "", autojunk = true) {
    this.autojunk = autojunk;
    this.a = cps(a);
    this.b = cps(b);
    this._chainB();
  }

  _chainB() {
    const b = this.b;
    const b2j = new Map();
    b.forEach((elt, i) => {
      let idx = b2j.get(elt);
      if (!idx) {
        idx = [];
        b2j.set(elt, idx);
      }
      idx.push(i);
    });
    // purge popular elements (autojunk), only for sequences of 200+ items
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      const popular = [];
      for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.push(elt);
      for (const elt of popular) b2j.delete(elt);
    }
    this.b2j = b2j;
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // no junk: extend with equal elements on both sides
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  getMatchingBlocks() {
    const la = this.a.length;
    const lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    return nonAdjacent;
  }

  ratio() {
    let matches = 0;
    for (const t of this.getMatchingBlocks()) matches += t[2];
    const length = this.a.length + this.b.length;
    return length ? 2.0 * matches / length : 1.0;
  }
}

export function ratio(a, b) {
  return new SequenceMatcher(a, b).ratio();
}
