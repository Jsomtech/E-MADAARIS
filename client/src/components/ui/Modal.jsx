import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Accessible modal shell. Rendered in a portal with its own opaque surface,
 * a scrollable body and a sticky footer, so long forms never scroll the page.
 */
export function Modal({ open, title, subtitle, icon: Icon, onClose, children, footer, size = 'lg' }) {
  const { t } = useTranslation();
  const cardRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keyed on `open` alone: parents pass a fresh onClose every render, and re-running
  // this effect would re-focus the card on every keystroke and interrupt typing.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => cardRef.current?.focus(), 0);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;
  const sizeClass = ['sm', 'md', 'lg', 'xl'].includes(size) ? size : 'lg';

  return createPortal(
    <div
      className="em-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`em-modal em-modal-${sizeClass}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="em-modal-card" ref={cardRef} tabIndex={-1} style={{ outline: 'none' }}>
          <header className="em-modal-header">
            <div className="d-flex align-items-start gap-3">
              {Icon && <span className="em-modal-icon"><Icon size={19} /></span>}
              <div>
                <h2 className="em-modal-title">{title}</h2>
                {subtitle && <div className="em-modal-subtitle">{subtitle}</div>}
              </div>
            </div>
            <button type="button" className="btn-icon sm" onClick={onClose} aria-label={t('common.close')}>
              <X size={17} />
            </button>
          </header>
          <div className="em-modal-body">{children}</div>
          {footer && <footer className="em-modal-footer">{footer}</footer>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger = true, onConfirm, onClose, busy }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title || t('common.confirm')}
      size="sm"
      icon={danger ? AlertTriangle : undefined}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel || t('common.confirm')}
          </button>
        </>
      )}
    >
      <div className="text-muted" style={{ fontSize: '.9rem' }}>{message || t('common.deleteConfirm')}</div>
    </Modal>
  );
}
