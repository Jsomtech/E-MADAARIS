import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';

/**
 * One student's complete school record, flattened to plain JSON.
 *
 * Two things are built on this shape: a cross-school transfer (the receiving school must see the
 * class, the results and the guardians before it agrees to admit the learner) and the printed
 * clearance document. Rows are welded to their own tenant by foreign keys, so the pack carries
 * names alongside ids — the destination school re-admits by name, never by id.
 *
 * Money is deliberately absent: a school's fee ledger stays inside the finance module, and a
 * learner's academic record travels without it.
 */

const ATTENDANCE_ROWS = 500;   // snapshot ceiling; the summary counts stay complete
const RESULT_SETS = 8;         // most recent examinations, newest first
const PROFILE_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'full_name', 'gender', 'date_of_birth',
  'photo_url', 'address', 'phone', 'emergency_contact', 'notes', 'status',
];

const round = (n, dp = 1) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };
const percentOf = (obtained, maximum) => {
  const x = Number(maximum) || 0;
  return x > 0 ? round(((Number(obtained) || 0) / x) * 100) : 0;
};
const gradeFor = (ranges, percent) => (ranges || []).find(
  (g) => percent >= Number(g.min_percent) && percent <= Number(g.max_percent),
) || null;

/**
 * Marks rows (one per examination component) folded into one set per examination: subject totals,
 * overall percentage, the school's own grade label and the position inside the class.
 * Kept free of database calls so the grading rules stay checkable on their own.
 */
