import { db } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { audit } from './audit.js';
import { RESTORE_ORDER } from './schoolTables.js';

/**
 * Recycle bin without a schema migration: every hard delete writes the full row snapshot
 * into append-only audit_logs. Restore re-inserts the snapshot; purge only adds a marker,
 * so the audit trail itself is never rewritten.
 *
 * A whole-school wipe stores one bulk snapshot (`metadata.bulk`) instead of one row per
 * delete; restoring it re-inserts every table in dependency order.
 */
export const TRASH_MODULE = 'trash';

// Postgres generated columns reject explicit values, so they must be dropped before re-insert.
const GENERATED = { students: ['full_name'] };

// Never restore into identity/credential tables even if a metadata row were tampered with.
const PROTECTED_TABLES = new Set([
  'audit_logs', 'schools', 'school_users', 'platform_users', 'school_roles', 'role_permissions',
  'school_permissions', 'school_settings', 'subscriptions', 'platform_payments', 'plans', 'file_metadata',
]);

export function sanitizeSnapshot(table, row) {
  if (!row) return row;
  const copy = { ...row };
  for (const col of GENERATED[table] || []) delete copy[col];
  return copy;
}

export function recordLabel(table, row) {
  if (!row) return table;
  return row.name || row.title || row.full_name
    || [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ')
    || row.admission_number || row.invoice_number || row.receipt_number || row.plate_number
    || row.grade_label || row.visitor_name || row.reference_number || row.transaction_reference
    || row.id;
}

function actorColumns(actor = {}) {
  return {
    user_id: actor.userId || null,
    user_scope: actor.scope || (actor.userId ? 'school' : 'system'),
  };
}

function actorOf(req) {
  return { userId: req.auth?.userId, scope: req.auth?.type };
}

/** Snapshot a deleted row (and any rows a cascade removed) so it can be restored later. */
export async function recordDeletion(req, { table, row, related = [], module, label }) {
  if (!row) return;
  const text = label || recordLabel(table, row);
  await audit(req, {
    module: TRASH_MODULE,
    action: 'deleted',
    recordId: row.id,
    summary: `${module}: ${text} deleted`,
    metadata: { trash: true, table, module, label: text, snapshot: row, related },
  });
}

async function findDeletion(id, schoolId = null) {
  let q = db().from('audit_logs').select('*').eq('id', id).eq('module', TRASH_MODULE);
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data || data.action !== 'deleted' || !data.metadata?.trash) {
    throw new ApiError(404, 'That deleted record is not in the recycle bin');
  }
  return data;
}

async function isClosed(schoolId, trashId) {
  const { data } = await db().from('audit_logs').select('id')
    .eq('school_id', schoolId).eq('module', TRASH_MODULE)
    .in('action', ['restored', 'purged'])
    .filter('metadata->>trashId', 'eq', trashId).limit(1);
  return Boolean(data?.length);
}

async function mark(actor, action, log, summary) {
  await db().from('audit_logs').insert({
    school_id: log.school_id,
    ...actorColumns(actor),
    action,
    module: TRASH_MODULE,
    record_id: log.record_id,
    summary,
    metadata: { trashId: log.id, table: log.metadata?.table },
  });
}

