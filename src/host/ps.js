// Thin, defensive access to the Photoshop / UXP APIs.
//
// Everything that talks to Photoshop goes through here: lazy requires (so
// the core can be loaded in Node tests), unit unwrapping, batchPlay, and
// executeAsModal with a named history step. Nothing here holds UI state.

let _ps = null;
let _uxp = null;

/** The host's module loader: UXP's global `require` (also what the tests
 *  install), else the bundler's. */
export function hostRequire(id) {
  const g = typeof globalThis !== "undefined" ? globalThis.require : undefined;
  if (typeof g === "function") return g(id);
  return require(id);                               // eslint-disable-line no-undef
}

export function ps() {
  if (!_ps) _ps = hostRequire("photoshop");
  return _ps;
}

export function uxp() {
  if (!_uxp) _uxp = hostRequire("uxp");
  return _uxp;
}

export function hasPhotoshop() {
  try {
    return !!ps().app;
  } catch (e) {
    return false;
  }
}

/** Photoshop's version as [major, minor]. */
/** Photoshop's version string: app.version, else UXP's host info
 *  (app.version is undefined on Photoshop 2023 / UXP 7.1). */
export function psVersionString() {
  try {
    if (ps().app.version) return String(ps().app.version);
  } catch (e) {
    // fall through
  }
  try {
    const host = uxp().host;
    if (host && host.version) return String(host.version);
  } catch (e) {
    // unknown
  }
  return "0.0";
}

export function psVersion() {
  const v = psVersionString().split(".");
  return [Number(v[0]) || 0, Number(v[1]) || 0];
}

export function atLeast(major, minor = 0) {
  const [a, b] = psVersion();
  return a > major || (a === major && b >= minor);
}

/** UXP values come as numbers or as {_unit, _value}. */
export function num(v) {
  if (v && typeof v === "object" && "_value" in v) return Number(v._value);
  return Number(v) || 0;
}

export async function batchPlay(descs, opts = {}) {
  const res = await ps().action.batchPlay(descs, { synchronousExecution: false, modalBehavior: "execute", ...opts });
  for (const r of res || []) {
    if (r && r._obj === "error") {
      const err = new Error(r.message || "batchPlay error");
      err.result = r;
      throw err;
    }
  }
  return res;
}

/**
 * Run `fn(ctx)` inside executeAsModal. With `history` (default) all changes
 * are folded into ONE named history step; `rollback: true` discards every
 * change (used for measuring probes that must leave no trace).
 */
export async function modal(name, fn, { history = true, rollback = false } = {}) {
  const { core, app } = ps();
  let out;
  await core.executeAsModal(async (ctx) => {
    const doc = app.activeDocument;
    let sid = null;
    if ((history || rollback) && doc) {
      try {
        sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name });
      } catch (e) {
        sid = null;
      }
    }
    try {
      out = await fn(ctx);
    } finally {
      if (sid !== null) await ctx.hostControl.resumeHistory(sid, !rollback);
    }
  }, { commandName: name });
  return out;
}

/** Active document facts, or null. */
export function docInfo() {
  try {
    const { app } = ps();
    const d = app.activeDocument;
    if (!d) return null;
    return {
      id: d.id,
      w: num(d.width),
      h: num(d.height),
      resolution: num(d.resolution) || 72,
      mode: String(d.mode || ""),
      name: d.name || "",
      path: d.path || "",
      bits: String(d.bitsPerChannel || ""),
    };
  } catch (e) {
    return null;
  }
}

/** The selection's bounds [x, y, w, h], or null (no selection). */
export async function selectionBounds() {
  try {
    const res = await ps().action.batchPlay([{
      _obj: "get",
      _target: [{ _property: "selection" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
    }], { synchronousExecution: false });
    const s = res && res[0] && res[0].selection;
    if (!s) return null;
    const left = num(s.left);
    const top = num(s.top);
    const right = num(s.right);
    const bottom = num(s.bottom);
    if (right <= left || bottom <= top) return null;
    return [left, top, right - left, bottom - top];
  } catch (e) {
    return null;
  }
}

/** Bounds of a layer {left, top, right, bottom} without effects. */
export async function layerBounds(layerId) {
  const res = await ps().action.batchPlay([{
    _obj: "get",
    _target: [{ _property: "boundsNoEffects" }, { _ref: "layer", _id: layerId }],
  }], { synchronousExecution: false });
  const b = res && res[0] && res[0].boundsNoEffects;
  if (!b) return null;
  return { left: num(b.left), top: num(b.top), right: num(b.right), bottom: num(b.bottom) };
}

export function openExternal(url) {
  try {
    return uxp().shell.openExternal(url);
  } catch (e) {
    return null;
  }
}

export function openPath(path) {
  try {
    return uxp().shell.openPath(path);
  } catch (e) {
    return null;
  }
}
