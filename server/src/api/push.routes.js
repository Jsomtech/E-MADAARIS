import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { pushSenderStatus, sendPushToUsers } from '../services/fcm.js';

/**
 * Per-device push registration. The token is minted in the browser by Firebase
 * Cloud Messaging; the server only stores it against the authenticated identity
 * and tenant so notifications can be targeted later.
 */
export const accountRouter = Router();

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.string().trim().max(32).optional(),
  userAgent: z.string().trim().max(400).optional(),
});

accountRouter.post('/push-token', async (req, res, next) => {
  try {
    const body = tokenSchema.parse(req.body);
    const row = {
      token: body.token,
      platform: body.platform || 'web',
      user_agent: body.userAgent || null,
      user_type: req.auth.type,
      user_id: req.auth.userId,
      auth_user_id: req.auth.authUserId,
      school_id: req.auth.type === 'school' ? req.auth.schoolId : null,
      last_seen_at: new Date().toISOString(),
    };
    const { data, error } = await requireDb()
      .from('push_tokens').upsert(row, { onConflict: 'token' }).select('id').maybeSingle();
    if (error) {
      if (error.code === '42P01') {
        throw new ApiError(503, 'Push storage is not set up yet. Run supabase/migrations/0018_push_tokens.sql in Supabase.');
      }
      throw new ApiError(500, error.message);
    }
    res.status(201).json({ data: { id: data?.id || null, registered: true } });
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

/** How many browsers this account has registered — the client half of the push readiness answer. */
async function deviceCount(req) {
  const { data, error } = await requireDb().from('push_tokens').select('id')
    .eq('user_type', req.auth.type).eq('user_id', req.auth.userId).limit(50);
  if (error) return { devices: 0, storage_error: error.code === '42P01' ? 'table_missing' : error.message };
  return { devices: (data || []).length };
}

/**
 * Whether a push can leave the server at all. The service-account file is named by an environment
 * variable, so the answer is a reason string ("no key file at …"), never anything read from the file.
 */
accountRouter.get('/push-status', async (req, res, next) => {
  try {
    const sender = pushSenderStatus();
    const storage = await deviceCount(req);
    res.json({ data: { ...sender, ...storage } });
  } catch (e) { next(e); }
});

/**
 * A live end-to-end check: the signed-in account's own browsers, this minute. It writes no inbox row,
 * so pressing the button cannot litter the notification list.
 */
accountRouter.post('/push-test', async (req, res, next) => {
  try {
    const { note } = z.object({ note: z.string().trim().max(120).optional() }).parse(req.body || {});
    const outcome = await sendPushToUsers([req.auth.userId], {
      scope: req.auth.type === 'platform' ? 'platform' : 'school',
      title: 'E-MADAARIS push is working',
      body: note || 'This is a test of your registered browsers.',
      link: '/notifications',
      tag: 'test',
    });
    res.json({ data: { ...outcome, sender: pushSenderStatus() } });
  } catch (e) { next(e); }
});
