// Default school-level role -> permission template. Applied when a school is provisioned.
// Keys reference the school_permissions catalog (module.action).
const ALL = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage', 'assign'];

const expand = (spec) => {
  const keys = [];
  for (const [module, actions] of Object.entries(spec)) {
    for (const a of actions) keys.push(`${module}.${a}`);
  }
  return new Set(keys);
};

export const ROLE_NAMES = {
  school_admin: 'school_admin',
  principal: 'principal',
  vice_principal: 'vice_principal',
  registrar: 'registrar',
  teacher: 'teacher',
  accountant: 'accountant',
  exam_officer: 'exam_officer',
  invigilator: 'invigilator',
  student: 'student',
  parent: 'parent',
  librarian: 'librarian',
  hr_officer: 'hr_officer',
  receptionist: 'receptionist',
  discipline_officer: 'discipline_officer',
  transport_officer: 'transport_officer',
  lab_assistant: 'lab_assistant',
  staff: 'staff',
};

export const DEFAULT_ROLE_PERMISSIONS = {
  school_admin: expand({
    school: ['view', 'edit'], users: ALL, roles: ['view', 'manage'],
    students: ALL, admissions: ALL, teachers: ALL, staff: ALL, guardians: ALL,
    attendance: ['view', 'create', 'edit', 'approve'], timetable: ['view', 'manage'],
    examinations: ALL, marks: ['view', 'submit'], results: ['view', 'approve', 'publish'],
    finance: ALL, learning: ALL, announcements: ['view', 'create', 'publish'],
    reports: ['view', 'export'], certificates: ALL, library: ALL, discipline: ALL,
    transport: ALL, hr: ALL, reception: ALL, lab: ALL,
    subscription: ['view'], support: ['view', 'create'], audit: ['view'], notifications: ['view'],
  }),
  principal: expand({
    school: ['view'], students: ['view'], teachers: ['view'], staff: ['view'],
    guardians: ['view'], attendance: ['view'], timetable: ['view'],
    examinations: ['view'], marks: ['view'], results: ['view', 'approve', 'reject'],
    finance: ['view'], reports: ['view', 'export'], announcements: ['view', 'create'],
    discipline: ['view'], notifications: ['view'],
  }),
  vice_principal: expand({
    students: ['view'], teachers: ['view'], attendance: ['view'], timetable: ['view'],
    examinations: ['view'], results: ['view'], reports: ['view'], announcements: ['view'],
    discipline: ['view', 'create'], notifications: ['view'],
  }),
  registrar: expand({
    students: ALL, admissions: ALL, guardians: ALL,
    timetable: ['view'], reports: ['view', 'export'],
    certificates: ['view', 'create'], notifications: ['view'],
  }),
  teacher: expand({
    students: ['view'], attendance: ['view', 'create', 'edit'], timetable: ['view'],
    examinations: ['view'], marks: ['view', 'create', 'edit', 'submit'],
    learning: ['view', 'create', 'edit'], reports: ['view'],
    announcements: ['view'], notifications: ['view'],
  }),
  accountant: expand({
    students: ['view'], finance: ALL, reports: ['view', 'export'],
    examinations: ['view'], notifications: ['view'],
  }),
  exam_officer: expand({
    examinations: ALL, marks: ['view', 'edit'], results: ['view', 'manage', 'publish'],
    students: ['view'], timetable: ['view'], reports: ['view', 'export'], notifications: ['view'],
  }),
  invigilator: expand({
    examinations: ['view'], students: ['view'], notifications: ['view'],
  }),
  student: expand({
    students: ['view'], attendance: ['view'], timetable: ['view'],
    examinations: ['view'], marks: ['view'], results: ['view'],
    learning: ['view'], finance: ['view'], announcements: ['view'], notifications: ['view'],
  }),
  parent: expand({
    students: ['view'], attendance: ['view'], timetable: ['view'],
    examinations: ['view'], results: ['view'], learning: ['view'],
    finance: ['view'], announcements: ['view'], notifications: ['view'],
  }),
  librarian: expand({ library: ALL, students: ['view'], reports: ['view'], notifications: ['view'] }),
  hr_officer: expand({
    staff: ALL, attendance: ['view'], reports: ['view', 'export'], notifications: ['view'],
  }),
  receptionist: expand({
    reception: ['view', 'create', 'edit'], students: ['view'], announcements: ['view'],
    notifications: ['view'],
  }),
  discipline_officer: expand({
    discipline: ALL, students: ['view'], announcements: ['view'], notifications: ['view'], reports: ['view'],
  }),
  transport_officer: expand({
    transport: ALL, students: ['view'], finance: ['view'], reports: ['view'], notifications: ['view'],
  }),
  lab_assistant: expand({
    lab: ALL, students: ['view'], timetable: ['view'], reports: ['view'], notifications: ['view'],
  }),
  staff: expand({ announcements: ['view'], notifications: ['view'] }),
};
