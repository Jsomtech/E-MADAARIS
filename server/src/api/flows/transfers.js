import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  transfersEnabled, transferDirectory, createTransfer, listForSchool,
  decideTransfer, cancelTransfer, getTransfer,
} from '../../services/transfers.js';

export const transfersRouter = Router();

// Every route is school-administrator only; the service re-checks the role so menu hiding is
// never the actual control.
transfersRouter.use(requirePermission('students.view', 'students.edit', 'school.view'));

transfersRouter.get('/enabled', async (req, res, next) => {
  try { res.json({ data: { enabled: await transfersEnabled() } }); } catch (e) { next(e); }
});

/** Other E-MADAARIS schools the admin may transfer a student to. */
transfersRouter.get('/directory', async (req, res, next) => {
  try {
    const schools = await transferDirectory(req.auth.schoolId, req.query.q || '');
    res.json({ data: schools });
  } catch (e) { next(e); }
});

/** The sending school's own active students, for the transfer picker. */
transfersRouter.get('/students', async (req, res, next) => {
  try {
    const term = String(req.query.q || '').trim();
    let q = requireDb().from('students')
      .select('id, admission_number, first_name, middle_name, last_name, full_name, status, classes(name)')
      .eq('school_id', req.auth.schoolId)
      .order('first_name')
      .limit(200);
    if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,admission_number.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [] });
  } catch (e) { next(e); }
});

transfersRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    res.json(await listForSchool(req, { status }));
  } catch (e) { next(e); }
});

transfersRouter.get('/:id', async (req, res, next) => {
  try { res.json({ data: await getTransfer(req, req.params.id) }); } catch (e) { next(e); }
});

transfersRouter.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      student_id: z.string().uuid(),
      to_school_id: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
    }).parse(req.body || {});
    const data = await createTransfer(req, body);
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

transfersRouter.post('/:id/decide', async (req, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body || {});
    const data = await decideTransfer(req, req.params.id, body);
    res.json({ data });
  } catch (e) { next(e); }
});

transfersRouter.post('/:id/cancel', async (req, res, next) => {
  try { res.json({ data: await cancelTransfer(req, req.params.id) }); } catch (e) { next(e); }
});
