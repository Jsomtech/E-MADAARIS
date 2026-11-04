import { db } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects references that do not resolve inside the caller's school. Postgres enforces the
 * foreign key but not the tenant, so without this a row can point at another school's record
 * and expose it through joins.
 *
 * refs: { field: table } — field values may be a UUID or an array of UUIDs.
 */
export async function assertSchoolRefs(schoolId, payload, refs) {
  if (!refs || !schoolId) return;
  const groups = new Map();
  for (const [field, table] of Object.entries(refs)) {
    const raw = payload?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value === undefined || value === null || value === '') continue;
      if (!UUID_RE.test(String(value))) throw new ApiError(400, `Invalid reference in ${field}`);
      if (!groups.has(table)) groups.set(table, new Map());
      groups.get(table).set(String(value), field);
    }
  }
  await Promise.all([...groups].map(async ([table, ids]) => {
    const { data, error } = await db().from(table).select('id')
      .eq('school_id', schoolId).in('id', [...ids.keys()]);
    if (error) throw new ApiError(500, error.message);
    const found = new Set((data || []).map((r) => r.id));
    for (const [id, field] of ids) {
      if (!found.has(id)) throw new ApiError(400, `${field} does not belong to this school`);
    }
  }));
}
