import { createHash, randomUUID } from 'node:crypto';
import { db } from '../config/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../middleware/error.js';

/**
 * School data backups stored in append-only audit_logs (no extra migration needed):
 * one `backup` row per run (metadata only) and one `backup_data` row holding the payload.
 * Payload rows are pruned by retention; the audit trail of the run itself is kept.
 */
export const BACKUP_MODULE = 'backup';

// Every tenant table that belongs to the school's own data. Row caps keep a 10-second
// scheduler round bounded; the largest transactional tables get a higher ceiling.
const TABLES = [
  'school_settings', 'academic_years', 'terms', 'classes', 'sections', 'subjects', 'class_subjects',
  'classrooms', 'teacher_assignments', 'timetable_periods', 'timetable_entries',
  'students', 'guardians', 'student_guardians', 'student_documents',
  'staff_departments', 'staff_profiles', 'staff_attendance', 'staff_documents', 'leave_requests',
  'attendance_sessions', 'attendance_records', 'attendance_corrections',
  'examination_types', 'examinations', 'exam_class_subjects', 'examination_components',
  'examination_schedules', 'examination_invigilators', 'examination_attendance', 'marks',
  'grade_scales', 'grade_ranges', 'result_approvals', 'report_cards',
  'fee_categories', 'fee_structures', 'class_monthly_fees', 'student_fee_assignments', 'fee_invoices', 'fee_payments',
  'payment_allocations', 'receipts', 'expense_categories', 'expenses', 'financial_approvals',
  'examination_clearances',
  'elections', 'election_positions', 'election_candidates', 'candidate_manifestos',
  'election_voter_participation', 'election_ballots', 'election_ballot_selections', 'election_results',
  'learning_materials', 'assignments', 'assignment_attachments', 'assignment_submissions', 'assignment_grades',
  'announcements', 'certificate_templates', 'certificates', 'student_id_cards',
  'library_books', 'library_transactions', 'discipline_records',
  'transport_vehicles', 'transport_drivers', 'transport_routes', 'student_transport_assignments',
  'lab_equipment', 'equipment_allocations', 'visitors', 'appointments',
];

const BIG_TABLES = new Set(['attendance_records', 'marks', 'fee_payments', 'students', 'library_transactions',
  'election_ballot_selections', 'election_voter_participation']);
const rowLimit = (table) => (BIG_TABLES.has(table) ? 3000 : 1000);

const MAX_AUTO_BACKUPS = 60;
const AUTO_MIN_INTERVAL_MS = 10000;

let state = {
  enabled: false,
  intervalMs: Math.max(AUTO_MIN_INTERVAL_MS, Number(env.backupIntervalMs) || AUTO_MIN_INTERVAL_MS),
  running: false,
  lastRunAt: null,
  lastDurationMs: null,
  lastResult: null,
};

export function autoBackupState() {
  return {
    enabled: state.enabled, intervalMs: state.intervalMs, running: state.running,
    lastRunAt: state.lastRunAt, lastDurationMs: state.lastDurationMs, lastResult: state.lastResult,
  };
}

export function setAutoBackup(enabled) {
  state.enabled = Boolean(enabled);
  return autoBackupState();
}

/** Restore the super admin's on/off choice after a restart; it lives in the audit trail. */
export async function hydrateAutoBackupState() {
  try {
    const { data } = await db().from('audit_logs').select('action')
      .eq('module', BACKUP_MODULE).in('action', ['scheduler_enabled', 'scheduler_disabled'])
      .order('created_at', { ascending: false }).limit(1);
    state.enabled = data?.[0]?.action === 'scheduler_enabled';
  } catch (err) {
    logger.warn({ err }, 'could not restore automatic backup setting');
  }
  return autoBackupState();
}

async function readTable(table, schoolId) {
  const limit = rowLimit(table);
  let q = db().from(table).select('*').eq('school_id', schoolId).limit(limit);
  const { data, error } = await q.order('id');
  if (error) return { error: error.message };
  return { rows: data || [], truncated: (data || []).length >= limit };
}

