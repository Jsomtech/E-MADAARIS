import { db } from '../config/supabase.js';

/** Student record id for the logged-in student account. */
export async function ownStudentId(auth) {
  const { data } = await db().from('students')
    .select('id').eq('school_id', auth.schoolId).eq('user_id', auth.userId).maybeSingle();
  return data?.id || '00000000-0000-0000-0000-000000000000';
}

/** Student ids visible to this user: own (student) or linked children (parent), null if staff. */
export async function visibleStudentIds(auth) {
  if (auth.roles.includes('student')) return [await ownStudentId(auth)];
  if (auth.roles.includes('parent')) {
    const { data: guardians } = await db().from('guardians')
      .select('id').eq('school_id', auth.schoolId).eq('user_id', auth.userId);
    const gids = (guardians || []).map((g) => g.id);
    if (!gids.length) return [];
    const { data: links } = await db().from('student_guardians')
      .select('student_id').eq('school_id', auth.schoolId).in('guardian_id', gids);
    return [...new Set((links || []).map((l) => l.student_id))];
  }
  return null; // not student/parent — normal scoping applies
}

/** Class ids a portal account may see: the student's own class or the children's classes. null for staff. */
export async function portalClassIds(auth) {
  if (!isPortalOnly(auth)) return null;
  const ids = await visibleStudentIds(auth);
  if (!ids?.length) return [];
  const { data } = await db().from('students').select('class_id')
    .eq('school_id', auth.schoolId).in('id', ids);
  return [...new Set((data || []).map((s) => s.class_id).filter(Boolean))];
}

/**
 * ownFilter fragment that pins a class-scoped table to the portal account's class.
 * `column` is 'id' for the classes table itself, 'class_id' for everything else.
 */
export async function portalClassFilter(auth, column = 'class_id') {
  const ids = await portalClassIds(auth);
  return ids === null ? null : { [column]: ids };
}

/** Class ids a teacher is assigned to (null = not restricted by assignment). */
export async function teacherClassIds(auth) {
  if (!auth.roles.includes('teacher') || auth.roles.includes('school_admin')) return null;
  const { data } = await db().from('teacher_assignments')
    .select('class_id').eq('school_id', auth.schoolId).eq('school_user_id', auth.userId);
  return [...new Set((data || []).map((t) => t.class_id).filter(Boolean))];
}

export function isStudentRole(auth) { return auth.roles.includes('student') && !auth.roles.some((r) => r !== 'student' && r !== 'parent'); }
export function isParentRole(auth) { return auth.roles.includes('parent'); }
export function isPersonalPortal(auth) { return isStudentRole(auth) || isParentRole(auth); }
/** True only when the account has no staff role, so staff who are also parents keep their back office. */
export function isPortalOnly(auth) {
  return auth.roles.length > 0 && auth.roles.every((r) => r === 'student' || r === 'parent');
}

// ── Student ID format ────────────────────────────────────────────
// <SCHOOL PREFIX><YY><0001>  e.g. Al Qalam + 2026/2027 -> AQ260001
// The numeric part is always six digits: two-digit year + four-digit sequence.

const GENERIC_SCHOOL_WORDS = new Set([
  'school', 'schools', 'academy', 'academies', 'college', 'institute', 'institution',
  'high', 'secondary', 'primary', 'elementary', 'university', 'campus', 'learning',
  'center', 'centre', 'international',
]);

/** Prefix from the school's own name: initials of up to 3 meaningful words ("Al Qalam" -> "AQ"). */
export function schoolPrefix(schoolName) {
  // Purely numeric words are usually tenant codes or years, never part of the school's name.
  const words = String(schoolName || '').split(/[^A-Za-z0-9]+/).filter((w) => w && !/^\d+$/.test(w));
  while (words.length > 2 && GENERIC_SCHOOL_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return 'SC';
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase().slice(0, 3);
  return (words[0].slice(0, 2) || 'SC').toUpperCase();
}

/** Admin-supplied override from school_settings.branding.student_id_prefix (2-4 alphanumerics). */
export function sanitizePrefix(value) {
  const clean = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return clean.length >= 2 ? clean : null;
}

/** Two-digit year of an academic year: name first ("2026/2027" -> "26"), then start_date. */
export function admissionYearCode(year) {
  const fromName = String(year?.name || '').match(/(19|20)\d{2}/);
  if (fromName) return fromName[0].slice(2);
  const start = year?.start_date ? new Date(year.start_date) : null;
  if (start && !Number.isNaN(start.getTime())) return String(start.getFullYear()).slice(2);
  return String(new Date().getFullYear()).slice(2);
}

async function resolveYear(supabase, schoolId, academicYearId) {
  const { data: settings } = await supabase.from('school_settings')
    .select('academic_year_id, branding').eq('school_id', schoolId).maybeSingle();
  const load = async (id) => {
    if (!id) return null;
    const { data } = await supabase.from('academic_years').select('id, name, start_date')
      .eq('id', id).eq('school_id', schoolId).maybeSingle();
    return data;
  };
  const chosen = await load(academicYearId) || await load(settings?.academic_year_id);
  if (chosen) return { ...chosen, branding: settings?.branding };
  const { data } = await supabase.from('academic_years').select('id, name, start_date')
    .eq('school_id', schoolId).eq('is_current', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data ? { ...data, branding: settings?.branding } : { branding: settings?.branding };
}

/**
 * Head (prefix + YY) and next free sequence for a school/academic year.
 * Highest existing sequence wins: counting rows would reuse a number after a student is deleted.
 */
export async function admissionNumberSequence(schoolId, academicYearId, opts = {}) {
  const supabase = db();
  const [year, { data: school }] = await Promise.all([
    resolveYear(supabase, schoolId, academicYearId),
    opts.schoolName
      ? Promise.resolve({ data: { school_name: opts.schoolName } })
      : supabase.from('schools').select('school_name').eq('id', schoolId).maybeSingle(),
  ]);
  const branding = opts.branding || year?.branding;
  const override = sanitizePrefix(branding?.student_id_prefix);
  const prefix = override || schoolPrefix(school?.school_name || opts.schoolName);
  const yearCode = admissionYearCode(year);
  const head = `${prefix}${yearCode}`;
  const { data: rows } = await supabase.from('students').select('admission_number')
    .eq('school_id', schoolId).like('admission_number', `${head}%`);
  const highest = (rows || []).reduce((max, row) => {
    const tail = String(row.admission_number || '').slice(head.length);
    return /^\d{4}$/.test(tail) ? Math.max(max, Number(tail)) : max;
  }, 0);
  return { prefix, yearCode, head, nextSequence: highest + 1, academicYear: year?.id ? year : null };
}

/** Format a sequence as the six-digit numeric part's last four positions. */
export function formatAdmissionNumber(head, sequence) {
  return `${head}${String(sequence).padStart(4, '0')}`;
}

/** Next student ID, e.g. AQ260001 (prefix + year of the selected academic year + sequence). */
export async function nextAdmissionNumber(schoolId, academicYearId, opts = {}) {
  const seq = await admissionNumberSequence(schoolId, academicYearId, opts);
  return formatAdmissionNumber(seq.head, seq.nextSequence);
}
