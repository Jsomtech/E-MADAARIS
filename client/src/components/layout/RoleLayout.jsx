import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, ChevronDown, Languages, LogOut, Menu, Search, User, X,
} from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext.jsx';
import { ICONS, navigationFor, roleConfig } from '../../config/roles.jsx';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { humanize } from '../../config/resources.jsx';
import BrandLogo from '../brand/BrandLogo.jsx';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Dropdown({ trigger, children, buttonClassName = 'user-chip' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="position-relative" ref={ref}>
      <button type="button" className={buttonClassName} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className="dropdown-panel position-absolute end-0 mt-2" style={{ zIndex: 1090 }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data, loading } = useApi('/school/notifications', { limit: 8 }, true);
  useEffect(() => {
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const items = Array.isArray(data) ? data : [];
  const unread = items.filter((i) => !i.is_read).length;

  return (
    <div className="position-relative" ref={ref}>
      <button type="button" className="btn-icon position-relative" onClick={() => setOpen((o) => !o)} aria-label={t('common.notifications')}>
        <Bell size={17} />
        {unread > 0 && (
          <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
            style={{ fontSize: '.6rem', padding: '.25em .45em' }}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="dropdown-panel position-absolute end-0 mt-2" style={{ width: 340, zIndex: 1090 }}>
          <div className="d-flex justify-content-between align-items-center px-2 pt-1 pb-2">
            <strong className="small">{t('common.notifications')}</strong>
            <button type="button" className="btn btn-sm btn-link p-0 text-decoration-none small"
              onClick={() => { apiPost('/school/notifications/read-all', {}); setOpen(false); }}>
              {t('notifications.markAllRead', { defaultValue: 'Mark all as read' })}
            </button>
          </div>
          {loading && <div className="small text-muted px-2 pb-2">{t('common.loading')}</div>}
          {!loading && !items.length && <div className="small text-muted px-2 pb-2">{t('common.none')}</div>}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {items.slice(0, 8).map((n) => (
              <div key={n.id} className="p-2 rounded-3 mb-1" style={{ background: n.is_read ? 'transparent' : 'var(--brand-wash)' }}>
                <div className="small fw-semibold">{n.title}</div>
                {n.body && <div className="small text-muted">{String(n.body).slice(0, 120)}</div>}
              </div>
            ))}
          </div>
          <Link to="/notifications" className="d-block text-center small mt-1 pb-1">{t('common.viewAll')}</Link>
        </div>
      )}
    </div>
  );
}

function Sidebar({ groups, config, open, onNavigate }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  return (
    <aside className={clsx('app-sidebar', open && 'show')}>
      <div className="brand">
        <BrandLogo school={profile?.school} tile />
        <div className="min-width-0">
          <strong className="text-truncate d-block">{profile?.school?.school_name || 'E-MADAARIS'}</strong>
          <div className="role-label">{config.label}</div>
        </div>
      </div>
      {profile?.school && (
        <div className="sidebar-tenant">
          <div className="tenant-name text-truncate">{profile.school.school_name}</div>
          {profile.subscription?.plan && (
            <span className="plan-pill">{profile.subscription.plan.name} · {humanize(profile.subscription.status)}</span>
          )}
        </div>
      )}
      <nav>
        {groups.map((group) => (
          <div className="app-nav-group" key={group.title}>
            <span>{t(group.title, { defaultValue: group.title })}</span>
            {group.items.map((item) => {
              const Icon = ICONS[item.icon] || ICONS.dashboard;
              return (
                <NavLink key={item.to} to={item.to} end={item.to === config.home}
                  className={({ isActive }) => clsx('app-nav-link', isActive && 'active')}
                  onClick={onNavigate}>
                  <Icon size={16} />
                  {t(`modules.${item.key}`, { defaultValue: humanize(item.key) })}
                </NavLink>
              );
            })}
          </div>
        ))}
        <div className="app-nav-group" style={{ marginBottom: 0 }}>
          <span>{t('nav.account', { defaultValue: 'Account' })}</span>
          <NavLink to="/account" className="app-nav-link" onClick={onNavigate}><User size={16} /> {t('common.account')}</NavLink>
          <NavLink to="/notifications" className="app-nav-link" onClick={onNavigate}><Bell size={16} /> {t('common.notifications')}</NavLink>
        </div>
      </nav>
      <div className="sidebar-footer">
        <Link to="/account" className="sidebar-user" onClick={onNavigate}>
          <span className="avatar">{initials(profile?.fullName)}</span>
          <span className="min-width-0 flex-grow-1">
            <span className="d-block text-truncate" style={{ fontSize: '.8rem', fontWeight: 600 }}>{profile?.fullName}</span>
            <span className="d-block small text-truncate">{profile?.email}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

export default function RoleLayout() {
  const { t, i18n } = useTranslation();
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');

  const config = roleConfig(profile?.primaryRole);
  const { groups } = navigationFor(profile);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Background pushes are shown by the service worker; while the tab is focused
  // FCM delivers to the page instead, so surface those as a toast.
  useEffect(() => {
    let unlisten;
    let alive = true;
    import('../../services/push.js')
      .then(async (service) => {
        if (!alive || !service.isPushConfigured) return;
        unlisten = await service.listenForForegroundMessages((payload) => {
          const notification = payload?.notification || {};
          const title = notification.title || payload?.data?.title;
          if (!title) return;
          toast.info(notification.body ? `${title} — ${notification.body}` : title);
        });
      })
      .catch(() => {});
    return () => { alive = false; if (typeof unlisten === 'function') unlisten(); };
  }, []);

  const signOut = async () => { await logout(); navigate('/login'); };
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'so' ? 'en' : 'so');

  const homeItem = groups.flatMap((g) => g.items).find((i) => i.to === config.home);
  const current = groups.flatMap((g) => g.items)
    .find((i) => location.pathname.startsWith(i.to));
  const pageKey = (current || homeItem || {}).key || 'dashboard';

  return (
    <div className="app-shell">
      <Sidebar groups={groups} config={config} open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && (
        <div className="d-lg-none position-fixed top-0 start-0 w-100 h-100" style={{ background: 'rgba(19,12,45,.45)', zIndex: 1040 }}
          onClick={() => setMobileOpen(false)} />
      )}

      <div className="app-main">
        <header className="app-topbar">
          <button type="button" className="btn-icon d-lg-none" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">
            {mobileOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
          <BrandLogo school={profile?.school} tile className="d-lg-none" />
          <div className="flex-grow-1 min-width-0">
            <div className="topbar-title text-truncate">{t(`modules.${pageKey}`, { defaultValue: humanize(pageKey) })}</div>
            <div className="topbar-sub text-truncate">{profile?.school?.school_name || profile?.email}</div>
          </div>
          <form className="topbar-search d-none d-md-block"
            onSubmit={(e) => { e.preventDefault(); if (query.trim()) navigate(`/m/students?q=${encodeURIComponent(query.trim())}`); }}>
            <div className="input-group input-group-sm">
              <span className="input-group-text" style={{ background: '#f7f7fc', borderColor: 'var(--line)' }}><Search size={14} /></span>
              <input className="form-control" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </form>
          <NotificationBell />
          <button type="button" className="lang-btn" onClick={toggleLang} title={t('common.language')}>
            <Languages size={15} />{i18n.language.toUpperCase()}
          </button>
          <Dropdown trigger={(
            <>
              <span className="avatar" style={{ width: 30, height: 30, flexBasis: 30, fontSize: '.7rem' }}>{initials(profile?.fullName)}</span>
              <span className="user-name d-none d-md-inline text-truncate">{profile?.fullName}</span>
              <ChevronDown size={14} className="text-muted" />
            </>
          )}>
            <div className="dropdown-header-block">
              <div className="fw-semibold text-truncate" style={{ fontSize: '.85rem' }}>{profile?.fullName}</div>
              <div className="small text-muted text-truncate">{profile?.email}</div>
            </div>
            <Link className="dropdown-item" to="/account"><User size={15} /> {t('common.account')}</Link>
            <Link className="dropdown-item" to="/notifications"><Bell size={15} /> {t('common.notifications')}</Link>
            <button type="button" className="dropdown-item text-danger border-0 bg-transparent w-100 text-start" onClick={signOut}>
              <LogOut size={15} /> {t('common.logout')}
            </button>
          </Dropdown>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
