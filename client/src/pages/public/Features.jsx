import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  GraduationCap, Star, ClipboardList, CalendarDays, ClipboardSignature, FileCheck2, PenSquare,
  Wallet, ReceiptText, TrendingDown, Library, Bus, Briefcase, DoorOpen, ShieldAlert, FlaskConical,
  BookOpen, Bell, Megaphone, BarChart3, UserCog, Activity, Building2, School, Award, Database,
  Layers, Lock, ShieldCheck, ArrowRight, Check, Users, UserCheck,
} from 'lucide-react';
import { Badge } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';

const GROUPS = [
  {
    key: 'people', title: 'People & enrolment',
    items: [
      { icon: GraduationCap, key: 'students', title: 'Student records', body: 'Admission numbers, class and section placement, guardians, status history, photos and searchable profiles per tenant.' },
      { icon: Star, key: 'admissions', title: 'Admissions', body: 'Applications, entrance assessment results, class offers and clearance before a student is activated.' },
      { icon: UserCheck, key: 'guardians', title: 'Parents & guardians', body: 'Link one guardian to several students, with their own portal and their own notification feed.' },
      { icon: Briefcase, key: 'staff', title: 'Staff & departments', body: 'Staff profiles, departments, designations, joining dates and role assignments.' },
      { icon: Users, key: 'users', title: 'Users & invitations', body: 'Invite a person by email, assign roles, suspend an account the day they leave.' },
    ],
  },
  {
    key: 'academics', title: 'Academics',
    items: [
      { icon: School, key: 'structure', title: 'Years, terms, classes & subjects', body: 'Academic years and terms drive every report; classes, sections, subjects and classrooms stay reusable.' },
      { icon: CalendarDays, key: 'timetable', title: 'Timetable', body: 'Periods and entries per class-section, with teacher assignments and clash-aware scheduling.' },
      { icon: ClipboardList, key: 'attendance', title: 'Attendance', body: 'Daily register per class-section, present/absent/late statuses, monthly summaries and alerts to guardians.' },
      { icon: ClipboardSignature, key: 'exams', title: 'Examinations', body: 'Exam types, components, schedules and invigilator duty rosters in one flow.' },
      { icon: PenSquare, key: 'marks', title: 'Marks entry', body: 'Teachers enter marks per component with a submission lock; officers approve before release.' },
      { icon: FileCheck2, key: 'results', title: 'Results & report cards', body: 'Grade scales, computed positions, printable report cards and result approvals.' },
      { icon: Award, key: 'certificates', title: 'Certificates', body: 'Template-driven certificates with a public reference number anyone can verify.' },
    ],
  },
  {
    key: 'finance', title: 'Finance',
    items: [
      { icon: Wallet, key: 'fees', title: 'Fee categories & structures', body: 'Define what each class pays per term, including one-time, recurring and installment charges.' },
      { icon: ReceiptText, key: 'payments', title: 'Payments & receipts', body: 'Record cash, mobile money or bank payments; print a numbered receipt instantly.' },
      { icon: TrendingDown, key: 'expenses', title: 'Expenses', body: 'Categorised spending with approvals, so the school ledger balances monthly.' },
      { icon: BarChart3, key: 'financeSummary', title: 'Finance overview', body: 'Collected, outstanding and defaulted balances per class, term and student.' },
    ],
  },
  {
    key: 'operations', title: 'Operations',
    items: [
      { icon: Library, key: 'library', title: 'Library', body: 'Book catalogue, copies, loans, returns and overdue tracking per student.' },
      { icon: Bus, key: 'transport', title: 'Transport', body: 'Vehicles, drivers, routes and student route assignments with fees.' },
      { icon: FlaskConical, key: 'labs', title: 'Laboratories', body: 'Equipment inventory and allocation records for practical sessions.' },
      { icon: DoorOpen, key: 'reception', title: 'Reception', body: 'Visitor log and appointment book so the front desk knows who is on site.' },
      { icon: ShieldAlert, key: 'discipline', title: 'Discipline', body: 'Incident records, actions taken and follow-ups tied to the student profile.' },
      { icon: Briefcase, key: 'hr', title: 'HR & leave', body: 'Staff attendance, leave requests and approvals handled by the HR officer.' },
    ],
  },
  {
    key: 'digital', title: 'Learning & communication',
    items: [
      { icon: BookOpen, key: 'learning', title: 'Digital learning content', body: 'Upload notes, slides and videos per class-subject; students read them from their dashboard.' },
      { icon: PenSquare, key: 'assignments', title: 'Assignments', body: 'Publish tasks with deadlines, collect submissions and return marks and feedback.' },
      { icon: Megaphone, key: 'announcements', title: 'Announcements', body: 'Target a notice at the whole school, one role, one class or just guardians.' },
      { icon: Bell, key: 'notifications', title: 'Notifications', body: 'In-app feed per user for approvals, deadlines, attendance alerts and receipts.' },
      { icon: BarChart3, key: 'reporting', title: 'Reports & exports', body: 'CSV exports and printable reports for enrolment, attendance, results and fees.' },
    ],
  },
];

