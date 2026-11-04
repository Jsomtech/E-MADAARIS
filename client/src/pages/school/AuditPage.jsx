// School-scoped audit trail: GET /school/audit (page/pageSize/module/action/q, and the module list it embeds).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ScrollText, Search, ShieldAlert } from 'lucide-react';
import { apiGet } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const PAGE_SIZES = [25, 50, 100, 200];

export default function AuditPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [modules, setModules] = useState([]);
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mayView = can('audit.view');

  const load = useCallback(async () => {
    if (!mayView) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet('/school/audit', {
        module: moduleFilter || undefined,
        action: action || undefined,
        q: q || undefined,
        page,
        pageSize,
      });
      setRows(body.data || []);
      setTotal(body.total ?? 0);
      setPage(body.page || page);
      setModules(Array.isArray(body.modules) ? body.modules : []);
    } catch (e) {
      setError(e);
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [mayView, moduleFilter, action, q, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // The server does an exact match on action, so trim before sending it.
  useEffect(() => {
    const id = setTimeout(() => { setAction(actionInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [actionInput]);

  useEffect(() => {
    const id = setTimeout(() => { setQ(queryInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [queryInput]);

  const columns = useMemo(() => [
    {
      key: 'created_at',
      label: t('common.date'),
      width: 170,
      render: (r) => <span className="small tabular-nums">{dateTime(r.created_at)}</span>,
    },
    {
      key: 'module',
      label: t('sections.module', { defaultValue: 'Module' }),
      width: 130,
      render: (r) => <Badge tone="neutral">{r.module || '—'}</Badge>,
    },
    {
      key: 'action',
      label: t('sections.action', { defaultValue: 'Action' }),
      width: 150,
      render: (r) => <span className="small text-capitalize">{String(r.action || '—').replace(/_/g, ' ')}</span>,
    },
    {
      key: 'summary',
      label: t('sections.summary', { defaultValue: 'Summary' }),
      render: (row) => (
        <div className="small">
          <div>{row.summary || t('sections.noSummary', { defaultValue: 'No summary recorded' })}</div>
          <div className="text-muted">
            {t('sections.who', { defaultValue: 'user' })} {String(row.user_id || '—').slice(0, 8)}
            {row.record_id && <> · {t('sections.record', { defaultValue: 'record' })} {String(row.record_id).slice(0, 8)}</>}
            {row.ip_address && <> · {row.ip_address}</>}
          </div>
        </div>
      ),
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
  ], [t]);

  if (!mayView) {
    return (
      <>
        <PageHeader title={t('sections.auditTitle', { defaultValue: 'Audit activity' })} />
        <div className="card-soft">
          <EmptyState icon={ShieldAlert} title={t('sections.auditNoAccessTitle', { defaultValue: 'Needs audit.view' })}
            hint={t('sections.auditNoAccess', { defaultValue: 'Only roles granted audit.view can read this trail.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.auditTitle', { defaultValue: 'Audit activity' })}
        subtitle={t('sections.auditSubtitle', { defaultValue: '{{total}} entries in this school, newest first.', total: total ?? '…' })}
        actions={(
          <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        )}
      />

      <div className="card-soft p-3 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('sections.searchAudit', { defaultValue: 'Search summary, module or action…' })} />
            </div>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold mb-0" htmlFor="aud-module">{t('sections.module', { defaultValue: 'Module' })}</label>
            <select id="aud-module" className="form-select form-select-sm" value={moduleFilter}
              onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }}>
              <option value="">{t('common.all')}</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="aud-action">{t('sections.action', { defaultValue: 'Action' })}</label>
            <input id="aud-action" className="form-control form-control-sm" value={actionInput} onChange={(e) => setActionInput(e.target.value)}
              placeholder={t('sections.actionExample', { defaultValue: 'updated' })} />
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="aud-size">{t('sections.perPage', { defaultValue: 'Per page' })}</label>
            <select id="aud-size" className="form-select form-select-sm" value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-1">
            <button className="btn btn-sm btn-outline-secondary w-100"
              onClick={() => { setQueryInput(''); setQ(''); setActionInput(''); setAction(''); setModuleFilter(''); setPage(1); }}>
              {t('sections.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>
        <div className="small text-muted mt-2">
          {t('sections.auditFilterHelp', { defaultValue: 'The module list is the de-duplicated set the response itself returns (modules: […], built from this school\'s 2000 newest entries). action is an exact server-side match; q searches summary/module/action with ilike.' })}
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}

      <DataTable columns={columns} rows={rows} total={total} page={page} pageSize={pageSize} onPage={setPage}
        loading={loading} error={null} dense
        empty={t('sections.auditEmpty', { defaultValue: 'No audit entries match these filters' })} />

      <div className="small text-muted mt-2 d-flex align-items-center gap-1">
        <ScrollText size={13} />
        {t('sections.auditScope', { defaultValue: 'This trail is school-scoped: the route filters on your own school_id and user_scope = school, so platform-side actions are never listed here. Entries are read-only and cannot be edited or deleted.' })}
      </div>
      <div className="small text-muted mt-1">
        {t('sections.auditStatusValues', { defaultValue: 'status is success or failure; pageSize is capped at 200 by the server (default 50).' })}
      </div>
    </>
  );
}
