import { db } from '../config/supabase.js';
import { env } from '../config/env.js';
import { sendPushToUsers } from './fcm.js';
import { sendMail } from './mailer.js';

/**
 * The one way a school event becomes a message.
 *
 * Every writer goes through notify(): it drops anyone who switched the category off in their
 * preferences, stores the in-app row (the bell and /school/notifications read this table), then
 * pushes to that person's registered browsers and mails the ones who asked for email. The push and
 * mail legs run in the background — an inbox row is written first, so a slow or unconfigured provider
 * can never make the school action that caused it fail.
 */

const INSERT_BATCH = 200;
const QUERY_CHUNK = 200;
/** A whole-school notice to thousands of accounts is a job, not a request; the cap keeps one click
 *  from turning into tens of thousands of rows the tenant will never read. */
const MAX_AUDIENCE = 3000;

export const NOTIFICATION_CATEGORIES = [
  'general', 'account', 'attendance', 'timetable', 'academic', 'results',
  'finance', 'announcements', 'elections', 'support',
];

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Recipients who still want this category, plus those whose preference row asks for email too.
 *  One read per event: the preferences table only ever holds rows for people who changed a switch,
 *  so it is small and filtering it locally beats chunking the audience through PostgREST. */
async function applyPreferences(supabase, schoolId, userIds, category) {
  if (!schoolId) return { allowed: userIds, suppressed: 0, emailTo: new Set() };
  const optedOut = new Set();
  const emailOptedIn = new Set();
  const { data, error } = await supabase.from('notification_preferences')
    .select('school_user_id, in_app, email').eq('school_id', schoolId).eq('category', category).limit(5000);
  if (!error) {
    for (const row of data || []) {
      if (row.in_app === false) optedOut.add(row.school_user_id);
      else if (row.email === true) emailOptedIn.add(row.school_user_id);
    }
  }
  return {
    allowed: userIds.filter((id) => !optedOut.has(id)),
    suppressed: optedOut.size,
    emailTo: emailOptedIn,
  };
}

/**
 * @param {object} options schoolId, scope ('school'|'platform'), category, title, body, link,
 *                         icon, email (honour the per-category email preference, default true)
 * @returns {{ inserted: number, suppressed: number, truncated: boolean, push: Promise, email: Promise }}
 */
export async function notify(supabase, userIds, {
  schoolId = null, scope = 'school', category = 'general',
  title, body = null, link = null, icon = null, email = true,
} = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const summary = { inserted: 0, suppressed: 0, truncated: false, push: Promise.resolve(null), email: Promise.resolve(null) };
  if (!ids.length || !title) return summary;
  const audience = ids.slice(0, MAX_AUDIENCE);
  summary.truncated = ids.length > MAX_AUDIENCE;

  const prefs = await applyPreferences(supabase, scope === 'school' ? schoolId : null, audience, category);
  summary.suppressed = prefs.suppressed;
  if (!prefs.allowed.length) return summary;

  const rows = prefs.allowed.map((recipient_user_id) => ({
    school_id: scope === 'school' ? schoolId : null,
    recipient_user_id,
    recipient_scope: scope,
    category,
    title,
    body,
    link,
    is_read: false,
  }));
  for (const part of chunk(rows, INSERT_BATCH)) {
    const { error } = await supabase.from('notifications').insert(part);
    if (error) {
      return { ...summary, inserted: 0, suppressed: 0, error: error.message, push: Promise.resolve(null), email: Promise.resolve(null) };
    }
  }
  summary.inserted = rows.length;

  summary.push = sendPushToUsers(prefs.allowed, {
    scope, title, body: body || '', link: link || '/', tag: category, icon: icon || undefined,
  }).catch((error) => ({ attempted: 0, sent: 0, failed: 0, skipped: 'push_threw', error: error.message }));

  if (email && prefs.emailTo.size) {
    const mailTo = prefs.allowed.filter((id) => prefs.emailTo.has(id));
    summary.email = sendCategoryMails(supabase, schoolId, mailTo, { title, body, link })
      .catch(() => ({ mailed: 0 }));
  }
  return summary;
}

/** Email copies are opt-in per category, so the address book is only read for those few rows. */
async function sendCategoryMails(supabase, schoolId, userIds, { title, body, link }) {
  const { data: people } = await supabase.from('school_users').select('id, email, full_name')
    .eq('school_id', schoolId).in('id', userIds.slice(0, QUERY_CHUNK));
  let mailed = 0;
  for (const person of people || []) {
    if (!person.email) continue;
    const result = await sendMail({
      to: person.email,
      template: 'notification',
      variables: {
        user_name: person.full_name,
        title,
        body: body || '',
        link: link ? `${env.appBaseUrl.replace(/\/+$/, '')}/${String(link).replace(/^\/+/, '')}` : '',
      },
    }).catch(() => null);
    if (result?.sent) mailed += 1;
  }
  return { mailed };
}

