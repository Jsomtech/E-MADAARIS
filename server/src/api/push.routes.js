import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { env } from '../config/env.js';
import { pushReadiness, sendPushToUsers } from '../services/pushDelivery.js';

/**
 * Device registration, over both transports.
 *
 * Firebase Cloud Messaging for the browsers that have it, standards-based Web Push for the ones that
 * do not — which on a phone means iPhone and iPad, where the app has to be added to the Home Screen
 * before anything can be pushed to it. A registration is a bearer credential of sorts, so it is written
 * only after the session has been verified, is stored against that identity and its tenant, is never
 * read back out by any endpoint, and is dropped the moment the push service says it is dead.
 */
export const accountRouter = Router();

/** One person is not allowed to accumulate an unbounded number of browsers. */
const MAX_DEVICES_PER_ACCOUNT = 20;

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.string().trim().max(32).optional(),
  userAgent: z.string().trim().max(400).optional(),
  label: z.string().trim().max(120).optional(),
});

const subscriptionSchema = z.object({
  endpoint: z.string().trim().min(20).max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(40).max(200),
    auth: z.string().trim().min(8).max(64),
  }),
  platform: z.string().trim().max(32).optional(),
  userAgent: z.string().trim().max(400).optional(),
  label: z.string().trim().max(120).optional(),
});

const PRIVATE_IPV4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
const PRIVATE_IPV6 = /^(::1|::|fe80|fc|fd)/i;

function isPrivateAddress(address) {
  const value = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  if (value.includes(':')) return PRIVATE_IPV6.test(value);
  return PRIVATE_IPV4.some((pattern) => pattern.test(value));
}

/**
 * The server is about to POST to a URL the browser supplied, which makes this a server-side request
 * forgery surface: a subscription aimed at a cloud metadata address or an internal port would turn every
 * notification into a request from inside the network. Real push services are public https hosts, so
 * anything else is refused — including a name that resolves to an internal address.
 *
 * One exception, deliberately narrow: outside production a loopback address on any port is accepted, so
 * a developer can point a subscription at a push service running on their own machine. Nothing that is
 * merely *reachable* from inside the network — a private range, a link-local metadata address — is.
 * The scheme is never relaxed, because the web push sender only speaks https; an http subscription
 * would be stored, looked up on every send, and undeliverable forever.
 */
async function assertPublicPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ApiError(400, 'The push endpoint is not a valid URL.');
  }
  const host = url.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  const localTesting = loopback && env.nodeEnv !== 'production';
  if (url.protocol !== 'https:') {
    throw new ApiError(400, 'The push endpoint must be an https:// address.');
  }
  if (!localTesting && url.port && url.port !== '443') {
    throw new ApiError(400, 'The push endpoint must use the standard https port.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host) && !localTesting) throw new ApiError(400, 'The push endpoint must belong to a public push service.');
    return;
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, 'The push endpoint host could not be resolved.');
  }
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new ApiError(400, 'The push endpoint must belong to a public push service.');
  }
}

/** Which identity a registration belongs to — never taken from the request body. */
function owner(req) {
  return {
    user_type: req.auth.type,
    user_id: req.auth.userId,
    auth_user_id: req.auth.authUserId,
    school_id: req.auth.type === 'school' ? req.auth.schoolId : null,
  };
}

/**
 * Migration 0026 adds the transport and lifecycle columns. A database that has not run it must keep
 * registering devices instead of failing on a column that is not there yet, so the first such error
 * downgrades every later write to the old shape.
 */
let lifecycleColumns = true;
const LIFECYCLE_FIELDS = ['provider', 'label', 'active', 'revoked_at', 'failure_count', 'last_error'];

async function upsertDevice(conflict, row) {
  const supabase = requireDb();
  const attempt = (patch) => supabase.from('push_tokens')
    .upsert(patch, { onConflict: conflict }).select('id').maybeSingle();

  const { data, error } = await attempt(row);
  if (!error) return data;
  if (error.code === '42P01') {
    throw new ApiError(503, 'Push storage is not set up yet. Run supabase/migrations/0018_push_tokens.sql in Supabase.');
  }
  if (!/does not exist|Could not find the .* column|schema cache/i.test(error.message || '')) {
    throw new ApiError(500, error.message);
  }
  lifecycleColumns = false;
  const legacy = Object.fromEntries(Object.entries(row).filter(([key]) => !LIFECYCLE_FIELDS.includes(key)));
  const retry = await attempt(legacy);
  if (retry.error) throw new ApiError(500, retry.error.message);
  return retry.data;
}

const lifecyclePatch = () => (lifecycleColumns
  ? { active: true, revoked_at: null, failure_count: 0, last_error: null }
  : {});

/** Forget this account's oldest registrations so a new device can always be added. */
async function makeRoom(req) {
  const { data: rows, error } = await requireDb().from('push_tokens')
    .select('id, last_seen_at').eq('user_type', req.auth.type).eq('user_id', req.auth.userId)
    .order('last_seen_at', { ascending: true }).limit(60);
  if (error || !rows || rows.length < MAX_DEVICES_PER_ACCOUNT) return;
  const surplus = rows.slice(0, rows.length - MAX_DEVICES_PER_ACCOUNT + 1).map((row) => row.id);
  if (!surplus.length) return;
  const { error: cutError } = await requireDb().from('push_tokens').delete().in('id', surplus);
  if (cutError) throw new ApiError(500, cutError.message);
}

