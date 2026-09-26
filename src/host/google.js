// Google Docs / Drive access (port of gauth.py + gdocs.py network parts).
//
// UXP's fetch() does the HTTP; the manifest allows accounts.google.com,
// oauth2.googleapis.com, docs.googleapis.com and www.googleapis.com.

import * as GA from "../core/gauth.js";
import { Comment, attachByQuote } from "../core/comments.js";
import { sortedBy } from "../core/py.js";
import { openExternal } from "./ps.js";

const TIMEOUT_MS = 30000;

async function withTimeout(p) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new GA.AuthError("No connection to Google: timed out")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timer]);
  } finally {
    clearTimeout(t);
  }
}

async function postForm(url, fields) {
  let r;
  try {
    r = await withTimeout(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: GA.encodeForm(fields),
    }));
  } catch (e) {
    if (e instanceof GA.AuthError) throw e;
    throw new GA.AuthError("No connection to Google: " + (e && e.message ? e.message : e));
  }
  const body = await r.text();
  if (!r.ok) throw new GA.AuthError(GA.explain(body) || `HTTP ${r.status}`);
  return JSON.parse(body);
}

export async function getJson(url, tok) {
  let r;
  try {
    r = await withTimeout(fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } }));
  } catch (e) {
    if (e instanceof GA.AuthError) throw e;
    throw new GA.AuthError("No connection to Google: " + (e && e.message ? e.message : e));
  }
  const body = await r.text();
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new GA.AuthError(GA.explain(body) || `Google refused access (${r.status}). Is the document shared with this account?`);
    }
    throw new GA.AuthError(GA.explain(body) || `HTTP ${r.status}`);
  }
  return JSON.parse(body);
}

/**
 * Start the sign-in: opens the consent page in the browser and returns the
 * pending state. finishSignIn(state, pastedAddress) completes it.
 */
export function beginSignIn(clientId) {
  if (!clientId) throw new GA.AuthError("No client ID set.");
  const { verifier, challenge } = GA.pkcePair();
  const port = 49152 + Math.floor(Math.random() * 16000);
  const redirectUri = `http://127.0.0.1:${port}/`;
  openExternal(GA.authUrl(clientId, redirectUri, challenge));
  return { clientId, verifier, redirectUri };
}

export async function finishSignIn(state, pasted, clientSecret = "") {
  const params = GA.redirectParams(pasted);
  if (params.error) throw new GA.AuthError(GA.explain(params));
  if (!params.code) return null;
  const fields = {
    client_id: state.clientId,
    code: params.code,
    code_verifier: state.verifier,
    grant_type: "authorization_code",
    redirect_uri: state.redirectUri,
  };
  if (clientSecret) fields.client_secret = clientSecret;
  return GA.stamp(await postForm(GA.TOKEN_URI, fields));
}

export async function refresh(tok, clientId, clientSecret = "") {
  const rt = (tok || {}).refresh_token;
  if (!rt) throw new GA.AuthError("Not signed in.");
  const fields = { client_id: clientId, refresh_token: rt, grant_type: "refresh_token" };
  if (clientSecret) fields.client_secret = clientSecret;
  const fresh = await postForm(GA.TOKEN_URI, fields);
  return { ...tok, ...GA.stamp(fresh), refresh_token: rt };
}

export async function ensure(tok, clientId, clientSecret = "") {
  if (GA.isFresh(tok)) return tok;
  return refresh(tok, clientId, clientSecret);
}

export async function fetchLines(docId, tok) {
  return GA.docLines(await getJson(GA.DOCS_GET.replace("%s", encodeURIComponent(docId)), tok));
}

export async function fetchComments(fileId, tok, includeResolved = false) {
  const out = [];
  let pageToken = "";
  for (;;) {
    const args = { fields: GA.COMMENT_FIELDS, pageSize: "100", includeDeleted: "false" };
    if (pageToken) args.pageToken = pageToken;
    const url = GA.DRIVE_COMMENTS.replace("%s", encodeURIComponent(fileId)) + "?" + GA.encodeForm(args);
    const data = await getJson(url, tok);
    for (const rec of GA.commentRecords(data, includeResolved)) out.push(new Comment(rec));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

/** Everything TypeR needs from a Google Doc: [lines, anchored comments]. */
export async function load(docId, tok, includeResolved = false) {
  const lines = await fetchLines(docId, tok);
  const cs = await fetchComments(docId, tok, includeResolved);
  attachByQuote(cs, lines);
  return [lines, sortedBy(cs, (c) => [c.lines.length ? c.lines[0] : 1 << 30, c.id])];
}
