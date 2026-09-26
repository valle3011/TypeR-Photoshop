// Small DOM toolkit for the panel: element builder, Spectrum UXP widget
// wrappers with one consistent API (value/checked/enabled/onChange), modal
// dialogs, popup menus and debouncing.
//
// Spectrum UXP widgets (sp-button, sp-checkbox, sp-picker, sp-textfield,
// sp-action-button) render natively and follow the Photoshop theme; the
// wrappers hide their small quirks (sp-picker's selectedIndex, events that
// fire on programmatic changes) so the tab code reads like the Qt original.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function show(el, on) {
  if (el) el.style.display = on ? "" : "none";
}

export function isShown(el) {
  return !!el && el.style.display !== "none";
}

export function row(...children) {
  return h("div", { class: "row" }, ...children);
}

export function flow(...children) {
  return h("div", { class: "flow" }, ...children);
}

export function label(text, cls = "lbl") {
  return h("span", { class: cls, text });
}

export function hint(text = "") {
  return h("div", { class: "hint", text });
}

export function hline() {
  return h("sp-divider", { size: "small", class: "hline" });
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  d.now = (...a) => {
    d.cancel();
    fn(...a);
  };
  return d;
}

// --- widgets ------------------------------------------------------------------

/** A button. opts: {variant: 'cta'|'primary'|'secondary', quiet, tip, onClick}. */
export function Button(text, opts = {}) {
  const el = h("sp-button", { variant: opts.variant || "secondary", size: "s", quiet: !!opts.quiet, title: opts.tip || null });
  el.textContent = text;
  if (opts.onClick) el.addEventListener("click", (e) => {
    if (!el.hasAttribute("disabled")) opts.onClick(e);
  });
  el.setText = (t) => { el.textContent = t; };
  el.setTip = (t) => { el.title = t || ""; };
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  return el;
}

/** A small (icon-like) action button; `toggle` makes it checkable. */
export function ActionButton(text, opts = {}) {
  const el = h("sp-action-button", { quiet: opts.quiet !== false, size: "s", title: opts.tip || null, class: opts.class || null });
  el.textContent = text;
  let checked = false;
  el.setText = (t) => { el.textContent = t; };
  el.setTip = (t) => { el.title = t || ""; };
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  if (opts.toggle) {
    el.isChecked = () => checked;
    el.setChecked = (on, silent = true) => {
      checked = !!on;
      if (checked) el.setAttribute("selected", "");
      else el.removeAttribute("selected");
      if (!silent && opts.onToggle) opts.onToggle(checked);
    };
    el.addEventListener("click", () => {
      if (el.hasAttribute("disabled")) return;
      el.setChecked(!checked, false);
    });
  } else if (opts.onClick) {
    el.addEventListener("click", (e) => {
      if (!el.hasAttribute("disabled")) opts.onClick(e);
    });
  }
  return el;
}

/** A checkable push button (Qt's QPushButton.setCheckable). */
export function ToggleButton(text, opts = {}) {
  return ActionButton(text, { ...opts, toggle: true, quiet: false });
}

/** A checkbox. onChange(checked) fires on user clicks only. */
export function Check(text, opts = {}) {
  const el = h("sp-checkbox", { title: opts.tip || null, size: "s" });
  el.textContent = text;
  if (opts.checked) el.checked = true;
  el.isChecked = () => !!el.checked;
  el.setChecked = (on, silent = true) => {
    el.checked = !!on;
    if (!silent && opts.onChange) opts.onChange(!!on);
  };
  el.setText = (t) => { el.textContent = t; };
  el.setTip = (t) => { el.title = t || ""; };
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  el.addEventListener("change", () => opts.onChange && opts.onChange(!!el.checked));
  return el;
}

/**
 * A dropdown. items = [{label, value, separator?}]. value() / setValue() /
 * setItems() / index(). onChange(value) fires on user changes only; like Qt's
 * `activated`, re-picking the same entry fires again when `activated` is set.
 */
