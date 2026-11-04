import { randomUUID } from 'node:crypto';
import { db } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { TRASH_MODULE, sanitizeSnapshot } from './trash.js';
import { CLEAR_TABLES, PARENT_SCOPED_TABLES } from './schoolTables.js';

/**
 * Business data wiped by the danger-zone "clear data" action.
 * Accounts, roles, subscription and school profile are deliberately kept so the
 * administrator can still sign in and start over.
 *
 * Clearing is reversible: every row is snapshotted into audit_logs as one bulk trash
 * entry before anything is deleted, so the recycle bin can put the school back.
 */

const PAGE = 1000;

/** PostgREST caps one response at its max-rows setting, so walk the table in pages. */
async function readAllRows(table, schoolId) {
  const rows = [];
  let expected = null;
  for (let from = 0; ;) {
    const { data, error, count } = await db().from(table).select('*', { count: 'exact' })
      .eq('school_id', schoolId).order('id').range(from, from + PAGE - 1);
    if (error) return { error };
    if (expected === null) expected = count ?? null;
    const batch = data || [];
    rows.push(...batch);
    if (!batch.length) break;
    from += batch.length;
    // `count` catches servers whose max-rows is below PAGE, where "short batch" means truncated.
    if (expected !== null ? rows.length >= expected : batch.length < PAGE) break;
  }
  return { rows };
}

/** PostgREST puts an `in` list in the request URL, so parent ids are walked a block at a time. */
const ID_BLOCK = 100;

/** The parent rows this school owns — the only handle a parent-scoped child table has. */
async function parentIds(table, schoolId) {
  const scope = PARENT_SCOPED_TABLES[table];
  const { data, error } = await db().from(scope.parent).select('id').eq('school_id', schoolId)
    .order('id').limit(10000);
  if (error) return { error };
  return { ids: (data || []).map((row) => row.id) };
}

/** Rows of a child table that belongs to the school through a parent, optionally capped. */
export async function readScopedRows(table, schoolId, { limit = null } = {}) {
  const scope = PARENT_SCOPED_TABLES[table];
  const { ids, error } = await parentIds(table, schoolId);
  if (error) return { error };
  const cap = limit ?? Infinity;
  const rows = [];
  let truncated = false;
  for (let i = 0; i < ids.length && !truncated; i += ID_BLOCK) {
    let from = 0;
    for (;;) {
      const { data, error: readError } = await db().from(table).select('*')
        .in(scope.column, ids.slice(i, i + ID_BLOCK)).order('id').range(from, from + PAGE - 1);
      if (readError) return { error: readError };
      const batch = data || [];
      if (rows.length + batch.length > cap) {
        rows.push(...batch.slice(0, Math.max(0, cap - rows.length)));
        truncated = true;
        break;
      }
      rows.push(...batch);
      if (!batch.length) break;
      from += batch.length;
    }
  }
  return { rows, truncated };
}

/** Every row of one tenant table, whether it carries a school id or hangs off a parent. */
export async function readSchoolRows(table, schoolId) {
  if (PARENT_SCOPED_TABLES[table]) return readScopedRows(table, schoolId);
  return readAllRows(table, schoolId);
}

/** Delete this school's rows in one table, keeping the 42P01 answer the callers skip on. */
export async function deleteSchoolRows(table, schoolId) {
  if (!PARENT_SCOPED_TABLES[table]) return db().from(table).delete().eq('school_id', schoolId);
  const scope = PARENT_SCOPED_TABLES[table];
  const { ids, error } = await parentIds(table, schoolId);
  if (error) return { error };
  for (let i = 0; i < ids.length; i += ID_BLOCK) {
    const { error: deleteError } = await db().from(table).delete()
      .in(scope.column, ids.slice(i, i + ID_BLOCK));
    if (deleteError) return { error: deleteError };
  }
  return { error: null };
}

async function recordBulkSnapshot(schoolId, bulk, rowCount, actor = {}, { label, table = '__all__', module = 'school' } = {}) {
  const id = randomUUID();
  const labelText = label || `All school data (${rowCount} rows)`;
  const { error } = await db().from('audit_logs').insert({
    school_id: schoolId,
    user_id: actor.userId || null,
    user_scope: actor.scope || (actor.userId ? 'school' : 'system'),
    action: 'deleted',
    module: TRASH_MODULE,
    record_id: id,
    summary: `${labelText} · cleared`,
    metadata: {
      trash: true, table, module,
      label: labelText, rows: rowCount, bulk,
    },
  });
  if (error) throw new ApiError(500, `Could not snapshot the data, so nothing was deleted: ${error.message}`);
  return id;
}

