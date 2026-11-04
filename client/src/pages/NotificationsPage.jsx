import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Bell, CheckCheck } from 'lucide-react';
import { apiPost } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { PageHeader, EmptyState, Spinner, ErrorState, Badge, dateTime } from '../components/ui/Basics.jsx';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reload } = useApi('/school/notifications', unreadOnly ? { unread: 'true' } : undefined);
  const items = Array.isArray(data) ? data : [];

  const markAll = async () => {
    try { await apiPost('/school/notifications/read-all', {}); toast.success(t('common.saved')); reload(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader
        title={t('common.notifications')}
        subtitle={t('notifications.subtitle', { defaultValue: 'Messages routed to your account only.' })}
        actions={(
          <>
            <button className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setUnreadOnly((v) => !v)}>
              {t('notifications.unreadOnly', { defaultValue: 'Unread only' })}
            </button>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={markAll}>
              <CheckCheck size={14} /> {t('notifications.markAllRead', { defaultValue: 'Mark all as read' })}
            </button>
          </>
        )}
      />
      {loading && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!loading && !items.length && <EmptyState icon={Bell} title={t('common.none')} />}
      <div className="card-soft">
        {items.map((n) => (
          <NotificationRow key={n.id} item={n} onRead={reload} label={t('notifications.markRead', { defaultValue: 'Mark read' })} />
        ))}
      </div>
    </>
  );
}

function NotificationRow({ item, onRead, label }) {
  const mark = async () => {
    if (item.is_read) return;
    await apiPost(`/school/notifications/${item.id}/read`, {});
    onRead();
  };
  return (
    <div className="d-flex justify-content-between align-items-start gap-3 p-3 border-bottom">
      <div>
        <div className="d-flex align-items-center gap-2">
          <span className="fw-semibold small">{item.title}</span>
          {!item.is_read && <Badge tone="brand">new</Badge>}
        </div>
        {item.body && <div className="small text-muted mt-1">{item.body}</div>}
        <div className="small text-muted mt-1">{item.category} · {dateTime(item.created_at)}</div>
      </div>
      {!item.is_read && <button className="btn btn-sm btn-outline-secondary" onClick={mark}>{label}</button>}
    </div>
  );
}
