import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { notify, userIdsWithRoles, NOTIFICATION_CATEGORIES } from '../../services/notify.js';
import {
  AUDIENCE_CAP, AUDIENCES, BROADCAST_AUDIENCES, CHANNELS, PRIORITIES, assertMayCompose,
  describeAudience, mayAnnounce, ownsCategory, resolveAudience, scopedClassIds, taughtClassIds,
} from '../../services/notifyCompose.js';

/**
 * The school composer: an administrator writes one message, chooses an audience, and the server decides
 * whether that audience is theirs to address. Nothing about who receives a notice is taken from the
 * browser — the audience is a description, and the recipient list is resolved here from tenant data.
 *
 * Alongside it sit the reads that make sending auditable: per-batch delivery logs, a sampled analytics
 * roll-up, the scheduled queue, and a preview so the confirmation screen can name a number before any
 * row is written.
 */

export const notificationsOpsRouter = Router();

/** A queue the scheduler drains; the horizon keeps a forgotten draft from firing next year. */
const SCHEDULE_HORIZON_MS = 90 * 86400_000;
const SCHEDULE_MIN_MS = 60_000;
/** Analytics reads a bounded sample of the tenant's inbox rather than an unbounded table. */
const ANALYTICS_SAMPLE = 8000;
/** How long the composer waits for the push leg before answering; see settleWithin(). */
const PUSH_REPORT_WAIT_MS = 4000;

const sendSchema = z.object({
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().max(2000).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).default('announcements'),
  priority: z.enum(PRIORITIES).default('normal'),
  link: z.string().trim().max(200).optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(3).default(['in_app', 'push']),
  audience: z.enum(AUDIENCES).default('all'),
  class_ids: z.array(z.string().uuid()).max(60).default([]),
  role_names: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  user_ids: z.array(z.string().uuid()).max(500).default([]),
  send_at: z.coerce.date().optional(),
}).superRefine((body, ctx) => {
  if (body.audience === 'class' && !body.class_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['class_ids'], message: 'The class audience needs at least one class.' });
  }
  if (body.audience === 'roles' && !body.role_names.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role_names'], message: 'The role audience needs at least one role.' });
  }
  if (body.audience === 'users' && !body.user_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['user_ids'], message: 'The individual audience needs at least one recipient.' });
  }
});

/** One screen must not become a megaphone: six sends a minute per account. */
const sendLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `notify-send:${req.auth?.userId || req.ip}`,
  message: { error: 'You have sent several notifications this minute. Wait a moment and try again.' },
});

const previewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `notify-preview:${req.auth?.userId || req.ip}`,
  message: { error: 'Slow down — the audience preview is being requested too often.' },
});

/**
 * The push leg answers in milliseconds for a handful of browsers and in minutes for a whole tenant. The
 * composer waits briefly so the screen can report real numbers, then lets the send finish on its own —
 * the delivery log still records every device, whether or not anyone was watching.
 */
async function settleWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sendOptions(req, body, extra = {}) {
  return {
    schoolId: req.auth.schoolId, scope: 'school', category: body.category,
    title: body.title, body: body.body || null, link: body.link || '/notifications',
    priority: body.priority, channels: body.channels, ...extra,
  };
}

// ── Routes ─────────────────────────────────────────────────────
/** How many inboxes a send would reach, with the same checks the send itself applies. */
notificationsOpsRouter.post('/preview', requirePermission('notifications.send'), previewLimiter, async (req, res, next) => {
  try {
    const body = sendSchema.parse(req.body);
    assertMayCompose(req.auth, body);
    const supabase = requireDb();
    const classIds = await scopedClassIds(supabase, req.auth, body);
    const ids = await resolveAudience(supabase, req.auth, body, classIds);
    res.json({
      data: {
        recipients: ids.length,
        audience: body.audience,
        audience_detail: describeAudience(body, classIds.length),
        category: body.category,
        channels: body.channels,
        over_cap: ids.length > AUDIENCE_CAP,
        scoped_to_classes: classIds.length || null,
      },
    });
  } catch (e) { next(e); }
});

/**
 * Everything the composer's pickers show, worked out by the same service the send itself uses. A teacher
 * sees the classes they teach and no others, an accountant sees the finance category and nothing about
 * attendance, and the screen never offers a choice the server is going to refuse.
 *
 * The people list is gated on `notifications.send`, not on `users.view`: being allowed to message one's
 * own class is not a licence to read the school's whole directory, so a search term or a role is
 * required and the answer is capped.
 */