export function composeResultSets({ studentId, marks = [], ranges = [], classMarks = [], limit = RESULT_SETS }) {
  const byExam = new Map();
  for (const m of marks) {
    const exam = m.examinations || {};
    const key = m.examination_id;
    if (!key) continue;
    const set = byExam.get(key) || {
      examination_id: key,
      examination: exam.name || null,
      examination_status: exam.status || null,
      term: exam.terms?.name || null,
      academic_year: exam.academic_years?.name || null,
      components: [],
      subjects: new Map(),
    };
    const obtained = Number(m.marks_obtained) || 0;
    const maximum = Number(m.maximum_marks) || 0;
    set.components.push({
      subject: m.subjects?.name || null,
      component_id: m.component_id || null,
      obtained, maximum, percent: percentOf(obtained, maximum),
      approval_status: m.approval_status,
    });
    const subjectKey = m.subject_id || m.subjects?.name || 'unknown';
    const s = set.subjects.get(subjectKey) || { name: m.subjects?.name || null, obtained: 0, maximum: 0 };
    s.obtained += obtained; s.maximum += maximum;
    set.subjects.set(subjectKey, s);
    byExam.set(key, set);
  }

  const ranks = {};
  for (const m of classMarks) {
    const key = `${m.examination_id}|${m.student_id}`;
    const t = ranks[key] || { obtained: 0, maximum: 0 };
    t.obtained += Number(m.marks_obtained) || 0; t.maximum += Number(m.maximum_marks) || 0;
    ranks[key] = t;
  }
  const standings = {};
  for (const [key, t] of Object.entries(ranks)) {
    const [examId, sid] = key.split('|');
    const list = standings[examId] || (standings[examId] = []);
    list.push({ studentId: sid, percent: percentOf(t.obtained, t.maximum) });
  }
  const positionOf = {};
  for (const [examId, list] of Object.entries(standings)) {
    const sorted = list.sort((a, b) => b.percent - a.percent);
    positionOf[examId] = {
      position: sorted.findIndex((x) => x.studentId === studentId) + 1 || null,
      size: sorted.length,
    };
  }

  return [...byExam.values()].map((set) => {
    const totalObtained = set.components.reduce((x, r) => x + r.obtained, 0);
    const totalMaximum = set.components.reduce((x, r) => x + r.maximum, 0);
    const percent = percentOf(totalObtained, totalMaximum);
    // An examination with no recorded maximum carries no real percentage, so it earns no grade.
    const grade = totalMaximum > 0 ? gradeFor(ranges, percent) : null;
    const rank = positionOf[set.examination_id] || null;
    return {
      examination_id: set.examination_id,
      examination: set.examination,
      examination_status: set.examination_status,
      term: set.term,
      academic_year: set.academic_year,
      subjects: [...set.subjects.values()]
        .map((s) => ({ name: s.name, obtained: round(s.obtained, 2), maximum: round(s.maximum, 2), percent: percentOf(s.obtained, s.maximum) }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      components: set.components,
      total_obtained: round(totalObtained, 2),
      total_maximum: round(totalMaximum, 2),
      percent,
      grade: grade?.grade_label || null,
      remark: grade?.remark || null,
      class_rank: rank?.position || null,
      class_size: rank?.size || null,
    };
  })
    .sort((a, b) => String(b.academic_year || '').localeCompare(String(a.academic_year || ''))
      || String(b.examination || '').localeCompare(String(a.examination || '')))
    .slice(0, limit);
}

/**
 * Profile + enrolment + guardians + documents + attendance + results for one student.
 * `issuedBy` is the administrator's display name, recorded so a shared pack says who released it.
 */
export async function buildStudentPack(schoolId, studentId, { issuedBy = null } = {}) {
  const db = requireDb();
  const { data: student, error: studentError } = await db.from('students')
    .select('*, classes(id, name, level), sections(id, name, class_id), academic_years(id, name)')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (studentError) throw new ApiError(500, studentError.message);
  if (!student) throw new ApiError(404, 'That student is not part of your school.');

  const [guardianLinks, documents, attendance, marks, scales, school] = await Promise.all([
    db.from('student_guardians')
      .select('relationship, is_primary, guardians(id, full_name, phone, email, address, relationship, occupation)')
      .eq('school_id', schoolId).eq('student_id', studentId),
    db.from('student_documents')
      .select('document_type, file_name, file_path, mime_type, size_bytes, created_at')
      .eq('school_id', schoolId).eq('student_id', studentId).order('created_at', { ascending: false }),
    db.from('attendance_records')
      .select('attendance_date, attendance_status, remarks, subject_id, subjects(name)')
      .eq('school_id', schoolId).eq('student_id', studentId).order('attendance_date', { ascending: false }),
    db.from('marks')
      .select('marks_obtained, maximum_marks, approval_status, component_id, subject_id, subjects(name, code), examination_id, examinations(name, status, term_id, academic_year_id, terms(name), academic_years(name))')
      .eq('school_id', schoolId).eq('student_id', studentId),
    db.from('grade_ranges').select('grade_label, min_percent, max_percent, remark, grade_scales(is_default, name)').eq('school_id', schoolId),
    db.from('schools').select('id, school_name, city, country, registration_number, logo_url').eq('id', schoolId).maybeSingle(),
  ]);

  const guardians = (guardianLinks.data || [])
    .filter((l) => l.guardians)
    .map((l) => ({ ...l.guardians, link_relationship: l.relationship, is_primary: Boolean(l.is_primary) }));

  const attendanceRows = attendance.data || [];
  const attendanceSummary = attendanceRows.reduce((acc, r) => {
    acc[r.attendance_status] = (acc[r.attendance_status] || 0) + 1;
    return acc;
  }, {});
  const attendanceDays = attendanceRows.length;
  const presentDays = (attendanceSummary.present || 0) + (attendanceSummary.late || 0);

  const scaleName = (g) => g.grade_scales?.name || null;
  const defaultScale = (scales.data || []).find((g) => g.grade_scales?.is_default) || null;
  const ranges = defaultScale ? (scales.data || []).filter((g) => scaleName(g) === scaleName(defaultScale)) : (scales.data || []);

  // One extra read: every mark recorded by this student's classmates, so each set carries a rank.
  const examIds = [...new Set((marks.data || []).map((m) => m.examination_id).filter(Boolean))];
  let classMarks = [];
  if (student.class_id && examIds.length) {
    const { data } = await db.from('marks')
      .select('student_id, examination_id, marks_obtained, maximum_marks')
      .eq('school_id', schoolId).eq('class_id', student.class_id).in('examination_id', examIds);
    classMarks = data || [];
  }

  const resultSets = composeResultSets({
    studentId, marks: marks.data || [], ranges, classMarks, limit: RESULT_SETS,
  });

  const { data: schoolRow } = school;

  return {
    student: Object.fromEntries(PROFILE_FIELDS.map((k) => [k, student[k] ?? null])),
    enrolment: {
      admission_number: student.admission_number || null,
      hemis_id: student.hemis_id || null,
      academic_year_id: student.academic_year_id || null,
      academic_year: student.academic_years?.name || null,
      class_id: student.class_id || null,
      class_name: student.classes?.name || null,
      class_level: student.classes?.level ?? null,
      section_id: student.section_id || null,
      section_name: student.sections?.name || null,
      admission_date: student.admission_date || null,
      status: student.status || null,
      previous_school: student.previous_school || null,
    },
    school: schoolRow ? {
      id: schoolRow.id, name: schoolRow.school_name, city: schoolRow.city || null,
      country: schoolRow.country || null, registration_number: schoolRow.registration_number || null,
      logo_url: schoolRow.logo_url || null,
    } : null,
    guardians,
    documents: documents.data || [],
    attendance: {
      summary: attendanceSummary,
      days_recorded: attendanceDays,
      percent_present: attendanceDays ? round((presentDays / attendanceDays) * 100) : null,
      records: attendanceRows.slice(0, ATTENDANCE_ROWS),
    },
    results: resultSets,
    issued_by: issuedBy,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Transfers completed before the pack existed stored an older, thinner snapshot. Folded into the
 * pack shape so one viewer reads both; marks are re-composed here, class names and ranks were
 * never captured and stay blank.
 */
export function packFromLegacyDossier(dossier, { issuedBy = null } = {}) {
  if (!dossier?.student) return null;
  const student = dossier.student;
  const records = dossier.attendance?.records || [];
  return {
    student: Object.fromEntries(PROFILE_FIELDS.map((k) => [k, student[k] ?? null])),
    enrolment: {
      admission_number: student.admission_number || null,
      hemis_id: student.hemis_id || null,
      academic_year: null,
      class_name: null,
      section_name: null,
      admission_date: student.admission_date || null,
      status: student.status || null,
      previous_school: student.previous_school || null,
    },
    school: null,
    guardians: dossier.guardians || [],
    documents: dossier.documents || [],
    attendance: {
      summary: dossier.attendance?.summary || {},
      days_recorded: records.length,
      percent_present: null,
      records,
    },
    results: composeResultSets({
      studentId: null,
      marks: dossier.marks || [],
      ranges: [],
      classMarks: [],
    }),
    issued_by: issuedBy,
    captured_at: dossier.captured_at || null,
    legacy: true,
  };
}
