import { db } from '../config/supabase.js';
import { pushSenderStatus, sendFcmToDevice } from './fcm.js';
import { webPushSenderStatus, sendWebPushToDevice } from './webpush.js';

/**
 * One fan-out, two transports.
 *
 * Everything that decides *who* is addressed and *what happens to the attempt* lives here, so a school
 * message and a platform broadcast cannot drift apart on the rules that matter: a device is only ever
 * aimed at through the account that registered it and the tenant that account belongs to, every attempt
 * is written down, and a device the push service has given up on is retired instead of retried forever.
 *
 * The transports themselves stay ignorant of all that — `fcm.js` and `webpush.js` each answer for one
 * device and report how it went.
 */

const SEND_CONCURRENCY = 12;
const LOG_BATCH = 200;
// One event must never turn into thousands of HTTPS calls on the request's behalf.
const MAX_DEVICES_PER_SEND = 800;
const DEVICE_CHUNK = 100;
/** A subscription that has failed this often without ever re-registering is not coming back. */
const RETIRE_AFTER_FAILURES = 12;
/** Lifecycle writes are per device, so a total outage must not become a second incident. */
const MAX_LIFECYCLE_WRITES = 50;

/**
 * `push_tokens` gains its lifecycle columns in migration 0026. A database that has not run it yet must
 * keep delivering exactly as before rather than losing every push to a column-not-found error, so the
 * first failure downgrades this module to the old shape and remembers.
 */
let deviceColumns = 'id, user_id, school_id, provider, token, endpoint, p256dh, auth, active, failure_count';

const MISSING_COLUMN = /column .* does not exist|schema cache|Could not find the .* column/i;

function normalize(device) {
  const provider = device.provider === 'webpush' && device.endpoint ? 'webpush' : 'fcm';
  return { ...device, provider, active: device.active !== false };
}

async function findDevices(ids, scope, schoolId) {
  const out = [];
  for (let i = 0; i < ids.length; i += DEVICE_CHUNK) {
    const chunk = ids.slice(i, i + DEVICE_CHUNK);
    const run = (columns, liveOnly) => {
      let query = db().from('push_tokens').select(columns)
        .eq('user_type', scope).in('user_id', chunk).limit(DEVICE_CHUNK * 4);
      if (liveOnly) query = query.eq('active', true);
      // The tenant filter is the whole point of the column: a recipient id that leaked from another
      // school's audience would otherwise be answered by that school's own device registration.
      if (scope === 'school') query = query.eq('school_id', schoolId);
      return query;
    };
    const { data, error } = await run(deviceColumns, true);
    if (error && MISSING_COLUMN.test(error.message || '')) {
      // No lifecycle columns yet: every registration is treated as live, exactly as before 0026.
      deviceColumns = 'id, user_id, school_id, token';
      const retry = await run(deviceColumns, false);
      if (retry.error) throw new Error(retry.error.message);
      out.push(...(retry.data || []).map(normalize));
      continue;
    }
    if (error) throw new Error(error.message);
    out.push(...(data || []).map(normalize));
  }
  return out;
}

/** A tap must open the message, so an inbox row is worth more than a generic landing page. */
function deviceLink(link, notificationId) {
  if (!notificationId) return link || '/notifications';
  return `/notifications?open=${notificationId}`;
}

/**
 * Delivery history is written after the attempt, never before: a log that promised a send the provider
 * never saw would mislead whoever reads the analytics screen. A history write cannot break a delivery,
 * so its own failure is swallowed rather than turned into a failed message.
 */
