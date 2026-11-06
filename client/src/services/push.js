import { apiGet, apiPost } from '../api/client.js';
import { firebaseConfig, registerServiceWorker } from './pwa.js';

/**
 * Getting a message onto the phone's lock screen, before the app is opened.
 *
 * Two transports, one subscription per browser. Firebase Cloud Messaging serves Chrome and Firefox on
 * Android and desktop. Standards-based Web Push (RFC 8291, signed by this project's own VAPID pair) is
 * what reaches Safari on iPhone and iPad once the app sits on the Home Screen, because Apple does not
 * run FCM in the browser. A registration may hold only one push subscription and the two transports
 * cannot share it, so this file chooses one per device — iOS goes straight to Web Push, everything else
 * tries Firebase first and falls back. services/pushDelivery.js on the server then fans out to
 * whichever set of devices answers; both halves are one system, never two competing ones.
 *
 * The server side of a send is services/webpush.js and services/fcm.js — this file only registers
 * devices and shows the messages that arrive while the page is open.
 */
const config = firebaseConfig;

const TOKEN_KEY = 'emadaaris.pushToken';
const ENDPOINT_KEY = 'emadaaris.pushEndpoint';

export function missingPushConfig() {
  return Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
}

export const isPushConfigured = missingPushConfig().length === 0;

let messagingPromise = null;

async function loadMessaging() {
  if (!isPushConfigured) {
    throw new Error('Push notifications are not configured yet. Add the Firebase web config to client/.env and restart the app.');
  }
  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    const [{ initializeApp, getApps }, { getMessaging, isSupported }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);
    if (!(await isSupported())) throw new Error('This browser does not support push notifications.');
    const app = getApps().find((candidate) => candidate.name === 'emadaaris-push')
      || initializeApp(config, 'emadaaris-push');
    return getMessaging(app);
  })().catch((error) => { messagingPromise = null; throw error; });
  return messagingPromise;
}

/** The app shell worker is the push worker; one registration owns both jobs. */
async function ensureWorker() {
  const registration = await registerServiceWorker();
  if (!registration) throw new Error('This browser cannot register the notifications worker, so push is unavailable.');
  return registration;
}

export function storedPushToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function storedPushEndpoint() {
  return localStorage.getItem(ENDPOINT_KEY) || '';
}

/** Which transport this browser answered with, so a screen can say so instead of guessing. */
export function pushProvider() {
  if (storedPushToken()) return 'fcm';
  if (storedPushEndpoint()) return 'webpush';
  return null;
}

export function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/** 'ios' | 'android' | 'desktop' — stored on the device row, and it decides the transport. */
export function devicePlatform() {
  const ua = navigator.userAgent || '';
  if (/iP(?:hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

async function askPermission() {
  if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
  if (Notification.permission === 'denied') {
    // Asking again is useless — the browser answers denied without showing anything — so point at the setting.
    throw new Error('Notifications are blocked for this site. Re-allow them in the browser settings, then try again.');
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission was not given, so the phone will stay silent.');
    }
  }
  return 'granted';
}

/** The VAPID public key travels as base64url; PushManager wants the bytes. */
function urlBase64ToUint8Array(key) {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
}

const withoutPadding = (value) => String(value || '').replace(/=+$/, '');

/**
 * The key a subscription already holds comes back as bytes, so comparing it to the key the server is
 * handing out needs the same alphabet on both sides. Without this the two never look equal and every
 * enable would unsubscribe and mint a fresh endpoint, which retires a working device for no reason.
 */
function uint8ArrayToUrlBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Subscribe with this project's VAPID key and hand the subscription to the server.
 *
 * A subscription minted by Firebase is not ours to send to — the push service only accepts the key pair
 * behind the subscription — so a leftover one is replaced, and the token that pointed at it is withdrawn
 * so the server stops aiming at a device that answers to the other transport.
 */
async function registerWebPush(registration) {
  const { data } = await apiGet('/account/push-public-key');
  if (!data?.ready || !data.publicKey) {
    throw new Error(data?.reason || 'The server has no Web Push key yet. Run `npm run push:vapid -w server`, then restart the API.');
  }
  let subscription = await registration.pushManager.getSubscription();
  const heldKey = subscription?.options?.applicationServerKey
    ? uint8ArrayToUrlBase64(subscription.options.applicationServerKey)
    : '';
  if (subscription && heldKey !== withoutPadding(data.publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription = subscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey),
  });
  const json = subscription.toJSON();
  if (!json?.endpoint || !json?.keys?.p256dh) {
    throw new Error('The browser returned an incomplete push subscription.');
  }
  await apiPost('/account/push-subscription', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    platform: devicePlatform(),
    userAgent: (navigator.userAgent || '').slice(0, 400),
  });
  localStorage.setItem(ENDPOINT_KEY, json.endpoint);
  const staleToken = storedPushToken();
  if (staleToken) {
    try { await apiPost('/account/push-token/remove', { token: staleToken }); } catch { /* best effort */ }
    localStorage.removeItem(TOKEN_KEY);
  }
  return { provider: 'webpush', endpoint: json.endpoint };
}

