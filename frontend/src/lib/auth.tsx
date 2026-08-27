import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { getToken, setToken, getUser, setUser } from './storage';

type User = { id: string; email: string; name: string } | null;

interface AuthCtx {
  user: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: import('./api').RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  hydrateFromToken: (accessToken: string, user: any) => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const tok = await getToken();
      if (tok) {
        const cached = await getUser<User>();
        if (cached) setUserState(cached);
        try {
          const me = await api.me();
          setUserState(me);
          await setUser(me);
        } catch {
          await setToken(null);
          await setUser(null);
          setUserState(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    await setToken(res.access_token);
    await setUser(res.user);
    setUserState(res.user);
  }, []);

  const register = useCallback(async (payload: import('./api').RegisterPayload) => {
    const res = await api.register(payload);
    await setToken(res.access_token);
    await setUser(res.user);
    setUserState(res.user);
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    await setUser(null);
    setUserState(null);
  }, []);

  const hydrateFromToken = useCallback(async (accessToken: string, u: any) => {
    await setToken(accessToken);
    await setUser(u);
    setUserState(u);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, register, logout, hydrateFromToken }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
