import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, ChevronDown, Download, Languages, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, User, WifiOff, X,
} from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext.jsx';
import { ICONS, navigationFor, roleConfig } from '../../config/roles.jsx';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useNotificationStream } from '../../hooks/useNotificationStream.js';
import { humanize } from '../../config/resources.jsx';
import BrandLogo from '../brand/BrandLogo.jsx';
import { isRunningStandalone, promptInstall, watchInstallable, watchOnline } from '../../services/pwa.js';
import AcknowledgmentGate from '../notifications/AcknowledgmentGate.jsx';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const COLLAPSE_KEY = 'emadaaris.sidebarCollapsed';

/** Desktop rail preference; stored as a plain string so an unparseable value is simply "expanded". */
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
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
  const navigate = useNavigate();
  const { data, loading, refetch, unread: unreadTotal } = useApi('/school/notifications', { limit: 8 }, true);
  const refreshTimer = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  // A push that lands while the tab is open has already been written to the inbox, so the badge can
  // catch up instead of waiting for the next page load.
  useEffect(() => {
    const onPush = () => refetch();
    window.addEventListener('emadaaris:push', onPush);
    return () => window.removeEventListener('emadaaris:push', onPush);
  }, [refetch]);
  // The live feed says the same thing sooner and on any browser, including one where push was declined.
  // A broadcast writes hundreds of rows at once, so a burst of events is coalesced into one refresh.
  const { live } = useNotificationStream(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refetch, 400);
  });
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const items = Array.isArray(data) ? data : [];
  // The dropdown shows eight, the badge counts everything waiting.
  const unread = unreadTotal ?? items.filter((i) => !i.is_read).length;

  const openItem = (event, n) => {
    event.preventDefault();
    if (!n.is_read) apiPost(`/school/notifications/${n.id}/read`, {}).then(refetch).catch(() => {});
    setOpen(false);
    navigate(n.link || '/notifications');
  };

  return (
    <div className="position-relative" ref={ref}>
      <button type="button" className="btn-icon position-relative" onClick={() => setOpen((o) => !o)} aria-label={t('common.notifications')}>
        <Bell size={17} />
        {live && (
          <span className="bell-live" title={t('notifications.liveFeed', { defaultValue: 'Updates itself — no refresh needed' })} aria-hidden="true" />
        )}
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
              <button type="button" key={n.id} onClick={(e) => openItem(e, n)}
                className={clsx('notification-row w-100 text-start border-0 p-2 rounded-3 mb-1', !n.is_read && 'is-unread')}>
                <div className="small fw-semibold">{n.title}</div>
                {n.body && <div className="small text-muted">{String(n.body).slice(0, 120)}</div>}
              </button>
            ))}
          </div>
          <Link to="/notifications" className="d-block text-center small mt-1 pb-1">{t('common.viewAll')}</Link>
        </div>
      )}
    </div>
  );
}

