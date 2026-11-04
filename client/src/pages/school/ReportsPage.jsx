// CSV reports: authenticated blob download of /school/reports/:type plus a CRUD-backed preview.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Activity, AlertTriangle, Download, FileSpreadsheet, Table2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { API_BASE, tokens } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, PageHeader, StatusBadge, dateOnly, dateTime, money } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Mirrors the REPORTS map in server/src/api/flows/extras.js lines 262-269:
 * type -> the permission the route demands and the exact CSV column order it writes.
 */
const REPORTS = [
  {
    type: 'students', perm: 'students.export',
    labelKey: 'sections.reportStudents', fallback: 'Students',
    table: 'students', previewPath: '/students',
    columns: ['full_name', 'admission_number', 'gender', 'status', 'created_at'],
  },
  {
    type: 'staff', perm: 'reports.export',
    labelKey: 'sections.reportStaff', fallback: 'Staff',
    table: 'school_users', previewPath: '/school/users',
    columns: ['full_name', 'email', 'phone', 'status', 'created_at'],
  },
  {
    type: 'payments', perm: 'finance.export',
    labelKey: 'sections.reportPayments', fallback: 'Fee payments',
    table: 'fee_payments', previewPath: '/fee-payments',
    columns: ['transaction_reference', 'student_id', 'amount', 'payment_method', 'status', 'paid_at'],
  },
  {
    type: 'expenses', perm: 'finance.export',
    labelKey: 'sections.reportExpenses', fallback: 'Expenses',
    table: 'expenses', previewPath: '/expenses',
    columns: ['title', 'amount', 'expense_date', 'status'],
  },
  {
    type: 'attendance-summary', perm: 'attendance.export',
    labelKey: 'sections.reportAttendance', fallback: 'Attendance summary',
    table: 'attendance_records', previewPath: '/attendance-records',
    columns: ['student_id', 'class_id', 'attendance_date', 'attendance_status'],
  },
  {
    type: 'discipline', perm: 'discipline.export',
    labelKey: 'sections.reportDiscipline', fallback: 'Discipline records',
    table: 'discipline_records', previewPath: '/discipline-records',
    columns: ['student_id', 'incident_date', 'incident_type', 'action_taken', 'status'],
  },
];

const COLUMN_LABELS = {
  full_name: 'sections.colName', student_id: 'sections.colStudent', class_id: 'sections.colClass',
  admission_number: 'sections.colAdmission', gender: 'sections.colGender', status: 'common.status',
  created_at: 'sections.colCreated', email: 'common.email', phone: 'common.phone',
  transaction_reference: 'sections.colReference', amount: 'common.amount', payment_method: 'sections.colMethod',
  paid_at: 'sections.colPaid', title: 'sections.colTitle', expense_date: 'sections.colDate',
  attendance_date: 'sections.colDate', attendance_status: 'sections.colStatus',
  incident_date: 'sections.colDate', incident_type: 'sections.colType', action_taken: 'sections.colAction',
};

