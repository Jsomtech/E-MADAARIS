import {
  LayoutDashboard, Users, GraduationCap, UserCheck, Briefcase, School, BookOpen, CalendarDays,
  ClipboardList, FileCheck2, PenSquare, Award, Wallet, ReceiptText, TrendingDown, Library,
  ShieldAlert, Bus, FlaskConical, DoorOpen, Bell, Settings, CreditCard, Headphones, Activity,
  BarChart3, Building2, FileStack, UserCog, Megaphone, Home, Star, ClipboardSignature, BadgeCheck,
  Trash2, DatabaseBackup, Palette,
} from 'lucide-react';

export const ICONS = {
  dashboard: LayoutDashboard, users: Users, students: GraduationCap, guardians: UserCheck,
  staff: Briefcase, school: School, subjects: BookOpen, timetable: CalendarDays,
  attendance: ClipboardList, results: FileCheck2, marks: PenSquare, certificates: Award,
  finance: Wallet, payments: ReceiptText, expenses: TrendingDown, library: Library,
  discipline: ShieldAlert, transport: Bus, lab: FlaskConical, reception: DoorOpen,
  notifications: Bell, settings: Settings, subscription: CreditCard, support: Headphones,
  audit: Activity, analytics: BarChart3, schools: Building2, plans: FileStack,
  roles: UserCog, announcements: Megaphone, home: Home, admissions: Star,
  exams: ClipboardSignature, usersCog: UserCog, idCards: BadgeCheck,
  trash: Trash2, backups: DatabaseBackup, content: Palette,
};

const m = (key, perm, icon) => ({ key, to: `/m/${key}`, perm, icon });
const custom = (key, to, perm, icon) => ({ key, to, perm, icon });

