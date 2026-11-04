import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ArrowLeft, ArrowRight, Building2, CheckCircle, CreditCard, Mail, ShieldCheck, UserCog } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import Field from '../../components/ui/Field.jsx';
import { Spinner, money } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';
const SCHOOL_TYPES = ['primary', 'secondary', 'primary_secondary', 'integrated'];
const SCHOOL_TYPE_LABELS = {
  primary: 'Primary school',
  secondary: 'Secondary school',
  primary_secondary: 'Primary and secondary school',
  integrated: 'Integrated school',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEPS = ['school', 'plan', 'admin', 'consent'];

/** Trim-safe writer for an optional text field: sends undefined instead of an empty string. */
const optional = (value) => {
  const v = String(value ?? '').trim();
  return v === '' ? undefined : v;
};

/** School self-registration wizard: details → plan → administrator → consent. */
export default function RegisterSchool() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const plans = useApi('/public/plans');
  const planRows = useMemo(() => (plans.data || []).filter(Boolean), [plans.data]);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);
  const [values, setValues] = useState({
    school_name: '', school_type: '', registration_number: '', country: 'Somalia', region: '', city: '',
    address: '', school_email: '', school_phone: '', plan_id: params.get('plan') || '', message: '',
    admin_full_name: '', admin_email: '', admin_phone: '', accept_terms: false,
  });

  const set = (key) => (v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const selectedPlan = planRows.find((p) => p.id === values.plan_id) || null;

  /* ── Client validation, mirroring the published registration schema ── */
  const validateStep = (index) => {
    const e = {};
    const v = values;
    if (index === 0) {
      const name = v.school_name.trim();
      if (name.length < 2 || name.length > 120) e.school_name = t('register.errName', { defaultValue: 'School name must be 2–120 characters' });
      if (!SCHOOL_TYPES.includes(v.school_type)) e.school_type = t('common.required');
      if (v.registration_number.trim().length > 64) e.registration_number = t('register.errRegNo', { defaultValue: 'Maximum 64 characters' });
      const country = v.country.trim();
      if (country.length < 2 || country.length > 64) e.country = t('register.errCountry', { defaultValue: 'Country must be 2–64 characters' });
      if (v.region.trim().length > 64) e.region = t('register.errRegion', { defaultValue: 'Maximum 64 characters' });
      if (v.city.trim().length > 64) e.city = t('register.errCity', { defaultValue: 'Maximum 64 characters' });
      if (v.address.trim().length > 255) e.address = t('register.errAddress', { defaultValue: 'Maximum 255 characters' });
      if (!EMAIL.test(v.school_email.trim())) e.school_email = t('register.errEmail', { defaultValue: 'Enter a valid email address' });
      if (v.school_phone.trim().length > 32) e.school_phone = t('register.errPhone', { defaultValue: 'Maximum 32 characters' });
    }
    if (index === 1) {
      if (!UUID.test(String(v.plan_id || ''))) e.plan_id = t('register.errPlan', { defaultValue: 'Choose one of the published plans' });
      if (v.message.trim().length > 1000) e.message = t('register.errMessage', { defaultValue: 'Maximum 1000 characters' });
    }
    if (index === 2) {
      const full = v.admin_full_name.trim();
      if (full.length < 2 || full.length > 120) e.admin_full_name = t('register.errAdminName', { defaultValue: 'Full name must be 2–120 characters' });
      if (!EMAIL.test(v.admin_email.trim())) e.admin_email = t('register.errEmail', { defaultValue: 'Enter a valid email address' });
      if (v.admin_phone.trim().length > 32) e.admin_phone = t('register.errPhone', { defaultValue: 'Maximum 32 characters' });
    }
    if (index === 3 && v.accept_terms !== true) {
      e.accept_terms = t('register.errTerms', { defaultValue: 'You must accept the terms of service' });
    }
    return e;
  };

  const goNext = () => {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => { setErrors({}); setStep((s) => Math.max(s - 1, 0)); };

  /* ── Payload ── */
  const buildPayload = () => ({
    school_name: values.school_name.trim(),
    school_type: values.school_type,
    ...(optional(values.registration_number) ? { registration_number: optional(values.registration_number) } : {}),
    country: values.country.trim(),
    ...(optional(values.region) ? { region: optional(values.region) } : {}),
    ...(optional(values.city) ? { city: optional(values.city) } : {}),
    ...(optional(values.address) ? { address: optional(values.address) } : {}),
    school_email: values.school_email.trim(),
    ...(optional(values.school_phone) ? { school_phone: optional(values.school_phone) } : {}),
    admin_full_name: values.admin_full_name.trim(),
    admin_email: values.admin_email.trim(),
    ...(optional(values.admin_phone) ? { admin_phone: optional(values.admin_phone) } : {}),
    plan_id: values.plan_id,
    ...(optional(values.message) ? { message: optional(values.message) } : {}),
    accept_terms: true,
  });

  const submit = async () => {
    const merged = STEPS.reduce((acc, _, i) => ({ ...acc, ...validateStep(i) }), {});
    setErrors(merged);
    if (Object.keys(merged).length) {
      const firstBad = STEPS.findIndex((_, i) => Object.keys(validateStep(i)).length);
      if (firstBad >= 0) setStep(firstBad);
      toast.error(t('register.fixErrors', { defaultValue: 'Please correct the highlighted fields' }));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiPost('/public/school-registrations', buildPayload());
      setDone(res?.data || {});
      toast.success(t('register.submitted', { defaultValue: 'Registration received' }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      const mapped = normaliseDetails(error.details);
      if (error.status === 409 && !mapped.school_email) {
        mapped.school_email = error.message || t('register.conflictField', { defaultValue: 'This school email is already registered.' });
      }
      setErrors(mapped);
      const badStep = Object.keys(mapped).some((k) => ['school_name', 'school_type', 'registration_number', 'country', 'region', 'city', 'address', 'school_email', 'school_phone'].includes(k)) ? 0
        : mapped.plan_id ? 1
          : ['admin_full_name', 'admin_email', 'admin_phone'].some((k) => mapped[k]) ? 2
            : mapped.accept_terms ? 3 : step;
      if (Object.keys(mapped).length) setStep(badStep);
      if (error.status === 409) {
        setFormError({ tone: 'danger', message: error.message || t('register.conflict', { defaultValue: 'A registration already exists for this school email.' }) });
        toast.error(t('register.conflict', { defaultValue: 'This school email is already registered' }));
      } else if (error.status === 422) {
        setFormError({ tone: 'warning', message: t('register.invalid', { defaultValue: 'The server rejected some fields — see the messages below.' }) });
      } else {
        setFormError({ tone: 'danger', message: error.message });
        toast.error(error.message);
      }
    } finally { setBusy(false); }
  };

  /* ── Success screen ── */
  if (done) {
    return (
      <section className="public-section">
        <div className="container" style={{ maxWidth: '46rem' }}>
          <div className="card-soft p-4 p-lg-5 text-center">
            <span className="stat-icon mx-auto mb-3" style={{ width: 56, height: 56 }}><Mail size={26} /></span>
            <h1 className="h4 fw-bold mb-2">{t('register.successTitle', { defaultValue: 'Registration submitted' })}</h1>
            <p className="text-muted small mb-4">{t('register.successBody', { defaultValue: 'The school is stored as a pending application. No tenant is created until the platform team approves it.' })}</p>

            <div className="row g-2 text-start small mb-4">
              <Summary label={t('register.refId', { defaultValue: 'Reference' })} value={done.id || '—'} />
              <Summary label={t('common.status')} value={String(done.status || 'submitted').replace(/_/g, ' ')} />
              <Summary label={t('register.school')} value={values.school_name} />
              <Summary label={t('register.plan')} value={selectedPlan?.name || '—'} />
              <Summary label={t('register.adminEmail')} value={values.admin_email} />
            </div>

            <div className="text-start">
              <div className="fw-semibold mb-2">{t('register.nextTitle', { defaultValue: 'What happens next' })}</div>
              <ol className="small text-muted ps-3 mb-4">
                <li className="mb-2">{t('register.next1', { defaultValue: 'A confirmation email has been sent to the administrator address you provided.' })}</li>
                <li className="mb-2">{t('register.next2', { defaultValue: 'The platform team reviews the application: the school details, the requested plan and the branch or student counts.' })}</li>
                <li className="mb-2">{t('register.next3', { defaultValue: 'On approval the school tenant and subscription are provisioned, and an activation email with an invitation link is sent to the administrator.' })}</li>
                <li className="mb-2">{t('register.next4', { defaultValue: 'Opening that invitation link lets the administrator set a password and sign in to the school dashboard, where staff, students and parents are invited next.' })}</li>
                <li>{t('register.next5', { defaultValue: 'If anything is missing the team replies by email; you can also contact us quoting the reference above.' })}</li>
              </ol>
            </div>

            <div className="d-flex flex-wrap gap-2 justify-content-center">
              <Link to="/login" className="btn btn-sm btn-outline-primary">{t('common.login')}</Link>
              <Link to="/verify" className="btn btn-sm btn-outline-primary">{t('verify.title', { defaultValue: 'Verify a document' })}</Link>
              <Link to="/contact" className="btn btn-sm btn-outline-secondary">{t('contact.title', { defaultValue: 'Contact us' })}</Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── Wizard ── */
  return (
    <section className="public-section">
      <div className="container" style={{ maxWidth: '54rem' }}>
        <div className="text-center mb-4">
          <h1 className="h3 fw-bold mb-2" style={{ color: '#130c2d' }}>{t('register.title', { defaultValue: 'Register your school' })}</h1>
          <p className="text-muted small mb-0">{t('register.sub', { defaultValue: 'Four short steps. The school is reviewed by our team before it is activated.' })}</p>
        </div>

        {/* Progress */}
        <div className="d-flex flex-wrap justify-content-center gap-2 mb-4">
          {STEPS.map((key, i) => (
            <button key={key} type="button" onClick={() => { setErrors({}); setStep(i); }}
              className={`btn btn-sm d-flex align-items-center gap-2 ${i === step ? 'btn-primary' : i < step ? 'btn-outline-success' : 'btn-outline-secondary'}`}>
              <span>{i + 1}</span>
              {t(`register.steps.${key}`, { defaultValue: key[0].toUpperCase() + key.slice(1) })}
            </button>
          ))}
        </div>

        {formError ? (
          <div className={`alert alert-${formError.tone} d-flex align-items-center gap-2`}>
            <ShieldCheck size={17} />
            <div className="small">{formError.message}</div>
          </div>
        ) : null}

        <div className="card-soft p-4">
          {step === 0 ? (
            <>
              <StepTitle icon={Building2} title={t('register.steps.school', { defaultValue: 'School details' })} />
              <div className="row">
                <Field field={{ name: 'school_name', label: t('register.schoolName', { defaultValue: 'School name' }), required: true, col: 8 }} value={values.school_name} error={errors.school_name} onChange={set('school_name')} />
                <Field field={{
                  name: 'school_type', type: 'select', label: t('register.schoolType', { defaultValue: 'School type' }), required: true, col: 4,
                  placeholder: t('register.selectType', { defaultValue: 'Select school type' }),
                  options: SCHOOL_TYPES.map((k) => ({
                    value: k,
                    label: t(`register.types.${k}`, { defaultValue: SCHOOL_TYPE_LABELS[k] }),
                  })),
                }} value={values.school_type} error={errors.school_type} onChange={set('school_type')} />
                <Field field={{ name: 'registration_number', label: t('register.registrationNumber', { defaultValue: 'Official registration number' }), col: 4, placeholder: t('register.optional', { defaultValue: 'Optional' }) }} value={values.registration_number} error={errors.registration_number} onChange={set('registration_number')} />
                <Field field={{ name: 'country', label: t('register.country', { defaultValue: 'Country' }), required: true, col: 4 }} value={values.country} error={errors.country} onChange={set('country')} />
                <Field field={{ name: 'region', label: t('register.region', { defaultValue: 'Region / state' }), col: 4, placeholder: t('register.optional', { defaultValue: 'Optional' }) }} value={values.region} error={errors.region} onChange={set('region')} />
                <Field field={{ name: 'city', label: t('register.city', { defaultValue: 'City' }), col: 4 }} value={values.city} error={errors.city} onChange={set('city')} />
                <Field field={{ name: 'school_email', label: t('register.schoolEmail', { defaultValue: 'School email' }), type: 'email', required: true, col: 4, help: t('register.schoolEmailHelp', { defaultValue: 'Used as the tenant identifier — one registration per school email.' }) }} value={values.school_email} error={errors.school_email} onChange={set('school_email')} />
                <Field field={{ name: 'school_phone', label: t('register.schoolPhone', { defaultValue: 'School phone' }), type: 'tel', col: 4 }} value={values.school_phone} error={errors.school_phone} onChange={set('school_phone')} />
                <Field field={{ name: 'address', label: t('register.address', { defaultValue: 'Address' }), col: 12, placeholder: t('register.optional', { defaultValue: 'Optional' }) }} value={values.address} error={errors.address} onChange={set('address')} />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <StepTitle icon={CreditCard} title={t('register.steps.plan', { defaultValue: 'Choose a plan' })} />
              {plans.loading && !plans.data ? <Spinner label={t('common.loading')} /> : null}
              {plans.error ? (
                <div className="alert alert-warning small mb-0">
                  {t('register.plansUnavailable', { defaultValue: 'Plans could not be loaded. Reload the page, or contact us and we will register the school for you.' })}
                </div>
              ) : null}
              {!plans.loading && !plans.error && planRows.length === 0 ? (
                <div className="alert alert-secondary small mb-0">
                  {t('register.noPlans', { defaultValue: 'No plans are published yet, so registration cannot be completed right now. Contact us and our team will register the school for you.' })}
                </div>
              ) : null}

              <div className="row g-3">
                {planRows.map((plan) => {
                  const active = plan.id === values.plan_id;
                  return (
                    <div className="col-12 col-md-6" key={plan.id}>
                      <button type="button" onClick={() => set('plan_id')(plan.id)}
                        className={`plan-card w-100 text-start p-3 h-100 ${active ? 'featured' : ''}`}
                        style={{ border: active ? `2px solid ${BRAND}` : undefined, background: active ? '#f7f4ff' : '#fff' }}>
                        <div className="d-flex justify-content-between align-items-center">
                          <span className="fw-bold">{plan.name}</span>
                          {active ? <CheckCircle size={17} className="text-success" /> : null}
                        </div>
                        <div className="small text-muted mb-2">{plan.description}</div>
                        <div className="small fw-semibold" style={{ color: BRAND }}>
                          {Number(plan.monthly_price) > 0 ? `${money(plan.monthly_price, plan.currency)} ${t('pricing.perMonth', { defaultValue: 'per month' })}` : t('pricing.custom', { defaultValue: 'Custom pricing' })}
                        </div>
                        <div className="small text-muted mt-2">
                          {t('home.upTo', { defaultValue: 'Up to' })} {plan.max_students ?? '—'} · {plan.max_staff ?? '—'} {t('pricing.maxStaff', { defaultValue: 'staff' })} · {plan.trial_days ?? 0} {t('pricing.trialDays', { defaultValue: 'trial days' })}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
              {errors.plan_id ? <div className="form-text text-danger small mt-2">{errors.plan_id}</div> : null}

              <div className="mt-4">
                <Field field={{
                  name: 'message', label: t('register.message', { defaultValue: 'Anything we should know?' }), type: 'textarea', rows: 4, col: 12,
                  help: t('register.messageHelp', { defaultValue: 'Student and staff numbers, branch plans, modules you need most, your deadline.' }),
                }} value={values.message} error={errors.message} onChange={set('message')} />
              </div>
              {values.plan_id && !UUID.test(values.plan_id) ? (
                <div className="small text-danger mt-1">{t('register.planRequired', { defaultValue: 'Select a plan above to continue.' })}</div>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <StepTitle icon={UserCog} title={t('register.steps.admin', { defaultValue: 'Administrator account' })} />
              <p className="small text-muted mb-3">
                {t('register.adminHelp', { defaultValue: 'This person receives the activation invitation and becomes the school’s first administrator. Invitations are always one-time links — no password is sent by email.' })}
              </p>
              <div className="row">
                <Field field={{ name: 'admin_full_name', label: t('register.adminName', { defaultValue: 'Full name' }), required: true, col: 6 }} value={values.admin_full_name} error={errors.admin_full_name} onChange={set('admin_full_name')} />
                <Field field={{ name: 'admin_email', label: t('register.adminEmailField', { defaultValue: 'Administrator email' }), type: 'email', required: true, col: 6 }} value={values.admin_email} error={errors.admin_email} onChange={set('admin_email')} />
                <Field field={{ name: 'admin_phone', label: t('register.adminPhone', { defaultValue: 'Administrator phone' }), type: 'tel', col: 6 }} value={values.admin_phone} error={errors.admin_phone} onChange={set('admin_phone')} />
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <StepTitle icon={ShieldCheck} title={t('register.steps.consent', { defaultValue: 'Review & consent' })} />
              <div className="row g-2 small mb-4">
                <Summary label={t('register.school')} value={values.school_name} />
                <Summary label={t('register.schoolType', { defaultValue: 'School type' })} value={t(`register.types.${values.school_type}`, { defaultValue: SCHOOL_TYPE_LABELS[values.school_type] || values.school_type })} />
                <Summary label={t('register.country')} value={values.country} />
                <Summary label={t('register.city')} value={values.city || '—'} />
                <Summary label={t('register.schoolEmail', { defaultValue: 'School email' })} value={values.school_email} />
                <Summary label={t('register.plan')} value={selectedPlan ? selectedPlan.name : '—'} />
                <Summary label={t('register.adminName', { defaultValue: 'Administrator' })} value={`${values.admin_full_name} · ${values.admin_email}`} />
              </div>

              <div className={`form-check ${errors.accept_terms ? 'is-invalid' : ''}`}>
                <input id="accept_terms" className="form-check-input" type="checkbox" checked={values.accept_terms}
                  onChange={(e) => set('accept_terms')(e.target.checked)} />
                <label className="form-check-label small" htmlFor="accept_terms">
                  {t('register.acceptTerms', { defaultValue: 'I accept the' })}{' '}
                  <Link to="/terms" target="_blank" rel="noreferrer" className="fw-semibold">{t('public.terms', { defaultValue: 'Terms of service' })}</Link>
                  {' '}{t('register.and', { defaultValue: 'and' })}{' '}
                  <Link to="/privacy" target="_blank" rel="noreferrer" className="fw-semibold">{t('public.privacy', { defaultValue: 'Privacy policy' })}</Link>
                  {t('register.acceptSuffix', { defaultValue: ', and I confirm I am authorised to register this school.' })}
                </label>
                {errors.accept_terms ? <div className="form-text text-danger small">{errors.accept_terms}</div> : null}
              </div>

              <div className="small text-muted mt-3">
                {t('register.consentNote', { defaultValue: 'Submitting creates a pending application only. The tenant, subscription and administrator account are provisioned after review.' })}
              </div>
            </>
          ) : null}

          <div className="d-flex justify-content-between align-items-center mt-4">
            <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={goBack} disabled={step === 0}>
              <ArrowLeft size={14} /> {t('common.back')}
            </button>
            <div className="small text-muted">{step + 1} / {STEPS.length}</div>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={goNext}>
                {t('common.next')} <ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={submit} disabled={busy}>
                {busy ? <Spinner label={t('common.loading')} /> : <CheckCircle size={15} />}
                {t('register.submit', { defaultValue: 'Submit registration' })}
              </button>
            )}
          </div>
        </div>

        <div className="card-soft p-3 mt-3 small text-muted">
          {t('register.alreadyMember', { defaultValue: 'Already registered your school?' })}{' '}
          <Link to="/login">{t('common.login')}</Link> · <Link to="/faq">{t('public.faq', { defaultValue: 'FAQ' })}</Link> ·{' '}
          <Link to="/pricing">{t('public.pricing', { defaultValue: 'Pricing' })}</Link>
        </div>
      </div>
    </section>
  );
}

function StepTitle({ icon: Icon, title }) {
  return (
    <div className="d-flex align-items-center gap-2 mb-3">
      <span className="stat-icon"><Icon size={18} /></span>
      <div className="fw-semibold">{title}</div>
    </div>
  );
}

function Summary({ label, value }) {
  return (
    <div className="col-12 col-md-6">
      <div className="text-muted">{label}</div>
      <div className="fw-semibold text-break">{value || '—'}</div>
    </div>
  );
}

/** The 422 body may arrive as a { field: message } map or as [{ field, message }] — accept both. */
function normaliseDetails(details) {
  if (!details) return {};
  if (Array.isArray(details)) {
    return Object.fromEntries(details.filter((d) => d && d.field).map((d) => [d.field, d.message || 'Invalid']));
  }
  if (typeof details === 'object') {
    return Object.fromEntries(Object.entries(details).map(([k, v]) => [k, typeof v === 'string' ? v : String(v?.message || v)]));
  }
  return {};
}
