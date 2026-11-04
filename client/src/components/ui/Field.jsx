import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Eye, EyeOff, ImagePlus, Loader2, Upload } from 'lucide-react';
import { apiUpload } from '../../api/client.js';

/**
 * Single form control driven by a field definition. Relation options are resolved
 * by the caller (EntityPage) and passed through `options`.
 * field = { name, label, type, required, help, placeholder, col = 6, options }
 */
export default function Field({ field, value, onChange, options, error, disabled }) {
  const { t } = useTranslation();
  const type = field.type || 'text';
  const id = `f-${field.name}`;
  const [revealed, setRevealed] = useState(false);
  const set = (v) => onChange(v);
  const cls = `form-control${error ? ' is-invalid' : ''}`;
  const choices = options || field.options || [];

  let control;
  if (type === 'textarea') {
    control = (
      <textarea id={id} className={cls} rows={field.rows || 4} value={value ?? ''} disabled={disabled}
        onChange={(e) => set(e.target.value)} placeholder={field.placeholder} />
    );
  } else if (type === 'select' || type === 'relation') {
    control = (
      <select id={id} className={`form-select${error ? ' is-invalid' : ''}`} value={value ?? ''} disabled={disabled}
        onChange={(e) => set(e.target.value)}>
        <option value="">{field.placeholder || t('common.all')}</option>
        {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (type === 'checkbox') {
    control = (
      <div className="form-check mt-2">
        <input id={id} className="form-check-input" type="checkbox" checked={Boolean(value)} disabled={disabled}
          onChange={(e) => set(e.target.checked)} />
        <label className="form-check-label" htmlFor={id}>{field.checkLabel || field.label}</label>
      </div>
    );
  } else if (type === 'image') {
    control = <ImageField id={id} value={value} onChange={set} disabled={disabled} />;
  } else {
    const inputType = { datetime: 'datetime-local', number: 'number', money: 'number', password: 'password', email: 'email', tel: 'tel', date: 'date' }[type] || 'text';
    const input = (
      <input id={id} type={type === 'password' && revealed ? 'text' : inputType} className={cls}
        value={value ?? ''} disabled={disabled} placeholder={field.placeholder}
        autoComplete={field.autoComplete || (type === 'password' ? 'new-password' : undefined)}
        step={type === 'money' || type === 'number' ? field.step || 'any' : undefined}
        onChange={(e) => set(type === 'number' || type === 'money' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
    );
    control = type === 'password' ? (
      <div className="input-affix">
        {input}
        <button type="button" className="affix-btn" onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'} tabIndex={-1}>
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    ) : input;
  }

  return (
    <div className={`col-12 col-md-${field.col || 6} mb-3`}>
      {type !== 'checkbox' && (
        <label className="form-label" htmlFor={id}>
          {field.label}
          {field.required && <span className="text-danger ms-1">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <div className="field-error"><AlertCircle size={13} />{error}</div>
      ) : field.help ? (
        <div className="form-text mt-1">{field.help}</div>
      ) : null}
    </div>
  );
}

/** Photo control: uploads to school storage and stores the returned public URL. */
function ImageField({ id, value, onChange, disabled }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file) => {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('sections.photoType', { defaultValue: 'Choose a JPG, PNG or WebP image.' }));
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError(t('sections.photoTooLarge', { defaultValue: 'That image is larger than 3 MB — resize it and try again.' }));
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await apiUpload('/school/students/photo', body);
      onChange(data.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="photo-upload">
      <div className="photo-preview">
        {value ? <img src={value} alt="" /> : <ImagePlus size={22} />}
      </div>
      <div className="d-flex flex-column gap-1">
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy
              ? t('common.loading')
              : value
                ? t('sections.replacePhoto', { defaultValue: 'Replace photo' })
                : t('sections.uploadPhoto', { defaultValue: 'Upload photo' })}
          </button>
          {value && !busy && (
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={disabled}
              onClick={() => { onChange(''); setError(''); }}>
              {t('common.remove', { defaultValue: 'Remove' })}
            </button>
          )}
        </div>
        <input ref={inputRef} id={id} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => handleFile(e.target.files?.[0])} />
        <div className="form-text">
          {t('sections.photoHint', { defaultValue: 'JPG, PNG or WebP · up to 3 MB. Uploaded to school storage.' })}
        </div>
        {error && <div className="text-danger small">{error}</div>}
      </div>
    </div>
  );
}

/** Maps a field list to the payload the API expects (drops empties, coerces numbers/booleans). */
export function buildPayload(fields, values) {
  const payload = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (raw === undefined) continue;
    if (raw === '' || raw === null) {
      if (!f.required) payload[f.name] = null; // explicit clear
      continue;
    }
    payload[f.name] = f.type === 'checkbox' ? Boolean(raw) : raw;
  }
  return payload;
}
