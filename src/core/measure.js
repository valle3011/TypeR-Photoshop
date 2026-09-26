// Text measuring on real font files (opentype.js Font objects).
//
// This is the Photoshop port's replacement for Qt's QFontMetricsF: the layout
// engine only ever asks `measurer(px) -> [widthOf, spaceW, lineH, ascent,
// descent]` (see layout.js), so everything the engine decides — wrap,
// balance, auto-fit, TextShapR — rests on these numbers matching what
// Photoshop sets. Advances come straight from the font (kerning included,
// which Photoshop applies with its default "Metrics" kerning); an optional
// per-face calibration factor (measured against a real PS text layer, see
// host/measure.js) absorbs anything left over (tracking, faux styles).
//
// Vertical text does not come through here: it uses layout.verticalMeasurer
// (characters x size), see the warning there.

import { pyRound, pyInt } from "./py.js";

/** Vertical metrics in font units, the way Qt reports them on Windows:
 *  typo metrics when USE_TYPO_METRICS (fsSelection bit 7) is set, else the
 *  win ascent/descent, else hhea. Cap height from OS/2, else the 'H' glyph. */
export function faceMetrics(font) {
  const upm = font.unitsPerEm || 1000;
  const os2 = font.tables && font.tables.os2;
  const hhea = font.tables && font.tables.hhea;
  let ascent;
  let descent;
  if (os2 && (os2.fsSelection & 0x80) && os2.sTypoAscender) {
    ascent = os2.sTypoAscender;
    descent = -os2.sTypoDescender;
  } else if (os2 && (os2.usWinAscent || os2.usWinDescent)) {
    ascent = os2.usWinAscent;
    descent = os2.usWinDescent;
  } else if (hhea) {
    ascent = hhea.ascender;
    descent = -hhea.descender;
  } else {
    ascent = font.ascender || upm * 0.8;
    descent = -(font.descender || -upm * 0.2);
  }
  let cap = os2 && os2.sCapHeight ? os2.sCapHeight : 0;
  if (!cap) {
    try {
      const g = font.charToGlyph("H");
      const bb = g && g.getBoundingBox ? g.getBoundingBox() : null;
      if (bb && bb.y2 > 0) cap = bb.y2;
    } catch (e) {
      cap = 0;
    }
  }
  return { upm, ascent, descent, cap };
}

/** Advance width of `text` in px (kerning on, ligatures as requested). */
export function advance(font, text, px, ligatures = true) {
  if (!text) return 0;
  const opts = { kerning: true, features: { liga: !!ligatures, rlig: true } };
  return font.getAdvanceWidth(text, px, opts);
}

/**
 * measurer(px) -> [widthOf, spaceW, lineH, ascent, descent] for a face set
 * {regular, bold} (the caller already picked the italic cut when italic).
 * `bold` makes the whole line bold; a Word's bold runs use `faces.bold`.
 * `cal` is {regular, bold} width correction factors (1 = uncalibrated).
 */
export function makeMeasurer(faces, lineSpacing, bold = false, italic = false, opts = {}) {
  const { ligatures = true, cal = null } = opts;
  const reg = faces.regular;
  const bol = faces.bold || faces.regular;
  const calR = (cal && cal.regular) || 1;
  const calB = (cal && cal.bold) || calR;
  const mBase = faceMetrics(bold ? bol : reg);
  const cache = new Map();
  return (px0) => {
    const px = Math.max(1, pyInt(pyRound(px0)));
    const hit = cache.get(px);
    if (hit) return hit;
    const main = bold ? bol : reg;
    const mainCal = bold ? calB : calR;
    const memo = new Map();
    const adv = (face, c, t) => {
      const key = (face === main ? "m" : "b") + t;
      let v = memo.get(key);
      if (v === undefined) {
        v = advance(face, t, px, ligatures) * c;
        memo.set(key, v);
      }
      return v;
    };
    const spaceW = adv(main, mainCal, " ");
    const scale = px / mBase.upm;
    const ascent = mBase.ascent * scale;
    const descent = mBase.descent * scale;
    const lineH = (ascent + descent) * lineSpacing;
    const widthOf = (x) => {
      let runs = x && typeof x === "object" && !Array.isArray(x) ? x.runs : undefined;
      if (runs === undefined) {
        if (Array.isArray(x)) runs = x;
        else return adv(main, mainCal, String(x));
      }
      let tot = 0.0;
      for (const [t, b] of runs) {
        tot += (bold || b) ? adv(bol, calB, t) : adv(reg, calR, t);
      }
      return tot;
    };
    const res = [widthOf, spaceW, lineH, ascent, descent];
    cache.set(px, res);
    return res;
  };
}

/** Cap height in px for the optical vertical centring (layout.verticalStart). */
export function capHeightPx(font, px) {
  const m = faceMetrics(font);
  return m.cap ? (m.cap / m.upm) * px : null;
}