accountRouter.post('/push-token', async (req, res, next) => {
  try {
    const body = tokenSchema.parse(req.body);
    await makeRoom(req);
    const data = await upsertDevice('token', {
      token: body.token,
      provider: 'fcm',
      platform: body.platform || 'web',
      user_agent: body.userAgent || null,
      label: body.label || null,
      ...owner(req),
      last_seen_at: new Date().toISOString(),
      ...lifecyclePatch(),
    });
    res.status(201).json({ data: { id: data?.id || null, registered: true, provider: 'fcm' } });
  } catch (e) { next(e); }
});

/** Standards-based Web Push: the subscription a browser minted against its own push service. */
accountRouter.post('/push-subscription', async (req, res, next) => {
  try {
    const body = subscriptionSchema.parse(req.body);
    await assertPublicPushEndpoint(body.endpoint);
    await makeRoom(req);
    const data = await upsertDevice('endpoint', {
      endpoint: body.endpoint,
      provider: 'webpush',
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      platform: body.platform || 'web',
      user_agent: body.userAgent || null,
      label: body.label || null,
      ...owner(req),
      last_seen_at: new Date().toISOString(),
      ...lifecyclePatch(),
    });
    res.status(201).json({ data: { id: data?.id || null, registered: true, provider: 'webpush' } });
  } catch (e) { next(e); }
});

accountRouter.post('/push-subscription/remove', async (req, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().trim().min(20).max(2048) }).parse(req.body || {});
    const { error } = await requireDb().from('push_tokens')
      .delete().eq('endpoint', endpoint).eq('auth_user_id', req.auth.authUserId);
    if (error && error.code !== '42P01') throw new ApiError(500, error.message);
    res.json({ data: { removed: true } });
  } catch (e) { next(e); }
});

accountRouter.post('/push-token/remove', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().trim().min(20).max(4096) }).parse(req.body);
    const { error } = await requireDb().from('push_tokens')
      .delete().eq('token', token).eq('auth_user_id', req.auth.authUserId);
    if (error && error.code !== '42P01') throw new ApiError(500, error.message);
    res.json({ data: { removed: true } });
  } catch (e) { next(e); }
});

/**
 * The VAPID public key, which is what `PushManager.subscribe` needs as its applicationServerKey. Public
 * by design — every browser that subscribes is handed it. The private half signs the assertion, is never
 * served, and never leaves this process.
 */
accountRouter.get('/push-public-key', (req, res) => {
  const webpush = pushReadiness().providers.webpush;
  res.json({ data: { ready: webpush.ready, publicKey: webpush.publicKey, reason: webpush.reason } });
});

/** How many browsers this account has registered, and over which transport each one answers. */
async function deviceSummary(req) {
  const supabase = requireDb();
  const read = (columns) => supabase.from('push_tokens').select(columns)
    .eq('user_type', req.auth.type).eq('user_id', req.auth.userId).limit(50);
  const { data, error } = await read('id, provider, active, last_seen_at, failure_count, last_error');
  if (error) {
    const legacy = await read('id');
    if (legacy.error) {
      return { devices: 0, storage_error: legacy.error.code === '42P01' ? 'table_missing' : legacy.error.message };
    }
    return { devices: (legacy.data || []).length };
  }
  const rows = data || [];
  const live = rows.filter((row) => row.active !== false);
  return {
    devices: live.length,
    registered: rows.length,
    retired: rows.length - live.length,
    by_provider: {
      fcm: live.filter((row) => (row.provider || 'fcm') === 'fcm').length,
      webpush: live.filter((row) => row.provider === 'webpush').length,
    },
    unhealthy: rows.filter((row) => Number(row.failure_count || 0) > 0).slice(0, 5)
      .map((row) => ({ failures: row.failure_count, reason: row.last_error })),
  };
}

/**
 * Whether a push can leave the server at all, per transport. The service-account file and the VAPID
 * private key are both named by environment variables, so the answer is a reason string about the
 * configuration — never anything read from either secret.
 */
accountRouter.get('/push-status', async (req, res, next) => {
  try {
    const sender = pushReadiness();
    const storage = await deviceSummary(req);
    res.json({ data: { ...sender, ...storage } });
  } catch (e) { next(e); }
});

/**
 * A test push really leaves the server, so it belongs to the accounts that may already send messages:
 * platform staff and the school roles holding `notifications.send`. Closing it takes nothing away from a
 * learner — their browser stays registered and keeps receiving the notices their school sends.
 */
function mayTestPush(req, res, next) {
  const a = req.auth;
  if (!a) return res.status(403).json({ error: 'Sign in is required' });
  if (a.type === 'platform' || a.isSuperAdmin || a.permissions?.has('notifications.send')) return next();
  return res.status(403).json({
    error: 'Only accounts that send notices can run a push test. Your own browser is still registered and keeps receiving notifications.',
  });
}

/** A button on a shared screen should not become a way to spend the school's messaging quota. */
const testLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `push-test:${req.auth?.userId || req.ip}`,
  message: { error: 'Several test pushes went out this minute. Wait a moment and try again.' },
});

/**
 * A live end-to-end check: the signed-in account's own browsers, this minute. It writes no inbox row,
 * so pressing the button cannot litter the notification list.
 */
accountRouter.post('/push-test', testLimiter, mayTestPush, async (req, res, next) => {
  try {
    const { note } = z.object({ note: z.string().trim().max(120).optional() }).parse(req.body || {});
    const scope = req.auth.type === 'platform' ? 'platform' : 'school';
    const outcome = await sendPushToUsers([req.auth.userId], {
      scope,
      schoolId: scope === 'school' ? req.auth.schoolId : null,
      title: 'E-MADAARIS push is working',
      body: note || 'This is a test of your registered browsers.',
      link: '/notifications',
      tag: 'test',
    });
    res.json({ data: { ...outcome, sender: pushReadiness() } });
  } catch (e) { next(e); }
});
