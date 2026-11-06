import { db } from '../config/supabase.js';
import { logger } from '../middleware/error.js';
import { notificationOpsReady } from './schemaSupport.js';
import { notify, userIdsWithRoles, householdsByStudent } from './notify.js';
import {
  AUDIENCE_CAP, assertMayCompose, permissionsOf, resolveAudience, scopedClassIds,
} from './notifyCompose.js';

/**
 * Notices that fire on the clock.
 *
 * Three sweeps share one timer. The queue the school composer writes is delivered when it is due —
 * re-authorised at that moment, so a notice queued by an account that has since lost the switches never
 * goes out. Behind it run the automatic reminders the specification asks for: work still unsubmitted
 * near its deadline, a class starting in a few minutes, and a licence about to lapse.
 *
 * Every sweep is written to be safe to repeat. A due row is claimed by moving it out of 'pending' in one
 * statement, so two API processes ticking at the same instant send it once. A reminder is stamped in the
 * audit trail with a key naming exactly what it covered, so the same nudge is never sent twice — and if
 * the API is restarted, the ledger survives in the database with the rest of the school's history.
 */

const TICK_MS = 20_000;
/**
 * How often each sweep is worth doing. A lesson notice is only useful if the sweep is quicker than the
 * lead time it warns about, so classes are checked every few minutes while a licence is checked twice a
 * day. The per-subject ledger key makes every sweep safe to repeat.
 */
const SWEEP_MS = {
  assignments: 15 * 60_000,
  lessons: 5 * 60_000,
  subscriptions: 6 * 60 * 60_000,
};
const DEFAULT_ASSIGNMENT_LEAD_HOURS = 24;
const DEFAULT_LESSON_LEAD_MINUTES = 10;
/** One reminder per assignment, however many sweeps see it coming. */
const LOOKAHEAD_DAYS = { assignments: 2, subscriptions: 8 };

let running = false;
const stats = {
  rounds: 0, delivered: 0, assignment_reminders: 0, lesson_reminders: 0, subscription_alerts: 0,
  last_round_at: null, last_error: null,
};
const lastSweep = { assignments: 0, lessons: 0, subscriptions: 0 };

async function systemAudit({ schoolId, recordId, action, summary, metadata = {}, status = 'success' }) {
  try {
    await db().from('audit_logs').insert({
      school_id: schoolId,
      user_id: null,
      user_scope: 'system',
      action,
      module: 'notifications',
      record_id: String(recordId),
      summary,
      ip_address: null,
      metadata,
      status,
    });
  } catch (err) {
    logger.warn(`notifications audit entry not written (${err.message})`);
  }
}

/**
 * Has this already been said? The audit trail is the ledger: an automatic notice stamps a key naming its
 * subject, and a later sweep that finds the key moves on. It costs no new table, and the record of what
 * the clock told a school is where a school's other records already live.
 */
async function alreadySent(supabase, key) {
  const { data } = await supabase.from('audit_logs').select('id').eq('module', 'notifications')
    .eq('action', 'auto_notice').eq('record_id', key).limit(1);
  return (data || []).length > 0;
}

async function markSent(supabase, { key, schoolId, summary, metadata }) {
  await systemAudit({ schoolId, recordId: key, action: 'auto_notice', summary, metadata });
}

/** The tenant's switches, with the documented defaults for anything it has never set. */
async function notificationSettings(supabase, schoolIds) {
  if (!schoolIds.length) return new Map();
  const found = new Map();
  for (let i = 0; i < schoolIds.length; i += 100) {
    const { data } = await supabase.from('school_settings').select('school_id, timezone, notification_configuration')
      .in('school_id', schoolIds.slice(i, i + 100)).limit(100);
    for (const row of data || []) found.set(row.school_id, row);
  }
  return found;
}

