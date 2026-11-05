// Shared reveal dialog for a sign-in password the system issued. Used by the school users screen and by
// the platform helpdesk screens, where the same rule applies: an issued password is readable, a password
// the owner chose themselves is not, and the only way past that is to issue a new one.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '../api/client.js';
import { Modal } from './ui/Modal.jsx';
import { Spinner } from './ui/Basics.jsx';

export default function CredentialModal({ row, path, onClose, canReset = false, onChanged }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: false, password: '', source: '', issuedAt: null, error: '' });
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState({ loading: true, password: '', source: '', issuedAt: null, error: '' });
    setRevealed(true);
    setCopied(false);
    try {
      const { data } = await apiGet(path);
      setState({ loading: false, password: data.password, source: data.source, issuedAt: data.issued_at, error: '' });
    } catch (e) {
      setState({ loading: false, password: '', source: '', issuedAt: null, error: e.message });
    }
  }, [path]);

  useEffect(() => {
    if (!row) return;
    load();
  }, [row, load]);

  if (!row) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await apiPost(`${path}/reset`, { generate: true });
      setState({ loading: false, password: data.temporaryPassword, source: 'generated', issuedAt: new Date().toISOString(), error: '' });
      onChanged?.();
    } catch (e) {
      setState((prev) => ({ ...prev, error: e.message }));
    } finally { setBusy(false); }
  };

  return (
    <Modal open size="md" icon={KeyRound}
      title={`${t('sections.showPasswordTitle', { defaultValue: 'Password' })} · ${row.full_name}`}
      subtitle={row.email || row.full_name}
      onClose={onClose}
      footer={(
        <div className="d-flex gap-2">
          {canReset && (
            <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
              onClick={generate} disabled={busy}>
              <RefreshCw size={13} /> {busy ? '…' : t('sections.generateNewPassword', { defaultValue: 'Generate a new password' })}
            </button>
          )}
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>
        </div>
      )}>
      {state.loading && <Spinner label={t('common.loading')} />}

      {!state.loading && !state.password && state.error && (
        <>
          <div className="alert alert-warning small py-2 mb-2">{state.error}</div>
          <div className="small text-muted">
            {canReset
              ? t('sections.revealResetHint', { defaultValue: 'Generate a new password to hand them a fresh sign-in. It stays readable here until they set their own.' })
              : t('sections.revealUnavailableHint', { defaultValue: 'Open the account with “Edit” and use Reset password to issue a new temporary password. Once they set their own password it becomes private again.' })}
          </div>
        </>
      )}

      {!state.loading && state.password && (
        <>
          <div className="credential-card">
            <div className="credential-row">
              <span className="small text-muted">{t('sections.person', { defaultValue: 'Person' })}</span>
              <span className="fw-semibold small">{row.full_name}</span>
            </div>
            <div className="credential-row">
              <span className="small text-muted">{t('sections.password', { defaultValue: 'Password' })}</span>
              <div className="d-inline-flex align-items-center gap-1">
                <span className="credential-value">{revealed ? state.password : '•'.repeat(Math.min(14, state.password.length))}</span>
                <button type="button" className="btn btn-sm btn-outline-secondary"
                  title={revealed ? t('sections.hidePassword', { defaultValue: 'Hide password' }) : t('sections.showPassword', { defaultValue: 'Show password' })}
                  aria-label={revealed ? t('sections.hidePassword', { defaultValue: 'Hide password' }) : t('sections.showPassword', { defaultValue: 'Show password' })}
                  onClick={() => setRevealed((r) => !r)}>
                  {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={copy}>
                  <Copy size={13} /> {copied ? t('sections.copied', { defaultValue: 'Copied' }) : t('sections.copyPassword', { defaultValue: 'Copy' })}
                </button>
              </div>
            </div>
          </div>
          <div className="small text-muted mt-2">
            {state.source === 'student-id'
              ? t('sections.studentIdPasswordNote', { defaultValue: 'This is the student’s first password (their student ID). It stops being readable as soon as the student sets a new password.' })
              : state.source === 'generated'
                ? t('sections.generatedPasswordNote', { defaultValue: 'A new password was just issued. The account holder is asked to change it at their next sign-in.' })
                : t('sections.issuedPasswordNote', { defaultValue: 'This password was issued by the system or an administrator. It remains visible here until the person changes it from Account & security.' })}
          </div>
        </>
      )}
    </Modal>
  );
}