export function Select(items = [], opts = {}) {
  const el = h("sp-picker", { size: "s", title: opts.tip || null, class: opts.class || "grow", placeholder: opts.placeholder || null });
  const menu = h("sp-menu", { slot: "options" });
  el.appendChild(menu);
  let values = [];
  let silent = false;
  let lastIdx = -1;
  el.setItems = (list, keep = true) => {
    const prev = keep ? el.value() : undefined;
    silent = true;
    clear(menu);
    values = [];
    for (const it of list) {
      if (it.separator) {
        menu.appendChild(h("sp-menu-divider"));
        continue;
      }
      const mi = h("sp-menu-item", {});
      mi.textContent = it.label;
      menu.appendChild(mi);
      mi._value = it.value;
      values.push(it.value);
    }
    if (keep && prev !== undefined) el.setValue(prev);
    else el.setIndex(values.length ? 0 : -1);
    silent = false;
  };
  const itemEls = () => Array.from(menu.children).filter((c) => c.tagName && c.tagName.toLowerCase() === "sp-menu-item");
  el.setIndex = (i) => {
    const items2 = itemEls();
    items2.forEach((mi, k) => {
      if (k === i) mi.setAttribute("selected", "");
      else mi.removeAttribute("selected");
    });
    try {
      el.selectedIndex = i;
    } catch (e) {
      // older UXP
    }
    lastIdx = i;
  };
  el.index = () => {
    const items2 = itemEls();
    const k = items2.findIndex((mi) => mi.hasAttribute("selected") || mi.selected);
    if (k >= 0) return k;
    return typeof el.selectedIndex === "number" ? el.selectedIndex : lastIdx;
  };
  el.value = () => {
    const i = el.index();
    return i >= 0 && i < values.length ? values[i] : undefined;
  };
  el.values = () => [...values];
  el.setValue = (v) => {
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const i = values.findIndex((x) => eq(x, v));
    if (i >= 0) el.setIndex(i);
    return i >= 0;
  };
  el.labelAt = (i) => {
    const items2 = itemEls();
    return items2[i] ? items2[i].textContent : "";
  };
  el.setLabelAt = (i, text) => {
    const items2 = itemEls();
    if (items2[i]) items2[i].textContent = text;
  };
  el.count = () => values.length;
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  el.setTip = (t) => { el.title = t || ""; };
  el.addEventListener("change", () => {
    if (silent) return;
    const i = el.index();
    const same = i === lastIdx;
    lastIdx = i;
    if (opts.onChange && (!same || opts.activated)) opts.onChange(el.value());
  });
  el.setItems(items, false);
  return el;
}

/** A single-line text field. onChange(text) on input; onEnter on Return. */
export function TextField(opts = {}) {
  const el = h("sp-textfield", { size: "s", placeholder: opts.placeholder || null, class: opts.class || "grow", title: opts.tip || null, quiet: !!opts.quiet });
  if (opts.value) el.value = opts.value;
  el.text = () => String(el.value || "");
  el.setText = (t) => { el.value = t || ""; };
  el.setPlaceholder = (t) => el.setAttribute("placeholder", t || "");
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  el.setTip = (t) => { el.title = t || ""; };
  if (opts.onChange) el.addEventListener("input", () => opts.onChange(el.text()));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && opts.onEnter) opts.onEnter(el.text());
    if (e.key === "Escape" && opts.onEscape) opts.onEscape();
  });
  if (opts.onBlur) el.addEventListener("blur", () => opts.onBlur(el.text()));
  return el;
}

/** A multi-line text area (the script box, the active field). */
export function TextArea(opts = {}) {
  const el = h("textarea", { class: "textarea " + (opts.class || ""), placeholder: opts.placeholder || null, spellcheck: "false" });
  if (opts.height) el.style.height = `${opts.height}px`;
  el.text = () => String(el.value || "");
  el.setText = (t) => { el.value = t || ""; };
  el.setPlaceholder = (t) => el.setAttribute("placeholder", t || "");
  if (opts.onChange) el.addEventListener("input", () => opts.onChange(el.text()));
  return el;
}

/** A number field with min/max (Qt's QSpinBox). onChange(value). */
export function NumberField(opts = {}) {
  const el = h("sp-textfield", { type: "number", size: "s", class: "num " + (opts.class || ""), title: opts.tip || null });
  const min = opts.min ?? -Infinity;
  const max = opts.max ?? Infinity;
  let cur = opts.value ?? 0;
  el.value = String(cur);
  el.num = () => cur;
  el.setNum = (v, silent = true) => {
    const n = Math.max(min, Math.min(max, Math.round(Number(v))));
    cur = Number.isFinite(n) ? n : cur;
    el.value = String(cur);
    if (!silent && opts.onChange) opts.onChange(cur);
  };
  el.setEnabled = (on) => {
    if (on) el.removeAttribute("disabled");
    else el.setAttribute("disabled", "");
  };
  el.setTip = (t) => { el.title = t || ""; };
  const commit = () => {
    const n = Number(String(el.value).replace(",", "."));
    if (!Number.isFinite(n)) {
      el.value = String(cur);
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    const changed = clamped !== cur;
    cur = clamped;
    if (String(el.value) !== String(cur)) el.value = String(cur);
    if (changed && opts.onChange) opts.onChange(cur);
  };
  el.addEventListener("change", commit);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      el.setNum(cur + (opts.step || 1), false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      el.setNum(cur - (opts.step || 1), false);
    }
  });
  if (opts.suffix) {
    const wrap = h("span", { class: "numwrap" }, el, h("span", { class: "suffix", text: opts.suffix }));
    wrap.num = el.num;
    wrap.setNum = el.setNum;
    wrap.setEnabled = el.setEnabled;
    wrap.setTip = el.setTip;
    wrap.field = el;
    return wrap;
  }
  return el;
}

