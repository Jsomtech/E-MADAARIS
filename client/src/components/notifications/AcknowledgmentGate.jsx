import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { apiGet, apiPost } from '../../api/client.js';
import { Modal } from '../ui/Modal.jsx';
import { Badge, dateTime } from '../ui/Basics.jsx';

/**
 * The message a school did not want scrolled past.
 *
 * An announcement sent with `ack_required` is put in front of its recipient, one at a time, until they
 * press Acknowledge. Nothing else settles it: opening the list marks a message read, and the phone
 * showing a notification marks nothing at all — being told is not the same as having read it, and the
 * record the school keeps has to say which happened.
 *
 * It is a gate, not a lock. If the server cannot be reached the app stays usable, because an outage on
 * the acknowledgment read must not lock a teacher out of their register; the question is simply asked
 * again on the next load.
 */
export default function AcknowledgmentGate() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet('/school/notifications/pending-acks');
      setQueue(Array.isArray(data) ? data : []);
    } catch { /* asked again next time; the app is not held hostage by it */ }
  }, []);

  useEffect(() => {
    load();
    // A notice that arrives while the person is already signed in is asked about immediately, and one
    // they acknowledged from the inbox list stops asking.
    window.addEventListener('emadaaris:push', load);
    window.addEventListener('emadaaris:acks-changed', load);
    return () => {
      window.removeEventListener('emadaaris:push', load);
      window.removeEventListener('emadaaris:acks-changed', load);
    };
  }, [load]);

  const current = queue[0];
  if (!current) return null;

  const acknowledge = async () => {
    setBusy(true);
    setFailure('');
    try {
      await apiPost(`/school/notifications/${current.id}/ack`, {});
      setQueue((prev) => prev.filter((row) => row.id !== current.id));
    } catch (error) {
      setFailure(error.message);
      // Whatever the answer was, the queue itself is re-read: an acknowledgment recorded from another
      // tab or device is not this person's problem to notice.
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="md"
      icon={ShieldAlert}
      title={t('notifications.ackTitle', { defaultValue: 'This needs your acknowledgment' })}
      subtitle={queue.length > 1
        ? t('notifications.ackQueued', { defaultValue: '{{count}} messages are waiting to be acknowledged.', count: queue.length })
        : dateTime(current.created_at)}
      // Closing is deliberately not offered: the only way out of this dialog is through the button.
      onClose={() => setFailure(t('notifications.ackRequired', { defaultValue: 'Please acknowledge the message to continue.' }))}
      footer={(
        <button type="button" className="btn btn-sm btn-primary ms-auto" onClick={acknowledge} disabled={busy}>
          {busy
            ? t('common.saving', { defaultValue: 'Saving…' })
            : t('notifications.acknowledge', { defaultValue: 'I have read and understood' })}
        </button>
      )}
    >
      <div className="d-flex align-items-center gap-2 mb-2">
        <Badge tone="brand">{t(`notifications.categories.${current.category}`, { defaultValue: current.category })}</Badge>
        {current.priority && current.priority !== 'normal' && (
          <Badge tone={current.priority === 'urgent' ? 'danger' : 'warn'}>
            {t(`notifications.priorities.${current.priority}`, { defaultValue: current.priority })}
          </Badge>
        )}
      </div>
      <div className="fw-semibold mb-1">{current.title}</div>
      {current.body && <div className="small" style={{ whiteSpace: 'pre-line' }}>{current.body}</div>}
      {failure && <div className="small text-danger mt-2">{failure}</div>}
      <div className="small text-muted mt-3">
        {t('notifications.ackHint', { defaultValue: 'Your acknowledgment is recorded against this message with the time you pressed the button.' })}
      </div>
    </Modal>
  );
}
