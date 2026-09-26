// Pure layout model for the customizable TypeR panel (host-free, testable).
//
// Port of TypeR-Krita `typer_kr/layoutmodel.py`. Owns the JSON-able config
// that says which tabs exist, their names and order, which panels each tab
// contains and in which order, which panels are detached, and whether editing
// is locked. Every mutation returns a NEW, repaired config and never loses a
// known panel, so a stale or corrupt saved config can never brick the panel.

export const PANELS = [
  "script_box", "jp_en_table", "nav_line", "active_field",
  "font_picker", "color_pick", "presets", "live_preview",
  "style_basic", "style_size", "style_outline", "style_shadow",
  "hyphenation",
  "bubblr_detect", "bubblr_overlay", "bubblr_map",
  "shapr_panel", "sfx_panel",
  "setup_general", "layout_sizes",
];

// tab id -> [default display-name key, [panel ids]]
export const DEFAULT_TABS = [
  ["type", "tab_type", ["script_box", "jp_en_table", "nav_line",
    "active_field", "font_picker", "color_pick", "presets", "live_preview"]],
  ["style", "tab_style", ["style_basic", "style_size", "style_outline",
    "style_shadow", "hyphenation"]],
  ["bubblr", "tab_bubblr", ["bubblr_detect", "bubblr_overlay", "bubblr_map"]],
  ["setup", "tab_setup", ["setup_general", "layout_sizes"]],
  ["shapr", "tab_shapr", ["shapr_panel"]],
  ["sfx", "tab_sfx", ["sfx_panel"]],
];

// how many extra host panels exist for detached panels
export const MAX_DETACH_SLOTS = 3;

const clone = (x) => JSON.parse(JSON.stringify(x));
const isDict = (d) => d !== null && typeof d === "object" && !Array.isArray(d);

/** A fresh config: the built-in tabs, nothing detached, locked. */
export function defaultLayout() {
  return {
    tabs: DEFAULT_TABS.map(([tid, nk, panels]) => ({ id: tid, name: null, namekey: nk, panels: [...panels] })),
    detached: [],
    locked: true,
  };
}

function tab(cfg, tabId) {
  for (const t of cfg.tabs) if (t.id === tabId) return t;
  return null;
}

/** [tabId, index] of `panel` in the tabs, or [null, -1]. */
export function findPanel(cfg, panel) {
  for (const t of cfg.tabs) {
    const i = t.panels.indexOf(panel);
    if (i >= 0) return [t.id, i];
  }
  return [null, -1];
}

export function isDetached(cfg, panel) {
  return (cfg.detached || []).some((d) => d.panels.includes(panel));
}

/** Every panel id currently referenced (in a tab or detached). */
export function allPlacedPanels(cfg) {
  const seen = [];
  for (const t of cfg.tabs) seen.push(...t.panels);
  for (const d of cfg.detached || []) seen.push(...d.panels);
  return seen;
}

export function panelLocked(cfg, panel) {
  return (cfg.locked_panels || []).includes(panel);
}

function removePanelEverywhere(cfg, panel) {
  for (const t of cfg.tabs) {
    const i = t.panels.indexOf(panel);
    if (i >= 0) t.panels.splice(i, 1);
  }
  for (const d of cfg.detached || []) {
    const i = d.panels.indexOf(panel);
    if (i >= 0) d.panels.splice(i, 1);
  }
  cfg.detached = (cfg.detached || []).filter((d) => d.panels.length);
}

/** Move `panel` into tab `toTab` at `index` (append when null). */
export function movePanel(cfg, panel, toTab, index = null) {
  cfg = clone(cfg);
  if (!PANELS.includes(panel) || tab(cfg, toTab) === null) return repair(cfg);
  removePanelEverywhere(cfg, panel);
  const dest = tab(cfg, toTab).panels;
  if (index === null || index === undefined || index < 0 || index > dest.length) dest.push(panel);
  else dest.splice(index, 0, panel);
  return repair(cfg);
}

/** Move a panel within one tab from oldIndex to newIndex. */
export function reorderPanel(cfg, tabId, oldIndex, newIndex) {
  cfg = clone(cfg);
  const t = tab(cfg, tabId);
  if (t === null || !(oldIndex >= 0 && oldIndex < t.panels.length)) return repair(cfg);
  const [panel] = t.panels.splice(oldIndex, 1);
  newIndex = Math.max(0, Math.min(newIndex, t.panels.length));
  t.panels.splice(newIndex, 0, panel);
  return repair(cfg);
}

/** Give a tab a custom display name (empty/null -> default localized name). */
export function renameTab(cfg, tabId, name) {
  cfg = clone(cfg);
  const t = tab(cfg, tabId);
  if (t !== null) t.name = name || null;
  return repair(cfg);
}

/** Append a new empty tab; returns [cfg, newTabId]. */
export function addTab(cfg, name, tabId = null) {
  cfg = clone(cfg);
  const existing = new Set(cfg.tabs.map((t) => t.id));
  if (!tabId || existing.has(tabId)) {
    let n = 1;
    while (existing.has(`tab${n}`)) n += 1;
    tabId = `tab${n}`;
  }
  cfg.tabs.push({ id: tabId, name: name || null, namekey: null, panels: [] });
  return [repair(cfg), tabId];
}

/** Delete a tab; its panels move to the first remaining tab. Refuses to
 *  remove the last tab. */
export function removeTab(cfg, tabId) {
  cfg = clone(cfg);
  if (cfg.tabs.length <= 1) return repair(cfg);
  const victim = tab(cfg, tabId);
  if (victim === null) return repair(cfg);
  cfg.tabs.splice(cfg.tabs.indexOf(victim), 1);
  const dest = cfg.tabs[0].panels;
  for (const p of victim.panels) if (!dest.includes(p)) dest.push(p);
  return repair(cfg);
}

