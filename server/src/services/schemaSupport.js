import { requireDb } from '../config/supabase.js';

/**
 * Migration 0016 adds hemis_id/phone/notes to students. Installations that have not run it yet
 * keep working: the API strips those fields instead of failing every insert with PGRST204.
 * The answer is probed once per process — a missing column is a schema fact, not a transient error.
 */
let studentsProfile = null;

export async function studentsProfileColumns() {
  if (studentsProfile !== null) return studentsProfile;
  const { error } = await requireDb().from('students').select('id, hemis_id, phone, notes').limit(1);
  if (!error) { studentsProfile = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    studentsProfile = false;
    return false;
  }
  // Unknown failure (network, auth): assume the columns exist rather than silently dropping data.
  return true;
}

/**
 * Migration 0019 adds room/teacher_id to classes. Same contract as studentsProfileColumns():
 * probe once, and when the columns are missing the API drops them instead of failing writes.
 */
let classesExtras = null;

export async function classesExtraColumns() {
  if (classesExtras !== null) return classesExtras;
  const { error } = await requireDb().from('classes').select('id, room, teacher_id').limit(1);
  if (!error) { classesExtras = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    classesExtras = false;
    return false;
  }
  return true;
}

/**
 * Migration 0021 adds class_monthly_fees and fee_payments.period_month — the two facts the monthly
 * fee register is built from. Without them the screen cannot say who paid which month, so it asks
 * for the migration instead of failing on the first query.
 *
 * A "not ready" answer is never cached: the school applies the SQL file while this API is running,
 * and the page's Retry button must pick it up without a restart.
 */
let monthlyFees = null;

export async function monthlyFeeSchemaReady() {
  if (monthlyFees === true) return true;
  const [table, column] = await Promise.all([
    requireDb().from('class_monthly_fees').select('class_id, amount').limit(1),
    requireDb().from('fee_payments').select('id, period_month').limit(1),
  ]);
  const error = table.error || column.error;
  if (!error) { monthlyFees = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column|relation/i.test(error.message || '')) {
    return false;
  }
  return true;
}

/**
 * Migration 0020 adds learning_materials.link_url (Google Drive video links) and the
 * student_transfers table. The lessons UI probes this so it can prompt for the migration
 * instead of failing every video save with PGRST204.
 */
let lessonLink = null;

export async function learningMaterialLinkColumn() {
  if (lessonLink !== null) return lessonLink;
  const { error } = await requireDb().from('learning_materials').select('id, link_url').limit(1);
  if (!error) { lessonLink = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    lessonLink = false;
    return false;
  }
  return true;
}

/**
 * Migration 0022 adds the student council election tables and the election_cast_ballot() function.
 * Like the monthly register, a "not ready" answer is never cached — the school pastes the SQL while
 * this API is running, and the page's Retry button must pick it up without a restart.
 */
let electionTables = null;

export async function electionsSchemaReady() {
  if (electionTables === true) return true;
  const [tables, tick] = await Promise.all([
    requireDb().from('elections').select('id, status, start_at, end_at').limit(1),
    requireDb().rpc('election_tick'),
  ]);
  const error = tables.error || tick.error;
  if (!error) { electionTables = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column|function|relation/i.test(error.message || '')) {
    return false;
  }
  return true;
}

/**
 * Migration 0025 adds priority and batch_id to notifications, the queue and delivery-log tables, the
 * push switch on preferences and the tenant's notification_configuration. Ordinary events keep reaching
 * the inbox without it — notify() drops the columns it cannot write — but the composer and the
 * scheduler's clock-driven sweeps need the tables to exist, so they stay idle until the school pastes
 * the file. Like monthlyFeeSchemaReady(), a "not ready" answer is never cached.
 */
let notifyOps = null;

export async function notificationOpsReady() {
  if (notifyOps === true) return true;
  const [queue, columns, logs] = await Promise.all([
    requireDb().from('scheduled_notifications').select('id, status').limit(1),
    requireDb().from('notifications').select('id, priority, batch_id').limit(1),
    requireDb().from('notification_delivery_logs').select('id, channel').limit(1),
  ]);
  const error = queue.error || columns.error || logs.error;
  if (!error) { notifyOps = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column|relation/i.test(error.message || '')) {
    return false;
  }
  return true;
}

/**
 * Migration 0025 also adds the per-category push switch to notification_preferences. The switch is
 * offered only when the column is there: a school that has not pasted the file yet gets the two toggles
 * it can actually keep, not a third that resets on reload.
 */
let pushSwitch = null;

export async function notificationPushPreferenceColumn() {
  if (pushSwitch === true) return true;
  const { error } = await requireDb().from('notification_preferences').select('category, push').limit(1);
  if (!error) { pushSwitch = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) return false;
  return true;
}

/**
 * Migration 0027 adds the acknowledgment pair to notifications. An announcement that asks to be
 * acknowledged still arrives whether or not the school has pasted the file — only the extra promise to
 * confirm reading is dropped, because inventing a requirement the database cannot remember would be
 * worse than not offering it.
 */
let ackColumns = null;

export async function notificationAckColumns() {
  if (ackColumns === true) return true;
  const { error } = await requireDb().from('notifications').select('id, ack_required, acknowledged_at').limit(1);
  if (!error) { ackColumns = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) return false;
  return true;
}
