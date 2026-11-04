import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, ShieldCheck, Trash2, UserCheck, ArrowRight } from 'lucide-react';
import { useSiteContent } from '../../hooks/useSiteContent.js';

const BRAND = '#6027ff';
const PROMISE_ICONS = [ShieldCheck, Lock, UserCheck, Trash2];
const PROMISE_KEYS = ['isolation', 'hashing', 'audit', 'deletion'];
const PROMISE_FALLBACKS = [
  'One tenant per school — enforced on every query',
  'No plaintext passwords, anywhere in our stack',
  'Access to school data by platform staff is logged',
  'Deleted records leave the active tenant immediately',
];

/** Privacy policy: what we process, tenant isolation, retention, rights and contacts. */
export default function Privacy() {
  const { t } = useTranslation();
  const { content, stored } = useSiteContent('privacy');

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2 d-flex align-items-center gap-2">
            <Lock size={24} /> {stored ? content.title : t('privacy.title', { defaultValue: content.title })}
          </h1>
          <p className="mb-0" style={{ color: '#d9d2f7' }}>
            {stored ? content.updatedLabel : t('privacy.updated', { defaultValue: content.updatedLabel })}: {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container" style={{ maxWidth: '60rem' }}>
          <div className="card-soft p-4 mb-4">
            <p className="mb-0 small text-muted">
              {stored ? content.intro : t('privacy.intro', { defaultValue: content.intro })}
            </p>
          </div>

          <div className="row g-3 mb-4">
            {PROMISE_ICONS.map((Icon, i) => (
              <div key={PROMISE_KEYS[i]} className="col-12 col-md-6">
                <div className="card-soft p-3 h-100 d-flex align-items-start gap-3">
                  <span className="stat-icon"><Icon size={17} /></span>
                  <div className="small fw-semibold pt-2">
                    {stored
                      ? (content.promises[i] || PROMISE_FALLBACKS[i])
                      : t(`privacy.promises.${PROMISE_KEYS[i]}`, { defaultValue: content.promises[i] || PROMISE_FALLBACKS[i] })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {content.sections.map((section, index) => (
            <article key={section.key || index} id={section.key} className="card-soft p-4 mb-3">
              <h2 className="h6 fw-bold mb-3" style={{ color: BRAND }}>
                {index + 1}. {stored ? section.title : t(`privacy.sections.${section.key}.title`, { defaultValue: section.title })}
              </h2>
              {section.body.map((line, i) => (
                <p key={i} className="small text-muted mb-2">
                  {stored ? line : t(`privacy.sections.${section.key}.body.${i}`, { defaultValue: line })}
                </p>
              ))}
            </article>
          ))}

          <div className="card-soft p-4">
            <div className="fw-semibold mb-1">
              {stored ? content.contactTitle : t('privacy.contactTitle', { defaultValue: content.contactTitle })}
            </div>
            <p className="small text-muted">
              {stored ? content.contactBody : t('privacy.contactBody', { defaultValue: content.contactBody })}
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/contact" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1">
                {t('contact.title', { defaultValue: 'Contact us' })} <ArrowRight size={14} />
              </Link>
              <Link to="/terms" className="btn btn-sm btn-outline-primary">{t('public.terms', { defaultValue: 'Terms of service' })}</Link>
              <Link to="/features#security" className="btn btn-sm btn-outline-secondary">{t('privacy.securityFeatures', { defaultValue: 'Security in the product' })}</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
