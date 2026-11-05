import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, loadApiConfig, setToken } from './api';
import { disablePush } from './push';
import { storage } from './storage';
import type { Business } from './types';

interface AuthState {
  ready: boolean;
  business: Business | null;
  login(email: string, password: string): Promise<void>;
  signup(businessName: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  setBusiness(b: Business): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [business, setBusinessState] = useState<Business | null>(null);
  // The sign-in screen greets staff with their studio's name.
  const setBusiness = useCallback((b: Business | null) => {
    setBusinessState(b);
    if (b) storage.set('studioName', b.name).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const { token } = await loadApiConfig();
      if (token) {
        try {
          const res = await api<{ business: Business }>('/api/me');
          setBusiness(res.business);
        } catch (e: any) {
          if (e.status === 401) await setToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const finish = useCallback(async (res: { business: Business; token: string }) => {
    await setToken(res.token);
    setBusiness(res.business);
  }, [setBusiness]);

  const value = useMemo<AuthState>(() => ({
    ready,
    business,
    setBusiness,
    login: async (email, password) => finish(await api('/api/auth/login', { method: 'POST', body: { email, password } })),
    signup: async (businessName, email, password) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await finish(await api('/api/auth/signup', { method: 'POST', body: { businessName, email, password, timezone } }));
    },
    logout: async () => {
      await disablePush();
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already logged out */ }
      await setToken(null);
      setBusiness(null);
    },
  }), [ready, business, finish]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