function settingOf(row, key, fallback) {
  const value = (row?.notification_configuration || {})[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

// ── 1. The composer's queue ────────────────────────────────────
/** The claim is the status transition: a row two processes both see is sent by whichever wins it. */
async function claimRow(supabase, row) {
  const { data } = await supabase.from('scheduled_notifications')
    .update({ status: 'sending', attempts: (row.attempts || 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
  return data || null;
}

async function settleRow(supabase, id, patch) {
  const { error } = await supabase.from('scheduled_notifications')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) logger.warn(`notification queue: ${id} not updated (${error.message})`);
}

/**
 * Re-authorised as the sender, from their current roles. The audience description stored in the row is
 * resolved the same way the composer resolves it, so a class that gained or lost learners between the
 * queueing and the sending is addressed as it is at the moment the notice goes out.
 */
async function deliverOne(supabase, row) {
  const claimed = await claimRow(supabase, row);
  if (!claimed) return false;
  const targeting = claimed.targeting || {};
  const body = {
    audience: targeting.audience || 'all',
    class_ids: targeting.class_ids || [],
    role_names: targeting.role_names || [],
    user_ids: targeting.user_ids || [],
    category: claimed.category,
  };
  try {
    const { data: sender } = await supabase.from('school_users').select('id, status, school_id')
      .eq('id', claimed.created_by).maybeSingle();
    if (!sender || sender.status !== 'active' || sender.school_id !== claimed.school_id) {
      throw new Error('The sender no longer holds an active membership in this school');
    }
    const auth = {
      type: 'school', schoolId: claimed.school_id, userId: sender.id,
      permissions: await permissionsOf(supabase, claimed.school_id, sender.id),
      isSuperAdmin: false,
    };
    assertMayCompose(auth, body);
    const classIds = await scopedClassIds(supabase, auth, body);
    const ids = await resolveAudience(supabase, auth, body, classIds);
    const summary = await notify(supabase, ids, {
      schoolId: claimed.school_id, scope: 'school', category: claimed.category,
      title: claimed.title, body: claimed.body, link: claimed.link,
      priority: claimed.priority, batchId: claimed.batch_id, channels: claimed.channels,
      ackRequired: targeting.ack_required === true,
    });
    if (summary.error) throw new Error(summary.error);
    // Nobody is waiting on this response, so the push leg is finished before the row is closed.
    const push = await summary.push;
    await settleRow(supabase, claimed.id, {
      status: 'sent', delivered_to: summary.inserted, sent_at: new Date().toISOString(), last_error: null,
    });
    await systemAudit({
      schoolId: claimed.school_id, recordId: claimed.id, action: 'notification_scheduled_sent',
      summary: `Scheduled notice sent to ${summary.inserted} inbox(es): ${claimed.title}`,
      metadata: {
        batch_id: claimed.batch_id, suppressed: summary.suppressed, truncated: summary.truncated,
        push: push && { attempted: push.attempted, sent: push.sent, failed: push.failed, skipped: push.skipped },
      },
    });
    stats.delivered += 1;
    logger.info(`notifications: scheduled notice "${claimed.title}" delivered to ${summary.inserted} inbox(es)`);
    return true;
  } catch (error) {
    await settleRow(supabase, claimed.id, { status: 'failed', last_error: String(error.message || error).slice(0, 500) });
    await systemAudit({
      schoolId: claimed.school_id, recordId: claimed.id, action: 'notification_scheduled_failed',
      summary: `Scheduled notice not sent: ${String(error.message || error).slice(0, 200)}`,
      metadata: { title: claimed.title, attempts: claimed.attempts }, status: 'failed',
    });
    logger.warn(`notifications: scheduled notice ${claimed.id} failed (${error.message})`);
    return false;
  }
}

async function drainQueue(supabase) {
  const { data: due, error } = await supabase.from('scheduled_notifications').select('*')
    .eq('status', 'pending').lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const row of due || []) {
    if (await deliverOne(supabase, row)) sent += 1;
  }
  return sent;
}

// ── 2. Work still unsubmitted near its deadline ────────────────
async function assignmentReminders(supabase) {
  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS.assignments * 86400_000).toISOString();
  const { data: assignments, error } = await supabase.from('assignments')
    .select('id, school_id, class_id, title, due_date')
    .eq('status', 'open').gte('due_date', new Date().toISOString()).lte('due_date', horizon)
    .order('due_date', { ascending: true }).limit(200);
  if (error) throw new Error(error.message);
  if (!assignments?.length) return 0;

  const settings = await notificationSettings(supabase, [...new Set(assignments.map((row) => row.school_id))]);
  let sent = 0;
  for (const assignment of assignments) {
    const leadHours = Number(settingOf(settings.get(assignment.school_id), 'assignment_reminder_hours', DEFAULT_ASSIGNMENT_LEAD_HOURS));
    if (!(leadHours > 0)) continue;
    const hoursLeft = (new Date(assignment.due_date).getTime() - Date.now()) / 3600_000;
    if (hoursLeft > leadHours) continue;

    const key = `assignment:${assignment.id}:due-reminder`;
    if (await alreadySent(supabase, key)) continue;

    const [{ data: submissions }, { data: students }] = await Promise.all([
      supabase.from('assignment_submissions').select('student_id').eq('assignment_id', assignment.id).limit(AUDIENCE_CAP),
      supabase.from('students').select('id, user_id').eq('school_id', assignment.school_id)
        .eq('class_id', assignment.class_id).eq('status', 'active').limit(AUDIENCE_CAP),
    ]);
    const submitted = new Set((submissions || []).map((row) => row.student_id));
    const behind = (students || []).filter((row) => !submitted.has(row.id));
    if (!behind.length) continue;

    // Households, grouped per learner: a family is told about its own child, not about the class.
    const households = await householdsByStudent(supabase, assignment.school_id, behind.map((row) => row.id));
    const ids = [...new Set([...households.values()].flat().filter(Boolean))];
    if (!ids.length) continue;

    const wholeHours = Math.max(1, Math.round(hoursLeft));
    const summary = await notify(supabase, ids, {
      schoolId: assignment.school_id, scope: 'school', category: 'academic',
      priority: hoursLeft <= 6 ? 'high' : 'normal',
      title: `Assignment due in ${wholeHours} hour(s): ${assignment.title}`,
      body: `${behind.length} learner(s) in this class have not submitted it yet.`,
      link: '/m/assignments',
    });
    if (summary.error) continue;
    await markSent(supabase, {
      key, schoolId: assignment.school_id,
      summary: `Assignment deadline reminder sent: ${assignment.title}`,
      metadata: { assignment_id: assignment.id, class_id: assignment.class_id, outstanding: behind.length, recipients: summary.inserted },
    });
    await summary.push.catch(() => null);
    sent += 1;
    stats.assignment_reminders += 1;
  }
  return sent;
}

// ── 3. A class starting in a few minutes ───────────────────────
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The school's own clock. A timetable belongs to the timezone the tenant set, not to the server's, so an
 * API hosted in UTC still tells a Mogadishu class about its next period at the right minute.
 */
function localClock(timeZone) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const index = WEEKDAY_NAMES.findIndex((name) => name.slice(0, 3) === parts.weekday);
    const hour = Number(parts.hour === '24' ? 0 : parts.hour);
    return { day: WEEKDAY_NAMES[index] || null, minutes: Number.isFinite(hour) ? hour * 60 + Number(parts.minute) : null };
  } catch {
    return { day: null, minutes: null };
  }
}

