// Reception home: today's visitors with a quick check-in form and upcoming appointments.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { DoorOpen, CalendarClock, UserPlus, Clock } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, dateTime, dateOnly } from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const EMPTY_FORM = { full_name: '', phone: '', purpose: '', visiting_whom: '' };

export default function ReceptionDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const visitors = useApi('/visitors', { pageSize: 10 });
  const appointments = useApi('/appointments', { pageSize: 5, status: 'scheduled' });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const today = new Date().toISOString().slice(0, 10);
  const todaysVisitors = (visitors.data || []).filter((v) => String(v.check_in_at || v.created_at || '').slice(0, 10) === today);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name) { toast.error(t('common.required')); return; }
    setBusy(true);
    try {
      await apiPost('/visitors', form);
      toast.success(t('common.saved'));
      setOpen(false);
      setForm(EMPTY_FORM);
      visitors.reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title={t('dashboards.receptionHome', { defaultValue: 'Front desk' })}
        subtitle={data?.school?.school_name}
        actions={<button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setOpen(true)}><UserPlus size={14} /> {t('dashboards.checkInVisitor', { defaultValue: 'Check in visitor' })}</button>}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.visitorsToday', { defaultValue: 'Visitors today' })} value={todaysVisitors.length} icon={DoorOpen} /></div>
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.upcomingAppointments', { defaultValue: 'Scheduled appointments' })} value={(appointments.data || []).length} icon={CalendarClock} /></div>
        <div className="col-12 col-lg-4"><StatCard label={t('dashboards.checkedIn', { defaultValue: 'Checked in today' })} value={todaysVisitors.filter((v) => v.check_in_at).length} icon={Clock} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><DoorOpen size={15} className="me-1" /> {t('dashboards.todaysVisitors', { defaultValue: "Today's visitors" })}</div>
              <Link to="/m/visitors" className="small">{t('common.viewAll')}</Link>
            </div>
            {visitors.loading && !visitors.data && <Spinner />}
            {todaysVisitors.length === 0 && !visitors.loading && <EmptyState title={t('dashboards.noVisitorsToday', { defaultValue: 'No visitors checked in today' })} />}
            {todaysVisitors.map((v) => (
              <div key={v.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <div className="text-truncate me-2">
                  <span className="fw-semibold">{v.full_name}</span>
                  <span className="text-muted"> · {v.purpose || '—'}{v.visiting_whom ? ` · ${v.visiting_whom}` : ''}</span>
                </div>
                <span className="text-muted text-nowrap">{v.check_out_at ? t('dashboards.checkedOut', { defaultValue: 'Out' }) : t('dashboards.onSite', { defaultValue: 'On site' })} · {dateTime(v.check_in_at || v.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.openAppointments', { defaultValue: 'Open appointments' })}</div>
              <Link to="/m/appointments" className="small">{t('common.viewAll')}</Link>
            </div>
            {appointments.loading && !appointments.data && <Spinner />}
            {(appointments.data || []).length === 0 && !appointments.loading && <EmptyState title={t('common.none')} />}
            {(appointments.data || []).map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <div className="text-truncate me-2"><span className="fw-semibold">{a.visitor_name || '—'}</span> <span className="text-muted">· {a.department || '—'}</span></div>
                <span className="d-flex align-items-center gap-2 text-nowrap"><StatusBadge value={a.status} /><span className="text-muted">{dateOnly(a.appointment_date)}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={open}
        size="sm"
        title={t('dashboards.checkInVisitor', { defaultValue: 'Check in visitor' })}
        onClose={() => setOpen(false)}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>{t('common.save')}</button>
          </>
        )}
      >
        <form onSubmit={submit} className="row g-2">
          <Field label={`${t('common.name')} *`} value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
          <Field label={t('common.phone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label={t('dashboards.purpose', { defaultValue: 'Purpose' })} value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} />
          <Field label={t('dashboards.visitingWhom', { defaultValue: 'Visiting' })} value={form.visiting_whom} onChange={(v) => setForm({ ...form, visiting_whom: v })} />
        </form>
      </Modal>
    </>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div className="col-12">
      <label className="form-label small mb-1">{label}</label>
      <input className="form-control form-control-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
