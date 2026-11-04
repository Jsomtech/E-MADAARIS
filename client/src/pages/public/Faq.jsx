import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, MessageCircle, ArrowRight } from 'lucide-react';
import { useSiteContent } from '../../hooks/useSiteContent.js';

/** Frequently asked questions, grouped and rendered as a no-JS details/summary accordion. */
export default function Faq() {
  const { t } = useTranslation();
  const { content, stored } = useSiteContent('faq');

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2 d-flex align-items-center gap-2">
            <MessageCircle size={26} /> {stored ? content.title : t('faq.title', { defaultValue: content.title })}
          </h1>
          <p className="mb-0" style={{ color: '#d9d2f7', maxWidth: '48rem' }}>
            {stored ? content.sub : t('faq.sub', { defaultValue: content.sub })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container" style={{ maxWidth: '58rem' }}>
          {content.groups.map((group) => (
            <div key={group.key} className="mb-4">
              <h2 className="h6 text-uppercase small fw-bold text-muted mb-2">
                {stored ? group.title : t(`faq.groups.${group.key}`, { defaultValue: group.title })}
              </h2>
              {group.items.map((item) => (
                <details key={item.key} className="card-soft mb-2 p-0 overflow-hidden" id={item.key}>
                  <summary className="d-flex justify-content-between align-items-center gap-3 p-3 fw-semibold">
                    <span className="small">
                      {stored ? item.q : t(`faq.items.${item.key}.q`, { defaultValue: item.q })}
                    </span>
                    <ChevronDown size={16} className="text-muted flex-shrink-0" />
                  </summary>
                  <div className="px-3 pb-3 small text-muted">
                    {stored ? item.a : t(`faq.items.${item.key}.a`, { defaultValue: item.a })}
                  </div>
                </details>
              ))}
            </div>
          ))}

          <div className="card-soft p-4 mt-4">
            <div className="fw-semibold mb-1">
              {stored ? content.still.title : t('faq.stillTitle', { defaultValue: content.still.title })}
            </div>
            <p className="small text-muted mb-3">
              {stored ? content.still.body : t('faq.stillBody', { defaultValue: content.still.body })}
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/contact" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1">
                {t('contact.title', { defaultValue: 'Contact us' })} <ArrowRight size={14} />
              </Link>
              <Link to="/terms" className="btn btn-sm btn-outline-primary">{t('public.terms', { defaultValue: 'Terms of service' })}</Link>
              <Link to="/privacy" className="btn btn-sm btn-outline-primary">{t('public.privacy', { defaultValue: 'Privacy policy' })}</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