function minuteOfDay(time) {
  const text = String(time || '').slice(0, 5);
  if (!text) return null;
  const [hour, minute] = text.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

async function lessonReminders(supabase) {
  // Only tenants that switched this on are read: the sweep costs one query for the whole platform until
  // a school asks for it, because an empty notification_configuration matches nothing here.
  const { data: opted, error } = await supabase.from('school_settings')
    .select('school_id, timezone, notification_configuration')
    .eq('notification_configuration->>lesson_reminders', 'true').limit(200);
  if (error) throw new Error(error.message);
  if (!opted?.length) return 0;

  let sent = 0;
  for (const row of opted) {
    const lead = Number(settingOf(row, 'lesson_lead_minutes', DEFAULT_LESSON_LEAD_MINUTES));
    const clock = localClock(row.timezone || 'Africa/Mogadishu');
    if (!clock.day || clock.minutes === null || !(lead > 0)) continue;

    const { data: entries } = await supabase.from('timetable_entries')
      .select('id, class_id, teacher_id, subjects(name), timetable_periods!inner(name, start_time)')
      .eq('school_id', row.school_id).eq('day_of_week', clock.day).limit(300);
    for (const entry of entries || []) {
      const start = minuteOfDay(entry.timetable_periods?.start_time);
      if (start === null) continue;
      const untilStart = start - clock.minutes;
      if (untilStart < 1 || untilStart > lead) continue;

      const today = new Date().toISOString().slice(0, 10);
      const key = `lesson:${entry.id}:${today}`;
      if (await alreadySent(supabase, key)) continue;

      const students = await supabase.from('students').select('user_id').eq('school_id', row.school_id)
        .eq('class_id', entry.class_id).eq('status', 'active').limit(AUDIENCE_CAP);
      const ids = [...new Set([
        ...(entry.teacher_id ? [entry.teacher_id] : []),
        ...(students.data || []).map((item) => item.user_id).filter(Boolean),
      ])];
      if (!ids.length) continue;

      const period = entry.timetable_periods?.name || '';
      const subject = entry.subjects?.name || 'lesson';
      const summary = await notify(supabase, ids, {
        schoolId: row.school_id, scope: 'school', category: 'timetable',
        title: `${subject} starts in ${untilStart} minute(s)`,
        body: `Period ${period} — ${subject}.`,
        link: '/school/timetable',
      });
      if (summary.error) continue;
      await markSent(supabase, {
        key, schoolId: row.school_id,
        summary: `Lesson reminder sent for ${subject} (${period})`,
        metadata: { timetable_entry_id: entry.id, class_id: entry.class_id, recipients: summary.inserted },
      });
      await summary.push.catch(() => null);
      sent += 1;
      stats.lesson_reminders += 1;
    }
  }
  return sent;
}

// ── 4. A licence about to lapse ────────────────────────────────
/** The warning ladder: one message per step, so a school hears a week out, again at three days, again today. */
function thresholdFor(days) {
  if (days < 0) return 'lapsed';
  if (days <= 1) return '1d';
  if (days <= 3) return '3d';
  if (days <= 7) return '7d';
  return null;
}

async function subscriptionAlerts(supabase) {
  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS.subscriptions * 86400_000).toISOString();
  const soon = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: subs, error } = await supabase.from('school_subscriptions')
    .select('id, school_id, status, end_date, trial_end_date, grace_period_end, subscription_plans(name)')
    .in('status', ['trial', 'active', 'past_due'])
    .or(`end_date.gte.${soon},trial_end_date.gte.${soon},grace_period_end.gte.${soon}`)
    .or(`end_date.lte.${horizon},trial_end_date.lte.${horizon},grace_period_end.lte.${horizon}`)
    .limit(200);
  if (error) throw new Error(error.message);
  if (!subs?.length) return 0;

  const settings = await notificationSettings(supabase, [...new Set(subs.map((row) => row.school_id))]);
  let sent = 0;
  for (const sub of subs) {
    if (String(settingOf(settings.get(sub.school_id), 'subscription_alerts', true)).toLowerCase() === 'false') continue;

    // The nearest deadline this subscription has — a trial that ended an hour ago is more urgent than
    // the renewal date a year out.
    const dates = [sub.trial_end_date, sub.end_date, sub.grace_period_end].filter(Boolean).map((value) => new Date(value));
    if (!dates.length) continue;
    const next = dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    const days = Math.ceil((next.getTime() - Date.now()) / 86400_000);
    const bucket = thresholdFor(days);
    if (!bucket) continue;

    const key = `subscription:${sub.id}:${next.toISOString().slice(0, 10)}:${bucket}`;
    if (await alreadySent(supabase, key)) continue;

    const ids = await userIdsWithRoles(supabase, sub.school_id, ['school_admin', 'principal']);
    if (!ids.length) continue;

    const plan = sub.subscription_plans?.name || 'this plan';
    const when = next.toISOString().slice(0, 10);
    const summary = await notify(supabase, ids, {
      schoolId: sub.school_id, scope: 'school', category: 'account',
      priority: days <= 1 ? 'urgent' : 'high',
      title: bucket === 'lapsed'
        ? `Licence deadline passed on ${when}: ${plan}`
        : `Licence for ${plan} ${days <= 1 ? 'expires today' : `expires in ${days} days`} (${when})`,
      body: bucket === 'lapsed'
        ? 'The school is past its end date. Renew or extend the subscription to keep every account signed in.'
        : 'Renew from the subscription screen so teaching is not interrupted.',
      link: '/school/subscription',
    });
    if (summary.error) continue;
    await markSent(supabase, {
      key, schoolId: sub.school_id,
      summary: `Subscription warning sent (${bucket}) for ${plan}`,
      metadata: { subscription_id: sub.id, status: sub.status, deadline: when, recipients: summary.inserted },
    });
    await summary.push.catch(() => null);
    sent += 1;
    stats.subscription_alerts += 1;
  }
  return sent;
}

