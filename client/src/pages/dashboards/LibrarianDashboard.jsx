// Librarian home: catalogue snapshot from GET /library-books plus school announcements.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Library, BookOpen, BookX, Megaphone } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, dateOnly } from '../../components/ui/Basics.jsx';

export default function LibrarianDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const books = useApi('/library-books', { pageSize: 5 });

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const rows = books.data || [];
  const totalCopies = rows.reduce((s, b) => s + Number(b.total_copies || 0), 0);
  const available = rows.reduce((s, b) => s + Number(b.available_copies || 0), 0);
  const unavailable = rows.filter((b) => Number(b.available_copies) === 0);

  return (
    <>
      <PageHeader
        title={t('dashboards.librarianHome', { defaultValue: 'Library dashboard' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/m/library-books" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><BookOpen size={14} /> {t('modules.library-books')}</Link>}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.titles', { defaultValue: 'Titles' })} value={books.total ?? rows.length} icon={Library} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.totalCopies', { defaultValue: 'Copies (this page)' })} value={totalCopies} icon={BookOpen} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.availableCopies', { defaultValue: 'Available (this page)' })} value={available} icon={BookOpen} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.outOfStock', { defaultValue: 'Unavailable' })} value={unavailable.length} icon={BookX} tone="danger" /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><BookX size={15} className="me-1" /> {t('dashboards.lowAvailability', { defaultValue: 'Books with no copies available' })}</div>
              <Link to="/m/library-books" className="small">{t('common.viewAll')}</Link>
            </div>
            {books.loading && !books.data && <Spinner />}
            {unavailable.length === 0 && !books.loading && <EmptyState title={t('dashboards.allAvailable', { defaultValue: 'Everything on this page is available' })} />}
            {unavailable.map((b) => (
              <div key={b.id} className="d-flex justify-content-between border-bottom py-2 small">
                <span className="text-truncate me-2">{b.title}{b.author ? ` · ${b.author}` : ''}</span>
                <span className="text-muted text-nowrap">{b.available_copies ?? 0}/{b.total_copies ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
              <Link to="/m/library-loans" className="small">{t('dashboards.loans', { defaultValue: 'Loans' })}</Link>
            </div>
            {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
            {(data?.announcements || []).map((a) => (
              <div key={a.id} className="border-bottom py-2">
                <div className="small fw-semibold">{a.title}</div>
                <div className="small text-muted">{dateOnly(a.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
