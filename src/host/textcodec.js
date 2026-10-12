// TextEncoder / TextDecoder for hosts that lack them (UXP 7.1 in Photoshop
// 2023 has neither). UTF-8 only — the only encoding TypeR asks for; a
// decoder for another label falls back to latin-1 like a byte string.
// Imported first by main.js so every later module finds them.

function utf8Encode(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    } else if (c >= 0xd800 && c <= 0xdfff) {
      c = 0xfffd;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** UTF-8 decode exactly as the WHATWG Encoding standard's decoder (one
 *  U+FFFD per maximal invalid subpart, BOM stripped). */
function utf8Decode(bytes, fatal) {
  let b = bytes;
  if (b instanceof ArrayBuffer) b = new Uint8Array(b);
  else if (ArrayBuffer.isView(b)) b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let i = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  const parts = [];
  let chunk = [];
  let cp = 0;
  let needed = 0;
  let seen = 0;
  let lower = 0x80;
  let upper = 0xbf;
  const emit = (c) => {
    if (c >= 0x10000) {
      const v = c - 0x10000;
      chunk.push(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
    } else {
      chunk.push(c);
    }
    if (chunk.length > 8000) {
      parts.push(String.fromCharCode.apply(null, chunk));
      chunk = [];
    }
  };
  const error = () => {
    if (fatal) throw new TypeError("The encoded data was not valid utf-8");
    emit(0xfffd);
  };
  while (i < b.length) {
    const byte = b[i];
    if (needed === 0) {
      i++;
      if (byte <= 0x7f) {
        emit(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        cp = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        cp = byte & 0xf;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        cp = byte & 0x7;
      } else {
        error();
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      // the invalid subpart ends here; this byte is read again
      cp = 0;
      needed = 0;
      seen = 0;
      lower = 0x80;
      upper = 0xbf;
      error();
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    cp = (cp << 6) | (byte & 0x3f);
    seen++;
    i++;
    if (seen === needed) {
      emit(cp);
      cp = 0;
      needed = 0;
      seen = 0;
    }
  }
  if (needed !== 0) error();
  parts.push(String.fromCharCode.apply(null, chunk));
  return parts.join("");
}

export class PolyTextEncoder {
  get encoding() {
    return "utf-8";
  }

  encode(s = "") {
    return utf8Encode(s);
  }
}

export class PolyTextDecoder {
  constructor(label = "utf-8", opts = {}) {
    this.label = String(label).toLowerCase().replace(/^utf8$/, "utf-8");
    this.fatal = !!opts.fatal;
  }

  get encoding() {
    return this.label;
  }

  decode(bytes) {
    if (bytes === undefined) return "";
    if (this.label === "utf-8") return utf8Decode(bytes, this.fatal);
    const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
}

/** Install the polyfills where the host has none. */
export function installTextCodec(g = globalThis) {
  if (typeof g.TextEncoder !== "function") g.TextEncoder = PolyTextEncoder;
  if (typeof g.TextDecoder !== "function") g.TextDecoder = PolyTextDecoder;
}

installTextCodec();
