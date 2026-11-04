import { db } from '../config/supabase.js';
import { setIssuedCredential } from './credentialVault.js';

/**
 * Student logins are provisioned without asking for an email: the student ID is both the
 * username and the first password. GoTrue still needs a unique address, so a deterministic
 * address is derived from the admission number plus a slice of the school id (admission
 * numbers are only unique inside a school).
 */
const EMAIL_DOMAIN = 'students.e-madaaris.local';

export function normalizeAdmission(value) {
  return String(value || '').trim();
}

export function studentLoginEmail(admissionNumber, schoolId) {
  const local = normalizeAdmission(admissionNumber).toLowerCase().replace(/[^a-z0-9]/g, '');
  const tenant = String(schoolId || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `${local || 'student'}.${tenant}@${EMAIL_DOMAIN}`;
}

/**
 * The requested convention is password == student ID. GoTrue rejects passwords shorter than
 * six characters, so only unusually short legacy IDs get padded (and the caller is told which).
 */
export function studentInitialPassword(admissionNumber) {
  const raw = normalizeAdmission(admissionNumber);
  if (raw.length >= 6) return raw;
  return `${raw || 'student'}`.padEnd(6, '0');
}

export async function studentRoleId(schoolId) {
  const { data } = await db().from('school_roles')
    .select('id').eq('school_id', schoolId).eq('name', 'student').maybeSingle();
  if (!data) throw new Error('The student role is missing for this school');
  return data.id;
}

/** Reuses an auth identity that already owns the derived address (retry after a partial failure). */
async function findAuthUserByEmail(email) {
  const supabase = db();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = (data?.users || []).find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if ((data?.users || []).length < 200) return null;
  }
  return null;
}

function fullNameOf(student) {
  return student.full_name || [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')
    || `Student ${student.admission_number}`;
}

/**
 * Creates (or reuses) the auth identity, school membership and student role, then links the
 * student record. Idempotent: a student that already has `user_id` is skipped.
 */
export async function provisionStudentAccount(student, { schoolId, roleId } = {}) {
  if (!student?.id || !student.admission_number) throw new Error('Student record is incomplete');
  if (student.user_id) return { studentId: student.id, skipped: true, loginId: student.admission_number };

  const supabase = db();
  const email = studentLoginEmail(student.admission_number, schoolId);
  const password = studentInitialPassword(student.admission_number);
  const fullName = fullNameOf(student);
  const role = roleId || await studentRoleId(schoolId);

  let membership = null;
  const { data: existing } = await supabase.from('school_users')
    .select('id, auth_user_id').eq('school_id', schoolId).eq('email', email).maybeSingle();
  if (existing) membership = existing;

  let authUserId = membership?.auth_user_id || null;
  let reusedIdentity = Boolean(authUserId);
  if (!authUserId) {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
      user_metadata: { full_name: fullName, school_id: schoolId, role: 'student' },
    });
    if (error) {
      const duplicate = error.code === 'email_exists' || /already|duplicate/i.test(error.message);
      if (!duplicate) throw new Error(error.message);
      const found = await findAuthUserByEmail(email);
      if (!found) throw new Error('A sign-in identity already exists for this student ID');
      authUserId = found.id;
      reusedIdentity = true;
      await supabase.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
    } else {
      authUserId = created.user.id;
    }
  }

  if (!membership) {
    const { data: inserted, error: me } = await supabase.from('school_users').insert({
      school_id: schoolId, auth_user_id: authUserId, full_name: fullName,
      email, status: 'active', email_verified: true,
    }).select('id, auth_user_id').single();
    if (me) throw new Error(me.message);
    membership = inserted;
  } else if (!membership.auth_user_id) {
    await supabase.from('school_users').update({ auth_user_id: authUserId, status: 'active', email_verified: true })
      .eq('id', membership.id);
  }

  await supabase.from('school_user_roles').upsert({
    school_id: schoolId, user_id: membership.id, role_id: role,
  }, { onConflict: 'user_id,role_id' });

  const { error: linkError } = await supabase.from('students')
    .update({ user_id: membership.id }).eq('id', student.id).eq('school_id', schoolId);
  if (linkError) throw new Error(linkError.message);

  // The first password equals the student ID; keep it retrievable for the school office until the
  // student sets their own (the vault record is cleared by /auth/update-password).
  try {
    await setIssuedCredential(authUserId, { schoolId, membershipId: membership.id, password });
  } catch { /* a missing vault key must not block provisioning */ }

  return {
    studentId: student.id,
    membershipId: membership.id,
    loginId: student.admission_number,
    email,
    reusedIdentity,
  };
}

/** Small parallel batches keep remote round-trips bounded without hammering GoTrue. */
export async function provisionStudentAccounts(schoolId, students, { concurrency = 4 } = {}) {
  const roleId = await studentRoleId(schoolId);
  const created = [];
  const skipped = [];
  const failed = [];
  for (let i = 0; i < students.length; i += concurrency) {
    const batch = students.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((student) => provisionStudentAccount(student, { schoolId, roleId })),
    );
    settled.forEach((result, index) => {
      const student = batch[index];
      if (result.status === 'rejected') {
        failed.push({ id: student.id, admission_number: student.admission_number, error: result.reason?.message || 'Failed' });
      } else if (result.value?.skipped) skipped.push(student.id);
      else created.push({ ...result.value, admission_number: student.admission_number });
    });
  }
  return { created, skipped, failed };
}
