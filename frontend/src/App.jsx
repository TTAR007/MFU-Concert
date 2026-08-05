// src/App.jsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from './lib/supabaseClient';
import SeatMap from './components/SeatMap';
import MyBookings from './components/MyBookings';
import AdminView from './components/AdminView';
import CheckIn from './components/CheckIn';
import './theme.css';

const SHOW_ID = 'e8a7a715-c26a-4e05-8250-5c6ee79922df';
const EVENT_NAME = 'MFU Concert 2026';

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

export default function App() {
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

  if (loading) return <div className="app-shell"><p>Loading...</p></div>;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {session ? (
        <>
          <div className="top-bar">
            <div className="top-bar-row">
              <h1 className="event-title">{EVENT_NAME}</h1>
              <div className="top-bar-controls">
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
                        Sign out
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

          <nav className={`tab-nav ${menuOpen ? 'tab-nav-open' : ''}`} aria-label="Main navigation">
            <div className="profile-mobile-block show-mobile-only">
              <Avatar email={session.user.email} />
              <span className="profile-mobile-email">{session.user.email}</span>
            </div>
            <button
              className={`tab-btn ${view === 'seats' ? 'active' : ''}`}
              onClick={() => { setView('seats'); setMenuOpen(false); }}
              aria-current={view === 'seats' ? 'page' : undefined}
            >
              Seat Map
            </button>
            <button
              className={`tab-btn ${view === 'bookings' ? 'active' : ''}`}
              onClick={() => { setView('bookings'); setMenuOpen(false); }}
              aria-current={view === 'bookings' ? 'page' : undefined}
            >
              My Bookings
            </button>
            {profile?.is_admin && (
              <button
                className={`tab-btn ${view === 'admin' ? 'active' : ''}`}
                onClick={() => { setView('admin'); setMenuOpen(false); }}
                aria-current={view === 'admin' ? 'page' : undefined}
              >
                Admin
              </button>
            )}
            {profile?.is_admin && (
              <button
                className={`tab-btn ${view === 'checkin' ? 'active' : ''}`}
                onClick={() => { setView('checkin'); setMenuOpen(false); }}
                aria-current={view === 'checkin' ? 'page' : undefined}
              >
                Check-in
              </button>
            )}
            <button
              className="tab-btn show-mobile-only"
              onClick={() => { setMenuOpen(false); supabase.auth.signOut(); }}
            >
              Sign out
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
        <AuthForm eventName={EVENT_NAME} />
      )}
    </div>
  );
}

function AuthForm({ eventName }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) setError(error.message);
  }

  return (
    <div className="auth-wrap">
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 4 }}>{eventName}</p>
      <h2>{mode === 'login' ? 'Log in' : 'Sign up'}</h2>
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <div className="field">
          <label htmlFor="auth-email" className="field-label">Email</label>
          <input
            id="auth-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label htmlFor="auth-password" className="field-label">Password</label>
          <input
            id="auth-password"
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          {mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-switch">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button
          className="btn-text"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </div>
  );
}