/** A colour swatch button: click -> Photoshop's colour picker (via `pick`). */
export function ColorButton(text, opts = {}) {
  const sw = h("span", { class: "swatch" });
  const lbl = h("span", { text });
  const el = h("div", { class: "colorbtn", role: "button", tabindex: "0", title: opts.tip || null }, sw, lbl);
  let color = opts.color || "#000000";
  let enabled = true;
  const paint = () => {
    sw.style.backgroundColor = color;
  };
  paint();
  el.color = () => color;
  el.setColor = (c) => {
    color = c;
    paint();
  };
  el.setText = (t) => { lbl.textContent = t; };
  el.setEnabled = (on) => {
    enabled = !!on;
    el.classList.toggle("disabled", !enabled);
  };
  el.addEventListener("click", async () => {
    if (!enabled || !opts.pick) return;
    const c = await opts.pick(color);
    if (c) {
      color = c;
      paint();
      if (opts.onChange) opts.onChange(c);
    }
  });
  return el;
}

/** A collapsible section header (the Setup sections). */
export function Collapsible(title, open, onToggle) {
  const body = h("div", { class: "collapsible-body" });
  const head = h("div", { class: "collapsible-head", role: "button", tabindex: "0" });
  let isOpen = !!open;
  const arrow = h("span", { class: "arrow" });
  const text = h("span", { text: title });
  head.appendChild(arrow);
  head.appendChild(text);
  const sync = () => {
    arrow.textContent = isOpen ? "▾" : "▸";
    show(body, isOpen);
  };
  head.addEventListener("click", () => {
    isOpen = !isOpen;
    sync();
    if (onToggle) onToggle(isOpen);
  });
  sync();
  const box = h("div", { class: "collapsible" }, head, body);
  box.body = body;
  box.setTitle = (t) => { text.textContent = t; };
  box.isOpen = () => isOpen;
  box.setOpen = (on) => {
    isOpen = !!on;
    sync();
  };
  return box;
}

// --- dialogs --------------------------------------------------------------------

/**
 * A modal dialog. build(body, close) fills the body and returns nothing;
 * buttons = [{label, value, variant}] along the bottom. Resolves with the
 * clicked button's value (or null on Escape / close).
 */
export async function dialog(title, build, buttons = [{ label: "OK", value: true, variant: "cta" }], opts = {}) {
  const dlg = h("dialog", { class: "typer-dialog" });
  const body = h("div", { class: "dlg-body" });
  const foot = h("div", { class: "dlg-foot" });
  dlg.appendChild(h("div", { class: "dlg-title", text: title }));
  dlg.appendChild(body);
  dlg.appendChild(foot);
  document.body.appendChild(dlg);
  let result = null;
  const close = (v) => {
    result = v;
    try {
      dlg.close(v);
    } catch (e) {
      // closed
    }
  };
  build(body, close);
  for (const b of buttons) {
    foot.appendChild(Button(b.label, { variant: b.variant || "secondary", onClick: () => close(b.value) }));
  }
  try {
    if (dlg.uxpShowModal) {
      await dlg.uxpShowModal({ title, resize: opts.resize || "both", size: { width: opts.width || 360, height: opts.height || 0 } });
    } else {
      dlg.showModal();
      await new Promise((resolve) => dlg.addEventListener("close", resolve, { once: true }));
    }
  } finally {
    dlg.remove();
  }
  return result;
}

