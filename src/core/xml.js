// A small, tolerant XML parser with ElementTree semantics.
//
// UXP has no DOMParser, and the Krita readers are written against
// xml.etree.ElementTree (tags as "{namespace-uri}local", .text/.tail, iter()).
// Keeping those semantics lets readers.js and comments.js follow the Python
// code line by line. Handles namespaces, attributes, entities, CDATA,
// comments, processing instructions and a DOCTYPE; not a validating parser.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s || s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch (err) {
        return m;
      }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

export class Element {
  constructor(tag, attrib) {
    this.tag = tag;          // "{uri}local" or "local"
    this.attrib = attrib;    // {"{uri}name" | "name": value}
    this.children = [];
    this.text = null;
    this.tail = null;
  }

  get local() {
    return localName(this.tag);
  }

  get(name, dflt = null) {
    return Object.prototype.hasOwnProperty.call(this.attrib, name) ? this.attrib[name] : dflt;
  }

  /** Depth-first, document order, self included — like ElementTree.iter(). */
  * iter(tag = null) {
    if (tag === null || this.tag === tag) yield this;
    for (const c of this.children) yield* c.iter(tag);
  }

  find(tag) {
    return this.children.find((c) => c.tag === tag) || null;
  }

  [Symbol.iterator]() {
    return this.children[Symbol.iterator]();
  }
}

/** '{...}p' -> 'p' */
export function localName(tag) {
  const i = tag.lastIndexOf("}");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function resolve(qname, scopes, isAttr) {
  const i = qname.indexOf(":");
  if (i < 0) {
    if (isAttr) return qname;                      // unprefixed attrs have no ns
    for (let k = scopes.length - 1; k >= 0; k--) {
      if (Object.prototype.hasOwnProperty.call(scopes[k], "")) {
        const uri = scopes[k][""];
        return uri ? `{${uri}}${qname}` : qname;
      }
    }
    return qname;
  }
  const prefix = qname.slice(0, i);
  const local = qname.slice(i + 1);
  if (prefix === "xml") return `{http://www.w3.org/XML/1998/namespace}${local}`;
  for (let k = scopes.length - 1; k >= 0; k--) {
    if (Object.prototype.hasOwnProperty.call(scopes[k], prefix)) return `{${scopes[k][prefix]}}${local}`;
  }
  return qname;                                    // undeclared prefix: keep it
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse an XML string (or bytes, decoded as UTF-8) into its root Element. */
export function fromString(src) {
  if (typeof src !== "string") src = new TextDecoder("utf-8").decode(src);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const stack = [];
  const scopes = [];
  let root = null;
  let last = null;           // the node whose text/tail receives the next chars
  let lastIsTail = false;
  let i = 0;
  const n = src.length;

  const addText = (txt) => {
    if (!txt) return;
    if (last === null) return;
    if (lastIsTail) last.tail = (last.tail || "") + txt;
    else last.text = (last.text || "") + txt;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      addText(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(src.slice(i, lt)));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      addText(src.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      // DOCTYPE (possibly with an internal subset)
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt + 2);
      const el = stack.pop();
      scopes.pop();
      if (el) {
        last = el;
        lastIsTail = true;
      }
      i = end < 0 ? n : end + 1;
      continue;
    }
    // start tag: find its end, honouring quoted attribute values
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
    }
    let body = src.slice(lt + 1, j);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    const qname = m ? m[1] : "";
    const rawAttrs = [];
    const scope = {};
    ATTR_RE.lastIndex = 0;
    let am;
    const attrText = body.slice(qname.length);
    while ((am = ATTR_RE.exec(attrText)) !== null) {
      const name = am[1];
      const value = decodeEntities(am[3] !== undefined ? am[3] : am[4]);
      if (name === "xmlns") scope[""] = value;
      else if (name.startsWith("xmlns:")) scope[name.slice(6)] = value;
      else rawAttrs.push([name, value]);
    }
    scopes.push(scope);
    const attrib = {};
    for (const [name, value] of rawAttrs) attrib[resolve(name, scopes, true)] = value;
    const el = new Element(resolve(qname, scopes, false), attrib);
    if (stack.length) stack[stack.length - 1].children.push(el);
    else if (root === null) root = el;
    if (selfClosing) {
      scopes.pop();
      last = el;
      lastIsTail = true;
    } else {
      stack.push(el);
      last = el;
      lastIsTail = false;
    }
    i = j + 1;
  }
  if (root === null) throw new Error("XML: no root element");
  return root;
}