// ── The tick ───────────────────────────────────────────────────
export async function runNotificationTick({ now = Date.now(), sweeps = true } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    if (!(await notificationOpsReady())) return { skipped: true, reason: 'schema' };
    const supabase = db();
    const out = { queue: await drainQueue(supabase) };
    if (sweeps) {
      if (now - lastSweep.assignments >= SWEEP_MS.assignments) {
        lastSweep.assignments = now;
        out.assignment_reminders = await assignmentReminders(supabase);
      }
      if (now - lastSweep.lessons >= SWEEP_MS.lessons) {
        lastSweep.lessons = now;
        out.lesson_reminders = await lessonReminders(supabase);
      }
      if (now - lastSweep.subscriptions >= SWEEP_MS.subscriptions) {
        lastSweep.subscriptions = now;
        out.subscription_alerts = await subscriptionAlerts(supabase);
      }
    }
    stats.last_round_at = new Date().toISOString();
    return out;
  } finally {
    stats.rounds += 1;
    running = false;
  }
}

/**
 * Reminders are worth sending for a notice the school is late to read, so the sweeps run at boot rather
 * than waiting for the first interval. A school that was offline over the weekend gets its deadline
 * nudges on the Monday the API comes back, not an hour later.
 */
export async function catchUpNotifications() {
  if (!(await notificationOpsReady())) return { skipped: true, reason: 'schema' };
  lastSweep.assignments = 0;
  lastSweep.lessons = 0;
  lastSweep.subscriptions = 0;
  return runNotificationTick();
}

export function notificationSchedulerState() {
  return {
    ...stats,
    interval_ms: TICK_MS,
    running,
    next_sweep_at: {
      assignments: lastSweep.assignments ? new Date(lastSweep.assignments + SWEEP_MS.assignments).toISOString() : null,
      lessons: lastSweep.lessons ? new Date(lastSweep.lessons + SWEEP_MS.lessons).toISOString() : null,
      subscriptions: lastSweep.subscriptions ? new Date(lastSweep.subscriptions + SWEEP_MS.subscriptions).toISOString() : null,
    },
  };
}

export function startNotificationScheduler() {
  const timer = setInterval(() => {
    runNotificationTick().catch((error) => {
      stats.last_error = error.message;
      logger.warn(`notifications scheduler: ${error.message}`);
    });
  }, TICK_MS);
  timer.unref?.();
  return timer;
}
