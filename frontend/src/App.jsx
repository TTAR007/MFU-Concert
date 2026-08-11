// src/App.jsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from './lib/supabaseClient';
import SeatMap from './components/SeatMap';
import MyBookings from './components/MyBookings';
import AdminView from './components/AdminView';
import CheckIn from './components/CheckIn';
import { LanguageProvider } from './LanguageProvider';
import { useLanguage } from './i18n';
import './theme.css';

const SHOW_ID = 'e8a7a715-c26a-4e05-8250-5c6ee79922df';
const EVENT_NAME = 'MFU Band Concert 2026';

const AVATAR_COLORS = ['#6366f1', '#22c55e', '#f5a623', '#ef4444', '#06b6d4', '#a855f7'];

function getInitials(email) {
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function getAvatarColor(email) {
  if (!email) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ email }) {
  return (
    <div
      className="avatar"
      style={{ background: getAvatarColor(email) }}
      title={email}
      aria-label={email}
      role="img"
    >
      {getInitials(email)}
    </div>
  );
}

function ThaiFlag() {
  return (
    <svg viewBox="0 0 30 20" width="30" height="20" aria-hidden="true">
      <rect width="30" height="20" fill="#A51931" />
      <rect y="3.33" width="30" height="13.33" fill="#F4F5F8" />
      <rect y="6.67" width="30" height="6.67" fill="#2D2A4A" />
    </svg>
  );
}

