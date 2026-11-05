/**
 * Tables wiped by the danger-zone "clear data" action, ordered children → parents so the
 * deletes never hit a foreign key. Everything the school owns is removed — every
 * staff/student/parent login included — while the school row, roles, branding, subscription and
 * the recycle-bin audit trail stay, and clearSchoolData spares the administrators' own accounts so
 * the tenant can still be signed into. RESTORE_ORDER is the reverse: parents must exist before
 * their children are re-inserted.
 */
export const CLEAR_TABLES = [
  // finance
  'payment_allocations', 'receipts', 'fee_payments', 'fee_invoices', 'student_fee_assignments',
  'examination_clearances', 'financial_approvals', 'expenses', 'expense_categories',
  'fee_structures', 'fee_categories', 'class_monthly_fees',
  // student council elections — before 'students', because candidates are enrolments
  'candidate_manifestos', 'election_ballot_selections', 'election_ballots',
  'election_voter_participation', 'election_results', 'election_candidates',
  'election_positions', 'elections',
  // learning
  'assignment_grades', 'assignment_submissions', 'assignment_attachments', 'assignments',
  'learning_materials',
  // exams
  'report_cards', 'marks', 'result_approvals', 'examination_invigilators', 'examination_schedules',
  'examination_components', 'examination_attendance', 'exam_class_subjects', 'examinations',
  'examination_types', 'grade_ranges', 'grade_scales',
  // attendance
  'attendance_corrections', 'attendance_records', 'attendance_sessions',
  // people — before academics: students hold non-cascading class_id/section_id references
  'student_guardians', 'student_documents', 'student_transport_assignments', 'student_id_cards',
  'certificates', 'library_transactions', 'library_books', 'discipline_records', 'students', 'guardians',
  'staff_attendance', 'staff_documents', 'leave_requests', 'staff_profiles', 'staff_departments',
  // academics
  'timetable_entries', 'teacher_assignments', 'class_subjects', 'sections', 'classes',
  'timetable_periods', 'classrooms', 'subjects', 'terms', 'academic_years',
  // operations
  'transport_routes', 'transport_vehicles', 'transport_drivers', 'equipment_allocations',
  'lab_equipment', 'visitors', 'appointments', 'announcements', 'notifications',
  'notification_preferences', 'support_tickets', 'certificate_templates',
  // files and accounts — last, so every row that references a user is already gone
  'file_metadata', 'push_tokens', 'school_invitations', 'school_user_roles', 'school_users',
];

export const RESTORE_ORDER = [...CLEAR_TABLES].reverse();

/**
 * Four election tables hang off a parent row instead of carrying a school id of their own, and the
 * schema keeps them that way on purpose — a ballot selection stays a few joins away from any voter.
 * Every tenant sweep here filters with `.eq('school_id', …)`, so those four are read and deleted
 * through their parent instead, and the parent id list is taken before the parent rows go away.
 */
export const PARENT_SCOPED_TABLES = {
  election_positions: { parent: 'elections', column: 'election_id' },
  election_results: { parent: 'elections', column: 'election_id' },
  election_ballot_selections: { parent: 'elections', column: 'election_id' },
  candidate_manifestos: { parent: 'election_candidates', column: 'candidate_id' },
};
