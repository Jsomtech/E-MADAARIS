import { apiGet, apiPost } from '../api/client.js';
import { firebaseConfig, registerServiceWorker } from './pwa.js';

/**
 * Firebase Cloud Messaging for the browser. The config values are public Firebase
 * identifiers; the VAPID key comes from Cloud Messaging → Web configuration.
 * The server side of a push is services/fcm.js — this file only registers devices and shows the
 * messages that arrive while the page is open.
 */
const config = firebaseConfig;

const TOKEN_KEY = 'emadaaris.pushToken';

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

export async function enablePush() {
  if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for this site in the browser settings, then try again.');
  }
  const [messaging, registration, { getToken }] = await Promise.all([
    loadMessaging(),
    ensureWorker(),
    import('firebase/messaging'),
  ]);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('The browser did not return a push token. Try again in a supported browser.');
  await apiPost('/account/push-token', {
    token,
    platform: 'web',
    userAgent: navigator.userAgent.slice(0, 400),
  });
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function disablePush() {
  const token = storedPushToken();
  try {
    const messaging = await loadMessaging();
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(messaging);
  } catch { /* the browser may already have dropped the token */ }
  if (token) {
    try { await apiPost('/account/push-token/remove', { token }); } catch { /* remove best-effort */ }
  }
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * A token is per browser, but a registration row is per account — so signing in as somebody else, or
 * in a second tab, leaves the stored token pointed at the previous account. Re-posting it on every
 * sign-in moves the device to whoever is holding the keyboard now.
 */
export async function resyncPushToken() {
  const token = storedPushToken();
  if (!token || !isPushConfigured) return false;
  try {
    await apiPost('/account/push-token', { token, platform: 'web', userAgent: navigator.userAgent.slice(0, 400) });
    return true;
  } catch {
    return false;
  }
}

/** What the server can actually do: is the sender configured, and how many browsers answer? */
export async function getPushStatus() {
  const { data } = await apiGet('/account/push-status');
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
