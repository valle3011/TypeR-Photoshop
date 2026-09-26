// Google sign-in helpers (host-free): PKCE, the auth URL, the error wording.
//
// Port of TypeR-Krita `typer_kr/gauth.py`. The flow is the same "installed
// app" flow (PKCE + loopback redirect, the user's OWN client ID). One
// difference is forced by UXP: a panel cannot listen on a socket, so nothing
// catches Google's redirect to http://127.0.0.1:<port>/. The browser shows
// that address as "cannot connect"; the user copies it into TypeR, and
// codeFromRedirect() takes the code out of it. See PORT_PLAN.md §3.

export const AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URI = "https://oauth2.googleapis.com/token";
export const SCOPES = "https://www.googleapis.com/auth/documents.readonly " +
  "https://www.googleapis.com/auth/drive.readonly";

export class AuthError extends Error {}

// --- SHA-256 (UXP has no crypto.subtle) -----------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(bytes) {
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

export function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  try {
    crypto.getRandomValues(out);           // eslint-disable-line no-undef
    return out;
  } catch (e) {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
}

/** A PKCE verifier plus its S256 challenge. */
export function pkcePair(rand = randomBytes) {
  const verifier = b64url(rand(64));
  const challenge = b64url(sha256(new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export function encodeForm(fields) {
  return Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    .replace(/%20/g, "+");
}

/** The browser URL of the consent screen. */
export function authUrl(clientId, redirectUri, challenge) {
  return AUTH_URI + "?" + encodeForm({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
}

/** The query parameters of the pasted redirect address ({} if none). */
export function redirectParams(pasted) {
  const s = String(pasted || "").trim();
  const q = s.includes("?") ? s.slice(s.indexOf("?") + 1) : s.includes("code=") ? s : "";
  const out = {};
  for (const part of q.split("#")[0].split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decodeURIComponent((i >= 0 ? part.slice(0, i) : part).replace(/\+/g, " "));
    const v = i >= 0 ? decodeURIComponent(part.slice(i + 1).replace(/\+/g, " ")) : "";
    out[k] = v;
  }
  return out;
}

/** Turn Google's error JSON into something a user can act on. */
export function explain(body) {
  let d;
  try {
    d = typeof body === "string" ? JSON.parse(body) : body;
  } catch (e) {
    return body ? String(body).slice(0, 200) : "";
  }
  if (!d || typeof d !== "object") return "";
  const err = d.error || "";
  const desc = d.error_description || "";
  if (err === "invalid_grant") {
    return "Google rejected the saved sign-in (invalid_grant). This is usually the 7-day expiry that applies " +
      "while the Cloud project is still in 'Testing'. Set it to 'In production' and sign in again.";
  }
  if (err === "invalid_client") return "That client ID is not valid for a desktop app.";
  if (err === "access_denied") return "Sign-in was cancelled.";
  if (typeof err === "object") return String(err.message || JSON.stringify(err)).slice(0, 200);
  return `${err}: ${desc}`.replace(/^: |: $/g, "");
}

/** Turn Google's expires_in into an absolute time. */
export function stamp(tok, now = Date.now() / 1000) {
  const t = { ...tok };
  if ("expires_in" in t) t.expires_at = now + Number(t.expires_in) - 60;
  return t;
}

export function isFresh(tok, now = Date.now() / 1000) {
  return !!(tok && tok.access_token && now < Number(tok.expires_at || 0));
}

// --- Docs API -> lines --------------------------------------------------------

export const DOCS_GET = "https://docs.googleapis.com/v1/documents/%s";
export const DRIVE_COMMENTS = "https://www.googleapis.com/drive/v3/files/%s/comments";
export const EXPORT_URL = "https://docs.google.com/document/d/%s/export?format=docx";
export const COMMENT_FIELDS = "comments(id,content,author/displayName,createdTime," +
  "resolved,quotedFileContent/value," +
  "replies(content,author/displayName,createdTime))," +
  "nextPageToken";

export function isGdoc(path) {
  return String(path || "").toLowerCase().endsWith(".gdoc");
}

export function exportUrl(docId) {
  return EXPORT_URL.replace("%s", docId);
}

/** The document id inside a .gdoc stub's text. Throws Error when none. */
export function stubDocId(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    throw new Error("Could not read the .gdoc shortcut: " + e.message);
  }
  let id = (d && (d.doc_id || d.resource_id)) || "";
  if (id.includes(":")) id = id.split(":").slice(1).join(":");
  if (!id) throw new Error("That .gdoc has no document id in it.");
  return id;
}

function paraText(el) {
  const para = el.paragraph;
  if (!para) return null;
  const out = [];
  for (const pe of para.elements || []) {
    if (pe.textRun) out.push(pe.textRun.content || "");
  }
  return out.join("").replace(/\v/g, "\n").replace(/\n+$/, "");
}

/** The document's paragraphs (empty ones kept: they separate blocks). */
export function docLines(doc) {
  const body = ((doc && doc.body) || {}).content || [];
  const lines = [];
  for (const el of body) {
    const t = paraText(el);
    if (t !== null) lines.push(t);
  }
  return lines;
}

/** One Drive comments page -> plain comment records (resolved dropped). */
export function commentRecords(data, includeResolved = false) {
  const out = [];
  for (const c of (data && data.comments) || []) {
    if (c.resolved && !includeResolved) continue;
    const author = (c.author || {}).displayName || "";
    const replies = [];
    for (const r of c.replies || []) {
      const ra = (r.author || {}).displayName || "";
      const rc = (r.content || "").trim();
      if (rc) replies.push(ra ? `${ra}: ${rc}` : rc);
    }
    out.push({
      id: c.id || "",
      author,
      date: (c.createdTime || "").slice(0, 10),
      text: (c.content || "").trim(),
      resolved: !!c.resolved,
      replies,
      quoted: (c.quotedFileContent || {}).value || "",
    });
  }
  return out;
}
