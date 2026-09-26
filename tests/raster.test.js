// Software renderer smoke tests (preview + card) on a real system font.
import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as opentype from "opentype.js";
import { renderPreview, renderCard, pickFaces } from "../src/core/preview.js";
import { encodePng, decodePng } from "../src/core/png.js";
import { fillCoverage, rectContour, distanceField, dilate } from "../src/core/raster.js";
import * as L from "../src/core/layout.js";
import { makeMeasurer } from "../src/core/measure.js";
import { installHyphLoader } from "./helpers.js";

installHyphLoader();
const WINF = process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : "C:/Windows/Fonts";
const load = (f) => {
  const p = path.join(WINF, f);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const arial = load("arial.ttf");
const arialBd = load("arialbd.ttf");
const OUT = process.env.TYPER_RENDER_OUT || "";

const opts = {
  bold: false, italic: false, underline: false, ligatures: true, color: "#000000",
  align: "center", valign: "middle", case: "upper", tidy: true, comic: false, crossbarI: false,
  vertical: false, spacing: 1.05, sizeRef: 72, outline: true, outlineColor: "#ffffff", outlinePx: 8,
  outline2Color: "#000000", outline2Px: 16, shadow: true, shadowColor: "#ff0000", shadowDx: 4, shadowDy: 4,
  hyphenate: false, hyphLang: "en",
};

test("coverage + distance basics", () => {
  const cov = fillCoverage([rectContour(2.5, 2.5, 5, 5)], 10, 10);
  expect(cov[5 * 10 + 5]).toBe(1);
  expect(cov[0]).toBe(0);
  expect(cov[2 * 10 + 5]).toBeCloseTo(0.5, 5);
  const d = distanceField(cov, 10, 10);
  expect(d[5 * 10 + 5]).toBe(0);
  const grown = dilate(cov, 10, 10, 2, d);
  expect(grown[0 * 10 + 5]).toBeGreaterThan(0);
});

test("png round trip", () => {
  const rgba = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 255);
  const back = decodePng(encodePng(rgba, 3, 2));
  expect(back.w).toBe(3);
  expect(Array.from(back.rgba)).toEqual(Array.from(rgba));
});

test.skipIf(!arial)("preview renders text with outline, 2nd outline and shadow", () => {
  const faces = pickFaces({ regular: arial, bold: arialBd, italic: null, boldItalic: null }, false, false);
  const res = renderPreview("Hello **there**, it's a trap!", opts, faces, 320, 140);
  expect(res.empty).toBe(false);
  expect(res.px).toBeGreaterThan(10);
  let dark = 0;
  let red = 0;
  for (let i = 0; i < res.rgba.length; i += 4) {
    if (res.rgba[i] < 40 && res.rgba[i + 1] < 40) dark++;
    if (res.rgba[i] > 200 && res.rgba[i + 1] < 60) red++;
  }
  expect(dark).toBeGreaterThan(200);
  expect(red).toBeGreaterThan(50);
  if (OUT) fs.writeFileSync(path.join(OUT, "preview.png"), encodePng(res.rgba, 320, 140));

  const m = makeMeasurer({ regular: arial, bold: arialBd }, 1.05, false, false);
  const cands = L.shapeCandidates("WE SHOULD TRY TO FIND A WAY TO FIX THIS", m, 220, 160, 72, 6, 0.12);
  expect(cands.length).toBeGreaterThan(2);
  const card = renderCard(cands[0], { ...opts, shadow: false }, faces, 200, 150, Math.min(188 / 220, 138 / 160));
  if (OUT) fs.writeFileSync(path.join(OUT, "card.png"), encodePng(card, 200, 150));
});
