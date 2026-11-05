/**
 * Module registry driving the config-driven EntityPage.
 * Field/column labels are derived from the database column name and can be translated
 * with `fields.<name>` / `columns.<name>` keys, or overridden with an explicit `label`.
 */
import { StatusBadge } from '../components/ui/Basics.jsx';

export const humanize = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const F = (name, type = 'text', extra = {}) => ({ name, type, ...extra });
export const C = (name, extra = {}) => ({ key: name, label: extra.label || humanize(name), ...extra });

/** Relation select: options are loaded from `resource` and shown using `labelKey`. */
export const rel = (name, resource, labelKey = 'name', extra = {}) => ({
  name, type: 'relation', resource, labelKey, ...extra,
});

/** Column that reads a value from an embedded relation, e.g. emb('Student', 'students', 'full_name'). */
export const emb = (label, path, field, extra = {}) => {
  const { label: _l, render: customRender, ...rest } = extra;
  return {
    key: `${path}.${field}`,
    label: label || humanize(field),
    ...rest,
    render: customRender || ((row) => {
      const value = row[path]?.[field];
      if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
      if (rest.type === 'status') return <StatusBadge value={value} />;
      if (rest.type === 'date') return String(value).slice(0, 10);
      if (rest.type === 'datetime') return new Date(value).toLocaleString();
      if (rest.type === 'boolean') return value ? 'Yes' : 'No';
      return String(value);
    }),
  };
};

const GENDERS = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }];
const AUDIENCES = ['all', 'students', 'parents', 'teachers', 'staff', 'class'].map((v) => ({ value: v, label: humanize(v) }));
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((v) => ({ value: v, label: v }));

