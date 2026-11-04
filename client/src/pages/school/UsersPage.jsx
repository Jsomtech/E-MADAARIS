// School directory: staff accounts (GET /school/users) and students (GET /students) in separate tabs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Ban, Briefcase, CheckCircle2, Copy, Crown, Eye, EyeOff, GraduationCap, ImagePlus, KeyRound, Pencil,
  RefreshCw, Search, ShieldAlert, UserPlus, Users, Wallet,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet, apiPatch, apiPost, apiUpload } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_CONFIG } from '../../config/roles.jsx';

/**
 * School role names come from ROLE_CONFIG (client/src/config/roles.jsx): every entry except the two
 * platform and two personal-portal roles is a staff role provisioned by server/src/services/provisioning.js.
 */
const PLATFORM_ROLES = ['super_admin', 'platform_support'];
const PERSONAL_ROLES = ['parent', 'student'];
const STAFF_ROLES = Object.keys(ROLE_CONFIG).filter((r) => !PLATFORM_ROLES.includes(r) && !PERSONAL_ROLES.includes(r));

const ROLE_GROUPS = [
  { key: 'leadership', label: 'Leadership & administration', icon: Crown, roles: ['school_admin', 'principal', 'vice_principal', 'registrar'] },
  { key: 'academics', label: 'Academics & examinations', icon: GraduationCap, roles: ['teacher', 'exam_officer', 'invigilator', 'librarian', 'lab_assistant'] },
  { key: 'finance', label: 'Finance', icon: Wallet, roles: ['accountant'] },
  { key: 'operations', label: 'Operations & support', icon: Briefcase, roles: ['hr_officer', 'receptionist', 'discipline_officer', 'transport_officer', 'staff'] },
];

const ROLE_HINTS = {
  school_admin: 'Full control of the school: staff, students, academics, finance and settings.',
  principal: 'Academic oversight, result approvals and reports.',
  vice_principal: 'Student and attendance oversight, discipline and announcements.',
  registrar: 'Admissions, student records, guardians and ID cards.',
  teacher: 'Class lists, attendance, timetable, marks and learning materials.',
  exam_officer: 'Examinations, schedules, invigilators, marks and results.',
  invigilator: 'Examination schedules and student lists on exam days.',
  librarian: 'Library catalogue, loans and returns.',
  lab_assistant: 'Laboratory equipment and allocations.',
  accountant: 'Fees, payments, expenses and financial summaries.',
  hr_officer: 'Staff profiles, departments, staff attendance and leave requests.',
  receptionist: 'Visitors, appointments and front-desk announcements.',
  discipline_officer: 'Discipline records, students and attendance.',
  transport_officer: 'Vehicles, drivers, routes and student transport assignments.',
  staff: 'General staff access: announcements and the staff dashboard.',
  parent: 'Personal portal for guardians. Link it from the Guardians module after creating.',
  student: 'Personal portal for students. A student login is linked after the record exists.',
};

const PAGE_SIZE = 50;

const roleLabel = (role) => ROLE_CONFIG[role]?.label || role.replace(/_/g, ' ');
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((part) => part[0]).join('').toUpperCase();

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function roleHint(t, role) {
  return t(`sections.roleHints.${role}`, { defaultValue: ROLE_HINTS[role] || '' });
}