async function loadTrashRows(schoolId = null) {
  let q = db().from('audit_logs')
    .select('id, school_id, action, record_id, summary, metadata, created_at, schools(school_name)')
    .eq('module', TRASH_MODULE);
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

function activeRows(rows) {
  const closed = new Set(rows
    .filter((r) => r.action === 'restored' || r.action === 'purged')
    .map((r) => r.metadata?.trashId).filter(Boolean));
  return rows.filter((r) => r.action === 'deleted' && r.metadata?.trash && !closed.has(r.id));
}

/** Close every open bin entry for a tenant that is being permanently deleted. */
export async function closeTrashForSchool(schoolId, actor) {
  if (!schoolId) return 0;
  const { data, error } = await db().from('audit_logs')
    .select('id, school_id, action, record_id, metadata')
    .eq('school_id', schoolId).eq('module', TRASH_MODULE).limit(1000);
  if (error) throw new ApiError(500, error.message);
  const open = activeRows(data || []);
  if (!open.length) return 0;
  const { error: closeError } = await db().from('audit_logs').insert(open.map((log) => ({
    school_id: schoolId,
    ...actorColumns(actor),
    action: 'purged',
    module: TRASH_MODULE,
    record_id: log.record_id,
    summary: 'School permanently deleted',
    metadata: { trashId: log.id, table: log.metadata?.table },
  })));
  if (closeError) throw new ApiError(500, closeError.message);
  return open.length;
}

export async function listTrash({ schoolId = null, q = '', page = 1, pageSize = 50 } = {}) {
  const rows = activeRows(await loadTrashRows(schoolId));

  let items = rows.map((r) => ({
    id: r.id, school_id: r.school_id,
    school_name: r.schools?.school_name || null,
    record_id: r.record_id, table: r.metadata.table,
    module: r.metadata.module, label: r.metadata.label,
    bulk: Boolean(r.metadata.bulk), rows: r.metadata.rows || null,
    has_related: Boolean(r.metadata.related?.length), deleted_at: r.created_at,
  }));

  const term = String(q || '').trim().toLowerCase();
  if (term) {
    items = items.filter((i) => `${i.label} ${i.table} ${i.module} ${i.school_name || ''}`.toLowerCase().includes(term));
  }

  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

async function restoreBulk(actor, log, schoolId) {
  const bulk = log.metadata.bulk || {};
  let tables = 0;
  let rows = 0;

  // Whole-school wipes include every table; single-section wipes include one. Parents must be
  // re-inserted before children, so follow RESTORE_ORDER and append anything else afterwards.
  const order = [
    ...RESTORE_ORDER.filter((table) => bulk[table]?.length),
    ...Object.keys(bulk).filter((table) => !RESTORE_ORDER.includes(table)),
  ];

  for (const table of order) {
    const tableRows = bulk[table];
    if (!tableRows?.length) continue;
    for (let i = 0; i < tableRows.length; i += 200) {
      const chunk = tableRows.slice(i, i + 200).map((row) => sanitizeSnapshot(table, row));
      const { error } = await db().from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
      if (error) {
        // 42P01 = optional table never installed; nothing to restore there.
        if (error.code === '42P01') break;
        throw new ApiError(409, `Bulk restore stopped at ${table}: ${error.message}`);
      }
    }
    tables += 1;
    rows += tableRows.length;
  }

  // Deleting a student disables its login; a bulk wipe keeps accounts, so re-enable just in case.
  const userLinks = (bulk.students || []).map((row) => row.user_id).filter(Boolean);
  for (let i = 0; i < userLinks.length; i += 200) {
    await db().from('school_users').update({ status: 'active' })
      .in('id', userLinks.slice(i, i + 200)).eq('school_id', schoolId);
  }

  await mark(actor, 'restored', log, `Restored ${log.metadata.label || `bulk data (${rows} rows)`}`);
  return { bulk: true, tables, rows, label: log.metadata.label, record_id: log.record_id };
}

export async function restoreTrashItem(req, id, { platform = false } = {}) {
  const log = await findDeletion(id, platform ? null : req.auth.schoolId);
  const schoolId = log.school_id;
  const actor = actorOf(req);

  if (await isClosed(schoolId, id)) throw new ApiError(409, 'This record was already restored or removed from the bin.');
  if (log.metadata.bulk) return restoreBulk(actor, log, schoolId);
  if (PROTECTED_TABLES.has(log.metadata.table)) throw new ApiError(400, 'This record cannot be restored.');

  const snapshot = sanitizeSnapshot(log.metadata.table, log.metadata.snapshot);
  const { error } = await db().from(log.metadata.table).insert(snapshot);
  if (error) {
    throw new ApiError(error.code === '23505' ? 409 : 400,
      error.code === '23505'
        ? 'A record with the same identifier exists again, so this snapshot cannot be restored.'
        : `Restore failed: ${error.message}`);
  }

  for (const rel of log.metadata.related || []) {
    if (!rel?.table || !rel.rows?.length) continue;
    if (PROTECTED_TABLES.has(rel.table)) continue;
    const rows = rel.rows.map((r) => sanitizeSnapshot(rel.table, r));
    const { error: relError } = await db().from(rel.table).insert(rows);
    if (relError) {
      throw new ApiError(409, `The ${log.metadata.label} entry was restored, but its ${rel.table} rows could not be: ${relError.message}`);
    }
  }

  // The login was disabled on delete; restoring the student should make it usable again.
  if (log.metadata.table === 'students' && snapshot.user_id) {
    await db().from('school_users').update({ status: 'active' })
      .eq('id', snapshot.user_id).eq('school_id', schoolId);
  }

  await mark(actor, 'restored', log, `Restored ${log.metadata.label}`);
  return { table: log.metadata.table, label: log.metadata.label, record_id: log.record_id };
}

export async function purgeTrashItem(req, id, { platform = false } = {}) {
  const log = await findDeletion(id, platform ? null : req.auth.schoolId);
  if (await isClosed(log.school_id, id)) throw new ApiError(409, 'This record was already restored or removed from the bin.');
  await mark(actorOf(req), 'purged', log, `Permanently removed ${log.metadata.label}`);
  return { table: log.metadata.table, label: log.metadata.label };
}

async function purgeRows(rows, actor) {
  if (!rows.length) return { purged: 0 };
  const inserts = rows.map((r) => ({
    school_id: r.school_id,
    ...actorColumns(actor),
    action: 'purged',
    module: TRASH_MODULE,
    record_id: r.record_id,
    summary: `Recycle bin emptied: ${r.metadata.label || r.metadata.table}`,
    metadata: { trashId: r.id, table: r.metadata.table },
  }));
  for (let i = 0; i < inserts.length; i += 200) {
    const { error } = await db().from('audit_logs').insert(inserts.slice(i, i + 200));
    if (error) throw new ApiError(500, error.message);
  }
  return { purged: rows.length };
}

/** Empty one school's bin (the school-admin route and the platform per-school action). */
export async function emptyTrashForSchool(schoolId, actor) {
  return purgeRows(activeRows(await loadTrashRows(schoolId)), actor);
}

/** Empty every school's bin — super admin only. */
export async function emptyPlatformTrash(actor) {
  return purgeRows(activeRows(await loadTrashRows(null)), actor);
}

export async function emptyTrash(req) {
  return emptyTrashForSchool(req.auth.schoolId, actorOf(req));
}