/** Collect a full tenant snapshot, then store it as backup + backup_data audit rows. */
export async function createBackup(schoolId, { kind = 'manual', skipIfUnchanged = false, actor = {} } = {}) {
  const { data: school, error: schoolError } = await db().from('schools')
    .select('id, school_name, status, created_at').eq('id', schoolId).maybeSingle();
  if (schoolError) throw new Error(schoolError.message);
  if (!school) throw new Error('School not found');

  const data = {};
  const tables = {};
  // Bounded concurrency keeps a round within the 10-second window.
  for (let i = 0; i < TABLES.length; i += 8) {
    const batch = TABLES.slice(i, i + 8);
    const results = await Promise.all(batch.map((table) => readTable(table, schoolId)));
    batch.forEach((table, index) => {
      const result = results[index];
      if (result.error) { tables[table] = { error: result.error }; return; }
      data[table] = result.rows;
      tables[table] = { rows: result.rows.length, truncated: result.truncated };
    });
  }

  const body = { school, tables: data };
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const generatedAt = new Date().toISOString();
  const totalRows = Object.values(tables).reduce((sum, value) => sum + (value.rows || 0), 0);

  if (skipIfUnchanged) {
    const { data: latest } = await db().from('audit_logs')
      .select('id, metadata, created_at').eq('school_id', schoolId).eq('module', BACKUP_MODULE)
      .eq('action', 'backup').order('created_at', { ascending: false }).limit(1);
    if (latest?.[0]?.metadata?.hash === hash) {
      return { skipped: true, hash, tables, totalRows, generatedAt };
    }
  }

  const backupId = randomUUID();
  const payload = { backup_id: backupId, kind, generated_at: generatedAt, ...body };
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload));

  const { error: dataError } = await db().from('audit_logs').insert({
    school_id: schoolId,
    user_id: actor.userId || null,
    user_scope: actor.scope || (actor.userId ? 'school' : 'system'),
    action: 'backup_data', module: BACKUP_MODULE, record_id: backupId,
    summary: `Data payload for ${kind} backup ${backupId.slice(0, 8)}`,
    metadata: { payload },
  });
  if (dataError) throw new Error(dataError.message);

  const { data: meta, error: metaError } = await db().from('audit_logs').insert({
    school_id: schoolId,
    user_id: actor.userId || null,
    user_scope: actor.scope || (actor.userId ? 'school' : 'system'),
    action: 'backup', module: BACKUP_MODULE, record_id: backupId,
    summary: `${kind === 'auto' ? 'Automatic' : 'Manual'} backup · ${totalRows.toLocaleString()} rows · ${(sizeBytes / 1024).toFixed(1)} KB`,
    metadata: {
      backup_id: backupId, kind, hash, size_bytes: sizeBytes, total_rows: totalRows,
      tables, generated_at: generatedAt, school_name: school.school_name,
    },
  }).select().single();
  if (metaError) throw new Error(metaError.message);

  if (kind === 'auto') await pruneAutoBackups(schoolId);
  return { skipped: false, backup: meta, hash, tables, totalRows, sizeBytes, generatedAt };
}

async function pruneAutoBackups(schoolId) {
  const { data: metas } = await db().from('audit_logs')
    .select('id, record_id, metadata, created_at').eq('school_id', schoolId).eq('module', BACKUP_MODULE)
    .eq('action', 'backup').order('created_at', { ascending: false }).limit(500);
  const auto = (metas || []).filter((row) => row.metadata?.kind === 'auto');
  const stale = auto.slice(MAX_AUTO_BACKUPS);
  if (!stale.length) return;
  const staleIds = stale.map((row) => row.id);
  const backupIds = stale.map((row) => row.record_id).filter(Boolean);
  await db().from('audit_logs').delete().in('id', staleIds);
  if (backupIds.length) {
    await db().from('audit_logs').delete().eq('module', BACKUP_MODULE)
      .eq('action', 'backup_data').in('record_id', backupIds);
  }
}

export async function listBackups(schoolId, { page = 1, pageSize = 20, kind } = {}) {
  let q = db().from('audit_logs')
    .select('id, record_id, summary, metadata, created_at', { count: 'exact' })
    .eq('school_id', schoolId).eq('module', BACKUP_MODULE).eq('action', 'backup');
  if (kind) q = q.filter('metadata->>kind', 'eq', kind);
  const { data, count, error } = await q.order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { data: data || [], total: count ?? (data || []).length, page, pageSize };
}

export async function getBackupPayload(schoolId, metaId) {
  const { data: meta, error } = await db().from('audit_logs').select('*')
    .eq('id', metaId).eq('school_id', schoolId).eq('module', BACKUP_MODULE).eq('action', 'backup')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!meta) return null;
  const { data: payloadRow } = await db().from('audit_logs').select('metadata')
    .eq('school_id', schoolId).eq('module', BACKUP_MODULE).eq('action', 'backup_data')
    .eq('record_id', meta.record_id).maybeSingle();
  return { meta, payload: payloadRow?.metadata?.payload || null };
}

/** Run one automatic round across active tenants; unchanged data is skipped by hash. */
export async function runAutoBackupRound({ force = false } = {}) {
  if ((!state.enabled && !force) || state.running) return autoBackupState();
  state.running = true;
  const started = Date.now();
  const result = { schools: 0, created: 0, skipped: 0, failed: 0 };
  try {
    const { data: schools, error } = await db().from('schools').select('id')
      .in('status', ['trial', 'active', 'past_due']).limit(50);
    if (error) throw new Error(error.message);
    for (const school of schools || []) {
      result.schools += 1;
      try {
        const outcome = await createBackup(school.id, { kind: 'auto', skipIfUnchanged: true });
        if (outcome.skipped) result.skipped += 1; else result.created += 1;
      } catch (err) {
        result.failed += 1;
        logger.warn({ err, schoolId: school.id }, 'automatic backup failed');
      }
    }
  } catch (err) {
    result.error = err.message;
    logger.warn({ err }, 'automatic backup round failed');
  } finally {
    state.running = false;
    state.lastRunAt = new Date().toISOString();
    state.lastDurationMs = Date.now() - started;
    state.lastResult = result;
  }
  return autoBackupState();
}

/** Starts the 10-second scheduler. Idempotent per process. */
export function startBackupScheduler() {
  const timer = setInterval(() => { runAutoBackupRound().catch(() => {}); }, state.intervalMs);
  timer.unref?.();
  return timer;
}

export async function listPlatformBackups({ page = 1, pageSize = 25, schoolId } = {}) {
  let q = db().from('audit_logs')
    .select('id, school_id, record_id, summary, metadata, created_at, schools(school_name)', { count: 'exact' })
    .eq('module', BACKUP_MODULE).eq('action', 'backup');
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, count, error } = await q.order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { data: data || [], total: count ?? (data || []).length, page, pageSize, auto: autoBackupState() };
}
