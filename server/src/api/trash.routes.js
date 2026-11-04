import { Router } from 'express';
import { requirePermission } from '../middleware/rbac.js';
import { listTrash, restoreTrashItem, purgeTrashItem, emptyTrash } from '../services/trash.js';

/** School recycle bin: restores rows captured by the CRUD delete hook. */
export const trashRouter = Router();
const guard = requirePermission('school.edit');

trashRouter.get('/', guard, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const body = await listTrash({ schoolId: req.auth.schoolId, q: req.query.q, page, pageSize });
    res.json(body);
  } catch (e) { next(e); }
});

trashRouter.post('/empty', guard, async (req, res, next) => {
  try {
    res.json({ data: await emptyTrash(req) });
  } catch (e) { next(e); }
});

trashRouter.post('/:id/restore', guard, async (req, res, next) => {
  try {
    res.json({ data: await restoreTrashItem(req, req.params.id) });
  } catch (e) { next(e); }
});

trashRouter.delete('/:id', guard, async (req, res, next) => {
  try {
    res.json({ data: await purgeTrashItem(req, req.params.id) });
  } catch (e) { next(e); }
});
