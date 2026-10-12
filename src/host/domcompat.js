// DOM methods the panel uses that older UXP versions lack (Photoshop 2023 /
// UXP 7.1: "e.append is not a function"). Each is added only where missing,
// on the prototype that defines appendChild, so every element gets it.
// Imported by main.js right after the text codec, before any UI module runs.

function owner(proto, name) {
  let p = proto;
  while (p && !Object.prototype.hasOwnProperty.call(p, name)) p = Object.getPrototypeOf(p);
  return p;
}

function define(proto, name, fn) {
  try {
    Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
  } catch (e) {
    proto[name] = fn;
  }
}

function toNode(x) {
  return x !== null && typeof x === "object" && typeof x.nodeType === "number" ? x : document.createTextNode(String(x));
}

/** Install the missing methods. Returns the names that were added. */
export function installDomCompat(doc = typeof document !== "undefined" ? document : null) {
  const added = [];
  if (!doc || typeof doc.createElement !== "function") return added;
  const probe = doc.createElement("div");
  const base = owner(Object.getPrototypeOf(probe), "appendChild") || Object.getPrototypeOf(probe);
  const elProto = Object.getPrototypeOf(probe);

  if (typeof probe.append !== "function") {
    define(base, "append", function append(...nodes) {
      for (const n of nodes) this.appendChild(toNode(n));
    });
    added.push("append");
  }
  if (typeof probe.prepend !== "function") {
    define(base, "prepend", function prepend(...nodes) {
      const first = this.firstChild;
      for (const n of nodes) this.insertBefore(toNode(n), first);
    });
    added.push("prepend");
  }
  if (typeof probe.remove !== "function") {
    define(base, "remove", function remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    });
    added.push("remove");
  }
  if (typeof probe.matches !== "function") {
    const native = probe.msMatchesSelector || probe.webkitMatchesSelector;
    define(base, "matches", native || function matches(sel) {
      const root = this.parentNode || doc;
      if (!root || typeof root.querySelectorAll !== "function") return false;
      const list = root.querySelectorAll(sel);
      for (let i = 0; i < list.length; i++) if (list[i] === this) return true;
      return false;
    });
    added.push("matches");
  }
  if (typeof probe.closest !== "function") {
    define(base, "closest", function closest(sel) {
      let el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(sel)) return el;
        el = el.parentNode;
      }
      return null;
    });
    added.push("closest");
  }
  if (!("children" in probe)) {
    try {
      Object.defineProperty(base, "children", {
        configurable: true,
        get() {
          const out = [];
          for (let n = this.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
          return out;
        },
      });
      added.push("children");
    } catch (e) {
      // read-only host
    }
  }

  // classList: missing entirely, or toggle() without the force argument
  if (!probe.classList) {
    try {
      Object.defineProperty(elProto, "classList", {
        configurable: true,
        get() {
          const el = this;
          const list = () => String(el.className || "").split(/\s+/).filter((c) => c);
          const set = (arr) => { el.className = arr.join(" "); };
          return {
            add: (...c) => set([...new Set([...list(), ...c])]),
            remove: (...c) => set(list().filter((x) => !c.includes(x))),
            contains: (c) => list().includes(c),
            toggle(c, force) {
              const has = list().includes(c);
              const on = force === undefined ? !has : !!force;
              if (on && !has) this.add(c);
              if (!on && has) this.remove(c);
              return on;
            },
          };
        },
      });
      added.push("classList");
    } catch (e) {
      // read-only host
    }
  } else {
    const cl = probe.classList;
    let forceOk = false;
    try {
      cl.toggle("x", false);
      forceOk = !cl.contains("x");
      cl.toggle("x", true);
      cl.toggle("x", true);
      forceOk = forceOk && cl.contains("x");
      cl.remove("x");
    } catch (e) {
      forceOk = false;
    }
    if (!forceOk) {
      const listProto = Object.getPrototypeOf(cl);
      const plain = listProto.toggle;
      define(listProto, "toggle", function toggle(c, force) {
        if (force === undefined) return plain.call(this, c);
        if (force) this.add(c);
        else this.remove(c);
        return !!force;
      });
      added.push("classList.toggle(force)");
    }
  }
  return added;
}

try {
  const added = installDomCompat();
  if (added.length) console.log("[TypeR] DOM compat added: " + added.join(", "));   // eslint-disable-line no-console
} catch (e) {
  // never block the start over a polyfill
}
