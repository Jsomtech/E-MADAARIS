import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { audit } from './audit.js';
import { nextAdmissionNumber } from './scopes.js';
import { provisionStudentAccount, studentRoleId } from './studentAccounts.js';
import { buildStudentPack, packFromLegacyDossier } from './studentPack.js';

/**
 * Cross-school student transfers.
 *
 * A student's rows are welded to their school by non-cascading foreign keys (classes, exam
 * sessions, attendance sessions all belong to the sending tenant), so a live row cannot simply
 * be re-pointed at another school. Instead the sending school shares a pack — profile, class and
 * enrolment, guardians, documents, attendance, every examination result with its grade and the fee
 * position — which the receiving school reads before it decides. On approval the learner is
 * re-admitted with a fresh admission number and the pack is kept on the new record.
 *
 * Only a school administrator of the sending school can start or cancel a transfer, and only a
 * school administrator of the receiving school can approve or reject it. The super admin can read
 * every transfer across the platform.
 */

const MISSING_TABLE = /42P01|could not find the table|does not exist|relation .* does not exist/i;

/** True once migration 0020 has created student_transfers; probed once per process. */
let transfersReady = null;
export async function transfersEnabled() {
  if (transfersReady !== null) return transfersReady;
  const { error } = await requireDb().from('student_transfers').select('id').limit(1);
  if (!error) { transfersReady = true; return true; }
  if (MISSING_TABLE.test(error.message || '') || error.code === '42P01') { transfersReady = false; return false; }
  return true; // unknown failure (network/auth): assume present rather than hide the feature
}

function assertReady(ready) {
  if (!ready) {
    throw new ApiError(501, 'Student transfers are not enabled yet. Ask the platform owner to run migration 0020 in Supabase.');
  }
}

/**
 * The class, section and academic year a receiving school uses for a transferred learner.
 * Ids never cross tenants, so the match is made on names; anything without an exact match is
 * left blank for the receiving administrator to set.
 */
async function matchDestinationPlacement(toSchoolId, enrolment) {
  const db = requireDb();
  const placement = { class_id: null, section_id: null, academic_year_id: null };
  const wanted = String(enrolment?.class_name || '').trim();
  if (wanted) {
    const { data: found } = await db.from('classes').select('id').eq('school_id', toSchoolId).ilike('name', wanted).limit(1);
    if (found?.[0]) {
      placement.class_id = found[0].id;
      const wantedSection = String(enrolment?.section_name || '').trim();
      if (wantedSection) {
        const { data: section } = await db.from('sections').select('id').eq('school_id', toSchoolId)
          .eq('class_id', found[0].id).ilike('name', wantedSection).limit(1);
        if (section?.[0]) placement.section_id = section[0].id;
      }
    }
  }
  const { data: year } = await db.from('academic_years').select('id').eq('school_id', toSchoolId)
    .eq('is_current', true).order('start_date', { ascending: false }).limit(1);
  if (year?.[0]) placement.academic_year_id = year[0].id;
  return placement;
}

