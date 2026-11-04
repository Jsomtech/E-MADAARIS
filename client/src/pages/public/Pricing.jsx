import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, Briefcase, HardDrive, CalendarClock, Building2, Check, Minus, ArrowRight, ShieldCheck,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { Spinner, EmptyState, ErrorState, Badge } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';
const CYCLES = [
  { key: 'monthly', field: 'monthly_price', months: 1 },
  { key: 'quarterly', field: 'quarterly_price', months: 3 },
  { key: 'annual', field: 'annual_price', months: 12 },
];

const FEATURE_LABELS = {
  'students.management': 'Student management',
  'teachers.management': 'Teachers & staff',
  'classes.subjects': 'Classes & subjects',
  attendance: 'Attendance',
  examinations: 'Examinations',
  results: 'Results & report cards',
  fees: 'Fees & payments',
  'parent.portal': 'Parent portal',
  'digital.learning': 'Digital learning',
  'advanced.analytics': 'Advanced analytics',
  certificates: 'Certificates',
  library: 'Library',
  discipline: 'Discipline',
  transport: 'Transport',
  hr: 'HR & leave',
};

const humanKey = (key) => String(key).replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function storageLabel(mb) {
  if (mb == null) return '—';
  const n = Number(mb);
  if (!Number.isFinite(n)) return String(mb);
  return n >= 1024 ? `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} GB` : `${n} MB`;
}