export default function UsersPage() {
  const { t } = useTranslation();
  const { can, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('staff');
  const [page, setPage] = useState(1);
  const [studentPage, setStudentPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [credentialFor, setCredentialFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const mayView = can('users.view');
  const mayCreate = can('users.create');
  const mayEdit = can('users.edit');
  const maySeeStudents = can('students.view');
  const maySeeSeats = can('subscription.view');

  const params = useMemo(() => ({
    q: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  }), [search, page]);
  const studentParams = useMemo(() => ({
    q: search || undefined,
    page: studentPage,
    pageSize: PAGE_SIZE,
  }), [search, studentPage]);

  const list = useApi('/school/users', params, mayView && tab === 'staff');
  const students = useApi('/students', studentParams, mayView && maySeeStudents && tab === 'students');
  const usage = useApi('/school/usage', undefined, mayView && maySeeSeats);

  const maxStaff = usage.data?.limits?.max_staff ?? null;
  const seatsUsed = usage.data?.staffSeats ?? null;
  const seatsLeft = usage.data?.staffSeatsLeft ?? null;
  const seatsFull = Boolean(maxStaff) && seatsUsed != null && seatsUsed >= Number(maxStaff);

  // Deep link from the dashboard quick actions: /school/users?new=1 opens the add-staff dialog.
  useEffect(() => {
    if (searchParams.get('new') === '1' && mayView) {
      setTab('staff');
      setAdding(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, mayView, setSearchParams]);

  useEffect(() => {
    const id = setTimeout(() => { setSearch(query.trim()); setPage(1); setStudentPage(1); }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const refreshUsage = useCallback(() => { if (maySeeSeats) usage.reload(); }, [maySeeSeats, usage]);

  const setStatus = useCallback(async (row, status) => {
    setBusy(true);
    try {
      await apiPatch(`/school/users/${row.id}/status`, { status });
      toast.success(t('sections.userStatusChanged', { defaultValue: '{{name}} is now {{status}}.', name: row.full_name, status: status.replace(/_/g, ' ') }));
      list.reload();
    } catch (error) {
      toast.error(error.status === 403
        ? t('sections.usersForbidden', { defaultValue: 'Your role cannot change staff accounts.' })
        : error.message);
    } finally { setBusy(false); }
  }, [list, t]);

  const columns = useMemo(() => [
    {
      key: 'full_name',
      label: t('sections.staffName', { defaultValue: 'Staff member' }),
      render: (row) => (
        <div className="d-flex align-items-center gap-2">
          <span className="avatar" aria-hidden="true">
            {row.avatar_url ? <img src={row.avatar_url} alt="" /> : initials(row.full_name)}
          </span>
          <div>
            <div className="fw-semibold">
              {row.full_name}
              {row.id === profile?.userId && <Badge tone="brand" className="ms-2">{t('sections.you', { defaultValue: 'you' })}</Badge>}
            </div>
            <div className="small text-muted">{row.email || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      label: t('sections.roles', { defaultValue: 'Roles' }),
      render: (row) => (
        <div className="d-flex flex-wrap gap-1">
          {(!row.roles || !row.roles.length) && <span className="small text-muted">{t('sections.noRole', { defaultValue: 'No role assigned' })}</span>}
          {(row.roles || []).map((r) => <Badge key={r} tone={r === 'school_admin' ? 'brand' : 'info'}>{roleLabel(r)}</Badge>)}
        </div>
      ),
    },
    { key: 'phone', label: t('common.phone'), width: 140, render: (r) => <span className="small">{r.phone || '—'}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 170 },
    {
      key: 'created_at',
      label: t('sections.addedOn', { defaultValue: 'Added' }),
      width: 170,
      render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span>,
    },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 270,
      className: 'text-end white-space-nowrap',
      render: (row) => (
        <div className="d-inline-flex gap-1">
          {mayEdit && (
            <button className="btn btn-sm btn-outline-primary" title={t('sections.showPassword', { defaultValue: 'Show password' })}
              aria-label={t('sections.showPassword', { defaultValue: 'Show password' })} onClick={() => setCredentialFor(row)}>
              <Eye size={13} />
            </button>
          )}
          {mayEdit && (
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setEditing(row)}>
              <Pencil size={13} /> {t('common.edit')}
            </button>
          )}
          {mayEdit && (
            <button className={`btn btn-sm ${row.status === 'active' ? 'btn-outline-danger' : 'btn-outline-success'} d-inline-flex align-items-center gap-1`}
              disabled={busy} onClick={() => setStatus(row, row.status === 'active' ? 'inactive' : 'active')}>
              {row.status === 'active' ? <Ban size={13} /> : <CheckCircle2 size={13} />}
              {row.status === 'active' ? t('sections.deactivate', { defaultValue: 'Deactivate' }) : t('sections.activate', { defaultValue: 'Activate' })}
            </button>
          )}
        </div>
      ),
    },
  ], [busy, mayEdit, profile?.userId, setStatus, t]);

  const studentColumns = useMemo(() => [
    {
      key: 'full_name',
      label: t('sections.student', { defaultValue: 'Student' }),
      render: (row) => (
        <div className="d-flex align-items-center gap-2">
          <span className="avatar" aria-hidden="true">
            {row.photo_url ? <img src={row.photo_url} alt="" /> : initials(row.full_name)}
          </span>
          <div>
            <div className="fw-semibold">{row.full_name || [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ')}</div>
            <div className="small text-muted">{row.admission_number || t('sections.noAdmissionNumber', { defaultValue: 'No admission number' })}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'class',
      label: t('sections.studentClass', { defaultValue: 'Class' }),
      render: (row) => <span className="small">{row.classes?.name || '—'}</span>,
    },
    {
      key: 'section',
      label: t('sections.studentSection', { defaultValue: 'Section' }),
      render: (row) => <span className="small">{row.sections?.name || '—'}</span>,
    },
    {
      key: 'gender',
      label: t('common.gender', { defaultValue: 'Gender' }),
      width: 110,
      render: (row) => <span className="small text-capitalize">{row.gender || '—'}</span>,
    },
    { key: 'phone', label: t('common.phone'), width: 140, render: (r) => <span className="small">{r.phone || '—'}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 170 },
    {
      key: 'created_at',
      label: t('sections.addedOn', { defaultValue: 'Added' }),
      width: 170,
      render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span>,
    },
  ], [t]);

  if (!mayView) {
    return (
      <>
        <PageHeader title={t('sections.usersTitle', { defaultValue: 'Users & invitations' })} />
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('sections.usersNoAccessTitle', { defaultValue: 'Not available for your role' })}
            hint={t('sections.usersNoAccess', { defaultValue: 'This directory needs the users.view permission. Staff and personal accounts see nothing here.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.usersTitle', { defaultValue: 'Users & invitations' })}
        subtitle={t('sections.usersSubtitle', { defaultValue: 'Staff accounts and students are kept apart. Staff roles and status are managed here; students are listed with their photo, class and section.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={() => (tab === 'staff' ? list.reload() : students.reload())}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {tab === 'staff' && mayCreate && (
              <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setAdding(true)} disabled={seatsFull}>
                <UserPlus size={14} /> {t('sections.addStaff', { defaultValue: 'Add staff' })}
              </button>
            )}
          </>
        )}
      />

      <div className="nav nav-pills gap-1 flex-wrap mb-3">
        <button type="button" aria-pressed={tab === 'staff'}
          className={`btn btn-sm d-inline-flex align-items-center gap-1 ${tab === 'staff' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setTab('staff')}>
          <Users size={14} /> {t('sections.staffTab', { defaultValue: 'Teachers & staff' })}
          {list.total != null ? <span className="ms-1 opacity-75">({list.total})</span> : null}
        </button>
        {maySeeStudents && (
          <button type="button" aria-pressed={tab === 'students'}
            className={`btn btn-sm d-inline-flex align-items-center gap-1 ${tab === 'students' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setTab('students')}>
            <GraduationCap size={15} /> {t('sections.studentsTab', { defaultValue: 'Students' })}
            {students.total != null ? <span className="ms-1 opacity-75">({students.total})</span> : null}
          </button>
        )}
      </div>

      {tab === 'staff' && (maxStaff || seatsUsed != null) && (
        <div className="card-soft p-3 mb-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <div className="fw-semibold small d-inline-flex align-items-center gap-2">
              <Users size={15} /> {t('sections.staffSeats', { defaultValue: 'Staff seats' })}
            </div>
            <div className="small text-muted">
              {maxStaff
                ? t('sections.seatsUsed', { defaultValue: '{{used}} of {{max}} seats used · {{left}} left', used: seatsUsed ?? '…', max: maxStaff, left: seatsLeft ?? '…' })
                : t('sections.seatsUnlimited', { defaultValue: '{{used}} staff accounts · your plan has no staff cap', used: seatsUsed ?? '…' })}
            </div>
          </div>
          {maxStaff && (
            <div className="progress" style={{ height: 8 }}>
              <div
                className={`progress-bar ${seatsFull ? 'bg-danger' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, Math.round(((seatsUsed || 0) / Number(maxStaff)) * 100))}%` }}
              />
            </div>
          )}
          {seatsFull && (
            <div className="small text-danger mt-2 d-inline-flex align-items-center gap-1">
              <ShieldAlert size={13} />
              {t('sections.seatsFull', { defaultValue: 'Every staff seat is in use. Upgrade the subscription before creating another account.' })}
            </div>
          )}
        </div>
      )}

      {tab === 'staff' && !mayCreate && !mayEdit && (
        <div className="alert alert-secondary small py-2">
          {t('sections.usersReadOnly', { defaultValue: 'You can browse the staff directory, but adding and editing accounts needs users.create / users.edit.' })}
        </div>
      )}

      {tab === 'staff' && mayEdit && (
        <div className="alert alert-info small py-2 d-flex align-items-start gap-2">
          <Eye size={14} className="mt-1 flex-shrink-0" />
          <div>
            {t('sections.passwordVisibilityNote', { defaultValue: 'Use “Show password” to read a password the system issued — a new staff account, a temporary reset, or a student’s ID password. A password the person set themselves stays private; reset it to issue a new temporary one.' })}
          </div>
        </div>
      )}

      <div className="card-soft p-2 mb-3">
        <div className="input-group input-group-sm" style={{ maxWidth: 420 }}>
          <span className="input-group-text bg-white"><Search size={14} /></span>
          <input className="form-control" value={query}
            placeholder={tab === 'staff'
              ? t('sections.searchUsers', { defaultValue: 'Search staff by name or email…' })
              : t('sections.searchStudents', { defaultValue: 'Search students by name or admission number…' })}
            onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="btn btn-outline-secondary" onClick={() => setQuery('')}>{t('sections.clear', { defaultValue: 'Clear' })}</button>}
        </div>
        <div className="small text-muted mt-2 d-flex align-items-center gap-1">
          {tab === 'staff' ? <Users size={13} /> : <GraduationCap size={14} />}
          {tab === 'staff'
            ? t('sections.searchServerHint', { defaultValue: 'Search runs on the server (full_name / email ilike) and always resets to page 1 of the paginated list.' })
            : t('sections.searchStudentsHint', { defaultValue: 'Searches first, middle and last name plus the admission number, then resets to page 1.' })}
        </div>
      </div>

      {tab === 'staff' ? (
        <DataTable columns={columns} rows={list.data} total={list.total} page={page} pageSize={PAGE_SIZE} onPage={setPage}
          loading={list.loading} error={list.error} onRetry={list.reload} dense
          empty={t('sections.noUsers', { defaultValue: 'No staff accounts match this search' })} />
      ) : (
        <DataTable columns={studentColumns} rows={students.data} total={students.total} page={studentPage} pageSize={PAGE_SIZE} onPage={setStudentPage}
          loading={students.loading} error={students.error} onRetry={students.reload} dense
          empty={t('sections.noStudents', { defaultValue: 'No students match this search' })} />
      )}

      <StaffModal open={adding} seatsFull={seatsFull}
        onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); list.reload(); refreshUsage(); }} />

      <EditModal row={editing} busy={busy} onClose={() => setEditing(null)}
        onPhotoUpdated={list.reload}
        onSaved={() => { setEditing(null); list.reload(); refreshUsage(); }} />

      <CredentialModal row={credentialFor} onClose={() => setCredentialFor(null)} />
    </>
  );
}

/** Reveals a system-issued password; the API refuses when the owner set their own. */
function CredentialModal({ row, onClose }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: false, password: '', source: '', issuedAt: null, error: '' });
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!row) return undefined;
    let alive = true;
    setState({ loading: true, password: '', source: '', issuedAt: null, error: '' });
    setRevealed(true);
    setCopied(false);
    (async () => {
      try {
        const { data } = await apiGet(`/school/users/${row.id}/credential`);
        if (alive) setState({ loading: false, password: data.password, source: data.source, issuedAt: data.issued_at, error: '' });
      } catch (e) {
        if (alive) setState({ loading: false, password: '', source: '', issuedAt: null, error: e.message });
      }
    })();
    return () => { alive = false; };
  }, [row]);

  if (!row) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  return (
    <Modal open size="md" icon={KeyRound}
      title={`${t('sections.showPasswordTitle', { defaultValue: 'Password' })} · ${row.full_name}`}
      subtitle={row.email || row.full_name}
      onClose={onClose}
      footer={<button className="btn btn-outline-secondary" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>}>
      {state.loading && <Spinner label={t('common.loading')} />}

      {!state.loading && state.error && (
        <>
          <div className="alert alert-warning small py-2 mb-2">{state.error}</div>
          <div className="small text-muted">
            {t('sections.revealUnavailableHint', { defaultValue: 'Open the account with “Edit” and use Reset password to issue a new temporary password. Once they set their own password it becomes private again.' })}
          </div>
        </>
      )}

      {!state.loading && state.password && (
        <>
          <div className="credential-card">
            <div className="credential-row">
              <span className="small text-muted">{t('sections.staffName', { defaultValue: 'Staff member' })}</span>
              <span className="fw-semibold small">{row.full_name}</span>
            </div>
            <div className="credential-row">
              <span className="small text-muted">{t('sections.password', { defaultValue: 'Password' })}</span>
              <div className="d-inline-flex align-items-center gap-1">
                <span className="credential-value">{revealed ? state.password : '•'.repeat(Math.min(14, state.password.length))}</span>
                <button type="button" className="btn btn-sm btn-outline-secondary"
                  title={revealed ? t('sections.hidePassword', { defaultValue: 'Hide password' }) : t('sections.showPassword', { defaultValue: 'Show password' })}
                  aria-label={revealed ? t('sections.hidePassword', { defaultValue: 'Hide password' }) : t('sections.showPassword', { defaultValue: 'Show password' })}
                  onClick={() => setRevealed((r) => !r)}>
                  {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={copy}>
                  <Copy size={13} /> {copied ? t('sections.copied', { defaultValue: 'Copied' }) : t('sections.copyPassword', { defaultValue: 'Copy' })}
                </button>
              </div>
            </div>
          </div>
          <div className="small text-muted mt-2">
            {state.source === 'student-id'
              ? t('sections.studentIdPasswordNote', { defaultValue: 'This is the student’s first password (their student ID). It stops being readable as soon as the student sets a new password.' })
              : t('sections.issuedPasswordNote', { defaultValue: 'This password was issued by the system or an administrator. It remains visible here until the person changes it from Account & security.' })}
            {state.issuedAt && <> · {dateTime(state.issuedAt)}</>}
          </div>
        </>
      )}
    </Modal>
  );
}

