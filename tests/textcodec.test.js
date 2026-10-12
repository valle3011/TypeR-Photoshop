// The UTF-8 TextEncoder/TextDecoder stand-ins (UXP 7.1 has neither) must
// agree with the real ones.
import { test, expect } from "vitest";
import { PolyTextEncoder, PolyTextDecoder } from "../src/host/textcodec.js";

const SAMPLES = ["", "Hello", "Grüße – „Zitat“ ✓", "鬼だ！ドドドド", "😀 emoji 🇩🇪", "\u0000\u007f\u0080\u07ff\u0800\uffff"];

test("encodes like TextEncoder", () => {
  for (const s of SAMPLES) expect([...new PolyTextEncoder().encode(s)]).toEqual([...new TextEncoder().encode(s)]);
});

test("decodes like TextDecoder, BOM and broken bytes included", () => {
  for (const s of SAMPLES) {
    const b = new TextEncoder().encode(s);
    expect(new PolyTextDecoder("utf-8").decode(b)).toBe(new TextDecoder("utf-8").decode(b));
  }
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
  expect(new PolyTextDecoder().decode(withBom)).toBe(new TextDecoder().decode(withBom));
  const broken = new Uint8Array([0x41, 0xc3, 0x28, 0xe2, 0x82, 0x42, 0xff]);
  expect(new PolyTextDecoder().decode(broken)).toBe(new TextDecoder().decode(broken));
  expect(() => new PolyTextDecoder("utf-8", { fatal: true }).decode(broken)).toThrow();
});
