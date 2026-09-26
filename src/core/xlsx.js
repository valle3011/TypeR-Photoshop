// A tiny, dependency-free .xlsx writer: one worksheet, bold + frozen header
// row, string and number cells, column widths. Strings are written inline.
//
// Port of TypeR-Krita `typer_kr/xlsx.py`. `xlsxParts()` returns the ZIP parts
// ({path: xmlString}); `writeXlsx()` packs them with JSZip into bytes.

import JSZip from "jszip";
import { fixed } from "./py.js";

export function colLetter(n) {
  let s = "";
  n += 1;
  while (n) {
    const r = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    s = String.fromCharCode(65 + r) + s;
  }
  return s;
}

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pyStr(v) {
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

function cell(col, row, value, style = null) {
  const ref = `${colLetter(col)}${row}`;
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (value === null || value === undefined) value = "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(pyStr(value))}</t></is></c>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

const WB_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border/></borders>'
  + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
  + '<cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function freezePane(freezeRows, freezeCols) {
  if (!freezeRows && !freezeCols) return "";
  const attrs = [];
  if (freezeCols) attrs.push(`xSplit="${freezeCols}"`);
  if (freezeRows) attrs.push(`ySplit="${freezeRows}"`);
  const top = `${colLetter(freezeCols)}${freezeRows + 1}`;
  const pane = freezeRows && freezeCols ? "bottomRight" : freezeRows ? "bottomLeft" : "topRight";
  attrs.push(`topLeftCell="${top}"`);
  attrs.push(`activePane="${pane}"`);
  return `<pane ${attrs.join(" ")} state="frozen"/>`;
}

/** The parts of a single-sheet workbook ({zipPath: xml}). */
export function xlsxParts(sheetName, headers, rows, widths = null, freezeRows = 1, freezeCols = 0) {
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'
    + Array.from(esc(sheetName)).slice(0, 31).join("") + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  let colsXml = "";
  if (widths && widths.length) {
    colsXml = "<cols>" + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${fixed(w, 1)}" customWidth="1"/>`).join("") + "</cols>";
  }
  const body = ['<row r="1">'];
  headers.forEach((h, c) => body.push(cell(c, 1, h, 1)));
  body.push("</row>");
  rows.forEach((row, k) => {
    const ri = k + 2;
    body.push(`<row r="${ri}">`);
    row.forEach((val, c) => body.push(cell(c, ri, val)));
    body.push("</row>");
  });
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">'
    + freezePane(freezeRows, freezeCols) + "</sheetView></sheetViews>" + colsXml
    + "<sheetData>" + body.join("") + "</sheetData></worksheet>";
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": wb,
    "xl/_rels/workbook.xml.rels": WB_RELS,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheet,
  };
}

/** Bytes of a single-sheet .xlsx. */
export async function writeXlsx(sheetName, headers, rows, widths = null, freezeRows = 1, freezeCols = 0) {
  const zip = new JSZip();
  for (const [p, xml] of Object.entries(xlsxParts(sheetName, headers, rows, widths, freezeRows, freezeCols))) {
    zip.file(p, xml);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
