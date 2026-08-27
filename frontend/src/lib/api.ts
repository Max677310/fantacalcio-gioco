import { getToken } from './storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export type ApiError = { detail: string };

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as any),
  };
  if (auth) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Errore ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export type RegisterPayload = {
  email: string;
  password: string;
  name: string;
  action?: 'create' | 'join' | 'none';
  team_name?: string;
  invite_code?: string;
  league_name?: string;
  mode?: 'asta' | 'listino';
  start_matchday?: number;
};

export const api = {
  register: (payload: RegisterPayload) =>
    request<any>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }, false),
  login: (email: string, password: string) =>
    request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),
  me: () => request<any>('/auth/me'),
  myLeagues: () => request<any[]>('/leagues/mine'),
  createLeague: (name: string, team_name: string, mode: 'asta' | 'listino' = 'asta', start_matchday: number = 1) =>
    request<any>('/leagues/create', { method: 'POST', body: JSON.stringify({ name, team_name, mode, start_matchday }) }),
  updateLeagueSettings: (leagueId: string, body: { start_matchday?: number; name?: string }) =>
    request<any>(`/leagues/${leagueId}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  kickoffLock: (leagueId: string) =>
    request<any>(`/leagues/${leagueId}/kickoff/lock`, { method: 'POST' }),
  kickoffUnlock: (leagueId: string) =>
    request<any>(`/leagues/${leagueId}/kickoff/unlock`, { method: 'POST' }),
  joinLeague: (code: string, team_name: string) =>
    request<any>('/leagues/join', { method: 'POST', body: JSON.stringify({ code, team_name }) }),
  leagueMembers: (leagueId: string) => request<any[]>(`/leagues/${leagueId}/members`),
  myMembership: (leagueId: string) => request<any>(`/leagues/${leagueId}/my-membership`),
  wallet: (leagueId: string) => request<any>(`/leagues/${leagueId}/wallet`),
  wallets: (leagueId: string) => request<any[]>(`/leagues/${leagueId}/wallets`),
  roster: (leagueId: string, userId: string) => request<any>(`/leagues/${leagueId}/roster/${userId}`),
  fixtures: (leagueId: string, matchday?: number) => {
    const qs = matchday !== undefined ? `?matchday=${matchday}` : '';
    return request<any[]>(`/leagues/${leagueId}/fixtures${qs}`);
  },
  mercatoOpen: (leagueId: string) =>
    request<any>(`/leagues/${leagueId}/mercato/open`, { method: 'POST' }),
  mercatoClose: (leagueId: string) =>
    request<any>(`/leagues/${leagueId}/mercato/close`, { method: 'POST' }),
  releasePlayer: (leagueId: string, playerId: string) =>
    request<any>(`/leagues/${leagueId}/mercato/release`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),
  buyFreeAgent: (leagueId: string, playerId: string) =>
    request<any>(`/leagues/${leagueId}/mercato/buy`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),
  freeAgents: (leagueId: string, role?: string) => {
    const qs = role ? `?role=${role}` : '';
    return request<any[]>(`/leagues/${leagueId}/free-agents${qs}`);
  },
  liveEvents: (matchday?: number) => {
    const qs = matchday !== undefined ? `?matchday=${matchday}` : '';
    return request<any[]>(`/live-events${qs}`);
  },
  assignBid: (leagueId: string) =>
    request<any>(`/auction/${leagueId}/assign`, { method: 'POST' }),
  dashboard: (leagueId: string) => request<any>(`/dashboard/${leagueId}`),
  activity: (leagueId: string) => request<any[]>(`/activity/${leagueId}`),
  standings: (leagueId: string) => request<any[]>(`/standings/${leagueId}`),
  players: (role?: string, q?: string) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (q) params.set('q', q);
    const qs = params.toString();
    return request<any[]>(`/players${qs ? '?' + qs : ''}`);
  },
  player: (id: string) => request<any>(`/players/${id}`),
  auctionState: (leagueId: string) => request<any>(`/auction/${leagueId}/state`),
  auctionBids: (leagueId: string) => request<any[]>(`/auction/${leagueId}/bids`),
  placeBid: (leagueId: string, amount: number) =>
    request<any>(`/auction/${leagueId}/bid`, { method: 'POST', body: JSON.stringify({ amount }) }),
  passBid: (leagueId: string) =>
    request<any>(`/auction/${leagueId}/pass`, { method: 'POST' }),
  nextPlayer: (leagueId: string, playerId: string) =>
    request<any>(`/auction/${leagueId}/next`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),
  regulations: (leagueId: string) => request<any>(`/regulations/${leagueId}`),
  updateRegulations: (leagueId: string, body: any) =>
    request<any>(`/regulations/${leagueId}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Matchday scoring engine
  matchdayStatus: (leagueId: string, matchday: number) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/status`),
  matchdayRatings: (leagueId: string, matchday: number) =>
    request<any[]>(`/leagues/${leagueId}/matchday/${matchday}/ratings`),
  generateMockRatings: (leagueId: string, matchday: number, chaos: number = 0.5) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/ratings/mock`, {
      method: 'POST', body: JSON.stringify({ chaos }),
    }),
  uploadRatingsManual: (leagueId: string, matchday: number, ratings: any[]) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/ratings/manual`, {
      method: 'POST', body: JSON.stringify({ ratings }),
    }),
  settleMatchday: (leagueId: string, matchday: number) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/settle`, { method: 'POST' }),
  matchdayResults: (leagueId: string, matchday: number) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/results`),
  resetMatchday: (leagueId: string, matchday: number) =>
    request<any>(`/leagues/${leagueId}/matchday/${matchday}/reset`, { method: 'POST' }),
};
