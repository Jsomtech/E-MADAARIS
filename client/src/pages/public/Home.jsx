import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, Bell, CheckCircle2, ClipboardList, FileCheck2, GraduationCap,
  Languages, MessageCircle, Palette, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useSiteContent } from '../../hooks/useSiteContent.js';
import { Spinner, money, EmptyState } from '../../components/ui/Basics.jsx';
import BrandLogo from '../../components/brand/BrandLogo.jsx';

const BRAND = '#6027ff';

const STEP_ICONS = [ClipboardList, FileCheck2, Wallet, Bell];
const STEP_KEYS = ['home.step1', 'home.step2', 'home.step3', 'home.step4'];
const TRUST_ICONS = [ShieldCheck, Languages, CheckCircle2, FileCheck2];
const TRUST_KEYS = ['home.trust.isolation', 'home.trust.bilingual', 'home.trust.audit', 'home.trust.verification'];
const SECURITY_ICONS = [...TRUST_ICONS, Palette];
const SECURITY_KEYS = [...TRUST_KEYS, 'home.trust.branding'];
const META_ICONS = [Languages, ShieldCheck, FileCheck2, Palette];
const META_KEYS = ['home.somaliEnglish', 'home.tenantIsolated', 'home.verifyDocs', 'home.schoolBranding'];
const STAT_KEYS = ['home.statModules', 'home.statLanguages', 'home.statTenant', null];

/**
 * Pointer-driven 3D tilt for the hero orbit. Values are written to CSS variables, so the
 * illustration moves without a single React re-render; the loop stops once motion settles.
 */
function usePointerTilt() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
    if (reduce || !fine) return undefined;

    let frame = 0;
    let running = false;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const write = () => {
      node.style.setProperty('--px', currentX.toFixed(4));
      node.style.setProperty('--py', currentY.toFixed(4));
    };

    const step = () => {
      currentX += (targetX - currentX) * 0.1;
      currentY += (targetY - currentY) * 0.1;
      if (Math.abs(targetX - currentX) < 0.002 && Math.abs(targetY - currentY) < 0.002) {
        currentX = targetX;
        currentY = targetY;
        write();
        running = false;
        return;
      }
      write();
      frame = requestAnimationFrame(step);
    };

    const animate = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(step);
    };

    const onMove = (event) => {
      if (event.pointerType === 'touch') return;
      const rect = node.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      animate();
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      animate();
    };

    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      node.style.removeProperty('--px');
      node.style.removeProperty('--py');
    };
  }, []);

  return ref;
}

