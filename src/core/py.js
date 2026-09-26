// Python semantics the port relies on, in one place.
//
// The Krita plugin is Python and this port must produce IDENTICAL results
// (see tests/parity.test.js), so the handful of places where JavaScript and
// Python disagree are spelled out here instead of being approximated inline:
//
// * strings are indexed by code point in Python, by UTF-16 unit in JS;
// * str.isalpha()/isalnum()/isdigit()/isspace() follow the Unicode database;
// * sum() of floats is compensated (Neumaier) since Python 3.12;
// * round() rounds half to even on the exact binary value;
// * % and // follow the sign of the divisor.

// Python's str.isspace() set (Unicode White_Space + the ASCII separators
// \x1c-\x1f, but NOT U+FEFF which JS's \s includes).
const PY_WS = "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0    " +
  "        \u2028\u2029  　";
const PY_WS_SET = new Set(PY_WS);

export const RE_ALPHA = /^\p{L}$/u;
// str.isalnum() = isalpha() or isdecimal/isdigit/isnumeric -> letters + numbers
export const RE_ALNUM = /^[\p{L}\p{N}]$/u;
export const RE_DIGIT = /^\p{Nd}$/u;
// the class Python writes as [^\W\d_]: alphanumeric but not a decimal digit
export const WORD_CLASS = "\\p{L}\\p{Nl}\\p{No}";

export function isSpace(ch) {
  return PY_WS_SET.has(ch);
}

export function isAlpha(ch) {
  return !!ch && RE_ALPHA.test(ch);
}

export function isAlnum(ch) {
  return !!ch && RE_ALNUM.test(ch);
}

export function isDigit(ch) {
  return !!ch && RE_DIGIT.test(ch);
}

/** str.isupper() for a (short) string: at least one cased char, all upper. */
export function isUpper(s) {
  let cased = false;
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    if (lo !== up) {
      if (ch !== up) return false;
      cased = true;
    }
  }
  return cased;
}

/** str.isascii() */
export function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

// --- code points -------------------------------------------------------------

/** The string as an array of code points (Python's view of it). */
export function cps(s) {
  return Array.from(s || "");
}

export function cpLen(s) {
  let n = 0;
  for (const _ of s || "") n++;   // eslint-disable-line no-unused-vars
  return n;
}

/** s[a:b] with Python slicing semantics (negative indices, clamping). */
export function cpSlice(s, a, b) {
  const arr = cps(s);
  return pySliceArr(arr, a, b).join("");
}

export function pySliceArr(arr, a, b) {
  const n = arr.length;
  let s = a === undefined || a === null ? 0 : a;
  let e = b === undefined || b === null ? n : b;
  if (s < 0) s = Math.max(0, n + s);
  if (e < 0) e = Math.max(0, n + e);
  s = Math.min(s, n);
  e = Math.min(e, n);
  return e > s ? arr.slice(s, e) : [];
}

// --- whitespace / strip / split ---------------------------------------------

