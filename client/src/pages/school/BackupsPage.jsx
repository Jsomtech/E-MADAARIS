import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { DatabaseBackup, Download, RefreshCw, ShieldAlert, Trash2, Loader2 } from 'lucide-react';
import { apiGet, apiSweep, sweepFailure, downloadFile } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, ErrorState, PageHeader, StatCard, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const kb = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** School backup console: run manual snapshots, download stored JSON, and the danger zone. */
export default function BackupsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const schoolName = profile?.school?.school_name || '';
  const [body, setBody] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBody(await apiGet('/school/backups', { page, pageSize: 20 }));
    } catch (e) { setError(e); setBody(null); } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const rows = body?.data || [];
  const latest = rows[0]?.metadata;

  const runBackup = async () => {
    setBusy(true);
    try {
      const result = await apiSweep('/school/backups');
      toast.success(t('sections.backupCreated', {
        defaultValue: 'Backup created · {{rows}} rows ({{size}})',
        rows: result.data?.totalRows ?? 0, size: kb(result.data?.sizeBytes),
      }));
      setPage(1);
      load();
    } catch (e) { toast.error(sweepFailure(e)); } finally { setBusy(false); }
  };

  const clearData = async () => {
    setClearing(true);
    try {
      const result = await apiSweep('/school/data/clear', { confirm: confirmName });
      setConfirmName('');
      toast.success(t('sections.dataClearedRecoverable', {
        defaultValue: 'School cleared ({{tables}} tables, {{rows}} rows, {{users}} logins removed). Your administrator login stays, and everything is restorable from the recycle bin.',
        tables: result.data?.tables ?? 0, rows: result.data?.rows ?? 0, users: result.data?.users ?? 0,
      }));
      setPage(1);
      load();
    } catch (e) {
      toast.error(sweepFailure(e));
    } finally { setClearing(false); }
  };

  const columns = useMemo(() => [
    {
      key: 'created_at', label: t('common.date'), width: 190,
      render: (r) => <span className="small tabular-nums">{dateTime(r.created_at)}</span>,
    },
    {
      key: 'kind', label: t('sections.backupKind', { defaultValue: 'Type' }), width: 120,
      render: (r) => (
        <Badge tone={r.metadata?.kind === 'auto' ? 'info' : 'brand'}>
          {r.metadata?.kind === 'auto' ? t('sections.automatic', { defaultValue: 'Automatic' }) : t('sections.manual', { defaultValue: 'Manual' })}
        </Badge>
      ),
    },
    {
      key: 'summary', label: t('sections.contents', { defaultValue: 'Contents' }),
      render: (r) => (
        <div className="small">
          <div>{r.summary}</div>
          <div className="text-muted">
            {r.metadata?.total_rows ?? 0} {t('common.rows')} · {Object.keys(r.metadata?.tables || {}).length} tables
          </div>
        </div>
      ),
    },
    {
      key: 'size', label: t('sections.size', { defaultValue: 'Size' }), width: 110,
      render: (r) => <span className="small tabular-nums">{kb(r.metadata?.size_bytes)}</span>,
    },
    {
      key: 'download', label: t('common.actions'), width: 150,
      render: (r) => (
        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
          onClick={() => downloadFile(`/school/backups/${r.id}/download`, `${schoolName || 'school'}-backup.json`)
            .catch((e) => toast.error(e.message))}>
          <Download size={14} /> {t('common.download', { defaultValue: 'Download' })}
        </button>
      ),
    },
  ], [t, schoolName]);

  return (
    <>
      <PageHeader
        title={t('sections.backupsTitle', { defaultValue: 'Backups' })}
        subtitle={t('sections.backupsSubtitle', { defaultValue: 'Snapshots of every student, class, exam, fee and learning record in this school.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={runBackup} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <DatabaseBackup size={14} />}
              {t('sections.backupNow', { defaultValue: 'Backup now' })}
            </button>
          </>
        )}
      />

      <div className="row g-3 mb-2">
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.storedBackups', { defaultValue: 'Stored backups' })} value={body?.total ?? '—'} icon={DatabaseBackup} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.lastBackup', { defaultValue: 'Last backup' })}
            value={latest?.generated_at ? dateTime(latest.generated_at) : '—'} icon={RefreshCw} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.rowsCaptured', { defaultValue: 'Rows captured' })} value={latest?.total_rows ?? '—'} icon={DatabaseBackup} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.snapshotSize', { defaultValue: 'Snapshot size' })} value={kb(latest?.size_bytes)} icon={DatabaseBackup} />
        </div>
      </div>

      <div className="alert alert-info d-flex gap-2 small py-2" role="status">
        <DatabaseBackup size={16} className="flex-shrink-0 mt-1" />
        <div>{t('sections.backupAutoHint', { defaultValue: 'The platform super admin can schedule automatic backups every 10 seconds. Automatic snapshots skip unchanged data and older ones rotate out automatically.' })}</div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}

      <DataTable columns={columns} rows={rows} total={body?.total} page={page} pageSize={20} onPage={setPage}
        loading={loading} error={null} dense
        empty={t('sections.backupsEmpty', { defaultValue: 'No backups yet. Click “Backup now” to create the first snapshot.' })} />

      <div className="card-soft p-3 mt-4 border-danger-subtle">
        <div className="d-flex align-items-center gap-2 fw-semibold text-danger">
          <ShieldAlert size={17} /> {t('sections.dangerZone', { defaultValue: 'Danger zone' })}
        </div>
        <p className="small text-muted mb-2 mt-1">
          {t('sections.clearDataHint', { defaultValue: 'Deletes every student, class, exam, fee, attendance, learning and operations record, and every staff, student and parent login account. Your own administrator login, the school profile, branding, roles and subscription stay. Everything is snapshotted into the recycle bin first, and the Super Admin can restore it.' })}
        </p>
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-5">
            <label className="form-label small fw-semibold mb-0" htmlFor="clear-confirm">
              {t('sections.typeSchoolName', { defaultValue: 'Type “{{name}}” to confirm', name: schoolName })}
            </label>
            <input id="clear-confirm" className="form-control form-control-sm" value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)} placeholder={schoolName} />
          </div>
          <div className="col-12 col-md-auto">
            <button type="button" className="btn btn-sm btn-danger d-inline-flex align-items-center gap-1"
              onClick={clearData} disabled={clearing || !schoolName || confirmName !== schoolName}>
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t('sections.clearAllData', { defaultValue: 'Delete all school data' })}
            </button>
          </div>
        </div>
        <div className="small text-muted mt-2">
          {t('sections.clearDataHint2', { defaultValue: 'The wipe is reversible from the recycle bin until that bin entry is purged. A backup is still the safest copy.' })}
        </div>
      </div>
    </>
  );
}
