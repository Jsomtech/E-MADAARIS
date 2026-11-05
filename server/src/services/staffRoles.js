import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';

/**
 * Who belongs in a people picker. A field that hands out teaching work lists teachers only, so a
 * principal who never stands in front of a class cannot be picked for it; fields that name any
 * employee keep the whole staff list. Custom role names still count when they carry the role word,
 * so a school that renamed `teacher` to "Class Teacher" keeps working.
 */
const ROLE_TEST = {
  teacher: (name) => /teacher/i.test(name),
};

export function isTeacherRole(name) {
  return ROLE_TEST.teacher(String(name || ''));
}

/** Active staff holding a role, as picker rows: { id, full_name, email, avatar_url, roles }. */
export async function listTeacherStaff(schoolId, { limit = 500 } = {}) {
  const { data, error } = await requireDb().from('school_users')
    .select('id, full_name, email, avatar_url, school_user_roles(school_roles(name))')
    .eq('school_id', schoolId).eq('status', 'active').order('full_name').limit(limit);
  if (error) throw new ApiError(500, error.message);
  return (data || [])
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      avatar_url: u.avatar_url,
      roles: (u.school_user_roles || []).map((l) => l.school_roles?.name).filter(Boolean),
    }))
    .filter((u) => u.roles.some(isTeacherRole));
}

/** True when the membership holds the role in this school. */
export async function holdsTeacherRole(schoolId, userId) {
  if (!userId) return false;
  const { data, error } = await requireDb().from('school_user_roles')
    .select('school_roles(name)').eq('school_id', schoolId).eq('user_id', userId);
  if (error) throw new ApiError(500, error.message);
  return (data || []).some((l) => isTeacherRole(l.school_roles?.name));
}