/** Reorder tabs by a list of tab ids; unknown ids ignored, missing appended. */
export function reorderTabs(cfg, order) {
  cfg = clone(cfg);
  const byId = new Map(cfg.tabs.map((t) => [t.id, t]));
  const next = order.filter((i) => byId.has(i)).map((i) => byId.get(i));
  for (const t of cfg.tabs) if (!next.includes(t)) next.push(t);
  cfg.tabs = next;
  return repair(cfg);
}

/** Detach panels into host `slot` (0-based); an occupied slot is freed first. */
export function detach(cfg, panels, slot) {
  cfg = clone(cfg);
  panels = panels.filter((p) => PANELS.includes(p));
  if (!panels.length || slot < 0 || slot >= MAX_DETACH_SLOTS) return repair(cfg);
  for (const d of [...(cfg.detached || [])]) {
    if (d.slot === slot) reattachGroup(cfg, d.panels);
  }
  for (const p of panels) removePanelEverywhere(cfg, p);
  if (!cfg.detached) cfg.detached = [];
  cfg.detached.push({ panels: [...panels], slot, floating: false });
  return repair(cfg);
}

function reattachGroup(cfg, panels, toTab = null) {
  cfg.detached = (cfg.detached || []).filter((d) => !panels.some((p) => d.panels.includes(p)));
  const destId = tab(cfg, toTab) ? toTab : cfg.tabs[0].id;
  const dest = tab(cfg, destId).panels;
  for (const p of panels) if (!dest.includes(p)) dest.push(p);
}

/** Bring detached panels back into a tab (first tab when null/unknown). */
export function reattach(cfg, panels, toTab = null) {
  cfg = clone(cfg);
  reattachGroup(cfg, panels.filter((p) => PANELS.includes(p)), toTab);
  return repair(cfg);
}

export function setLocked(cfg, locked) {
  cfg = clone(cfg);
  cfg.locked = !!locked;
  return repair(cfg);
}

/** Pin/unpin a single panel so it can't be dragged even in edit mode. */
export function setPanelLocked(cfg, panel, locked) {
  cfg = clone(cfg);
  const lp = new Set(cfg.locked_panels || []);
  if (locked) lp.add(panel);
  else lp.delete(panel);
  cfg.locked_panels = [...lp].sort();
  return repair(cfg);
}

/**
 * Return a structurally valid config: drop unknown/duplicate panels, drop
 * empty detached groups and clamp slots, re-home every missing known panel to
 * its default tab, guarantee at least one tab, coerce the top-level types.
 * `knownPanels` is a parameter so a test can simulate an older/newer set.
 */
export function repair(cfg, knownPanels = PANELS) {
  const known = [...knownPanels];
  const knownSet = new Set(known);
  if (!isDict(cfg)) cfg = defaultLayout();
  let tabs = cfg.tabs;
  if (!Array.isArray(tabs) || !tabs.length) tabs = defaultLayout().tabs;
  let outTabs = [];
  let seen = new Set();
  const usedIds = new Set();
  for (const t of tabs) {
    if (!isDict(t)) continue;
    let tid = t.id;
    if (typeof tid !== "string" || !tid || usedIds.has(tid)) {
      let n = 1;
      while (usedIds.has(`tab${n}`)) n += 1;
      tid = `tab${n}`;
    }
    usedIds.add(tid);
    const panels = [];
    for (const p of t.panels || []) {
      if (knownSet.has(p) && !seen.has(p)) {
        panels.push(p);
        seen.add(p);
      }
    }
    outTabs.push({
      id: tid,
      name: typeof t.name === "string" ? t.name : null,
      namekey: typeof t.namekey === "string" ? t.namekey : null,
      panels,
    });
  }
  if (!outTabs.length) {
    outTabs = defaultLayout().tabs;
    seen = new Set(outTabs.flatMap((t) => t.panels));
  }

  const outDet = [];
  const usedSlots = new Set();
  for (const d of cfg.detached || []) {
    if (!isDict(d)) continue;
    const ps = (d.panels || []).filter((p) => knownSet.has(p) && !seen.has(p));
    if (!ps.length) continue;
    let slot = d.slot;
    if (!Number.isInteger(slot) || typeof slot === "boolean" || slot < 0 || slot >= MAX_DETACH_SLOTS || usedSlots.has(slot)) {
      slot = null;
      for (let s = 0; s < MAX_DETACH_SLOTS; s++) {
        if (!usedSlots.has(s)) {
          slot = s;
          break;
        }
      }
      if (slot === null) {
        // no free slot -> put them back into the first tab instead
        outTabs[0].panels.push(...ps);
        ps.forEach((p) => seen.add(p));
        continue;
      }
    }
    usedSlots.add(slot);
    outDet.push({ panels: ps, slot, floating: !!d.floating });
    ps.forEach((p) => seen.add(p));
  }

  // re-home any known panel that went missing using the default tab mapping
  const defaultHome = new Map();
  for (const [tid, , plist] of DEFAULT_TABS) for (const p of plist) defaultHome.set(p, tid);
  for (const p of known) {
    if (seen.has(p)) continue;
    const homeId = defaultHome.get(p);
    const home = homeId ? outTabs.find((t) => t.id === homeId) || null : null;
    (home || outTabs[0]).panels.push(p);
    seen.add(p);
  }

  const lockedPanels = [...new Set((cfg.locked_panels || []).filter((p) => knownSet.has(p)))].sort();
  return {
    tabs: outTabs,
    detached: outDet,
    locked: cfg.locked === undefined ? true : !!cfg.locked,
    locked_panels: lockedPanels,
  };
}