notificationsOpsRouter.get('/compose-options', requirePermission('notifications.send'), async (req, res, next) => {
  try {
    const q = z.object({
      q: z.string().trim().min(2).max(60).optional(),
      role: z.string().trim().max(60).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    }).parse(req.query);
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const announce = mayAnnounce(req.auth);

    const [roleRes, classRes] = await Promise.all([
      supabase.from('school_roles').select('name').eq('school_id', schoolId).order('name'),
      (async () => {
        let query = supabase.from('classes').select('id, name').eq('school_id', schoolId);
        if (!announce) {
          const taught = await taughtClassIds(supabase, schoolId, req.auth.userId);
          if (!taught.length) return { data: [], error: null };
          query = query.in('id', taught);
        }
        return query.order('name').limit(200);
      })(),
    ]);
    if (classRes.error) throw new ApiError(500, classRes.error.message);

    const answer = {
      audiences: AUDIENCES.filter((a) => announce || !BROADCAST_AUDIENCES.has(a)),
      categories: NOTIFICATION_CATEGORIES.filter((c) => announce || ownsCategory(req.auth, c)),
      roles: (roleRes.data || []).map((role) => role.name),
      classes: classRes.data || [],
      can_announce: announce,
      people: [],
    };

    const term = q.q && filterLike(q.q);
    if (term || q.role) {
      let query = supabase.from('school_users').select('id, full_name, email')
        .eq('school_id', schoolId).eq('status', 'active');
      if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
      const { data: members, error } = await query.limit(200);
      if (error) throw new ApiError(500, error.message);
      let rows = members || [];
      if (q.role) {
        const ids = new Set(await userIdsWithRoles(supabase, schoolId, [q.role]));
        rows = rows.filter((row) => ids.has(row.id));
      }
      // Roles are attached only for the page being returned, so a search costs one small join.
      const shown = rows.slice(0, q.limit);
      const rolesBy = {};
      if (shown.length) {
        const { data: links } = await supabase.from('school_user_roles')
          .select('user_id, school_roles(name)').in('user_id', shown.map((row) => row.id));
        for (const link of links || []) {
          const name = link.school_roles?.name;
          if (name) (rolesBy[link.user_id] ||= []).push(name);
        }
      }
      answer.people = shown.map((row) => ({ ...row, roles: rolesBy[row.id] || [] }));
      answer.people_total = rows.length;
    }
    res.json({ data: answer });
  } catch (e) { next(e); }
});

