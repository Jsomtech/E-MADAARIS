import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, Search, ShieldCheck, X, FileCheck2, Building2, User, CalendarDays, Hash } from 'lucide-react';
import { apiGet } from '../../api/client.js';
import { Spinner, Badge, EmptyState } from '../../components/ui/Basics.jsx';

const KINDS = {
  certificate: { path: '/public/certificate', icon: Award, label: 'Certificate reference' },
  'student-id': { path: '/public/student-id', icon: FileCheck2, label: 'Student ID verification code' },
};

/** Public document verification: /verify/:kind/:value, ?kind=&value=, or a plain form. */
export default function Verify() {
  const { t } = useTranslation();
  const routeParams = useParams();
  const [searchParams] = useSearchParams();

  const [kind, setKind] = useState('certificate');
  const [value, setValue] = useState('');
  const [state, setState] = useState({ status: 'idle', record: null, error: null });

  const requested = useMemo(() => ({
    kind: routeParams.kind || searchParams.get('kind'),
    value: routeParams.value || searchParams.get('value'),
  }), [routeParams.kind, routeParams.value, searchParams]);

  const run = async (k, v) => {
    const def = KINDS[k];
    if (!def || !v) return;
    setState({ status: 'loading', record: null, error: null });
    try {
      const body = await apiGet(`${def.path}/${encodeURIComponent(v.trim())}`);
      const payload = body?.data ?? null;
      // The API answers either { valid, record } or the record fields directly.
      const record = payload && (payload.record !== undefined || payload.valid !== undefined)
        ? (payload.valid ? (payload.record || null) : null)
        : (payload && Object.keys(payload).length ? payload : null);
      setState({ status: record ? 'valid' : 'not_found', record, error: null });
    } catch (error) {
      setState({ status: error.status === 404 ? 'not_found' : 'error', record: null, error });
    }
  };

  useEffect(() => {
    if (requested.kind && requested.value) {
      setKind(requested.kind);
      setValue(requested.value);
      run(requested.kind, requested.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested.kind, requested.value]);

  const submit = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) { setState({ status: 'idle', record: null, error: null }); return; }
    run(kind, v);
  };

  const def = KINDS[kind] || KINDS.certificate;
  const record = state.record;
  const schoolName = record?.schools?.school_name || record?.school_name;
  const holderName = record?.students?.full_name || record?.full_name;
  const reference = record?.reference_number || record?.verification_code || value;
  const type = record?.certificate_type;
  const issued = record?.issued_date ? String(record.issued_date).slice(0, 10) : null;
  const status = record?.status;

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2">{t('verify.title', { defaultValue: 'Verify a school document' })}</h1>
          <p className="mb-0" style={{ color: '#d9d2f7', maxWidth: '48rem' }}>
            {t('verify.sub', { defaultValue: 'Enter the reference number printed on a certificate, or the verification code on a student ID card. The check returns only the issuing school, the holder and the document status — nothing else.' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container" style={{ maxWidth: '44rem' }}>
          <div className="card-soft p-4">
            <form onSubmit={submit}>
              <label className="form-label small fw-semibold" htmlFor="v-kind">
                {t('verify.documentType', { defaultValue: 'Document type' })}
              </label>
              <select id="v-kind" className="form-select mb-3" value={kind} onChange={(e) => { setKind(e.target.value); setState({ status: 'idle', record: null, error: null }); }}>
                {Object.entries(KINDS).map(([key, d]) => (
                  <option key={key} value={key}>{t(`verify.kinds.${key}`, { defaultValue: d.label })}</option>
                ))}
              </select>

              <label className="form-label small fw-semibold" htmlFor="v-value">{t(`verify.kinds.${kind}`, { defaultValue: def.label })}</label>
              <div className="input-group input-group-lg mb-3">
                <span className="input-group-text bg-white"><Search size={17} /></span>
                <input id="v-value" className="form-control" value={value} onChange={(e) => setValue(e.target.value)}
                  placeholder={t('verify.placeholder', { defaultValue: 'e.g. CERT-2026-000123' })} autoComplete="off" />
              </div>

              <div className="d-flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary d-flex align-items-center gap-1">
                  <ShieldCheck size={16} /> {t('verify.check', { defaultValue: 'Verify document' })}
                </button>
                {state.status !== 'idle' ? (
                  <button type="button" className="btn btn-outline-secondary btn-sm"
                    onClick={() => { setValue(''); setState({ status: 'idle', record: null, error: null }); }}>
                    {t('verify.clear', { defaultValue: 'Clear result' })}
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {state.status === 'loading' ? <div className="text-center mt-4"><Spinner label={t('verify.checking', { defaultValue: 'Checking the reference…' })} /></div> : null}

          {state.status === 'valid' ? (
            <div className="card-soft p-4 mt-4 border border-success-subtle" style={{ borderTop: '4px solid #198754' }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="stat-icon" style={{ background: '#d1e7dd', color: '#0f5132' }}><ShieldCheck size={20} /></span>
                <div>
                  <div className="fw-bold">{t('verify.valid', { defaultValue: 'Document is genuine' })}</div>
                  <div className="small text-muted">{t('verify.validBody', { defaultValue: 'This reference exists in the issuing school’s records.' })}</div>
                </div>
                <span className="ms-auto"><Badge tone="ok">{String(status || 'issued').replace(/_/g, ' ')}</Badge></span>
              </div>
              <div className="row g-2 small">
                <Row icon={Hash} label={t('verify.reference', { defaultValue: 'Reference' })} value={reference} />
                {type ? <Row icon={FileCheck2} label={t('verify.type', { defaultValue: 'Document type' })} value={humanise(type)} /> : null}
                {record?.academic_year ? <Row icon={CalendarDays} label={t('verify.academicYear', { defaultValue: 'Academic year' })} value={record.academic_year} /> : null}
                <Row icon={User} label={t('verify.holder', { defaultValue: 'Issued to' })} value={holderName} />
                {record?.students?.admission_number ? <Row icon={Hash} label={t('verify.admission', { defaultValue: 'Admission number' })} value={record.students.admission_number} /> : null}
                <Row icon={Building2} label={t('verify.school', { defaultValue: 'Issuing school' })} value={schoolName} />
                {issued ? <Row icon={CalendarDays} label={t('verify.issued', { defaultValue: 'Issued on' })} value={issued} /> : null}
              </div>
              <p className="small text-muted mt-3 mb-0">
                {t('verify.validNote', { defaultValue: 'Keep this page or the printed document as proof. If the details look wrong, contact the school that issued it.' })}
              </p>
            </div>
          ) : null}

          {state.status === 'not_found' ? (
            <div className="card-soft p-4 mt-4" style={{ borderTop: '4px solid #dc3545' }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="stat-icon" style={{ background: '#f8d7da', color: '#842029' }}><X size={20} /></span>
                <div>
                  <div className="fw-bold">{t('verify.notFound', { defaultValue: 'No document found' })}</div>
                  <div className="small text-muted">{t('verify.notFoundBody', { defaultValue: 'That reference is not in the platform. Check the spelling, the case of the letters and that you chose the right document type.' })}</div>
                </div>
                <span className="ms-auto"><Badge tone="danger">{t('verify.unknown', { defaultValue: 'Unknown' })}</Badge></span>
              </div>
              <div className="small text-muted">
                {t('verify.notFoundHint', { defaultValue: 'A valid reference only proves the document was issued by the school; it does not replace the original paper certificate. Newly issued documents can take a short time to appear.' })}
              </div>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div className="alert alert-danger mt-4 d-flex align-items-start gap-2">
              <X size={17} className="mt-1" />
              <div className="small">
                <div className="fw-semibold">{t('verify.failed', { defaultValue: 'Verification could not run' })}</div>
                <div>{state.error?.message || t('common.error')}</div>
                <button className="btn btn-sm btn-outline-dark mt-2" onClick={() => run(kind, value)}>{t('common.retry')}</button>
              </div>
            </div>
          ) : null}

          {state.status === 'idle' ? (
            <div className="card-soft p-4 mt-4">
              <div className="fw-semibold mb-2">{t('verify.howTitle', { defaultValue: 'Where do I find the code?' })}</div>
              <div className="row g-3 small text-muted">
                <div className="col-12 col-sm-6">
                  <b>{t('verify.certificateSide', { defaultValue: 'Certificates' })}</b>
                  <div>{t('verify.certificateBody', { defaultValue: 'The reference number is printed under the school stamp, and follows the pattern the registrar uses for that certificate template.' })}</div>
                </div>
                <div className="col-12 col-sm-6">
                  <b>{t('verify.idSide', { defaultValue: 'Student ID cards' })}</b>
                  <div>{t('verify.idBody', { defaultValue: 'The verification code is printed on the back of the card next to the academic year; the admission number is on the front.' })}</div>
                </div>
              </div>
              <EmptyState title={t('verify.idleTitle', { defaultValue: 'Waiting for a reference' })} hint={t('verify.idleHint', { defaultValue: 'Enter a certificate reference or a student ID code above to start.' })} icon={Search} />
              <div className="d-flex gap-2 flex-wrap">
                <Link to="/features#security" className="btn btn-sm btn-outline-primary">{t('verify.privacyNote', { defaultValue: 'How public lookups are limited' })}</Link>
                <Link to="/contact" className="btn btn-sm btn-outline-secondary">{t('contact.title', { defaultValue: 'Contact us' })}</Link>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Row({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="col-12 d-flex align-items-center gap-2 border-bottom py-2">
      <Icon size={15} className="text-muted flex-shrink-0" />
      <span className="text-muted">{label}</span>
      <span className="fw-semibold ms-auto text-end text-break">{String(value).replace(/_/g, ' ')}</span>
    </div>
  );
}

const humanise = (v) => String(v).replace(/_/g, ' ');