async function logDelivery(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += LOG_BATCH) {
    try {
      await db().from('notification_delivery_logs').insert(rows.slice(i, i + LOG_BATCH));
    } catch { /* the message itself already reached the inbox */ }
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
 * Retire the devices the push service said goodbye to, and count the ones that merely had a bad minute.
 * A retired row is kept, not deleted: the delivery log points at it, and the owner's next visit
 * re-registers the same browser with `active` back to true.
 */
async function applyLifecycle(stale, failing) {
  try {
    if (stale.length) {
      const byReason = new Map();
      for (const device of stale) {
        const reason = device.result.detail || 'GONE';
        if (!byReason.has(reason)) byReason.set(reason, []);
        byReason.get(reason).push(device.id);
      }
      for (const [reason, ids] of byReason) {
        await db().from('push_tokens').update({
          active: false, revoked_at: new Date().toISOString(), last_error: reason,
        }).in('id', ids);
      }
    }
    for (const device of failing.slice(0, MAX_LIFECYCLE_WRITES)) {
      const count = Number(device.failure_count || 0) + 1;
      const patch = { failure_count: count, last_error: device.result.detail || 'FAILED' };
      if (count >= RETIRE_AFTER_FAILURES) { patch.active = false; patch.revoked_at = new Date().toISOString(); }
      await db().from('push_tokens').update(patch).eq('id', device.id);
    }
  } catch { /* the next sign-in re-registers the device anyway */ }
}

/** What the account screen reports: at least one transport must be able to leave the server. */
export function pushReadiness() {
  const fcm = pushSenderStatus();
  const webpush = webPushSenderStatus();
  return {
    ready: fcm.ready || webpush.ready,
    projectId: fcm.projectId,
    reason: fcm.ready || webpush.ready ? null : (webpush.ready ? null : (fcm.reason || webpush.reason)),
    providers: { fcm, webpush },
  };
}

/**
 * Send one notification to every device these accounts have registered, over whichever transport each
 * device answered on. Returns a summary rather than throwing: a push outage must never roll back the
 * school event that caused it, and the inbox row is already committed by the time this runs.
 */
export async function sendPushToUsers(userIds, {
  scope = 'school', schoolId = null, title, body = '', link = '/', tag = 'general', icon,
  priority = 'normal', batchId = null, notificationIds = null,
} = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const empty = { attempted: 0, sent: 0, failed: 0, skipped: null, error: null };
  if (!ids.length) return empty;
  // A school-scope send with no school is a bug, not an unfiltered broadcast: refuse before reading.
  if (scope === 'school' && !schoolId) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'missing_school_scope', error: 'A school-scope push needs the school it belongs to.' };
  }

  const readiness = pushReadiness();
  if (!readiness.ready) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'sender_not_configured', error: readiness.reason };
  }

  let devices = [];
  try {
    devices = await findDevices(ids, scope, schoolId);
  } catch (error) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'token_lookup_failed', error: error.message };
  }

  // The same browser can be registered twice under two transports; one person, one notification.
  const seen = new Set();
  devices = devices.filter((device) => {
    if (device.active === false) return false;
    const credential = device.provider === 'webpush' ? device.endpoint : device.token;
    if (!credential || seen.has(credential)) return false;
    seen.add(credential);
    return true;
  }).slice(0, MAX_DEVICES_PER_SEND);
  if (!devices.length) {
    return { attempted: ids.length, sent: 0, failed: 0, skipped: 'no_registered_devices', error: null };
  }

  const results = await pool(devices, SEND_CONCURRENCY, async (device) => {
    const notificationId = notificationIds?.get(device.user_id) || null;
    const parts = {
      title, body, link: deviceLink(link, notificationId), tag, icon, priority,
      category: tag, notificationId,
    };
    const result = device.provider === 'webpush'
      ? await sendWebPushToDevice(device, parts)
      : await sendFcmToDevice(device.token, parts);
    return { ...result, notificationId };
  });

  const sent = results.filter((r) => r.ok).length;
  await logDelivery(devices.map((device, index) => {
    const result = results[index] || {};
    return {
      school_id: device.school_id, batch_id: batchId,
      notification_id: result.notificationId || notificationIds?.get(device.user_id) || null,
      recipient_user_id: device.user_id, recipient_scope: scope, channel: 'push',
      device_id: device.id,
      delivery_status: result.ok ? 'sent' : 'failed',
      provider_code: result.ok ? null : (result.detail || 'UNKNOWN'),
      error_message: result.ok ? null : (result.reason || null),
    };
  }));

  const stale = [];
  const failing = [];
  devices.forEach((device, index) => {
    const result = results[index];
    if (!result || result.ok) return;
    if (result.stale) stale.push({ ...device, result });
    else failing.push({ ...device, result });
  });
  await applyLifecycle(stale, failing);

  const byProvider = (provider) => devices.reduce((count, device, index) => (
    device.provider === provider && results[index]?.ok ? count + 1 : count), 0);

  return {
    attempted: devices.length,
    sent,
    failed: devices.length - sent,
    skipped: null,
    error: results.find((r) => !r.ok && !r.stale)?.detail || null,
    providers: {
      fcm: { attempted: devices.filter((d) => d.provider === 'fcm').length, sent: byProvider('fcm') },
      webpush: { attempted: devices.filter((d) => d.provider === 'webpush').length, sent: byProvider('webpush') },
    },
  };
}