/** str.split() with no argument: split on whitespace runs, drop empties. */
export function split(s) {
  const out = [];
  let cur = "";
  for (const ch of s || "") {
    if (PY_WS_SET.has(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function charSet(chars) {
  return chars === undefined || chars === null ? PY_WS_SET : new Set(chars);
}

export function lstrip(s, chars) {
  const set = charSet(chars);
  const arr = cps(s);
  let i = 0;
  while (i < arr.length && set.has(arr[i])) i++;
  return arr.slice(i).join("");
}

export function rstrip(s, chars) {
  const set = charSet(chars);
  const arr = cps(s);
  let j = arr.length;
  while (j > 0 && set.has(arr[j - 1])) j--;
  return arr.slice(0, j).join("");
}

export function strip(s, chars) {
  return rstrip(lstrip(s, chars), chars);
}

/** str.splitlines() (without keepends). */
export function splitlines(s) {
  if (!s) return [];
  const parts = String(s).split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// --- numbers ----------------------------------------------------------------

/** Python 3.12+ sum() over floats: Neumaier-compensated. */
export function pySum(values) {
  let f = 0.0;
  let c = 0.0;
  for (const x of values) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
    else c += (x - t) + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

/** Python's % (result takes the sign of the divisor). */
export function pyMod(a, b) {
  const r = a % b;
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r;
}

/** Python's // for numbers. */
export function floorDiv(a, b) {
  return Math.floor(a / b);
}

/** int(x) for a float: truncate toward zero. */
export function pyInt(x) {
  return Math.trunc(x);
}

/**
 * round(x, nd): round half to even on the exact binary value, like CPython.
 * An exact tie only exists when x * 10**nd is exactly representable as a
 * half; anything else rounds to nearest, which toFixed() already does on the
 * exact value.
 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  if (nd === 0) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  const s = x.toFixed(nd);
  // detect an exact tie: the exact decimal of x ends in 5 right after nd digits
  const exact = x.toFixed(Math.min(100, nd + 60)).replace(/0+$/, "");
  const dot = exact.indexOf(".");
  if (dot >= 0 && exact.length - dot - 1 === nd + 1 && exact.endsWith("5")) {
    // tie: pick the candidate whose last digit is even
    const scale = 10 ** nd;
    const lo = Math.floor(Math.abs(x) * scale) / scale;
    const hi = lo + 1 / scale;
    const loDigit = Math.round(lo * scale) % 2;
    const pick = loDigit === 0 ? lo : hi;
    return Number((x < 0 ? -pick : pick).toFixed(nd));
  }
  return Number(s);
}

/** Python's "%.{nd}f" / "{:.{nd}f}": like toFixed, but an EXACT binary tie
 *  (0.125 at 2 digits) rounds half to even as CPython does, where toFixed
 *  rounds it up. */
export function fixed(x, nd) {
  x = Number(x);
  if (!Number.isFinite(x)) return String(x);
  const exact = Math.abs(x).toFixed(Math.min(100, nd + 60)).replace(/0+$/, "");
  const dot = exact.indexOf(".");
  if (dot >= 0 && exact.length - dot - 1 === nd + 1 && exact.endsWith("5")) {
    // exact tie: drop the 5 and round the kept digits to even
    const kept = exact.slice(0, -1);
    const digits = kept.replace(".", "");
    const last = Number(digits[digits.length - 1]);
    let s = kept;
    if (last % 2 === 1) {
      const scale = 10 ** nd;
      s = ((Math.round(Number(kept) * scale) + 1) / scale).toFixed(nd);
    } else if (nd === 0) {
      s = kept.replace(/\.$/, "");
    }
    if (s.endsWith(".")) s = s.slice(0, -1);
    const neg = x < 0 && Number(s) !== 0;
    return (neg ? "-" : x < 0 ? "-" : "") + s;
  }
  const s = x.toFixed(nd);
  return s;
}

export function fmt(x, digits) {
  return fixed(x, digits);
}

// --- containers -------------------------------------------------------------

/** sorted(iterable, key=fn) — stable, like Python. */
export function sortedBy(arr, keyFn, reverse = false) {
  const decorated = Array.from(arr, (v, i) => [keyFn(v), i, v]);
  decorated.sort((a, b) => {
    const c = cmp(a[0], b[0]);
    if (c !== 0) return reverse ? -c : c;
    return a[1] - b[1];
  });
  return decorated.map((d) => d[2]);
}

/** Python ordering for numbers, strings, booleans and (nested) arrays. */
export function cmp(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "string" && typeof b === "string") {
    // Python compares strings by code point, not by UTF-16 unit
    if (a === b) return 0;
    const A = cps(a);
    const B = cps(b);
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i].codePointAt(0);
      const y = B[i].codePointAt(0);
      if (x !== y) return x < y ? -1 : 1;
    }
    return A.length - B.length;
  }
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** str.format-style "{name}" substitution used by the LANG strings. */
export function format(template, fmtArgs) {
  if (!fmtArgs) return template;
  const L = "\u0001";
  const R = "\u0002";
  const t = String(template).split("{{").join(L).split("}}").join(R);
  return t.replace(/\{(\w+)(?::([^}]*))?\}/g, (m, name, spec) => {
    if (!(name in fmtArgs)) return m;
    const v = fmtArgs[name];
    if (spec) {
      const pad = /^0?(\d+)d$/.exec(spec);
      if (pad) return String(v).padStart(Number(pad[1]), spec.startsWith("0") ? "0" : " ");
      const fl = /^\.(\d+)f$/.exec(spec);
      if (fl) return Number(v).toFixed(Number(fl[1]));
    }
    return String(v);
  }).split(L).join("{").split(R).join("}");
}