/**
 * Notification work that must never be on the critical path of the save that caused it: the row is
 * already committed, so an inbox write, a push or a mail that fails is logged, not thrown back at the
 * user. The caller's `req.auth` is read before this returns, so it stays tenant-correct.
 */
export function notifyLater(label, work, log) {
  Promise.resolve().then(work).catch((error) => {
    if (log?.warn) log.warn({ err: error }, label);
    else console.warn(`[notify] ${label}: ${error?.message || error}`);
  });
}

// ── Audience resolvers ─────────────────────────────────────────
// Roles are data, not code: every resolver goes through school_user_roles so a school that renames
// or deletes a role changes its audience without a deploy.

async function collect(query, column = 'user_id') {
  const { data, error } = await query;
  if (error) return [];
  return [...new Set((data || []).map((row) => row[column]).filter(Boolean))];
}

export async function userIdsWithRoles(supabase, schoolId, roleNames) {
  if (!roleNames?.length) return [];
  const { data: roles } = await supabase.from('school_roles').select('id').eq('school_id', schoolId)
    .in('name', roleNames).limit(50);
  const roleIds = (roles || []).map((r) => r.id);
  if (!roleIds.length) return [];
  const ids = new Set();
  for (const part of chunk(roleIds, 10)) {
    const rows = await collect(
      supabase.from('school_user_roles').select('user_id').eq('school_id', schoolId)
        .in('role_id', part).limit(2000),
    );
    rows.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * Holders of one permission, whatever the role is called. A school is free to rename 'exam_officer'
 * or invent its own roles, so a queue that must be acted on is addressed by what its members may do.
 */
export async function userIdsWithPermission(supabase, schoolId, permissionKey) {
  const { data: permission } = await supabase.from('school_permissions').select('id')
    .eq('permission_key', permissionKey).maybeSingle();
  if (!permission) return [];
  const { data: links } = await supabase.from('school_role_permissions').select('role_id')
    .eq('school_id', schoolId).eq('permission_id', permission.id).limit(200);
  const roleIds = [...new Set((links || []).map((l) => l.role_id))];
  if (!roleIds.length) return [];
  const ids = new Set();
  for (const part of chunk(roleIds, 10)) {
    const rows = await collect(supabase.from('school_user_roles').select('user_id')
      .eq('school_id', schoolId).in('role_id', part).limit(2000));
    rows.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/** Every staff membership — anyone whose role set is not purely a portal account. */
export async function staffUserIds(supabase, schoolId) {
  const portal = await userIdsWithRoles(supabase, schoolId, ['student', 'parent']);
  const everyone = await collect(supabase.from('school_users').select('id').eq('school_id', schoolId)
    .eq('status', 'active').limit(MAX_AUDIENCE), 'id');
  const excluded = new Set(portal);
  return everyone.filter((id) => !excluded.has(id));
}

export async function activeStudentUserIds(supabase, schoolId, classIds = null) {
  let query = supabase.from('students').select('user_id').eq('school_id', schoolId)
    .eq('status', 'active').not('user_id', 'is.null').limit(MAX_AUDIENCE);
  if (classIds?.length) query = query.in('class_id', classIds);
  return collect(query);
}

/** Guardian logins for a set of students — the account a parent signs in with, not the child's. */
export async function guardianUserIdsForStudents(supabase, schoolId, studentIds) {
  if (!studentIds?.length) return [];
  const guardianIds = new Set();
  for (const part of chunk(studentIds, QUERY_CHUNK)) {
    const { data } = await supabase.from('student_guardians').select('guardian_id')
      .eq('school_id', schoolId).in('student_id', part).limit(QUERY_CHUNK * 4);
    (data || []).forEach((row) => guardianIds.add(row.guardian_id));
  }
  const links = [...guardianIds];
  if (!links.length) return [];
  const ids = new Set();
  for (const part of chunk(links, QUERY_CHUNK)) {
    const { data } = await supabase.from('guardians').select('user_id')
      .eq('school_id', schoolId).in('id', part).not('user_id', 'is.null').limit(QUERY_CHUNK);
    (data || []).forEach((row) => ids.add(row.user_id));
  }
  return [...ids];
}

/** Teachers assigned to a class — subject teachers and the homeroom teacher alike. */
export async function teacherUserIdsForClasses(supabase, schoolId, classIds) {
  if (!classIds?.length) return [];
  const ids = new Set();
  for (const part of chunk(classIds, QUERY_CHUNK)) {
    const { data } = await supabase.from('teacher_assignments').select('school_user_id')
      .eq('school_id', schoolId).in('class_id', part).limit(1000);
    (data || []).forEach((row) => ids.add(row.school_user_id));
  }
  return [...ids];
}

/** The audience an announcement row describes. */
export async function audienceUserIds(supabase, schoolId, { audience = 'all', classId = null } = {}) {
  switch (audience) {
    case 'students':
      return activeStudentUserIds(supabase, schoolId, classId ? [classId] : null);
    case 'parents': {
      const students = await studentRows(supabase, schoolId, classId);
      return guardianUserIdsForStudents(supabase, schoolId, students.map((s) => s.id));
    }
    case 'teachers':
      return classId ? teacherUserIdsForClasses(supabase, schoolId, [classId])
        : userIdsWithRoles(supabase, schoolId, ['teacher', 'vice_principal', 'principal']);
    case 'staff':
      return staffUserIds(supabase, schoolId);
    case 'class': {
      const students = await studentRows(supabase, schoolId, classId);
      const ids = students.map((s) => s.user_id).filter(Boolean);
      return [...new Set([
        ...ids,
        ...await guardianUserIdsForStudents(supabase, schoolId, ids.length ? students.map((s) => s.id) : []),
        ...await teacherUserIdsForClasses(supabase, schoolId, classId ? [classId] : []),
      ])];
    }
    default: {
      const staff = await staffUserIds(supabase, schoolId);
      const students = await activeStudentUserIds(supabase, schoolId, classId ? [classId] : null);
      const parents = await guardianUserIdsForStudents(supabase, schoolId, (await studentRows(supabase, schoolId, classId)).map((s) => s.id));
      return [...new Set([...staff, ...students, ...parents])];
    }
  }
}

async function studentRows(supabase, schoolId, classId) {
  let query = supabase.from('students').select('id, user_id').eq('school_id', schoolId)
    .eq('status', 'active').limit(MAX_AUDIENCE);
  if (classId) query = query.eq('class_id', classId);
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

/** Learner logins and guardian logins for a set of classes — who a result or a notice is about. */
export async function householdUserIdsForClasses(supabase, schoolId, classIds) {
  if (!classIds?.length) return [];
  const ids = new Set();
  for (const part of chunk(classIds, QUERY_CHUNK)) {
    const { data: students } = await supabase.from('students').select('id, user_id')
      .eq('school_id', schoolId).in('class_id', part).eq('status', 'active').limit(MAX_AUDIENCE);
    (students || []).forEach((s) => { if (s.user_id) ids.add(s.user_id); });
    const parents = await guardianUserIdsForStudents(supabase, schoolId, (students || []).map((s) => s.id));
    parents.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * student id → the logins that speak for that learner. Grouped on purpose: an absence or a receipt
 * belongs to one family, so it can never ride along in a message addressed to the whole class.
 */
export async function householdsByStudent(supabase, schoolId, studentIds) {
  const map = new Map();
  for (const part of chunk([...new Set((studentIds || []).filter(Boolean))], QUERY_CHUNK)) {
    const [{ data: students }, { data: links }] = await Promise.all([
      supabase.from('students').select('id, user_id').eq('school_id', schoolId).in('id', part).limit(part.length),
      supabase.from('student_guardians').select('student_id, guardian_id')
        .eq('school_id', schoolId).in('student_id', part).limit(part.length * 5),
    ]);
    for (const student of students || []) map.set(student.id, student.user_id ? [student.user_id] : []);
    const guardianIds = [...new Set((links || []).map((link) => link.guardian_id).filter(Boolean))];
    if (!guardianIds.length) continue;
    const { data: guardians } = await supabase.from('guardians').select('id, user_id')
      .eq('school_id', schoolId).in('id', guardianIds).not('user_id', 'is.null').limit(guardianIds.length);
    const loginOf = new Map((guardians || []).map((g) => [g.id, g.user_id]));
    for (const link of links || []) {
      const login = loginOf.get(link.guardian_id);
      const list = map.get(link.student_id);
      if (!login || !list || list.includes(login)) continue;
      map.set(link.student_id, [...list, login]);
    }
  }
  return map;
}

/**
 * The one-liner every event site calls. The tenant, the recipient scope and the logging all come from
 * the request, and nothing here can make the caller's save fail. `recipients` is either a list of
 * membership ids or a function that resolves them, so a whole-class audience costs no queries when the
 * event never happens.
 */
export function alertUsers(req, recipients, {
  category = 'general', title, body = null, link = '/notifications', scope = null, schoolId = null,
} = {}) {
  const auth = req?.auth;
  if (!auth || !title) return;
  const tenantScope = scope || (auth.type === 'platform' ? 'platform' : 'school');
  const tenantId = schoolId || (tenantScope === 'school' ? auth.schoolId || null : null);
  notifyLater(`notify ${category}: ${title}`, async () => {
    const supabase = db();
    const ids = typeof recipients === 'function' ? await recipients(supabase, tenantId) : recipients;
    return notify(supabase, ids, { schoolId: tenantId, scope: tenantScope, category, title, body, link });
  }, req.log);
}
