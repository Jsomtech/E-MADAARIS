import { ApiError } from '../middleware/error.js';
import {
  activeStudentUserIds, audienceUserIds, guardianUserIdsForStudents, staffUserIds, userIdsWithRoles,
} from './notify.js';

/**
 * What a school account may address, and how a described audience becomes membership ids.
 *
 * This lives in the service layer rather than the endpoint because two very different callers must agree
 * on it: the composer, which answers to a signed-in request, and the scheduler, which fires a notice the
 * same account wrote hours earlier. A notice queued by a principal who has since lost the switches must
 * fail on the same rule that would have refused it at the keyboard.
 */

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const CHANNELS = ['in_app', 'push', 'email'];
export const AUDIENCES = ['all', 'students', 'parents', 'teachers', 'staff', 'class', 'roles', 'users'];
/** Audiences no single teacher owns: they interrupt the whole tenant. */
export const BROADCAST_AUDIENCES = new Set(['all', 'staff', 'teachers', 'roles']);
/** Matches the cap the notify pipeline applies, so a preview can say when a send will be trimmed. */
export const AUDIENCE_CAP = 3000;

/**
 * A category speaks for one module, and the people allowed to send about it are the people who can
 * already see it: an accountant chases fees, an exam officer chases results, neither may chase
 * attendance. 'general', 'account' and 'announcements' need no module permission.
 */
export const CATEGORY_SUBJECTS = {
  attendance: ['attendance.view'],
  timetable: ['timetable.view'],
  academic: ['examinations.view', 'marks.view', 'learning.view'],
  results: ['results.view', 'marks.view'],
  finance: ['finance.view'],
  elections: ['elections.view'],
  support: ['support.view'],
  announcements: ['announcements.view'],
};

export function ownsCategory(auth, category) {
  const keys = CATEGORY_SUBJECTS[category];
  return !keys || keys.some((key) => auth.permissions.has(key));
}

/** The school's own answer to "who may make a notice" — the switches that gate announcements. */
export function mayAnnounce(auth) {
  return auth.isSuperAdmin === true
    || auth.permissions.has('announcements.publish')
    || auth.permissions.has('announcements.create');
}

/** @throws {ApiError} when this account may not address this audience or this subject. */
export function assertMayCompose(auth, body) {
  if (auth.isSuperAdmin) return;
  if (BROADCAST_AUDIENCES.has(body.audience) && !mayAnnounce(auth)) {
    throw new ApiError(403, `Only accounts that can publish announcements may address "${body.audience}". Use the class or individual audience.`);
  }
  if (!mayAnnounce(auth) && !ownsCategory(auth, body.category)) {
    throw new ApiError(403, `Sending a ${body.category} notification needs the matching module permission.`);
  }
}

/** Class ids the actor teaches — subject assignments plus the homeroom they own. */
export async function taughtClassIds(supabase, schoolId, userId) {
  const [{ data: links }, { data: rooms }] = await Promise.all([
    supabase.from('teacher_assignments').select('class_id').eq('school_id', schoolId)
      .eq('school_user_id', userId).not('class_id', 'is.null').limit(200),
    supabase.from('classes').select('id').eq('school_id', schoolId).eq('teacher_id', userId).limit(200),
  ]);
  return [...new Set([
    ...(links || []).map((row) => row.class_id),
    ...(rooms || []).map((row) => row.id),
  ].filter(Boolean))];
}

/**
 * The classes a send may cover. An account without the announcement switches never leaves its own
 * classroom: a class audience is checked against its assignments, and a student or parent audience is
 * narrowed to those classes rather than opened to the tenant.
 */
export async function scopedClassIds(supabase, auth, body) {
  if (mayAnnounce(auth)) return body.class_ids;
  if (body.audience === 'users') return [];
  const taught = await taughtClassIds(supabase, auth.schoolId, auth.userId);
  if (!body.class_ids.length) {
    if (body.audience === 'class') throw new ApiError(403, 'You can only address classes you are assigned to, and you have none yet.');
    if (!taught.length) throw new ApiError(403, 'You are not assigned to a class, so there is no audience here for you to address.');
    return taught;
  }
  const allowed = new Set(taught);
  if (body.class_ids.some((id) => !allowed.has(id))) {
    throw new ApiError(403, 'You may only address classes you are assigned to.');
  }
  return body.class_ids;
}

async function studentIdsOf(supabase, schoolId, classIds) {
  let query = supabase.from('students').select('id').eq('school_id', schoolId)
    .eq('status', 'active').limit(AUDIENCE_CAP);
  if (classIds?.length) query = query.in('class_id', classIds);
  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);
  return (data || []).map((row) => row.id);
}

/** Explicit recipients must be live members of the actor's own tenant — never a bare uuid lookup. */
export async function verifiedMemberIds(supabase, schoolId, userIds) {
  const wanted = [...new Set(userIds)];
  const ids = new Set();
  for (let i = 0; i < wanted.length; i += 200) {
    const { data, error } = await supabase.from('school_users').select('id')
      .eq('school_id', schoolId).eq('status', 'active').in('id', wanted.slice(i, i + 200)).limit(200);
    if (error) throw new ApiError(500, error.message);
    (data || []).forEach((row) => ids.add(row.id));
  }
  if (ids.size !== wanted.length) {
    // Which id was wrong is another tenant's information; the count is enough to fix the form.
    throw new ApiError(400, `${wanted.length - ids.size} of the chosen recipients are not active members of this school.`);
  }
  return [...ids];
}

/** Resolve the description of an audience into membership ids, scoped to what the actor owns. */
export async function resolveAudience(supabase, auth, body, classIds) {
  const schoolId = auth.schoolId;
  switch (body.audience) {
    case 'users':
      return verifiedMemberIds(supabase, schoolId, body.user_ids);
    case 'roles':
      return userIdsWithRoles(supabase, schoolId, body.role_names);
    case 'class': {
      const ids = new Set();
      for (const classId of classIds.length ? classIds : body.class_ids) {
        (await audienceUserIds(supabase, schoolId, { audience: 'class', classId })).forEach((id) => ids.add(id));
      }
      return [...ids];
    }
    case 'students':
      return activeStudentUserIds(supabase, schoolId, classIds.length ? classIds : null);
    case 'parents':
      return guardianUserIdsForStudents(supabase, schoolId, await studentIdsOf(supabase, schoolId, classIds));
    case 'teachers':
      return audienceUserIds(supabase, schoolId, { audience: 'teachers' });
    case 'staff':
      return staffUserIds(supabase, schoolId);
    default:
      return audienceUserIds(supabase, schoolId, { audience: 'all' });
  }
}

/** The permission set of one membership, for a send that fires without anyone signed in. */
export async function permissionsOf(supabase, schoolId, schoolUserId) {
  const { data: links, error } = await supabase.from('school_user_roles').select('role_id')
    .eq('school_id', schoolId).eq('user_id', schoolUserId).limit(50);
  if (error) return new Set();
  const roleIds = (links || []).map((row) => row.role_id);
  if (!roleIds.length) return new Set();
  const { data: grants } = await supabase.from('school_role_permissions')
    .select('school_permissions!inner(permission_key)').eq('school_id', schoolId)
    .in('role_id', roleIds).limit(3000);
  return new Set((grants || []).map((row) => row.school_permissions?.permission_key).filter(Boolean));
}

export function describeAudience(body, classCount) {
  switch (body.audience) {
    case 'class': return `${classCount || body.class_ids.length} class(es)`;
    case 'roles': return body.role_names.join(', ');
    case 'users': return `${new Set(body.user_ids).size} individual(s)`;
    default: return body.audience;
  }
}