const SECURITY = [
  { icon: Building2, key: 'tenant', title: 'Strict tenant isolation', body: 'Each school is its own tenant. Every query is scoped to the school id taken from your verified session, so no request can read or write another school’s rows — not by id guessing, not by export.' },
  { icon: UserCog, key: 'rbac', title: 'Role-based permissions', body: 'Nineteen roles and fine-grained permission keys (view, create, edit, delete, approve, export). The interface hides what you cannot do, and the API re-checks it anyway.' },
  { icon: Activity, key: 'audit', title: 'Audit trail', body: 'Sign-ins, approvals, edits and deletions are recorded with actor, module, action, IP and summary, so administrators can reconstruct what happened and when.' },
  { icon: Layers, key: 'subscription', title: 'Subscription enforcement', body: 'Plans define student, staff, storage and branch ceilings plus feature switches. The server enforces them on write, so a trial or expired plan degrades gracefully instead of silently overcharging.' },
  { icon: Lock, key: 'credentials', title: 'No plaintext passwords', body: 'Passwords live in the authentication provider, hashed. Our API hands out short-lived access tokens with refresh tokens and never stores or logs a credential.' },
  { icon: Database, key: 'data', title: 'Your data stays yours', body: 'Records belong to the school. Export what you need at any time, and on exit the tenant is deactivated rather than reused.' },
];

/** Module-by-module product tour plus the security & isolation story. */
export default function Features() {
  const { t } = useTranslation();

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2">{t('features.title', { defaultValue: 'Every module a school runs on' })}</h1>
          <p className="mb-0" style={{ color: '#d9d2f7', maxWidth: '50rem' }}>
            {t('features.sub', { defaultValue: 'E-MADAARIS covers the full school year: enrolment to graduation, fee billing to the library shelf, timetable to the report card — in Somali or English.' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          {GROUPS.map((group) => (
            <div key={group.key} className="mb-5">
              <h2 className="h5 fw-bold mb-3 pb-2 border-bottom" style={{ color: '#130c2d' }}>
                {t(`features.groups.${group.key}`, { defaultValue: group.title })}
              </h2>
              <div className="row g-3">
                {group.items.map((item) => (
                  <div className="col-12 col-md-6 col-xl-4" key={item.key}>
                    <div className="card-soft p-3 h-100">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <span className="stat-icon"><item.icon size={18} /></span>
                        <div className="fw-semibold">{t(`features.items.${item.key}.title`, { defaultValue: item.title })}</div>
                      </div>
                      <div className="small text-muted">{t(`features.items.${item.key}.body`, { defaultValue: item.body })}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Security & isolation ─────────────────────────────── */}
      <section className="py-5" style={{ background: '#eef0f4' }} id="security">
        <div className="container">
          <div className="d-flex align-items-center gap-2 mb-1">
            <ShieldCheck size={22} style={{ color: BRAND }} />
            <h2 className="h4 fw-bold mb-0" style={{ color: '#130c2d' }}>
              {t('features.securityTitle', { defaultValue: 'Security & isolation' })}
            </h2>
          </div>
          <p className="text-muted mb-4" style={{ maxWidth: '52rem' }}>
            {t('features.securitySub', { defaultValue: 'A school platform holds children’s records and a school’s money trail. Isolation is designed in, not bolted on.' })}
          </p>
          <div className="row g-3">
            {SECURITY.map((s) => (
              <div className="col-12 col-md-6 col-lg-4" key={s.key}>
                <div className="card-soft p-3 h-100">
                  <div className="fw-semibold mb-2 d-flex align-items-center gap-2">
                    <s.icon size={17} style={{ color: BRAND }} />
                    {t(`features.security.${s.key}.title`, { defaultValue: s.title })}
                  </div>
                  <div className="small text-muted">{t(`features.security.${s.key}.body`, { defaultValue: s.body })}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card-soft p-4 mt-4">
            <div className="fw-semibold mb-3">{t('features.checklist', { defaultValue: 'What a school can rely on' })}</div>
            <div className="row g-2 small">
              {[
                { key: 'scope', text: 'Session-scoped tenant filters on every read and write' },
                { key: 'serverChecks', text: 'Permission checks duplicated server-side, never only in the UI' },
                { key: 'ceilings', text: 'Subscription ceilings enforced when records are created' },
                { key: 'invites', text: 'Invitation links for new staff instead of shared passwords' },
                { key: 'platformArea', text: 'Separate platform staff area — school data access is logged' },
                { key: 'lookupOnly', text: 'Public verification endpoints expose only reference lookups' },
              ].map((line) => (
                <div className="col-12 col-md-6 d-flex gap-2 align-items-start" key={line.key}>
                  <Check size={15} className="mt-1 text-success" />
                  <span>{t(`features.checklist.${line.key}`, { defaultValue: line.text })}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 mt-4">
            <Link to="/pricing" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1">
              {t('features.seePricing', { defaultValue: 'See what is included per plan' })} <ArrowRight size={14} />
            </Link>
            <Link to="/privacy" className="btn btn-outline-primary btn-sm">{t('public.privacy', { defaultValue: 'Privacy policy' })}</Link>
          </div>
        </div>
      </section>

      <section className="public-section text-center">
        <div className="container">
          <h2 className="h4 fw-bold mb-2" style={{ color: '#130c2d' }}>
            {t('features.ctaTitle', { defaultValue: 'Ready to move your school onto one platform?' })}
          </h2>
          <p className="text-muted mb-4">{t('features.ctaBody', { defaultValue: 'Our platform team sets up your school and plan, then sends the administrator an invitation link.' })}</p>
          <div className="d-flex justify-content-center gap-2 flex-wrap">
            <Link to="/contact" className="btn btn-primary">{t('public.contact', { defaultValue: 'Contact' })}</Link>
            <Link to="/faq" className="btn btn-outline-primary">
              <Badge tone="brand" className="me-1">{t('public.faq', { defaultValue: 'FAQ' })}</Badge>
              {t('features.readFaq', { defaultValue: 'Read the FAQ' })}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
