// Platform staff (platform_users): list, invitations or ready-to-sign-in accounts, enable/disable, and
// the helpdesk password actions. Credential reads are Super Admin only and every one is audited server-side.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Ban, CheckCircle2, Eye, RefreshCw, ShieldAlert, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPatch, apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import CredentialModal from '../../components/CredentialModal.jsx';
import { Badge, EmptyState, PageHeader, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** platform_roles.name values seeded for the platform side. */
const PLATFORM_ROLES = ['super_admin', 'platform_support'];

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export default function PlatformUsersPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState(null); // { user, status }
  const [credentialFor, setCredentialFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useApi('/platform/users');
  const isSuperAdmin = profile?.primaryRole === 'super_admin' || (profile?.roles || []).includes('super_admin');

  const toggle = useCallback(async () => {
    const { user, status } = pending;
    setBusy(true);
    try {
      await apiPatch(`/platform/users/${user.id}/status`, { status });
      toast.success(status === 'active'
        ? t('platform.userEnabled', { defaultValue: '{{name}} can sign in again.', name: user.full_name })
        : t('platform.userDisabled', { defaultValue: '{{name}} is deactivated.', name: user.full_name }));
      setPending(null);
      list.reload();
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
    } finally { setBusy(false); }
  }, [pending, list, t]);

  const columns = [
    {
      key: 'full_name',
      label: t('platform.staffName', { defaultValue: 'Name' }),
      render: (row) => (
        <div>
          <div className="fw-semibold">
            {row.full_name}
            {row.id === profile?.userId && <Badge tone="brand" className="ms-2">{t('platform.you', { defaultValue: 'you' })}</Badge>}
          </div>
          <div className="small text-muted">{row.email}</div>
          {row.phone && <div className="small text-muted">{row.phone}</div>}
        </div>
      ),
    },
    {
      key: 'roles',
      label: t('platform.role', { defaultValue: 'Role' }),
      render: (row) => (
        <div className="d-flex flex-wrap gap-1">
          {(row.roles || []).length === 0 && <span className="text-muted small">{t('platform.noRole', { defaultValue: 'No role assigned' })}</span>}
          {(row.roles || []).map((r) => <Badge key={r} tone={r === 'super_admin' ? 'brand' : 'info'}>{r.replace(/_/g, ' ')}</Badge>)}
        </div>
      ),
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    { key: 'created_at', label: t('platform.invitedOn', { defaultValue: 'Added' }), render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span> },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 210,
      className: 'text-end',
      render: (row) => {
        const self = row.id === profile?.userId;
        const next = row.status === 'active' ? 'inactive' : 'active';
        return (
          <div className="d-inline-flex align-items-center gap-1">
            {isSuperAdmin && (
              <button className="btn btn-sm btn-outline-primary"
                title={t('sections.showPassword', { defaultValue: 'Show password' })}
                aria-label={t('sections.showPassword', { defaultValue: 'Show password' })}
                onClick={() => setCredentialFor(row)}>
                <Eye size={13} />
              </button>
            )}
            {self ? (
              <span className="small text-muted">{t('platform.selfGuard', { defaultValue: 'You cannot suspend or reactivate your own account.' })}</span>
            ) : (
              <button className={`btn btn-sm ${next === 'active' ? 'btn-outline-success' : 'btn-outline-danger'} d-inline-flex align-items-center gap-1`}
                disabled={busy || !isSuperAdmin} onClick={() => setPending({ user: row, status: next })}>
                {next === 'active' ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                {next === 'active' ? t('platform.enable', { defaultValue: 'Enable' }) : t('platform.disable', { defaultValue: 'Disable' })}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const forbidden = list.error?.status === 403;

  return (
    <>
      <PageHeader
        title={t('platform.users', { defaultValue: 'Platform staff' })}
        subtitle={t('platform.usersSubtitle', { defaultValue: 'Super Admins and Platform Support agents who operate the console.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" disabled={!isSuperAdmin} onClick={() => setInviting(true)}>
              <UserPlus size={14} /> {t('platform.inviteStaff', { defaultValue: 'Invite staff' })}
            </button>
          </>
        )}
      />

      {!isSuperAdmin && !forbidden && (
        <div className="alert alert-warning small d-flex align-items-start gap-2">
          <ShieldAlert size={15} className="mt-1" />
          <div>{t('platform.usersReadOnlyHint', { defaultValue: 'You can see the staff roster, but inviting people and changing their status needs a Super Admin.' })}</div>
        </div>
      )}

      {forbidden ? (
        <div className="card-soft">
          <EmptyState icon={UsersIcon}
            title={t('platform.notAvailableTitle', { defaultValue: 'Not available for your account' })}
            hint={t('platform.notAvailableHint', { defaultValue: 'The platform console rejects this request with 403 — your session is not a platform staff account.' })} />
        </div>
      ) : (
        <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          empty={t('platform.noStaff', { defaultValue: 'No platform staff yet' })} />
      )}

      <InviteModal open={inviting} onClose={() => setInviting(false)} onInvited={() => { setInviting(false); list.reload(); }} />

      <ConfirmDialog open={Boolean(pending)} danger={pending?.status === 'inactive'}
        title={pending?.status === 'active' ? t('platform.enable', { defaultValue: 'Enable' }) : t('platform.disable', { defaultValue: 'Disable' })}
        message={pending?.status === 'active'
          ? t('platform.enableMessage', { defaultValue: 'Give {{name}} access to the platform console again?', name: pending?.user.full_name })
          : t('platform.disableMessage', { defaultValue: 'Deactivate {{name}}? Their console access is revoked on the next request.', name: pending?.user?.full_name })}
        busy={busy} onClose={() => setPending(null)} onConfirm={toggle} />

      <CredentialModal row={credentialFor} onClose={() => setCredentialFor(null)} canReset
        path={credentialFor ? `/platform/credentials/platform-users/${credentialFor.id}` : ''} />
    </>
  );
}

function InviteModal({ open, onClose, onInvited }) {
  const { t } = useTranslation();
  const blank = { full_name: '', email: '', role: 'platform_support', phone: '', password: '' };
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setValues(blank); setErrors({}); }
  }, [open]);

  const submit = useCallback(async () => {
    const missing = {};
    if (String(values.full_name || '').trim().length < 2) missing.full_name = t('platform.nameTooShort', { defaultValue: 'At least 2 characters' });
    if (!isEmail(values.email)) missing.email = t('platform.invalidEmail', { defaultValue: 'Enter a valid email address' });
    if (!PLATFORM_ROLES.includes(values.role)) missing.role = t('platform.pickRole', { defaultValue: 'Pick a platform role' });
    if (String(values.phone || '').length > 32) missing.phone = t('platform.phoneLength', { defaultValue: 'Max 32 characters' });
    const password = String(values.password || '');
    if (password && password.length < 8) missing.password = t('platform.passwordTooShort', { defaultValue: 'At least 8 characters' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      const body = { full_name: String(values.full_name).trim(), email: String(values.email).trim(), role: values.role };
      if (String(values.phone || '').trim()) body.phone = String(values.phone).trim();
      if (password) body.password = password;
      const { data } = await apiPost('/platform/users', body);
      toast.success(data?.readyToSignIn
        ? t('platform.staffReadyToSignIn', { defaultValue: '{{email}} can sign in now with the password you set.', email: body.email })
        : t('platform.invitationSent', { defaultValue: 'Activation email sent to {{email}}.', email: body.email }));
      onInvited();
    } catch (error) {
      if (error.status === 403) toast.error(t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }));
      else if (error.status === 409) toast.error(t('platform.emailTaken', { defaultValue: 'That email already belongs to a platform account.' }));
      else toast.error(error.message);
    } finally { setBusy(false); }
  }, [values, onInvited, t]);

  const labels = useMemo(() => ({
    full_name: t('platform.staffName', { defaultValue: 'Name' }),
    email: t('common.email'),
    role: t('platform.role', { defaultValue: 'Role' }),
    phone: t('common.phone'),
    password: t('platform.initialPassword', { defaultValue: 'Initial password (optional)' }),
  }), [t]);

  const fields = [
    { name: 'full_name', required: true, col: 12 },
    { name: 'email', type: 'email', required: true, col: 12 },
    { name: 'role', type: 'select', required: true, col: 12, options: PLATFORM_ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })) },
    { name: 'phone', type: 'tel', col: 12 },
    { name: 'password', type: 'password', col: 12 },
  ];

  const hasPassword = Boolean(String(values.password || '').trim());

  return (
    <Modal open={open} size="sm"
      title={hasPassword
        ? t('platform.createStaffAccount', { defaultValue: 'Create platform account' })
        : t('platform.inviteStaff', { defaultValue: 'Invite staff' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : (hasPassword
            ? t('platform.createAccount', { defaultValue: 'Create account' })
            : t('platform.sendInvite', { defaultValue: 'Send invitation' }))}</button>
        </>
      )}>
      <div className="alert alert-info small py-2">
        {t('platform.inviteHint', { defaultValue: 'Leave the password blank to mail an activation link (valid 7 days). Type a password instead and the account works immediately with no email — you can reveal that password again later from this page.' })}
      </div>
      <div className="row">
        {fields.map((f) => (
          <Field key={f.name} field={{ ...f, label: labels[f.name] }} value={values[f.name]} error={errors[f.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
        ))}
      </div>
    </Modal>
  );
}