function UKFlag() {
  return (
    <svg viewBox="0 0 30 20" width="30" height="20" aria-hidden="true">
      <rect width="30" height="20" fill="#00247D" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#ffffff" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#CF142B" strokeWidth="1.5" />
      <path d="M15,0 V20 M0,10 H30" stroke="#ffffff" strokeWidth="6" />
      <path d="M15,0 V20 M0,10 H30" stroke="#CF142B" strokeWidth="3" />
    </svg>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  const switchingToThai = lang === 'en';

  return (
    <button
      className="lang-toggle"
      onClick={() => setLang(switchingToThai ? 'th' : 'en')}
      aria-label={switchingToThai ? 'Switch to Thai' : 'Switch to English'}
    >
      <span className="lang-toggle-flag">
        {switchingToThai ? <ThaiFlag /> : <UKFlag />}
        <span className="lang-toggle-switch-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </span>
      </span>
      <span className="lang-toggle-abbr">{switchingToThai ? 'TH' : 'EN'}</span>
    </button>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}

function AppInner() {
  const { t } = useLanguage();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('seats'); // 'seats' | 'bookings' | 'admin' | 'checkin'
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileWrapRef = useRef(null);

  useEffect(() => {
    if (!profileMenuOpen) return;

    function handleClickOutside(e) {
      if (profileWrapRef.current && !profileWrapRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleEscape(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) { setView('seats'); setMenuOpen(false); setProfileMenuOpen(false); }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  if (loading) return <div className="app-shell"><p>{t('loading')}</p></div>;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {session ? (
        <>
          <div className="top-bar">
            <div className="top-bar-row">
              <h1 className="event-title">{EVENT_NAME}</h1>
              <div className="top-bar-controls">
                <LanguageToggle />
                <div className="profile-wrap show-desktop-only" ref={profileWrapRef}>
                  <button
                    className="avatar-trigger"
                    onClick={() => setProfileMenuOpen(prev => !prev)}
                    aria-haspopup="true"
                    aria-expanded={profileMenuOpen}
                    aria-label="Account menu"
                  >
                    <Avatar email={session.user.email} />
                  </button>
                  {profileMenuOpen && (
                    <div className="profile-dropdown">
                      <p className="profile-dropdown-email">{session.user.email}</p>
                      <button
                        className="btn"
                        style={{ width: '100%' }}
                        onClick={() => { setProfileMenuOpen(false); supabase.auth.signOut(); }}
                      >
                        {t('signOut')}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="menu-toggle"
                  onClick={() => setMenuOpen(prev => !prev)}
                  aria-label="Toggle menu"
                  aria-expanded={menuOpen}
                >
                  <span className="menu-icon" />
                </button>
              </div>
            </div>
          </div>

          <div
            className={`nav-sidebar-backdrop show-mobile-only ${menuOpen ? 'nav-sidebar-backdrop-open' : ''}`}
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          <nav
            className={`tab-nav ${menuOpen ? 'tab-nav-open' : ''}`}
            aria-label="Main navigation"
            role="dialog"
            aria-modal="true"
          >
            <button
              className="ticket-modal-close show-mobile-only"
              onClick={() => setMenuOpen(false)}
              aria-label={t('closeMenu')}
            >
              ✕
            </button>
            <div className="profile-mobile-block show-mobile-only">
              <Avatar email={session.user.email} />
              <span className="profile-mobile-email">{session.user.email}</span>
            </div>
            <button
              className={`tab-btn ${view === 'seats' ? 'active' : ''}`}
              onClick={() => { setView('seats'); setMenuOpen(false); }}
              aria-current={view === 'seats' ? 'page' : undefined}
            >
              {t('seatMap')}
            </button>
            <button
              className={`tab-btn ${view === 'bookings' ? 'active' : ''}`}
              onClick={() => { setView('bookings'); setMenuOpen(false); }}
              aria-current={view === 'bookings' ? 'page' : undefined}
            >
              {t('myBookings')}
            </button>
            {profile?.is_admin && (
              <button
                className={`tab-btn ${view === 'admin' ? 'active' : ''}`}
                onClick={() => { setView('admin'); setMenuOpen(false); }}
                aria-current={view === 'admin' ? 'page' : undefined}
              >
                {t('admin')}
              </button>
            )}
            {profile?.is_admin && (
              <button
                className={`tab-btn ${view === 'checkin' ? 'active' : ''}`}
                onClick={() => { setView('checkin'); setMenuOpen(false); }}
                aria-current={view === 'checkin' ? 'page' : undefined}
              >
                {t('checkIn')}
              </button>
            )}
            <button
              className="tab-btn show-mobile-only"
              onClick={() => { setMenuOpen(false); supabase.auth.signOut(); }}
            >
              {t('signOut')}
            </button>
          </nav>

          <main id="main-content">
            {view === 'seats' && <SeatMap showId={SHOW_ID} userId={session.user.id} />}
            {view === 'bookings' && <MyBookings showId={SHOW_ID} userId={session.user.id} />}
            {view === 'admin' && profile?.is_admin && (
              <AdminView showId={SHOW_ID} adminId={session.user.id} />
            )}
            {view === 'checkin' && profile?.is_admin && (
              <CheckIn showId={SHOW_ID} adminId={session.user.id} />
            )}
          </main>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
            <LanguageToggle />
          </div>
          <AuthForm eventName={EVENT_NAME} />
        </>
      )}
    </div>
  );
}

function AuthForm({ eventName }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSignupSuccess(false);

    if (mode === 'signup' && password !== confirmPassword) {
      setError(t('passwordsNoMatch'));
      return;
    }

    setSubmitting(true);

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setSubmitting(false);
      if (error) setError(error.message);
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }

    // If a session comes back immediately, email confirmation is off and they're logged in already.
    // Otherwise, confirmation is required — tell them what to do next.
    if (!data.session) {
      setSignupSuccess(true);
      setPassword('');
      setConfirmPassword('');
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // On success this redirects away, so no need to reset googleSubmitting there.
    if (error) {
      setGoogleSubmitting(false);
      setError(error.message);
    }
  }

  // If the browser restores this page from bfcache (e.g. user clicked Back after
  // being redirected to Google's login), reset any "in progress" state — otherwise
  // it stays stuck showing "Connecting…" since the page never actually reloaded.
  useEffect(() => {
    function handlePageShow(e) {
      if (e.persisted) {
        setSubmitting(false);
        setGoogleSubmitting(false);
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const busy = submitting || googleSubmitting;

  return (
    <div className="auth-wrap">
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 4 }}>{eventName}</p>
      <h2>{mode === 'login' ? t('logIn') : t('signUp')}</h2>

      <button className="btn google-signin-btn" onClick={handleGoogleSignIn} type="button" disabled={busy}>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {googleSubmitting ? t('connecting') : t('continueWithGoogle')}
      </button>

      <div className="auth-divider"><span>{t('or')}</span></div>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <div className="field">
          <label htmlFor="auth-email" className="field-label">{t('email')}</label>
          <input
            id="auth-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="auth-password" className="field-label">{t('password')}</label>
          <input
            id="auth-password"
            type="password"
            placeholder={t('passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={busy}
          />
        </div>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="auth-confirm-password" className="field-label">{t('confirmPassword')}</label>
            <input
              id="auth-confirm-password"
              type="password"
              placeholder={t('reenterPassword')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={busy}
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitting ? (mode === 'login' ? t('loggingIn') : t('signingUp')) : (mode === 'login' ? t('logIn') : t('signUp'))}
        </button>
      </form>
      {signupSuccess && (
        <p className="auth-success" role="status">
          {t('accountCreated')} <strong>{email}</strong> {t('forConfirmation')} <strong>{t('spamFolder')}</strong> {t('tooThenLogIn')}
        </p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-switch">
        {mode === 'login' ? t('noAccount') : t('haveAccount')}
        <button
          className="btn-text"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setConfirmPassword('');
            setError(null);
            setSignupSuccess(false);
          }}
        >
          {mode === 'login' ? t('signUp') : t('logIn')}
        </button>
      </p>
    </div>
  );
}