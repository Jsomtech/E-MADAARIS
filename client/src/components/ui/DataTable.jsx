import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, FileDown, Loader2, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState, ErrorState, Spinner, StatusBadge, money } from './Basics.jsx';

/**
 * columns: [{ key, label, render(row), type: 'status'|'money'|'date'|'datetime', width, className }]
 * rows come from the API; `total`/`page`/`pageSize` drive the pager when supplied.
 * `onDocument` adds a per-row download (e.g. the student clearance document).
 */
export default function DataTable({
  columns, rows, loading, error, onRetry, total, page, pageSize, onPage,
  onEdit, onDelete, onDocument, documentLabel, rowKey = (r) => r.id, empty, dense, actionsLabel,
}) {
  const { t } = useTranslation();
  const size = pageSize || 25;
  const rowCount = rows?.length || 0;
  const pagerTotal = total != null ? total : rowCount;
  const pages = Math.max(1, Math.ceil(pagerTotal / size));
  const current = page || 1;
  const hasActions = Boolean(onEdit || onDelete || onDocument);
  const [docBusy, setDocBusy] = useState(null);

  if (loading && !rows) return <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>;
  if (error) return <div className="card-soft p-3"><ErrorState error={error} onRetry={onRetry} /></div>;

  const cell = (row, col) => {
    if (col.render) return col.render(row);
    const value = row[col.key];
    if (col.type === 'status') return <StatusBadge value={value} />;
    if (col.type === 'money') return <span className="tabular-nums">{money(value, row.currency)}</span>;
    if (col.type === 'date') return <span className="tabular-nums">{String(value || '—').slice(0, 10)}</span>;
    if (col.type === 'datetime') return value ? new Date(value).toLocaleString() : '—';
    if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
    return String(value);
  };

  const from = pagerTotal ? (current - 1) * size + 1 : 0;
  const to = pagerTotal ? Math.min(current * size, pagerTotal) : 0;

  return (
    <div className="card-soft overflow-hidden">
      <div className="table-responsive">
        <table className={clsx('table table-hover align-middle', dense && 'small')}>
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              {hasActions && <th className="text-end">{actionsLabel || t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>{cell(row, c)}</td>
                ))}
                {hasActions && (
                  <td className="text-end white-space-nowrap">
                    {onDocument && (
                      <button type="button" className="btn btn-icon sm" disabled={docBusy === rowKey(row)}
                        onClick={() => { setDocBusy(rowKey(row)); Promise.resolve(onDocument(row)).finally(() => setDocBusy(null)); }}
                        title={documentLabel || t('common.download', { defaultValue: 'Download' })}
                        aria-label={documentLabel || t('common.download', { defaultValue: 'Download' })}>
                        {docBusy === rowKey(row) ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                      </button>
                    )}
                    {onEdit && (
                      <button type="button" className="btn btn-icon sm" onClick={() => onEdit(row)} title={t('common.edit')} aria-label={t('common.edit')}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" className="btn btn-icon sm" onClick={() => onDelete(row)} title={t('common.delete')} aria-label={t('common.delete')}
                        style={{ color: '#c62b2b' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {(!rows || !rows.length) && (
              <tr>
                <td colSpan={columns.length + (hasActions ? 1 : 0)}>
                  <EmptyState title={empty || t('common.empty')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagerTotal > 0 && (
        <div className="table-pager">
          <span className="tabular-nums">
            {from}–{to} {t('common.of')} {pagerTotal} {t('common.rows')}
          </span>
          <div className="pager-group">
            <button type="button" className="btn btn-icon sm" disabled={current <= 1} onClick={() => onPage?.(current - 1)} aria-label={t('common.back')}>
              <ChevronLeft size={15} />
            </button>
            <span className="px-1 fw-semibold text-dark">{current} / {pages}</span>
            <button type="button" className="btn btn-icon sm" disabled={current >= pages} onClick={() => onPage?.(current + 1)} aria-label={t('common.next')}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
