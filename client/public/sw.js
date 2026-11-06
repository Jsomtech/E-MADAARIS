/* E-MADAARIS service worker — the only script registered at scope '/'.
 *
 * It does two jobs, and they have to share one registration because a scope can hold only one worker:
 *   1. Push while the page is closed, over whichever transport this browser registered with: Firebase
 *      Cloud Messaging (src/services/push.js registers this file and passes the public web config in the
 *      query string, so nothing secret is stored here) or standards-based Web Push for the browsers
 *      Apple limits to the Home Screen app.
 *   2. The offline app shell, so an installed app opens on a school's own pages without a network.
 *
 * What it never does is store data. Every /api call and every cross-origin request goes straight to the
 * network, untouched — a shared staff tablet must not be able to read another school's records out of a
 * cache, and third-party responses are not ours to keep. */

const VERSION = 'emadaaris-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSETS_CACHE = `${VERSION}-assets`;

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/vendor/firebase-app-compat.js',
  '/vendor/firebase-messaging-compat.js',
];

const STATIC_ASSET = /\.(?:css|js|mjs|png|jpe?g|webp|svg|woff2?|ico|webmanifest)$/i;
const OWN_CACHES = [SHELL_CACHE, ASSETS_CACHE];

/**
 * services/pwa.js appends `?dev=1` when the page came from the Vite dev server. There the module graph
 * is regenerated on every restart, so a cached copy of the last one hands the browser two instances of
 * the same library — which is how a page ends up blank with "pass in an i18next instance". The worker
 * still registers, because it is also the Firebase push worker, but it neither caches nor intercepts.
 */
const DEV_MODE = new URLSearchParams(self.location.search).get('dev') === '1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (DEV_MODE) return self.skipWaiting();
    const cache = await caches.open(SHELL_CACHE);
    // One entry missing (a favicon on a fresh deploy) must not abandon the rest of the shell.
    await Promise.allSettled(SHELL_FILES.map((path) => cache.add(path)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (DEV_MODE) {
        // A dev run must not inherit the last deployment's shell.
        if (key.startsWith('emadaaris-')) await caches.delete(key);
        continue;
      }
      if (!key.startsWith('emadaaris-') || OWN_CACHES.includes(key)) continue;
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/**
 * Firebase lives here too, and its scripts are served from this same origin so a cold start offline
 * still boots the worker. A failure to load them costs push delivery only — never the app shell.
 */
let messaging = null;
try {
  importScripts('/vendor/firebase-app-compat.js', '/vendor/firebase-messaging-compat.js');
  const params = new URLSearchParams(self.location.search);
  const config = {
    apiKey: params.get('apiKey') || undefined,
    authDomain: params.get('authDomain') || undefined,
    projectId: params.get('projectId') || undefined,
    storageBucket: params.get('storageBucket') || undefined,
    messagingSenderId: params.get('messagingSenderId') || undefined,
    appId: params.get('appId') || undefined,
  };
  if (config.messagingSenderId && config.projectId && config.appId && self.firebase) {
    firebase.initializeApp(config);
    messaging = firebase.messaging();
  }
} catch (error) {
  messaging = null;
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    // Both transports deliver through this one registration, so each half of the worker handles only
    // its own messages. Without the check a single notice can appear twice on the recipient's screen.
    if (data.provider === 'webpush') return;
    const notification = payload.notification || {};
    const title = notification.title || data.title || 'E-MADAARIS';
    self.registration.showNotification(title, {
      body: notification.body || data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'emadaaris',
      data: { url: data.url || data.link || '/notifications' },
    });
  });
}

/**
 * Standards-based Web Push — the transport for Safari on iPhone and iPad, where Firebase's browser
 * channel does not run. The payload is the plain JSON services/webpush.js wrote, already decrypted by
 * the browser, and it is the only thing that can produce a notification while the page is closed.
 *
 * `tag` is what keeps a repeat notice about the same thing to a single line on the lock screen, and
 * `renotify` is what lets an urgent one make a sound again rather than landing silently.
 */
self.addEventListener('push', (event) => {
  let message = null;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = null;
  }
  if (!message || message.provider !== 'webpush') return;
  event.waitUntil((async () => {
    await self.registration.showNotification(message.title || 'E-MADAARIS', {
      body: message.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: message.tag || 'emadaaris',
      renotify: Boolean(message.tag),
      silent: message.priority === 'low',
      timestamp: message.sent_at ? new Date(message.sent_at).getTime() : Date.now(),
      data: { url: message.url || '/notifications' },
    });
    // The page is told so it can refresh the bell. It deliberately does not raise a second alert for
    // this one — the notification that was just shown is the alert.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'emadaaris:push-received' });
  })());
});

/**
 * A push service is allowed to retire a subscription at any time (an iOS reinstall, a reset Firefox
 * Profile). The browser mints a replacement only if the page asks, so the signal is forwarded to any
 * open client — and a device with no open page re-registers on the next sign-in.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'emadaaris:push-subscription-changed' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (event) => {
  if (DEV_MODE) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Third-party hosts (Google Fonts, Supabase storage, anything else) are never intercepted: the shell
  // is this app's own files, and somebody else's response is not ours to keep or to fail on behalf of.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(serveShell(request));
    return;
  }
  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSETS_CACHE, url.href));
  }
});

/** The page itself is always fetched fresh; only its absence (offline) falls back to the cached shell. */
async function serveShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response?.ok) await putQuietly(cache, '/index.html', response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>E-MADAARIS</title>'
      + '<body style="font:16px/1.6 system-ui;color:#130c2d;background:#eef0f4;display:grid;place-items:center;min-height:100vh;margin:0">'
      + '<div style="max-width:30rem;text-align:center;padding:2rem">'
      + '<div style="width:56px;height:56px;margin:0 auto 1rem;border-radius:14px;background:#6027FF;color:#fff;font-weight:800;font-size:28px;line-height:56px">E</div>'
      + '<h1 style="font-size:1.2rem;margin:0 0 .5rem">You are offline</h1>'
      + '<p style="margin:0;color:#6e6b82">Reconnect to open E-MADAARIS. Nothing was lost — the app reloads from where you left off.</p>'
      + '</div></body>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Cached first so a repeat visit is instant; refreshed in the background for next time. */
async function staleWhileRevalidate(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const network = fetch(request).then(async (response) => {
    if (response?.ok) await putQuietly(cache, key, response.clone());
    return response;
  });
  if (cached) {
    // The cached copy already answered, so a failed refresh is nobody's error to report.
    network.catch(() => {});
    return cached;
  }
  // With nothing cached, the request's own failure is the honest answer.
  return network;
}

/** A cache write is a bonus, never a requirement: quota or an uncacheable response must not lose the answer. */
async function putQuietly(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch { /* opaque, quota or a streaming body — the live response still reaches the page */ }
}
