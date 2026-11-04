import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Languages, Menu, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext.jsx';
import BrandLogo from '../brand/BrandLogo.jsx';

const LINKS = [
  { to: '/features', key: 'features' },
  { to: '/pricing', key: 'pricing' },
  { to: '/about', key: 'about' },
  { to: '/contact', key: 'contact' },
  { to: '/faq', key: 'faq' },
];

export function PublicHeader() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="public-header">
      <div className="container">
        <Link to="/" className="d-flex align-items-center text-decoration-none" aria-label="E-MADAARIS home">
          <BrandLogo imgClassName="public-header-logo" alt="E-MADAARIS — Nidaamka Dijitaalka ah ee Maamulka Dugsiga" />
        </Link>
        <nav className="public-nav d-none d-lg-flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => clsx(isActive && 'active')}>
              {t(`public.${l.key}`, { defaultValue: l.key[0].toUpperCase() + l.key.slice(1) })}
            </NavLink>
          ))}
        </nav>
        <div className="public-header-actions">
          <button
            type="button"
            className="btn btn-sm btn-light d-flex align-items-center gap-1"
            onClick={() => i18n.changeLanguage(i18n.language === 'so' ? 'en' : 'so')}
          >
            <Languages size={14} />{i18n.language.toUpperCase()}
          </button>
          {isAuthenticated ? (
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => navigate(profile?.dashboardRoute || '/')}>
              {t('public.openDashboard', { defaultValue: 'Open dashboard' })} <ArrowRight size={14} />
            </button>
          ) : (
            <Link to="/login" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1">
              {t('common.login')} <ArrowRight size={14} />
            </Link>
          )}
          <button type="button" className="btn btn-sm btn-light d-lg-none" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="container pb-3 d-lg-none">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="d-block py-2 fw-semibold" onClick={() => setOpen(false)}>
              {t(`public.${l.key}`, { defaultValue: l.key[0].toUpperCase() + l.key.slice(1) })}
            </Link>
          ))}
          <Link to="/login" className="d-block py-2 text-brand fw-semibold" onClick={() => setOpen(false)}>
            {t('common.login')}
          </Link>
        </nav>
      )}
    </header>
  );
}

export default function PublicLayout() {
  const { t } = useTranslation();
  return (
    <div className="d-flex flex-column min-vh-100">
      <PublicHeader />
      <main className="flex-grow-1">
        <Outlet />
      </main>
      <footer className="public-footer">
        <div className="container py-5">
          <div className="row g-4">
            <div className="col-12 col-lg-4">
              <BrandLogo tile alt="E-MADAARIS logo" />
              <p className="small mt-3 mb-2" style={{ maxWidth: 320 }}>
                {t('brand.slogan')} — {t('brand.sloganEn')}
              </p>
              <div className="d-flex align-items-center gap-2 small">
                <ShieldCheck size={15} /> {t('home.tenantIsolated', { defaultValue: 'Tenant-isolated data' })}
              </div>
            </div>
            <div className="col-6 col-lg-2">
              <div className="footer-title">{t('public.product', { defaultValue: 'Product' })}</div>
              {['features', 'pricing', 'about', 'faq'].map((k) => (
                <Link key={k} to={`/${k}`} className="footer-link">
                  {t(`public.${k}`, { defaultValue: k[0].toUpperCase() + k.slice(1) })}
                </Link>
              ))}
            </div>
            <div className="col-6 col-lg-3">
              <div className="footer-title">{t('public.legal', { defaultValue: 'Legal & help' })}</div>
              <Link to="/contact" className="footer-link">{t('public.contact', { defaultValue: 'Contact' })}</Link>
              <Link to="/terms" className="footer-link">{t('public.terms', { defaultValue: 'Terms of service' })}</Link>
              <Link to="/privacy" className="footer-link">{t('public.privacy', { defaultValue: 'Privacy policy' })}</Link>
              <Link to="/verify" className="footer-link">{t('verify.title', { defaultValue: 'Verify a document' })}</Link>
            </div>
            <div className="col-12 col-lg-3">
              <div className="footer-title">{t('common.login', { defaultValue: 'Sign in' })}</div>
              <p className="small mb-3">
                {t('home.footerCta', { defaultValue: 'Bring every classroom, fee and result into one trusted system.' })}
              </p>
              <Link to="/login" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1">
                {t('common.login', { defaultValue: 'Sign in' })} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          <div className="footer-bottom mt-4 d-flex flex-wrap justify-content-between gap-2">
            <span>© {new Date().getFullYear()} JSOM TECH · E-MADAARIS</span>
            <span>{t('public.developedBy', { defaultValue: 'Developed by' })} JSOM TECH</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
