import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { buildStudentPack } from '../../services/studentPack.js';
import { streamClearancePdf } from '../../services/clearanceDocument.js';

/**
 * Student clearance documents.
 *
 * An official PDF of everything the school holds on one learner — identity, class and enrolment,
 * parents and guardians, examination results with grades, attendance and the documents on file.
 * Schools issue it when a learner leaves, transfers or needs proof of enrolment.
 *
 * Gated on `students.export` (school administrators and registrars), never on plain `students.view`:
 * students and parents hold that, and this paper reads as a school-issued certificate. The record is
 * always scoped to the caller's own school, so no other tenant's learner can be reached by id.
 */
export const clearanceRouter = Router();

const uuidz = z.string().uuid();
const PURPOSES = new Set(['clearance', 'transfer', 'enrolment']);

/**
 * The school's own mark, as bytes the PDF can embed. `schools.logo_url` points at the public
 * storage bucket, so the fetch needs no credentials. A WebP logo is a real image but pdfkit has no
 * decoder for it, so it is left out of the letterhead instead of failing the whole document — the
 * paper is issued either way.
 */
async function readLogo(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    return isPng || isJpeg ? { buffer } : null;
  } catch {
    return null;
  }
}

clearanceRouter.get('/:studentId/document', requirePermission('students.export'), async (req, res, next) => {
  try {
    const { studentId } = z.object({ studentId: uuidz }).parse(req.params);
    const requested = String(req.query.purpose || 'clearance');
    const purpose = PURPOSES.has(requested) ? requested : 'clearance';

    const pack = await buildStudentPack(req.auth.schoolId, studentId, { issuedBy: req.auth.fullName });
    if (!pack.school) throw new ApiError(500, 'The school record could not be read for the document header.');
    const logo = await readLogo(pack.school.logo_url);

    await audit(req, {
      module: 'students', action: 'clearance_issued', recordId: studentId,
      summary: `Clearance document issued for ${pack.student.full_name || 'a student'} (${pack.enrolment.admission_number || 'no admission number'})`,
      metadata: { purpose, results: pack.results.length, guardians: pack.guardians.length },
    });

    streamClearancePdf(res, { pack, purpose, meta: { issued_by: req.auth.fullName }, logo });
  } catch (e) { next(e); }
});

