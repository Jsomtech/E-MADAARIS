import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/supabase.js';
import { requirePermission, requirePlatform, requireSuperAdmin } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { recordDeletion } from '../services/trash.js';
import { clearTableData } from '../services/schoolData.js';
import { checkEntitlement, checkUsageLimit } from '../services/entitlement.js';
import { isPortalOnly } from '../services/scopes.js';
import { assertSchoolRefs } from '../services/tenantRefs.js';

/**
 * Resource-driven CRUD router. Keeps business logic out of route handlers while
 * enforcing: authentication (via global middleware), permission checks,
 * tenant scoping (school_id is ALWAYS server-derived), validation, subscription
 * entitlements and usage limits, and audit logging.
 *
 * def = {
 *   table, perm,                       // permission base key: `${perm}.view|create|edit|delete`
 *   scope: 'school'|'platform'|'super',
 *   fields: [...writable columns],
 *   search: [...text ilike columns],
 *   dynamicSearch: async (req) => [...columns],  // overrides `search` when the schema is optional
 *   filter: [...exact-match columns allowed in query],
 *   select, orderBy, defaultOrder='created_at.desc',
 *   schema: zod object for create (update uses .partial()),
 *   feature: 'plan feature key'        // entitlement gate on create
 *   limit: 'max_students'              // usage cap table-count on create (counts `countTable || table`)
 *   countTable,
 *   beforeCreate(payload, req), beforeUpdate(payload, req), afterCreate(row, req),
 *   softDelete: true|false,            // sets status='deleted' when softDeleteColumn given
 *   softDeleteColumn='archived',
 *   readonly: true,
 *   writeRoles: [...] optional extra permission override
 *   staffOnly: true,                   // student/parent portal roles may not read this table
 *   refs: { class_id: 'classes' }      // FK columns validated as same-school UUIDs on write
 * }
 */