async function loadSchool(schoolId) {
  const { data, error } = await requireDb().from('schools')
    .select('id, school_name, city, country, registration_number, status')
    .eq('id', schoolId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  return data;
}

function requireSchoolAdmin(req) {
  const a = req.auth;
  if (!a || a.type !== 'school' || !a.schoolId) throw new ApiError(403, 'School membership required');
  if (!a.roles.includes('school_admin')) {
    throw new ApiError(403, 'Only a school administrator can manage student transfers.');
  }
  return a;
}

/** Schools a sending admin may transfer to: every other active E-MADAARIS tenant. */
export async function transferDirectory(schoolId, query = '') {
  const db = requireDb();
  let q = db.from('schools')
    .select('id, school_name, city, country, registration_number, status')
    .neq('id', schoolId)
    .in('status', ['trial', 'active', 'pending_approval'])
    .order('school_name')
    .limit(50);
  const term = String(query || '').trim();
  if (term) q = q.or(`school_name.ilike.%${term}%,registration_number.ilike.%${term}%,city.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

/** Create a transfer request. Only the sending school's administrator. */
export async function createTransfer(req, { student_id, to_school_id, reason }) {
  const ready = await transfersEnabled();
  assertReady(ready);
  const auth = requireSchoolAdmin(req);

  if (!student_id || !to_school_id) throw new ApiError(400, 'Choose the student and the destination school.');
  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 3) throw new ApiError(400, 'Give a reason for the transfer (at least 3 characters).');
  if (to_school_id === auth.schoolId) throw new ApiError(400, 'The destination must be a different school.');

  const db = requireDb();
  const { data: student, error: studentError } = await db.from('students')
    .select('id, first_name, middle_name, last_name, full_name, admission_number, status')
    .eq('id', student_id).eq('school_id', auth.schoolId).maybeSingle();
  if (studentError) throw new ApiError(500, studentError.message);
  if (!student) throw new ApiError(404, 'That student is not part of your school.');
  if (student.status === 'transferred') throw new ApiError(409, 'That student has already been transferred.');

  const destination = await loadSchool(to_school_id);
  if (!destination) throw new ApiError(404, 'The destination school was not found.');
  if (destination.status === 'suspended' || destination.status === 'archived') {
    throw new ApiError(409, 'That school cannot receive transfers right now.');
  }

  // One open request per student: a second attempt would double-admit them on approval.
  const { data: open } = await db.from('student_transfers')
    .select('id').eq('student_id', student_id).eq('from_school_id', auth.schoolId).eq('status', 'requested').maybeSingle();
  if (open) throw new ApiError(409, 'A transfer request for this student is already waiting for the destination school.');

  const from = await loadSchool(auth.schoolId);
  const { data, error } = await db.from('student_transfers').insert({
    student_id,
    from_school_id: auth.schoolId,
    to_school_id,
    student_name: student.full_name || [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' '),
    admission_number: student.admission_number,
    reason: trimmedReason,
    status: 'requested',
    requested_by: auth.userId || null,
    requested_by_name: auth.fullName || null,
    payload: { from_school_name: from?.school_name || null, to_school_name: destination.school_name },
  }).select('*').single();
  if (error) throw new ApiError(500, error.message);

  await audit(req, {
    module: 'transfers', action: 'requested', recordId: data.id,
    summary: `Transfer requested for ${data.student_name} → ${destination.school_name}`,
    metadata: { student_id, to_school_id, reason: trimmedReason },
  });
  return data;
}

/** Transfers visible to one school: those it sent and those it is being asked to receive. */
export async function listForSchool(req, { status } = {}) {
  const ready = await transfersEnabled();
  if (!ready) return { data: [], outgoing: [], incoming: [] };
  const auth = requireSchoolAdmin(req);
  const db = requireDb();
  let q = db.from('student_transfers').select('*')
    .or(`from_school_id.eq.${auth.schoolId},to_school_id.eq.${auth.schoolId}`)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  const rows = data || [];
  return {
    data: rows,
    outgoing: rows.filter((r) => r.from_school_id === auth.schoolId),
    incoming: rows.filter((r) => r.to_school_id === auth.schoolId),
  };
}

/** Every transfer on the platform (super admin oversight). */
export async function listAll(req, { status, page = 1, pageSize = 50 } = {}) {
  const ready = await transfersEnabled();
  assertReady(ready);
  const db = requireDb();
  let q = db.from('student_transfers').select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) throw new ApiError(500, error.message);
  return { data: data || [], total: count || 0, page, pageSize };
}

async function loadTransfer(id) {
  const { data, error } = await requireDb().from('student_transfers').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'That transfer request was not found.');
  return data;
}

/**
 * Approve or reject a transfer. Only the receiving school's administrator decides.
 * Approving re-admits the student at the destination with a fresh login, stores the shared
 * pack, then clears the student (and their login) from the sending school.
 */
export async function decideTransfer(req, id, { decision, note }) {
  const ready = await transfersEnabled();
  assertReady(ready);
  const auth = requireSchoolAdmin(req);
  const transfer = await loadTransfer(id);

  if (transfer.status !== 'requested') throw new ApiError(409, `This transfer is already ${transfer.status}.`);

  if (decision === 'reject') {
    if (transfer.to_school_id !== auth.schoolId) throw new ApiError(403, 'Only the destination school can reject this request.');
    const { data, error } = await requireDb().from('student_transfers').update({
      status: 'rejected', decided_by: auth.userId || null, decided_by_name: auth.fullName || null,
      decision_note: String(note || '').trim() || null,
    }).eq('id', id).select('*').single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'transfers', action: 'rejected', recordId: id, summary: `Transfer for ${transfer.student_name} rejected`, metadata: { note } });
    return data;
  }

  if (decision !== 'approve') throw new ApiError(400, 'Decision must be "approve" or "reject".');
  if (transfer.to_school_id !== auth.schoolId) throw new ApiError(403, 'Only the destination school can approve this request.');
  if (!transfer.student_id) throw new ApiError(409, 'The sending school has already cleared this student, so there is nothing left to transfer.');

  const db = requireDb();
  const fromSchoolId = transfer.from_school_id;
  const toSchoolId = transfer.to_school_id;

  // 1. Capture everything while the source rows still exist.
  const pack = await buildStudentPack(fromSchoolId, transfer.student_id, { issuedBy: transfer.requested_by_name || null });

  const destination = await loadSchool(toSchoolId);
  const target = pack.student;
  const placement = await matchDestinationPlacement(toSchoolId, pack.enrolment);

  // 2. Re-admit at the destination: fresh admission number, the same class and section by name.
  const admission_number = await nextAdmissionNumber(toSchoolId, placement.academic_year_id, { schoolName: destination?.school_name });
  let newStudent;
  try {
    const { data, error } = await db.from('students').insert({
      school_id: toSchoolId,
      admission_number,
      first_name: target.first_name,
      middle_name: target.middle_name || null,
      last_name: target.last_name || null,
      gender: target.gender || null,
      date_of_birth: target.date_of_birth || null,
      photo_url: target.photo_url || null,
      admission_date: new Date().toISOString().slice(0, 10),
      address: target.address || null,
      emergency_contact: target.emergency_contact || null,
      status: 'active',
      class_id: placement.class_id,
      section_id: placement.section_id,
      academic_year_id: placement.academic_year_id,
      transfer_history: {
        from_school_id: fromSchoolId,
        from_school_name: transfer.payload?.from_school_name || null,
        transfer_id: transfer.id,
        reason: transfer.reason,
        previous_admission_number: transfer.admission_number,
        previous_academic_year: pack.enrolment.academic_year,
        previous_class: pack.enrolment.class_name,
        previous_section: pack.enrolment.section_name,
        pack,
      },
    }).select('*').single();
    if (error) throw error;
    newStudent = data;
  } catch (err) {
    throw new ApiError(500, `Could not admit the student at your school: ${err.message}`);
  }
  // previous_school is the sending school's name (set after insert so a column error is isolated).
  const fromName = transfer.payload?.from_school_name || null;
  if (fromName) await db.from('students').update({ previous_school: fromName }).eq('id', newStudent.id);

  // 3. Give the transferred student a login at the destination (best effort).
  let loginNote = null;
  try {
    const roleId = await studentRoleId(toSchoolId);
    await provisionStudentAccount({ ...newStudent, user_id: null }, { schoolId: toSchoolId, roleId });
  } catch (err) {
    loginNote = `Student admitted, but the login could not be created automatically: ${err.message}`;
  }

  // 4. Mark the transfer completed with the shared pack and the new record id.
  const { data: completed, error: completeError } = await db.from('student_transfers').update({
    status: 'completed',
    decided_by: auth.userId || null,
    decided_by_name: auth.fullName || null,
    decision_note: [String(note || '').trim(), loginNote].filter(Boolean).join(' · ') || null,
    new_student_id: newStudent.id,
    payload: { ...(transfer.payload || {}), pack, to_school_name: destination?.school_name || null },
    completed_at: new Date().toISOString(),
  }).eq('id', id).select('*').single();
  if (completeError) throw new ApiError(500, completeError.message);

  // 5. Clear the student from the sending school (their login first, then the record cascades).
  const sourceStudent = await db.from('students').select('user_id').eq('id', transfer.student_id).maybeSingle();
  const loginId = sourceStudent.data?.user_id || null;
  if (loginId) {
    await db.from('school_user_roles').delete().eq('school_id', fromSchoolId).eq('user_id', loginId);
    await db.from('school_users').delete().eq('id', loginId).eq('school_id', fromSchoolId);
  }
  const { error: deleteError } = await db.from('students').delete()
    .eq('id', transfer.student_id).eq('school_id', fromSchoolId);
  if (deleteError) {
    // The student is already admitted at the destination; report the incomplete cleanup loudly.
    await audit({ auth: { type: 'school', schoolId: fromSchoolId, userId: auth.userId } }, {
      module: 'transfers', action: 'cleanup_failed', recordId: id, status: 'error',
      summary: `Transfer completed but the sending school could not clear ${transfer.student_name}: ${deleteError.message}`,
    });
  }

  // 6. Audit both tenants: the receiving admin acted, the sending school lost the student.
  await audit(req, {
    module: 'transfers', action: 'approved', recordId: id,
    summary: `${transfer.student_name} admitted from ${fromName || 'another school'} as ${admission_number}`,
    metadata: { new_student_id: newStudent.id, from_school_id: fromSchoolId },
  });
  await audit({ auth: { type: 'school', schoolId: fromSchoolId, userId: transfer.requested_by || null } }, {
    module: 'transfers', action: 'student_transferred_out', recordId: id,
    summary: `${transfer.student_name} transferred to ${destination?.school_name || 'another school'} and cleared from this school`,
    metadata: { to_school_id: toSchoolId, transfer_id: id },
  });

  return { ...completed, new_admission_number: admission_number, login_note: loginNote };
}

/** Cancel a request that has not been decided. Only the sending school's administrator. */
export async function cancelTransfer(req, id) {
  const ready = await transfersEnabled();
  assertReady(ready);
  const auth = requireSchoolAdmin(req);
  const transfer = await loadTransfer(id);
  if (transfer.from_school_id !== auth.schoolId) throw new ApiError(403, 'Only the sending school can cancel this request.');
  if (transfer.status !== 'requested') throw new ApiError(409, `This transfer is already ${transfer.status}.`);
  const { data, error } = await requireDb().from('student_transfers').update({
    status: 'cancelled', decided_by: auth.userId || null, decided_by_name: auth.fullName || null,
  }).eq('id', id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  await audit(req, { module: 'transfers', action: 'cancelled', recordId: id, summary: `Transfer for ${transfer.student_name} cancelled` });
  return data;
}

/** Full transfer record including the shared pack, for the two schools involved or the super admin. */
export async function getTransfer(req, id) {
  const ready = await transfersEnabled();
  assertReady(ready);
  const transfer = await loadTransfer(id);
  const auth = req.auth;
  const isPlatform = auth.type === 'platform';
  const involved = auth.type === 'school' && (transfer.from_school_id === auth.schoolId || transfer.to_school_id === auth.schoolId);
  if (!isPlatform && !involved) throw new ApiError(403, 'You cannot view this transfer.');

  // A decision needs the learner's class, marks and fee position up front, so an undecided
  // request is read live from the sending school; a completed one keeps its stored snapshot.
  let pack = transfer.payload?.pack || null;
  if (!pack && transfer.status === 'requested' && transfer.student_id) {
    try {
      pack = await buildStudentPack(transfer.from_school_id, transfer.student_id, { issuedBy: transfer.requested_by_name || null });
    } catch {
      pack = null; // the sending school cleared the record while the request was open
    }
  }
  if (!pack && transfer.payload?.dossier) {
    pack = packFromLegacyDossier(transfer.payload.dossier, { issuedBy: transfer.requested_by_name || null });
    if (pack) {
      // The older snapshot stripped the identity columns; the transfer row still carries them.
      pack.enrolment.admission_number ||= transfer.admission_number || null;
      pack.student.full_name ||= transfer.student_name || null;
    }
  }
  return { ...transfer, payload: { ...(transfer.payload || {}), pack } };
}