function StaffModal({ open, seatsFull, onClose, onDone }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({
    full_name: '', email: '', phone: '', role: 'teacher', password: '', confirm: '', job_title: '', department_id: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const departments = useApi('/departments', { pageSize: 200 }, open);

  useEffect(() => {
    if (open) {
      setValues({ full_name: '', email: '', phone: '', role: 'teacher', password: '', confirm: '', job_title: '', department_id: '' });
      setErrors({});
      setError('');
    }
  }, [open]);

  const set = (name) => (v) => setValues((p) => ({ ...p, [name]: v }));

  const submit = async () => {
    const missing = {};
    if (values.full_name.trim().length < 2) missing.full_name = t('sections.fullNameMin', { defaultValue: 'At least 2 characters' });
    if (!isEmail(values.email)) missing.email = t('sections.emailInvalid', { defaultValue: 'Enter a valid email address' });
    if (!values.role) missing.role = t('common.required');
    if (values.password.length < 8) missing.password = t('sections.passwordMin', { defaultValue: 'Use at least 8 characters' });
    if (values.password !== values.confirm) missing.confirm = t('sections.passwordMismatch', { defaultValue: 'The two passwords do not match' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    setError('');
    try {
      const base = { full_name: values.full_name.trim(), email: values.email.trim(), role: values.role };
      if (values.phone.trim()) base.phone = values.phone.trim();
      if (values.job_title.trim()) base.job_title = values.job_title.trim();
      if (values.department_id) base.department_id = values.department_id;
      await apiPost('/school/users', { ...base, password: values.password });
      toast.success(t('sections.staffCreated', { defaultValue: 'Account created for {{name}}. Share the password with them securely.', name: base.full_name }));
      onDone();
    } catch (e) {
      if (e.status === 409) setError(t('sections.emailTaken', { defaultValue: e.message }));
      else setError(e.message);
    } finally { setBusy(false); }
  };

  const deptOptions = (departments.data || []).map((d) => ({ value: d.id, label: d.name }));

  return (
    <Modal open={open} size="lg" title={t('sections.addStaffTitle', { defaultValue: 'Add a staff member' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || seatsFull}>
            {busy ? '…' : t('sections.createAccount', { defaultValue: 'Create account' })}
          </button>
        </>
      )}>
      {seatsFull && (
        <div className="alert alert-warning small py-2">
          {t('sections.seatsFull', { defaultValue: 'Every staff seat is in use. Upgrade the subscription before creating another account.' })}
        </div>
      )}

      <div className="row">
        <Field field={{ name: 'full_name', required: true, col: 12, label: t('sections.fullName', { defaultValue: 'Full name' }) }}
          value={values.full_name} error={errors.full_name} onChange={set('full_name')} />
        <Field field={{ name: 'email', type: 'email', required: true, col: 6, label: t('common.email') }}
          value={values.email} error={errors.email} onChange={set('email')} />
        <Field field={{ name: 'phone', type: 'tel', col: 6, label: t('common.phone') }}
          value={values.phone} onChange={set('phone')} />

        <div className="col-12 mb-3">
          <label className="form-label small fw-semibold" htmlFor="f-staff-role">
            {t('sections.role', { defaultValue: 'Role' })}<span className="text-danger ms-1">*</span>
          </label>
          <select id="f-staff-role" className={`form-select${errors.role ? ' is-invalid' : ''}`}
            value={values.role} onChange={(e) => setValues((p) => ({ ...p, role: e.target.value }))}>
            {ROLE_GROUPS.map((group) => (
              <optgroup key={group.key} label={t(`sections.roleGroups.${group.key}`, { defaultValue: group.label })}>
                {group.roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="form-text small d-inline-flex align-items-start gap-1">
            <ShieldAlert size={12} className="mt-1" /> {roleHint(t, values.role)}
          </div>
        </div>

        <Field field={{ name: 'password', type: 'password', required: true, col: 6, label: t('sections.initialPassword', { defaultValue: 'Initial password' }), help: t('sections.passwordHelp', { defaultValue: 'At least 8 characters. Stored only as a hash in Supabase Auth.' }) }}
          value={values.password} error={errors.password} onChange={set('password')} />
        <Field field={{ name: 'confirm', type: 'password', required: true, col: 6, label: t('sections.confirmPassword', { defaultValue: 'Confirm password' }) }}
          value={values.confirm} error={errors.confirm} onChange={set('confirm')} />
        <Field field={{ name: 'job_title', col: 6, label: t('sections.jobTitle', { defaultValue: 'Job title (optional)' }), placeholder: t('sections.jobTitleHint', { defaultValue: 'e.g. Senior Accountant' }) }}
          value={values.job_title} onChange={set('job_title')} />
        <Field field={{ name: 'department_id', type: 'select', col: 6, label: t('sections.department', { defaultValue: 'Department (optional)' }), options: deptOptions, placeholder: t('sections.departmentNone', { defaultValue: 'No department' }) }}
          value={values.department_id} onChange={set('department_id')} />
      </div>

      {error && <ErrorState error={{ message: error }} />}

      <div className="small text-muted mt-2">
        {t('sections.createNote', { defaultValue: 'The account is active immediately and signs in with this email and password. The role grant, staff profile and audit entry are written server-side; school_id never comes from the browser.' })}
      </div>
    </Modal>
  );
}

function EditModal({ row, busy, onClose, onSaved, onPhotoUpdated }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ full_name: '', phone: '', role: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarRef = useRef(null);

  useEffect(() => {
    if (row) {
      setValues({ full_name: row.full_name || '', phone: row.phone || '', role: (row.roles || [])[0] || '' });
      setAvatarUrl(row.avatar_url || '');
      setAvatarBusy(false);
      setAvatarError('');
      setErrors({});
      setError('');
    }
  }, [row]);

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarError(t('sections.photoType', { defaultValue: 'Choose a JPG, PNG or WebP image.' }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError(t('sections.photoTooLarge2', { defaultValue: 'That photo is larger than 2 MB — resize it and try again.' }));
      return;
    }
    setAvatarBusy(true);
    setAvatarError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await apiUpload(`/school/users/${row.id}/avatar`, body);
      setAvatarUrl(data.url);
      toast.success(t('sections.photoUpdated', { defaultValue: 'Profile photo updated.' }));
      onPhotoUpdated?.();
    } catch (e) {
      setAvatarError(e.message);
    } finally {
      setAvatarBusy(false);
      if (avatarRef.current) avatarRef.current.value = '';
    }
  };

  const submit = async () => {
    const missing = {};
    if (values.full_name.trim().length < 2) missing.full_name = t('sections.fullNameMin', { defaultValue: 'At least 2 characters' });
    setErrors(missing);
    if (Object.keys(missing).length) return;
    try {
      const body = { full_name: values.full_name.trim() };
      if (values.phone.trim()) body.phone = values.phone.trim();
      if (values.role) body.role = values.role;
      await apiPatch(`/school/users/${row.id}`, body);
      toast.success(t('common.saved'));
      onSaved();
    } catch (e) {
      setError(e.status === 403
        ? t('sections.usersForbidden', { defaultValue: 'Your role cannot change staff accounts.' })
        : e.message);
    }
  };

  if (!row) return null;
  return (
    <Modal open size="md" title={`${t('sections.editUser', { defaultValue: 'Edit account' })} · ${row.full_name}`} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="row">
        <Field field={{ name: 'full_name', required: true, col: 12, label: t('sections.fullName', { defaultValue: 'Full name' }) }}
          value={values.full_name} error={errors.full_name} onChange={(v) => setValues((p) => ({ ...p, full_name: v }))} />
        <div className="col-12 mb-3">
          <label className="form-label small fw-semibold">{t('sections.profilePhoto', { defaultValue: 'Profile photo' })}</label>
          <div className="d-flex align-items-center gap-3">
            <span className="avatar lg" aria-hidden="true">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initials(values.full_name || row.full_name)}
            </span>
            <div>
              <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" className="d-none"
                onChange={(e) => uploadAvatar(e.target.files?.[0])} />
              <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                onClick={() => avatarRef.current?.click()} disabled={avatarBusy}>
                <ImagePlus size={13} />
                {avatarBusy ? '…' : avatarUrl
                  ? t('sections.replacePhoto', { defaultValue: 'Replace photo' })
                  : t('sections.uploadPhoto', { defaultValue: 'Upload photo' })}
              </button>
              <div className="small text-muted mt-1">
                {t('sections.photoHelp', { defaultValue: 'JPG, PNG or WebP · max 2 MB. Shown on the staff list and timetables.' })}
              </div>
              {avatarError && <div className="field-error mt-1">{avatarError}</div>}
            </div>
          </div>
        </div>
        <Field field={{ name: 'phone', type: 'tel', col: 6, label: t('common.phone') }}
          value={values.phone} onChange={(v) => setValues((p) => ({ ...p, phone: v }))} />
        <div className="col-6 mb-3">
          <label className="form-label small fw-semibold" htmlFor="f-edit-role">{t('sections.replaceRole', { defaultValue: 'Role (replaces the current grant)' })}</label>
          <select id="f-edit-role" className="form-select" value={values.role} onChange={(e) => setValues((p) => ({ ...p, role: e.target.value }))}>
            <option value="">{t('sections.keepRoles', { defaultValue: 'Keep current roles' })}</option>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <div className="small text-muted mt-1">
            {t('sections.currentRoles', { defaultValue: 'Currently: {{roles}}', roles: (row.roles || []).map(roleLabel).join(', ') || '—' })}
          </div>
        </div>
      </div>
      <div className="small text-muted mb-2">
        {t('sections.statusLabel', { defaultValue: 'Status' })}: <StatusBadge value={row.status} /> · {row.email}
      </div>
      {error && <ErrorState error={{ message: error }} />}
      <div className="small text-muted mt-2">
        {t('sections.editNote', { defaultValue: 'Email is not editable here. A role change adds the new grant without deleting the old ones, and the profile photo is stored for this school only.' })}
      </div>
      <ResetPasswordBlock row={row} />
    </Modal>
  );
}

function ResetPasswordBlock({ row }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [temporary, setTemporary] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(false); setManual(false); setPassword(''); setConfirm('');
    setTemporary(''); setCopied(false); setError('');
  }, [row?.id]);

  const reset = () => {
    setOpen(false); setManual(false); setPassword(''); setConfirm('');
    setTemporary(''); setCopied(false); setError('');
  };

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await apiPost(`/school/users/${row.id}/reset-password`, { generate: true });
      setTemporary(data?.temporaryPassword || '');
      toast.success(t('sections.tempPasswordCreated', { defaultValue: 'Temporary password created for {{name}}. It stays visible under Show password until they set their own.', name: row.full_name }));
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (password.length < 8) { setError(t('sections.passwordMin', { defaultValue: 'Use at least 8 characters' })); return; }
    if (password !== confirm) { setError(t('sections.passwordMismatch', { defaultValue: 'The two passwords do not match' })); return; }
    setBusy(true);
    setError('');
    try {
      await apiPost(`/school/users/${row.id}/reset-password`, { password });
      toast.success(t('sections.passwordReset', { defaultValue: 'Password reset for {{name}}. Share it with them securely.', name: row.full_name }));
      reset();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="border-top mt-3 pt-3">
      {!open && !temporary && (
        <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setOpen(true)}>
          <KeyRound size={13} /> {t('sections.resetPassword', { defaultValue: 'Reset password' })}
        </button>
      )}

      {open && !temporary && !manual && (
        <>
          <div className="fw-semibold small mb-1">{t('sections.resetPassword', { defaultValue: 'Reset password' })}</div>
          <div className="small text-muted mb-2">
            {t('sections.passwordHashedNote', { defaultValue: 'A password someone set themselves is stored only as a one-way hash and cannot be read. Use Show password to read anything the system or an administrator issued, or generate a temporary password and share it personally — it stays visible under Show password until they replace it.' })}
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={generate} disabled={busy}>
              <KeyRound size={13} /> {busy ? '…' : t('sections.generateTempPassword', { defaultValue: 'Generate temporary password' })}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setManual(true)} disabled={busy}>
              {t('sections.setManually', { defaultValue: 'Set manually' })}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={reset} disabled={busy}>{t('common.cancel')}</button>
          </div>
          {error && <div className="field-error mt-2">{error}</div>}
        </>
      )}

      {temporary && (
        <>
          <div className="fw-semibold small mb-1">{t('sections.tempPasswordTitle', { defaultValue: 'Temporary password' })}</div>
          <div className="small text-muted mb-2">
            {t('sections.tempPasswordNote', { defaultValue: 'Give this to {{name}} through a trusted channel. It also stays readable from Show password until they change it from Account & security after signing in.', name: row.full_name })}
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <code className="fs-6 px-3 py-2 bg-light border rounded text-break">{temporary}</code>
            <button className="btn btn-sm btn-outline-primary" onClick={copy}>
              {copied ? t('sections.copied', { defaultValue: 'Copied' }) : t('sections.copyPassword', { defaultValue: 'Copy' })}
            </button>
          </div>
          <button className="btn btn-sm btn-outline-secondary" onClick={reset}>{t('common.close', { defaultValue: 'Close' })}</button>
        </>
      )}

      {open && manual && !temporary && (
        <>
          <div className="fw-semibold small mb-2">{t('sections.setManually', { defaultValue: 'Set manually' })}</div>
          <div className="row">
            <Field field={{ name: 'reset_password', type: 'password', col: 6, label: t('sections.newPassword', { defaultValue: 'New password' }) }}
              value={password} onChange={setPassword} />
            <Field field={{ name: 'reset_confirm', type: 'password', col: 6, label: t('sections.confirmPassword', { defaultValue: 'Confirm password' }) }}
              value={confirm} onChange={setConfirm} />
          </div>
          {error && <div className="field-error mb-2">{error}</div>}
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('sections.savePassword', { defaultValue: 'Save password' })}</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={reset} disabled={busy}>{t('common.cancel')}</button>
          </div>
        </>
      )}
    </div>
  );
}