/** from/to are the only query params reportRouter reads, and they always land on created_at. */
function buildQuery(from, to) {
  const parts = [];
  if (from) parts.push(`from=${encodeURIComponent(`${from}T00:00:00.000`)}`);
  if (to) parts.push(`to=${encodeURIComponent(`${to}T23:59:59.999`)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function downloadCsv(type, from, to) {
  const query = buildQuery(from, to);
  const res = await fetch(`${API_BASE}/school/reports/${type}${query}`, {
    headers: { Authorization: `Bearer ${tokens.access || ''}` },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = JSON.parse(await res.text());
      message = payload?.error || payload?.message || message;
    } catch { /* a non-JSON body means a proxy/gateway failure */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const { can, canAny } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [active, setActive] = useState('students');
  const [downloading, setDownloading] = useState('');

  const mayExport = canAny(['reports.export', 'students.export', 'finance.export']);
  const report = REPORTS.find((r) => r.type === active) || REPORTS[0];

  // Preview comes from the matching CRUD resource (25 rows), NOT from the CSV route.
  const preview = useApi(report.previewPath, { pageSize: 25 }, mayExport);

  const columns = useMemo(() => (report.columns || []).map((key) => ({
    key,
    label: key === 'status'
      ? t('common.status')
      : t(COLUMN_LABELS[key] || 'sections.colColumn', { defaultValue: key.replace(/_/g, ' ') }),
    render: (row) => {
      if (row[key] === null || row[key] === undefined || row[key] === '') return <span className="text-muted small">—</span>;
      if (key === 'status') return <StatusBadge value={row[key]} />;
      if (key === 'attendance_status') return <StatusBadge value={row[key]} />;
      if (key === 'created_at' || key === 'paid_at') return <span className="small text-muted">{dateTime(row[key])}</span>;
      if (['attendance_date', 'incident_date', 'expense_date'].includes(key)) return <span className="small">{dateOnly(row[key])}</span>;
      if (key === 'amount') return <span className="tabular-nums">{money(row[key], row.currency)}</span>;
      if (key === 'student_id') return <span className="small">{row.students?.full_name || String(row[key]).slice(0, 8)}</span>;
      if (key === 'class_id') return <span className="small">{row.classes?.name || String(row[key]).slice(0, 8)}</span>;
      if (key === 'payment_method') return <span className="small">{String(row[key]).replace(/_/g, ' ')}</span>;
      if (key === 'action_taken') return <span className="small text-truncate d-inline-block" style={{ maxWidth: 220 }}>{row[key]}</span>;
      return <span className="small">{String(row[key])}</span>;
    },
  })), [report, t]);

  const run = async (type) => {
    setDownloading(type);
    try {
      await downloadCsv(type, from, to);
      toast.success(t('sections.csvDownloaded', { defaultValue: '{{type}}.csv downloaded.', type }));
    } catch (error) {
      if (error.status === 403) toast.error(t('sections.csvForbidden', { defaultValue: '403 — your account has no export permission for {{type}} (the route checks a per-report permission).', type }));
      else if (error.status === 401) toast.error(t('sections.csvUnauthenticated', { defaultValue: '401 — your session expired; sign in again and retry.' }));
      else if (error.status >= 500) toast.error(t('sections.csvServerError', { defaultValue: '500 — the report failed on the server: {{message}}', message: error.message }));
      else toast.error(error.message);
    } finally { setDownloading(''); }
  };

  if (!mayExport) {
    return (
      <>
        <PageHeader title={t('sections.reportsTitle', { defaultValue: 'Reports & exports' })} />
        <div className="card-soft">
          <EmptyState icon={AlertTriangle} title={t('sections.reportsNoAccessTitle', { defaultValue: 'No export permission' })}
            hint={t('sections.reportsNoAccess', { defaultValue: 'This page needs reports.export, students.export or finance.export. Some reports additionally require attendance.export or discipline.export.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.reportsTitle', { defaultValue: 'Reports & exports' })}
        subtitle={t('sections.reportsSubtitle', { defaultValue: 'Six CSV exports generated server-side, each capped at 50 000 rows and written to the audit trail as reports/exported.' })}
      />

      <div className="card-soft p-3 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold" htmlFor="rpt-from">{t('sections.dateFrom', { defaultValue: 'Created from' })}</label>
            <input id="rpt-from" type="date" className="form-control form-control-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold" htmlFor="rpt-to">{t('sections.dateTo', { defaultValue: 'Created to' })}</label>
            <input id="rpt-to" type="date" className="form-control form-control-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="col-12 col-md-6">
            <div className="alert alert-secondary small py-2 mb-0">
              {t('sections.dateRangeHelp', { defaultValue: 'from and to are the only parameters /school/reports/:type accepts, and they filter created_at for every report — so "attendance-summary" is narrowed by when the row was inserted, not by attendance_date.' })}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        {REPORTS.map((r) => {
          const allowed = can(r.perm);
          return (
            <div className="col-6 col-lg-4" key={r.type}>
              <div className={`card-soft p-3 h-100 ${r.type === active ? 'border border-primary' : ''}`}>
                <div className="d-flex justify-content-between align-items-start mb-1">
                  <div>
                    <div className="fw-semibold">{t(r.labelKey, { defaultValue: r.fallback })}</div>
                    <div className="small text-muted"><code>/school/reports/{r.type}</code></div>
                  </div>
                  <FileSpreadsheet size={18} className="text-muted" />
                </div>
                <div className="small text-muted mb-2">
                  <Badge tone={allowed ? 'ok' : 'danger'}>{r.perm}</Badge>
                  <span className="ms-1">{t('sections.tableLabel', { defaultValue: 'table' })} <code>{r.table}</code></span>
                </div>
                <div className="small text-muted mb-2">{t('sections.columnsLabel', { defaultValue: 'Columns' })}: {r.columns.join(', ')}</div>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setActive(r.type)}>
                    <Table2 size={13} /> {t('sections.preview', { defaultValue: 'Preview' })}
                  </button>
                  <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" disabled={!allowed || Boolean(downloading)}
                    onClick={() => run(r.type)}>
                    <Download size={13} /> {downloading === r.type ? '…' : t('common.export')}
                  </button>
                </div>
                {!allowed && <div className="small text-danger mt-2">{t('sections.permMissing', { defaultValue: 'Your account lacks {{perm}} — the route answers 403.', perm: r.perm })}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="fw-semibold">
          <Activity size={15} className="me-1" />
          {t('sections.previewTitle', { defaultValue: 'Preview of {{name}}', name: t(report.labelKey, { defaultValue: report.fallback }) })}
        </div>
        <span className="small text-muted">{t('sections.previewSource', { defaultValue: 'From GET {{path}} · pageSize 25 (not the CSV route)', path: report.previewPath })}</span>
      </div>

      <DataTable columns={columns} rows={preview.data} loading={preview.loading} error={preview.error} onRetry={preview.reload} dense
        empty={t('sections.previewEmpty', { defaultValue: 'Nothing to preview for this report' })} />

      <div className="small text-muted mt-2 d-flex align-items-center gap-1">
        <AlertTriangle size={13} />
        {t('sections.previewNote', { defaultValue: 'The preview uses the CRUD resource behind the report, so it can need a different permission (users.view for staff, finance.view for payments/expenses, attendance.view, discipline.view) — a 403 here does not mean the export is blocked.' })}
      </div>
    </>
  );
}