/** Marketing landing page: animated hero, school-day workflow, trust panel and live plans. */
export default function Home() {
  const { t } = useTranslation();
  const { content, stored } = useSiteContent('home');
  const plans = useApi('/public/plans');
  const sceneRef = usePointerTilt();

  const tx = (key, fallback) => (stored || !key ? fallback : t(key, { defaultValue: fallback }));

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="public-hero home-hero">
        <div className="container">
          <div className="row align-items-center g-4 g-lg-5">
            <div className="col-12 col-lg-6">
              <span className="hero-pill hero-enter">
                <Sparkles size={14} /> {tx('home.badge', content.badge)}
              </span>
              <h1 className="hero-title hero-enter" style={{ '--delay': '70ms' }}>
                {tx('home.headline', content.headline)}
              </h1>
              <div className="hero-tagline hero-enter" style={{ '--delay': '140ms' }}>
                {content.tagline}
              </div>
              <p className="hero-lead mb-4 hero-enter" style={{ '--delay': '200ms' }}>
                {tx('home.sub', content.lead)}
              </p>
              <div className="d-flex flex-wrap gap-2 hero-actions hero-enter" style={{ '--delay': '260ms' }}>
                <Link to="/login" className="btn btn-light btn-lg fw-semibold d-inline-flex align-items-center justify-content-center gap-2">
                  {stored ? content.primaryCta : t('common.login')} <ArrowRight size={18} />
                </Link>
                <Link to="/contact" className="btn btn-outline-light btn-lg">
                  {tx('public.contact', content.secondaryCta)}
                </Link>
              </div>
              <div className="hero-meta mt-4 hero-enter" style={{ '--delay': '320ms' }}>
                {content.meta.map((label, i) => {
                  const Icon = META_ICONS[i] || ShieldCheck;
                  return (
                    <span key={i} className="d-flex align-items-center gap-1">
                      <Icon size={15} /> {tx(META_KEYS[i], label)}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="hero-scene-wrap hero-enter" style={{ '--delay': '180ms' }} aria-hidden="true">
                <div className="hero-scene-tilt" ref={sceneRef}>
                  <div className="hero-scene">
                    <span className="hero-halo" />
                    <span className="hero-ring hero-ring-a" />
                    <span className="hero-ring hero-ring-b" />
                    <span className="hero-ring hero-ring-c" />
                    <div className="hero-core">
                      <span className="hero-core-icon"><GraduationCap size={32} /></span>
                      <span className="hero-core-label">E-MADAARIS</span>
                    </div>
                    <span className="hero-node hero-node-1"><span className="hero-node-inner"><ShieldCheck size={19} /></span></span>
                    <span className="hero-node hero-node-2"><span className="hero-node-inner"><Languages size={19} /></span></span>
                    <span className="hero-node hero-node-3"><span className="hero-node-inner"><FileCheck2 size={19} /></span></span>
                    <span className="hero-node hero-node-4"><span className="hero-node-inner"><Palette size={19} /></span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-stats" data-reveal>
            {content.stats.map((stat, i) => (
              <div className="hero-stat" key={i}>
                <b>{stat.value}</b>
                <span>{tx(STAT_KEYS[i], stat.label)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow + security ──────────────────────────────── */}
      <section className="public-section tint">
        <div className="container">
          <div className="row g-4 align-items-stretch">
            <div className="col-12 col-lg-7">
              <div className="section-eyebrow" data-reveal>{tx('home.workflowEyebrow', content.workflow.eyebrow)}</div>
              <h2 className="section-title" data-reveal>{tx('home.workflowTitle', content.workflow.title)}</h2>
              <p className="section-sub mb-4" data-reveal>{tx('home.workflowSub', content.workflow.sub)}</p>
              <div className="row g-3">
                {content.workflow.steps.map((step, i) => {
                  const Icon = STEP_ICONS[i] || ClipboardList;
                  return (
                    <div className="col-12 col-md-6" key={i} data-reveal>
                      <div className="step-card step-card-3d">
                        <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
                        <div className="step-title d-flex align-items-center gap-2">
                          <Icon size={15} style={{ color: BRAND }} /> {t('home.stepLabel', { defaultValue: 'Step' })} {i + 1}
                        </div>
                        <div className="step-body">{tx(STEP_KEYS[i], step)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col-12 col-lg-5" data-reveal>
              <div className="security-panel">
                <div className="section-eyebrow" style={{ color: '#b9a4ff' }}>
                  {tx('home.securityEyebrow', content.security.eyebrow)}
                </div>
                <h2 className="h3 fw-bold mb-2">{tx('home.securityTitle', content.security.title)}</h2>
                <p className="small mb-0" style={{ color: '#bdb5dd' }}>
                  {tx('home.securitySub', content.security.sub)}
                </p>
                <ul className="security-list">
                  {content.security.items.map((item, i) => {
                    const Icon = SECURITY_ICONS[i] || ShieldCheck;
                    return (
                      <li key={i}>
                        <Icon size={16} />
                        {tx(SECURITY_KEYS[i], item)}
                      </li>
                    );
                  })}
                </ul>
                <div className="d-flex align-items-center gap-2 mt-4">
                  <BrandLogo tile imgClassName="sm" alt="E-MADAARIS logo" />
                  <span className="small" style={{ color: '#bdb5dd' }}>{t('home.securedBy', { defaultValue: 'Powered by E-MADAARIS' })}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Plan teaser (live from the API) ──────────────────── */}
      <section className="public-section">
        <div className="container">
          <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4" data-reveal>
            <div>
              <div className="section-eyebrow">{tx('home.pricingEyebrow', content.pricing.eyebrow)}</div>
              <h2 className="section-title mb-1">{tx('home.pricingTitle', content.pricing.title)}</h2>
              <p className="section-sub mb-0">{tx('home.pricingSub', content.pricing.sub)}</p>
            </div>
            <Link to="/pricing" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
              {t('home.comparePlans', { defaultValue: 'Compare all plans' })} <ArrowRight size={14} />
            </Link>
          </div>

          {plans.loading && !plans.data ? <Spinner label={t('common.loading')} /> : null}
          {plans.error ? (
            <div className="card-soft p-4 text-muted small">
              {t('home.pricingUnavailable', { defaultValue: 'Plan pricing could not be loaded right now. Please see the pricing page later.' })}
            </div>
          ) : null}
          {!plans.loading && !plans.error && (plans.data || []).length === 0 ? (
            <EmptyState title={t('home.noPlans', { defaultValue: 'No published plans yet' })} hint={t('home.noPlansHint', { defaultValue: 'The platform team publishes plans before schools can subscribe.' })} />
          ) : null}

          <div className="row g-3">
            {(plans.data || []).slice(0, 4).map((plan, i) => (
              <div className="col-12 col-md-6 col-lg-3" key={plan.id} data-reveal>
                <div className="plan-card plan-card-3d p-4 h-100 d-flex flex-column">
                  <div className="fw-bold">{plan.name}</div>
                  <div className="small text-muted mb-3">{plan.description}</div>
                  <div className="fs-4 fw-bold" style={{ color: BRAND }}>
                    {Number(plan.monthly_price) > 0 ? money(plan.monthly_price, plan.currency) : t('pricing.custom', { defaultValue: 'Custom pricing' })}
                    {Number(plan.monthly_price) > 0 ? <span className="small text-muted fw-normal"> / {t('pricing.perMonth', { defaultValue: 'month' })}</span> : null}
                  </div>
                  <ul className="list-unstyled small text-muted mt-3 mb-4 flex-grow-1">
                    <li>{t('home.upTo', { defaultValue: 'Up to' })} {plan.max_students ?? '—'} {t('modules.students', { defaultValue: 'students' }).toLowerCase()}</li>
                    <li>{plan.max_staff ?? '—'} {t('home.staffSeats', { defaultValue: 'staff seats' })}</li>
                    <li>{plan.trial_days ? `${plan.trial_days} ${t('pricing.trialDays', { defaultValue: 'trial days' })}` : t('pricing.noTrial', { defaultValue: 'No trial' })}</li>
                  </ul>
                  <Link to="/contact" className="btn btn-sm btn-outline-primary">
                    {t('contact.askUs', { defaultValue: 'Ask us' })} · {plan.name}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────── */}
      <section className="py-4">
        <div className="container">
          <div className="row g-3">
            {content.trust.map((item, i) => {
              const Icon = TRUST_ICONS[i] || ShieldCheck;
              return (
                <div className="col-12 col-md-6 col-lg-3" key={i} data-reveal>
                  <div className="trust-chip">
                    <Icon size={18} />
                    <span>{tx(TRUST_KEYS[i], item)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FAQ teaser + closing CTA ─────────────────────────── */}
      <section className="public-section pt-2">
        <div className="container">
          <div className="row g-4 align-items-center">
            <div className="col-12 col-lg-6" data-reveal>
              <h2 className="h4 fw-bold mb-3 d-flex align-items-center gap-2">
                <MessageCircle size={20} style={{ color: BRAND }} /> {tx('home.faqTitle', content.faq.title)}
              </h2>
              {content.faq.items.map((question, i) => (
                <div className="faq-item faq-item-3d" key={i}>
                  <div className="fw-semibold small">{tx(`home.faqQ${i + 1}`, question)}</div>
                </div>
              ))}
              <Link to="/faq" className="btn btn-sm btn-outline-primary mt-2">{tx('home.allFaq', content.faq.allLabel)}</Link>
            </div>
            <div className="col-12 col-lg-6" data-reveal>
              <div className="public-cta">
                <h3 className="fw-bold mb-2">{tx('home.ctaTitle', content.cta.title)}</h3>
                <p className="mb-4" style={{ color: '#d9d2f7' }}>
                  {tx('home.ctaBody', content.cta.body)}
                </p>
                <div className="d-flex flex-wrap gap-2">
                  <Link to="/contact" className="btn btn-light fw-semibold d-inline-flex align-items-center gap-1">
                    {tx('public.contact', content.cta.primaryCta)} <ArrowRight size={15} />
                  </Link>
                  <Link to="/login" className="btn btn-outline-light">
                    {stored ? content.cta.secondaryCta : t('common.login')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
