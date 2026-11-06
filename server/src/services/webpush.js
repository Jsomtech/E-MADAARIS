import webPush from 'web-push';
import { env } from '../config/env.js';

/**
 * Standards-based Web Push (RFC 8291 with VAPID, RFC 8292) — the transport that reaches the devices
 * Firebase's browser channel cannot, above all an iPhone or iPad with the app added to the Home Screen.
 *
 * A subscription is a URL plus two key halves the browser minted; the payload is encrypted for that one
 * device and POSTed to that one URL, signed with the VAPID key so the push service knows which product
 * is speaking and how to reach its operator. The private half stays in this process; the public half is
 * served to browsers by `GET /account/push-public-key`, because subscribing without it is impossible.
 *
 * This is a transport, not a second notification system: `services/pushDelivery.js` still owns who
 * receives what, and every message still lands in the inbox first.
 */

let keys = null;
let blockedReason = 'the web push sender has not been consulted yet';

function loadKeys() {
  if (keys) return keys;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    blockedReason = 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set — run `npm run push:vapid -w server`';
    return null;
  }
  const subject = env.vapidSubject || `mailto:${env.emailFrom}`;
  if (!/^(mailto|https?):/i.test(subject)) {
    blockedReason = 'VAPID_SUBJECT must be a mailto: address or an https: URL';
    return null;
  }
  try {
    webPush.setVapidDetails(subject, env.vapidPublicKey, env.vapidPrivateKey);
  } catch (error) {
    blockedReason = `the VAPID keys were rejected: ${error.message}`;
    return null;
  }
  keys = { subject };
  blockedReason = '';
  return keys;
}

/** Public information only: the key a browser needs in order to subscribe, never the private half. */
export function webPushSenderStatus() {
  const ready = Boolean(loadKeys());
  return {
    ready,
    publicKey: ready ? env.vapidPublicKey : null,
    subject: ready ? keys.subject : null,
    reason: ready ? null : blockedReason,
  };
}

/**
 * How loud the OS should be about this message. web-push accepts exactly four levels and throws on any
 * other string, so an "urgent" notice maps onto the loudest one it will take rather than a value from
 * the FCM vocabulary that would cost the message its delivery.
 */
const URGENCY = { urgent: 'high', high: 'high', normal: 'normal', low: 'low' };

/**
 * The body a service worker can turn into a notification without any help from Firebase. `provider`
 * marks it: the same worker also receives FCM payloads, and each half of the worker must only handle
 * its own, or one message becomes two notifications on the recipient's screen.
 */
export function buildWebPushPayload({ title, body = '', link = '/', tag = 'general', priority = 'normal', category, notificationId }) {
  return JSON.stringify({
    provider: 'webpush',
    title: String(title ?? ''),
    body: String(body ?? ''),
    url: String(link ?? '/'),
    tag: String(tag ?? 'general'),
    priority: String(priority ?? 'normal'),
    category: category ? String(category) : undefined,
    id: notificationId || undefined,
    sent_at: new Date().toISOString(),
  });
}

/**
 * Deliver to one subscription. Returns a result rather than throwing, because one dead browser must not
 * cost the other nine hundred their message.
 */
export async function sendWebPushToDevice(device, parts) {
  if (!loadKeys()) return { ok: false, stale: false, detail: 'SENDER_NOT_CONFIGURED' };
  if (!device.endpoint || !device.p256dh || !device.auth) {
    return { ok: false, stale: true, detail: 'INCOMPLETE_SUBSCRIPTION' };
  }
  const urgency = URGENCY[parts.priority] || 'normal';
  try {
    await webPush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      buildWebPushPayload(parts),
      {
        TTL: Math.max(0, Number(env.pushTtlSeconds) || 3600),
        urgency,
      },
    );
    return { ok: true };
  } catch (error) {
    const status = Number(error?.statusCode || 0);
    // 404 and 410 are the push service saying this subscription is gone — uninstalled, or expired
    // without ever telling us. Anything else is transient and the device is worth keeping.
    const stale = status === 404 || status === 410;
    return {
      ok: false, stale,
      detail: status ? `HTTP ${status}` : String(error?.message || 'WEB_PUSH_FAILED').slice(0, 120),
      reason: String(error?.body || error?.message || '').slice(0, 500) || null,
    };
  }
}