/** PostgREST's `or=` list is comma-separated, so a search term cannot carry one. */
function filterLike(text) {
  return String(text).replace(/[,*%()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Send now, or hand the send to the scheduler. Either way the recipient list is resolved here, from
 * server-side authorization, and never accepted from the browser.
 */
notificationsOpsRouter.post('/send', requirePermission('notifications.send'), sendLimiter, async (req, res, next) => {
  try {
    const body = sendSchema.parse(req.body);
    assertMayCompose(req.auth, body);
    const supabase = requireDb();
    const classIds = await scopedClassIds(supabase, req.auth, body);

    const sendAt = body.send_at instanceof Date && !Number.isNaN(body.send_at.getTime()) ? body.send_at : null;
    if (sendAt && sendAt.getTime() - Date.now() > SCHEDULE_MIN_MS) {
      if (sendAt.getTime() - Date.now() > SCHEDULE_HORIZON_MS) throw new ApiError(400, 'A scheduled notice must be sent within 90 days.');
      const { data: queued, error } = await supabase.from('scheduled_notifications').insert({
        school_id: req.auth.schoolId,
        recipient_scope: 'school',
        created_by: req.auth.userId,
        created_by_scope: 'school',
        category: body.category,
        priority: body.priority,
        title: body.title,
        body: body.body || null,
        link: body.link || '/notifications',
        targeting: { audience: body.audience, class_ids: classIds, role_names: body.role_names, user_ids: body.user_ids },
        channels: body.channels,
        scheduled_at: sendAt.toISOString(),
        status: 'pending',
      }).select().maybeSingle();
      if (error) throw new ApiError(500, error.message);
      await audit(req, {
        module: 'notifications', action: 'schedule', recordId: queued?.id,
        summary: `Scheduled a ${body.category} notice for ${sendAt.toISOString()}: ${body.title}`,
        metadata: { audience: body.audience, scheduled_at: sendAt.toISOString(), channels: body.channels },
      });
      return res.status(202).json({
        data: {
          status: 'scheduled', scheduled: queued,
          note: 'Recipients are counted again when the notice is due, and a sender who has lost the permission cannot send it.',
        },
      });
    }

    const ids = await resolveAudience(supabase, req.auth, body, classIds);
    if (!ids.length) throw new ApiError(400, 'This audience currently has no recipients.');

    const summary = await notify(supabase, ids, sendOptions(req, body));
    if (summary.error) throw new ApiError(500, summary.error);
    const push = await settleWithin(summary.push, PUSH_REPORT_WAIT_MS);
    const email = await settleWithin(summary.email, 500);

    await audit(req, {
      module: 'notifications', action: 'send', recordId: summary.batch,
      summary: `Sent a ${body.category} notification to ${describeAudience(body, classIds.length)}: ${body.title}`,
      metadata: {
        audience: body.audience, class_ids: classIds, role_names: body.role_names,
        category: body.category, priority: body.priority, channels: body.channels,
        recipients: summary.inserted, batch_id: summary.batch,
      },
    });
    res.status(201).json({
      data: {
        batch_id: summary.batch,
        audience: body.audience,
        audience_detail: describeAudience(body, classIds.length),
        addressed: ids.length,
        delivered: summary.inserted,
        suppressed: summary.suppressed,
        truncated: summary.truncated,
        push: push || { pending: true, note: 'Still sending — the delivery log has the final counts.' },
        email: email || null,
      },
    });
  } catch (e) { next(e); }
});

/** The queue the scheduler drains, so a school can see and cancel what it has pending. */
notificationsOpsRouter.get('/scheduled', requirePermission('notifications.send'), async (req, res, next) => {
  try {
    const { data, error } = await requireDb().from('scheduled_notifications').select('*')
      .eq('school_id', req.auth.schoolId).in('status', ['pending', 'sending', 'failed'])
      .order('scheduled_at', { ascending: true }).limit(200);
    if (error) throw new ApiError(500, error.message);
    const mine = mayAnnounce(req.auth) ? data || [] : (data || []).filter((row) => row.created_by === req.auth.userId);
    res.json({ data: mine });
  } catch (e) { next(e); }
});

notificationsOpsRouter.post('/scheduled/:id/cancel', requirePermission('notifications.send'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: row, error } = await supabase.from('scheduled_notifications').select('id, status, created_by, title')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!row) throw new ApiError(404, 'Scheduled notification not found');
    if (!mayAnnounce(req.auth) && row.created_by !== req.auth.userId) throw new ApiError(403, 'Only the sender may cancel this notice.');
    if (row.status !== 'pending') throw new ApiError(409, `This notice is already ${row.status}.`);
    const { data: updated, error: updateError } = await supabase.from('scheduled_notifications')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
    if (updateError) throw new ApiError(500, updateError.message);
    if (!updated) throw new ApiError(409, 'This notice started sending a moment ago and can no longer be cancelled.');
    await audit(req, {
      module: 'notifications', action: 'cancel', recordId: row.id,
      summary: `Cancelled a scheduled notice: ${row.title}`, metadata: { scheduled_id: row.id },
    });
    res.json({ data: updated });
  } catch (e) { next(e); }
});

function tally(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

/**
 * Everything one send did, per recipient and per channel. The batch id is what the composer returns, so
 * "did the parents actually get it" is one click away instead of a guess.
 */
notificationsOpsRouter.get('/batches/:batchId', requirePermission('notifications.export'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: heads, error } = await supabase.from('notifications')
      .select('id, recipient_user_id, category, priority, title, body, link, is_read, created_at')
      .eq('school_id', req.auth.schoolId).eq('batch_id', req.params.batchId).limit(1000);
    if (error) throw new ApiError(500, error.message);
    if (!heads?.length) throw new ApiError(404, 'No notification batch matches that id.');
    const { data: logs, error: logError } = await supabase.from('notification_delivery_logs')
      .select('recipient_user_id, channel, delivery_status, provider_code, error_message, attempt, sent_at')
      .eq('school_id', req.auth.schoolId).eq('batch_id', req.params.batchId).limit(5000);
    if (logError) throw new ApiError(500, logError.message);
    res.json({
      data: {
        batch_id: req.params.batchId,
        title: heads[0].title,
        category: heads[0].category,
        priority: heads[0].priority,
        created_at: heads[0].created_at,
        recipients: heads.length,
        read: heads.filter((row) => row.is_read).length,
        channels: tally(logs || [], (row) => `${row.channel}.${row.delivery_status}`),
        deliveries: logs || [],
      },
    });
  } catch (e) { next(e); }
});

