import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scale, ArrowRight } from 'lucide-react';
import { useSiteContent } from '../../hooks/useSiteContent.js';

const BRAND = '#6027ff';

/** Terms of service, laid out as numbered articles. Copy is editable from Platform → Site content. */
export default function Terms() {
  const { t } = useTranslation();
  const { content, stored } = useSiteContent('terms');
  const articleLabel = stored ? content.articleLabel : t('terms.article', { defaultValue: content.articleLabel });

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2 d-flex align-items-center gap-2">
            <Scale size={24} /> {stored ? content.title : t('terms.title', { defaultValue: content.title })}
          </h1>
          <p className="mb-0" style={{ color: '#d9d2f7' }}>
            {stored ? content.updatedLabel : t('terms.updated', { defaultValue: content.updatedLabel })}: {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-lg-3">
              <div className="card-soft p-3 position-sticky" style={{ top: '5rem' }}>
                <div className="small fw-semibold mb-2">
                  {stored ? content.contentsLabel : t('terms.contents', { defaultValue: content.contentsLabel })}
                </div>
                {content.articles.map((a, i) => (
                  <a key={a.key || i} href={`#article-${i + 1}`} className="small d-block py-1 text-decoration-none text-muted">
                    {i + 1}. {a.title}
                  </a>
                ))}
              </div>
            </div>

            <div className="col-12 col-lg-9">
              <p className="text-muted small mb-4">
                {stored ? content.intro : t('terms.intro', { defaultValue: content.intro })}
              </p>

              {content.articles.map((article, index) => (
                <article key={article.key || index} id={`article-${index + 1}`} className="card-soft p-4 mb-3">
                  <h2 className="h6 fw-bold mb-3" style={{ color: BRAND }}>
                    {articleLabel} {index + 1} — {article.title}
                  </h2>
                  <ol className="small text-muted mb-0 ps-3">
                    {article.clauses.map((clause, ci) => (
                      <li key={ci} className="mb-2">{clause}</li>
                    ))}
                  </ol>
                </article>
              ))}

              <div className="card-soft p-4 mt-4">
                <div className="fw-semibold mb-1">
                  {stored ? content.questionsTitle : t('terms.questionsTitle', { defaultValue: content.questionsTitle })}
                </div>
                <p className="small text-muted">
                  {stored ? content.questionsBody : t('terms.questionsBody', { defaultValue: content.questionsBody })}
                </p>
                <div className="d-flex flex-wrap gap-2">
                  <Link to="/contact" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1">
                    {t('contact.title', { defaultValue: 'Contact us' })} <ArrowRight size={14} />
                  </Link>
                  <Link to="/privacy" className="btn btn-sm btn-outline-primary">{t('public.privacy', { defaultValue: 'Privacy policy' })}</Link>
                  <Link to="/" className="btn btn-sm btn-outline-secondary">{t('public.home', { defaultValue: 'Home' })}</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