/** api path prefix is `/m/<key>` in the router; `api` is the backend resource path. */
export const RESOURCES = {
  'academic-years': {
    api: '/academic-years', perm: 'timetable', search: 'name',
    columns: [C('name'), C('start_date', { type: 'date' }), C('end_date', { type: 'date' }), C('is_current', { type: 'boolean' })],
    fields: [F('name', 'text', { required: true }), F('start_date', 'date', { required: true }), F('end_date', 'date'), F('is_current', 'checkbox')],
  },
  terms: {
    api: '/terms', perm: 'timetable', search: 'name',
    columns: [C('name'), C('academic_year_id', { label: 'Academic year' }), C('start_date', { type: 'date' }), C('end_date', { type: 'date' }), C('is_current', { type: 'boolean' })],
    fields: [rel('academic_year_id', 'academic-years', 'name', { required: true }), F('name', 'text', { required: true }), F('start_date', 'date'), F('end_date', 'date'), F('is_current', 'checkbox')],
  },
  classes: {
    api: '/classes', perm: 'students', search: 'name',
    columns: [C('name'), C('level'), C('capacity', { type: 'number' })],
    fields: [F('name', 'text', { required: true }), F('level'), F('capacity', 'number')],
  },
  sections: {
    api: '/sections', perm: 'students', search: 'name', filter: { class_id: 'classes' },
    columns: [C('name'), emb('Class', 'classes', 'name'), C('capacity', { type: 'number' })],
    fields: [rel('class_id', 'classes', 'name', { required: true }), F('name', 'text', { required: true }), F('capacity', 'number')],
  },
  subjects: {
    api: '/subjects', perm: 'students', search: 'name',
    columns: [C('name'), C('code')],
    fields: [F('name', 'text', { required: true }), F('code')],
  },
  'class-subjects': {
    api: '/class-subjects', perm: 'students',
    columns: [emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name')],
    fields: [rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name', { required: true })],
  },
  classrooms: {
    api: '/classrooms', perm: 'timetable', search: 'name',
    columns: [C('name'), C('capacity', { type: 'number' })],
    fields: [F('name', 'text', { required: true }), F('capacity', 'number')],
  },
  'teacher-assignments': {
    api: '/teacher-assignments', perm: 'teachers', filter: { class_id: 'classes' },
    columns: [C('school_user_id', { label: 'Teacher' }), C('class_id', { label: 'Class' }), C('subject_id', { label: 'Subject' }), C('is_homeroom', { type: 'boolean' })],
    fields: [rel('school_user_id', '/school/teachers', 'full_name', { required: true }), rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name'), F('is_homeroom', 'checkbox')],
  },
  'timetable-periods': {
    api: '/timetable-periods', perm: 'timetable', search: 'name',
    columns: [C('name'), C('start_time'), C('end_time'), C('sort_order', { type: 'number' })],
    fields: [F('name', 'text', { required: true }), F('start_time', 'text', { placeholder: '08:00' }), F('end_time', 'text', { placeholder: '09:00' }), F('sort_order', 'number')],
  },
  'timetable-entries': {
    api: '/timetable-entries', perm: 'timetable', filter: { class_id: 'classes', day_of_week: 'day' },
    columns: [
      C('day_of_week', { label: 'Day' }), emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name'),
      emb('Period', 'timetable_periods', 'name'), emb('Teacher', 'school_users', 'full_name'), emb('Classroom', 'classrooms', 'name'),
    ],
    fields: [
      rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name', { required: true }),
      rel('teacher_id', 'teacher-assignments', 'id'), F('day_of_week', 'select', { options: WEEK_DAYS, required: true }),
      rel('period_id', 'timetable-periods', 'name', { required: true }), rel('classroom_id', 'classrooms', 'name'),
      rel('academic_year_id', 'academic-years', 'name'),
    ],
  },
  students: {
    api: '/students', perm: 'students', search: 'full_name', filter: { class_id: 'classes', status: 'status' },
    columns: [C('admission_number'), C('full_name'), C('gender'), emb('Class', 'classes', 'name'), emb('Section', 'sections', 'name'), C('status', { type: 'status' })],
    fields: [
      F('first_name', 'text', { required: true }), F('middle_name'), F('last_name'),
      F('admission_number', 'text', { help: 'Leave empty to generate automatically' }),
      F('gender', 'select', { options: GENDERS, required: true }), F('date_of_birth', 'date'),
      F('admission_date', 'date'), F('address'), F('emergency_contact', 'text', { help: 'Phone number of a contact person' }),
      F('previous_school'), F('photo_url', 'image', { help: 'Upload a JPG, PNG or WebP photo (max 3 MB)' }),
      rel('class_id', 'classes', 'name'), rel('section_id', 'sections', 'name'),
      rel('academic_year_id', 'academic-years', 'name'),
      F('status', 'select', { options: ['active', 'inactive', 'transferred', 'withdrawn', 'graduated'].map((v) => ({ value: v, label: humanize(v) })) }),
    ],
  },
  guardians: {
    api: '/guardians', perm: 'guardians', search: 'full_name',
    columns: [C('full_name'), C('phone'), C('email'), C('relationship')],
    fields: [F('full_name', 'text', { required: true }), F('phone'), F('email'), F('address'), F('relationship'), F('occupation'), F('gender', 'select', { options: GENDERS })],
  },
  'student-guardians': {
    api: '/student-guardians', perm: 'guardians', filter: { student_id: 'students' },
    columns: [C('student_id', { label: 'Student' }), C('guardian_id', { label: 'Guardian' }), C('relationship'), C('is_primary', { type: 'boolean' })],
    fields: [rel('student_id', 'students', 'full_name', { required: true }), rel('guardian_id', 'guardians', 'full_name', { required: true }), F('relationship'), F('is_primary', 'checkbox')],
  },
  'student-documents': {
    api: '/student-documents', perm: 'students', filter: { student_id: 'students' },
    columns: [C('file_name'), C('document_type'), C('uploaded_at', { type: 'datetime' })],
    fields: [rel('student_id', 'students', 'full_name', { required: true }), F('document_type', 'text', { required: true }), F('file_name', 'text', { required: true }), F('file_path', 'text', { required: true, help: 'Storage path or public URL' }), F('mime_type'), F('size_bytes', 'number')],
  },
  departments: {
    api: '/departments', perm: 'staff', search: 'name',
    columns: [C('name')], fields: [F('name', 'text', { required: true })],
  },
  'staff-profiles': {
    api: '/staff-profiles', perm: 'staff', search: 'job_title',
    columns: [C('employee_number'), C('job_title'), C('department_id', { label: 'Department' }), C('employment_status', { type: 'status' })],
    fields: [rel('school_user_id', '/school/users', 'full_name', { required: true }), F('job_title', 'text', { required: true }), rel('department_id', 'departments', 'name'), F('employee_number'), F('hire_date', 'date'), F('employment_status', 'select', { options: ['active', 'probation', 'on_leave', 'resigned', 'terminated'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'staff-attendance': {
    api: '/staff-attendance', perm: 'staff', filter: { attendance_status: 'status' },
    columns: [C('school_user_id', { label: 'Staff' }), C('attendance_date', { type: 'date' }), C('attendance_status', { type: 'status' })],
    fields: [rel('school_user_id', '/school/users', 'full_name', { required: true }), F('attendance_date', 'date', { required: true }), F('attendance_status', 'select', { options: ['present', 'absent', 'late', 'on_leave'].map((v) => ({ value: v, label: humanize(v) })), required: true }), F('remarks', 'textarea')],
  },
  'leave-requests': {
    api: '/leave-requests', perm: 'staff', filter: { status: 'status' },
    columns: [C('school_user_id', { label: 'Staff' }), C('leave_type'), C('start_date', { type: 'date' }), C('end_date', { type: 'date' }), C('status', { type: 'status' })],
    fields: [rel('school_user_id', '/school/users', 'full_name', { required: true }), F('leave_type', 'select', { options: ['annual', 'sick', 'maternity', 'unpaid', 'other'].map((v) => ({ value: v, label: humanize(v) })), required: true }), F('start_date', 'date', { required: true }), F('end_date', 'date', { required: true }), F('reason', 'textarea', { col: 12 }), F('status', 'select', { options: ['pending', 'approved', 'rejected'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'examination-types': {
    api: '/examination-types', perm: 'examinations', search: 'name',
    columns: [C('name'), C('description')],
    fields: [F('name', 'text', { required: true }), F('description')],
  },
  'exam-class-subjects': {
    api: '/exam-class-subjects', perm: 'examinations', filter: { examination_id: 'examinations' },
    columns: [C('class_id', { label: 'Class' }), C('subject_id', { label: 'Subject' }), C('total_marks', { type: 'number' })],
    fields: [rel('examination_id', '/examinations', 'name', { required: true }), rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name', { required: true }), F('total_marks', 'number', { required: true })],
  },
  'examination-components': {
    api: '/examination-components', perm: 'examinations', filter: { exam_class_subject_id: 'exam-class-subjects' },
    columns: [C('name'), C('weight_percent', { type: 'number' }), C('maximum_marks', { type: 'number' })],
    fields: [F('exam_class_subject_id', 'text', { required: true, label: 'Exam scope id' }), F('name', 'text', { required: true }), F('weight_percent', 'number'), F('maximum_marks', 'number')],
  },
  'examination-schedules': {
    api: '/examination-schedules', perm: 'examinations',
    columns: [C('exam_date', { type: 'date' }), C('start_time'), C('end_time'), C('classroom_id', { label: 'Classroom' })],
    fields: [F('exam_class_subject_id', 'text', { required: true, label: 'Exam scope id' }), F('exam_date', 'date', { required: true }), F('start_time', 'text', { placeholder: '08:00' }), F('end_time', 'text', { placeholder: '10:00' }), rel('classroom_id', 'classrooms', 'name')],
  },
  'examination-invigilators': {
    api: '/examination-invigilators', perm: 'examinations',
    columns: [C('schedule_id', { label: 'Schedule' }), C('school_user_id', { label: 'Invigilator' })],
    fields: [F('schedule_id', 'text', { required: true }), rel('school_user_id', '/school/users?role=invigilator,teacher', 'full_name', { required: true })],
  },
  'grade-scales': {
    api: '/grade-scales', perm: 'examinations', search: 'name',
    columns: [C('name'), C('is_current', { type: 'boolean' }), C('is_default', { type: 'boolean' })],
    fields: [F('name', 'text', { required: true }), F('is_default', 'checkbox')],
  },
  'grade-ranges': {
    api: '/grade-ranges', perm: 'examinations', filter: { grade_scale_id: 'grade-scales' },
    columns: [C('grade_label'), C('min_percent', { type: 'number' }), C('max_percent', { type: 'number' }), C('remark')],
    fields: [rel('grade_scale_id', 'grade-scales', 'name', { required: true }), F('grade_label', 'text', { required: true }), F('min_percent', 'number', { required: true }), F('max_percent', 'number'), F('remark')],
  },
  'result-approvals': {
    api: '/result-approvals', perm: 'results', filter: { status: 'status' }, readonly: true,
    columns: [C('examination_id', { label: 'Examination' }), C('class_id', { label: 'Class' }), C('subject_id', { label: 'Subject' }), C('status', { type: 'status' })],
    fields: [rel('examination_id', '/examinations', 'name'), rel('class_id', 'classes', 'name'), rel('subject_id', 'subjects', 'name'), F('status', 'select', { options: ['pending', 'approved', 'rejected'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'fee-categories': {
    api: '/fee-categories', perm: 'finance', search: 'name',
    columns: [C('name'), C('is_examination_fee', { type: 'boolean' }), C('description')],
    fields: [F('name', 'text', { required: true }), F('description'), F('is_examination_fee', 'checkbox', { checkLabel: 'This category gates the examination clearance' })],
  },
  'fee-structures': {
    api: '/fee-structures', perm: 'finance', filter: { class_id: 'classes' },
    columns: [C('category_id', { label: 'Category' }), C('class_id', { label: 'Class' }), C('amount', { type: 'money' }), C('due_date', { type: 'date' }), C('is_active', { type: 'boolean' })],
    fields: [rel('category_id', 'fee-categories', 'name', { required: true }), rel('academic_year_id', 'academic-years', 'name'), rel('term_id', 'terms', 'name'), rel('class_id', 'classes', 'name', { required: true }), F('amount', 'money', { required: true }), F('due_date', 'date'), F('is_active', 'checkbox')],
  },
  'expense-categories': {
    api: '/expense-categories', perm: 'finance', search: 'name',
    columns: [C('name')], fields: [F('name', 'text', { required: true })],
  },
  expenses: {
    api: '/expenses', perm: 'finance', search: 'title', filter: { status: 'status' },
    columns: [C('title'), C('amount', { type: 'money' }), C('expense_date', { type: 'date' }), C('status', { type: 'status' })],
    fields: [rel('category_id', 'expense-categories', 'name'), F('title', 'text', { required: true }), F('amount', 'money', { required: true }), F('expense_date', 'date', { required: true }), F('description', 'textarea', { col: 12 }), F('evidence_url', 'text', { placeholder: 'https://…' }), F('status', 'select', { options: ['pending_approval', 'approved', 'rejected', 'paid'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'financial-approvals': {
    api: '/financial-approvals', perm: 'finance', filter: { status: 'status' },
    columns: [C('entity_type'), C('action'), C('status', { type: 'status' }), C('created_at', { type: 'datetime' })],
    fields: [F('entity_type'), F('entity_id'), F('action'), F('status', 'select', { options: ['pending', 'approved', 'rejected'].map((v) => ({ value: v, label: humanize(v) })) }), F('reason', 'textarea', { col: 12 })],
  },
  'learning-materials': {
    api: '/learning-materials', perm: 'learning', search: 'title', filter: { class_id: 'classes', subject_id: 'subjects' },
    columns: [C('title'), C('material_type'), emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name'), C('is_published', { type: 'boolean' }), C('created_at', { type: 'datetime' })],
    fields: [rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name'), F('title', 'text', { required: true }), F('material_type', 'select', { options: ['note', 'slide', 'video', 'pdf', 'link', 'exercise'].map((v) => ({ value: v, label: humanize(v) })) }), F('description', 'textarea', { col: 12 }), F('file_path', 'text', { placeholder: 'URL or storage path' }), F('file_name'), F('is_published', 'checkbox')],
  },
  assignments: {
    api: '/assignments', perm: 'learning', search: 'title', filter: { class_id: 'classes', status: 'status' },
    columns: [C('title'), emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name'), C('due_date', { type: 'date' }), C('maximum_marks', { type: 'number' }), C('status', { type: 'status' })],
    fields: [rel('class_id', 'classes', 'name', { required: true }), rel('subject_id', 'subjects', 'name'), F('title', 'text', { required: true }), F('instructions', 'textarea', { col: 12 }), F('due_date', 'datetime', { required: true }), F('maximum_marks', 'number'), F('status', 'select', { options: ['open', 'closed', 'archived'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  announcements: {
    api: '/announcements', perm: 'announcements', search: 'title', filter: { audience: 'audience' },
    columns: [C('title'), C('audience'), C('published_at', { type: 'datetime' }), C('status', { type: 'status' })],
    fields: [F('title', 'text', { required: true, col: 12 }), F('audience', 'select', { options: AUDIENCES, required: true }), rel('class_id', 'classes', 'name'), F('body', 'textarea', { col: 12 }), F('status', 'select', { options: ['draft', 'published', 'archived'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'certificate-templates': {
    api: '/certificate-templates', perm: 'certificates', search: 'name',
    columns: [C('name'), C('template_type')],
    fields: [F('name', 'text', { required: true }), F('template_type', 'select', { options: ['certificate', 'transcript', 'admission_letter', 'id_card'].map((v) => ({ value: v, label: humanize(v) })) }), F('body_html', 'textarea', { col: 12, rows: 8 })],
  },
  'library-books': {
    api: '/library-books', perm: 'library', search: 'title', filter: { category: 'category' },
    columns: [C('title'), C('author'), C('isbn'), C('available_copies', { type: 'number' }), C('total_copies', { type: 'number' })],
    fields: [F('title', 'text', { required: true }), F('author'), F('isbn'), F('category'), F('total_copies', 'number'), F('available_copies', 'number')],
  },
  'discipline-records': {
    api: '/discipline-records', perm: 'discipline', filter: { status: 'status' },
    columns: [C('student_id', { label: 'Student' }), C('incident_date', { type: 'date' }), C('incident_type'), C('status', { type: 'status' })],
    fields: [rel('student_id', 'students', 'full_name', { required: true }), F('incident_date', 'date', { required: true }), F('incident_type', 'text', { required: true }), F('description', 'textarea', { col: 12 }), F('action_taken', 'textarea', { col: 12 }), F('follow_up'), F('status', 'select', { options: ['open', 'under_review', 'resolved'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'transport-vehicles': {
    api: '/transport-vehicles', perm: 'transport', search: 'plate_number',
    columns: [C('plate_number'), C('vehicle_type'), C('capacity', { type: 'number' }), C('status', { type: 'status' })],
    fields: [F('plate_number', 'text', { required: true }), F('vehicle_type'), F('capacity', 'number'), F('status', 'select', { options: ['active', 'maintenance', 'retired'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'transport-drivers': {
    api: '/transport-drivers', perm: 'transport', search: 'full_name',
    columns: [C('full_name'), C('phone'), C('license_number'), C('status', { type: 'status' })],
    fields: [F('full_name', 'text', { required: true }), F('phone'), F('license_number'), F('status', 'select', { options: ['active', 'inactive'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'transport-routes': {
    api: '/transport-routes', perm: 'transport', search: 'name',
    columns: [C('name'), C('vehicle_id', { label: 'Vehicle' }), C('driver_id', { label: 'Driver' }), C('monthly_fee', { type: 'money' }), C('status', { type: 'status' })],
    fields: [F('name', 'text', { required: true }), rel('vehicle_id', 'transport-vehicles', 'plate_number'), rel('driver_id', 'transport-drivers', 'full_name'), F('monthly_fee', 'money'), F('schedule', 'textarea', { col: 12 }), F('status', 'select', { options: ['active', 'inactive'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'student-transport-assignments': {
    api: '/student-transport-assignments', perm: 'transport', filter: { route_id: 'transport-routes' },
    columns: [C('student_id', { label: 'Student' }), C('route_id', { label: 'Route' }), C('pickup_point'), C('fee_status', { type: 'status' })],
    fields: [rel('student_id', 'students', 'full_name', { required: true }), rel('route_id', 'transport-routes', 'name', { required: true }), F('pickup_point'), F('fee_status', 'select', { options: ['unpaid', 'paid', 'partial'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  'lab-equipment': {
    api: '/lab-equipment', perm: 'lab', search: 'name', filter: { condition: 'condition' },
    columns: [C('name'), C('category'), C('quantity', { type: 'number' }), C('condition', { type: 'status' })],
    fields: [F('name', 'text', { required: true }), F('category'), F('quantity', 'number'), F('condition', 'select', { options: ['available', 'in_use', 'damaged', 'maintenance'].map((v) => ({ value: v, label: humanize(v) })) }), F('location'), F('notes')],
  },
  'equipment-allocations': {
    api: '/equipment-allocations', perm: 'lab', filter: { status: 'status' },
    columns: [C('equipment_id', { label: 'Equipment' }), C('allocated_to'), C('allocated_at', { type: 'datetime' }), C('status', { type: 'status' })],
    fields: [rel('equipment_id', 'lab-equipment', 'name', { required: true }), F('allocated_to', 'text', { required: true }), F('returned_at', 'datetime'), F('status', 'select', { options: ['allocated', 'returned', 'lost', 'damaged'].map((v) => ({ value: v, label: humanize(v) })) })],
  },
  visitors: {
    api: '/visitors', perm: 'reception', search: 'full_name',
    columns: [C('full_name'), C('purpose'), C('visiting_whom'), C('check_in_at', { type: 'datetime' }), C('check_out_at', { type: 'datetime' })],
    fields: [F('full_name', 'text', { required: true }), F('phone'), F('purpose'), F('visiting_whom'), F('check_out_at', 'datetime')],
  },
  appointments: {
    api: '/appointments', perm: 'reception', search: 'visitor_name', filter: { status: 'status' },
    columns: [C('visitor_name', { label: 'Visitor' }), C('department'), C('appointment_date', { type: 'date' }), C('status', { type: 'status' })],
    fields: [F('visitor_name', 'text', { required: true }), F('department'), F('appointment_date', 'date', { required: true }), F('notes', 'textarea', { col: 12 }), F('status', 'select', { options: ['scheduled', 'completed', 'cancelled', 'no_show'].map((v) => ({ value: v, label: humanize(v) })) })],
  },

  // ── Records written by the business flows, listed/edited here ──
  examinations: {
    api: '/examinations', perm: 'examinations', readonly: true, search: 'name',
    filter: { status: ['draft', 'scheduled', 'in_progress', 'completed', 'published', 'archived'], examination_type_id: 'examination-types', academic_year_id: 'academic-years', term_id: 'terms' },
    columns: [
      C('name'), emb('Type', 'examination_types', 'name'), emb('Academic year', 'academic_years', 'name'),
      emb('Term', 'terms', 'name'), C('status', { type: 'status' }), C('created_at', { type: 'datetime' }),
    ],
  },
  marks: {
    api: '/marks', perm: 'marks',
    filter: { approval_status: ['draft', 'submitted', 'approved', 'rejected'], examination_id: '/examinations', class_id: 'classes', subject_id: 'subjects' },
    columns: [
      emb('Student', 'students', 'full_name'), emb('Admission no.', 'students', 'admission_number'),
      emb('Examination', 'examinations', 'name'), emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name'),
      C('marks_obtained', { type: 'number' }), C('maximum_marks', { type: 'number' }), C('approval_status', { type: 'status' }),
    ],
    fields: [
      rel('examination_id', '/examinations', 'name', { required: true }),
      rel('exam_class_subject_id', 'exam-class-subjects', 'id', { required: true, help: 'The class/subject scope created for this examination' }),
      rel('component_id', 'examination-components', 'name'),
      rel('student_id', 'students', 'full_name', { required: true }),
      rel('subject_id', 'subjects', 'name'), rel('class_id', 'classes', 'name'),
      F('marks_obtained', 'number', { required: true }), F('maximum_marks', 'number', { required: true }),
    ],
  },
  'attendance-sessions': {
    api: '/attendance-sessions', perm: 'attendance', readonly: true,
    filter: { class_id: 'classes', subject_id: 'subjects', session_type: ['daily', 'subject'], status: ['open', 'submitted', 'approved'] },
    columns: [
      C('session_date', { type: 'date' }), emb('Class', 'classes', 'name'), emb('Subject', 'subjects', 'name'),
      C('session_type'), C('status', { type: 'status' }),
    ],
  },
  'attendance-records': {
    api: '/attendance-records', perm: 'attendance', readonly: true, exportType: 'attendance-summary',
    filter: { class_id: 'classes', subject_id: 'subjects', attendance_status: ['present', 'absent', 'late', 'excused'] },
    columns: [
      C('attendance_date', { type: 'date' }), emb('Student', 'students', 'full_name'),
      emb('Admission no.', 'students', 'admission_number'), emb('Class', 'classes', 'name'),
      emb('Subject', 'subjects', 'name'), C('attendance_status', { type: 'status' }), C('remarks'),
    ],
  },
  'attendance-corrections': {
    api: '/attendance-corrections', perm: 'attendance', readonly: true,
    filter: { status: ['pending', 'approved', 'rejected'], student_id: 'students' },
    columns: [
      emb('Student', 'students', 'full_name'), emb('Date', 'attendance_records', 'attendance_date', { type: 'date' }),
      C('original_status', { label: 'Recorded', type: 'status' }), C('requested_status', { label: 'Requested', type: 'status' }),
      C('reason'), C('status', { type: 'status' }), C('created_at', { type: 'datetime' }),
    ],
  },
  'fee-payments': {
    api: '/fee-payments', perm: 'finance', readonly: true, search: 'transaction_reference', exportType: 'payments',
    filter: { status: ['pending', 'processing', 'successful', 'failed', 'rejected', 'refunded', 'cancelled'], payment_method: ['cash', 'mobile_money', 'bank', 'other'], student_id: 'students' },
    columns: [
      C('transaction_reference'), emb('Student', 'students', 'full_name'), C('amount', { type: 'money' }),
      C('payment_method'), emb('Invoice', 'fee_invoices', 'invoice_number'), emb('Receipt', 'receipts', 'receipt_number'),
      C('paid_at', { type: 'datetime' }), C('status', { type: 'status' }), C('reversed', { type: 'boolean' }),
    ],
  },
  'fee-invoices': {
    api: '/fee-invoices', perm: 'finance', search: 'invoice_number',
    filter: { status: ['open', 'partial', 'paid', 'void'], student_id: 'students', term_id: 'terms' },
    columns: [
      C('invoice_number'), emb('Student', 'students', 'full_name'), emb('Term', 'terms', 'name'),
      C('subtotal', { type: 'money' }), C('discount', { type: 'money' }), C('total', { type: 'money' }),
      C('balance', { type: 'money' }), C('due_date', { type: 'date' }), C('status', { type: 'status' }),
    ],
    fields: [
      rel('student_id', 'students', 'full_name', { required: true }), rel('term_id', 'terms', 'name'),
      F('subtotal', 'money'), F('discount', 'money'), F('total', 'money', { required: true }),
      F('balance', 'money'), F('currency'), F('due_date', 'date'),
      F('status', 'select', { options: ['open', 'partial', 'paid', 'void'].map((v) => ({ value: v, label: humanize(v) })) }),
    ],
  },
  'student-fee-assignments': {
    api: '/student-fee-assignments', perm: 'finance',
    filter: { status: ['outstanding', 'partial', 'paid', 'waived'], student_id: 'students' },
    columns: [
      emb('Student', 'students', 'full_name'), emb('Category', 'fee_structures', 'fee_categories', { render: (r) => r.fee_structures?.fee_categories?.name || '—' }),
      C('amount', { type: 'money' }), C('discount', { type: 'money' }), C('paid_amount', { type: 'money' }),
      emb('Due date', 'fee_structures', 'due_date', { type: 'date' }), C('status', { type: 'status' }),
    ],
    fields: [
      rel('student_id', 'students', 'full_name', { required: true }),
      rel('fee_structure_id', 'fee-structures', 'id', { required: true, help: 'Pick the fee line from Fee structures' }),
      F('amount', 'money', { required: true }), F('discount', 'money'),
      F('status', 'select', { options: ['outstanding', 'partial', 'paid', 'waived'].map((v) => ({ value: v, label: humanize(v) })) }),
    ],
  },
  receipts: {
    api: '/receipts', perm: 'finance', readonly: true, search: 'receipt_number',
    filter: { student_id: 'students' },
    columns: [
      C('receipt_number'), emb('Student', 'students', 'full_name'), C('amount', { type: 'money' }),
      emb('Reference', 'fee_payments', 'transaction_reference'), emb('Method', 'fee_payments', 'payment_method'),
      C('created_at', { type: 'datetime' }),
    ],
  },
  'examination-clearances': {
    api: '/examination-clearances', perm: 'finance', readonly: true,
    filter: { status: ['not_required', 'unpaid', 'partially_paid', 'paid', 'pending_verification', 'cleared', 'blocked'], student_id: 'students' },
    columns: [
      emb('Student', 'students', 'full_name'), emb('Admission no.', 'students', 'admission_number'),
      emb('Examination', 'examinations', 'name'), C('required_amount', { type: 'money' }),
      C('paid_amount', { type: 'money' }), C('status', { type: 'status' }),
    ],
  },
  'library-transactions': {
    api: '/library-transactions', perm: 'library',
    filter: { status: ['borrowed', 'returned', 'overdue', 'lost', 'damaged'], book_id: 'library-books', borrower_type: ['student', 'staff'] },
    columns: [
      C('borrowed_at', { type: 'datetime' }), emb('Book', 'library_books', 'title'),
      emb('Borrower', 'students', 'full_name', { render: (r) => r.students?.full_name || r.school_users?.full_name || '—' }), C('due_date', { type: 'date' }),
      C('returned_at', { type: 'datetime' }), C('status', { type: 'status' }),
    ],
    fields: [
      rel('book_id', 'library-books', 'title', { required: true }),
      F('borrower_type', 'select', { options: [{ value: 'student', label: 'Student' }, { value: 'staff', label: 'Staff' }] }),
      rel('student_id', 'students', 'full_name'), rel('school_user_id', '/school/users', 'full_name'),
      F('due_date', 'date'), F('returned_at', 'datetime'),
      F('status', 'select', { options: ['borrowed', 'returned', 'overdue', 'lost', 'damaged'].map((v) => ({ value: v, label: humanize(v) })) }),
      F('remarks', 'textarea', { col: 12 }),
    ],
  },
  certificates: {
    api: '/certificates', perm: 'certificates', readonly: true, search: 'reference_number',
    filter: { certificate_type: ['graduation', 'completion', 'enrollment', 'transfer'], status: ['issued', 'revoked'], student_id: 'students' },
    columns: [
      C('reference_number'), emb('Student', 'students', 'full_name'), C('certificate_type'),
      emb('Template', 'certificate_templates', 'name'), C('issued_date', { type: 'date' }), C('status', { type: 'status' }),
    ],
  },
  'student-id-cards': {
    api: '/student-id-cards', perm: 'students', readonly: true, search: 'verification_code',
    filter: { student_id: 'students' },
    columns: [
      C('verification_code'), emb('Student', 'students', 'full_name'),
      emb('Admission no.', 'students', 'admission_number'), emb('Class', 'classes', 'name'),
      C('academic_year'), C('created_at', { type: 'datetime' }),
    ],
  },
  'assignment-submissions': {
    api: '/assignment-submissions', perm: 'learning',
    filter: { assignment_id: 'assignments', student_id: 'students', is_late: ['true', 'false'] },
    columns: [
      C('submitted_at', { type: 'datetime' }), emb('Student', 'students', 'full_name'),
      emb('Assignment', 'assignments', 'title'), C('file_name'), C('is_late', { type: 'boolean' }),
      emb('Marks', 'assignment_grades', 'marks', { type: 'number' }),
    ],
    fields: [
      rel('assignment_id', 'assignments', 'title', { required: true }),
      rel('student_id', 'students', 'full_name', { required: true }),
      F('note', 'textarea', { col: 12 }), F('file_name'), F('file_path', 'text', { help: 'Storage path or URL' }),
      F('is_late', 'checkbox'),
    ],
  },
  'assignment-grades': {
    api: '/assignment-grades', perm: 'learning', search: 'feedback',
    filter: { assignment_id: 'assignments', student_id: 'students' },
    columns: [
      emb('Student', 'assignment_submissions', 'full_name', { render: (r) => r.assignment_submissions?.students?.full_name || '—' }),
      emb('Assignment', 'assignments', 'title'), C('marks', { type: 'number' }), C('feedback'),
      C('created_at', { type: 'datetime' }),
    ],
    fields: [
      rel('submission_id', 'assignment-submissions', 'id', { required: true }),
      rel('assignment_id', 'assignments', 'title'), rel('student_id', 'students', 'full_name'),
      F('marks', 'number'), F('feedback', 'textarea', { col: 12 }),
    ],
  },
};

export function resourceConfig(key) {
  return RESOURCES[key.replace(/^\//, '')] || null;
}
