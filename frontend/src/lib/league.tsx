import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useAuth } from './auth';

type League = { id: string; name: string; admin_id: string; member_ids: string[]; code: string; transfer_window_open?: boolean } | null;

interface LeagueCtx {
  league: League;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LeagueCtx>({} as any);

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [league, setLeague] = useState<League>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setLeague(null); return; }
    setLoading(true);
    try {
      const leagues = await api.myLeagues();
      setLeague(leagues[0] || null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return <Ctx.Provider value={{ league, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useLeague = () => useContext(Ctx);
