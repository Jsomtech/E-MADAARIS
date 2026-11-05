/**
 * The progressive half of the app: one service worker at scope '/', the install prompt, and the
 * online/offline signal the shell shows.
 *
 * The same worker also carries Firebase Cloud Messaging, which is why it is registered once here and
 * handed to services/push.js rather than registered separately — a scope can hold only one worker, and
 * two registrations would leave whichever registered last in charge of the app shell.
 */

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
};

/** The worker is served from the origin root and cannot read import.meta.env, so the public config
 *  travels in its query string — the same values a Firebase snippet would put in the page. */
function workerUrl() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(firebaseConfig)) {
    if (key !== 'vapidKey' && value) params.set(key, value);
  }
  // A dev server hands out a different module graph on every restart, so the worker must not keep a
  // copy of the previous one. Production gets no flag and caches the shell exactly as before.
  if (import.meta.env.DEV) params.set('dev', '1');
  const query = params.toString();
  return query ? `/sw.js?${query}` : '/sw.js';
}

let registrationPromise = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register(workerUrl(), { scope: '/' })
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        return registration;
      })
      .catch((error) => {
        // An unavailable worker costs offline mode only. The app must still run.
        registrationPromise = null;
        console.warn('[pwa] service worker not registered:', error?.message || error);
        return null;
      });
  }
  return registrationPromise;
}

export function isRunningStandalone() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
    || Boolean(window.navigator.standalone)
    || document.referrer?.startsWith('android-app://');
}

let capturedPrompt = null;
const promptListeners = new Set();

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  capturedPrompt = event;
  promptListeners.forEach((listener) => listener(true));
});

window.addEventListener('appinstalled', () => {
  capturedPrompt = null;
  promptListeners.forEach((listener) => listener(false));
});

/** Install affordances subscribe here; the argument is whether an install is still offered. */
export function watchInstallable(listener) {
  promptListeners.add(listener);
  listener(Boolean(capturedPrompt));
  return () => promptListeners.delete(listener);
}

/** @returns {'accepted'|'dismissed'|'unavailable'} */
export async function promptInstall() {
  if (!capturedPrompt) return 'unavailable';
  const prompt = capturedPrompt;
  capturedPrompt = null;
  promptListeners.forEach((listener) => listener(false));
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted' ? 'accepted' : 'dismissed';
}

export function watchOnline(listener) {
  const update = () => listener(navigator.onLine);
  listener(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}
