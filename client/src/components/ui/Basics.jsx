import { Loader2, Inbox, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

export function Spinner({ label }) {
  return (
    <div className="d-flex align-items-center justify-content-center gap-2 text-muted py-4" style={{ fontSize: '.85rem' }}>
      <Loader2 size={18} className="animate-spin" />
      {label || 'Loading…'}
    </div>
  );
}

export function EmptyState({ title = 'No records found', hint, icon: Icon = Inbox }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={24} /></div>
      <div className="empty-title">{title}</div>
      {hint && <div className="small mt-1">{hint}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state-alert">
      <AlertTriangle size={18} className="mt-1 flex-shrink-0" />
      <div className="flex-grow-1">
        <div className="fw-semibold">Request failed</div>
        <div className="small">{String(error?.message || error)}</div>
      </div>
      {onRetry && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

const TONES = { neutral: 'neutral', ok: 'ok', warn: 'warn', danger: 'danger', brand: 'brand', info: 'info' };

export function Badge({ children, tone = 'neutral', className }) {
  return (
    <span className={clsx('badge-soft', `tone-${TONES[tone] || 'neutral'}`, className)}>
      <span className="dot" />
      {children}
    </span>
  );
}

const STATUS_TONE = {
  active: 'ok', published: 'ok', paid: 'ok', approved: 'ok', resolved: 'ok', cleared: 'ok',
  successful: 'ok', submitted: 'ok', present: 'ok', graduated: 'info',
  pending: 'warn', pending_approval: 'warn', pending_verification: 'warn', draft: 'neutral',
  partial: 'warn', partially_paid: 'warn', in_progress: 'info', scheduled: 'info', trial: 'info',
  processing: 'info', waiting_for_school: 'warn', open: 'info', unassigned: 'warn',
  suspended: 'danger', expired: 'danger', rejected: 'danger', failed: 'danger', inactive: 'danger',
  withdrawn: 'danger', blocked: 'danger', cancelled: 'danger', overdue: 'danger', deleted: 'danger',
  unpaid: 'danger', absent: 'danger', void: 'danger', lost: 'danger',
};

export function StatusBadge({ value }) {
  if (!value) return <span className="text-muted small">—</span>;
  return <Badge tone={STATUS_TONE[value] || 'neutral'}>{String(value).replace(/_/g, ' ')}</Badge>;
}

export function StatCard({ label, value, icon: Icon, tone = 'brand', hint, footer }) {
  return (
    <div className="card-soft p-3 h-100">
      <div className="stat-card">
        {Icon && <div className={`stat-icon tone-${tone}`}><Icon size={20} /></div>}
        <div className="min-width-0">
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value ?? '—'}</div>
          {hint && <div className="stat-hint mt-1">{hint}</div>}
        </div>
      </div>
      {footer && <div className="mt-2 pt-2 border-top stat-hint">{footer}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="page-header">
      <div className="min-width-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function money(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

export function dateOnly(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

export function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}