function priceLabel(value, currency) {
  const n = Number(value);
  if (!n) return null;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || 'USD'}`;
}

/** Public pricing table built from the plans the platform has published. */
export default function Pricing() {
  const { t } = useTranslation();
  const plans = useApi('/public/plans');
  const rows = useMemo(() => (plans.data || []).filter(Boolean), [plans.data]);

  // Default the billing toggle to the cheapest cycle actually listed (per month).
  const defaultCycle = useMemo(() => {
    const averages = CYCLES.map((c) => {
      const prices = rows
        .map((p) => Number(p[c.field]))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!prices.length) return { key: c.key, avg: Number.POSITIVE_INFINITY };
      return { key: c.key, avg: prices.reduce((a, b) => a + b, 0) / prices.length / c.months };
    });
    const cheapest = averages.slice().sort((a, b) => a.avg - b.avg)[0];
    return cheapest && Number.isFinite(cheapest.avg) ? cheapest.key : 'monthly';
  }, [rows]);

  const [cycle, setCycle] = useState(null);
  const activeCycle = cycle || defaultCycle;
  const activeDef = CYCLES.find((c) => c.key === activeCycle) || CYCLES[0];

  return (
    <>
      <section className="public-hero py-5">
        <div className="container text-center">
          <h1 className="h2 fw-bold mb-2">{t('pricing.title', { defaultValue: 'Simple plans, published prices' })}</h1>
          <p className="mb-4" style={{ color: '#d9d2f7' }}>
            {t('pricing.sub', { defaultValue: 'Every plan is billed per school, includes unlimited students-of-record reads, and can be changed as the school grows.' })}
          </p>
          {rows.length > 0 ? (
            <div className="btn-group btn-group-sm" role="group" aria-label={t('pricing.billingCycle', { defaultValue: 'Billing cycle' })}>
              {CYCLES.map((c) => (
                <button key={c.key} type="button"
                  className={`btn ${activeCycle === c.key ? 'btn-primary' : 'btn-outline-light'}`}
                  onClick={() => setCycle(c.key)}>
                  {t(`pricing.cycles.${c.key}`, { defaultValue: c.key[0].toUpperCase() + c.key.slice(1) })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          {plans.loading && !plans.data ? <div className="text-center"><Spinner label={t('common.loading')} /></div> : null}
          {plans.error ? <ErrorState error={plans.error} onRetry={plans.reload} /> : null}

          {!plans.loading && !plans.error && rows.length === 0 ? (
            <div className="card-soft p-5">
              <EmptyState
                icon={ShieldCheck}
                title={t('pricing.empty', { defaultValue: 'No plans published yet' })}
                hint={t('pricing.emptyHint', { defaultValue: 'The platform team publishes subscription plans before schools can register. Contact us and we will set one up for your school.' })}
              />
              <div className="text-center mt-3">
                <Link to="/contact" className="btn btn-sm btn-outline-primary">{t('contact.title', { defaultValue: 'Contact support' })}</Link>
              </div>
            </div>
          ) : null}

          <div className="row g-3 align-items-stretch">
            {rows.map((plan, index) => {
              const price = plan[activeDef.field];
              const shown = priceLabel(price, plan.currency);
              const perMonth = Number(price) > 0 && activeDef.months > 1
                ? priceLabel(Number(price) / activeDef.months, plan.currency)
                : null;
              const enabled = (plan.features || []).filter((f) => f.enabled);
              const featured = rows.length > 1 && index === Math.min(2, rows.length - 1);

              return (
                <div className="col-12 col-md-6 col-xl-3" key={plan.id}>
                  <div className={`plan-card p-4 h-100 d-flex flex-column ${featured ? 'featured' : ''}`}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="fw-bold fs-5">{plan.name}</div>
                      {featured ? <Badge tone="brand">{t('pricing.popular', { defaultValue: 'Popular' })}</Badge> : null}
                    </div>
                    <div className="small text-muted mb-3">{plan.description}</div>

                    <div className="mb-1" style={{ color: BRAND }}>
                      <span className="fs-3 fw-bold">{shown || t('pricing.custom', { defaultValue: 'Custom pricing' })}</span>
                      {shown ? <span className="small text-muted"> / {t(`pricing.cycles.${activeCycle}`, { defaultValue: activeCycle })}</span> : null}
                    </div>
                    {perMonth ? (
                      <div className="small text-muted mb-2">
                        ≈ {perMonth} {t('pricing.perMonth', { defaultValue: 'per month' })}
                      </div>
                    ) : null}
                    {!shown ? (
                      <div className="small text-muted mb-2">{t('pricing.customHint', { defaultValue: 'Quoted per school — talk to us about limits and modules.' })}</div>
                    ) : null}

                    {Number(plan.trial_days) > 0 ? (
                      <div className="small mb-3">
                        <Badge tone="info">
                          <CalendarClock size={12} className="me-1" />
                          {plan.trial_days} {t('pricing.trialDays', { defaultValue: 'trial days' })}
                        </Badge>
                      </div>
                    ) : null}

                    <div className="list-unstyled small mb-3">
                      <Limit icon={Users} label={t('pricing.maxStudents', { defaultValue: 'Students' })} value={plan.max_students} />
                      <Limit icon={Briefcase} label={t('pricing.maxStaff', { defaultValue: 'Staff accounts' })} value={plan.max_staff} />
                      <Limit icon={HardDrive} label={t('pricing.storage', { defaultValue: 'Storage' })} value={storageLabel(plan.max_storage_mb)} />
                      <Limit icon={Building2} label={t('pricing.branches', { defaultValue: 'Branches' })} value={plan.max_branches} />
                    </div>

                    <div className="flex-grow-1 mb-3">
                      <div className="small fw-semibold mb-2">{t('pricing.included', { defaultValue: 'Included features' })}</div>
                      {enabled.length === 0 ? (
                        <div className="small text-muted d-flex align-items-center gap-1">
                          <Minus size={13} /> {t('pricing.noFeatures', { defaultValue: 'No feature switches listed' })}
                        </div>
                      ) : (
                        <div className="d-flex flex-wrap gap-1">
                          {enabled.map((f) => (
                            <span key={f.feature_key} className="badge rounded-pill text-bg-light border d-flex align-items-center gap-1">
                              <Check size={11} className="text-success" />
                              {FEATURE_LABELS[f.feature_key] || humanKey(f.feature_key)}
                              {f.limit_value != null && f.limit_value !== '' ? <span className="text-muted small">{f.limit_value}</span> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <Link to="/contact" className={`btn btn-sm ${featured ? 'btn-primary' : 'btn-outline-primary'} d-inline-flex align-items-center justify-content-center gap-1`}>
                      {t('contact.askUs', { defaultValue: 'Ask us' })} · {plan.name} <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {rows.length > 0 ? (
            <p className="small text-muted mt-4 mb-0">
              {t('pricing.footnote', { defaultValue: 'Prices are shown in the currency published with each plan. Taxes and mobile-money charges applied by the payment provider are not included. Changing cycle or plan is handled by the platform team.' })}
            </p>
          ) : null}
        </div>
      </section>

      <section className="pb-5">
        <div className="container">
          <div className="card-soft p-4 d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <div className="fw-semibold">{t('pricing.compareTitle', { defaultValue: 'Not sure which plan fits your school?' })}</div>
              <div className="small text-muted">{t('pricing.compareBody', { defaultValue: 'Count your students and staff today — the plan limits above are enforced when records are created, so pick one step ahead.' })}</div>
            </div>
            <div className="d-flex gap-2">
              <Link to="/contact" className="btn btn-sm btn-outline-primary">{t('contact.askUs', { defaultValue: 'Ask us' })}</Link>
              <Link to="/login" className="btn btn-sm btn-primary">{t('common.login')}</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Limit({ icon: Icon, label, value }) {
  return (
    <div className="d-flex justify-content-between border-bottom py-2">
      <span className="text-muted d-flex align-items-center gap-2"><Icon size={14} /> {label}</span>
      <span className="fw-semibold">{value == null ? '—' : (Number(value) >= 100000 ? 'Unlimited' : value)}</span>
    </div>
  );
}
