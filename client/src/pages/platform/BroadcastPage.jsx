/**
 * Super-admin broadcast: one message to every school, to one school, to a named role inside a school,
 * or to the platform team. The server resolves the audience tenant by tenant, so each inbox row keeps
 * the school_id it belongs to and a school's own notification switches still apply to it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Loader2, Megaphone, Send, Users } from 'lucide-react';
import { apiGet, apiPost } from '../../api/client.js';
import { Badge, EmptyState, PageHeader, Spinner, StatCard } from '../../components/ui/Basics.jsx';
import { humanize } from '../../config/resources.jsx';

const TARGETS = ['all_schools', 'one_school', 'platform_team'];

/** Every notice ends up somewhere inside the app, so the link is a path the router already knows. */
const LINK_EXAMPLES = ['/notifications', '/school/settings', '/school-admin', '/platform-support'];

export default function BroadcastPage() {
  const { t } = useTranslation();
  const [target, setTarget] = useState('all_schools');
  const [schools, setSchools] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [schoolId, setSchoolId] = useState('');
  const [form, setForm] = useState({ title: '', body: '', link: '', email_copy: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiGet('/platform/schools', { pageSize: 200 })
      .then((res) => setSchools(res.data || []))
      .catch(() => setSchools([]));
  }, []);

  // The role list is read from the tenants being addressed: a school can add its own role, and a picker
  // built from a fixed list would offer names that cannot be matched.
  useEffect(() => {
    if (target === 'platform_team') { setRoles([]); return undefined; }
    if (target === 'one_school' && !schoolId) { setRoles([]); return undefined; }
    let alive = true;
    setRolesLoading(true);
    const path = target === 'one_school'
      ? `/platform/broadcast/roles?school_id=${encodeURIComponent(schoolId)}`
      : '/platform/broadcast/roles';
    apiGet(path)
      .then((res) => { if (alive) setRoles(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (alive) setRoles([]); })
      .finally(() => { if (alive) setRolesLoading(false); });
    return () => { alive = false; };
  }, [target, schoolId]);

  const selectedSchool = useMemo(() => schools.find((s) => s.id === schoolId) || null, [schools, schoolId]);
  const audienceLabel = () => {
    if (target === 'platform_team') return t('broadcast.platformTeam', { defaultValue: 'the platform team' });
    const who = target === 'one_school' ? selectedSchool?.school_name : t('broadcast.allSchools', { defaultValue: 'every active school' });
    const rolesText = form.roles?.length
      ? form.roles.map((r) => humanize(r)).join(', ')
      : t('broadcast.everyMember', { defaultValue: 'all active members' });
    return `${rolesText} · ${who}`;
  };

  const toggleRole = (name) => {
    setForm((prev) => {
      const list = prev.roles || [];
      return { ...prev, roles: list.includes(name) ? list.filter((r) => r !== name) : [...list, name] };
    });
  };

  const send = async () => {
    if (form.title.trim().length < 3) {
      toast.error(t('broadcast.titleNeeded', { defaultValue: 'Write a subject — it is the first line of the notice.' }));
      return;
    }
    if (target === 'one_school' && !schoolId) {
      toast.error(t('broadcast.schoolNeeded', { defaultValue: 'Pick the school that should receive this.' }));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await apiPost('/platform/broadcast', {
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        link: form.link.trim() || undefined,
        target,
        school_id: target === 'one_school' ? schoolId : undefined,
        roles: form.roles || [],
        email_copy: target !== 'platform_team' && form.email_copy,
      });
      setResult(res.data);
      const delivered = res.data?.delivered ?? 0;
      toast.success(t('broadcast.sent', {
        defaultValue: 'Sent to {{audiences}} audience(s), {{delivered}} inbox rows.',
        audiences: res.data?.audiences ?? 0, delivered,
      }));
      setForm((prev) => ({ ...prev, title: '', body: '' }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const push = result?.push || {};
  const detail = result?.detail || [];

  return (
    <>
      <PageHeader
        title={t('broadcast.title', { defaultValue: 'Broadcast a notice' })}
        subtitle={t('broadcast.subtitle', { defaultValue: 'One message to a school, to a role, to every school, or to the platform team. Each tenant keeps its own copy and its own opt-outs.' })}
      />

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card-soft p-3">
            <div className="small fw-semibold mb-2">{t('broadcast.audience', { defaultValue: 'Who receives it' })}</div>
            <div className="btn-group d-flex mb-3" role="group">
              {TARGETS.map((option) => (
                <button type="button" key={option}
                  className={`btn btn-sm ${target === option ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setTarget(option)} disabled={busy}>
                  {t(`broadcast.targets.${option}`, {
                    defaultValue: option === 'all_schools' ? 'All schools'
                      : option === 'one_school' ? 'One school' : 'Platform team',
                  })}
                </button>
              ))}
            </div>

            {target === 'one_school' && (
              <div className="mb-3">
                <label className="form-label small fw-semibold mb-0" htmlFor="broadcast-school">{t('modules.schools')}</label>
                <select id="broadcast-school" className="form-select form-select-sm" value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)} disabled={busy}>
                  <option value="">{t('sections.pickSchool', { defaultValue: 'Select a school…' })}</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                </select>
              </div>
            )}

            {target !== 'platform_team' && (
              <div className="mb-3">
                <div className="d-flex align-items-center gap-2 mb-1">
                  <Users size={14} className="text-muted" />
                  <span className="small fw-semibold">{t('broadcast.roles', { defaultValue: 'Roles' })}</span>
                  <span className="small text-muted">{t('broadcast.rolesHint', { defaultValue: 'Leave all unchecked to reach every active member.' })}</span>
                </div>
                {rolesLoading && <Spinner />}
                {!rolesLoading && !roles.length && (
                  <div className="small text-muted">{t('broadcast.noRoles', { defaultValue: 'No roles to offer yet — pick a school that has members.' })}</div>
                )}
                {!rolesLoading && roles.length > 0 && (
                  <div className="d-flex flex-wrap gap-2">
                    {roles.map((name) => {
                      const on = (form.roles || []).includes(name);
                      return (
                        <button type="button" key={name} onClick={() => toggleRole(name)} disabled={busy}
                          className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline-secondary'}`}>
                          {humanize(name)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mb-3">
              <label className="form-label small fw-semibold mb-0" htmlFor="broadcast-title">{t('broadcast.subject', { defaultValue: 'Subject' })}</label>
              <input id="broadcast-title" className="form-control form-control-sm" maxLength={200}
                value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder={t('broadcast.subjectExample', { defaultValue: 'Maintenance window tonight at 22:00' })} />
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold mb-0" htmlFor="broadcast-body">{t('broadcast.message', { defaultValue: 'Message' })}</label>
              <textarea id="broadcast-body" className="form-control form-control-sm" rows={4} maxLength={2000}
                value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} />
            </div>

            <div className="row g-2 align-items-end mb-3">
              <div className="col-12 col-md-7">
                <label className="form-label small fw-semibold mb-0" htmlFor="broadcast-link">{t('broadcast.link', { defaultValue: 'Open this page when clicked' })}</label>
                <input id="broadcast-link" className="form-control form-control-sm" list="broadcast-links"
                  value={form.link} onChange={(e) => setForm((p) => ({ ...p, link: e.target.value }))}
                  placeholder="/notifications" />
                <datalist id="broadcast-links">
                  {LINK_EXAMPLES.map((path) => <option key={path} value={path} />)}
                </datalist>
              </div>
              <div className="col-12 col-md-5">
                {target === 'platform_team' ? (
                  <div className="small text-muted pt-2">{t('broadcast.noEmailTeam', { defaultValue: 'Team notices stay in-app; no email copy is sent.' })}</div>
                ) : (
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" role="switch" id="broadcast-email"
                      checked={form.email_copy} disabled={busy}
                      onChange={(e) => setForm((p) => ({ ...p, email_copy: e.target.checked }))} />
                    <label className="form-check-label small" htmlFor="broadcast-email">
                      {t('broadcast.emailCopy', { defaultValue: 'Also send an email to those who opted in' })}
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
              <div className="small text-muted">
                <Megaphone size={13} className="me-1" />
                {t('broadcast.sendsTo', { defaultValue: 'Going to' })} {audienceLabel()}
              </div>
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
                onClick={send} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {busy ? t('common.saving') : t('broadcast.sendNow', { defaultValue: 'Send broadcast' })}
              </button>
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="row g-3">
            <div className="col-6">
              <StatCard label={t('broadcast.audiences', { defaultValue: 'Audiences' })}
                value={result ? result.audiences : '—'} icon={Users} />
            </div>
            <div className="col-6">
              <StatCard label={t('broadcast.inboxRows', { defaultValue: 'Inbox rows' })}
                value={result ? result.delivered : '—'} icon={Megaphone}
                hint={result ? undefined : t('broadcast.idleHint', { defaultValue: 'Send a notice to see the counts.' })} />
            </div>
            <div className="col-12">
              <div className="card-soft p-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <Send size={15} className="text-muted" />
                  <strong className="small">{t('broadcast.pushOutcome', { defaultValue: 'Push delivery' })}</strong>
                </div>
                {!result && <div className="small text-muted">{t('broadcast.noPushYet', { defaultValue: 'Nothing sent from this screen yet.' })}</div>}
                {result && (
                  <>
                    <div className="small mb-1">
                      {t('broadcast.pushCounts', {
                        defaultValue: '{{attempted}} attempted · {{sent}} delivered · {{failed}} failed',
                        attempted: push.attempted ?? 0, sent: push.sent ?? 0, failed: push.failed ?? 0,
                      })}
                    </div>
                    {push.skipped && <Badge tone="warn">{humanize(push.skipped)}</Badge>}
                    {(result.sender_errors || []).length > 0 && (
                      <div className="small text-danger mt-2">
                        {result.sender_errors.map((item) => (
                          <div key={`${item.school}-${item.error}`}>{item.school}: {item.error}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="col-12">
              <div className="card-soft p-3">
                <strong className="small d-block mb-2">{t('broadcast.perTenant', { defaultValue: 'Per school' })}</strong>
                {!detail.length && <EmptyState icon={Megaphone} title={t('common.none')} />}
                {detail.length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <tbody>
                        {detail.map((row) => (
                          <tr key={row.school_id || 'platform'}>
                            <td className="small text-truncate" style={{ maxWidth: 220 }}>
                              {row.school_name || t('broadcast.platformTeam', { defaultValue: 'Platform team' })}
                            </td>
                            <td className="small text-end tabular-nums" style={{ width: 70 }}>{row.recipients}</td>
                            <td className="small text-end" style={{ width: 110 }}>
                              {row.error ? <span className="text-danger">{t('broadcast.failed', { defaultValue: 'Not delivered' })}</span> : <Badge tone="ok">{t('broadcast.delivered', { defaultValue: 'Delivered' })}</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
