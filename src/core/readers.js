// Script file readers (.docx / .odt / .xlsx / .xlsm / .txt / .md), without
// any host dependency: bytes in, text out.
//
// Port of the reader functions of TypeR-Krita `typer_kr/typer_kr.py`
// (_decode_bytes, _read_docx, _read_odt, _read_xlsx, _read_xlsx_grid,
// read_script, split_lines). A .docx/.odt/.xlsx is a ZIP of XML, read with
// JSZip + core/xml.js as real Unicode — no "character could not be read".

import JSZip from "jszip";
import { fromString, localName } from "./xml.js";
import { strip } from "./py.js";
import { splitext } from "./langpair.js";

export class OldDocError extends Error {
  /** Old binary format (.doc/.xls) that cannot be read directly. */
  constructor(fmt = ".doc") {
    super(fmt);
    this.fmt = fmt;
  }
}

export class NoContentError extends Error {}

// --- byte decoding: UTF-8 (with/without BOM) -> Windows-1252 -> latin-1 ----

/** Strict UTF-8 decode (like Python: overlongs, surrogates and truncated
 *  sequences are errors). Returns null on any error. */
export function decodeUtf8Strict(b) {
  let out = "";
  let i = 0;
  const n = b.length;
  const parts = [];
  while (i < n) {
    const c = b[i];
    let cp;
    if (c < 0x80) {
      cp = c;
      i += 1;
    } else if (c >= 0xc2 && c <= 0xdf) {
      if (i + 1 >= n || (b[i + 1] & 0xc0) !== 0x80) return null;
      cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f);
      i += 2;
    } else if (c >= 0xe0 && c <= 0xef) {
      if (i + 2 >= n) return null;
      const c1 = b[i + 1];
      const c2 = b[i + 2];
      if ((c1 & 0xc0) !== 0x80 || (c2 & 0xc0) !== 0x80) return null;
      if (c === 0xe0 && c1 < 0xa0) return null;          // overlong
      if (c === 0xed && c1 >= 0xa0) return null;         // surrogate
      cp = ((c & 0x0f) << 12) | ((c1 & 0x3f) << 6) | (c2 & 0x3f);
      i += 3;
    } else if (c >= 0xf0 && c <= 0xf4) {
      if (i + 3 >= n) return null;
      const c1 = b[i + 1];
      const c2 = b[i + 2];
      const c3 = b[i + 3];
      if ((c1 & 0xc0) !== 0x80 || (c2 & 0xc0) !== 0x80 || (c3 & 0xc0) !== 0x80) return null;
      if (c === 0xf0 && c1 < 0x90) return null;
      if (c === 0xf4 && c1 >= 0x90) return null;
      cp = ((c & 0x07) << 18) | ((c1 & 0x3f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
      i += 4;
    } else {
      return null;
    }
    parts.push(cp);
    if (parts.length >= 8192) {
      out += String.fromCodePoint(...parts);
      parts.length = 0;
    }
  }
  if (parts.length) out += String.fromCodePoint(...parts);
  return out;
}

// cp1252 0x80..0x9F (null = undefined in Python's codec -> decode error)
const CP1252 = [0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, null, 0x017d, null, null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178];

function decodeCp1252(b) {
  let out = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x80 && c <= 0x9f) {
      const m = CP1252[c - 0x80];
      if (m === null) return null;
      out += String.fromCharCode(m);
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

function decodeLatin1(b) {
  let out = "";
  for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}

/** Decode bytes to text without ever failing (UTF-8 w/ or w/o BOM, then
 *  Windows-1252, finally latin-1 which maps every byte). */
export function decodeBytes(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const body = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  let s = decodeUtf8Strict(body);
  if (s !== null) return s;
  s = decodeCp1252(b);
  if (s !== null) return s;
  return decodeLatin1(b);
}

async function readZip(bytes) {
  return bytes instanceof JSZip ? bytes : JSZip.loadAsync(bytes);
}

async function zipText(zip, name) {
  const f = zip.file(name);
  if (!f) throw new NoContentError(name);
  return f.async("uint8array");
}

/** Text of a .docx: standalone paragraphs one line each (<w:tab> -> TAB,
 *  <w:br>/<w:cr> -> line break); a TABLE row becomes one TAB-separated line
 *  (cells free of tabs/newlines), so 2-column scripts pair by column. */
export async function readDocx(bytes) {
  const zip = await readZip(bytes);
  const root = fromString(await zipText(zip, "word/document.xml"));

  const paraText = (p, cell) => {
    const buf = [];
    for (const node of p.iter()) {
      const name = localName(node.tag);
      if (name === "t") {
        if (node.text) buf.push(node.text);
      } else if (name === "tab") {
        buf.push(cell ? " " : "\t");
      } else if (name === "br" || name === "cr") {
        buf.push(cell ? " " : "\n");
      }
    }
    return buf.join("");
  };

  const cellText = (tc) => {
    const ps = [...tc.iter()].filter((n) => localName(n.tag) === "p");
    return strip(ps.map((p) => strip(paraText(p, true))).join(" "));
  };

  const lines = [];
  const walk = (parent) => {
    for (const child of parent.children) {
      const name = localName(child.tag);
      if (name === "tbl") {
        for (const tr of child.children) {
          if (localName(tr.tag) !== "tr") continue;
          const cells = tr.children.filter((tc) => localName(tc.tag) === "tc").map(cellText);
          if (cells.length) lines.push(cells.join("\t"));
        }
      } else if (name === "p") {
        lines.push(paraText(child, false));
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return lines.join("\n");
}

/** Text of a .odt: <text:p>/<text:h> paragraphs; line-break, tab and
 *  <text:s c="n"/> spaces honoured. */
export async function readOdt(bytes) {
  const zip = await readZip(bytes);
  const root = fromString(await zipText(zip, "content.xml"));
  const collect = (elem, out) => {
    if (elem.text) out.push(elem.text);
    for (const child of elem.children) {
      const name = localName(child.tag);
      if (name === "line-break") {
        out.push("\n");
      } else if (name === "tab") {
        out.push("\t");
      } else if (name === "s") {
        let count = 1;
        for (const [k, v] of Object.entries(child.attrib)) {
          if (localName(k) === "c") {
            const nv = Number.parseInt(v, 10);
            count = Number.isNaN(nv) || !/^\s*[+-]?\d+\s*$/.test(v) ? 1 : nv;
          }
        }
        out.push(" ".repeat(Math.max(0, count)));
      } else {
        collect(child, out);
      }
      if (child.tail) out.push(child.tail);
    }
  };
  const lines = [];
  for (const para of root.iter()) {
    const name = localName(para.tag);
    if (name === "p" || name === "h") {
      const out = [];
      collect(para, out);
      lines.push(out.join(""));
    }
  }
  return lines.join("\n");
}

/** Column number from a cell reference such as 'B2' -> 2. */
export function colIndex(ref) {
  let idx = 0;
  for (const ch of ref) {
    if (/\p{L}/u.test(ch)) idx = idx * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
    else break;
  }
  return idx;
}

async function sheetCells(bytes) {
  const zip = await readZip(bytes);
  const names = Object.keys(zip.files);
  const shared = [];
  if (names.includes("xl/sharedStrings.xml")) {
    const sroot = fromString(await zipText(zip, "xl/sharedStrings.xml"));
    for (const si of sroot.children) {
      if (localName(si.tag) !== "si") continue;
      const parts = [...si.iter()].filter((t) => localName(t.tag) === "t" && t.text).map((t) => t.text);
      shared.push(parts.join(""));
    }
  }
  const sheets = names.filter((n) => n.startsWith("xl/worksheets/") && n.endsWith(".xml")).sort();
  if (!sheets.length) return null;
  const wroot = fromString(await zipText(zip, sheets[0]));
  const rows = [];
  for (const row of wroot.iter()) {
    if (localName(row.tag) !== "row") continue;
    const cells = [];
    for (const c of row.children) {
      if (localName(c.tag) !== "c") continue;
      const col = colIndex(c.get("r", ""));
      const ctype = c.get("t", "");
      let val = "";
      if (ctype === "s") {
        for (const ch of c.children) {
          if (localName(ch.tag) === "v" && ch.text !== null) {
            const k = Number.parseInt(ch.text, 10);
            val = !Number.isNaN(k) && /^\s*[+-]?\d+\s*$/.test(ch.text) && k >= -shared.length && k < shared.length
              ? shared[k < 0 ? shared.length + k : k] : "";
            break;
          }
        }
      } else if (ctype === "inlineStr") {
        val = [...c.iter()].filter((t) => localName(t.tag) === "t" && t.text).map((t) => t.text).join("");
      } else {
        for (const ch of c.children) {
          const nm = localName(ch.tag);
          if ((nm === "v" || nm === "t") && ch.text !== null) {
            val = ch.text;
            break;
          }
        }
      }
      cells.push([col, val]);
    }
    rows.push(cells);
  }
  return rows;
}

/** Text of an .xlsx (first sheet): one line per ROW, cells TAB-separated
 *  (single-cell rows stay plain), trailing empty cells dropped. */
export async function readXlsx(bytes) {
  const rows = await sheetCells(bytes);
  if (rows === null) return "";
  const lines = [];
  for (const cells0 of rows) {
    const cells = cells0.map((c, i) => [c[0], c[1], i]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    const vals = cells.map(([, v]) => (v === null || v === undefined ? "" : String(v)));
    while (vals.length && strip(vals[vals.length - 1]) === "") vals.pop();
    if (!vals.length) continue;
    lines.push(vals.length >= 2 ? vals.join("\t") : vals[0]);
  }
  return lines.join("\n");
}

/** An .xlsx as rows of cell strings (missing cells filled with ""). */
export async function readXlsxGrid(bytes) {
  const rows = await sheetCells(bytes);
  if (rows === null) return [];
  const grid = [];
  for (const cells of rows) {
    const byCol = new Map();
    let maxcol = -1;
    for (const [col, val] of cells) {
      byCol.set(col, val === null || val === undefined ? "" : String(val));
      maxcol = Math.max(maxcol, col);
    }
    const row = [];
    for (let i = 0; i <= maxcol; i++) row.push(byCol.has(i) ? byCol.get(i) : "");
    grid.push(row);
  }
  return grid;
}

export function extOf(name) {
  return splitext(String(name || ""))[1].toLowerCase();
}

/** Read a script file (name decides the format) and return plain text.
 *  Raises OldDocError for .doc/.xls; never fails on individual characters. */
export async function readScript(name, bytes) {
  const ext = extOf(name);
  if (ext === ".docx") return readDocx(bytes);
  if (ext === ".odt") return readOdt(bytes);
  if (ext === ".xlsx" || ext === ".xlsm") return readXlsx(bytes);
  if (ext === ".doc") throw new OldDocError(".doc");
  if (ext === ".xls") throw new OldDocError(".xls");
  return decodeBytes(bytes);          // .txt, .md and everything else
}

/** Split text into lines (\r\n and \r normalized); optionally drop empty. */
export function splitLines(text, skipEmpty) {
  let lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (skipEmpty) lines = lines.filter((ln) => strip(ln) !== "");
  return lines;
}
