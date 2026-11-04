/**
 * Library circulation desk. Issuing creates a library_transactions row; the API keeps
 * library_books.available_copies in step, so the desk never patches the book directly.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { BookOpen, PlusCircle, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function LibraryLoansPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [search, setSearch] = useState(query.q || '');
  const [debounced, setDebounced] = useState(query.q || '');
  const [category, setCategory] = useState(query.category || '');
  const [issuing, setIssuing] = useState(null);
  const [borrower, setBorrower] = useState('');
  const [picked, setPicked] = useState(null);
  const [dueDate, setDueDate] = useState(localDate(14));
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [people, setPeople] = useState([]);
  const [finding, setFinding] = useState(false);
  const [status, setStatus] = useState('borrowed');

  const books = useApi('/library-books', {
    pageSize: 200,
    ...(debounced ? { q: debounced } : {}),
    ...(category ? { category } : {}),
  });
  const loans = useApi('/library-transactions', { status, pageSize: 100 });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  const rows = useMemo(() => books.data || [], [books.data]);
  const mayIssue = can('library.create');
  const mayReturn = can('library.edit');
  const categories = useMemo(() => [...new Set(rows.map((b) => b.category).filter(Boolean))].sort(), [rows]);
  const totals = useMemo(() => {
    const total = rows.reduce((s, b) => s + Number(b.total_copies || 0), 0);
    const available = rows.reduce((s, b) => s + Number(b.available_copies ?? b.total_copies ?? 0), 0);
    return { titles: rows.length, total, available, onLoan: Math.max(0, total - available) };
  }, [rows]);

  useEffect(() => {
    const term = (borrower || '').trim();
    if (!issuing || picked || term.length < 2) { setPeople([]); return undefined; }
    let alive = true;
    setFinding(true);
    const id = setTimeout(() => {
      apiGet('/students', { pageSize: 10, q: term })
        .then((body) => { if (alive) setPeople(body.data || []); })
        .catch(() => { if (alive) setPeople([]); })
        .finally(() => { if (alive) setFinding(false); });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [borrower, issuing, picked]);

  const copyCount = (b) => Number(b.available_copies ?? b.total_copies ?? 0);
  const totalCount = (b) => Number(b.total_copies || 0);

  const openIssue = (book) => {
    setIssuing(book);
    setBorrower('');
    setPicked(null);
    setRemarks('');
    setDueDate(localDate(14));
  };

  const issue = async () => {
    if (!issuing || !picked) return;
    setBusy(`${issuing.id}:issue`);
    try {
      await apiPost('/library-transactions', {
        book_id: issuing.id,
        borrower_type: 'student',
        student_id: picked.id,
        due_date: dueDate || undefined,
        remarks: remarks.trim() || undefined,
        status: 'borrowed',
      });
      toast.success(t('modules.copyIssued', { defaultValue: 'Copy issued to {{name}}', name: picked.full_name }));
      setIssuing(null);
      books.reload();
      loans.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const markReturned = async (loan) => {
    setBusy(`${loan.id}:return`);
    try {
      await apiPatch(`/library-transactions/${loan.id}`, { status: 'returned' });
      toast.success(t('modules.copyReturned', { defaultValue: 'Copy returned' }));
      books.reload();
      loans.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const overdue = (loan) => loan.status === 'overdue' || (loan.due_date && loan.status === 'borrowed' && loan.due_date < localDate(0));

  return (
    <>
      <PageHeader
        title={t('modules.library-loans', { defaultValue: 'Library circulation' })}
        subtitle={t('modules.libraryHint', { defaultValue: 'Issue a copy to a student and record returns here; the catalogue availability follows automatically.' })}
        actions={(
          <>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={() => { books.reload(); loans.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/library-books">{t('modules.manageCatalogue', { defaultValue: 'Manage catalogue' })}</Link>
          </>
        )}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.titles', { defaultValue: 'Titles listed' })} value={totals.titles} icon={BookOpen} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.copies', { defaultValue: 'Copies' })} value={totals.total} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.available', { defaultValue: 'Available' })} value={totals.available} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.onLoan', { defaultValue: 'On loan' })} value={totals.onLoan} tone={totals.onLoan ? 'warn' : 'neutral'} /></div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card-soft overflow-hidden">
            <div className="d-flex flex-wrap gap-2 align-items-center px-3 py-2 border-bottom bg-white">
              <div className="input-group input-group-sm" style={{ maxWidth: 280 }}>
                <span className="input-group-text bg-white"><Search size={14} /></span>
                <input className="form-control" value={search} aria-label={t('common.search')}
                  placeholder={t('modules.searchBookPlaceholder', { defaultValue: 'Title, author or ISBN' })}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="form-select form-select-sm" style={{ maxWidth: 180 }} value={category} aria-label={t('modules.category', { defaultValue: 'Category' })}
                onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="small text-muted ms-auto">{rows.length} {t('modules.titlesLower', { defaultValue: 'titles' })}</span>
            </div>

            {books.loading && !books.data && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
            {books.error && <div className="p-3"><ErrorState error={books.error} onRetry={books.reload} /></div>}
            {!books.loading && !books.error && !rows.length && (
              <div className="p-4"><EmptyState icon={BookOpen} title={t('modules.noBooks', { defaultValue: 'No books in the catalogue yet' })}
                hint={t('modules.noBooksHint', { defaultValue: 'Add titles in the library books module first.' })} /></div>
            )}

            {rows.length > 0 && (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('modules.title', { defaultValue: 'Title' })}</th>
                      <th>{t('modules.author', { defaultValue: 'Author' })}</th>
                      <th className="text-end">{t('modules.availability', { defaultValue: 'Available / total' })}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const available = copyCount(b);
                      return (
                        <tr key={b.id}>
                          <td className="small">
                            <div className="fw-semibold">{b.title}</div>
                            {b.isbn && <div className="text-muted">{b.isbn}</div>}
                          </td>
                          <td className="small">{b.author || '—'}</td>
                          <td className="text-end small tabular-nums">
                            <span className={available === 0 ? 'text-danger fw-semibold' : 'fw-semibold'}>{available}</span> / {totalCount(b)}
                          </td>
                          <td className="text-end">
                            {mayIssue ? (
                              <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                                disabled={available === 0 || Boolean(busy)} onClick={() => openIssue(b)}>
                                <PlusCircle size={13} /> {t('modules.issue', { defaultValue: 'Issue' })}
                              </button>
                            ) : <span className="text-muted small">{t('modules.readOnly', { defaultValue: 'Read only' })}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="card-soft overflow-hidden h-100">
            <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-white">
              <div className="fw-semibold">{t('modules.circulation', { defaultValue: 'Circulation log' })}</div>
              <select className="form-select form-select-sm" style={{ maxWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="borrowed">{t('modules.outstanding', { defaultValue: 'On loan' })}</option>
                <option value="overdue">{t('modules.overdue', { defaultValue: 'Overdue' })}</option>
                <option value="returned">{t('modules.returned', { defaultValue: 'Returned' })}</option>
                <option value="">{t('common.all')}</option>
              </select>
            </div>

            {loans.loading && !loans.data && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
            {loans.error && <div className="p-3"><ErrorState error={loans.error} onRetry={loans.reload} /></div>}
            {!loans.loading && !loans.error && !(loans.data || []).length && (
              <div className="p-4"><EmptyState title={t('modules.noLoans', { defaultValue: 'No loans in this view' })} /></div>
            )}
            {(loans.data || []).length > 0 && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('modules.book', { defaultValue: 'Book' })}</th>
                      <th>{t('modules.borrower', { defaultValue: 'Borrower' })}</th>
                      <th>{t('modules.dueDate', { defaultValue: 'Due date' })}</th>
                      <th>{t('common.status')}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(loans.data || []).map((loan) => (
                      <tr key={loan.id}>
                        <td className="small">{loan.library_books?.title || '—'}</td>
                        <td className="small">{loan.students?.full_name || loan.school_users?.full_name || '—'}</td>
                        <td className={`small ${overdue(loan) ? 'text-danger fw-semibold' : ''}`}>{dateOnly(loan.due_date)}</td>
                        <td><StatusBadge value={overdue(loan) ? 'overdue' : loan.status} /></td>
                        <td className="text-end">
                          {mayReturn && ['borrowed', 'overdue'].includes(loan.status) && (
                            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                              disabled={Boolean(busy)} onClick={() => markReturned(loan)}>
                              <RotateCcw size={13} /> {t('modules.return', { defaultValue: 'Return' })}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={Boolean(issuing)} size="md" onClose={() => setIssuing(null)}
        title={`${t('modules.issueCopy', { defaultValue: 'Issue a copy' })} · ${issuing?.title || ''}`}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => setIssuing(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" disabled={!picked || busy === `${issuing?.id}:issue`} onClick={issue}>
              {t('modules.issue', { defaultValue: 'Issue' })}
            </button>
          </>
        )}>
        <label className="form-label small fw-semibold" htmlFor="lib-borrower">{t('modules.borrower', { defaultValue: 'Borrower' })}</label>
        <input id="lib-borrower" className="form-control form-control-sm" autoComplete="off" value={borrower}
          placeholder={t('modules.borrowerPlaceholder', { defaultValue: 'Type a student name or admission number' })}
          onChange={(e) => { setBorrower(e.target.value); setPicked(null); }} />
        {finding && <div className="small text-muted mt-1">{t('common.loading')}</div>}
        {!picked && !finding && people.length > 0 && (
          <div className="list-group list-group-flush mt-2">
            {people.map((s) => (
              <button key={s.id} type="button" className="list-group-item list-group-item-action small"
                onClick={() => { setPicked(s); setBorrower(s.full_name); setPeople([]); }}>
                {s.full_name} · {s.admission_number}
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div className="alert alert-light border py-2 px-3 small mb-0 mt-2">
            {t('modules.selectedBorrower', { defaultValue: 'Selected' })}: <strong>{picked.full_name}</strong> · {picked.admission_number}
          </div>
        )}
        <div className="row g-2 mt-2">
          <div className="col-6">
            <label className="form-label small fw-semibold" htmlFor="lib-due">{t('modules.dueDate', { defaultValue: 'Due date' })}</label>
            <input id="lib-due" type="date" className="form-control form-control-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="col-6">
            <label className="form-label small fw-semibold" htmlFor="lib-remarks">{t('modules.remarks', { defaultValue: 'Remarks' })}</label>
            <input id="lib-remarks" className="form-control form-control-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        {issuing && (
          <div className="small text-muted mt-2">
            {t('modules.availableNow', { defaultValue: 'Available copies' })}: {copyCount(issuing)} / {totalCount(issuing)}
          </div>
        )}
      </Modal>
    </>
  );
}
