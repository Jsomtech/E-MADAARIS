// Student ID cards: POST /school/id-cards/generate + the read-only /student-id-cards list.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Ban, BadgeCheck, CheckCircle2, Copy, CreditCard, RefreshCw, Search, UserSearch } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, PageHeader, Spinner, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

function verifyPath(code) {
  return `/verify/student-id/${encodeURIComponent(String(code || ''))}`;
}

const CARD_PAGE_SIZE = 25;

export default function IdCardsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [cardsPage, setCardsPage] = useState(1);
  const [picked, setPicked] = useState('');
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);

  const mayGenerate = can('students.manage');
  const mayRead = can('students.view');

  const students = useApi('/students', { pageSize: 25, q: search || undefined, page }, mayRead);
  const cards = useApi('/student-id-cards', { pageSize: CARD_PAGE_SIZE, page: cardsPage }, mayRead);

  useEffect(() => {
    const id = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const generate = useCallback(async (studentId) => {
    setBusy(true);
    try {
      const { data } = await apiPost('/school/id-cards/generate', { student_id: studentId });
      setIssued(data);
      toast.success(t('sections.cardIssued', { defaultValue: 'Card ready for {{name}}.', name: data?.student?.full_name || '' }));
      cards.reload();
    } catch (error) {
      if (error.status === 403) toast.error(t('sections.cardForbidden', { defaultValue: 'Generating cards needs the students.manage permission.' }));
      else if (error.status === 404) toast.error(t('sections.cardNotFound', { defaultValue: 'That student is not in your school.' }));
      else toast.error(error.message);
    } finally { setBusy(false); }
  }, [cards, t]);

  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('sections.copied', { defaultValue: 'Copied to the clipboard.' }));
    } catch {
      toast.info(t('sections.copyManual', { defaultValue: 'Clipboard blocked — copy it by hand: {{text}}', text }));
    }
  }, [t]);

  const columns = useMemo(() => [
    {
      key: 'student',
      label: t('sections.student', { defaultValue: 'Student' }),
      render: (row) => (
        <div>
          <div className="fw-semibold small">{row.students?.full_name || String(row.student_id).slice(0, 8)}</div>
          <div className="small text-muted">{row.students?.admission_number || '—'} · {row.students?.classes?.name || t('sections.unassigned', { defaultValue: 'no class' })}</div>
        </div>
      ),
    },
    {
      key: 'verification_code',
      label: t('sections.code', { defaultValue: 'Verification code' }),
      render: (row) => (
        <div className="d-flex align-items-center gap-2">
          <code className="small">{row.verification_code}</code>
          <button className="btn btn-sm btn-outline-secondary py-0" title={t('sections.copyCode', { defaultValue: 'Copy code' })} onClick={() => copy(row.verification_code)}>
            <Copy size={12} />
          </button>
        </div>
      ),
    },
    { key: 'academic_year', label: t('sections.academicYearLabel', { defaultValue: 'Year stamped' }), width: 120, render: (r) => <span className="small">{r.academic_year || '—'}</span> },
    {
      key: 'public',
      label: t('sections.publicUrl', { defaultValue: 'Public check' }),
      width: 150,
      render: (row) => <a className="small d-inline-flex align-items-center gap-1" href={`${window.location.origin}${verifyPath(row.verification_code)}`} target="_blank" rel="noreferrer"><CreditCard size={13} /> {t('sections.openVerify', { defaultValue: 'verify page' })}</a>,
    },
    { key: 'created_at', label: t('sections.createdOn', { defaultValue: 'Created' }), width: 170, render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span> },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 120,
      className: 'text-end',
      render: (row) => (
        <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={!mayGenerate || busy} onClick={() => generate(row.student_id)}>
          <RefreshCw size={13} /> {t('sections.reissue', { defaultValue: 'Re-issue' })}
        </button>
      ),
    },
  ], [busy, copy, generate, mayGenerate, t]);

  if (!mayGenerate && !mayRead) {
    return (
      <>
        <PageHeader title={t('sections.idCardsTitle', { defaultValue: 'Student ID cards' })} />
        <div className="card-soft">
          <EmptyState icon={Ban} title={t('sections.idCardsNoAccess', { defaultValue: 'This page is for registrars and administrators (students.view / students.manage).' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.idCardsTitle', { defaultValue: 'Student ID cards' })}
        subtitle={t('sections.idCardsSubtitle', { defaultValue: 'One verifiable card per student, checked publicly without signing in.' })}
      />

      {!mayGenerate && (
        <div className="alert alert-warning small py-2">
          {t('sections.idCardsReadOnly', { defaultValue: 'You can list cards, but issuing them needs students.manage — the POST /school/id-cards/generate route rejects your role.' })}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card-soft p-3">
            <div className="fw-semibold mb-2"><UserSearch size={15} className="me-1" /> {t('sections.findStudent', { defaultValue: 'Find a student' })}</div>
            <div className="input-group input-group-sm mb-2">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sections.searchStudents', { defaultValue: 'Search first/middle/last name or admission number…' })} />
            </div>
            <div className="small text-muted mb-2">
              {t('sections.searchServer', { defaultValue: 'Server-side ilike over first_name, middle_name, last_name, admission_number · page {{page}} of the paginated list.', page })}
            </div>

            {students.loading && !students.data && <Spinner label={t('common.loading')} />}
            {students.error && <EmptyState title={students.error.message} />}

            <DataTable dense rows={students.data} loading={students.loading} error={students.error} onRetry={students.reload}
              total={students.total} page={page} pageSize={25} onPage={setPage}
              empty={t('sections.noStudentMatch', { defaultValue: 'No student matches this search' })}
              columns={[
                {
                  key: 'full_name',
                  label: t('sections.student', { defaultValue: 'Student' }),
                  render: (row) => (
                    <div>
                      <div className="fw-semibold small">{row.full_name || row.first_name}</div>
                      <div className="small text-muted">{row.admission_number}</div>
                    </div>
                  ),
                },
                { key: 'status', label: t('common.status'), type: 'status', width: 110 },
                {
                  key: 'generate',
                  label: t('common.actions'),
                  width: 150,
                  className: 'text-end',
                  render: (row) => (
                    <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" disabled={!mayGenerate || busy}
                      onClick={() => { setPicked(row.id); generate(row.id); }}>
                      <BadgeCheck size={13} /> {t('sections.issueCard', { defaultValue: 'Issue card' })}
                    </button>
                  ),
                },
              ]} />
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="card-soft p-3">
            <div className="fw-semibold mb-2"><CreditCard size={15} className="me-1" /> {t('sections.lastIssued', { defaultValue: 'Last card issued' })}</div>
            {!issued && <EmptyState icon={CreditCard} title={t('sections.noneIssued', { defaultValue: 'Nothing issued in this session' })} hint={t('sections.noneIssuedHint', { defaultValue: 'Pick a student on the left and press "Issue card".' })} />}
            {issued && (
              <>
                <div className="fs-5 fw-bold">{issued.student?.full_name || '—'}</div>
                <div className="small text-muted mb-3">{issued.student?.admission_number} · {t('sections.yearStamped', { defaultValue: 'academic year' })} {issued.academic_year}</div>
                <div className="mb-2">
                  <div className="form-label small fw-semibold">{t('sections.code', { defaultValue: 'Verification code' })}</div>
                  <div className="d-flex gap-2">
                    <input readOnly className="form-control form-control-sm font-monospace" value={issued.verification_code} onFocus={(e) => e.target.select()} />
                    <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => copy(issued.verification_code)}>
                      <Copy size={13} /> {t('sections.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                </div>
                <div className="mb-2">
                  <div className="form-label small fw-semibold">{t('sections.publicLink', { defaultValue: 'Public verification link' })}</div>
                  <div className="d-flex gap-2">
                    <input readOnly className="form-control form-control-sm" value={`${window.location.origin}${verifyPath(issued.verification_code)}`} onFocus={(e) => e.target.select()} />
                    <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                      onClick={() => copy(`${window.location.origin}${verifyPath(issued.verification_code)}`)}>
                      <Copy size={13} /> {t('sections.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                  <div className="form-text small">
                    <CheckCircle2 size={12} className="me-1" />
                    {t('sections.publicHint', { defaultValue: 'Anyone opening that link hits the public route GET /public/student-id/:code (no auth), which only returns school name, student name, admission number and the academic year.' })}
                  </div>
                </div>
                <div className="d-flex gap-2 mt-2">
                  <a className="btn btn-sm btn-outline-secondary" href={`${window.location.origin}${verifyPath(issued.verification_code)}`} target="_blank" rel="noreferrer">{t('sections.checkNow', { defaultValue: 'Check it now' })}</a>
                  <Link to="/m/students" className="btn btn-sm btn-outline-secondary">{t('modules.students')}</Link>
                </div>
                <div className="small text-muted mt-2">
                  {t('sections.upsertNote', { defaultValue: 'The table has a unique (school_id, student_id) constraint and the route upserts, so re-issuing keeps the same code and only refreshes the stamped academic year.' })}
                </div>
                {picked && <div className="small text-muted">Last student id: <Badge tone="neutral">{String(picked).slice(0, 8)}</Badge></div>}
              </>
            )}
          </div>

          <div className="card-soft p-3 mt-3 small text-muted">
            {t('sections.codeShape', { defaultValue: 'The verification code is the student ID itself: school prefix + academic year + sequence (for example AQ260001). Prefixes come from the school name (Al Qalam → AQ), so IDs never mix between schools.' })}
          </div>
        </div>

        <div className="col-12">
          <div className="fw-semibold mb-2"><BadgeCheck size={15} className="me-1" /> {t('sections.issuedCards', { defaultValue: 'Issued cards' })}</div>
          <DataTable columns={columns} rows={cards.data} loading={cards.loading} error={cards.error} onRetry={cards.reload} dense
            total={cards.total} page={cardsPage} pageSize={CARD_PAGE_SIZE} onPage={setCardsPage}
            empty={t('sections.noCards', { defaultValue: 'No cards issued for this school yet' })} />
          <div className="small text-muted mt-2">
            {t('sections.cardsSource', { defaultValue: 'GET /student-id-cards (read-only) joins students and classes; it can be narrowed with ?student_id= or ?academic_year= and searched by verification_code, and it is paged at 25 rows.' })}
          </div>
        </div>
      </div>
    </>
  );
}
