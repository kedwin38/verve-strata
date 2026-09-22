import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Link, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { api, type Me } from './api.js';
import Landing from './pages/Landing.js';
import Auth from './pages/Auth.js';
import Dashboard from './pages/Dashboard.js';
import Report from './pages/Report.js';
import FindingPage from './pages/Finding.js';
import Sentinel from './pages/Sentinel.js';
import Settings from './pages/Settings.js';

const AuthCtx = createContext<{
  me: Me | null;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}>({ me: null, reload: async () => {}, logout: async () => {} });

export const useAuth = () => useContext(AuthCtx);

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Verve Strata">
      <rect x="6" y="6" width="20" height="3.4" rx="1" fill="#33414c" />
      <rect x="6" y="11.3" width="20" height="3.4" rx="1" fill="#56c8d8" />
      <rect x="6" y="16.6" width="20" height="3.4" rx="1" fill="#e2b04a" />
      <rect x="6" y="21.9" width="20" height="3.4" rx="1" fill="#33414c" />
    </svg>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [booted, setBooted] = useState(false);

  const reload = async () => {
    try { setMe(await api.get<Me>('/auth/me')); }
    catch { setMe(null); }
    setBooted(true);
  };

  useEffect(() => { void reload(); }, []);

  const logout = async () => {
    await api.post('/auth/logout');
    setMe(null);
  };

  return (
    <AuthCtx.Provider value={{ me, reload, logout }}>
      {!booted ? null : (
        <Routes>
          <Route path="/" element={me ? <Navigate to="/app" replace /> : <Landing />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/register" element={<Auth mode="register" />} />
          <Route path="/app/*" element={me ? <AppShell /> : <Navigate to="/login" replace />} />
        </Routes>
      )}
    </AuthCtx.Provider>
  );
}

function AppShell() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div>
      <nav className="nav">
        <div className="shell nav-inner">
          <Link to="/app" className="nav-brand">
            <Logo />
            <span className="wordmark">VERVE <em>STRATA</em></span>
          </Link>
          <div className="nav-links">
            <NavLink to="/app" end className={({ isActive }) => isActive ? 'active' : ''}>Cores</NavLink>
            <NavLink to="/app/sentinel" className={({ isActive }) => isActive ? 'active' : ''}>Sentinel</NavLink>
            <NavLink to="/app/settings" className={({ isActive }) => isActive ? 'active' : ''}>Settings</NavLink>
          </div>
          <div className="nav-spacer" />
          <span className="faint small mono">{me?.user.email}</span>
          <button className="btn" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
        </div>
      </nav>
      <main className="shell page">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="a/:id" element={<Report />} />
          <Route path="a/:id/f/:findingId" element={<FindingPage />} />
          <Route path="sentinel" element={<Sentinel />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
