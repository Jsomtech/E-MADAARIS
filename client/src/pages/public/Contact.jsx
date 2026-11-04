import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Mail, MapPin, Phone, Headphones, Send, Building2, MessageCircle, ExternalLink } from 'lucide-react';

const BRAND = '#6027ff';

// Placeholder details — replace with the school-facing contacts once they are configured
// (VITE_SUPPORT_EMAIL / VITE_SUPPORT_PHONE / VITE_OFFICE_ADDRESS in client/.env).
const DETAILS = {
  email: import.meta.env.VITE_SUPPORT_EMAIL || 'support@example-jsom.tech',
  phone: import.meta.env.VITE_SUPPORT_PHONE || '+252 00 000 0000',
  address: import.meta.env.VITE_OFFICE_ADDRESS || 'Office address — to be confirmed',
  hours: import.meta.env.VITE_SUPPORT_HOURS || 'Saturday–Thursday, 08:00–17:00 (EAT)',
};

const TOPICS = [
  { key: 'registration', label: 'New school registration' },
  { key: 'plans', label: 'Plans, pricing & billing' },
  { key: 'invitations', label: 'Invitations & access problems' },
  { key: 'data', label: 'Data import & reports' },
  { key: 'other', label: 'Something else' },
];

/** Public help page: support channels, office details and a mailto-composing form. */
export default function Contact() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ topic: 'registration', name: '', email: '', school: '', message: '' });
  const [errors, setErrors] = useState({});

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const buildHref = () => {
    const subject = `[E-MADAARIS] ${form.topic} — ${form.school || form.name}`.trim();
    const body = [
      `${t('contact.name', { defaultValue: 'Name' })}: ${form.name}`,
      `${t('contact.email', { defaultValue: 'Email' })}: ${form.email}`,
      `${t('contact.school', { defaultValue: 'School' })}: ${form.school}`,
      `${t('contact.topic', { defaultValue: 'Topic' })}: ${form.topic}`,
      '',
      form.message,
    ].join('\n');
    return `mailto:${DETAILS.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const submit = (e) => {
    e.preventDefault();
    const missing = {};
    if (form.name.trim().length < 2) missing.name = t('contact.errName', { defaultValue: 'Please tell us your name' });
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) missing.email = t('contact.errEmail', { defaultValue: 'Enter a valid email so we can reply' });
    if (form.message.trim().length < 10) missing.message = t('contact.errMessage', { defaultValue: 'Add a few more details (10 characters or more)' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    window.location.href = buildHref();
    toast.info(t('contact.mailtoHint', { defaultValue: 'Your email app should open with the message ready to send.' }));
  };

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2">{t('contact.title', { defaultValue: 'Talk to the E-MADAARIS team' })}</h1>
          <p className="mb-0" style={{ color: '#d9d2f7', maxWidth: '46rem' }}>
            {t('contact.sub', { defaultValue: 'Questions about registering a school, plans, invitations or data? Write to us — a person reads every message.' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          <div className="row g-4">
            {/* ── Channels & office ─────────────────────────── */}
            <div className="col-12 col-lg-5">
              <div className="card-soft p-4 mb-3">
                <div className="fw-semibold mb-3 d-flex align-items-center gap-2">
                  <MessageCircle size={17} style={{ color: BRAND }} />
                  {t('contact.channels', { defaultValue: 'Support channels' })}
                </div>
                <Channel icon={Mail} label={t('contact.emailLabel', { defaultValue: 'Email' })} value={DETAILS.email} href={`mailto:${DETAILS.email}`} />
                <Channel icon={Phone} label={t('contact.phoneLabel', { defaultValue: 'Phone' })} value={DETAILS.phone} href={`tel:${DETAILS.phone.replace(/[^+\d]/g, '')}`} />
                <Channel icon={MapPin} label={t('contact.officeLabel', { defaultValue: 'Office' })} value={DETAILS.address} />
                <Channel icon={Building2} label={t('contact.hoursLabel', { defaultValue: 'Working hours' })} value={DETAILS.hours} />
                <Channel icon={Headphones} label={t('contact.developer', { defaultValue: 'Built and operated by' })} value="JSOM TECH" />
                <p className="small text-muted mb-0 mt-2">
                  {t('contact.placeholderNote', { defaultValue: 'The email, phone and office details above are configuration placeholders. They are replaced with the published contacts when the deployment sets its support variables.' })}
                </p>
              </div>

              <div className="card-soft p-4">
                <div className="fw-semibold mb-2">{t('contact.customersTitle', { defaultValue: 'Already using E-MADAARIS?' })}</div>
                <p className="small text-muted">
                  {t('contact.customersBody', { defaultValue: 'Registered schools raise support tickets from inside the app, where the team can see the school, plan and activity behind the request. This public page has no ticket queue — it opens an email instead.' })}
                </p>
                <Link to="/school/support" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
                  {t('common.support')} <ExternalLink size={13} />
                </Link>
                <div className="small text-muted mt-2">{t('contact.signInFirst', { defaultValue: 'You need to be signed in to open the support center.' })}</div>
              </div>
            </div>

            {/* ── Mailto composer ───────────────────────────── */}
            <div className="col-12 col-lg-7">
              <div className="card-soft p-4">
                <div className="fw-semibold mb-1">{t('contact.formTitle', { defaultValue: 'Send us a message' })}</div>
                <p className="small text-muted mb-3">
                  {t('contact.formNote', { defaultValue: 'There is no public contact form on the platform itself: filling this in prepares an email in your own mail app, with the subject and body already written for you. Nothing is sent until you press send there.' })}
                </p>

                <form onSubmit={submit} noValidate>
                  <div className="row">
                    <div className="col-12 mb-3">
                      <label className="form-label small fw-semibold" htmlFor="c-topic">{t('contact.topic', { defaultValue: 'Topic' })}</label>
                      <select id="c-topic" className="form-select" value={form.topic} onChange={set('topic')}>
                        {TOPICS.map((o) => (
                          <option key={o.key} value={o.key}>{t(`contact.topics.${o.key}`, { defaultValue: o.label })}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12 col-md-6 mb-3">
                      <label className="form-label small fw-semibold" htmlFor="c-name">
                        {t('contact.name', { defaultValue: 'Name' })} <span className="text-danger">*</span>
                      </label>
                      <input id="c-name" className={`form-control${errors.name ? ' is-invalid' : ''}`} value={form.name} onChange={set('name')}
                        placeholder={t('contact.namePh', { defaultValue: 'Your full name' })} />
                      {errors.name ? <div className="form-text text-danger small">{errors.name}</div> : null}
                    </div>
                    <div className="col-12 col-md-6 mb-3">
                      <label className="form-label small fw-semibold" htmlFor="c-email">
                        {t('contact.email', { defaultValue: 'Email' })} <span className="text-danger">*</span>
                      </label>
                      <input id="c-email" type="email" className={`form-control${errors.email ? ' is-invalid' : ''}`} value={form.email} onChange={set('email')}
                        placeholder={t('contact.emailPh', { defaultValue: 'you@school.edu' })} />
                      {errors.email ? <div className="form-text text-danger small">{errors.email}</div> : null}
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label small fw-semibold" htmlFor="c-school">{t('contact.school', { defaultValue: 'School (optional)' })}</label>
                      <input id="c-school" className="form-control" value={form.school} onChange={set('school')}
                        placeholder={t('contact.schoolPh', { defaultValue: 'School name, if you have one' })} />
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label small fw-semibold" htmlFor="c-message">
                        {t('contact.message', { defaultValue: 'Message' })} <span className="text-danger">*</span>
                      </label>
                      <textarea id="c-message" rows={5} className={`form-control${errors.message ? ' is-invalid' : ''}`} value={form.message} onChange={set('message')}
                        placeholder={t('contact.messagePh', { defaultValue: 'Tell us the number of students and staff, the modules you need, and any deadline.' })} />
                      {errors.message ? <div className="form-text text-danger small">{errors.message}</div> : null}
                    </div>
                  </div>

                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-1">
                      <Send size={15} /> {t('contact.openMail', { defaultValue: 'Compose email' })}
                    </button>
                    <a className="btn btn-outline-secondary btn-sm" href={buildHref()}>
                      {t('contact.copyLess', { defaultValue: 'Open a blank message instead' })}
                    </a>
                  </div>
                  <div className="small text-muted mt-3">
                    {t('contact.toAddress', { defaultValue: 'The message is addressed to' })} <b>{DETAILS.email}</b>.
                  </div>
                </form>
              </div>

              <div className="card-soft p-4 mt-3">
                <div className="fw-semibold mb-2">{t('contact.beforeWriting', { defaultValue: 'Before you write' })}</div>
                <ul className="small text-muted mb-0 ps-3">
                  <li>{t('contact.before1', { defaultValue: 'Pricing and limits are published on the pricing page — plans come from the platform configuration.' })}</li>
                  <li>{t('contact.before2', { defaultValue: 'Forgot your password? Use the reset link on the sign-in page; the email arrives within a minute.' })}</li>
                  <li>{t('contact.before3', { defaultValue: 'Invitation link expired? Your school administrator can re-invite you from Users & invitations.' })}</li>
                  <li>{t('contact.before4', { defaultValue: 'Need to check a certificate or student ID? Use the public verification page.' })}</li>
                </ul>
                <div className="d-flex gap-2 mt-3 flex-wrap">
                  <Link to="/pricing" className="btn btn-sm btn-outline-primary">{t('public.pricing', { defaultValue: 'Pricing' })}</Link>
                  <Link to="/login" className="btn btn-sm btn-outline-primary">{t('common.login')}</Link>
                  <Link to="/verify" className="btn btn-sm btn-outline-primary">{t('verify.title', { defaultValue: 'Verify a document' })}</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Channel({ icon: Icon, label, value, href }) {
  return (
    <div className="d-flex align-items-start gap-3 py-2 border-bottom">
      <span className="stat-icon"><Icon size={16} /></span>
      <div>
        <div className="small text-muted">{label}</div>
        {href ? <a className="fw-semibold small" href={href}>{value}</a> : <div className="fw-semibold small">{value}</div>}
      </div>
    </div>
  );
}
