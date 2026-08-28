"""Fantacalcio backend API tests - iteration 2 (multi-user leagues)"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://auction-dashboard-9.preview.emergentagent.com",
).rstrip("/")

DEMO_EMAIL = "demo@fanta.it"
DEMO_PASSWORD = "demo1234"
DEMO_LEAGUE_CODE = "123456"


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def demo_league(api, auth_headers):
    r = api.get(f"{BASE_URL}/api/leagues/mine", headers=auth_headers)
    assert r.status_code == 200
    leagues = r.json()
    assert len(leagues) >= 1
    demo = next((l for l in leagues if l["code"] == DEMO_LEAGUE_CODE), leagues[0])
    return demo


# -------------- Auth --------------
class TestAuth:
    def test_root(self, api):
        assert api.get(f"{BASE_URL}/api/").status_code == 200

    def test_login_demo(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["email"] == DEMO_EMAIL

    def test_login_bad(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": DEMO_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_invalid(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers={"Authorization": "Bearer invalid.token"})
        assert r.status_code == 401


# -------------- Register + League bootstrap --------------
class TestRegisterFlow:
    def test_register_create_league(self, api):
        email = f"test_create_{uuid.uuid4().hex[:8]}@fanta.it"
        team = f"TEST Team {uuid.uuid4().hex[:6]}"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "abcdef", "name": "TEST Creator",
            "action": "create", "team_name": team,
            "league_name": "TEST League",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        token = data["access_token"]
        headers = {"Authorization": f"Bearer {token}",
                   "Content-Type": "application/json"}
        mine = api.get(f"{BASE_URL}/api/leagues/mine", headers=headers).json()
        assert len(mine) == 1
        league = mine[0]
        assert league["name"] == "TEST League"
        assert len(league["code"]) == 6
        assert league["code"].isdigit()
        # my-membership
        mm = api.get(f"{BASE_URL}/api/leagues/{league['id']}/my-membership",
                     headers=headers).json()
        assert mm["team_name"] == team
        assert mm["role"] == "admin"

    def test_register_join_demo(self, api):
        email = f"test_join_{uuid.uuid4().hex[:8]}@fanta.it"
        team = f"TEST Joiner {uuid.uuid4().hex[:6]}"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "abcdef", "name": "TEST Joiner",
            "action": "join", "team_name": team,
            "invite_code": DEMO_LEAGUE_CODE,
        })
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mine = api.get(f"{BASE_URL}/api/leagues/mine", headers=headers).json()
        assert any(l["code"] == DEMO_LEAGUE_CODE for l in mine)
        league_id = next(l["id"] for l in mine if l["code"] == DEMO_LEAGUE_CODE)
        mm = api.get(f"{BASE_URL}/api/leagues/{league_id}/my-membership",
                     headers=headers).json()
        assert mm["team_name"] == team
        assert mm["role"] == "member"

    def test_register_join_bad_code(self, api):
        email = f"test_badjoin_{uuid.uuid4().hex[:8]}@fanta.it"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "abcdef", "name": "TEST Bad",
            "action": "join", "team_name": "Whatever",
            "invite_code": "999999",
        })
        assert r.status_code == 404

    def test_register_duplicate_team_name(self, api):
        # Milano Warriors is demo's team; new user tries to reuse (case-insensitive)
        email = f"test_dup_{uuid.uuid4().hex[:8]}@fanta.it"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "abcdef", "name": "TEST Dup",
            "action": "join", "team_name": "milano warriors",
            "invite_code": DEMO_LEAGUE_CODE,
        })
        assert r.status_code == 409, r.text


# -------------- Leagues CRUD (auth) --------------
class TestLeaguesEndpoints:
    def test_create_league_auth(self, api):
        # bootstrap user (no league) then use /leagues/create
        email = f"test_lcr_{uuid.uuid4().hex[:8]}@fanta.it"
        reg = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "abcdef", "name": "TEST LC",
        })
        assert reg.status_code == 200
        headers = {"Authorization": f"Bearer {reg.json()['access_token']}",
                   "Content-Type": "application/json"}
        r = api.post(f"{BASE_URL}/api/leagues/create", headers=headers,
                     json={"name": "TEST My League", "team_name": "TEST Squad A"})
        assert r.status_code == 200, r.text
        league = r.json()
        assert len(league["code"]) == 6
        assert league["admin_id"]
        # Verify via GET
        got = api.get(f"{BASE_URL}/api/leagues/{league['id']}", headers=headers)
        assert got.status_code == 200
        assert got.json()["code"] == league["code"]

    def test_join_league_auth_and_dup(self, api):
        # user A creates league
        emailA = f"test_A_{uuid.uuid4().hex[:8]}@fanta.it"
        regA = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": emailA, "password": "abcdef", "name": "TEST A",
            "action": "create", "team_name": "TEST Alpha", "league_name": "TEST LJ",
        })
        hA = {"Authorization": f"Bearer {regA.json()['access_token']}",
              "Content-Type": "application/json"}
        league = api.get(f"{BASE_URL}/api/leagues/mine", headers=hA).json()[0]
        code = league["code"]

        # user B joins
        emailB = f"test_B_{uuid.uuid4().hex[:8]}@fanta.it"
        regB = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": emailB, "password": "abcdef", "name": "TEST B",
        })
        hB = {"Authorization": f"Bearer {regB.json()['access_token']}",
              "Content-Type": "application/json"}
        r = api.post(f"{BASE_URL}/api/leagues/join", headers=hB,
                     json={"code": code, "team_name": "TEST Bravo"})
        assert r.status_code == 200, r.text

        # user C tries to join with duplicate team_name -> 409
        emailC = f"test_C_{uuid.uuid4().hex[:8]}@fanta.it"
        regC = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": emailC, "password": "abcdef", "name": "TEST C",
        })
        hC = {"Authorization": f"Bearer {regC.json()['access_token']}",
              "Content-Type": "application/json"}
        r2 = api.post(f"{BASE_URL}/api/leagues/join", headers=hC,
                      json={"code": code, "team_name": "TEST Bravo"})
        assert r2.status_code == 409, r2.text

        # members list
        members = api.get(f"{BASE_URL}/api/leagues/{league['id']}/members",
                          headers=hA).json()
        assert len(members) == 2
        team_names = {m["team_name"] for m in members}
        assert {"TEST Alpha", "TEST Bravo"} <= team_names
        roles = {m["team_name"]: m["role"] for m in members}
        assert roles["TEST Alpha"] == "admin"
        assert roles["TEST Bravo"] == "member"

    def test_members_demo_league(self, api, auth_headers, demo_league):
        r = api.get(f"{BASE_URL}/api/leagues/{demo_league['id']}/members",
                    headers=auth_headers)
        assert r.status_code == 200
        ms = r.json()
        assert len(ms) >= 7
        by_role = {m["team_name"]: m["role"] for m in ms}
        assert by_role.get("Milano Warriors") == "admin"
        assert "Roma Devils" in by_role
        assert "Napoli Kings" in by_role

    def test_my_membership_demo(self, api, auth_headers, demo_league):
        r = api.get(f"{BASE_URL}/api/leagues/{demo_league['id']}/my-membership",
                    headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["team_name"] == "Milano Warriors"
        assert r.json()["role"] == "admin"


# -------------- Players (213, no Osimhen) --------------
class TestPlayers:
    def test_expected_players(self, api):
        r = api.get(f"{BASE_URL}/api/players")
        assert r.status_code == 200
        players = r.json()
        assert len(players) == 213, f"Expected 213 players, got {len(players)}"
        names = {p["name"] for p in players}
        # required present
        for req in ["Nico Paz", "Lautaro Martinez", "Rasmus Højlund", "Scott McTominay"]:
            assert req in names, f"Missing player: {req}"
        # Osimhen must be absent
        assert not any("Osimhen" in n for n in names), "Osimhen must NOT be present"

    def test_role_filter(self, api):
        for role in ["P", "D", "C", "A"]:
            r = api.get(f"{BASE_URL}/api/players", params={"role": role})
            assert r.status_code == 200
            assert all(p["role"] == role for p in r.json())


# -------------- Dashboard & Standings --------------
class TestDashboard:
    def test_summary_has_team_name(self, api, auth_headers, demo_league):
        r = api.get(f"{BASE_URL}/api/dashboard/{demo_league['id']}",
                    headers=auth_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("my_team_name") == "Milano Warriors"
        assert d["members"] >= 7
        assert d["league"]["code"] == DEMO_LEAGUE_CODE


class TestStandings:
    def test_rows_have_team_name(self, api, auth_headers, demo_league):
        r = api.get(f"{BASE_URL}/api/standings/{demo_league['id']}",
                    headers=auth_headers)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 7
        for row in rows:
            assert "team_name" in row and row["team_name"]
        team_names = {row["team_name"] for row in rows}
        assert "Milano Warriors" in team_names


# -------------- Auction sanity (regression) --------------
class TestAuction:
    def test_state_and_bid(self, api, auth_headers, demo_league):
        state = api.get(f"{BASE_URL}/api/auction/{demo_league['id']}/state",
                        headers=auth_headers).json()
        assert state["active_player_id"]
        new_amount = state["current_bid"] + 1
        r = api.post(f"{BASE_URL}/api/auction/{demo_league['id']}/bid",
                     headers=auth_headers, json={"amount": new_amount})
        assert r.status_code == 200, r.text
        assert r.json()["current_bid"] == new_amount



# -------------- Kickoff scheduling + Lineup lock (iteration 3) --------------
from datetime import datetime, timedelta, timezone


class TestKickoffLineup:
    """Regression tests for kickoff scheduling & lineup lock behavior."""

    def test_schedule_kickoff_future_ok(self, api, auth_headers, demo_league):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 1, "kickoff_at": future},
        )
        assert r.status_code == 200, r.text
        league = r.json()
        assert str(1) in (league.get("matchday_kickoffs") or {})

    def test_get_lineup_returns_kickoff_info(self, api, auth_headers, demo_league):
        r = api.get(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/lineup?matchday=1",
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "kickoff_at" in data and data["kickoff_at"]
        assert "lock_at" in data and data["lock_at"]
        assert data.get("locked") is False  # kickoff is 2 days in the future

    def test_save_lineup_ok_when_far_from_kickoff(self, api, auth_headers, demo_league):
        # Get roster to pick 11 valid starter_ids
        me = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers).json()
        roster = api.get(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/roster/{me['id']}",
            headers=auth_headers,
        ).json()
        players = roster.get("players") or []
        # Pick players by role for 4-3-3
        by_role = {"P": [], "D": [], "C": [], "A": []}
        for p in players:
            by_role.setdefault(p.get("role"), []).append(p["id"])
        starter_ids = (
            by_role.get("P", [None])[:1]
            + by_role.get("D", [])[:4]
            + by_role.get("C", [])[:3]
            + by_role.get("A", [])[:3]
        )
        # Pad to 11 with None (allowed by API — starter_ids is List[Optional[str]])
        while len(starter_ids) < 11:
            starter_ids.append(None)
        starter_ids = starter_ids[:11]

        r = api.put(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/lineup",
            headers=auth_headers,
            json={"matchday": 1, "formation": "4-3-3", "starter_ids": starter_ids},
        )
        assert r.status_code == 200, r.text
        assert r.json()["formation"] == "4-3-3"

    def test_save_lineup_locked_when_past_kickoff(self, api, auth_headers, demo_league):
        # Schedule kickoff 1 minute in the past
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        r = api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 1, "kickoff_at": past},
        )
        assert r.status_code == 200, r.text

        # Now try to save lineup -> should 423
        r = api.put(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/lineup",
            headers=auth_headers,
            json={"matchday": 1, "formation": "4-3-3", "starter_ids": [None] * 11},
        )
        assert r.status_code == 423, r.text
        detail = (r.json() or {}).get("detail", "")
        assert "bloccata" in detail.lower() or "blocco" in detail.lower() or "kickoff" in detail.lower()

        # Restore future kickoff so other tests aren't affected
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 1, "kickoff_at": future},
        )

    def test_schedule_kickoff_out_of_range(self, api, auth_headers, demo_league):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        # 50 is within pydantic bound (<=60) but above the demo league end_matchday (38)
        r = api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 50, "kickoff_at": future},
        )
        assert r.status_code == 400, r.text
        assert "intervallo" in (r.json() or {}).get("detail", "").lower()

    def test_schedule_kickoff_clear(self, api, auth_headers, demo_league):
        # Set matchday 2 kickoff then clear it
        future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 2, "kickoff_at": future},
        )
        r = api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=auth_headers,
            json={"matchday": 2, "kickoff_at": None},
        )
        assert r.status_code == 200
        league = r.json()
        assert str(2) not in (league.get("matchday_kickoffs") or {})

    def test_schedule_kickoff_non_admin_forbidden(self, api, demo_league):
        # Login as a non-admin seeded member
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "mario.rossi@fanta.it", "password": "password123"},
        )
        if r.status_code != 200:
            pytest.skip("Non-admin seed user not available")
        member_token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"}
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = api.post(
            f"{BASE_URL}/api/leagues/{demo_league['id']}/kickoff/schedule",
            headers=h,
            json={"matchday": 3, "kickoff_at": future},
        )
        assert r.status_code in (401, 403), r.text
