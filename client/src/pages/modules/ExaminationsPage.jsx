/**
 * Examinations: list what exists, create an examination with its class/subject scopes and
 * optional components in one call, then hand off to the marks and results flows.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { ClipboardList, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, PageHeader, Spinner, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EntityPage from '../../components/EntityPage.jsx';
import { RESOURCES } from '../../config/resources.jsx';

const STATUSES = ['draft', 'scheduled'];
const newScope = () => ({ class_id: '', subject_id: '', total_marks: 100, components: [] });
const newComponent = () => ({ name: '', weight_percent: 100, maximum_marks: 100 });

export default function ExaminationsPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [open, setOpen] = useState(Boolean(query.create));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({
    name: '', examination_type_id: '', academic_year_id: '', term_id: '', status: 'draft', scopes: [newScope()],
  });

  const list = useApi('/examinations', { pageSize: 100 });
  const types = useApi('/examination-types', { pageSize: 200 });
  const years = useApi('/academic-years', { pageSize: 200, is_current: true });
  const allYears = useApi('/academic-years', { pageSize: 200 });
  const terms = useApi('/terms', { pageSize: 200, ...(form.academic_year_id ? { academic_year_id: form.academic_year_id } : {}) });
  const classes = useApi('/classes', { pageSize: 200 });
  const subjects = useApi('/subjects', { pageSize: 200 });
  const scopes = useApi('/exam-class-subjects', { pageSize: 200 });

  const yearOptions = useMemo(() => (allYears.data?.length ? allYears.data : years.data || []), [allYears.data, years.data]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setScope = (index, patch) => setForm((prev) => ({
    ...prev,
    scopes: prev.scopes.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  }));
  const setComponent = (scopeIndex, compIndex, patch) => setForm((prev) => ({
    ...prev,
    scopes: prev.scopes.map((s, i) => (i !== scopeIndex ? s : {
      ...s,
      components: s.components.map((c, j) => (j === compIndex ? { ...c, ...patch } : c)),
    })),
  }));

  const create = async () => {
    setFormError('');
    const missing = {};
    if (form.name.trim().length < 2) missing.name = t('modules.examNameRequired', { defaultValue: 'Give the examination a name (2+ characters)' });
    const usable = form.scopes.filter((s) => s.class_id && s.subject_id);
    if (!usable.length) missing.scopes = t('modules.needOneScope', { defaultValue: 'Add at least one class + subject scope' });
    setFieldErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      await apiPost('/examinations', {
        name: form.name.trim(),
        status: form.status,
        ...(form.examination_type_id ? { examination_type_id: form.examination_type_id } : {}),
        ...(form.academic_year_id ? { academic_year_id: form.academic_year_id } : {}),
        ...(form.term_id ? { term_id: form.term_id } : {}),
        scopes: usable.map((s) => ({
          class_id: s.class_id,
          subject_id: s.subject_id,
          total_marks: Number(s.total_marks) || 100,
          ...(s.components.filter((c) => c.name.trim()).length
            ? {
              components: s.components.filter((c) => c.name.trim())
                .map((c) => ({
                  name: c.name.trim(),
                  weight_percent: Number(c.weight_percent) || 100,
                  maximum_marks: Number(c.maximum_marks) || 100,
                })),
            }
            : {}),
        })),
      });
      toast.success(t('modules.examCreated', { defaultValue: 'Examination created' }));
      setOpen(false);
      setForm({ name: '', examination_type_id: '', academic_year_id: '', term_id: '', status: 'draft', scopes: [newScope()] });
      list.reload();
      scopes.reload();
    } catch (error) {
      setFormError(error.message);
      if (Array.isArray(error.details)) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      } else if (error.details && typeof error.details === 'object') {
        setFieldErrors(error.details);
      }
      if (error.status === 403) {
        setFormError(t('modules.forbiddenCreate', { defaultValue: 'Your role is not allowed to create examinations.' }));
      }
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name',
      label: t('modules.examination', { defaultValue: 'Examination' }),
      render: (row) => (
        <div>
          <div className="fw-semibold small">{row.name || row.title || `${String(row.id).slice(0, 8)}`}</div>
          <div className="text-muted small">{dateOnly(row.created_at)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      label: t('common.status'),
      render: (row) => (
        <div className="d-flex flex-column gap-1">
          <StatusBadge value={row.status} />
          <span className="text-muted small">{(scopes.data || []).filter((s) => s.examination_id === row.id).length} {t('modules.scopesLower', { defaultValue: 'scopes' })}</span>
        </div>
      ),
    },
    {
      key: 'examination_type_id',
      label: t('modules.examination-types', { defaultValue: 'Examination type' }),
      render: (row) => <span className="small">{row.examination_types?.name || (types.data || []).find((x) => x.id === row.examination_type_id)?.name || '—'}</span>,
    },
    {
      key: 'academic_year_id',
      label: t('modules.academic-years', { defaultValue: 'Academic year' }),
      render: (row) => <span className="small">{row.academic_years?.name || yearOptions.find((y) => y.id === row.academic_year_id)?.name || '—'}</span>,
    },
    {
      key: 'term_id',
      label: t('modules.terms', { defaultValue: 'Term' }),
      render: (row) => <span className="small">{row.terms?.name || (terms.data || []).find((x) => x.id === row.term_id)?.name || '—'}</span>,
    },
    { key: 'created_at', label: t('modules.created', { defaultValue: 'Created' }), type: 'datetime' },
    {
      key: 'actions',
      label: t('common.actions'),
      render: (row) => (
        <div className="d-flex flex-wrap gap-1">
          <Link className="btn btn-sm btn-outline-secondary" to={`/m/marks?examination_id=${row.id}`}>
            <ClipboardList size={13} className="me-1" />{t('modules.marks', { defaultValue: 'Marks' })}
          </Link>
          <Link className="btn btn-sm btn-outline-secondary" to={`/m/report-card?examination_id=${row.id}`}>
            <ExternalLink size={13} className="me-1" />{t('modules.report-card', { defaultValue: 'Report card' })}
          </Link>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('modules.examinations', { defaultValue: 'Examinations' })}
        subtitle={t('modules.examinationsHint', { defaultValue: 'An examination bundles the class + subject scopes (and optional components) that marks are entered against.' })}
        actions={(
          <>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => { list.reload(); scopes.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {can('examinations.create') && (
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={() => { setFormError(''); setOpen(true); }}>
                <Plus size={14} /> {t('modules.newExamination', { defaultValue: 'New examination' })}
              </button>
            )}
            <Link className="btn btn-outline-dark btn-sm" to="/m/results">{t('modules.results', { defaultValue: 'Results & approvals' })}</Link>
          </>
        )}
      />

      {list.error && (
        <div className="alert alert-warning d-flex justify-content-between align-items-center">
          <div>
            <div className="fw-semibold">{t('modules.examListMissing', { defaultValue: 'The examination list is not served by the API yet.' })}</div>
            <div className="small">{list.error.message}</div>
          </div>
          <button className="btn btn-sm btn-outline-dark" onClick={list.reload}>{t('common.retry')}</button>
        </div>
      )}

      {list.loading && !list.data && <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>}

      {!list.loading && !list.error && !(list.data || []).length && (
        <div className="card-soft p-4">
          <EmptyState title={t('modules.noExaminations', { defaultValue: 'No examinations created yet' })}
            hint={t('modules.noExaminationsHint', { defaultValue: 'Create one to open marks entry for its classes and subjects.' })} />
        </div>
      )}

      {!list.loading && !list.error && (list.data || []).length > 0 && (
        <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} />
      )}

      <div className="mt-4">
        <EntityPage config={{ ...RESOURCES['exam-class-subjects'], key: 'exam-class-subjects' }}
          title={t('modules.examScope', { defaultValue: 'Class + subject scope' })}
          subtitle={t('modules.examScopeHint', { defaultValue: 'Add a missing scope to an existing examination, or correct its total marks.' })} />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} size="xl"
        title={t('modules.newExamination', { defaultValue: 'New examination' })}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? '…' : t('modules.createExamination', { defaultValue: 'Create examination' })}</button>
          </>
        )}>
        {formError && <div className="alert alert-danger py-2 small">{formError}</div>}
        <div className="row">
          <div className="col-12 col-md-6 mb-3">
            <label className="form-label small fw-semibold" htmlFor="ex-name">{t('modules.name', { defaultValue: 'Name' })}<span className="text-danger"> *</span></label>
            <input id="ex-name" className={`form-control${fieldErrors.name ? ' is-invalid' : ''}`} value={form.name}
              placeholder={t('modules.examNamePlaceholder', { defaultValue: 'e.g. Term 1 final examination' })}
              onChange={(e) => set({ name: e.target.value })} />
            {fieldErrors.name && <div className="form-text text-danger small">{fieldErrors.name}</div>}
          </div>
          <div className="col-6 col-md-3 mb-3">
            <label className="form-label small fw-semibold" htmlFor="ex-type">{t('modules.examination-types', { defaultValue: 'Examination type' })}</label>
            <select id="ex-type" className="form-select" value={form.examination_type_id} onChange={(e) => set({ examination_type_id: e.target.value })}>
              <option value="">{t('common.none')}</option>
              {(types.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-3 mb-3">
            <label className="form-label small fw-semibold" htmlFor="ex-status">{t('common.status')}</label>
            <select id="ex-status" className="form-select" value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-4 mb-3">
            <label className="form-label small fw-semibold" htmlFor="ex-year">{t('modules.academic-years', { defaultValue: 'Academic year' })}</label>
            <select id="ex-year" className="form-select" value={form.academic_year_id}
              onChange={(e) => set({ academic_year_id: e.target.value, term_id: '' })}>
              <option value="">{t('common.none')}</option>
              {yearOptions.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-4 mb-3">
            <label className="form-label small fw-semibold" htmlFor="ex-term">{t('modules.terms', { defaultValue: 'Term' })}</label>
            <select id="ex-term" className="form-select" value={form.term_id} onChange={(e) => set({ term_id: e.target.value })}>
              <option value="">{t('common.none')}</option>
              {(terms.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center mt-2 mb-2">
          <div className="fw-semibold">{t('modules.scopesTitle', { defaultValue: 'Scopes (class + subject)' })}</div>
          <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
            onClick={() => set({ scopes: [...form.scopes, newScope()] })}>
            <Plus size={14} /> {t('modules.addScope', { defaultValue: 'Add scope' })}
          </button>
        </div>
        {fieldErrors.scopes && <div className="form-text text-danger small mb-2">{fieldErrors.scopes}</div>}

        {form.scopes.map((scope, index) => (
          <div className="card-soft p-2 mb-2" key={index}>
            <div className="row g-2 align-items-end">
              <div className="col-12 col-md-4">
                <label className="form-label small fw-semibold mb-1">{t('modules.class', { defaultValue: 'Class' })}</label>
                <select className="form-select form-select-sm" value={scope.class_id} onChange={(e) => setScope(index, { class_id: e.target.value })}>
                  <option value="">{t('modules.selectClass', { defaultValue: 'Select class' })}</option>
                  {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label small fw-semibold mb-1">{t('modules.subject', { defaultValue: 'Subject' })}</label>
                <select className="form-select form-select-sm" value={scope.subject_id} onChange={(e) => setScope(index, { subject_id: e.target.value })}>
                  <option value="">{t('modules.selectSubject', { defaultValue: 'Select subject' })}</option>
                  {(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-2">
                <label className="form-label small fw-semibold mb-1">{t('modules.totalMarks', { defaultValue: 'Total marks' })}</label>
                <input type="number" min="1" step="any" className="form-control form-control-sm" value={scope.total_marks}
                  onChange={(e) => setScope(index, { total_marks: e.target.value })} />
              </div>
              <div className="col-12 col-md-3 text-md-end">
                <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                  onClick={() => setScope(index, { components: [...scope.components, newComponent()] })}>
                  <Plus size={13} /> {t('modules.addComponent', { defaultValue: 'Component' })}
                </button>
                {form.scopes.length > 1 && (
                  <button className="btn btn-sm btn-outline-danger ms-1" onClick={() => set({ scopes: form.scopes.filter((_, i) => i !== index) })}
                    title={t('modules.removeScope', { defaultValue: 'Remove scope' })}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {scope.components.length > 0 && (
              <div className="mt-2">
                {scope.components.map((comp, compIndex) => (
                  <div className="row g-2 align-items-end mb-1" key={compIndex}>
                    <div className="col-12 col-md-5">
                      <input className="form-control form-control-sm" value={comp.name} placeholder={t('modules.componentName', { defaultValue: 'e.g. Continuous assessment' })}
                        onChange={(e) => setComponent(index, compIndex, { name: e.target.value })} />
                    </div>
                    <div className="col-4 col-md-3">
                      <input type="number" min="0" max="100" step="any" className="form-control form-control-sm" value={comp.weight_percent}
                        aria-label={t('modules.weightPercent', { defaultValue: 'Weight %' })}
                        onChange={(e) => setComponent(index, compIndex, { weight_percent: e.target.value })} />
                    </div>
                    <div className="col-4 col-md-2">
                      <input type="number" min="1" step="any" className="form-control form-control-sm" value={comp.maximum_marks}
                        aria-label={t('modules.maximumMarks', { defaultValue: 'Max marks' })}
                        onChange={(e) => setComponent(index, compIndex, { maximum_marks: e.target.value })} />
                    </div>
                    <div className="col-4 col-md-2 text-end">
                      <button className="btn btn-sm btn-outline-danger w-100"
                        onClick={() => setScope(index, { components: scope.components.filter((_, i) => i !== compIndex) })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Modal>

      {!can('examinations.create') && (
        <div className="alert alert-light border small mt-3 mb-0">
          {t('modules.cannotCreate', { defaultValue: 'You can review examinations but your role cannot create them.' })}
        </div>
      )}
    </>
  );
}
