import { apiPost } from '../api/client.js';

/**
 * Firebase Cloud Messaging for the browser. The config values are public Firebase
 * identifiers; the VAPID key comes from Cloud Messaging → Web configuration.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
};

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

async function ensureWorker() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(config)) {
    if (key !== 'vapidKey' && value) params.set(key, value);
  }
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${params.toString()}`,
    { scope: '/' },
  );
  await navigator.serviceWorker.ready;
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

/** Foreground messages never reach the service worker; show them from the page. */
export async function listenForForegroundMessages(handler) {
  if (!isPushConfigured) return () => {};
  const [messaging, { onMessage }] = await Promise.all([loadMessaging(), import('firebase/messaging')]);
  return onMessage(messaging, handler);
}
