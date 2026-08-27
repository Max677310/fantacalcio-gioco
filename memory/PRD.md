# Fantacalcio Manager – PRD

## Overview
Cross-platform Expo React Native mobile app for **Italian Fantasy Football (Fantacalcio)** with real multi-user leagues via 6-digit invite codes.

## Stack
- **Frontend:** Expo Router 6, React Native 0.81, Reanimated, expo-blur, expo-image, expo-linear-gradient, expo-clipboard, Ionicons, expo-secure-store
- **Backend:** FastAPI + Motor (async MongoDB), JWT (PyJWT) + bcrypt/passlib
- **DB collections:** users, leagues, memberships, players, regulations, standings, activity, auction_state, bids

## Design Language
"Luxe Dark / Sports Utility" — Deep Emerald + Antique Gold on `#0D0F12`. Glassmorphism on Login card and Auction sticky controls.

## Screens
1. **Login / Register** — cinematic stadium bg + glass card. Register has **toggle Crea lega / Unisciti con codice**, plus fields for team name (and optional league name OR 6-digit invite code)
2. **Onboarding** — shown to any logged-in user with 0 leagues; same Crea/Unisciti flow
3. **Dashboard** — user's team name, hero rank card, quick actions, invite-code strip, live activity feed
4. **Asta Live** — active player, real-time bid log (polling), sticky bidding bar
5. **Formazione** — 4-3-3 pitch with glass chips
6. **Classifica** — table showing team_name (with the manager's real name), gold trophy on 1st
7. **Lega** — big 6-digit invite code (Copy + Share buttons), ADMIN badge, members list with team names
8. **Regolamento** — budget, roster sizes, modifiers, bonus/malus

## Multi-user league flow
1. First user registers with `action=create` + `team_name` (+ optional `league_name`) → becomes admin, receives a unique 6-digit code
2. Friends register with `action=join` + `invite_code` + their own `team_name` → auto-joined
3. Each member sees their own team name in dashboard/standings; admin can share code from Lega tab

## Backend Endpoints (`/api`)
- `POST /auth/register` — accepts `action`, `team_name`, `invite_code`, `league_name`
- `POST /auth/login`, `GET /auth/me`
- `POST /leagues/create`, `POST /leagues/join`
- `GET /leagues/mine`, `GET /leagues/{id}`, `GET /leagues/{id}/members`, `GET /leagues/{id}/my-membership`
- `GET /players`, `GET /players/{id}`
- `GET /auction/{league}/state`, `GET/bids`, `POST /bid`, `POST /next` (member-guarded)
- `GET/PUT /regulations/{league}`
- `GET /standings/{league}`, `GET /activity/{league}`, `GET /dashboard/{league}`

## Seeded data (Serie A 2025/26)
- **213 players** across P/D/C/A roles, sourced from official Fantacalcio Online quotazioni (no Osimhen, no Kvaratskhelia, no old transfers — includes Nico Paz, Højlund, McTominay, De Bruyne, Lautaro, etc.)
- Demo league with **stable code `123456`**: 7 seeded members with team names
- Activity feed & standings pre-seeded

## Deferred / Future
- Real-time WebSocket auction (currently 4-second polling)
- Real push notifications (currently mocked in activity feed)
- Live matchday scoring engine using Serie A API
- Roster building phase (winning players from asta → rosa)
- League invite deep-link (URL scheme)
- Automated Monday API (manual admin upload / smart mock ratings + auto bench subs)

## Recently completed
- **Giornata di partenza personalizzata** (v8): admin can pick which Serie A matchday (1-38) the league starts tracking from. Fixtures are numbered accordingly. Editable pre-kickoff via `PATCH /api/leagues/{id}/settings`.
