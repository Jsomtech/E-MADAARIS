import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { RefreshCw, Search, Trash2, RotateCcw, Recycle, Building2 } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Badge, ErrorState, PageHeader, dateTime } from '../../components/ui/Basics.jsx';

/**
 * Super-admin recycle bin: every school's deleted rows in one list. A whole-school wipe
 * appears as one bulk entry and restores every table in dependency order.
 */
export default function TrashPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState('');
  const [q, setQ] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'purge'|'empty', row? }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet('/platform/trash', {
        page, pageSize: 25, q: q || undefined, school_id: schoolId || undefined,
      });
      setRows(body.data || []);
      setTotal(body.total ?? 0);
    } catch (e) {
      setError(e);
      setRows(null);
    } finally { setLoading(false); }
  }, [page, q, schoolId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiGet('/platform/schools', { pageSize: 200 })
      .then((res) => setSchools(res.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { setQ(queryInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [queryInput]);

  const restore = async (row) => {
    setBusy(true);
    try {
      await apiPost(`/platform/trash/${row.id}/restore`);
      toast.success(row.bulk
        ? t('sections.bulkRestored', { defaultValue: 'All school data was restored ({{rows}} rows).', rows: row.rows ?? '—' })
        : t('sections.trashRestored', { defaultValue: '“{{name}}” was restored', name: row.label }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const confirmAction = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'empty') {
        const body = await apiPost('/platform/trash/empty', schoolId ? { school_id: schoolId } : {});
        toast.success(t('sections.trashEmptied', { defaultValue: '{{count}} item(s) permanently removed', count: body.data?.purged ?? 0 }));
      } else {
        await apiDelete(`/platform/trash/${confirm.row.id}`);
        toast.success(t('sections.trashPurged', { defaultValue: '“{{name}}” was permanently removed', name: confirm.row.label }));
      }
      setConfirm(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const columns = useMemo(() => [
    {
      key: 'deleted_at', label: t('common.date'), width: 170,
      render: (r) => <span className="small tabular-nums">{dateTime(r.deleted_at)}</span>,
    },
    {
      key: 'school', label: t('modules.schools'), width: 180,
      render: (r) => <span className="small fw-semibold">{r.school_name || '—'}</span>,
    },
    {
      key: 'label', label: t('sections.deletedRecord', { defaultValue: 'Deleted record' }),
      render: (r) => (
        <div className="small">
          <div className="fw-semibold d-flex align-items-center gap-2">
            {r.label || r.record_id || '—'}
            {r.bulk && <Badge tone="warn">{t('sections.bulkSnapshot', { defaultValue: 'Whole school' })}</Badge>}
          </div>
          <div className="text-muted">
            {r.bulk
              ? t('sections.bulkRows', { defaultValue: '{{rows}} rows across all modules', rows: r.rows ?? '—' })
              : `${r.table}${r.has_related ? ` · ${t('sections.withChildRows', { defaultValue: 'with child rows' })}` : ''}`}
          </div>
        </div>
      ),
    },
    {
      key: 'module', label: t('sections.module', { defaultValue: 'Module' }), width: 130,
      render: (r) => <Badge tone="neutral">{r.module || '—'}</Badge>,
    },
    {
      key: 'actions', label: t('common.actions'), width: 220,
      render: (r) => (
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            onClick={() => restore(r)} disabled={busy}>
            <RotateCcw size={14} /> {t('sections.restore', { defaultValue: 'Restore' })}
          </button>
          <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
            onClick={() => setConfirm({ kind: 'purge', row: r })} disabled={busy}>
            <Trash2 size={14} /> {t('common.delete')}
          </button>
        </div>
      ),
    },
  ], [t, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSchool = schools.find((s) => s.id === schoolId);

  return (
    <>
      <PageHeader
        title={t('sections.platformTrashTitle', { defaultValue: 'Recycle bin · all schools' })}
        subtitle={t('sections.platformTrashSubtitle', { defaultValue: 'Deleted records from every tenant. Restoring a whole-school wipe puts every row back in order.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
              onClick={() => setConfirm({ kind: 'empty' })} disabled={!rows?.length || busy}>
              <Trash2 size={14} />
              {schoolId
                ? t('sections.emptySchoolBin', { defaultValue: 'Empty {{name}} bin', name: selectedSchool?.school_name || '…' })
                : t('sections.emptyAllBins', { defaultValue: 'Empty every bin' })}
            </button>
          </>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="row g-2 align-items-center">
          <div className="col-12 col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('sections.searchTrash', { defaultValue: 'Search deleted records…' })} />
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Building2 size={14} /></span>
              <select className="form-select" value={schoolId}
                onChange={(e) => { setSchoolId(e.target.value); setPage(1); }}>
                <option value="">{t('sections.allSchools', { defaultValue: 'All schools' })}</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.school_name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}

      <DataTable columns={columns} rows={rows} total={total} page={page} pageSize={25} onPage={setPage}
        loading={loading} error={null} dense
        empty={t('sections.trashEmpty', { defaultValue: 'Nothing has been deleted recently.' })} />

      <div className="small text-muted mt-2 d-flex align-items-center gap-1">
        <Recycle size={13} />
        {t('sections.platformTrashHint', { defaultValue: 'The dangerous “Delete all school data” action snapshots the school here first, so it can be restored in one click while the entry is still in the bin.' })}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'empty'
          ? t('sections.emptyTrash', { defaultValue: 'Empty bin' })
          : t('sections.deleteForever', { defaultValue: 'Delete permanently' })}
        message={confirm?.kind === 'empty'
          ? schoolId
            ? t('sections.emptySchoolBinConfirm', { defaultValue: 'Permanently remove every bin item for “{{name}}”? This cannot be undone.', name: selectedSchool?.school_name || '…' })
            : t('sections.emptyAllBinsConfirm', { defaultValue: 'Permanently remove every bin item for every school? This cannot be undone.' })
          : t('sections.purgeConfirm', { defaultValue: 'Permanently remove “{{name}}” from the recycle bin?', name: confirm?.row?.label })}
        confirmLabel={t('sections.deleteForever', { defaultValue: 'Delete permanently' })}
        onClose={() => setConfirm(null)} onConfirm={confirmAction} busy={busy}
      />
    </>
  );
}
