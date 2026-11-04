// Read-only family portal for student/parent accounts: GET /school/me/students + /attendance/summary + guardian links.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Ban, BookOpen, CalendarDays, ExternalLink, FileCheck2, GraduationCap, Info, Mail, MapPin, Phone, ReceiptText, RefreshCw, ShieldAlert, Star, User, Users } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];
const BAR_TONE = { present: 'bg-success', absent: 'bg-danger', late: 'bg-warning', excused: 'bg-info' };
const GUARDIAN_LINK_PAGE = 100;   // /student-guardians?student_id= links for one child
const GUARDIAN_PAGE = 200;        // hard server ceiling on pageSize

export default function MyChildrenPage() {
  const { t } = useTranslation();
  const { can, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const mine = useApi('/school/me/students');
  const students = mine.data || [];
  const [selectedId, setSelectedId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // The ?student_id= deep link wins; otherwise the first (alphabetical) linked student is shown.
  useEffect(() => {
    if (!mine.data) return;
    const list = mine.data || [];
    if (!list.length) { setSelectedId(''); return; }
    const fromUrl = searchParams.get('student_id');
    const picked = fromUrl && list.some((s) => s.id === fromUrl) ? fromUrl : list[0].id;
    setSelectedId((current) => (current && list.some((s) => s.id === current) ? current : picked));
  }, [mine.data, searchParams]);

  const student = useMemo(() => students.find((s) => s.id === selectedId) || null, [students, selectedId]);

  const pick = (id) => {
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    next.set('student_id', id);
    setSearchParams(next, { replace: true });
  };

  const maySeeAttendance = can('attendance.view');
  const attParams = useMemo(() => {
    const params = { student_id: selectedId };
    if (from) params.from = from;
    if (to) params.to = to;
    return params;
  }, [selectedId, from, to]);
  const attendance = useApi('/attendance/summary', attParams, Boolean(selectedId) && maySeeAttendance);
  // Response is a map keyed by student id: { [id]: { present, absent, late, excused, total, rate } }
  const att = attendance.data?.[selectedId] || null;

  const maySeeGuardians = can('guardians.view');
  const links = useApi('/student-guardians', { student_id: selectedId, pageSize: GUARDIAN_LINK_PAGE }, Boolean(selectedId) && maySeeGuardians);
  const linkRows = links.data || [];
  const guardians = useApi('/guardians', { pageSize: GUARDIAN_PAGE }, maySeeGuardians && linkRows.length > 0);
  const guardianById = useMemo(
    () => Object.fromEntries((guardians.data || []).map((g) => [g.id, g])),
    [guardians.data],
  );
  const guardianTotal = guardians.total ?? (guardians.data || []).length;

  const guardianColumns = [
    {
      key: 'guardian_id',
      label: t('sections.guardian', { defaultValue: 'Guardian' }),
      render: (row) => {
        const g = guardianById[row.guardian_id];
        return (
          <div>
            <div className="fw-semibold small">
              {g?.full_name || t('sections.guardianOutsidePage', { defaultValue: 'Guardian {{id}} (not in the first {{n}} rows)', id: String(row.guardian_id).slice(0, 8), n: GUARDIAN_PAGE })}
            </div>
            <div className="small text-muted">{row.relationship || g?.relationship || '—'}</div>
          </div>
        );
      },
    },
    {
      key: 'is_primary',
      label: t('sections.primary', { defaultValue: 'Primary' }),
      width: 100,
      render: (row) => (row.is_primary
        ? <Badge tone="brand"><Star size={11} className="me-1" />{t('common.yes')}</Badge>
        : <span className="small text-muted">{t('common.no')}</span>),
    },
    { key: 'phone', label: t('sections.phone', { defaultValue: 'Phone' }), render: (row) => <PhoneCell value={guardianById[row.guardian_id]?.phone} /> },
    { key: 'email', label: t('common.email'), render: (row) => <EmailCell value={guardianById[row.guardian_id]?.email} /> },
    { key: 'occupation', label: t('sections.occupation', { defaultValue: 'Occupation' }), render: (row) => <span className="small">{guardianById[row.guardian_id]?.occupation || '—'}</span> },
    { key: 'address', label: t('sections.address', { defaultValue: 'Address' }), render: (row) => <span className="small text-muted">{guardianById[row.guardian_id]?.address || '—'}</span> },
  ];

  if (mine.error?.status === 403) {
    return (
      <>
        <PageHeader title={t('sections.myChildrenTitle', { defaultValue: 'My children' })} />
        <div className="card-soft">
          <EmptyState icon={Ban}
            title={t('sections.myChildrenStaffTitle', { defaultValue: 'This page is for student and parent accounts only' })}
            hint={t('sections.myChildrenStaffHint', { defaultValue: 'GET /school/me/students answers 403 “Not a student or parent account” for staff. Open the students module instead to browse every enrolment.' })} />
        </div>
      </>
    );
  }

  const noStudents = !mine.loading && !mine.error && students.length === 0;

  return (
    <>
      <PageHeader
        title={profile?.primaryRole === 'student'
          ? t('sections.myProfileTitle', { defaultValue: 'My profile' })
          : t('sections.myChildrenTitle', { defaultValue: 'My children' })}
        subtitle={profile?.school?.school_name
          || t('sections.myChildrenSubtitle', { defaultValue: 'Read-only view of the student record the school keeps for this account.' })}
        actions={(
          <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => { mine.reload(); attendance.reload(); links.reload(); guardians.reload(); }}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        )}
      />

      {mine.loading && !mine.data && <EmptyState icon={Users} title={t('common.loading')} />}

      {mine.error && mine.error.status !== 403 && <ErrorState error={mine.error} onRetry={mine.reload} />}

      {noStudents && (
        <div className="card-soft">
          <EmptyState icon={GraduationCap}
            title={t('sections.noLinkedStudent', { defaultValue: 'No student is linked to this account yet' })}
            hint={t('sections.myChildrenLinkHint', { defaultValue: 'A student login needs students.user_id; a parent login needs guardians.user_id plus a student_guardians row. Staff with students.edit / guardians.manage set those — until then this page stays empty. Use Support to ask the school office.' })} />
        </div>
      )}

      {students.length > 1 && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {students.map((s) => (
            <button key={s.id} type="button"
              className={`btn btn-sm ${s.id === selectedId ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => pick(s.id)}>
              {s.full_name || s.admission_number}
            </button>
          ))}
        </div>
      )}

      {student && (
        <>
          <div className="row g-3">
            <div className="col-12 col-lg-4">
              <div className="card-soft p-3 h-100">
                <div className="d-flex align-items-start gap-3">
                  <Avatar name={student.full_name} url={student.photo_url} size={64} />
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-bold text-truncate">{student.full_name || '—'}</div>
                    <div className="small text-muted">{student.admission_number}</div>
                    <div className="mt-1"><StatusBadge value={student.status} /></div>
                  </div>
                </div>
                <hr />
                <Detail icon={CalendarDays} label={t('sections.class', { defaultValue: 'Class' })}
                  value={`${student.classes?.name || t('sections.unassignedClass', { defaultValue: 'Not assigned yet' })}${student.sections?.name ? ` / ${student.sections.name}` : ''}`} />
                <Detail icon={GraduationCap} label={t('sections.academicYear', { defaultValue: 'Academic year' })} value={student.academic_years?.name || '—'} />
                <Detail icon={User} label={t('sections.gender', { defaultValue: 'Gender' })} value={student.gender ? String(student.gender).replace(/_/g, ' ') : '—'} />
                <Detail icon={CalendarDays} label={t('sections.dateOfBirth', { defaultValue: 'Date of birth' })}
                  value={student.date_of_birth ? `${dateOnly(student.date_of_birth)}${ageOf(student.date_of_birth) != null ? ` · ${ageOf(student.date_of_birth)} ${t('sections.yearsShort', { defaultValue: 'yrs' })}` : ''}` : '—'}
                  hint={student.date_of_birth ? t('sections.ageDerived', { defaultValue: 'age computed in the browser, not sent by the API' }) : null} />
                <Detail icon={Info} label={t('sections.admissionDate', { defaultValue: 'Admitted on' })} value={dateOnly(student.admission_date)} />
                {student.previous_school && <Detail icon={BookOpen} label={t('sections.previousSchool', { defaultValue: 'Previous school' })} value={student.previous_school} />}
                {student.address && <Detail icon={MapPin} label={t('sections.address', { defaultValue: 'Address' })} value={student.address} />}
                {student.emergency_contact && <Detail icon={ShieldAlert} label={t('sections.emergencyContact', { defaultValue: 'Emergency contact' })} value={student.emergency_contact} />}
              </div>
            </div>

            <div className="col-12 col-lg-8">
              <div className="card-soft p-3 h-100">
                <div className="fw-semibold mb-2"><Activity size={15} className="me-1" /> {t('sections.attendanceSummary', { defaultValue: 'Attendance summary' })}</div>

                {!maySeeAttendance && (
                  <EmptyState icon={Ban} title={t('sections.attendanceNoPerm', { defaultValue: 'Your role has no attendance.view permission' })}
                    hint={t('sections.attendanceNoPermHint', { defaultValue: 'GET /attendance/summary is guarded by attendance.view, so this card cannot load for your account. The school office can tell you which role your login carries.' })} />
                )}

                {maySeeAttendance && (
                  <>
                    <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
                      <label className="small text-muted mb-0">
                        {t('sections.fromDate', { defaultValue: 'From' })}
                        <input type="date" className="form-control form-control-sm ms-2 d-inline-block w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                      </label>
                      <label className="small text-muted mb-0">
                        {t('sections.toDate', { defaultValue: 'To' })}
                        <input type="date" className="form-control form-control-sm ms-2 d-inline-block w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
                      </label>
                      {(from || to) && (
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => { setFrom(''); setTo(''); }}>
                          {t('sections.clearDates', { defaultValue: 'Whole history' })}
                        </button>
                      )}
                      <span className="small text-muted ms-auto">
                        {t('sections.summaryScope', { defaultValue: 'Counts daily + subject sessions together; blank dates = every record on file.' })}
                      </span>
                    </div>

                    {attendance.loading && !attendance.data && <EmptyState title={t('common.loading')} />}
                    {attendance.error && <ErrorState error={attendance.error} onRetry={attendance.reload} />}
                    {!attendance.loading && !attendance.error && !att && (
                      <EmptyState icon={Activity} title={t('sections.noAttendance', { defaultValue: 'No attendance record in this range' })}
                        hint={t('sections.noAttendanceHint', { defaultValue: 'The endpoint only returns keys for students that actually have attendance_records rows, so an absent key means zero sessions — not a failed request.' })} />
                    )}

                    {att && (
                      <>
                        <div className="row g-3 mb-3">
                          <StatBox label={t('sections.sessions', { defaultValue: 'Sessions' })} value={att.total} />
                          <StatBox label={t('sections.attendanceRate', { defaultValue: 'Attendance rate' })} value={att.rate != null ? `${att.rate}%` : '—'} tone={att.rate == null ? '' : att.rate >= 90 ? 'text-success' : att.rate >= 75 ? 'text-warning' : 'text-danger'} />
                          <StatBox label={t('sections.absences', { defaultValue: 'Absences' })} value={att.absent} tone="text-danger" />
                          <StatBox label={t('sections.lateArrivals', { defaultValue: 'Late' })} value={att.late} tone="text-warning" />
                        </div>
                        {ATTENDANCE_STATUSES.map((status) => {
                          const n = Number(att[status] || 0);
                          const pct = att.total ? Math.round((n / att.total) * 100) : 0;
                          return (
                            <div key={status} className="mb-2">
                              <div className="d-flex justify-content-between small">
                                <span className="text-capitalize">{status.replace(/_/g, ' ')}</span>
                                <span className="text-muted tabular-nums">{n} · {pct}%</span>
                              </div>
                              <div className="progress" style={{ height: 6 }}>
                                <div className={`progress-bar ${BAR_TONE[status]}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        <div className="small text-muted mt-2">
                          {t('sections.rateFormula', { defaultValue: 'rate = (present + late) ÷ total, rounded — the server counts attendance_records rows (capped at 20 000) and does not weight double periods.' })}
                        </div>
                      </>
                    )}
                  </>
                )}

                <hr />
                <div className="fw-semibold mb-2">{t('sections.quickLinks', { defaultValue: 'Other records for this student' })}</div>
                <div className="d-flex flex-wrap gap-2">
                  <Link to={`/school/my-fees?student_id=${student.id}`} className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
                    <ReceiptText size={14} /> {t('sections.fees', { defaultValue: 'Fees' })}
                  </Link>
                  {can('results.view') || can('marks.view') ? (
                    <Link to={`/m/report-card?student_id=${student.id}`} className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1">
                      <FileCheck2 size={14} /> {t('sections.reportCard', { defaultValue: 'Report card' })}
                    </Link>
                  ) : (
                    <span className="btn btn-sm btn-outline-secondary disabled opacity-50" title={t('sections.reportCardLocked', { defaultValue: 'results.view / marks.view is required by GET /examinations/report-card' })}>
                      <FileCheck2 size={14} className="me-1" />{t('sections.reportCard', { defaultValue: 'Report card' })}
                    </span>
                  )}
                  {can('learning.view') ? (
                    <Link to="/m/learning-materials" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1">
                      <BookOpen size={14} /> {t('sections.learningMaterials', { defaultValue: 'Learning materials' })}
                    </Link>
                  ) : null}
                  {can('timetable.view') ? (
                    <Link to="/m/timetable-entries" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1">
                      <CalendarDays size={14} /> {t('sections.timetable', { defaultValue: 'Timetable' })}
                      <ExternalLink size={12} />
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="card-soft p-3 mt-3">
            <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
              <div className="fw-semibold"><Users size={15} className="me-1" /> {t('sections.guardians', { defaultValue: 'Guardians on file' })}</div>
              {linkRows.length > 0 && (
                <span className="small text-muted">{t('sections.linkedGuardians', { defaultValue: '{{n}} relationship link(s)', n: linkRows.length })}</span>
              )}
            </div>

            {!maySeeGuardians && (
              <div className="small text-muted">
                {t('sections.guardiansLocked', { defaultValue: 'Neither the student nor the parent role ships with guardians.view, so /student-guardians and /guardians answer 403 for this account. The guardian contact details live in the school office records — ask them there or through a Support ticket.' })}
              </div>
            )}

            {maySeeGuardians && (
              <>
                {links.loading && !links.data && <EmptyState title={t('common.loading')} />}
                {links.error && <ErrorState error={links.error} onRetry={links.reload} />}
                {!links.loading && !links.error && linkRows.length === 0 && (
                  <EmptyState icon={Users} title={t('sections.noGuardianLinks', { defaultValue: 'No guardian is linked to this student' })}
                    hint={t('sections.noGuardianLinksHint', { defaultValue: 'The parent login that sees this page must appear here — student_guardians is the only link the API follows.' })} />
                )}
                {linkRows.length > 0 && (
                  <>
                    <DataTable columns={guardianColumns} rows={linkRows} loading={guardians.loading} dense
                      empty={t('sections.noGuardians', { defaultValue: 'No guardian record readable by your role' })} />
                    {guardians.error && <div className="mt-2"><ErrorState error={guardians.error} onRetry={guardians.reload} /></div>}
                    {guardianTotal > linkRows.length && (
                      <div className="small text-muted mt-2">
                        {t('sections.guardianTruncated', { defaultValue: 'Names are resolved from the {{n}} most recent guardian rows of {{total}}; a link outside that window shows only its id.', n: GUARDIAN_PAGE, total: guardianTotal })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="small text-muted mt-3">
            <div>{t('sections.meStudentsShape', { defaultValue: 'Everything on this card comes from GET /school/me/students: it selects students with classes(name), sections(name) and academic_years(name) embedded, ordered by full_name, with no pagination and no total — the id list is derived from students.user_id (student logins) or guardians.user_id → student_guardians (parent logins).' })}</div>
            <div>{t('sections.readOnlyShape', { defaultValue: 'This page is read-only by design: full_name is a generated column, admission_number and school_id are server-managed, and PATCH /students is only reachable with students.edit, which family roles do not have.' })}</div>
          </div>
        </>
      )}

      {students.length > 1 && (
        <div className="row g-3 mt-1">
          {students.filter((s) => s.id !== selectedId).map((s) => (
            <div key={s.id} className="col-12 col-md-6 col-xl-4">
              <div className="card-soft p-3 h-100">
                <div className="d-flex align-items-center gap-3">
                  <Avatar name={s.full_name} url={s.photo_url} size={44} />
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold text-truncate">{s.full_name || '—'}</div>
                    <div className="small text-muted">{s.classes?.name || t('sections.unassignedClass', { defaultValue: 'Not assigned yet' })} · {s.admission_number}</div>
                  </div>
                  <StatusBadge value={s.status} />
                </div>
                <div className="d-flex flex-wrap gap-2 mt-2">
                  <button className="btn btn-sm btn-outline-primary" onClick={() => pick(s.id)}>{t('sections.viewProfile', { defaultValue: 'View profile' })}</button>
                  <Link to={`/school/my-fees?student_id=${s.id}`} className="btn btn-sm btn-outline-secondary"><ReceiptText size={13} /></Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Detail({ icon: Icon, label, value, hint }) {
  return (
    <div className="d-flex align-items-start gap-2 py-1">
      {Icon && <Icon size={14} className="text-muted mt-1 flex-shrink-0" />}
      <div className="flex-grow-1">
        <div className="small text-muted">{label}</div>
        <div className="small fw-semibold">{value ?? '—'}</div>
        {hint && <div className="small text-muted">{hint}</div>}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  return (
    <div className="col-6 col-md-3">
      <div className="border rounded p-2 h-100">
        <div className="small text-muted text-uppercase">{label}</div>
        <div className={`fs-5 fw-bold lh-1 ${tone || ''}`}>{value ?? '—'}</div>
      </div>
    </div>
  );
}

function PhoneCell({ value }) {
  if (!value) return <span className="text-muted small">—</span>;
  return (
    <a className="small d-inline-flex align-items-center gap-1" href={`tel:${value}`}>
      <Phone size={12} /> {value}
    </a>
  );
}

function EmailCell({ value }) {
  if (!value) return <span className="text-muted small">—</span>;
  return (
    <a className="small d-inline-flex align-items-center gap-1" href={`mailto:${value}`}>
      <Mail size={12} /> {value}
    </a>
  );
}

function Avatar({ name, url, size = 48 }) {
  const [broken, setBroken] = useState(false);
  const initials = String(name || '?').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  if (url && !broken) {
    return <img src={url} alt="" onError={() => setBroken(true)} className="rounded-circle bg-secondary-subtle"
      style={{ width: size, height: size, objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div className="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center fw-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size / 3 }}>
      {url && broken ? <User size={size / 2.5} /> : initials}
    </div>
  );
}

function ageOf(dateValue) {
  if (!dateValue) return null;
  const dob = new Date(dateValue);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const notYetThisYear = now.getMonth() < dob.getMonth()
    || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (notYetThisYear) years -= 1;
  return years >= 0 && years < 120 ? years : null;
}
