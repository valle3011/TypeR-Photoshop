// Script comments — one model, several sources (.docx comments, Google Drive
// comments), anchored to the lines / units they mark.
//
// Port of TypeR-Krita `typer_kr/comments.py`.

import JSZip from "jszip";
import { fromString } from "./xml.js";
import { strip, cps, sortedBy } from "./py.js";

const W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}";

export const SCOPE_LINE = "line";
export const SCOPE_PAGE = "page";

/** One note from the script, tied to the lines it marks. `scope` is derived:
 *  one line = about that line, several = about the page. */
export class Comment {
  constructor({ id = "", author = "", date = "", text = "", resolved = false,
    replies = null, quoted = "", lines = null } = {}) {
    this.id = id;
    this.author = author;
    this.date = date;
    this.text = text;
    this.resolved = resolved;
    this.replies = [...(replies || [])];
    this.quoted = quoted;
    this.lines = [...new Set(lines || [])].sort((a, b) => a - b);
  }

  get scope() {
    return this.lines.length <= 1 ? SCOPE_LINE : SCOPE_PAGE;
  }

  toJSON() {
    return { id: this.id, author: this.author, date: this.date, text: this.text, resolved: this.resolved,
      replies: this.replies, quoted: this.quoted, lines: this.lines };
  }
}

function paraText(p) {
  return [...p.iter(W + "t")].map((t) => t.text || "").join("");
}

// Google's .docx export glues reactions onto a comment's text
// ("nah use it1 total reactionguilhbr reacted with 👍 …") — cut it back.
const REACTIONS = /\d+\s*total\s*reactions?[\s\S]*$/i;

function clean(text) {
  return strip((text || "").replace(REACTIONS, "").replace(/ /g, " "));
}

/** Comments of a .docx (bytes or a loaded JSZip), anchored to paragraph
 *  indices. [] for a document without comments or anything malformed. */
export async function fromDocx(bytes) {
  let zip;
  try {
    zip = bytes instanceof JSZip ? bytes : await JSZip.loadAsync(bytes);
  } catch (e) {
    return [];
  }
  try {
    if (!zip.file("word/comments.xml")) return [];
    const meta = new Map();
    const croot = fromString(await zip.file("word/comments.xml").async("uint8array"));
    for (const cm of croot.iter(W + "comment")) {
      const cid = cm.get(W + "id");
      meta.set(cid, {
        author: cm.get(W + "author") || "",
        date: (cm.get(W + "date") || "").slice(0, 10),
        text: clean([...cm.iter(W + "t")].map((t) => t.text || "").join("")),
      });
    }
    const droot = fromString(await zip.file("word/document.xml").async("uint8array"));
    const body = droot.find(W + "body");
    const spans = new Map();
    const quoted = new Map();
    const open = new Set();
    let idx = 0;
    for (const p of body.iter(W + "p")) {
      const starts = new Set([...p.iter(W + "commentRangeStart")].map((s) => s.get(W + "id")));
      const ends = new Set([...p.iter(W + "commentRangeEnd")].map((s) => s.get(W + "id")));
      for (const s of starts) open.add(s);
      // a paragraph counts for every range that is open across it
      for (const cid of open) {
        if (!spans.has(cid)) spans.set(cid, new Set());
        spans.get(cid).add(idx);
        if (!quoted.has(cid)) quoted.set(cid, []);
        quoted.get(cid).push(paraText(p));
      }
      for (const e of ends) open.delete(e);
      idx += 1;
    }
    const out = [];
    for (const [cid, m] of meta) {
      out.push(new Comment({
        id: cid, author: m.author, date: m.date, text: m.text,
        quoted: cps((quoted.get(cid) || []).filter((t) => t).join(" / ")).slice(0, 200).join(""),
        lines: [...(spans.get(cid) || [])],
      }));
    }
    return sortedBy(out, (c) => [c.lines.length ? c.lines[0] : 1 << 30, c.id]);
  } catch (e) {
    // a malformed script must never stop the user from typesetting
    return [];
  }
}