async function registerFcm(registration) {
  const [messaging, { getToken }] = await Promise.all([loadMessaging(), import('firebase/messaging')]);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('The browser did not return a push token. Try again in a supported browser.');
  await apiPost('/account/push-token', {
    token,
    platform: devicePlatform(),
    userAgent: (navigator.userAgent || '').slice(0, 400),
  });
  localStorage.setItem(TOKEN_KEY, token);
  const staleEndpoint = storedPushEndpoint();
  if (staleEndpoint) {
    try { await apiPost('/account/push-subscription/remove', { endpoint: staleEndpoint }); } catch { /* best effort */ }
    localStorage.removeItem(ENDPOINT_KEY);
  }
  return { provider: 'fcm', token };
}

/** @returns {Promise<{provider: 'fcm'|'webpush'}>} */
export async function enablePush() {
  await askPermission();
  const registration = await ensureWorker();
  // Apple has no FCM in the browser, so an iPhone is never worth a failed first attempt.
  const attempts = devicePlatform() === 'ios'
    ? [registerWebPush, registerFcm]
    : [registerFcm, registerWebPush];
  let lastError = null;
  for (const register of attempts) {
    try {
      return await register(registration);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('This browser could not be registered for notifications.');
}

export async function disablePush() {
  const token = storedPushToken();
  const endpoint = storedPushEndpoint();
  try {
    const messaging = await loadMessaging();
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(messaging);
  } catch { /* the browser may already have dropped the token */ }
  try {
    const registration = await ensureWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch { /* no subscription is the wanted end state anyway */ }
  if (token) {
    try { await apiPost('/account/push-token/remove', { token }); } catch { /* remove best-effort */ }
  }
  if (endpoint) {
    try { await apiPost('/account/push-subscription/remove', { endpoint }); } catch { /* remove best-effort */ }
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ENDPOINT_KEY);
}

/** The live encryption keys behind a stored endpoint, read back out of the browser. */
async function keysForEndpoint(endpoint) {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager?.getSubscription();
  const json = subscription?.toJSON();
  if (!json || json.endpoint !== endpoint || !json.keys?.p256dh) return null;
  return { p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/**
 * A credential belongs to a browser, a registration row belongs to an account — so signing in as
 * somebody else, or opening a second tab, leaves the stored credential pointed at the previous account.
 * Re-posting it on every sign-in moves the device to whoever is holding the keyboard now.
 */
export async function resyncPushToken() {
  const identity = { platform: devicePlatform(), userAgent: (navigator.userAgent || '').slice(0, 400) };
  const token = storedPushToken();
  if (token && isPushConfigured) {
    try {
      await apiPost('/account/push-token', { token, ...identity });
      return true;
    } catch { /* fall through and try the other transport */ }
  }
  const endpoint = storedPushEndpoint();
  if (!endpoint) return false;
  try {
    const keys = await keysForEndpoint(endpoint);
    if (!keys) return false;
    await apiPost('/account/push-subscription', { endpoint, keys, ...identity });
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser drops a subscription on its own sometimes — a reset push service, an expired key — and
 * says so through `pushsubscriptionchange`. Only a page that is open can mint a replacement, so this
 * runs from that signal and repairs the row silently. With no page open the next sign-in resyncs.
 */
export async function renewPushSubscription() {
  if (notificationPermission() !== 'granted') return null;
  const registration = await ensureWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ENDPOINT_KEY);
    return null;
  }
  localStorage.removeItem(TOKEN_KEY);
  return registerWebPush(registration);
}

/** What the server can actually do: is the sender configured, and how many browsers answer? */
export async function getPushStatus() {
  const { data } = await apiGet('/account/push-status');
  return data;
}

/** Whether the Web Push half of the server is configured, and the key a browser needs to subscribe. */
export async function getPushPublicKey() {
  const { data } = await apiGet('/account/push-public-key');
  return data;
}

export async function sendTestPush(note) {
  const { data } = await apiPost('/account/push-test', note ? { note } : {});
  return data;
}

/** Foreground messages never reach the service worker; show them from the page. */
export async function listenForForegroundMessages(handler) {
  if (!isPushConfigured) return () => {};
  const [messaging, { onMessage }] = await Promise.all([loadMessaging(), import('firebase/messaging')]);
  return onMessage(messaging, handler);
}
