import { readFileSync } from 'node:fs';
import { createPrivateKey, createSign } from 'node:crypto';
import { db } from '../config/supabase.js';
import { env } from '../config/env.js';

/**
 * Firebase Cloud Messaging HTTP v1 sender.
 *
 * Google's own SDK does exactly two things on the server: trade a signed service-account JWT for an
 * OAuth access token, then POST one message per device. Doing those two calls here keeps the
 * dependency tree unchanged, so the only push secret in the deployment is the JSON file the operator
 * points at with FIREBASE_SERVICE_ACCOUNT_PATH. That file is read when a message is actually sent and
 * its contents never leave this module — nothing here logs a key, and the reasons reported outward
 * only ever name the configuration, never its value.
 */

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const SEND_CONCURRENCY = 12;
// One event must never turn into thousands of HTTPS calls on the request's behalf.
const MAX_DEVICES_PER_SEND = 500;
const TOKEN_CHUNK = 100;
/** FCM tokens go in the last path segment of the message URL, so anything else is rejected. */
const TOKEN_SHAPE = /^[A-Za-z0-9_\-.:]+$/;

let credentials = null;
let blockedReason = 'the push sender has not been consulted yet';
let accessToken = null;
let tokenRequest = null;

function loadCredentials() {
  if (credentials) return credentials;
  if (!env.firebaseServiceAccountPath) {
    blockedReason = 'FIREBASE_SERVICE_ACCOUNT_PATH is not set — add it to .env';
    return null;
  }
  let raw;
  try {
    raw = readFileSync(env.firebaseServiceAccountPath, 'utf8');
  } catch {
    // Deliberately vague: the path itself may be meaningful to the deployment.
    blockedReason = 'the service-account file could not be read — check the path in .env';
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    blockedReason = 'the service-account file is not valid JSON';
    return null;
  }
  if (!parsed?.client_email || !parsed?.private_key) {
    blockedReason = 'the service-account file has no client_email or private_key';
    return null;
  }
  const projectId = env.firebaseProjectId || parsed.project_id;
  if (!projectId) {
    blockedReason = 'no Firebase project id — set FIREBASE_PROJECT_ID';
    return null;
  }
  credentials = { clientEmail: parsed.client_email, privateKey: parsed.private_key, projectId };
  blockedReason = '';
  return credentials;
}

/** What the account screen reports. Public information only: project id, never the credential. */
export function pushSenderStatus() {
  const ready = Boolean(loadCredentials());
  return { ready, projectId: ready ? credentials.projectId : null, reason: ready ? null : blockedReason };
}

const b64url = (value) => Buffer.from(value).toString('base64url');

function signedAssertion(account, issuedAt) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.clientEmail,
    scope: MESSAGING_SCOPE,
    aud: TOKEN_URI,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(createPrivateKey(account.privateKey));
  return `${signingInput}.${b64url(signature)}`;
}

/** Google mints a one-hour token; refresh early and share one in-flight exchange between senders. */
async function bearerToken() {
  const account = credentials;
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && accessToken.expiresAt - 60 > now) return accessToken.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const response = await fetch(TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedAssertion(account, now),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || `token exchange failed (${response.status})`);
    }
    accessToken = { value: payload.access_token, expiresAt: now + Number(payload.expires_in || 3600) };
    return accessToken.value;
  })().catch((error) => { accessToken = null; throw error; });
  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

function linkUrl(link) {
  const path = link || '/';
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.appBaseUrl.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function buildMessage(token, { title, body, link, tag, icon }) {
  const text = (value, fallback = '') => String(value ?? fallback);
  return {
    message: {
      token,
      // A page in the foreground receives data only; the service worker gets the same fields when
      // it is asleep, so both paths can build one notification without reading the title twice.
      data: {
        title: text(title),
        body: text(body),
        url: text(link, '/'),
        tag: text(tag, 'general'),
      },
      webpush: {
        headers: { TTL: '3600' },
        notification: {
          title: text(title),
          body: text(body),
          tag: text(tag, 'general'),
          icon: text(icon, '/icons/icon-192.png'),
          badge: text(icon, '/icons/icon-192.png'),
        },
        fcmOptions: { link: linkUrl(link) },
      },
    },
  };
}

async function sendOne(bearer, token, payload) {
  const url = `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages/${token}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => ({}));
    const status = body?.error?.status || '';
    const stale = response.status === 404 || ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(status);
    return { ok: false, stale, detail: status || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, stale: false, detail: error.message };
  }
}

/** Results stay in input order so a failure can be traced back to the device that reported it. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Send one notification to every device registered by these accounts.
 * Returns a summary rather than throwing: a push outage must never roll back the school event that
 * caused it. `unregistered` tokens are dropped so a signed-out browser stops being retried.
 */
export async function sendPushToUsers(userIds, { scope = 'school', title, body = '', link = '/', tag = 'general', icon } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return { attempted: 0, sent: 0, failed: 0, skipped: null, error: null };
  if (!pushSenderStatus().ready) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'sender_not_configured', error: blockedReason };
  }

  let tokens = [];
  try {
    for (let i = 0; i < ids.length; i += TOKEN_CHUNK) {
      const { data, error } = await db().from('push_tokens')
        .select('token').eq('user_type', scope).in('user_id', ids.slice(i, i + TOKEN_CHUNK)).limit(TOKEN_CHUNK);
      if (error) throw new Error(error.message);
      tokens.push(...(data || []).map((row) => row.token));
    }
  } catch (error) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'token_lookup_failed', error: error.message };
  }

  tokens = [...new Set(tokens.filter((t) => TOKEN_SHAPE.test(t)))].slice(0, MAX_DEVICES_PER_SEND);
  if (!tokens.length) return { attempted: ids.length, sent: 0, failed: 0, skipped: 'no_registered_devices', error: null };

  let bearer;
  try {
    bearer = await bearerToken();
  } catch (error) {
    // A clock skew or a revoked key shows up here; keep the message in the in-app inbox.
    return { attempted: tokens.length, sent: 0, failed: tokens.length, skipped: 'sender_credentials_rejected', error: error.message };
  }

  const payload = buildMessage(null, { title, body, link, tag, icon });
  const results = await pool(tokens, SEND_CONCURRENCY, (token) => sendOne(bearer, token, { ...payload, message: { ...payload.message, token } }));
  const sent = results.filter((r) => r.ok).length;
  const dead = tokens.filter((_, index) => results[index]?.stale);
  if (dead.length) {
    await db().from('push_tokens').delete().in('token', dead.slice(0, TOKEN_CHUNK)).then(
      () => {}, () => { /* the next sign-in re-registers the device anyway */ },
    );
  }
  return {
    attempted: tokens.length,
    sent,
    failed: tokens.length - sent,
    skipped: null,
    error: results.find((r) => !r.ok && !r.stale)?.detail || null,
  };
}