function Sidebar({ groups, config, open, collapsed, onToggleCollapse, onNavigate }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const label = (item) => t(`modules.${item.key}`, { defaultValue: humanize(item.key) });
  return (
    <aside className={clsx('app-sidebar', open && 'show', collapsed && 'collapsed')}>
      <div className="brand">
        <BrandLogo school={profile?.school} tile />
        <div className="min-width-0">
          <strong className="text-truncate d-block">{profile?.school?.school_name || 'E-MADAARIS'}</strong>
          <div className="role-label">{config.label}</div>
        </div>
        <button type="button" className="sidebar-toggle d-none d-lg-grid" onClick={onToggleCollapse}
          aria-label={collapsed ? t('common.expandMenu', { defaultValue: 'Expand menu' }) : t('common.collapseMenu', { defaultValue: 'Collapse menu' })}
          title={collapsed ? t('common.expandMenu', { defaultValue: 'Expand menu' }) : t('common.collapseMenu', { defaultValue: 'Collapse menu' })}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
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
              const name = label(item);
              return (
                <NavLink key={item.to} to={item.to} end={item.to === config.home} title={name}
                  className={({ isActive }) => clsx('app-nav-link', isActive && 'active')}
                  onClick={onNavigate}>
                  <Icon size={16} />
                  <span className="text-truncate">{name}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
        <div className="app-nav-group" style={{ marginBottom: 0 }}>
          <span>{t('nav.account', { defaultValue: 'Account' })}</span>
          <NavLink to="/account" className="app-nav-link" title={t('common.account')} onClick={onNavigate}><User size={16} /> <span>{t('common.account')}</span></NavLink>
          <NavLink to="/notifications" className="app-nav-link" title={t('common.notifications')} onClick={onNavigate}><Bell size={16} /> <span>{t('common.notifications')}</span></NavLink>
        </div>
      </nav>
      <div className="sidebar-footer">
        <Link to="/account" className="sidebar-user" title={profile?.fullName} onClick={onNavigate}>
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [query, setQuery] = useState('');
  const [installable, setInstallable] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    if (isRunningStandalone()) return undefined;
    return watchInstallable(setInstallable);
  }, []);

  useEffect(() => watchOnline(setOnline), []);

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast.success(t('pwa.installing', { defaultValue: 'E-MADAARIS is being added to this device' }));
    }
  };

  const toggleCollapsed = () => setCollapsed((prev) => {
    const next = !prev;
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private browsing: the rail just resets */ }
    return next;
  });

  const config = roleConfig(profile?.primaryRole);
  const { groups } = navigationFor(profile);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Background pushes are shown by the service worker; while the tab is focused
  // FCM delivers to the page instead, so surface those as a toast the user can click through.
  useEffect(() => {
    let unlisten;
    let alive = true;
    import('../../services/push.js')
      .then(async (service) => {
        if (!alive || !service.isPushConfigured) return;
        unlisten = await service.listenForForegroundMessages((payload) => {
          const notification = payload?.notification || {};
          const data = payload?.data || {};
          const title = notification.title || data.title;
          if (!title) return;
          const body = notification.body || data.body || '';
          window.dispatchEvent(new Event('emadaaris:push'));
          toast.info(body ? `${title} — ${body}` : title, {
            onClick: () => navigate(data.url || data.link || '/notifications'),
          });
        });
      })
      .catch(() => {});
    return () => { alive = false; if (typeof unlisten === 'function') unlisten(); };
  }, [navigate]);

  // The worker cannot mint a replacement subscription or refresh the page's own state on its own, so it
  // talks through postMessage. Web Push has no foreground delivery path of its own — this is it.
  useEffect(() => {
    const onWorkerMessage = (event) => {
      const type = event.data?.type;
      if (type === 'emadaaris:push-received') {
        window.dispatchEvent(new Event('emadaaris:push'));
        return;
      }
      if (type === 'emadaaris:push-subscription-changed') {
        import('../../services/push.js').then((service) => service.renewPushSubscription()).catch(() => {});
      }
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
  }, []);

  const signOut = async () => { await logout(); navigate('/login'); };
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'so' ? 'en' : 'so');

  const homeItem = groups.flatMap((g) => g.items).find((i) => i.to === config.home);
  const current = groups.flatMap((g) => g.items)
    .find((i) => location.pathname.startsWith(i.to));
  const pageKey = (current || homeItem || {}).key || 'dashboard';

  return (
    <div className="app-shell">
      <Sidebar groups={groups} config={config} open={mobileOpen} collapsed={collapsed}
        onToggleCollapse={toggleCollapsed} onNavigate={() => setMobileOpen(false)} />
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
          {!online && (
            <span className="badge text-bg-warning align-self-center d-inline-flex align-items-center gap-1"
              title={t('pwa.offlineHint', { defaultValue: 'No connection. The pages you opened are still available; saved data needs the network.' })}>
              <WifiOff size={12} /> <span className="d-none d-md-inline">{t('pwa.offline', { defaultValue: 'Offline' })}</span>
            </span>
          )}
          {installable && (
            <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={install}
              title={t('pwa.installHint', { defaultValue: 'Put E-MADAARIS on this device and open it in its own window' })}>
              <Download size={14} /> <span className="d-none d-lg-inline">{t('pwa.install', { defaultValue: 'Install app' })}</span>
            </button>
          )}
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
          <AcknowledgmentGate />
        </main>
      </div>
    </div>
  );
}
