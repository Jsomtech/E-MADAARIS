import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { resourceRouter, uuid, optionalId, trimStr, money } from '../core/crud.js';
import { nextAdmissionNumber, visibleStudentIds, isPortalOnly, portalClassFilter, portalClassIds } from '../services/scopes.js';
import { provisionStudentAccount } from '../services/studentAccounts.js';
import { studentsProfileColumns } from '../services/schemaSupport.js';

const s = (max = 255) => z.string().trim().min(1).max(max);

/** Tables with no created_at column: the CRUD factory cannot order them by date. */
const ORDER_BY = {
  sections: 'name', class_subjects: 'id', classrooms: 'name', timetable_periods: 'start_time',
  timetable_entries: 'day_of_week', student_guardians: 'id', staff_departments: 'name',
  examination_types: 'name', exam_class_subjects: 'id', examination_components: 'name',
  examination_schedules: 'exam_date', examination_invigilators: 'schedule_id',
  grade_scales: 'name', grade_ranges: 'min_percent', fee_categories: 'name',
  expense_categories: 'name', certificate_templates: 'name', library_books: 'title',
  library_transactions: 'borrowed_at', transport_vehicles: 'plate_number',
  transport_drivers: 'full_name', transport_routes: 'name', student_transport_assignments: 'student_id',
  equipment_allocations: 'allocated_to', visitors: 'full_name', assignment_submissions: 'submitted_at',
  receipts: 'receipt_number',
};

