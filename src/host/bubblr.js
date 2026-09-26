// BubblR AI detection through the local bridge (tools/bubblr_bridge.py).
//
// Krita ran the detector's venv python as a subprocess. A UXP plugin cannot
// start processes, so a small stdlib HTTP server on 127.0.0.1 does that part
// and TypeR talks to it with fetch() (PORT_PLAN.md §3). Everything the
// detector returns is parsed by core/ai.js exactly like Krita's ai_backend.

import { T } from "./settings.js";
import { parseDetectJson, parsePanelsJson, makeYoloLabel } from "../core/ai.js";
import { base64 } from "../core/png.js";

export const DEFAULT_PORT = 8765;

export class BridgeMissing extends Error {}

/** The bridge runs but found no ai/ folder (Krita: st_bp_ai_missing). */
export class AiMissing extends Error {}

function base() {
  const port = Math.trunc(Number(T.get("bpBridgePort", DEFAULT_PORT))) || DEFAULT_PORT;
  return `http://127.0.0.1:${port}`;
}

async function call(path, { method = "GET", body = null, type = "application/octet-stream", timeoutMs = 300000 } = {}) {
  let r;
  let timer;
  try {
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error("timed out")), timeoutMs);
    });
    r = await Promise.race([fetch(base() + path, { method, body, headers: body ? { "Content-Type": type } : {} }), timeout]);
  } catch (e) {
    throw new BridgeMissing(String(e && e.message ? e.message : e));
  } finally {
    clearTimeout(timer);
  }
  const text = await r.text();
  if (r.status === 503) throw new AiMissing(text);
  if (!r.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error || text;
    } catch (e) {
      // plain text error
    }
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return text;
}

function query(o) {
  return Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export async function info() {
  return JSON.parse(await call("/info", { timeoutMs: 5000 }));
}

/** Boxes for a page PNG. */
export async function detect(png, { conf = 0.4, sfxConf = 0.25, tile = "auto", model = "auto" } = {}) {
  const text = await call("/detect?" + query({ conf, sfx_conf: sfxConf, tile, model }), { method: "POST", body: png, type: "image/png" });
  return parseDetectJson(text);
}

export async function detectPanels(png) {
  return parsePanelsJson(await call("/panels", { method: "POST", body: png, type: "image/png" }));
}

/** Save one training sample; resolves the image path the bridge wrote. */
export async function exportTraining(stem, png, boxes, w, h) {
  const body = JSON.stringify({ stem, image_png_b64: base64(png), label: makeYoloLabel(boxes, w, h), boxes });
  const r = JSON.parse(await call("/export", { method: "POST", body, type: "application/json" }));
  return r.path;
}

export async function openModels() {
  return call("/open_models", { method: "POST", body: "{}", type: "application/json", timeoutMs: 5000 });
}
