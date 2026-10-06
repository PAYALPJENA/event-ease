import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import type { CurrentUser, Role } from '../types/event';

interface AuthContextValue {
  user: CurrentUser | null;
  /** True until the first /auth/me check finishes. */
  loading: boolean;
  hasRole: (role: Role) => boolean;
  isStaff: boolean;
  /** Development sign-in only; the university SSO replaces it. */
  devSignIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ user: CurrentUser | null }>('/auth/me')
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const devSignIn = useCallback(async (userId: string) => {
    const { user } = await api<{ user: CurrentUser }>('/auth/dev-login', { method: 'POST', body: { userId } });
    setUser(user);
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    // Forget passes cached for offline use on this device.
    navigator.serviceWorker?.controller?.postMessage('clear-private');
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const hasRole = (role: Role) => !!user?.roles.includes(role);
    return { user, loading, hasRole, isStaff: hasRole('admin') || hasRole('organizer'), devSignIn, signOut };
  }, [user, loading, devSignIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