/** A non-modal window (popups that must stay open while you work). */
export function modeless(title, build, opts = {}) {
  const dlg = h("dialog", { class: "typer-dialog" });
  const body = h("div", { class: "dlg-body" });
  dlg.appendChild(h("div", { class: "dlg-title", text: title }));
  dlg.appendChild(body);
  document.body.appendChild(dlg);
  const close = () => {
    try {
      dlg.close();
    } catch (e) {
      // closed
    }
    dlg.remove();
    if (opts.onClose) opts.onClose();
  };
  build(body, close);
  if (dlg.show) dlg.show();
  return { dlg, close };
}

export async function alertBox(title, text, okLabel = "OK") {
  return dialog(title, (body) => {
    body.appendChild(h("div", { class: "dlg-text", text }));
  }, [{ label: okLabel, value: true, variant: "cta" }]);
}

export async function confirmBox(title, text, yes = "Yes", no = "No") {
  const r = await dialog(title, (body) => {
    body.appendChild(h("div", { class: "dlg-text", text }));
  }, [{ label: no, value: false }, { label: yes, value: true, variant: "cta" }]);
  return r === true;
}

/** Text prompt (Qt's QInputDialog.getText / getMultiLineText). */
export async function promptBox(title, labelText, initial = "", { multiline = false, okLabel = "OK", cancelLabel = "Cancel" } = {}) {
  let field;
  const r = await dialog(title, (body) => {
    if (labelText) body.appendChild(h("div", { class: "dlg-text", text: labelText }));
    field = multiline ? TextArea({ height: 120 }) : TextField({ value: initial });
    if (multiline) field.setText(initial);
    body.appendChild(field);
    setTimeout(() => {
      try {
        field.focus();
      } catch (e) {
        // no focus
      }
    }, 50);
  }, [{ label: cancelLabel, value: false }, { label: okLabel, value: true, variant: "cta" }]);
  return r === true ? field.text() : null;
}

/** Pick one of several strings (QInputDialog.getItem). */
export async function chooseBox(title, labelText, items, okLabel = "OK", cancelLabel = "Cancel") {
  let sel;
  const r = await dialog(title, (body) => {
    if (labelText) body.appendChild(h("div", { class: "dlg-text", text: labelText }));
    sel = Select(items.map((t, i) => ({ label: t, value: i })));
    body.appendChild(sel);
  }, [{ label: cancelLabel, value: false }, { label: okLabel, value: true, variant: "cta" }]);
  return r === true ? sel.value() : null;
}

// --- popup menus ----------------------------------------------------------------

let openMenu = null;

/** A popup menu at an element or event. items = [{label, onClick, checked,
 *  disabled} | {separator: true}]. */
export function popupMenu(anchorOrEvent, items) {
  closeMenu();
  const menu = h("div", { class: "popup-menu" });
  for (const it of items) {
    if (it.separator) {
      menu.appendChild(h("div", { class: "popup-sep" }));
      continue;
    }
    const mi = h("div", { class: "popup-item" + (it.disabled ? " disabled" : "") },
      h("span", { class: "check", text: it.checked ? "✓" : "" }), h("span", { text: it.label }));
    mi.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.disabled) return;
      closeMenu();
      if (it.onClick) it.onClick();
    });
    menu.appendChild(mi);
  }
  // UXP panels share one document: the menu goes into the panel it was
  // opened from (the TypeR root or an extra host), else the body
  const src = anchorOrEvent && anchorOrEvent.target ? anchorOrEvent.target : anchorOrEvent;
  let root = null;
  try {
    root = src && src.closest ? src.closest(".typer-root, .extra-host, dialog") : null;
  } catch (e) {
    root = null;
  }
  root = root || document.body;
  root.appendChild(menu);
  let x = 10;
  let y = 10;
  if (anchorOrEvent && anchorOrEvent.clientX !== undefined) {
    x = anchorOrEvent.clientX;
    y = anchorOrEvent.clientY;
  } else if (anchorOrEvent && anchorOrEvent.getBoundingClientRect) {
    const r = anchorOrEvent.getBoundingClientRect();
    x = r.left;
    y = r.bottom;
  }
  const rr = root.getBoundingClientRect ? root.getBoundingClientRect() : { left: 0, top: 0, width: 300 };
  const vw = rr.width || document.documentElement.clientWidth || 300;
  menu.style.left = `${Math.max(2, Math.min(x - rr.left, vw - 190))}px`;
  menu.style.top = `${y - rr.top + (root.scrollTop || 0)}px`;
  openMenu = menu;
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  return menu;
}

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/** Image element showing RGBA pixels (via a PNG data URL). */
export function imageEl(cls = "") {
  const img = h("img", { class: cls, draggable: "false" });
  return img;
}