/** All standard CRUD resources mounted under /api/v1. */
export function mountResources(api) {
  const R = (path, def) => api.use(`/${path}`, resourceRouter({ orderBy: ORDER_BY[def.table], ...def }));

  // Personal portals (student/parent) may only read their own student row or rows linked to it.
  // Returning null leaves staff scoping untouched.
  const ownStudent = async (req) => {
    const ids = await visibleStudentIds(req.auth);
    return ids === null ? null : { id: ids };
  };
  const ownStudentLinks = async (req) => {
    const ids = await visibleStudentIds(req.auth);
    return ids === null ? null : { student_id: ids };
  };

  // ── Academics ────────────────────────────────────────────────
  R('academic-years', {
    table: 'academic_years', perm: 'timetable', managePerm: ['timetable.manage', 'school.edit'], search: ['name'], filter: ['is_current'],
    fields: ['name', 'start_date', 'end_date', 'is_current'],
    schema: z.object({ name: s(64), start_date: z.string().optional(), end_date: z.string().optional(), is_current: z.boolean().optional() }),
  });
  R('terms', {
    table: 'terms', perm: 'timetable', managePerm: ['timetable.manage', 'school.edit'], search: ['name'], filter: ['academic_year_id', 'is_current'],
    fields: ['academic_year_id', 'name', 'start_date', 'end_date', 'is_current'],
    schema: z.object({ academic_year_id: uuid, name: s(64), start_date: z.string().optional(), end_date: z.string().optional(), is_current: z.boolean().optional() }),
  });
  R('classes', {
    table: 'classes', perm: 'students', feature: 'classes.subjects', search: ['name'],
    fields: ['name', 'level', 'capacity'],
    schema: z.object({ name: s(64), level: z.coerce.number().int().optional(), capacity: z.coerce.number().int().optional() }),
    // Portal accounts only ever see the class they are enrolled in (or their children's classes).
    ownFilter: (req) => portalClassFilter(req.auth, 'id'),
  });
  R('sections', {
    table: 'sections', perm: 'students', search: ['name'], filter: ['class_id'],
    select: '*, classes(name)',
    fields: ['class_id', 'name', 'capacity'],
    schema: z.object({ class_id: uuid, name: s(32), capacity: z.coerce.number().int().optional() }),
    refs: { class_id: 'classes' },
    ownFilter: (req) => portalClassFilter(req.auth),
  });
  R('subjects', {
    table: 'subjects', perm: 'students', managePerm: ['students.manage', 'school.edit'],
    feature: 'classes.subjects', search: ['name', 'code'],
    fields: ['name', 'code'],
    schema: z.object({ name: s(96), code: trimStr(32).optional() }),
  });
  R('class-subjects', {
    table: 'class_subjects', perm: 'students', managePerm: ['students.manage', 'school.edit'],
    filter: ['class_id', 'subject_id'],
    select: '*, classes(name), subjects(name)',
    fields: ['class_id', 'subject_id'],
    schema: z.object({ class_id: uuid, subject_id: uuid }),
    refs: { class_id: 'classes', subject_id: 'subjects' },
    ownFilter: (req) => portalClassFilter(req.auth),
  });
  R('classrooms', {
    table: 'classrooms', perm: 'timetable', managePerm: ['timetable.manage', 'school.edit'], search: ['name'],
    fields: ['name', 'capacity'],
    schema: z.object({ name: s(64), capacity: z.coerce.number().int().optional() }),
  });
  R('teacher-assignments', {
    table: 'teacher_assignments', perm: 'teachers', filter: ['school_user_id', 'class_id', 'subject_id'], search: [],
    fields: ['school_user_id', 'class_id', 'subject_id', 'is_homeroom'],
    schema: z.object({ school_user_id: uuid, class_id: optionalId, subject_id: optionalId, is_homeroom: z.boolean().optional() }),
    refs: { school_user_id: 'school_users', class_id: 'classes', subject_id: 'subjects' },
  });
  R('timetable-periods', {
    table: 'timetable_periods', perm: 'timetable', managePerm: ['timetable.manage', 'school.edit'], search: ['name'],
    fields: ['name', 'start_time', 'end_time', 'sort_order'],
    schema: z.object({ name: s(32), start_time: z.string().optional(), end_time: z.string().optional(), sort_order: z.coerce.number().int().optional() }),
  });
  R('timetable-entries', {
    table: 'timetable_entries', perm: 'timetable', managePerm: ['timetable.manage', 'school.edit'], search: ['day_of_week'], filter: ['class_id', 'day_of_week', 'teacher_id'],
    select: '*, classes(name), subjects(name), timetable_periods(name, start_time, end_time), classrooms(name), school_users!timetable_entries_teacher_id_fkey(full_name)',
    fields: ['class_id', 'subject_id', 'teacher_id', 'classroom_id', 'day_of_week', 'period_id', 'academic_year_id'],
    schema: z.object({
      class_id: uuid, subject_id: uuid, teacher_id: optionalId, classroom_id: optionalId,
      day_of_week: s(10), period_id: uuid, academic_year_id: optionalId,
    }),
    refs: {
      class_id: 'classes', subject_id: 'subjects', teacher_id: 'school_users',
      classroom_id: 'classrooms', period_id: 'timetable_periods', academic_year_id: 'academic_years',
    },
    ownFilter: (req) => portalClassFilter(req.auth),
  });

  // ── Students & guardians ─────────────────────────────────────
  R('students', {
    table: 'students', perm: 'students', feature: 'students.management', limit: 'max_students',
    select: '*, classes (name), sections (name)',
    search: ['first_name', 'middle_name', 'last_name', 'admission_number'],
    dynamicSearch: async () => ((await studentsProfileColumns())
      ? ['first_name', 'middle_name', 'last_name', 'admission_number', 'hemis_id', 'phone']
      : ['first_name', 'middle_name', 'last_name', 'admission_number']),
    filter: ['class_id', 'section_id', 'status', 'gender', 'academic_year_id'],
    fields: ['admission_number', 'first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth',
      'photo_url', 'admission_date', 'academic_year_id', 'class_id', 'section_id', 'previous_school',
      'address', 'emergency_contact', 'status', 'hemis_id', 'phone', 'notes'],
    schema: z.object({
      first_name: s(96), middle_name: trimStr(96).optional(), last_name: trimStr(96).optional(),
      admission_number: trimStr(32).optional(),
      hemis_id: trimStr(32).optional(), phone: trimStr(32).optional(), notes: trimStr(1000).optional(),
      gender: z.enum(['male', 'female']).optional(), date_of_birth: z.string().optional(),
      photo_url: z.string().url().optional(), admission_date: z.string().optional(),
      academic_year_id: optionalId, class_id: optionalId, section_id: optionalId,
      previous_school: trimStr(160).optional(), address: trimStr(255).optional(),
      emergency_contact: trimStr(64).optional(),
      status: z.enum(['active', 'inactive', 'transferred', 'withdrawn', 'graduated']).optional(),
    }),
    refs: { class_id: 'classes', section_id: 'sections', academic_year_id: 'academic_years' },
    beforeCreate: async (payload, req) => {
      if (!(await studentsProfileColumns())) {
        delete payload.hemis_id; delete payload.phone; delete payload.notes;
      }
      if (payload.hemis_id) {
        const { data } = await db().from('students').select('id')
          .eq('school_id', req.auth.schoolId).ilike('hemis_id', payload.hemis_id).maybeSingle();
        if (data) throw new ApiError(409, 'That HEMIS number already belongs to another student in this school.');
      }
      return {
        ...payload,
        admission_number: payload.admission_number
          || await nextAdmissionNumber(req.auth.schoolId, payload.academic_year_id, { schoolName: req.auth.school?.school_name }),
      };
    },
    beforeUpdate: async (payload, req) => {
      if (!(await studentsProfileColumns())) {
        delete payload.hemis_id; delete payload.phone; delete payload.notes;
      }
      if (payload.hemis_id) {
        const { data } = await db().from('students').select('id')
          .eq('school_id', req.auth.schoolId).ilike('hemis_id', payload.hemis_id)
          .neq('id', req.params.id).maybeSingle();
        if (data) throw new ApiError(409, 'That HEMIS number already belongs to another student in this school.');
      }
      return payload;
    },
    // Every admission gets a login whose password is the student ID; failures are non-fatal and
    // can be retried in bulk from the admissions page.
    afterCreate: async (row, req) => {
      try {
        await provisionStudentAccount(row, { schoolId: req.auth.schoolId });
      } catch (error) {
        req.log?.warn({ err: error, studentId: row.id }, 'student login provisioning failed');
      }
    },
    // The login identity outlives the admission record for audit purposes, but must not stay usable.
    afterDelete: async (row) => {
      if (!row.user_id) return;
      await db().from('school_users').update({ status: 'inactive' })
        .eq('id', row.user_id).eq('school_id', row.school_id);
    },
    ownFilter: ownStudent,
  });
  R('guardians', {
    table: 'guardians', perm: 'guardians', search: ['full_name', 'phone', 'email'],
    fields: ['full_name', 'phone', 'email', 'address', 'relationship', 'occupation', 'user_id'],
    schema: z.object({
      full_name: s(160), phone: trimStr(32).optional(), email: z.string().email().optional(),
      address: trimStr(255).optional(), relationship: trimStr(32).optional(), occupation: trimStr(96).optional(),
      user_id: optionalId,
    }),
  });
  R('student-guardians', {
    table: 'student_guardians', perm: 'guardians', filter: ['student_id', 'guardian_id'],
    fields: ['student_id', 'guardian_id', 'relationship', 'is_primary'],
    schema: z.object({ student_id: uuid, guardian_id: uuid, relationship: trimStr(32).optional(), is_primary: z.boolean().optional() }),
    refs: { student_id: 'students', guardian_id: 'guardians' },
  });
  R('student-documents', {
    table: 'student_documents', perm: 'students', filter: ['student_id', 'document_type'],
    fields: ['student_id', 'document_type', 'file_name', 'file_path', 'mime_type', 'size_bytes'],
    schema: z.object({
      student_id: uuid, document_type: s(64), file_name: trimStr(255).optional(),
      file_path: s(512), mime_type: trimStr(64).optional(), size_bytes: z.coerce.number().int().optional(),
    }),
    refs: { student_id: 'students' },
    ownFilter: ownStudentLinks,
  });

  // ── Staff ────────────────────────────────────────────────────
  R('departments', {
    table: 'staff_departments', perm: 'staff', search: ['name'],
    fields: ['name'], schema: z.object({ name: s(96) }),
  });
  R('staff-profiles', {
    table: 'staff_profiles', perm: 'staff', search: ['job_title', 'employee_number'],
    filter: ['department_id', 'employment_status', 'school_user_id'],
    fields: ['school_user_id', 'job_title', 'department_id', 'hire_date', 'employee_number', 'employment_status'],
    schema: z.object({
      school_user_id: uuid, job_title: trimStr(96).optional(), department_id: optionalId,
      hire_date: z.string().optional(), employee_number: trimStr(32).optional(),
      employment_status: z.enum(['active', 'on_leave', 'terminated']).optional(),
    }),
    refs: { school_user_id: 'school_users', department_id: 'staff_departments' },
  });
  R('staff-attendance', {
    table: 'staff_attendance', perm: 'staff', feature: 'attendance', search: [],
    filter: ['school_user_id', 'attendance_date', 'attendance_status'],
    fields: ['school_user_id', 'attendance_date', 'attendance_status', 'remarks'],
    schema: z.object({
      school_user_id: uuid, attendance_date: s(12),
      attendance_status: z.enum(['present', 'absent', 'late', 'excused']), remarks: trimStr(255).optional(),
    }),
    beforeCreate: async (p, req) => { p.marked_by = req.auth.userId; return p; },
    refs: { school_user_id: 'school_users' },
  });
  R('leave-requests', {
    table: 'leave_requests', perm: 'staff', search: ['reason'], filter: ['status', 'school_user_id'],
    fields: ['school_user_id', 'leave_type', 'start_date', 'end_date', 'reason', 'status'],
    schema: z.object({
      school_user_id: uuid, leave_type: trimStr(32).optional(), start_date: z.string().optional(),
      end_date: z.string().optional(), reason: trimStr(500).optional(),
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
    }),
    refs: { school_user_id: 'school_users' },
  });

  // ── Examinations & grading ───────────────────────────────────
  R('examination-types', {
    table: 'examination_types', perm: 'examinations', feature: 'examinations', search: ['name'],
    fields: ['name', 'description'], schema: z.object({ name: s(64), description: trimStr(255).optional() }),
  });
  R('exam-class-subjects', {
    table: 'exam_class_subjects', perm: 'examinations', feature: 'examinations',
    filter: ['examination_id', 'class_id', 'subject_id'],
    fields: ['examination_id', 'class_id', 'subject_id', 'total_marks'],
    schema: z.object({ examination_id: uuid, class_id: uuid, subject_id: uuid, total_marks: money.default(100) }),
    refs: { examination_id: 'examinations', class_id: 'classes', subject_id: 'subjects' },
  });
  R('examination-components', {
    table: 'examination_components', perm: 'examinations', feature: 'examinations',
    filter: ['exam_class_subject_id'], search: ['name'],
    fields: ['exam_class_subject_id', 'name', 'weight_percent', 'maximum_marks'],
    schema: z.object({ exam_class_subject_id: uuid, name: s(64), weight_percent: money.default(100), maximum_marks: money.default(100) }),
    refs: { exam_class_subject_id: 'exam_class_subjects' },
  });
  R('examination-schedules', {
    table: 'examination_schedules', perm: 'examinations', feature: 'examinations',
    filter: ['exam_class_subject_id', 'classroom_id'],
    fields: ['exam_class_subject_id', 'exam_date', 'start_time', 'end_time', 'classroom_id'],
    schema: z.object({ exam_class_subject_id: uuid, exam_date: s(12), start_time: z.string().optional(), end_time: z.string().optional(), classroom_id: optionalId }),
    refs: { exam_class_subject_id: 'exam_class_subjects', classroom_id: 'classrooms' },
  });
  R('examination-invigilators', {
    table: 'examination_invigilators', perm: 'examinations', filter: ['schedule_id', 'school_user_id'],
    fields: ['schedule_id', 'school_user_id'],
    schema: z.object({ schedule_id: uuid, school_user_id: uuid }),
    refs: { schedule_id: 'examination_schedules', school_user_id: 'school_users' },
  });
  R('grade-scales', {
    table: 'grade_scales', perm: 'examinations', search: ['name'], filter: ['is_default'],
    fields: ['name', 'is_default'], schema: z.object({ name: s(64), is_default: z.boolean().optional() }),
  });
  R('grade-ranges', {
    table: 'grade_ranges', perm: 'examinations', filter: ['grade_scale_id'], search: ['grade_label'],
    fields: ['grade_scale_id', 'grade_label', 'min_percent', 'max_percent', 'remark'],
    schema: z.object({ grade_scale_id: uuid, grade_label: s(8), min_percent: money, max_percent: money, remark: trimStr(120).optional() }),
    refs: { grade_scale_id: 'grade_scales' },
  });
  R('result-approvals', {
    table: 'result_approvals', perm: 'results', filter: ['examination_id', 'status', 'class_id'], readonly: false,
    select: '*, examinations(name, status), classes(name), subjects(name)',
    fields: ['examination_id', 'class_id', 'subject_id', 'status'],
    schema: z.object({ examination_id: uuid, class_id: optionalId, subject_id: optionalId, status: z.enum(['pending', 'approved', 'rejected']).optional() }),
    refs: { examination_id: 'examinations', class_id: 'classes', subject_id: 'subjects' },
    staffOnly: true,
  });

  // ── School finance (student fees) ────────────────────────────
  R('fee-categories', {
    table: 'fee_categories', perm: 'finance', feature: 'fees', search: ['name'], filter: ['is_examination_fee'],
    fields: ['name', 'description', 'is_examination_fee'],
    schema: z.object({ name: s(96), description: trimStr(255).optional(), is_examination_fee: z.boolean().optional() }),
  });
  R('fee-structures', {
    table: 'fee_structures', perm: 'finance', feature: 'fees', filter: ['category_id', 'class_id', 'academic_year_id', 'term_id', 'is_active'],
    fields: ['category_id', 'academic_year_id', 'term_id', 'class_id', 'amount', 'due_date', 'is_active'],
    schema: z.object({
      category_id: uuid, academic_year_id: optionalId, term_id: optionalId, class_id: optionalId,
      amount: money, due_date: z.string().optional(), is_active: z.boolean().optional(),
    }),
    refs: { category_id: 'fee_categories', academic_year_id: 'academic_years', term_id: 'terms', class_id: 'classes' },
  });
  R('expense-categories', {
    table: 'expense_categories', perm: 'finance', feature: 'fees', search: ['name'],
    fields: ['name'], schema: z.object({ name: s(96) }),
  });
  R('expenses', {
    table: 'expenses', perm: 'finance', feature: 'fees', search: ['title'],
    filter: ['category_id', 'status', 'expense_date'],
    fields: ['category_id', 'title', 'description', 'amount', 'currency', 'expense_date', 'evidence_url', 'status'],
    schema: z.object({
      category_id: optionalId, title: s(160), description: trimStr(1000).optional(), amount: money,
      currency: trimStr(8).optional(), expense_date: z.string().optional(),
      evidence_url: z.string().url().optional(),
      status: z.enum(['pending_approval', 'approved', 'rejected', 'paid']).optional(),
    }),
    beforeCreate: async (p, req) => { p.requested_by = req.auth.userId; return p; },
    refs: { category_id: 'expense_categories' },
    staffOnly: true,
  });
  R('financial-approvals', {
    table: 'financial_approvals', perm: 'finance', filter: ['entity_type', 'status', 'entity_id'],
    fields: ['entity_type', 'entity_id', 'action', 'status', 'reason'],
    schema: z.object({ entity_type: s(32), entity_id: uuid, action: s(32), status: z.enum(['pending', 'approved', 'rejected']).optional(), reason: trimStr(500).optional() }),
    staffOnly: true,
  });

  // ── Digital learning ─────────────────────────────────────────
  // A video lesson is never uploaded: the teacher hosts it on Google Drive and pastes the share
  // link, so `material_type: 'video'` requires a drive.google.com/docs.google.com `link_url` and
  // must not carry an uploaded file. Documents/slides may attach a file, a link, or both.
  const DRIVE_LINK = /^https:\/\/(drive|docs)\.google\.com\/\S+/i;
  const assertLessonShape = (payload) => {
    if (payload.link_url !== undefined && payload.link_url !== null && payload.link_url !== '') {
      if (!DRIVE_LINK.test(String(payload.link_url))) {
        throw new ApiError(400, 'A video link must be a Google Drive share URL (https://drive.google.com/… or https://docs.google.com/…). Upload the video to Drive first, then paste its share link.');
      }
    }
    if (payload.material_type === 'video') {
      if (!payload.link_url) throw new ApiError(400, 'A video lesson needs a Google Drive share link.');
      if (payload.file_path) throw new ApiError(400, 'Videos are shared as a Google Drive link, not uploaded as a file.');
    }
    return payload;
  };
  R('learning-materials', {
    table: 'learning_materials', perm: 'learning', feature: 'digital.learning',
    search: ['title'], filter: ['class_id', 'subject_id', 'material_type'],
    select: '*, classes(name), subjects(name)',
    fields: ['class_id', 'subject_id', 'title', 'description', 'material_type', 'file_path', 'file_name', 'size_bytes', 'link_url', 'is_published'],
    schema: z.object({
      class_id: optionalId, subject_id: optionalId, title: s(200), description: trimStr(2000).optional(),
      material_type: z.enum(['document', 'presentation', 'video', 'note']).optional(),
      file_path: z.string().optional(), file_name: trimStr(255).optional(),
      size_bytes: z.coerce.number().int().optional(),
      link_url: z.string().trim().max(2000).optional(),
      is_published: z.boolean().optional(),
    }),
    beforeCreate: async (p, req) => { assertLessonShape(p); p.teacher_id = req.auth.userId; return p; },
    beforeUpdate: async (p) => assertLessonShape(p),
    refs: { class_id: 'classes', subject_id: 'subjects' },
    modifyQuery: (q, req) => (isPortalOnly(req.auth) ? q.eq('is_published', true) : q),
    ownFilter: (req) => portalClassFilter(req.auth),
  });
  R('assignments', {
    table: 'assignments', perm: 'learning', feature: 'digital.learning',
    search: ['title'], filter: ['class_id', 'subject_id', 'status'],
    select: '*, classes(name), subjects(name)',
    fields: ['class_id', 'subject_id', 'title', 'instructions', 'due_date', 'maximum_marks', 'status'],
    schema: z.object({
      class_id: uuid, subject_id: optionalId, title: s(200), instructions: trimStr(4000).optional(),
      due_date: z.string().optional(), maximum_marks: money.default(100),
      status: z.enum(['open', 'closed', 'archived']).optional(),
    }),
    beforeCreate: async (p, req) => { p.teacher_id = req.auth.userId; return p; },
    refs: { class_id: 'classes', subject_id: 'subjects' },
    ownFilter: (req) => portalClassFilter(req.auth),
  });
  R('assignment-attachments', {
    table: 'assignment_attachments', perm: 'learning', filter: ['assignment_id'],
    fields: ['assignment_id', 'file_path', 'file_name', 'size_bytes'],
    schema: z.object({ assignment_id: uuid, file_path: s(512), file_name: trimStr(255).optional(), size_bytes: z.coerce.number().int().optional() }),
    refs: { assignment_id: 'assignments' },
  });

  // ── Communication & support ──────────────────────────────────
  R('announcements', {
    table: 'announcements', perm: 'announcements', search: ['title'], filter: ['audience', 'class_id', 'status'],
    select: '*, classes(name)',
    fields: ['audience', 'class_id', 'title', 'body', 'published_at', 'status'],
    schema: z.object({
      audience: z.enum(['all', 'students', 'parents', 'teachers', 'staff', 'class']).optional(),
      class_id: optionalId, title: s(200), body: trimStr(5000).optional(),
      published_at: z.string().optional(), status: z.enum(['draft', 'published', 'archived']).optional(),
    }),
    beforeCreate: async (p, req) => { p.created_by = req.auth.userId; return p; },
    refs: { class_id: 'classes' },
    modifyQuery: (q, req) => (isPortalOnly(req.auth) ? q.eq('status', 'published') : q),
    // School-wide notices plus the portal account's own class; never another class's notices.
    ownFilter: async (req) => {
      const ids = await portalClassIds(req.auth);
      if (ids === null) return null;
      return { $or: ids.length ? `class_id.is.null,class_id.in.(${ids.join(',')})` : 'class_id.is.null' };
    },
  });

  // ── Extra modules ────────────────────────────────────────────
  R('certificate-templates', {
    table: 'certificate_templates', perm: 'certificates', feature: 'certificates', search: ['name'], filter: ['template_type'],
    fields: ['name', 'template_type', 'body_html'],
    schema: z.object({ name: s(96), template_type: z.enum(['certificate', 'transcript', 'admission_letter', 'id_card']).optional(), body_html: z.string().optional() }),
  });
  R('library-books', {
    table: 'library_books', perm: 'library', feature: 'library', search: ['title', 'author', 'isbn'], filter: ['category'],
    fields: ['title', 'author', 'isbn', 'category', 'total_copies', 'available_copies'],
    schema: z.object({ title: s(200), author: trimStr(120).optional(), isbn: trimStr(32).optional(), category: trimStr(64).optional(), total_copies: z.coerce.number().int().default(1), available_copies: z.coerce.number().int().optional() }),
    beforeCreate: async (p) => { if (p.available_copies == null) p.available_copies = p.total_copies; return p; },
  });
  R('discipline-records', {
    table: 'discipline_records', perm: 'discipline', feature: 'discipline',
    search: ['incident_type'], filter: ['student_id', 'status', 'incident_date'],
    fields: ['student_id', 'incident_date', 'incident_type', 'description', 'action_taken', 'follow_up', 'status'],
    schema: z.object({
      student_id: uuid, incident_date: z.string().optional(), incident_type: trimStr(64).optional(),
      description: trimStr(4000).optional(), action_taken: trimStr(1000).optional(),
      follow_up: trimStr(1000).optional(), status: z.enum(['open', 'under_review', 'resolved']).optional(),
    }),
    beforeCreate: async (p, req) => { p.reported_by = req.auth.userId; return p; },
    refs: { student_id: 'students' },
  });
  R('transport-vehicles', {
    table: 'transport_vehicles', perm: 'transport', feature: 'transport', search: ['plate_number'], filter: ['status'],
    fields: ['plate_number', 'vehicle_type', 'capacity', 'status'],
    schema: z.object({ plate_number: s(32), vehicle_type: trimStr(32).optional(), capacity: z.coerce.number().int().optional(), status: z.enum(['active', 'maintenance', 'retired']).optional() }),
  });
  R('transport-drivers', {
    table: 'transport_drivers', perm: 'transport', feature: 'transport', search: ['full_name', 'phone'], filter: ['status'],
    fields: ['full_name', 'phone', 'license_number', 'status'],
    schema: z.object({ full_name: s(160), phone: trimStr(32).optional(), license_number: trimStr(64).optional(), status: z.enum(['active', 'inactive']).optional() }),
  });
  R('transport-routes', {
    table: 'transport_routes', perm: 'transport', feature: 'transport', search: ['name'], filter: ['status', 'vehicle_id'],
    fields: ['name', 'description', 'vehicle_id', 'driver_id', 'monthly_fee', 'schedule', 'status'],
    schema: z.object({ name: s(96), description: trimStr(500).optional(), vehicle_id: optionalId, driver_id: optionalId, monthly_fee: z.coerce.number().optional(), schedule: trimStr(500).optional(), status: z.enum(['active', 'inactive']).optional() }),
  });
  R('student-transport-assignments', {
    table: 'student_transport_assignments', perm: 'transport', feature: 'transport', filter: ['student_id', 'route_id', 'fee_status'],
    fields: ['student_id', 'route_id', 'pickup_point', 'fee_status'],
    schema: z.object({ student_id: uuid, route_id: uuid, pickup_point: trimStr(120).optional(), fee_status: z.enum(['unpaid', 'paid', 'partial']).optional() }),
    refs: { student_id: 'students', route_id: 'transport_routes' },
  });
  R('lab-equipment', {
    table: 'lab_equipment', perm: 'lab', search: ['name', 'category'], filter: ['condition', 'category'],
    fields: ['name', 'category', 'quantity', 'condition', 'location', 'notes'],
    schema: z.object({ name: s(160), category: trimStr(64).optional(), quantity: z.coerce.number().int().default(1), condition: z.enum(['available', 'in_use', 'damaged', 'maintenance']).optional(), location: trimStr(96).optional(), notes: trimStr(500).optional() }),
  });
  R('equipment-allocations', {
    table: 'equipment_allocations', perm: 'lab', filter: ['equipment_id', 'status'], search: ['allocated_to'],
    fields: ['equipment_id', 'allocated_to', 'returned_at', 'status'],
    schema: z.object({ equipment_id: uuid, allocated_to: trimStr(160).optional(), returned_at: z.string().optional(), status: z.enum(['allocated', 'returned']).optional() }),
    refs: { equipment_id: 'lab_equipment' },
  });
  R('visitors', {
    table: 'visitors', perm: 'reception', search: ['full_name', 'purpose'], filter: ['visiting_whom'],
    fields: ['full_name', 'phone', 'purpose', 'visiting_whom', 'check_out_at'],
    schema: z.object({ full_name: s(160), phone: trimStr(32).optional(), purpose: trimStr(200).optional(), visiting_whom: trimStr(160).optional(), check_out_at: z.string().optional() }),
    beforeCreate: async (p, req) => { p.recorded_by = req.auth.userId; return p; },
  });
  R('appointments', {
    table: 'appointments', perm: 'reception', search: ['visitor_name'], filter: ['appointment_date', 'status', 'department'],
    fields: ['visitor_name', 'department', 'appointment_date', 'notes', 'status'],
    schema: z.object({ visitor_name: s(160), department: trimStr(96).optional(), appointment_date: s(12), notes: trimStr(500).optional(), status: z.enum(['scheduled', 'done', 'cancelled']).optional() }),
  });

  // ── Records written by the business flows, listed/edited here ─
  // examinations: creation goes through POST /examinations (examRouter) so scopes stay atomic.
  R('examinations', {
    table: 'examinations', perm: 'examinations', readonly: true,
    select: '*, examination_types(name), academic_years(name), terms(name)',
    search: ['name'], filter: ['status', 'examination_type_id', 'academic_year_id', 'term_id'],
    // Drafts and archived exams stay internal; portals only ever see work that has been released.
    modifyQuery: (q, req) => (isPortalOnly(req.auth) ? q.in('status', ['scheduled', 'in_progress', 'completed', 'published']) : q),
  });
  R('marks', {
    table: 'marks', perm: 'marks', feature: 'examinations',
    select: '*, students(id, full_name, admission_number), subjects(name), classes(name), examinations(name, status)',
    search: [],
    filter: ['examination_id', 'exam_class_subject_id', 'component_id', 'student_id', 'subject_id', 'class_id', 'approval_status'],
    fields: ['examination_id', 'exam_class_subject_id', 'component_id', 'student_id', 'subject_id', 'class_id', 'marks_obtained', 'maximum_marks'],
    schema: z.object({
      examination_id: uuid, exam_class_subject_id: uuid, component_id: optionalId, student_id: uuid,
      subject_id: optionalId, class_id: optionalId, marks_obtained: money, maximum_marks: z.coerce.number().min(0.01),
    }),
    beforeCreate: async (p, req) => { p.entered_by = req.auth.userId; p.approval_status = 'draft'; return p; },
    refs: {
      examination_id: 'examinations', exam_class_subject_id: 'exam_class_subjects', component_id: 'examination_components',
      student_id: 'students', subject_id: 'subjects', class_id: 'classes',
    },
    beforeUpdate: async (p, req) => {
      // Editing an approved line sends it back to draft for re-review.
      if (p.marks_obtained !== undefined || p.maximum_marks !== undefined) { p.entered_by = req.auth.userId; p.approval_status = 'draft'; }
      return p;
    },
    ownFilter: ownStudentLinks,
  });
  R('attendance-sessions', {
    table: 'attendance_sessions', perm: 'attendance', readonly: true,
    select: '*, classes(name), subjects(name)',
    search: [], filter: ['class_id', 'subject_id', 'session_date', 'session_type', 'status'],
    orderBy: 'session_date.desc',
    staffOnly: true,
  });
  R('attendance-records', {
    table: 'attendance_records', perm: 'attendance', readonly: true,
    select: '*, students(id, full_name, admission_number), classes(name), subjects(name)',
    search: [],
    filter: ['student_id', 'class_id', 'subject_id', 'session_id', 'attendance_status'],
    orderBy: 'attendance_date.desc',
    modifyQuery: (q, req) => (req.query.attendance_date ? q.eq('attendance_date', req.query.attendance_date) : q),
    ownFilter: ownStudentLinks,
  });
  R('attendance-corrections', {
    table: 'attendance_corrections', perm: 'attendance', readonly: true,
    select: '*, students(id, full_name, admission_number), attendance_records(attendance_date, attendance_status)',
    search: [], filter: ['status', 'student_id'],
    orderBy: 'created_at.desc',
    ownFilter: ownStudentLinks,
  });
  R('fee-payments', {
    table: 'fee_payments', perm: 'finance', readonly: true,
    select: '*, students(id, full_name, admission_number), fee_invoices(invoice_number), receipts(receipt_number)',
    search: ['transaction_reference', 'provider_reference'],
    filter: ['student_id', 'invoice_id', 'status', 'payment_method', 'reversed'],
    orderBy: 'paid_at.desc',
    modifyQuery: (q, req) => {
      let next = q;
      if (req.query.from) next = next.gte('paid_at', req.query.from);
      if (req.query.to) next = next.lte('paid_at', `${req.query.to}T23:59:59`);
      return next;
    },
    ownFilter: ownStudentLinks,
  });
  R('fee-invoices', {
    table: 'fee_invoices', perm: 'finance',
    select: '*, students(id, full_name, admission_number), terms(name)',
    search: ['invoice_number'], filter: ['student_id', 'status', 'term_id'],
    fields: ['student_id', 'term_id', 'subtotal', 'discount', 'total', 'balance', 'currency', 'due_date', 'status'],
    schema: z.object({
      student_id: uuid, term_id: optionalId, subtotal: money.optional(), discount: money.optional(),
      total: money.optional(), balance: money.optional(), currency: trimStr(8).optional(),
      due_date: z.string().optional(), status: z.enum(['open', 'partial', 'paid', 'void']).optional(),
    }),
    refs: { student_id: 'students', term_id: 'terms' },
    beforeCreate: async (p) => { if (!p.invoice_number) throw new ApiError(400, 'Invoices are issued by the finance flow (POST /finance/assign-fees)'); return p; },
    ownFilter: ownStudentLinks,
  });
  R('student-fee-assignments', {
    table: 'student_fee_assignments', perm: 'finance',
    select: '*, students(id, full_name, admission_number, class_id), fee_structures(id, amount, due_date, category_id, fee_categories(name, is_examination_fee))',
    search: [],
    filter: ['student_id', 'fee_structure_id', 'status'],
    fields: ['student_id', 'fee_structure_id', 'amount', 'discount', 'status'],
    schema: z.object({
      student_id: uuid, fee_structure_id: uuid, amount: money,
      discount: money.optional(), status: z.enum(['outstanding', 'partial', 'paid', 'waived']).optional(),
    }),
    refs: { student_id: 'students', fee_structure_id: 'fee_structures' },
    ownFilter: ownStudentLinks,
  });
  R('receipts', {
    table: 'receipts', perm: 'finance', readonly: true,
    select: '*, students(id, full_name, admission_number), fee_payments(transaction_reference, payment_method, paid_at, status)',
    search: ['receipt_number'], filter: ['student_id', 'payment_id'],
    ownFilter: ownStudentLinks,
  });
  R('examination-clearances', {
    table: 'examination_clearances', perm: 'finance', readonly: true,
    select: '*, students(id, full_name, admission_number), examinations(name, status)',
    search: [], filter: ['student_id', 'examination_id', 'status'],
    ownFilter: ownStudentLinks,
  });
  R('library-transactions', {
    table: 'library_transactions', perm: 'library', feature: 'library',
    select: '*, library_books(id, title, author, total_copies, available_copies), students(id, full_name, admission_number), school_users(id, full_name)',
    search: [],
    filter: ['book_id', 'student_id', 'school_user_id', 'borrower_type', 'status'],
    fields: ['book_id', 'borrower_type', 'student_id', 'school_user_id', 'due_date', 'returned_at', 'status', 'remarks'],
    schema: z.object({
      book_id: uuid, borrower_type: z.enum(['student', 'staff']).default('student'),
      student_id: optionalId, school_user_id: optionalId, due_date: z.string().optional(),
      returned_at: z.string().optional(),
      status: z.enum(['borrowed', 'returned', 'overdue', 'lost', 'damaged']).optional(),
      remarks: trimStr(500).optional(),
    }),
    refs: { book_id: 'library_books', student_id: 'students', school_user_id: 'school_users' },
    afterCreate: async (row) => {
      if (['borrowed', 'overdue'].includes(row.status)) await adjustCopies(row.book_id, -1);
    },
    beforeUpdate: async (p, req) => {
      if (!p.status) return p;
      const { data: prev } = await db().from('library_transactions').select('book_id, status').eq('id', req.params.id).maybeSingle();
      if (!prev) return p;
      const wasOut = ['borrowed', 'overdue'].includes(prev.status);
      const isOut = ['borrowed', 'overdue'].includes(p.status);
      if (wasOut && !isOut) await adjustCopies(prev.book_id, 1);
      if (!wasOut && isOut) await adjustCopies(prev.book_id, -1);
      if (p.status === 'returned' && !p.returned_at) p.returned_at = new Date().toISOString();
      return p;
    },
  });
  R('certificates', {
    table: 'certificates', perm: 'certificates', readonly: true,
    select: '*, students(id, full_name, admission_number), certificate_templates(name)',
    search: ['reference_number'], filter: ['student_id', 'certificate_type', 'status'],
    ownFilter: ownStudentLinks,
  });
  R('student-id-cards', {
    table: 'student_id_cards', perm: 'students', readonly: true,
    select: '*, students(id, full_name, admission_number, class_id, classes(name))',
    search: ['verification_code'],
    filter: ['student_id', 'academic_year'],
    ownFilter: ownStudentLinks,
  });
  R('assignment-submissions', {
    table: 'assignment_submissions', perm: 'learning',
    select: '*, assignments(title, due_date, maximum_marks, class_id), students(id, full_name, admission_number, class_id), assignment_grades(marks, feedback, graded_by)',
    search: [], filter: ['assignment_id', 'student_id', 'is_late'],
    fields: ['assignment_id', 'student_id', 'note', 'file_path', 'file_name', 'is_late'],
    schema: z.object({
      assignment_id: uuid, student_id: uuid, note: trimStr(4000).optional(),
      file_path: z.string().optional(), file_name: trimStr(255).optional(), is_late: z.boolean().optional(),
    }),
    beforeCreate: async (p) => {
      const { data: a } = await db().from('assignments').select('due_date').eq('id', p.assignment_id).maybeSingle();
      if (a?.due_date && p.is_late === undefined) p.is_late = new Date() > new Date(`${a.due_date}T23:59:59`);
      return p;
    },
    refs: { assignment_id: 'assignments', student_id: 'students' },
    ownFilter: ownStudentLinks,
  });
  R('assignment-grades', {
    table: 'assignment_grades', perm: 'learning',
    select: '*, assignment_submissions(student_id, assignment_id, students(full_name, admission_number)), assignments(title)',
    search: ['feedback'], filter: ['submission_id', 'assignment_id', 'student_id'],
    fields: ['submission_id', 'assignment_id', 'student_id', 'marks', 'feedback'],
    schema: z.object({
      submission_id: uuid, assignment_id: optionalId, student_id: optionalId,
      marks: money.optional(), feedback: trimStr(2000).optional(),
    }),
    beforeCreate: async (p, req) => { p.graded_by = req.auth.userId; return p; },
    refs: { submission_id: 'assignment_submissions', assignment_id: 'assignments', student_id: 'students' },
    ownFilter: ownStudentLinks,
  });
}

/** Keep library_books.available_copies in step with active loans. */
async function adjustCopies(bookId, delta) {
  const { data: book } = await db().from('library_books').select('id, available_copies, total_copies').eq('id', bookId).maybeSingle();
  if (!book) return;
  const next = Math.max(0, Math.min(Number(book.total_copies), Number(book.available_copies) + delta));
  await db().from('library_books').update({ available_copies: next }).eq('id', book.id);
}