/**
 * Read every tenant table into one bulk snapshot map (reused by clear-all and section clears).
 *
 * Eighty-two tables against a hosted database is eighty-two round trips, which one at a time is
 * longer than any browser is willing to wait. The reads are independent, so they run twelve at a
 * time and a clear finishes in seconds instead of minutes.
 */
const READ_BATCH = 12;

async function collectSchoolSnapshot(schoolId) {
  let rowCount = 0;
  const bulk = {};
  for (let i = 0; i < CLEAR_TABLES.length; i += READ_BATCH) {
    const batch = CLEAR_TABLES.slice(i, i + READ_BATCH);
    const results = await Promise.all(batch.map(async (table) => ({ table, ...(await readSchoolRows(table, schoolId)) })));
    for (const result of results) {
      // 42P01 = optional migration not applied: nothing to read or clear there.
      if (result.error) {
        if (result.error.code === '42P01') continue;
        throw new ApiError(500, `Could not snapshot ${result.table} before clearing: ${result.error.message}`);
      }
      if (result.rows.length) {
        bulk[result.table] = result.rows.map((row) => sanitizeSnapshot(result.table, row));
        rowCount += result.rows.length;
      }
    }
  }
  return { bulk, rowCount };
}

/** Deletes every business row for a school, after snapshotting them for the recycle bin. */
export async function clearSchoolData(schoolId, { actor = {}, snapshot = true } = {}) {
  const { bulk, rowCount } = snapshot
    ? await collectSchoolSnapshot(schoolId)
    : { bulk: {}, rowCount: 0 };

  // Never delete without a snapshot: an unrecoverable wipe defeats the recycle bin.
  const snapshotId = snapshot && rowCount
    ? await recordBulkSnapshot(schoolId, bulk, rowCount, actor, {
      label: `All school data (${rowCount} rows)`,
    })
    : null;

  // The acting administrator's own login is part of the wipe; the client signs them out.
  const selfRemoved = Boolean(actor.scope === 'school' && actor.userId
    && bulk.school_users?.some((row) => row.id === actor.userId));

  let cleared = 0;
  const failures = [];
  // A table the snapshot found empty is already clear, so it is not worth a round trip. The
  // children-before-parents order of CLEAR_TABLES still decides which tables are visited first.
  const targets = snapshot
    ? CLEAR_TABLES.filter((table) => bulk[table]?.length)
    : CLEAR_TABLES;
  for (const table of targets) {
    const { error } = await deleteSchoolRows(table, schoolId);
    if (error && error.code !== '42P01') {
      failures.push(`${table}: ${error.message}`);
      continue;
    }
    cleared += 1;
  }
  if (failures.length) {
    throw new ApiError(500, `Some tables could not be cleared — ${failures.slice(0, 3).join('; ')}`);
  }
  return { tables: cleared, rows: rowCount, snapshotId, users: bulk.school_users?.length || 0, selfRemoved };
}

/**
 * Delete every row of one section (students, classes, announcements…). Deleting a parent row
 * cascades in the database, so the whole school is snapshotted first: restoring the bin entry
 * puts back both the section and anything its deletion cascaded to.
 */
export async function clearTableData(table, schoolId, { actor = {}, label, module } = {}) {
  if (!CLEAR_TABLES.includes(table)) throw new ApiError(400, 'This section cannot be cleared in bulk');

  const read = await readSchoolRows(table, schoolId);
  if (read.error) throw new ApiError(500, `Could not read ${table} before clearing: ${read.error.message}`);
  const rows = read.rows;
  if (!rows.length) return { table, rows: 0, snapshotId: null };

  const { bulk } = await collectSchoolSnapshot(schoolId);
  const labelText = `${label || table} (${rows.length} rows)`;
  const snapshotId = await recordBulkSnapshot(schoolId, bulk, rows.length, actor, {
    label: labelText, table, module: module || 'school',
  });

  const { error } = await deleteSchoolRows(table, schoolId);
  if (error) {
    // Roll the orphan snapshot back; nothing was deleted, so nothing belongs in the bin.
    await db().from('audit_logs').delete().eq('id', snapshotId).eq('module', TRASH_MODULE);
    if (error.code === '23503') {
      throw new ApiError(409, `These ${String(label || table).toLowerCase()} are still referenced by other records. Delete the dependent records first, or use “Delete all school data”.`);
    }
    throw new ApiError(500, error.message);
  }
  return { table, rows: rows.length, snapshotId };
}