/** Home dashboard + sidebar groups per role. Sidebar visibility is UX only — the API enforces permissions. */
export const ROLE_CONFIG = {
  super_admin: {
    label: 'Super Admin',
    home: '/super-admin',
    groups: [
      { title: 'nav.platform', items: [
        custom('dashboard', '/super-admin', 'platform.dashboard.view', 'dashboard'),
        custom('schools', '/platform/schools', 'platform.schools.view', 'schools'),
        custom('applications', '/platform/applications', 'platform.schools.approve', 'admissions'),
        custom('plans', '/platform/plans', 'platform.plans.manage', 'plans'),
        custom('subscriptions', '/platform/subscriptions', 'platform.billing.view', 'subscription'),
        custom('invoices', '/platform/invoices', 'platform.billing.view', 'payments'),
        custom('payments', '/platform/payments', 'platform.billing.view', 'payments'),
      ] },
      { title: 'nav.system', items: [
        custom('platform-users', '/platform/users', 'platform.users.manage', 'users'),
        custom('analytics', '/platform/analytics', 'platform.analytics.view', 'analytics'),
        custom('tickets', '/platform/tickets', 'platform.tickets.manage', 'support'),
        custom('content', '/platform/content', 'platform.dashboard.view', 'content'),
        custom('backups', '/platform/backups', 'platform.dashboard.view', 'backups'),
        custom('trash', '/platform/trash', 'platform.audit.view', 'trash'),
        custom('audit', '/platform/audit', 'platform.audit.view', 'audit'),
      ] },
    ],
  },
  platform_support: {
    label: 'Platform Support',
    home: '/platform-support',
    groups: [
      { title: 'nav.platform', items: [
        custom('dashboard', '/platform-support', 'platform.dashboard.view', 'dashboard'),
        custom('tickets', '/platform/tickets', 'platform.tickets.manage', 'support'),
        custom('schools', '/platform/schools', 'platform.schools.view', 'schools'),
      ] },
    ],
  },
  school_admin: {
    label: 'School Administrator',
    home: '/school-admin',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/school-admin', 'school.view', 'dashboard'),
        custom('announcements', '/m/announcements', 'announcements.view', 'announcements'),
      ] },
      { title: 'nav.people', items: [
        custom('users', '/school/users', 'users.view', 'users'),
        custom('admissions', '/school/admissions', 'admissions.view', 'admissions'),
        m('students', 'students.view', 'students'),
        custom('id-cards', '/school/id-cards', 'students.view', 'idCards'),
        m('guardians', 'guardians.view', 'guardians'),
        m('staff-profiles', 'staff.view', 'staff'),
        m('departments', 'staff.view', 'staff'),
      ] },
      { title: 'nav.academics', items: [
        m('academic-years', 'timetable.view', 'timetable'),
        m('terms', 'timetable.view', 'subjects'),
        m('classes', 'students.view', 'school'),
        m('sections', 'students.view', 'school'),
        m('subjects', 'students.view', 'subjects'),
        m('class-subjects', 'students.view', 'subjects'),
        m('classrooms', 'timetable.view', 'school'),
        m('teacher-assignments', 'teachers.view', 'users'),
        custom('timetable', '/school/timetable', 'timetable.view', 'timetable'),
        m('attendance', 'attendance.view', 'attendance'),
      ] },
      { title: 'nav.exams', items: [
        custom('examinations', '/m/examinations', 'examinations.view', 'exams'),
        custom('marks', '/m/marks', 'marks.view', 'marks'),
        custom('results', '/m/results', 'results.view', 'results'),
        m('grade-scales', 'examinations.view', 'analytics'),
      ] },
      { title: 'nav.finance', items: [
        m('fee-categories', 'finance.view', 'finance'),
        m('fee-structures', 'finance.view', 'finance'),
        custom('finance-payments', '/m/finance-payments', 'finance.view', 'payments'),
        m('expenses', 'finance.view', 'expenses'),
        custom('finance-summary', '/m/finance-summary', 'finance.view', 'analytics'),
      ] },
      { title: 'nav.learning', items: [
        m('learning-materials', 'learning.view', 'subjects'),
        m('assignments', 'learning.view', 'marks'),
      ] },
      { title: 'nav.operations', items: [
        m('library-books', 'library.view', 'library'),
        m('discipline-records', 'discipline.view', 'discipline'),
        custom('transport-routes', '/m/transport-routes', 'transport.view', 'transport'),
        m('lab-equipment', 'lab.view', 'lab'),
        custom('visitors', '/m/visitors', 'reception.view', 'reception'),
        m('certificate-templates', 'certificates.view', 'certificates'),
      ] },
      { title: 'nav.system', items: [
        custom('profile', '/school/profile', 'school.view', 'school'),
        custom('settings', '/school/settings', 'school.view', 'settings'),
        custom('subscription', '/school/subscription', 'subscription.view', 'subscription'),
        custom('reports', '/school/reports', 'reports.view', 'analytics'),
        custom('backups', '/school/backups', 'school.edit', 'backups'),
        custom('trash', '/school/trash', 'school.edit', 'trash'),
        custom('audit', '/school/audit', 'audit.view', 'audit'),
        custom('support', '/school/support', 'support.view', 'support'),
      ] },
    ],
  },
  principal: {
    label: 'Principal',
    home: '/principal',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/principal', 'school.view', 'dashboard'),
        custom('results', '/m/results', 'results.view', 'results'),
        m('students', 'students.view', 'students'),
        m('classes', 'students.view', 'school'),
        m('staff-profiles', 'staff.view', 'staff'),
        m('attendance', 'attendance.view', 'attendance'),
        custom('examinations', '/m/examinations', 'examinations.view', 'exams'),
        m('discipline-records', 'discipline.view', 'discipline'),
        m('announcements', 'announcements.view', 'announcements'),
        custom('reports', '/school/reports', 'reports.view', 'analytics'),
      ] },
    ],
  },
  vice_principal: {
    label: 'Vice Principal',
    home: '/vice-principal',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/vice-principal', 'students.view', 'dashboard'),
        m('students', 'students.view', 'students'),
        m('classes', 'students.view', 'school'),
        m('staff-profiles', 'staff.view', 'staff'),
        m('attendance', 'attendance.view', 'attendance'),
        custom('examinations', '/m/examinations', 'examinations.view', 'exams'),
        m('discipline-records', 'discipline.view', 'discipline'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  registrar: {
    label: 'Registrar',
    home: '/registrar',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/registrar', 'students.view', 'dashboard'),
        m('students', 'students.view', 'students'),
        m('guardians', 'guardians.view', 'guardians'),
        custom('admissions', '/school/admissions', 'admissions.view', 'admissions'),
        m('classes', 'students.view', 'school'),
        m('sections', 'students.view', 'school'),
        m('certificate-templates', 'certificates.view', 'certificates'),
        custom('id-cards', '/school/id-cards', 'students.view', 'users'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  teacher: {
    label: 'Teacher',
    home: '/teacher',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/teacher', 'students.view', 'dashboard'),
        m('students', 'students.view', 'students'),
        custom('attendance', '/m/attendance', 'attendance.view', 'attendance'),
        m('timetable-entries', 'timetable.view', 'timetable'),
        custom('marks', '/m/marks', 'marks.view', 'marks'),
        custom('examinations', '/m/examinations', 'examinations.view', 'exams'),
        m('learning-materials', 'learning.view', 'subjects'),
        m('assignments', 'learning.view', 'marks'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  accountant: {
    label: 'Accountant / Cashier',
    home: '/accountant',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/accountant', 'finance.view', 'dashboard'),
        custom('finance-payments', '/m/finance-payments', 'finance.create', 'payments'),
        custom('finance-summary', '/m/finance-summary', 'finance.view', 'analytics'),
        m('fee-categories', 'finance.view', 'finance'),
        m('fee-structures', 'finance.view', 'finance'),
        m('expenses', 'finance.view', 'expenses'),
        m('financial-approvals', 'finance.view', 'results'),
        m('students', 'students.view', 'students'),
        custom('clearances', '/m/clearances', 'finance.view', 'certificates'),
      ] },
    ],
  },
  exam_officer: {
    label: 'Examination Officer',
    home: '/exam-officer',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/exam-officer', 'examinations.view', 'dashboard'),
        custom('examinations', '/m/examinations', 'examinations.manage', 'exams'),
        m('examination-schedules', 'examinations.view', 'timetable'),
        m('examination-invigilators', 'examinations.view', 'users'),
        custom('marks', '/m/marks', 'marks.view', 'marks'),
        custom('results', '/m/results', 'results.manage', 'results'),
        m('grade-scales', 'examinations.view', 'analytics'),
        m('grade-ranges', 'examinations.view', 'analytics'),
        custom('clearances', '/m/clearances', 'finance.view', 'certificates'),
      ] },
    ],
  },
  invigilator: {
    label: 'Examination Invigilator',
    home: '/invigilator',
    groups: [
      { title: 'nav.overview', items: [
        custom('dashboard', '/invigilator', 'examinations.view', 'dashboard'),
        m('examination-schedules', 'examinations.view', 'timetable'),
        m('students', 'students.view', 'students'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  student: {
    label: 'Student',
    home: '/student',
    groups: [
      { title: 'nav.myLearning', items: [
        custom('dashboard', '/student', 'students.view', 'dashboard'),
        m('attendance', 'attendance.view', 'attendance'),
        custom('timetable', '/school/my-timetable', 'timetable.view', 'timetable'),
        custom('results', '/m/report-card', 'results.view', 'results'),
        m('assignments', 'learning.view', 'marks'),
        m('learning-materials', 'learning.view', 'subjects'),
        custom('fees', '/school/my-fees', 'finance.view', 'finance'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  parent: {
    label: 'Parent / Guardian',
    home: '/parent',
    groups: [
      { title: 'nav.myFamily', items: [
        custom('dashboard', '/parent', 'students.view', 'dashboard'),
        custom('children', '/school/my-children', 'students.view', 'students'),
        m('attendance', 'attendance.view', 'attendance'),
        custom('results', '/m/report-card', 'results.view', 'results'),
        m('assignments', 'learning.view', 'marks'),
        custom('fees', '/school/my-fees', 'finance.view', 'finance'),
        m('announcements', 'announcements.view', 'announcements'),
      ] },
    ],
  },
  librarian: {
    label: 'Librarian',
    home: '/staff/librarian',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/librarian', 'library.view', 'dashboard'),
      m('library-books', 'library.manage', 'library'),
      custom('library-loans', '/m/library-loans', 'library.view', 'payments'),
      m('students', 'students.view', 'students'),
    ] }],
  },
  hr_officer: {
    label: 'Human Resources',
    home: '/staff/hr',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/hr', 'staff.view', 'dashboard'),
      m('staff-profiles', 'staff.manage', 'staff'),
      m('departments', 'staff.view', 'school'),
      m('staff-attendance', 'staff.view', 'attendance'),
      m('leave-requests', 'staff.approve', 'results'),
      m('announcements', 'announcements.view', 'announcements'),
    ] }],
  },
  receptionist: {
    label: 'Receptionist',
    home: '/staff/reception',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/reception', 'reception.view', 'dashboard'),
      m('visitors', 'reception.create', 'reception'),
      m('appointments', 'reception.create', 'timetable'),
      m('announcements', 'announcements.view', 'announcements'),
    ] }],
  },
  discipline_officer: {
    label: 'Discipline Officer',
    home: '/staff/discipline',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/discipline', 'discipline.view', 'dashboard'),
      m('discipline-records', 'discipline.manage', 'discipline'),
      m('students', 'students.view', 'students'),
      m('attendance', 'attendance.view', 'attendance'),
      m('announcements', 'announcements.view', 'announcements'),
    ] }],
  },
  transport_officer: {
    label: 'Transport Officer',
    home: '/staff/transport',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/transport', 'transport.view', 'dashboard'),
      m('transport-vehicles', 'transport.manage', 'transport'),
      m('transport-drivers', 'transport.manage', 'users'),
      m('transport-routes', 'transport.manage', 'timetable'),
      m('student-transport-assignments', 'transport.assign', 'students'),
    ] }],
  },
  lab_assistant: {
    label: 'Laboratory Assistant',
    home: '/staff/lab',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff/lab', 'lab.view', 'dashboard'),
      m('lab-equipment', 'lab.manage', 'lab'),
      m('equipment-allocations', 'lab.assign', 'payments'),
      m('announcements', 'announcements.view', 'announcements'),
    ] }],
  },
  staff: {
    label: 'Staff',
    home: '/staff',
    groups: [{ title: 'nav.overview', items: [
      custom('dashboard', '/staff', 'announcements.view', 'dashboard'),
      m('announcements', 'announcements.view', 'announcements'),
    ] }],
  },
};

export const HOME_ROLE = Object.fromEntries(
  Object.entries(ROLE_CONFIG).map(([role, cfg]) => [cfg.home, role]),
);

export function roleConfig(role) {
  return ROLE_CONFIG[role] || ROLE_CONFIG.staff;
}

/** Navigation for a signed-in profile: every assigned role contributes, permission keys filter items. */
export function navigationFor(profile) {
  if (!profile) return { config: ROLE_CONFIG.staff, groups: [] };
  const role = profile.primaryRole;
  const config = roleConfig(role);
  const permissions = new Set(profile.permissions || []);
  const superAdmin = profile.primaryRole === 'super_admin';
  const groups = (config.groups || []).map((g) => ({
    ...g,
    items: g.items.filter((item) => superAdmin || !item.perm || permissions.has(item.perm)),
  })).filter((g) => g.items.length);
  return { config, groups };
}
