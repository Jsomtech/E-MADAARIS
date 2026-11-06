import { readFileSync } from 'node:fs';
import { createPrivateKey, createSign } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Firebase Cloud Messaging HTTP v1 sender.
 *
 * Google's own SDK does exactly two things on the server: trade a signed service-account JWT for an
 * OAuth access token, then POST one message per device. Doing those two calls here keeps the
 * dependency tree unchanged, so the only push secret in the deployment is the service account itself —
 * either the file its path points at, or the same JSON held inline in FIREBASE_SERVICE_ACCOUNT_JSON for
 * hosts without a filesystem. It is consulted when a message is actually sent and its contents never
 * leave this module: nothing here logs a key, and the reasons reported outward only ever name the
 * configuration, never its value.
 */

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** FCM tokens go in the last path segment of the message URL, so anything else is rejected. */
const TOKEN_SHAPE = /^[A-Za-z0-9_\-.:]+$/;

let credentials = null;
let blockedReason = 'the push sender has not been consulted yet';
let accessToken = null;
let tokenRequest = null;

function loadCredentials() {
  if (credentials) return credentials;
  if (!env.firebaseServiceAccountJson && !env.firebaseServiceAccountPath) {
    blockedReason = 'no Firebase credentials — set FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_SERVICE_ACCOUNT_PATH';
    return null;
  }
  let raw;
  if (env.firebaseServiceAccountJson) {
    raw = env.firebaseServiceAccountJson;
  } else {
    try {
      raw = readFileSync(env.firebaseServiceAccountPath, 'utf8');
    } catch {
      // Deliberately vague: the path itself may be meaningful to the deployment.
      blockedReason = 'the service-account file could not be read — check the path in .env';
      return null;
    }
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

function buildMessage(token, { title, body, link, tag, icon, priority }) {
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
        priority: text(priority, 'normal'),
      },
      webpush: {
        headers: { TTL: '3600' },
        notification: {
          title: text(title),
          body: text(body),
          tag: text(tag, 'general'),
          icon: linkUrl(text(icon, '/icon-192.png')),
          badge: linkUrl(text(icon, '/icon-192.png')),
        },
        fcmOptions: { link: linkUrl(link) },
      },
    },
  };
}

async function sendOne(bearer, token, payload) {
  // The v1 endpoint is a fixed `messages:send` route; the device token travels inside the body.
  // Naming the token in the path makes FCM look it up as a message resource and answer 404, which
  // this file would then read as an unregistered device and drop the registration.
  const url = `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`;
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
    return {
      ok: false, stale, detail: status || `HTTP ${response.status}`,
      // The provider's own sentence, kept short. It explains a failure without ever naming the device.
      reason: String(body?.error?.message || '').slice(0, 500) || null,
    };
  } catch (error) {
    return { ok: false, stale: false, detail: error.message };
  }
}

/** Whether a stored registration is still addressable by this transport. */
export function isFcmToken(token) {
  return Boolean(token) && TOKEN_SHAPE.test(token);
}

/**
 * Deliver to one FCM registration. Everything above the single device — who receives what, how the
 * attempt is logged, which dead devices get retired — belongs to services/pushDelivery.js, because the
 * same message may go out over two transports in one fan-out.
 */
export async function sendFcmToDevice(token, { title, body = '', link = '/', tag = 'general', icon, priority = 'normal' } = {}) {
  if (!loadCredentials()) return { ok: false, stale: false, detail: 'SENDER_NOT_CONFIGURED' };
  if (!isFcmToken(token)) return { ok: false, stale: true, detail: 'MALFORMED_TOKEN' };
  let bearer;
  try {
    bearer = await bearerToken();
  } catch (error) {
    // A clock skew or a revoked key shows up here; the message stays in the in-app inbox either way.
    return { ok: false, stale: false, detail: 'SENDER_CREDENTIALS_REJECTED', reason: error.message };
  }
  return sendOne(bearer, token, buildMessage(token, { title, body, link, tag, icon, priority }));
}