function norm(s) {
  return strip((s || "").replace(/\s+/g, " ")).toLowerCase();
}

const FRAG_SPLIT = /\s*\/\s*|\n/;

/** Anchor comments that only know their quoted text (the Google path). */
export function attachByQuote(comments, lines) {
  const normLines = lines.map((l) => norm(l));
  for (const c of comments) {
    if (c.lines.length || !c.quoted) continue;
    const q = norm(c.quoted);
    if (!q) continue;
    let hits = [];
    normLines.forEach((l, i) => {
      if (l && (q.includes(l) || l.includes(q))) hits.push(i);
    });
    if (!hits.length) {
      // fall back to the longest quoted fragment that does match
      const frags = sortedBy(c.quoted.split(FRAG_SPLIT), (f) => cps(f).length, true);
      for (const frag of frags) {
        const fq = norm(frag);
        if (cps(fq).length < 3) continue;
        hits = [];
        normLines.forEach((l, i) => {
          if (l && l.includes(fq)) hits.push(i);
        });
        if (hits.length) break;
      }
    }
    c.lines = [...new Set(hits)].sort((a, b) => a - b);
  }
  return comments;
}

/** Re-anchor comments from script lines onto TypeR's translation units by
 *  their quoted text; comments whose quote matches nothing keep no anchor. */
export function anchorToUnits(comments, unitTexts) {
  const normUnits = unitTexts.map((t) => norm(t));
  for (const c of comments) {
    c.lines = [];
    if (!c.quoted) continue;
    const frags = c.quoted.split(FRAG_SPLIT).filter((f) => norm(f));
    const hits = new Set();
    for (const frag of frags) {
      const fq = norm(frag);
      if (cps(fq).length < 3) continue;
      normUnits.forEach((u, i) => {
        if (u && (u.includes(fq) || fq.includes(u))) hits.add(i);
      });
    }
    c.lines = [...hits].sort((a, b) => a - b);
  }
  return comments;
}

/** What to show while sitting on unit `index` (line notes + page notes). */
export function forUnit(comments, index, unitPages) {
  if (index === null || index === undefined || index < 0) return [];
  const page = index >= 0 && index < unitPages.length ? unitPages[index] : "";
  const out = [];
  for (const c of comments) {
    if (!c.lines.length) continue;
    if (c.scope === SCOPE_LINE) {
      if (c.lines.includes(index)) out.push(c);
    } else {
      const pages = new Set(c.lines.filter((i) => i >= 0 && i < unitPages.length).map((i) => unitPages[i]));
      if (pages.has(page)) out.push(c);
    }
  }
  return out;
}

/** Comments a given line should show: its own, plus the page-wide ones. */
export function forLine(comments, lineIndex) {
  return comments.filter((c) => (c.scope === SCOPE_LINE && c.lines.includes(lineIndex))
    || (c.scope === SCOPE_PAGE && c.lines.length && c.lines[0] <= lineIndex && lineIndex <= c.lines[c.lines.length - 1]));
}

/** Every comment touching any of `lineIndices` (the current page). */
export function forLines(comments, lineIndices) {
  const want = new Set(lineIndices || []);
  if (!want.size) return [];
  const out = [];
  for (const c of comments) {
    if (!c.lines.length) continue;
    let touched;
    if (c.scope === SCOPE_PAGE) {
      touched = [];
      for (let i = c.lines[0]; i <= c.lines[c.lines.length - 1]; i++) touched.push(i);
    } else {
      touched = c.lines;
    }
    if (touched.some((i) => want.has(i))) out.push(c);
  }
  return out;
}

export function hasAny(comments, lineIndices) {
  return forLines(comments, lineIndices).length > 0;
}

/** Rebuild Comment objects from persisted JSON. */
export function fromJSON(list) {
  return (list || []).map((d) => new Comment(d || {}));
}