export function resourceRouter(def) {
  const router = Router();
  const scope = def.scope || 'school';
  const writable = new Set(def.fields || []);
  const orderBy = def.orderBy || def.defaultOrder || 'created_at.desc';

  const guard = (permSuffix) => {
    if (scope === 'platform') return requirePlatform();
    if (scope === 'super') return requireSuperAdmin;
    // Modules whose catalogue exposes one umbrella grant (timetable.manage) accept it for
    // writes; schools seeded before that grant existed fall back to the listed admin keys.
    if (def.managePerm && permSuffix !== 'view') {
      const extra = Array.isArray(def.managePerm) ? def.managePerm : [`${def.perm}.manage`];
      return requirePermission(`${def.perm}.${permSuffix}`, ...extra);
    }
    return requirePermission(`${def.perm}.${permSuffix}`);
  };

  // Portal roles (student/parent) hold broad `.view` keys for their own pages, so tables that
  // hold school-wide data must opt out of their reads explicitly instead of relying on menus.
  const onlyStaff = (req, res, next) => (isPortalOnly(req.auth)
    ? res.status(403).json({ error: 'Not available in the student/parent portal' })
    : next());
  const readGuard = (suffix) => (def.staffOnly && scope === 'school' ? [guard(suffix), onlyStaff] : guard(suffix));

  /** Every reference must resolve to a row of this school; a foreign UUID would leak via joins. */
  const assertForeignRefs = (payload, req) => assertSchoolRefs(req.auth?.schoolId, payload, def.refs);

  /**
   * ownFilter returns either { column: value } or { $or: 'postgrest or expression' }
   * when the portal scope needs an OR (e.g. announcements: this class OR school-wide).
   */
  function applyOwnFilter(q, own) {
    for (const [col, val] of Object.entries(own || {})) {
      if (col === '$or') { if (val) q = q.or(val); continue; }
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        // PostgREST rejects an empty `in` list; match nothing instead of widening the scope.
        q = val.length ? q.in(col, val) : q.eq(col, '00000000-0000-0000-0000-000000000000');
      } else {
        q = q.eq(col, val);
      }
    }
    return q;
  }

  function scopedSelect(query, withCount) {
    return db().from(def.table).select(def.select || '*', withCount ? { count: 'exact' } : undefined);
  }

  // LIST — server-side pagination + search + filters
  router.get('/', readGuard('view'), async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
      let q = scopedSelect(true);
      if (scope === 'school') q = q.eq('school_id', req.auth.schoolId);
      if (def.ownFilter) q = applyOwnFilter(q, await def.ownFilter(req));
      // Must stay synchronous: awaiting a PostgREST builder resolves the request itself.
      if (def.modifyQuery) q = def.modifyQuery(q, req) || q;
      for (const f of def.filter || []) {
        if (req.query[f] !== undefined && req.query[f] !== '') q = q.eq(f, req.query[f]);
      }
      if (req.query.q) {
        const searchCols = def.dynamicSearch ? await def.dynamicSearch(req) : def.search;
        if (searchCols?.length) {
          const term = `%${sanitizeSearch(req.query.q)}%`;
          q = q.or(searchCols.map((c) => `${c}.ilike.${term}`).join(','));
        }
      }
      const { data, count, error } = await q
        .order(orderBy.split('.')[0], { ascending: !orderBy.endsWith('.desc') })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw new ApiError(500, error.message);
      // Remote PostgREST occasionally omits the count while still returning rows; never report 0-of-N.
      res.json({ data: data || [], total: count ?? (data || []).length, page, pageSize });
    } catch (e) { next(e); }
  });

  router.get('/:id', readGuard('view'), async (req, res, next) => {
    try {
      let q = scopedSelect().eq('id', req.params.id);
      if (scope === 'school') q = q.eq('school_id', req.auth.schoolId);
      if (def.ownFilter) q = applyOwnFilter(q, await def.ownFilter(req));
      const { data, error } = await q.maybeSingle();
      if (error) throw new ApiError(500, error.message);
      if (!data) throw new ApiError(404, `${def.table} not found`);
      res.json({ data });
    } catch (e) { next(e); }
  });

  if (!def.readonly) {
    // CREATE
    router.post('/', guard('create'), async (req, res, next) => {
      try {
        if (def.feature) {
          const ent = await checkEntitlement(req.auth, def.feature);
          if (!ent.ok) throw new ApiError(ent.status, ent.error);
        }
        if (def.limit && scope === 'school') {
          const lim = await checkUsageLimit(req.auth, def.countTable || def.table, def.limit);
          if (!lim.ok) throw new ApiError(lim.status, lim.error);
        }
        let payload = def.schema ? def.schema.parse(req.body) : pick(req.body, writable);
        if (def.beforeCreate) payload = await def.beforeCreate(payload, req) || payload;
        await assertForeignRefs(payload, req);
        if (scope === 'school') payload.school_id = req.auth.schoolId; // server-derived; never trust body
        const { data, error } = await db().from(def.table).insert(payload).select().single();
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, translatePgError(error));
        if (def.afterCreate) await def.afterCreate(data, req);
        await audit(req, { module: def.auditModule || def.perm, action: 'created', recordId: data.id, summary: data[def.search?.[0]] || data.id });
        res.status(201).json({ data });
      } catch (e) { next(e); }
    });

    // UPDATE
    router.patch('/:id', guard('edit'), async (req, res, next) => {
      try {
        let payload = def.schema ? def.schema.partial().parse(req.body) : pick(req.body, writable);
        delete payload.school_id;
        if (def.beforeUpdate) payload = await def.beforeUpdate(payload, req) || payload;
        if (!Object.keys(payload).length) throw new ApiError(400, 'No valid fields to update');
        await assertForeignRefs(payload, req);
        let q = db().from(def.table).update(payload).eq('id', req.params.id);
        if (scope === 'school') q = q.eq('school_id', req.auth.schoolId);
        const { data, error } = await q.select().maybeSingle();
        if (error) throw new ApiError(500, translatePgError(error));
        if (!data) throw new ApiError(404, `${def.table} not found`);
        await audit(req, { module: def.auditModule || def.perm, action: 'updated', recordId: data.id });
        res.json({ data });
      } catch (e) { next(e); }
    });

    // DELETE
    router.delete('/:id', guard('delete'), async (req, res, next) => {
      try {
        const id = req.params.id;
        let q = db().from(def.table);
        if (def.softDelete) q = q.update({ [def.softDeleteColumn || 'status']: 'deleted' });
        else q = q.delete();
        q = q.eq('id', id);
        if (scope === 'school') q = q.eq('school_id', req.auth.schoolId);
        const { data, error } = await q.select().maybeSingle();
        if (error) throw new ApiError(500, error.message);
        if (!data) throw new ApiError(404, `${def.table} not found`);
        if (def.afterDelete) await def.afterDelete(data, req);
        if (def.softDelete) {
          await audit(req, { module: def.auditModule || def.perm, action: 'archived', recordId: id });
        } else {
          // The snapshot is what makes the recycle bin possible; see services/trash.js.
          await recordDeletion(req, { table: def.table, row: data, module: def.auditModule || def.perm });
        }
        res.json({ data: def.softDelete ? data : { deleted: true } });
      } catch (e) { next(e); }
    });

    // DELETE ALL — wipe one section. The rows (and anything a cascade removes with them) are
    // snapshotted into the recycle bin first, so a single restore click brings the section back.
    router.post('/delete-all', guard('delete'), async (req, res, next) => {
      try {
        if (scope !== 'school') throw new ApiError(400, 'Bulk delete is only available inside a school');
        if (def.softDelete) throw new ApiError(400, 'This section does not support bulk delete');
        const { confirm } = z.object({ confirm: z.string().min(1).max(32) }).parse(req.body || {});
        if (confirm.trim().toUpperCase() !== 'DELETE ALL') {
          throw new ApiError(400, 'Type “DELETE ALL” to confirm this bulk delete.');
        }
        const result = await clearTableData(def.table, req.auth.schoolId, {
          actor: { userId: req.auth.userId, scope: req.auth.type || 'school' },
          label: def.clearLabel || def.auditModule || def.perm,
          module: def.auditModule || def.perm,
        });
        if (result.rows) {
          await audit(req, {
            module: def.auditModule || def.perm, action: 'purged', recordId: null,
            summary: `Deleted all ${result.rows} ${def.table} rows in bulk`,
            metadata: { snapshotId: result.snapshotId },
          });
        }
        res.json({ data: result });
      } catch (e) { next(e); }
    });
  }

  return router;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Strip PostgREST filter syntax so a `q` value cannot add predicates to an `.or()` filter. */
export function sanitizeSearch(value) {
  return String(value ?? '').replace(/[%_,()\\"']/g, ' ').trim();
}

export function translatePgError(error) {
  if (error.code === '23505') return `Duplicate value: ${error.message.split('DETAIL')[0]}`;
  if (error.code === '23503') return 'Related record reference is invalid';
  if (error.code === '23514') return 'Value violates a database constraint';
  return error.message;
}

/** Shared zod helpers */
export const uuid = z.string().uuid();
export const optionalId = z.string().uuid().nullable().optional();
export const trimStr = (max = 255) => z.string().trim().max(max);
export const money = z.coerce.number().min(0);
