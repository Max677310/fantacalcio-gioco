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
};

export const api = {
  register: (payload: RegisterPayload) =>
    request<any>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }, false),
  login: (email: string, password: string) =>
    request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),
  me: () => request<any>('/auth/me'),
  myLeagues: () => request<any[]>('/leagues/mine'),
  createLeague: (name: string, team_name: string) =>
    request<any>('/leagues/create', { method: 'POST', body: JSON.stringify({ name, team_name }) }),
  joinLeague: (code: string, team_name: string) =>
    request<any>('/leagues/join', { method: 'POST', body: JSON.stringify({ code, team_name }) }),
  leagueMembers: (leagueId: string) => request<any[]>(`/leagues/${leagueId}/members`),
  myMembership: (leagueId: string) => request<any>(`/leagues/${leagueId}/my-membership`),
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
  nextPlayer: (leagueId: string, playerId: string) =>
    request<any>(`/auction/${leagueId}/next`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),
  regulations: (leagueId: string) => request<any>(`/regulations/${leagueId}`),
  updateRegulations: (leagueId: string, body: any) =>
    request<any>(`/regulations/${leagueId}`, { method: 'PUT', body: JSON.stringify(body) }),
};