/** Delivery rows newest first, filterable by batch, channel and outcome. */
notificationsOpsRouter.get('/delivery-logs', requirePermission('notifications.export'), async (req, res, next) => {
  try {
    const q = z.object({
      batch_id: z.string().uuid().optional(),
      channel: z.enum(CHANNELS).optional(),
      delivery_status: z.enum(['sent', 'failed', 'skipped']).optional(),
      days: z.coerce.number().int().min(1).max(90).default(14),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const supabase = requireDb();
    const from = new Date(Date.now() - q.days * 86400_000).toISOString();
    let query = supabase.from('notification_delivery_logs').select('*', { count: 'exact' })
      .eq('school_id', req.auth.schoolId).gte('created_at', from);
    if (q.batch_id) query = query.eq('batch_id', q.batch_id);
    if (q.channel) query = query.eq('channel', q.channel);
    if (q.delivery_status) query = query.eq('delivery_status', q.delivery_status);
    const { data, error, count } = await query.order('created_at', { ascending: false })
      .range(q.offset, q.offset + q.limit - 1);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: count || 0, limit: q.limit, offset: q.offset });
  } catch (e) { next(e); }
});

/**
 * A roll-up over a bounded sample of the tenant's recent inbox and delivery rows. The window is capped
 * and the sample is named in the answer, so a chart is never mistaken for a complete ledger.
 */
notificationsOpsRouter.get('/analytics', requirePermission('notifications.export'), async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;

    const [inboxRes, logRes, deviceRes, pendingRes] = await Promise.all([
      supabase.from('notifications').select('category, priority, is_read, created_at, batch_id, recipient_user_id')
        .eq('school_id', schoolId).gte('created_at', from).limit(ANALYTICS_SAMPLE),
      supabase.from('notification_delivery_logs').select('channel, delivery_status, provider_code, batch_id')
        .eq('school_id', schoolId).gte('created_at', from).limit(ANALYTICS_SAMPLE),
      supabase.from('push_tokens').select('user_id').eq('user_type', 'school').eq('school_id', schoolId).limit(5000),
      supabase.from('scheduled_notifications').select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId).eq('status', 'pending'),
    ]);
    if (inboxRes.error) throw new ApiError(500, inboxRes.error.message);
    const rows = inboxRes.data || [];
    const logs = logRes.error ? [] : (logRes.data || []);

    const byDay = new Map();
    const byCategory = new Map();
    const byPriority = new Map();
    const batches = new Set();
    const reached = new Set();
    let read = 0;
    for (const row of rows) {
      if (row.is_read) read += 1;
      const day = String(row.created_at || '').slice(0, 10);
      const daily = byDay.get(day) || { date: day, sent: 0, read: 0 };
      daily.sent += 1;
      if (row.is_read) daily.read += 1;
      byDay.set(day, daily);
      const category = byCategory.get(row.category) || { category: row.category, sent: 0, read: 0 };
      category.sent += 1;
      if (row.is_read) category.read += 1;
      byCategory.set(row.category, category);
      const priority = byPriority.get(row.priority) || { priority: row.priority, sent: 0 };
      priority.sent += 1;
      byPriority.set(row.priority, priority);
      if (row.batch_id) batches.add(row.batch_id);
      reached.add(row.recipient_user_id);
    }
    const channels = {
      push: { sent: 0, failed: 0, skipped: 0 },
      email: { sent: 0, failed: 0, skipped: 0 },
      in_app: { sent: 0, failed: 0, skipped: 0 },
    };
    for (const log of logs) {
      const bucket = channels[log.channel];
      if (bucket && log.delivery_status in bucket) bucket[log.delivery_status] += 1;
    }

    res.json({
      data: {
        window: { days, from },
        sampled: rows.length >= ANALYTICS_SAMPLE || logs.length >= ANALYTICS_SAMPLE,
        totals: {
          sent: rows.length,
          read,
          read_rate: rows.length ? Math.round((read / rows.length) * 100) / 100 : 0,
          sends: batches.size,
          recipients_reached: reached.size,
        },
        by_day: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
        by_category: [...byCategory.values()].sort((a, b) => b.sent - a.sent),
        by_priority: [...byPriority.values()],
        channels,
        push_errors: tally(
          logs.filter((log) => log.channel === 'push' && log.delivery_status !== 'sent' && log.provider_code),
          (log) => log.provider_code,
        ).slice(0, 8),
        devices: {
          registered: (deviceRes.data || []).length,
          unique_users: new Set((deviceRes.data || []).map((row) => row.user_id)).size,
        },
        scheduled_pending: pendingRes.count || 0,
      },
    });
  } catch (e) { next(e); }
});
