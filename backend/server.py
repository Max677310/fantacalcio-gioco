from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import jwt
import random
import re
import string
import ipaddress
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Literal, Dict, Tuple
from passlib.context import CryptContext
import json as _json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET or len(JWT_SECRET) < 32:
    raise RuntimeError(
        "JWT_SECRET env variable is REQUIRED and must be at least 32 chars. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 7  # 7 days

SEED_VERSION = 8  # bump to force re-seed with start_matchday

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ------------------------------------------------------------
# Email — supports BOTH Emergent-managed proxy (dev/preview)
# AND real Resend API (self-hosted deploys)
# ------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")           # Emergent path
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")          # Self-host path
EMAIL_FROM = os.environ.get("EMAIL_FROM")                  # Required when using Resend directly (e.g. "Fantacalcio <noreply@yourdomain.com>")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME") or "Fantacalcio Manager"
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")
_APP_HOST = os.environ.get("APP_PUBLIC_URL") or "https://fantacalcio.app"

# Preferred provider: Resend direct if RESEND_API_KEY is set (self-host),
# otherwise fall back to Emergent-managed proxy.
EMAIL_PROVIDER = "resend" if RESEND_API_KEY else ("emergent" if EMAIL_KEY else None)

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []
    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened/numeric/credential URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    """Send a transactional email.

    Two providers supported:
    - `resend`  : Real Resend API (production self-hosting). Requires
                  `RESEND_API_KEY` and `EMAIL_FROM` (must be a domain you
                  verified on resend.com/domains).
    - `emergent`: Emergent-managed proxy (dev/preview on the platform).
                  Requires `EMERGENT_EMAIL_KEY`.
    Server-side templates only, no caller input.
    """
    _assert_safe_email(subject, html)
    if EMAIL_PROVIDER == "resend":
        if not EMAIL_FROM:
            logging.getLogger("fantacalcio").warning(
                "RESEND_API_KEY set but EMAIL_FROM missing; email not sent"
            )
            return None
        payload = {
            "from": EMAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if EMAIL_REPLY_TO:
            payload["reply_to"] = EMAIL_REPLY_TO
        try:
            async with httpx.AsyncClient(timeout=30) as client_http:
                resp = await client_http.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {RESEND_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            resp.raise_for_status()
            return resp.json().get("id")
        except httpx.HTTPStatusError as e:
            logging.getLogger("fantacalcio").error(
                "Resend send failed: %s %s", e.response.status_code, e.response.text
            )
            raise HTTPException(status_code=502, detail="Errore invio email")
        except Exception as e:
            logging.getLogger("fantacalcio").error("Resend send error: %s", e)
            raise HTTPException(status_code=500, detail="Errore invio email")

    if EMAIL_PROVIDER == "emergent":
        payload = {
            "to": [to], "subject": subject, "html": html,
            "from_name": EMAIL_FROM_NAME,
        }
        if EMAIL_REPLY_TO:
            payload["contact_email"] = EMAIL_REPLY_TO
        try:
            async with httpx.AsyncClient(timeout=30) as client_http:
                resp = await client_http.post(
                    f"{EMAIL_BASE_URL}/api/v1/email/send",
                    headers={"X-Email-Key": EMAIL_KEY},
                    json=payload,
                )
            resp.raise_for_status()
            return resp.json().get("id")
        except httpx.HTTPStatusError as e:
            logging.getLogger("fantacalcio").error(
                "Emergent email failed: %s %s", e.response.status_code, e.response.text
            )
            raise HTTPException(status_code=502, detail="Errore invio email")
        except Exception as e:
            logging.getLogger("fantacalcio").error("Emergent email error: %s", e)
            raise HTTPException(status_code=500, detail="Errore invio email")

    logging.getLogger("fantacalcio").warning(
        "No email provider configured (set RESEND_API_KEY or EMERGENT_EMAIL_KEY); skipping send"
    )
    return None

app = FastAPI(title="Fantacalcio API")
api = APIRouter(prefix="/api")

# ------------------------------------------------------------
# Models
# ------------------------------------------------------------
Role = Literal["P", "D", "C", "A"]

class User(BaseModel):
    id: str
    email: EmailStr
    name: str

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=64)
    # league bootstrap (optional)
    action: Optional[Literal["create", "join", "none"]] = "none"
    team_name: Optional[str] = None
    invite_code: Optional[str] = None
    league_name: Optional[str] = None
    mode: Optional[Literal["asta", "listino"]] = "asta"
    start_matchday: Optional[int] = Field(default=1, ge=1, le=38)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User

class Player(BaseModel):
    id: str
    name: str
    team: str
    role: Role
    price: int
    avg_vote: float
    goals: int = 0
    assists: int = 0

class League(BaseModel):
    id: str
    name: str
    code: str
    admin_id: str
    member_ids: List[str] = []
    mode: Literal["asta", "listino"] = "asta"
    budget_per_user: int = 500
    transfer_window_open: bool = False
    kickoff_locked: bool = False
    start_matchday: int = 1  # Serie A matchday from which the league starts tracking
    created_at: datetime

class Wallet(BaseModel):
    league_id: str
    user_id: str
    budget: int
    spent: int
    remaining: int

class RosterEntry(BaseModel):
    player_id: str
    price_paid: int

class Roster(BaseModel):
    league_id: str
    user_id: str
    team_name: str
    entries: List[RosterEntry] = []

class Fixture(BaseModel):
    league_id: str
    matchday: int
    home_user_id: Optional[str]
    away_user_id: Optional[str]
    home_team: Optional[str]
    away_team: Optional[str]
    is_bye: bool = False
    bye_user_id: Optional[str] = None
    bye_team: Optional[str] = None

class LiveEvent(BaseModel):
    id: str
    matchday: int
    player_id: Optional[str]
    player_name: str
    team: str
    kind: Literal["goal", "assist", "yellow", "red", "own_goal", "penalty_saved", "penalty_missed", "sub", "kick_off", "half_time", "full_time"]
    minute: int
    description: str
    created_at: datetime

class Membership(BaseModel):
    league_id: str
    user_id: str
    user_name: str
    team_name: str
    role: Literal["admin", "member"]
    joined_at: datetime

class Bid(BaseModel):
    id: str
    league_id: str
    player_id: str
    user_id: str
    user_name: str
    amount: int
    created_at: datetime

class AuctionState(BaseModel):
    league_id: str
    active_player_id: Optional[str]
    current_bid: int
    current_bidder_id: Optional[str]
    current_bidder_name: Optional[str]
    status: Literal["idle", "running", "sold", "ended"]
    bid_expires_at: Optional[datetime] = None
    passed_user_ids: List[str] = []
    bid_countdown_seconds: int = 15
    seconds_remaining: Optional[float] = None

class Regulations(BaseModel):
    league_id: str
    total_budget: int = 500
    roster_p: int = 3
    roster_d: int = 8
    roster_c: int = 8
    roster_a: int = 6
    defense_modifier: bool = True
    midfield_modifier: bool = False
    goal_bonus_a: float = 3.0
    goal_bonus_c: float = 3.5
    goal_bonus_d: float = 4.0
    assist_bonus: float = 1.0
    yellow_card: float = -0.5
    red_card: float = -1.0
    clean_sheet_p: float = 1.0

class StandingRow(BaseModel):
    user_id: str
    user_name: str
    team_name: str
    played: int
    wins: int
    draws: int
    losses: int
    points: int
    goals_for: int
    goals_against: int

class Activity(BaseModel):
    id: str
    league_id: str
    kind: Literal["goal", "assist", "bid", "lineup", "info"]
    title: str
    subtitle: str
    created_at: datetime

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def make_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": int(now.timestamp()),
               "exp": int((now + timedelta(minutes=JWT_TTL_MIN)).timestamp())}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

async def gen_invite_code(length: int = 6) -> str:
    # numeric-friendly 6-digit code, unique in leagues collection
    for _ in range(20):
        code = "".join(random.choices(string.digits, k=length))
        exists = await db.leagues.find_one({"code": code})
        if not exists:
            return code
    # fallback: alphanumeric
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

async def get_current_user(token: str = Depends(oauth2)) -> dict:
    creds_err = HTTPException(status.HTTP_401_UNAUTHORIZED, "Token non valido",
                              headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("sub")
    except jwt.PyJWTError:
        raise creds_err
    if not uid:
        raise creds_err
    user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user:
        raise creds_err
    return user


async def require_membership(league_id: str, user: dict) -> dict:
    """Ensure the given user is a member of the league. Returns the membership doc."""
    m = await db.memberships.find_one(
        {"league_id": league_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not m:
        raise HTTPException(403, "Non sei membro di questa lega")
    return m


async def require_admin(league_id: str, user: dict) -> dict:
    m = await require_membership(league_id, user)
    if m.get("role") != "admin":
        raise HTTPException(403, "Solo l'amministratore della lega può eseguire questa operazione")
    return m

def generate_round_robin(user_ids: List[str]) -> List[List[tuple]]:
    """Return a list of matchdays, each a list of (home, away) tuples.
    If N is odd, a None placeholder is added; the team paired with None gets a bye.
    Uses the standard circle method (Berger table).
    """
    teams = list(user_ids)
    if len(teams) < 2:
        return []
    if len(teams) % 2 == 1:
        teams.append(None)  # bye placeholder
    n = len(teams)
    rounds = []
    fixed = teams[0]
    rotating = teams[1:]
    for r in range(n - 1):
        pairs = []
        # first pair: fixed vs rotating[-1]
        pairs.append((fixed, rotating[-1]))
        for i in range(len(rotating) - 1):
            pairs.append((rotating[i], rotating[-2 - i] if -2 - i >= -len(rotating) else rotating[i + 1]))
            if len(pairs) >= n // 2:
                break
        # alternate home/away by round parity
        if r % 2 == 1:
            pairs = [(b, a) for (a, b) in pairs]
        rounds.append(pairs)
        rotating = [rotating[-1]] + rotating[:-1]
    return rounds


async def build_fixtures(league_id: str) -> None:
    """Regenerate the full round-robin fixtures for a league.
    Matchday numbers are offset by the league's `start_matchday` (Serie A calendar).
    """
    memberships = await db.memberships.find(
        {"league_id": league_id}, {"_id": 0}
    ).sort("joined_at", 1).to_list(100)
    if len(memberships) < 2:
        await db.fixtures.delete_many({"league_id": league_id})
        return
    league_doc = await db.leagues.find_one({"id": league_id}, {"_id": 0}) or {}
    start_md = int(league_doc.get("start_matchday") or 1)
    if start_md < 1: start_md = 1
    if start_md > 38: start_md = 38
    uid_to_team = {m["user_id"]: m["team_name"] for m in memberships}
    user_ids = [m["user_id"] for m in memberships]
    rounds = generate_round_robin(user_ids)

    await db.fixtures.delete_many({"league_id": league_id})
    docs = []
    for idx, pairs in enumerate(rounds):
        matchday = start_md + idx
        if matchday > 38:
            break  # Serie A season has 38 matchdays
        for home, away in pairs:
            if home is None or away is None:
                bye_uid = home or away
                docs.append({
                    "league_id": league_id, "matchday": matchday,
                    "home_user_id": None, "away_user_id": None,
                    "home_team": None, "away_team": None,
                    "is_bye": True,
                    "bye_user_id": bye_uid,
                    "bye_team": uid_to_team.get(bye_uid),
                })
            else:
                docs.append({
                    "league_id": league_id, "matchday": matchday,
                    "home_user_id": home, "away_user_id": away,
                    "home_team": uid_to_team.get(home),
                    "away_team": uid_to_team.get(away),
                    "is_bye": False,
                })
    if docs:
        await db.fixtures.insert_many(docs)


async def init_wallet(league_id: str, user_id: str, budget: int) -> None:
    existing = await db.wallets.find_one(
        {"league_id": league_id, "user_id": user_id}
    )
    if existing:
        return
    await db.wallets.insert_one({
        "league_id": league_id, "user_id": user_id,
        "budget": budget, "spent": 0, "remaining": budget,
    })


async def init_roster(league_id: str, user_id: str, team_name: str) -> None:
    existing = await db.rosters.find_one(
        {"league_id": league_id, "user_id": user_id}
    )
    if existing:
        return
    await db.rosters.insert_one({
        "league_id": league_id, "user_id": user_id,
        "team_name": team_name, "entries": [],
    })


async def create_league_for_user(user: dict, league_name: str, team_name: str, mode: str = "asta", start_matchday: int = 1) -> dict:
    league_id = str(uuid.uuid4())
    code = await gen_invite_code()
    try:
        start_md = int(start_matchday)
    except Exception:
        start_md = 1
    if start_md < 1: start_md = 1
    if start_md > 38: start_md = 38
    league_doc = {
        "id": league_id,
        "name": league_name.strip() or f"Lega di {user['name']}",
        "code": code,
        "admin_id": user["id"],
        "member_ids": [user["id"]],
        "mode": mode if mode in ("asta", "listino") else "asta",
        "budget_per_user": 500,
        "transfer_window_open": False,
        "kickoff_locked": False,
        "start_matchday": start_md,
        "created_at": now_iso(),
        "is_demo": False,
    }
    await db.leagues.insert_one(dict(league_doc))
    await db.memberships.insert_one({
        "league_id": league_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "team_name": team_name.strip(),
        "role": "admin",
        "joined_at": now_iso(),
    })
    # seed default regulations, wallet, roster, fixtures
    reg = Regulations(league_id=league_id).model_dump()
    await db.regulations.insert_one(dict(reg))
    await init_wallet(league_id, user["id"], 500)
    await init_roster(league_id, user["id"], team_name.strip())
    await build_fixtures(league_id)
    return league_doc

async def join_league_with_code(user: dict, code: str, team_name: str) -> dict:
    code = code.strip().upper()
    league = await db.leagues.find_one({"code": code}, {"_id": 0})
    if not league:
        raise HTTPException(404, "Codice invito non valido")
    # already a member?
    existing = await db.memberships.find_one({
        "league_id": league["id"], "user_id": user["id"]
    })
    if existing:
        return league
    # team_name must be unique within a league
    dup = await db.memberships.find_one({
        "league_id": league["id"],
        "team_name": {"$regex": f"^{re.escape(team_name.strip())}$", "$options": "i"},
    })
    if dup:
        raise HTTPException(409, "Nome squadra già usato in questa lega")
    await db.memberships.insert_one({
        "league_id": league["id"],
        "user_id": user["id"],
        "user_name": user["name"],
        "team_name": team_name.strip(),
        "role": "member",
        "joined_at": now_iso(),
    })
    await db.leagues.update_one(
        {"id": league["id"]},
        {"$addToSet": {"member_ids": user["id"]}}
    )
    # Initialize wallet & roster, then regenerate fixtures for new member set
    budget = league.get("budget_per_user", 500)
    await init_wallet(league["id"], user["id"], budget)
    await init_roster(league["id"], user["id"], team_name.strip())
    await build_fixtures(league["id"])
    return league

# ------------------------------------------------------------
# Auth routes
# ------------------------------------------------------------
@api.post("/auth/register", response_model=Token)
async def register(data: UserRegister):
    email = data.email.lower().strip()
    exists = await db.users.find_one({"email": email})
    if exists:
        raise HTTPException(409, "Email già registrata")
    uid = str(uuid.uuid4())
    user_doc = {
        "id": uid, "email": email, "name": data.name.strip(),
        "password_hash": pwd_ctx.hash(data.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)

    # optional league bootstrap
    if data.action == "join":
        if not data.invite_code or not data.team_name:
            raise HTTPException(400, "Codice invito e nome squadra sono richiesti")
        try:
            await join_league_with_code(user_doc, data.invite_code, data.team_name)
        except HTTPException as e:
            # rollback? Keep user; propagate
            raise e
    elif data.action == "create":
        if not data.team_name:
            raise HTTPException(400, "Nome squadra richiesto")
        await create_league_for_user(
            user_doc,
            data.league_name or f"Lega di {data.name}",
            data.team_name,
            data.mode or "asta",
            data.start_matchday or 1,
        )

    return Token(access_token=make_token(uid),
                 user=User(id=uid, email=email, name=data.name.strip()))

@api.post("/auth/login", response_model=Token)
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email.lower().strip()})
    if not user or not pwd_ctx.verify(data.password, user["password_hash"]):
        raise HTTPException(401, "Email o password errati")
    return Token(
        access_token=make_token(user["id"]),
        user=User(id=user["id"], email=user["email"], name=user["name"]),
    )

@api.get("/auth/me", response_model=User)
async def me(current=Depends(get_current_user)):
    return User(id=current["id"], email=current["email"], name=current["name"])


# ------------------------------------------------------------
# Password reset — Emergent managed email
# ------------------------------------------------------------
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")
    new_password: str = Field(min_length=6, max_length=128)


RESET_CODE_TTL_MIN = 15
RESET_MAX_PER_HOUR = 3
RESET_MAX_ATTEMPTS = 5


def _reset_email_html(name: str, code: str) -> str:
    return (
        f'<table role="presentation" width="100%" style="background:#0D0F12;padding:32px 0">'
        f'<tr><td align="center">'
        f'<table role="presentation" width="480" style="background:#1A1D24;border-radius:12px;'
        f'padding:32px;font-family:Arial,Helvetica,sans-serif;color:#F5F5F5">'
        f'<tr><td>'
        f'<h1 style="margin:0 0 16px;color:#D4AF37;font-size:22px">Reimposta la tua password</h1>'
        f'<p style="margin:0 0 16px;color:#F5F5F5;font-size:14px;line-height:22px">'
        f'Ciao {escape(name)},<br>hai richiesto di reimpostare la password del tuo account '
        f'{escape(EMAIL_FROM_NAME)}.'
        f'</p>'
        f'<p style="margin:0 0 8px;color:#B0B6C0;font-size:13px">Inserisci questo codice nell\'app '
        f'entro {RESET_CODE_TTL_MIN} minuti:</p>'
        f'<div style="background:#0D0F12;border:1px solid #2A2E39;border-radius:8px;padding:20px;'
        f'text-align:center;margin:12px 0 24px">'
        f'<div style="font-family:Menlo,Consolas,monospace;color:#D4AF37;font-size:36px;'
        f'letter-spacing:12px;font-weight:800">{code}</div>'
        f'</div>'
        f'<p style="margin:0 0 8px;color:#B0B6C0;font-size:12px;line-height:18px">'
        f'Se non hai richiesto tu la reimpostazione, puoi ignorare questa email. '
        f'La tua password rimarrà invariata.'
        f'</p>'
        f'<hr style="border:none;border-top:1px solid #2A2E39;margin:24px 0">'
        f'<p style="margin:0;color:#7A7F8A;font-size:11px;line-height:16px">'
        f'Inviata da {escape(EMAIL_FROM_NAME)}. Non chiediamo mai la tua password o codici via email; '
        f'usa questo codice solo direttamente nell\'app.'
        f'</p>'
        f'</td></tr>'
        f'</table></td></tr></table>'
    )


@api.post("/auth/forgot-password")
async def forgot_password(data: ForgotPasswordRequest):
    """Send a 6-digit reset code by email. Silent success even if the email is unknown
    to avoid leaking existing accounts."""
    email = data.email.lower().strip()

    # Rate limit: max RESET_MAX_PER_HOUR new codes for this email in the last hour
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = await db.password_resets.count_documents({
        "email": email,
        "created_at": {"$gte": one_hour_ago.isoformat()},
    })
    if recent >= RESET_MAX_PER_HOUR:
        # silently succeed to not reveal state; but no email is sent
        return {"sent": False, "detail": "Troppe richieste, riprova più tardi"}

    user = await db.users.find_one({"email": email})
    if not user:
        # do NOT reveal user does not exist
        return {"sent": True}

    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=RESET_CODE_TTL_MIN)
    # Invalidate previous unused codes for this email
    await db.password_resets.update_many(
        {"email": email, "used": False},
        {"$set": {"used": True, "invalidated_at": now.isoformat()}},
    )
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "user_id": user["id"],
        "code_hash": pwd_ctx.hash(code),
        "attempts": 0,
        "used": False,
        "created_at": now.isoformat(),
        "expires_at": expires.isoformat(),
    })
    await send_email(
        to=user["email"],
        subject=f"Codice di reimpostazione — {EMAIL_FROM_NAME}",
        html=_reset_email_html(user.get("name") or "Manager", code),
    )
    return {"sent": True}


@api.post("/auth/reset-password", response_model=Token)
async def reset_password(data: ResetPasswordRequest):
    email = data.email.lower().strip()
    now = datetime.now(timezone.utc)
    # find latest unused non-expired code for this email
    doc = await db.password_resets.find_one(
        {"email": email, "used": False, "expires_at": {"$gte": now.isoformat()}},
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(400, "Codice non valido o scaduto")
    if int(doc.get("attempts", 0)) >= RESET_MAX_ATTEMPTS:
        raise HTTPException(400, "Troppi tentativi. Richiedi un nuovo codice.")
    if not pwd_ctx.verify(data.code, doc["code_hash"]):
        await db.password_resets.update_one(
            {"id": doc["id"]}, {"$inc": {"attempts": 1}}
        )
        raise HTTPException(400, "Codice non valido o scaduto")
    user = await db.users.find_one({"id": doc["user_id"]})
    if not user:
        raise HTTPException(400, "Utente non trovato")
    # rotate password
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": pwd_ctx.hash(data.new_password)}},
    )
    await db.password_resets.update_one(
        {"id": doc["id"]}, {"$set": {"used": True, "used_at": now.isoformat()}}
    )
    return Token(
        access_token=make_token(user["id"]),
        user=User(id=user["id"], email=user["email"], name=user["name"]),
    )

# ------------------------------------------------------------
# League routes
# ------------------------------------------------------------
class LeagueCreate(BaseModel):
    name: Optional[str] = None
    team_name: str = Field(min_length=1, max_length=48)
    mode: Optional[Literal["asta", "listino"]] = "asta"
    start_matchday: Optional[int] = Field(default=1, ge=1, le=38)

class LeagueJoin(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    team_name: str = Field(min_length=1, max_length=48)

@api.post("/leagues/create", response_model=League)
async def create_league(body: LeagueCreate, current=Depends(get_current_user)):
    league = await create_league_for_user(
        current, body.name or f"Lega di {current['name']}",
        body.team_name, body.mode or "asta",
        body.start_matchday or 1,
    )
    return League(**league)

@api.post("/leagues/join", response_model=League)
async def join_league(body: LeagueJoin, current=Depends(get_current_user)):
    league = await join_league_with_code(current, body.code, body.team_name)
    return League(**league)

@api.get("/leagues/mine", response_model=List[League])
async def my_leagues(current=Depends(get_current_user)):
    cursor = db.leagues.find({"member_ids": current["id"]}, {"_id": 0})
    leagues = await cursor.to_list(100)
    return [League(**l) for l in leagues]

@api.get("/leagues/{league_id}", response_model=League)
async def get_league(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not l:
        raise HTTPException(404, "Lega non trovata")
    return League(**l)

@api.get("/leagues/{league_id}/members", response_model=List[Membership])
async def league_members(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.memberships.find({"league_id": league_id}, {"_id": 0}).sort("joined_at", 1)
    return [Membership(**m) for m in await cursor.to_list(100)]

@api.get("/leagues/{league_id}/my-membership", response_model=Membership)
async def my_membership(league_id: str, current=Depends(get_current_user)):
    m = await db.memberships.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not m:
        raise HTTPException(404, "Non sei membro di questa lega")
    return Membership(**m)

# ------------------------------------------------------------
# Player routes
# ------------------------------------------------------------
@api.get("/players", response_model=List[Player])
async def list_players(role: Optional[Role] = None, q: Optional[str] = None):
    query = {}
    if role:
        query["role"] = role
    if q:
        query["name"] = {"$regex": re.escape(q[:64]), "$options": "i"}
    cursor = db.players.find(query, {"_id": 0}).sort("price", -1)
    return [Player(**p) for p in await cursor.to_list(1000)]

@api.get("/players/{player_id}", response_model=Player)
async def get_player(player_id: str):
    p = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Giocatore non trovato")
    return Player(**p)


class PlayerStats(BaseModel):
    player_id: str
    player_name: str
    role: Role
    team: str
    price: int
    listino_avg_vote: float
    listino_fantavoto: Optional[float] = None
    league_id: Optional[str] = None
    matches_played: int = 0
    matches_sv: int = 0
    total_goals: int = 0
    total_assists: int = 0
    total_yellows: int = 0
    total_reds: int = 0
    total_own_goals: int = 0
    total_penalties_saved: int = 0
    total_penalties_missed: int = 0
    avg_vote: Optional[float] = None
    fantamedia: Optional[float] = None
    per_matchday: List[dict] = []


@api.get("/players/{player_id}/stats", response_model=PlayerStats)
async def get_player_stats(
    player_id: str,
    league_id: Optional[str] = None,
    current=Depends(get_current_user),
):
    """Aggregate per-matchday ratings into a summary for the player detail screen.
    If league_id is provided, only ratings from that league are included; otherwise
    the response falls back to the player's baseline listino stats.
    """
    p = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Giocatore non trovato")

    stats = PlayerStats(
        player_id=p["id"],
        player_name=p["name"],
        role=p["role"],
        team=p["team"],
        price=int(p.get("price") or 1),
        listino_avg_vote=float(p.get("avg_vote") or 6.0),
        listino_fantavoto=float(p.get("fantavoto")) if p.get("fantavoto") is not None else None,
        league_id=league_id,
    )

    if league_id:
        await require_membership(league_id, current)
        cursor = db.player_ratings.find(
            {"league_id": league_id, "player_id": player_id},
            {"_id": 0},
        ).sort("matchday", 1)
        rows = await cursor.to_list(50)
        vote_sum = 0.0
        vote_count = 0
        fv_sum = 0.0
        fv_count = 0
        per_matchday = []
        for r in rows:
            eff = r.get("effective_base")
            if eff is None:
                # backward compat: if we don't have effective_base, use base_vote
                eff = r.get("base_vote")
            if not r.get("played", True):
                per_matchday.append({
                    "matchday": r["matchday"], "played": False, "sv": bool(r.get("sv")),
                    "base_vote": None, "fantavoto": None,
                    "goals": 0, "assists": 0, "yellow": 0, "red": 0,
                })
                continue
            stats.matches_played += 1
            if r.get("sv") and eff is None:
                stats.matches_sv += 1
            if eff is not None:
                vote_sum += float(eff); vote_count += 1
                fv_sum += float(r.get("fantavoto") or 0.0); fv_count += 1
            stats.total_goals += int(r.get("goals") or 0)
            stats.total_assists += int(r.get("assists") or 0)
            stats.total_yellows += int(r.get("yellow") or 0)
            stats.total_reds += int(r.get("red") or 0)
            stats.total_own_goals += int(r.get("own_goal") or 0)
            stats.total_penalties_saved += int(r.get("penalty_saved") or 0)
            stats.total_penalties_missed += int(r.get("penalty_missed") or 0)
            per_matchday.append({
                "matchday": r["matchday"],
                "played": True,
                "sv": bool(r.get("sv")),
                "base_vote": eff,
                "fantavoto": r.get("fantavoto"),
                "goals": int(r.get("goals") or 0),
                "assists": int(r.get("assists") or 0),
                "yellow": int(r.get("yellow") or 0),
                "red": int(r.get("red") or 0),
            })
        if vote_count:
            stats.avg_vote = round(vote_sum / vote_count, 2)
        if fv_count:
            stats.fantamedia = round(fv_sum / fv_count, 2)
        stats.per_matchday = per_matchday
    else:
        stats.avg_vote = stats.listino_avg_vote
        stats.fantamedia = stats.listino_fantavoto
    return stats


# ------------------------------------------------------------
# Auction routes
# ------------------------------------------------------------
AUCTION_COUNTDOWN_SECONDS = 15


async def _perform_assign(league_id: str, st: dict) -> dict:
    """Assign the currently active player to the highest bidder.
    Deducts wallet and adds to roster. Returns the new state dict.
    """
    winner_id = st.get("current_bidder_id")
    if not winner_id or not st.get("active_player_id"):
        return st
    amount = int(st.get("current_bid") or 0)
    player_id = st["active_player_id"]

    # Prevent duplicate assignment
    existing_roster = await db.rosters.find_one(
        {"league_id": league_id, "user_id": winner_id}, {"_id": 0}
    )
    if existing_roster:
        already = any(e["player_id"] == player_id for e in existing_roster.get("entries", []))
        if already:
            # nothing to do
            return st

    wallet = await db.wallets.find_one({"league_id": league_id, "user_id": winner_id})
    if not wallet:
        return st
    if amount > wallet.get("remaining", 0):
        # winner doesn't have enough — revert bidder and let others rebid
        new_state = {
            "current_bidder_id": None,
            "current_bidder_name": None,
            "bid_expires_at": None,
            "passed_user_ids": [],
        }
        await db.auction_state.update_one({"league_id": league_id}, {"$set": new_state})
        st.update(new_state)
        return st

    await db.wallets.update_one(
        {"league_id": league_id, "user_id": winner_id},
        {"$inc": {"spent": amount, "remaining": -amount}},
    )
    await db.rosters.update_one(
        {"league_id": league_id, "user_id": winner_id},
        {"$push": {"entries": {"player_id": player_id, "price_paid": amount}}},
        upsert=True,
    )
    # Keep active_player_id so UI can show the winner briefly (status=sold)
    new_state = {
        "status": "sold",
        "bid_expires_at": None,
        "passed_user_ids": [],
    }
    await db.auction_state.update_one({"league_id": league_id}, {"$set": new_state})
    st.update(new_state)

    # Log activity
    p = await db.players.find_one({"id": player_id}, {"_id": 0})
    if p:
        await db.activity.insert_one({
            "id": str(uuid.uuid4()),
            "league_id": league_id,
            "kind": "bid",
            "title": f"{p.get('name')} venduto a {amount}",
            "subtitle": f"Aggiudicato da {st.get('current_bidder_name') or 'un manager'}",
            "created_at": now_iso(),
        })
    return st


def _state_with_countdown(st: dict) -> dict:
    """Attach `seconds_remaining` derived from `bid_expires_at`."""
    exp = st.get("bid_expires_at")
    if not exp:
        st["seconds_remaining"] = None
        return st
    if isinstance(exp, str):
        try:
            exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except Exception:
            exp_dt = None
    else:
        exp_dt = exp
    if not exp_dt:
        st["seconds_remaining"] = None
        return st
    now = datetime.now(timezone.utc)
    if exp_dt.tzinfo is None:
        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
    delta = (exp_dt - now).total_seconds()
    st["seconds_remaining"] = max(0.0, round(delta, 1))
    return st


async def _maybe_expire_auction(league_id: str, st: dict) -> dict:
    """If bid timer has expired and there is a bidder, auto-assign."""
    if st.get("status") != "running":
        return st
    exp = st.get("bid_expires_at")
    if not exp or not st.get("current_bidder_id"):
        return st
    exp_dt = exp
    if isinstance(exp, str):
        try:
            exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except Exception:
            return st
    if exp_dt.tzinfo is None:
        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
    if exp_dt <= datetime.now(timezone.utc):
        st = await _perform_assign(league_id, st)
    return st


@api.get("/auction/{league_id}/state", response_model=AuctionState)
async def auction_state(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    st = await db.auction_state.find_one({"league_id": league_id}, {"_id": 0})
    if not st:
        first_player = await db.players.find_one({}, {"_id": 0})
        st = {
            "league_id": league_id,
            "active_player_id": first_player["id"] if first_player else None,
            "current_bid": 1,
            "current_bidder_id": None,
            "current_bidder_name": None,
            "status": "running",
            "bid_expires_at": None,
            "passed_user_ids": [],
        }
        await db.auction_state.insert_one(dict(st))
    # Lazy auto-assign if timer expired
    st = await _maybe_expire_auction(league_id, st)
    st = _state_with_countdown(st)
    st["bid_countdown_seconds"] = AUCTION_COUNTDOWN_SECONDS
    return AuctionState(**st)

@api.get("/auction/{league_id}/bids", response_model=List[Bid])
async def auction_bids(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.bids.find({"league_id": league_id}, {"_id": 0}).sort("created_at", -1).limit(50)
    return [Bid(**b) for b in await cursor.to_list(50)]

class BidRequest(BaseModel):
    amount: int = Field(gt=0)

@api.post("/auction/{league_id}/bid", response_model=AuctionState)
async def place_bid(league_id: str, body: BidRequest, current=Depends(get_current_user)):
    # ensure current user is a member
    membership = await db.memberships.find_one(
        {"league_id": league_id, "user_id": current["id"]}
    )
    if not membership:
        raise HTTPException(403, "Non sei membro di questa lega")
    st = await db.auction_state.find_one({"league_id": league_id}, {"_id": 0})
    if not st or st.get("status") != "running":
        raise HTTPException(400, "Asta non attiva")
    # If timer has expired, auto-assign first then refuse
    st = await _maybe_expire_auction(league_id, st)
    if st.get("status") != "running":
        raise HTTPException(400, "Il tempo per rilanciare è scaduto")
    if body.amount <= st.get("current_bid", 0):
        raise HTTPException(400, f"Il rilancio deve essere maggiore di {st.get('current_bid', 0)}")
    # Wallet check — user must have enough credits to cover their bid
    wallet = await db.wallets.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    remaining = (wallet or {}).get("remaining", 500)
    if body.amount > remaining:
        raise HTTPException(400, f"Fantamilioni insufficienti: ne hai {remaining}")
    bidder_label = membership.get("team_name") or current["name"]
    bid = {
        "id": str(uuid.uuid4()),
        "league_id": league_id,
        "player_id": st["active_player_id"],
        "user_id": current["id"],
        "user_name": bidder_label,
        "amount": body.amount,
        "created_at": now_iso(),
    }
    await db.bids.insert_one(dict(bid))
    new_expiry = datetime.now(timezone.utc) + timedelta(seconds=AUCTION_COUNTDOWN_SECONDS)
    st["current_bid"] = body.amount
    st["current_bidder_id"] = current["id"]
    st["current_bidder_name"] = bidder_label
    st["bid_expires_at"] = new_expiry.isoformat()
    st["passed_user_ids"] = []  # a new bid re-opens the round
    await db.auction_state.update_one(
        {"league_id": league_id},
        {"$set": {
            "current_bid": st["current_bid"],
            "current_bidder_id": st["current_bidder_id"],
            "current_bidder_name": st["current_bidder_name"],
            "bid_expires_at": st["bid_expires_at"],
            "passed_user_ids": [],
        }}
    )
    st = _state_with_countdown(st)
    st["bid_countdown_seconds"] = AUCTION_COUNTDOWN_SECONDS
    return AuctionState(**st)


@api.post("/auction/{league_id}/pass", response_model=AuctionState)
async def pass_bid(league_id: str, current=Depends(get_current_user)):
    """User declines to bid on the current player. If all remaining managers pass, auto-assign."""
    membership = await db.memberships.find_one(
        {"league_id": league_id, "user_id": current["id"]}
    )
    if not membership:
        raise HTTPException(403, "Non sei membro di questa lega")
    st = await db.auction_state.find_one({"league_id": league_id}, {"_id": 0})
    if not st or st.get("status") != "running":
        raise HTTPException(400, "Asta non attiva")
    if not st.get("current_bidder_id"):
        raise HTTPException(400, "Nessuna offerta da passare: attendi un rilancio")
    if current["id"] == st.get("current_bidder_id"):
        raise HTTPException(400, "Sei il miglior offerente, non puoi passare")

    passed = list(set(st.get("passed_user_ids") or []) | {current["id"]})
    st["passed_user_ids"] = passed
    await db.auction_state.update_one(
        {"league_id": league_id},
        {"$set": {"passed_user_ids": passed}},
    )

    # Check whether all other members (except current bidder) have passed
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0}) or {}
    member_ids = set(league.get("member_ids") or [])
    remaining = member_ids - {st["current_bidder_id"]} - set(passed)
    if not remaining:
        # everyone else has passed — auto assign
        st = await _perform_assign(league_id, st)

    st = _state_with_countdown(st)
    st["bid_countdown_seconds"] = AUCTION_COUNTDOWN_SECONDS
    return AuctionState(**st)

class NextPlayerRequest(BaseModel):
    player_id: str

@api.post("/auction/{league_id}/next", response_model=AuctionState)
async def next_player(league_id: str, body: NextPlayerRequest, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    p = await db.players.find_one({"id": body.player_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Giocatore non trovato")
    new_state = {
        "league_id": league_id,
        "active_player_id": body.player_id,
        "current_bid": 1,
        "current_bidder_id": None,
        "current_bidder_name": None,
        "status": "running",
        "bid_expires_at": None,
        "passed_user_ids": [],
    }
    await db.auction_state.update_one(
        {"league_id": league_id},
        {"$set": new_state},
        upsert=True,
    )
    new_state = _state_with_countdown(new_state)
    new_state["bid_countdown_seconds"] = AUCTION_COUNTDOWN_SECONDS
    return AuctionState(**new_state)


@api.post("/auction/{league_id}/assign", response_model=AuctionState)
async def assign_current_bid(league_id: str, current=Depends(get_current_user)):
    """Admin manually assigns the current active player to the highest bidder."""
    await require_admin(league_id, current)
    st = await db.auction_state.find_one({"league_id": league_id}, {"_id": 0})
    if not st or not st.get("active_player_id"):
        raise HTTPException(400, "Nessun giocatore in asta")
    if not st.get("current_bidder_id"):
        raise HTTPException(400, "Nessuna offerta valida da assegnare")
    st = await _perform_assign(league_id, st)
    st = _state_with_countdown(st)
    st["bid_countdown_seconds"] = AUCTION_COUNTDOWN_SECONDS
    return AuctionState(**st)


# ------------------------------------------------------------
# Wallets, Rosters & Fixtures
# ------------------------------------------------------------
@api.get("/leagues/{league_id}/wallet", response_model=Wallet)
async def my_wallet(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    w = await db.wallets.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not w:
        raise HTTPException(404, "Wallet non trovato")
    return Wallet(**w)


@api.get("/leagues/{league_id}/wallets", response_model=List[Wallet])
async def all_wallets(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.wallets.find({"league_id": league_id}, {"_id": 0})
    return [Wallet(**w) for w in await cursor.to_list(100)]


@api.get("/leagues/{league_id}/roster/{user_id}", response_model=Roster)
async def user_roster(league_id: str, user_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    r = await db.rosters.find_one({"league_id": league_id, "user_id": user_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Rosa non trovata")
    return Roster(**r)


@api.get("/leagues/{league_id}/fixtures", response_model=List[Fixture])
async def league_fixtures(
    league_id: str,
    matchday: Optional[int] = None,
    current=Depends(get_current_user),
):
    await require_membership(league_id, current)
    query = {"league_id": league_id}
    if matchday is not None:
        query["matchday"] = matchday
    cursor = db.fixtures.find(query, {"_id": 0}).sort([("matchday", 1)])
    return [Fixture(**f) for f in await cursor.to_list(1000)]


@api.post("/leagues/{league_id}/fixtures/regenerate", response_model=List[Fixture])
async def regenerate_fixtures(league_id: str, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    await build_fixtures(league_id)
    cursor = db.fixtures.find({"league_id": league_id}, {"_id": 0}).sort([("matchday", 1)])
    return [Fixture(**f) for f in await cursor.to_list(1000)]


# ------------------------------------------------------------
# Mercato di Riparazione (Transfer Window)
# ------------------------------------------------------------
class MercatoState(BaseModel):
    league_id: str
    transfer_window_open: bool


@api.post("/leagues/{league_id}/mercato/open", response_model=MercatoState)
async def mercato_open(league_id: str, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    await db.leagues.update_one({"id": league_id}, {"$set": {"transfer_window_open": True}})
    return MercatoState(league_id=league_id, transfer_window_open=True)


@api.post("/leagues/{league_id}/mercato/close", response_model=MercatoState)
async def mercato_close(league_id: str, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    await db.leagues.update_one({"id": league_id}, {"$set": {"transfer_window_open": False}})
    return MercatoState(league_id=league_id, transfer_window_open=False)


class ReleaseRequest(BaseModel):
    player_id: str


@api.post("/leagues/{league_id}/mercato/release", response_model=Wallet)
async def release_player(league_id: str, body: ReleaseRequest, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    mode = (league or {}).get("mode", "asta")
    if mode == "asta":
        if not (league or {}).get("transfer_window_open"):
            raise HTTPException(400, "Il mercato di riparazione non è aperto")
    else:  # listino
        if (league or {}).get("kickoff_locked"):
            raise HTTPException(400, "Il mercato è bloccato per il kickoff")
    roster = await db.rosters.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not roster:
        raise HTTPException(404, "Rosa non trovata")
    entry = next((e for e in roster.get("entries", []) if e["player_id"] == body.player_id), None)
    if not entry:
        raise HTTPException(404, "Giocatore non presente nella tua rosa")
    refund = max(1, int(entry["price_paid"] * 0.5))
    await db.rosters.update_one(
        {"league_id": league_id, "user_id": current["id"]},
        {"$pull": {"entries": {"player_id": body.player_id}}},
    )
    await db.wallets.update_one(
        {"league_id": league_id, "user_id": current["id"]},
        {"$inc": {"spent": -refund, "remaining": refund}},
    )
    w = await db.wallets.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    return Wallet(**w)


class BuyRequest(BaseModel):
    player_id: str


@api.post("/leagues/{league_id}/mercato/buy", response_model=Wallet)
async def buy_free_agent(league_id: str, body: BuyRequest, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    mode = (league or {}).get("mode", "asta")
    if mode == "asta":
        if not (league or {}).get("transfer_window_open"):
            raise HTTPException(400, "Il mercato di riparazione non è aperto")
        # Exclusivity check: only 1 owner across the league
        owned = await db.rosters.find_one(
            {"league_id": league_id, "entries.player_id": body.player_id}, {"_id": 0}
        )
        if owned:
            raise HTTPException(400, "Giocatore già di proprietà di un altro manager")
    else:  # listino
        if (league or {}).get("kickoff_locked"):
            raise HTTPException(400, "Il listino è bloccato per il kickoff")
        # Can't buy the same player twice yourself
        mine = await db.rosters.find_one(
            {"league_id": league_id, "user_id": current["id"], "entries.player_id": body.player_id},
            {"_id": 0},
        )
        if mine:
            raise HTTPException(400, "Questo giocatore è già nella tua rosa")
    player = await db.players.find_one({"id": body.player_id}, {"_id": 0})
    if not player:
        raise HTTPException(404, "Giocatore non trovato")
    price = int(player["price"])
    wallet = await db.wallets.find_one(
        {"league_id": league_id, "user_id": current["id"]}
    )
    if not wallet or wallet["remaining"] < price:
        raise HTTPException(400, f"Fantamilioni insufficienti: servono {price}")
    await db.wallets.update_one(
        {"league_id": league_id, "user_id": current["id"]},
        {"$inc": {"spent": price, "remaining": -price}},
    )
    await db.rosters.update_one(
        {"league_id": league_id, "user_id": current["id"]},
        {"$push": {"entries": {"player_id": body.player_id, "price_paid": price}}},
        upsert=True,
    )
    w = await db.wallets.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    return Wallet(**w)


@api.post("/leagues/{league_id}/kickoff/lock", response_model=League)
async def kickoff_lock(league_id: str, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    await db.leagues.update_one({"id": league_id}, {"$set": {"kickoff_locked": True}})
    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    return League(**l)


@api.post("/leagues/{league_id}/kickoff/unlock", response_model=League)
async def kickoff_unlock(league_id: str, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    await db.leagues.update_one({"id": league_id}, {"$set": {"kickoff_locked": False}})
    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    return League(**l)


class LeagueSettingsUpdate(BaseModel):
    start_matchday: Optional[int] = Field(default=None, ge=1, le=38)
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)


@api.patch("/leagues/{league_id}/settings", response_model=League)
async def update_league_settings(
    league_id: str,
    body: LeagueSettingsUpdate,
    current=Depends(get_current_user),
):
    """Admin-only: update mutable league settings.
    - `start_matchday`: only editable BEFORE kickoff is locked (regenerates fixtures).
    - `name`: always editable by admin.
    """
    await require_admin(league_id, current)
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(404, "Lega non trovata")

    updates: dict = {}
    regenerate = False
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.start_matchday is not None:
        if league.get("kickoff_locked"):
            raise HTTPException(400, "Non puoi cambiare la giornata di partenza dopo il kickoff")
        new_md = int(body.start_matchday)
        if new_md != int(league.get("start_matchday") or 1):
            updates["start_matchday"] = new_md
            regenerate = True

    if updates:
        await db.leagues.update_one({"id": league_id}, {"$set": updates})
    if regenerate:
        await build_fixtures(league_id)

    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    return League(**l)


@api.get("/leagues/{league_id}/free-agents", response_model=List[Player])
async def free_agents(
    league_id: str,
    role: Optional[Role] = None,
    q: Optional[str] = None,
    current=Depends(get_current_user),
):
    await require_membership(league_id, current)
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    mode = (league or {}).get("mode", "asta")
    owned_ids: set = set()
    if mode == "asta":
        # Only players not owned by anyone in the league
        cursor = db.rosters.find({"league_id": league_id}, {"_id": 0, "entries": 1})
        async for r in cursor:
            for e in r.get("entries", []):
                owned_ids.add(e["player_id"])
    else:
        # Listino: exclude only players already in MY roster (others can still own them)
        mine = await db.rosters.find_one(
            {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
        )
        if mine:
            owned_ids = {e["player_id"] for e in mine.get("entries", [])}
    query = {"id": {"$nin": list(owned_ids)}} if owned_ids else {}
    if role:
        query["role"] = role
    if q:
        query["name"] = {"$regex": re.escape(q[:64]), "$options": "i"}
    cur2 = db.players.find(query, {"_id": 0}).sort("price", -1).limit(120)
    return [Player(**p) for p in await cur2.to_list(120)]


# ------------------------------------------------------------
# Live Matchday Feed
# ------------------------------------------------------------
@api.get("/live-events", response_model=List[LiveEvent])
async def get_live_events(matchday: Optional[int] = None, current=Depends(get_current_user)):
    query = {}
    if matchday is not None:
        query["matchday"] = matchday
    cursor = db.live_events.find(query, {"_id": 0}).sort("created_at", -1).limit(60)
    return [LiveEvent(**e) for e in await cursor.to_list(60)]


class LiveEventCreate(BaseModel):
    matchday: int
    player_name: str
    team: str
    kind: str
    minute: int
    description: str
    player_id: Optional[str] = None


@api.post("/live-events", response_model=LiveEvent)
async def create_live_event(body: LiveEventCreate, current=Depends(get_current_user)):
    ev = {
        "id": str(uuid.uuid4()),
        "matchday": body.matchday,
        "player_id": body.player_id,
        "player_name": body.player_name,
        "team": body.team,
        "kind": body.kind,
        "minute": body.minute,
        "description": body.description,
        "created_at": now_iso(),
    }
    await db.live_events.insert_one(dict(ev))
    return LiveEvent(**ev)

# ------------------------------------------------------------
# Regulations
# ------------------------------------------------------------
@api.get("/regulations/{league_id}", response_model=Regulations)
async def get_regulations(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    r = await db.regulations.find_one({"league_id": league_id}, {"_id": 0})
    if not r:
        r = Regulations(league_id=league_id).model_dump()
        await db.regulations.insert_one(dict(r))
    return Regulations(**r)

@api.put("/regulations/{league_id}", response_model=Regulations)
async def update_regulations(league_id: str, body: Regulations, current=Depends(get_current_user)):
    await require_admin(league_id, current)
    body_dict = body.model_dump()
    body_dict["league_id"] = league_id
    await db.regulations.update_one(
        {"league_id": league_id},
        {"$set": body_dict},
        upsert=True,
    )
    return Regulations(**body_dict)

# ------------------------------------------------------------
# Standings & Activity
# ------------------------------------------------------------
@api.get("/standings/{league_id}", response_model=List[StandingRow])
async def standings(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.standings.find({"league_id": league_id}, {"_id": 0}).sort("points", -1)
    rows = await cursor.to_list(50)
    # backfill team_name from memberships if missing
    result: List[StandingRow] = []
    for r in rows:
        team = r.get("team_name")
        if not team:
            m = await db.memberships.find_one(
                {"league_id": league_id, "user_id": r["user_id"]}, {"_id": 0}
            )
            team = (m or {}).get("team_name") or r.get("user_name", "—")
        result.append(StandingRow(
            user_id=r["user_id"], user_name=r.get("user_name", "—"),
            team_name=team, played=r["played"], wins=r["wins"],
            draws=r["draws"], losses=r["losses"], points=r["points"],
            goals_for=r["goals_for"], goals_against=r["goals_against"],
        ))
    return result

@api.get("/activity/{league_id}", response_model=List[Activity])
async def activity(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.activity.find({"league_id": league_id}, {"_id": 0}).sort("created_at", -1).limit(30)
    items = await cursor.to_list(30)
    return [Activity(**a) for a in items]

# ------------------------------------------------------------
# Matchday Scoring Engine (Fantavoto + Bench subs + Standings)
# ------------------------------------------------------------
FORMATION_SLOTS: Dict[str, Dict[str, int]] = {
    "4-3-3": {"P": 1, "D": 4, "C": 3, "A": 3},
    "3-4-3": {"P": 1, "D": 3, "C": 4, "A": 3},
    "3-5-2": {"P": 1, "D": 3, "C": 5, "A": 2},
    "4-4-2": {"P": 1, "D": 4, "C": 4, "A": 2},
    "4-5-1": {"P": 1, "D": 4, "C": 5, "A": 1},
    "5-3-2": {"P": 1, "D": 5, "C": 3, "A": 2},
    "5-4-1": {"P": 1, "D": 5, "C": 4, "A": 1},
}

PENALTY_SAVED_BONUS = 3.0
PENALTY_MISSED_BONUS = -3.0
OWN_GOAL_BONUS = -2.0


class PlayerRatingIn(BaseModel):
    player_id: str
    # None means "Senza Voto" (S.V.) — engine assigns a d'ufficio base if there are events
    base_vote: Optional[float] = Field(default=None, ge=0, le=10)
    goals: int = 0
    assists: int = 0
    yellow: int = 0
    red: int = 0
    own_goal: int = 0
    penalty_saved: int = 0
    penalty_missed: int = 0
    played: bool = True


class PlayerRating(BaseModel):
    league_id: str
    matchday: int
    player_id: str
    player_name: str
    role: Role
    team: str
    base_vote: Optional[float] = None  # None == S.V.
    goals: int = 0
    assists: int = 0
    yellow: int = 0
    red: int = 0
    own_goal: int = 0
    penalty_saved: int = 0
    penalty_missed: int = 0
    played: bool = True
    fantavoto: float = 0.0
    sv: bool = False  # true when base_vote was S.V.
    effective_base: Optional[float] = None  # what was actually used (after d'ufficio rules)


class MockRatingsBody(BaseModel):
    chaos: float = Field(default=0.5, ge=0, le=1)


class ManagerScore(BaseModel):
    user_id: str
    user_name: str
    team_name: str
    formation: str
    fantavoto: float
    goals_scored: int
    starters: List[dict]  # {player_id, name, role, fantavoto, from_bench: bool}
    bench_used: List[str]  # player_ids that came in


class SettleReport(BaseModel):
    league_id: str
    matchday: int
    settled_at: datetime
    fixtures: List[dict]  # {home_user_id, away_user_id, home_score, away_score, home_fv, away_fv, is_bye}
    scores: List[ManagerScore]


def _resolve_base_vote(rating: dict) -> Optional[float]:
    """Apply Voto d'Ufficio rules for S.V. (Senza Voto) ratings.
    Returns the effective base_vote to use, or None if the player should be
    treated as 'did not play' (S.V. with no bonus/malus events → bench substitution).
    """
    base = rating.get("base_vote")
    is_sv = base is None
    if not is_sv:
        return float(base)
    # S.V. → look for meaningful events
    red = int(rating.get("red") or 0)
    goals = int(rating.get("goals") or 0)
    assists = int(rating.get("assists") or 0)
    pen_saved = int(rating.get("penalty_saved") or 0)
    pen_missed = int(rating.get("penalty_missed") or 0)
    own_goal = int(rating.get("own_goal") or 0)
    if red > 0:
        return 4.0  # espulsione → voto d'ufficio 4
    if goals > 0 or assists > 0 or pen_saved > 0 or pen_missed > 0 or own_goal > 0:
        return 6.0  # gol/assist/rigore/autogol → voto d'ufficio 6
    return None  # no events → trigger bench substitution


def compute_fantavoto(rating: dict, role: str, regs: dict) -> Optional[float]:
    """Apply regulations bonus/malus to a single player rating.
    Returns None when the player must be substituted from the bench
    (either 'not played' or S.V. without meaningful events).
    """
    if not rating.get("played", True):
        return None
    base = _resolve_base_vote(rating)
    if base is None:
        return None  # S.V. senza eventi → panchina
    fv = float(base)
    goals = int(rating.get("goals") or 0)
    assists = int(rating.get("assists") or 0)
    yellow = int(rating.get("yellow") or 0)
    red = int(rating.get("red") or 0)
    own_goal = int(rating.get("own_goal") or 0)
    pen_saved = int(rating.get("penalty_saved") or 0)
    pen_missed = int(rating.get("penalty_missed") or 0)

    if role == "A":
        fv += goals * float(regs.get("goal_bonus_a", 3.0))
    elif role == "C":
        fv += goals * float(regs.get("goal_bonus_c", 3.5))
    elif role == "D":
        fv += goals * float(regs.get("goal_bonus_d", 4.0))

    fv += assists * float(regs.get("assist_bonus", 1.0))
    fv += yellow * float(regs.get("yellow_card", -0.5))
    fv += red * float(regs.get("red_card", -1.0))
    fv += pen_saved * PENALTY_SAVED_BONUS
    fv += pen_missed * PENALTY_MISSED_BONUS
    fv += own_goal * OWN_GOAL_BONUS

    return round(fv, 2)


def fantavoto_to_goals(fv: float) -> int:
    """Classic Fantacalcio conversion: 66=1, 72=2, 78=3, ..."""
    if fv < 66:
        return 0
    return int((fv - 60) // 6)


async def _auto_lineup_for_user(league_id: str, user_id: str, formation: str = "4-3-3") -> Tuple[List[dict], List[dict]]:
    """Build starters + bench based on the user's roster.
    Sort roster by player avg_vote descending, then fill slots by role.
    Returns (starters, bench) each a list of player docs with role/name/etc.
    """
    roster = await db.rosters.find_one({"league_id": league_id, "user_id": user_id}, {"_id": 0})
    if not roster or not roster.get("entries"):
        return [], []
    pids = [e["player_id"] for e in roster["entries"]]
    players = await db.players.find({"id": {"$in": pids}}, {"_id": 0}).to_list(500)
    slots = FORMATION_SLOTS.get(formation, FORMATION_SLOTS["4-3-3"])

    by_role: Dict[str, List[dict]] = {"P": [], "D": [], "C": [], "A": []}
    for p in players:
        by_role.setdefault(p["role"], []).append(p)
    for r in by_role:
        by_role[r].sort(key=lambda x: (float(x.get("avg_vote") or 0), int(x.get("price") or 0)), reverse=True)

    starters: List[dict] = []
    bench: List[dict] = []
    for role, count in slots.items():
        pool = by_role.get(role, [])
        starters.extend(pool[:count])
        # bench: up to 3 P substitutes for P (usually 1), others: rest of role
        bench.extend(pool[count:])
    return starters, bench


async def _load_ratings_map(league_id: str, matchday: int) -> Dict[str, dict]:
    docs = await db.player_ratings.find(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    ).to_list(5000)
    return {d["player_id"]: d for d in docs}


async def _regulations_dict(league_id: str) -> dict:
    r = await db.regulations.find_one({"league_id": league_id}, {"_id": 0})
    if not r:
        r = Regulations(league_id=league_id).model_dump()
    return r


async def _lineup_for_user(league_id: str, matchday: int, user_id: str) -> Tuple[str, List[dict], List[dict]]:
    """Return (formation, starters, bench) for a user in this matchday.
    Uses saved lineup if present, otherwise auto-generates.
    """
    saved = await db.matchday_lineups.find_one(
        {"league_id": league_id, "matchday": matchday, "user_id": user_id}, {"_id": 0}
    )
    if saved and saved.get("starters"):
        pids = list(saved["starters"]) + list(saved.get("bench", []))
        players = await db.players.find({"id": {"$in": pids}}, {"_id": 0}).to_list(500)
        by_id = {p["id"]: p for p in players}
        starters = [by_id[pid] for pid in saved["starters"] if pid in by_id]
        bench = [by_id[pid] for pid in saved.get("bench", []) if pid in by_id]
        return saved.get("formation", "4-3-3"), starters, bench
    # auto
    formation = "4-3-3"
    starters, bench = await _auto_lineup_for_user(league_id, user_id, formation)
    return formation, starters, bench


def _apply_bench_subs(
    starters: List[dict], bench: List[dict], ratings_map: Dict[str, dict], regs: dict
) -> Tuple[List[dict], List[str]]:
    """Replace any starter without a rating or that didn't play with a bench player of the same role.
    Returns (final_lineup_with_fv, bench_ids_used).
    Each entry in final list is a dict: {player_id, name, role, fantavoto, from_bench}
    """
    bench_by_role: Dict[str, List[dict]] = {"P": [], "D": [], "C": [], "A": []}
    for b in bench:
        bench_by_role.setdefault(b["role"], []).append(b)

    result: List[dict] = []
    bench_used_ids: List[str] = []
    for st in starters:
        r = ratings_map.get(st["id"])
        fv = compute_fantavoto(r, st["role"], regs) if r else None
        if fv is not None:
            result.append({
                "player_id": st["id"], "name": st["name"], "role": st["role"],
                "fantavoto": fv, "from_bench": False,
            })
            continue
        # try substitute from bench (same role) with a valid computed fantavoto
        sub = None
        sub_fv = None
        pool = bench_by_role.get(st["role"], [])
        for cand in pool:
            cr = ratings_map.get(cand["id"])
            if not cr:
                continue
            cfv = compute_fantavoto(cr, cand["role"], regs)
            if cfv is not None:
                sub = cand
                sub_fv = cfv
                break
        if sub is not None:
            pool.remove(sub)
            result.append({
                "player_id": sub["id"], "name": sub["name"], "role": sub["role"],
                "fantavoto": sub_fv, "from_bench": True,
            })
            bench_used_ids.append(sub["id"])
        else:
            # no substitute available: slot yields 0 fantavoto
            result.append({
                "player_id": st["id"], "name": st["name"], "role": st["role"],
                "fantavoto": 0.0, "from_bench": False,
            })
    return result, bench_used_ids


# ---- Endpoints ----

@api.get("/leagues/{league_id}/matchday/{matchday}/ratings", response_model=List[PlayerRating])
async def get_matchday_ratings(league_id: str, matchday: int, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    cursor = db.player_ratings.find(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    ).sort("player_name", 1)
    return [PlayerRating(**r) for r in await cursor.to_list(5000)]


class ManualRatingsBody(BaseModel):
    ratings: List[PlayerRatingIn]


@api.post("/leagues/{league_id}/matchday/{matchday}/ratings/manual", response_model=dict)
async def upload_ratings_manual(
    league_id: str, matchday: int, body: ManualRatingsBody, current=Depends(get_current_user)
):
    """Admin uploads a list of player ratings for a specific matchday."""
    await require_admin(league_id, current)
    if matchday < 1 or matchday > 38:
        raise HTTPException(400, "Giornata non valida")
    if not body.ratings:
        raise HTTPException(400, "Lista voti vuota")

    # look up players once to enrich ratings with name/role/team
    pids = [r.player_id for r in body.ratings]
    players = await db.players.find({"id": {"$in": pids}}, {"_id": 0}).to_list(len(pids))
    p_by_id = {p["id"]: p for p in players}
    if len(p_by_id) != len(set(pids)):
        missing = [pid for pid in pids if pid not in p_by_id]
        raise HTTPException(400, f"Giocatori non trovati: {missing[:5]}")

    regs = await _regulations_dict(league_id)

    # delete existing ratings for this matchday (idempotent)
    await db.player_ratings.delete_many({"league_id": league_id, "matchday": matchday})
    docs = []
    for r in body.ratings:
        p = p_by_id[r.player_id]
        d = r.model_dump()
        d.update({
            "league_id": league_id,
            "matchday": matchday,
            "player_name": p["name"],
            "role": p["role"],
            "team": p["team"],
        })
        d["sv"] = d.get("base_vote") is None
        d["effective_base"] = _resolve_base_vote(d)
        fv = compute_fantavoto(d, p["role"], regs)
        d["fantavoto"] = fv if fv is not None else 0.0
        docs.append(d)
    await db.player_ratings.insert_many(docs)
    return {"inserted": len(docs), "matchday": matchday, "source": "manual"}


@api.post("/leagues/{league_id}/matchday/{matchday}/ratings/mock", response_model=dict)
async def generate_mock_ratings(
    league_id: str, matchday: int, body: MockRatingsBody, current=Depends(get_current_user)
):
    """Generate smart mock ratings for every player owned by any manager in this league."""
    await require_admin(league_id, current)
    if matchday < 1 or matchday > 38:
        raise HTTPException(400, "Giornata non valida")

    # collect all player_ids from all rosters in this league
    rosters = await db.rosters.find({"league_id": league_id}, {"_id": 0}).to_list(200)
    pids: set = set()
    for r in rosters:
        for e in (r.get("entries") or []):
            pids.add(e["player_id"])
    if not pids:
        raise HTTPException(400, "Nessun giocatore in rosa per questa lega")

    players = await db.players.find({"id": {"$in": list(pids)}}, {"_id": 0}).to_list(len(pids))
    regs = await _regulations_dict(league_id)

    # Seed the random generator deterministically per (league, matchday) so mock is reproducible
    rng = random.Random(f"{league_id}-{matchday}-mock")
    chaos = max(0.0, min(1.0, float(body.chaos)))

    await db.player_ratings.delete_many({"league_id": league_id, "matchday": matchday})
    docs = []
    for p in players:
        base_center = float(p.get("avg_vote") or 6.0)
        # base_vote sampled around avg with variance driven by `chaos`
        base_vote_num = base_center + rng.uniform(-1.0, 1.0) * (0.4 + chaos * 0.8)
        base_vote_num = max(3.0, min(9.5, round(base_vote_num, 1)))
        played = rng.random() > (0.05 + chaos * 0.10)  # 85-95% chance of playing

        # ~7-10% of players who played receive S.V. (Senza Voto)
        is_sv = played and rng.random() < (0.05 + chaos * 0.05)
        base_vote: Optional[float] = None if is_sv else base_vote_num

        goals = 0
        assists = 0
        yellow = 0
        red = 0
        own_goal = 0
        pen_saved = 0
        pen_missed = 0

        if played:
            role = p["role"]
            price = int(p.get("price") or 1)
            # scoring probabilities scaled by role and price
            if role == "A":
                p_goal = 0.18 + min(price, 50) / 300.0
                p_assist = 0.10
            elif role == "C":
                p_goal = 0.09 + min(price, 30) / 400.0
                p_assist = 0.14
            elif role == "D":
                p_goal = 0.04 + min(price, 20) / 500.0
                p_assist = 0.06
            else:  # P
                p_goal = 0.002
                p_assist = 0.01
            if rng.random() < p_goal * (1 + chaos):
                goals = 1 if rng.random() > 0.15 else 2
            if rng.random() < p_assist * (1 + chaos * 0.5):
                assists = 1
            if rng.random() < 0.14:
                yellow = 1
            if rng.random() < 0.02:
                red = 1
            if role == "P" and rng.random() < 0.03:
                pen_saved = 1
            if role in ("A", "C") and rng.random() < 0.015:
                pen_missed = 1
            if rng.random() < 0.008:
                own_goal = 1

        d = {
            "league_id": league_id,
            "matchday": matchday,
            "player_id": p["id"],
            "player_name": p["name"],
            "role": p["role"],
            "team": p["team"],
            "base_vote": base_vote,
            "goals": goals,
            "assists": assists,
            "yellow": yellow,
            "red": red,
            "own_goal": own_goal,
            "penalty_saved": pen_saved,
            "penalty_missed": pen_missed,
            "played": played,
            "sv": is_sv,
        }
        d["effective_base"] = _resolve_base_vote(d)
        fv = compute_fantavoto(d, p["role"], regs)
        d["fantavoto"] = fv if fv is not None else 0.0
        docs.append(d)

    if docs:
        await db.player_ratings.insert_many(docs)
    return {"inserted": len(docs), "matchday": matchday, "source": "mock", "chaos": chaos}


@api.get("/leagues/{league_id}/matchday/{matchday}/status", response_model=dict)
async def matchday_status(league_id: str, matchday: int, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    r_count = await db.player_ratings.count_documents(
        {"league_id": league_id, "matchday": matchday}
    )
    settled = await db.matchday_results.find_one(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    )
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0}) or {}
    return {
        "league_id": league_id,
        "matchday": matchday,
        "start_matchday": int(league.get("start_matchday") or 1),
        "has_ratings": r_count > 0,
        "ratings_count": r_count,
        "settled": bool(settled),
        "settled_at": (settled or {}).get("settled_at"),
    }


@api.post("/leagues/{league_id}/matchday/{matchday}/settle", response_model=SettleReport)
async def settle_matchday(
    league_id: str, matchday: int, current=Depends(get_current_user)
):
    """Compute fantavoto per manager (with bench subs), update fixtures & standings."""
    await require_admin(league_id, current)
    if matchday < 1 or matchday > 38:
        raise HTTPException(400, "Giornata non valida")

    ratings_map = await _load_ratings_map(league_id, matchday)
    if not ratings_map:
        raise HTTPException(400, "Non ci sono voti caricati per questa giornata")

    # prevent double-settle
    existing = await db.matchday_results.find_one({"league_id": league_id, "matchday": matchday}, {"_id": 0})
    if existing:
        raise HTTPException(409, "Questa giornata è già stata calcolata. Ripristinala prima di ricalcolare.")

    regs = await _regulations_dict(league_id)

    # fixtures for this matchday
    fixtures = await db.fixtures.find(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    ).to_list(50)
    if not fixtures:
        raise HTTPException(400, "Nessuna partita in calendario per questa giornata")

    # collect all managers involved (from fixtures)
    manager_ids: List[str] = []
    for f in fixtures:
        if f.get("home_user_id"): manager_ids.append(f["home_user_id"])
        if f.get("away_user_id"): manager_ids.append(f["away_user_id"])
        if f.get("bye_user_id"): manager_ids.append(f["bye_user_id"])
    manager_ids = list(set(manager_ids))

    memberships = await db.memberships.find(
        {"league_id": league_id, "user_id": {"$in": manager_ids}}, {"_id": 0}
    ).to_list(50)
    mem_by_uid = {m["user_id"]: m for m in memberships}

    # compute score per manager
    scores: List[ManagerScore] = []
    scores_by_uid: Dict[str, ManagerScore] = {}
    for uid in manager_ids:
        formation, starters, bench = await _lineup_for_user(league_id, matchday, uid)
        final_lineup, bench_used = _apply_bench_subs(starters, bench, ratings_map, regs)
        total_fv = round(sum(item["fantavoto"] for item in final_lineup), 2)
        goals = fantavoto_to_goals(total_fv)
        mem = mem_by_uid.get(uid, {})
        ms = ManagerScore(
            user_id=uid,
            user_name=mem.get("user_name", "—"),
            team_name=mem.get("team_name", "—"),
            formation=formation,
            fantavoto=total_fv,
            goals_scored=goals,
            starters=final_lineup,
            bench_used=bench_used,
        )
        scores.append(ms)
        scores_by_uid[uid] = ms

    # apply results to fixtures + standings
    fixture_results: List[dict] = []
    for f in fixtures:
        if f.get("is_bye"):
            fixture_results.append({
                "matchday": matchday, "is_bye": True,
                "bye_user_id": f.get("bye_user_id"),
                "bye_team": f.get("bye_team"),
            })
            continue
        h = scores_by_uid.get(f["home_user_id"])
        a = scores_by_uid.get(f["away_user_id"])
        if not h or not a:
            continue
        hg, ag = h.goals_scored, a.goals_scored
        fixture_results.append({
            "matchday": matchday, "is_bye": False,
            "home_user_id": f["home_user_id"], "home_team": f.get("home_team"),
            "away_user_id": f["away_user_id"], "away_team": f.get("away_team"),
            "home_fv": h.fantavoto, "away_fv": a.fantavoto,
            "home_score": hg, "away_score": ag,
        })
        # update fixture with result
        await db.fixtures.update_one(
            {"league_id": league_id, "matchday": matchday,
             "home_user_id": f["home_user_id"], "away_user_id": f["away_user_id"]},
            {"$set": {
                "home_score": hg, "away_score": ag,
                "home_fv": h.fantavoto, "away_fv": a.fantavoto,
                "settled": True,
            }}
        )
        # update standings for both
        for uid, gf, ga in [(f["home_user_id"], hg, ag), (f["away_user_id"], ag, hg)]:
            win = 1 if gf > ga else 0
            draw = 1 if gf == ga else 0
            loss = 1 if gf < ga else 0
            pts = 3 if win else (1 if draw else 0)
            await db.standings.update_one(
                {"league_id": league_id, "user_id": uid},
                {
                    "$inc": {
                        "played": 1, "wins": win, "draws": draw, "losses": loss,
                        "points": pts, "goals_for": gf, "goals_against": ga,
                    },
                    "$setOnInsert": {
                        "league_id": league_id, "user_id": uid,
                        "user_name": mem_by_uid.get(uid, {}).get("user_name", "—"),
                        "team_name": mem_by_uid.get(uid, {}).get("team_name", "—"),
                    },
                },
                upsert=True,
            )

    settled_at = datetime.now(timezone.utc)
    report = {
        "league_id": league_id,
        "matchday": matchday,
        "settled_at": settled_at.isoformat(),
        "fixtures": fixture_results,
        "scores": [s.model_dump() for s in scores],
    }
    await db.matchday_results.insert_one(dict(report))

    # activity entry
    await db.activity.insert_one({
        "id": str(uuid.uuid4()),
        "league_id": league_id,
        "kind": "info",
        "title": f"Giornata {matchday}ª calcolata",
        "subtitle": f"{len([r for r in fixture_results if not r.get('is_bye')])} match aggiornati in classifica",
        "created_at": settled_at.isoformat(),
    })

    return SettleReport(
        league_id=league_id, matchday=matchday, settled_at=settled_at,
        fixtures=fixture_results, scores=scores,
    )


@api.get("/leagues/{league_id}/matchday/{matchday}/results", response_model=Optional[SettleReport])
async def get_matchday_results(
    league_id: str, matchday: int, current=Depends(get_current_user)
):
    await require_membership(league_id, current)
    doc = await db.matchday_results.find_one(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    )
    if not doc:
        return None
    return SettleReport(
        league_id=doc["league_id"], matchday=doc["matchday"],
        settled_at=doc["settled_at"],
        fixtures=doc.get("fixtures", []),
        scores=[ManagerScore(**s) for s in doc.get("scores", [])],
    )


@api.post("/leagues/{league_id}/matchday/{matchday}/reset", response_model=dict)
async def reset_matchday(
    league_id: str, matchday: int, current=Depends(get_current_user)
):
    """Undo settlement: subtract from standings, clear fixture results, delete results record."""
    await require_admin(league_id, current)
    existing = await db.matchday_results.find_one(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Questa giornata non è stata calcolata")

    # subtract from standings
    for fr in existing.get("fixtures", []):
        if fr.get("is_bye"): continue
        for uid, gf, ga in [
            (fr.get("home_user_id"), fr.get("home_score", 0), fr.get("away_score", 0)),
            (fr.get("away_user_id"), fr.get("away_score", 0), fr.get("home_score", 0)),
        ]:
            if not uid: continue
            win = 1 if gf > ga else 0
            draw = 1 if gf == ga else 0
            loss = 1 if gf < ga else 0
            pts = 3 if win else (1 if draw else 0)
            await db.standings.update_one(
                {"league_id": league_id, "user_id": uid},
                {"$inc": {
                    "played": -1, "wins": -win, "draws": -draw, "losses": -loss,
                    "points": -pts, "goals_for": -gf, "goals_against": -ga,
                }},
            )
        # clear fixture result
        await db.fixtures.update_one(
            {"league_id": league_id, "matchday": matchday,
             "home_user_id": fr.get("home_user_id"), "away_user_id": fr.get("away_user_id")},
            {"$unset": {"home_score": "", "away_score": "", "home_fv": "", "away_fv": "", "settled": ""}}
        )

    await db.matchday_results.delete_one({"league_id": league_id, "matchday": matchday})
    # keep ratings, admin may want to re-run settle
    return {"reset": True, "matchday": matchday}


# ------------------------------------------------------------
# Dashboard summary
# ------------------------------------------------------------
class DashboardSummary(BaseModel):
    league: League
    my_team_name: str
    rank: int
    points: int
    next_matchday: int
    next_kickoff: datetime
    members: int

@api.get("/dashboard/{league_id}", response_model=DashboardSummary)
async def dashboard(league_id: str, current=Depends(get_current_user)):
    await require_membership(league_id, current)
    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not l:
        raise HTTPException(404, "Lega non trovata")
    rows = await db.standings.find({"league_id": league_id}, {"_id": 0}).sort("points", -1).to_list(50)
    rank = 0
    points = 0
    for i, r in enumerate(rows):
        if r["user_id"] == current["id"]:
            rank = i + 1
            points = r["points"]
            break
    if rank == 0:
        rank = max(len(rows), 1)

    m = await db.memberships.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    team_name = (m or {}).get("team_name") or current["name"]
    # Compute the next matchday for this league (min matchday from fixtures)
    first_fixture = await db.fixtures.find_one(
        {"league_id": league_id}, {"_id": 0}, sort=[("matchday", 1)]
    )
    start_md = int(l.get("start_matchday") or 1)
    next_md = int((first_fixture or {}).get("matchday") or start_md)
    return DashboardSummary(
        league=League(**l),
        my_team_name=team_name,
        rank=rank,
        points=points,
        next_matchday=next_md,
        next_kickoff=datetime.now(timezone.utc) + timedelta(days=2, hours=3),
        members=len(l.get("member_ids", [])),
    )

# ------------------------------------------------------------
# Seed
# ------------------------------------------------------------

LISTONE_PATH = ROOT_DIR / "data" / "players_listone.json"


def load_official_listone() -> List[tuple]:
    """Load the official Fantacampionato listone (Nome | Squadra | Ruolo | QI)."""
    if not LISTONE_PATH.exists():
        logging.warning("Official listone file not found at %s", LISTONE_PATH)
        return []
    with LISTONE_PATH.open("r", encoding="utf-8") as f:
        data = _json.load(f)
    result = []
    for row in data:
        result.append((
            row["name"],
            row["team"],
            row["role"],
            int(row.get("price", 1)),
        ))
    return result


DEMO_MEMBERS = [
    ("mario.rossi@fanta.it", "Mario Rossi", "Roma Devils"),
    ("luca.bianchi@fanta.it", "Luca Bianchi", "Napoli Kings"),
    ("giorgio.verdi@fanta.it", "Giorgio Verdi", "Juventus FC"),
    ("paolo.neri@fanta.it", "Paolo Neri", "Inter Legends"),
    ("stefano.gialli@fanta.it", "Stefano Gialli", "Torino United"),
    ("antonio.blu@fanta.it", "Antonio Blu", "Bologna Stars"),
]
DEMO_ADMIN = ("demo@fanta.it", "Demo Manager", "Milano Warriors")
DEMO_LEAGUE_CODE = "123456"


async def ensure_indexes():
    await db.leagues.create_index("code", unique=True, sparse=True)
    await db.memberships.create_index([("league_id", 1), ("user_id", 1)], unique=True)
    await db.memberships.create_index([("league_id", 1), ("team_name", 1)])
    await db.users.create_index("email", unique=True)
    await db.players.create_index("id", unique=True)


async def seed():
    await ensure_indexes()

    meta = await db.meta.find_one({"_id": "seed"})
    version = (meta or {}).get("version", 0)

    if version < SEED_VERSION:
        logging.info("Re-seeding to version %d (was %d)", SEED_VERSION, version)
        # keep users; drop volatile collections
        await db.players.drop()
        await db.leagues.drop()
        await db.memberships.drop()
        await db.regulations.drop()
        await db.standings.drop()
        await db.activity.drop()
        await db.auction_state.drop()
        await db.bids.drop()
        await db.wallets.drop()
        await db.rosters.drop()
        await db.fixtures.drop()
        await db.live_events.drop()
        await ensure_indexes()

    # Players — official listone loaded from JSON file
    if await db.players.count_documents({}) == 0:
        listone = load_official_listone()
        if not listone:
            logging.error("Cannot seed players: listone is empty!")
        else:
            docs = []
            random.seed(42)
            for i, (name, team, role, price) in enumerate(listone):
                avg_vote = round(5.8 + min(price, 60) / 120.0 + random.random() * 0.35, 2)
                docs.append({
                    "id": f"p{i+1:04d}",
                    "name": name, "team": team, "role": role, "price": price,
                    "avg_vote": avg_vote,
                    "goals": random.randint(2, 20) if role in ("A", "C") and price >= 20 else random.randint(0, 5),
                    "assists": random.randint(0, 12) if price >= 15 else random.randint(0, 4),
                })
            await db.players.insert_many(docs)
            logging.info("Seeded %d players from official listone", len(docs))

    # Seed users (demo + members)
    demo_email, demo_name, demo_team = DEMO_ADMIN
    demo = await db.users.find_one({"email": demo_email})
    if not demo:
        demo_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": demo_id, "email": demo_email, "name": demo_name,
            "password_hash": pwd_ctx.hash("demo1234"),
            "created_at": now_iso(),
        })
    else:
        demo_id = demo["id"]

    member_records = []
    for email, name, team_name in DEMO_MEMBERS:
        u = await db.users.find_one({"email": email})
        if not u:
            uid = str(uuid.uuid4())
            await db.users.insert_one({
                "id": uid, "email": email, "name": name,
                "password_hash": pwd_ctx.hash("password123"),
                "created_at": now_iso(),
            })
            member_records.append((uid, name, team_name))
        else:
            member_records.append((u["id"], name, team_name))

    # Demo league
    league = await db.leagues.find_one({"is_demo": True}, {"_id": 0})
    if not league:
        league_id = str(uuid.uuid4())
        all_member_ids = [demo_id] + [uid for uid, _, _ in member_records]
        await db.leagues.insert_one({
            "id": league_id,
            "name": "Lega Campionato Italiano 2025/26",
            "code": DEMO_LEAGUE_CODE,
            "admin_id": demo_id,
            "member_ids": all_member_ids,
            "mode": "asta",
            "budget_per_user": 500,
            "transfer_window_open": False,
            "kickoff_locked": False,
            "start_matchday": 1,
            "created_at": now_iso(),
            "is_demo": True,
        })
        # memberships
        await db.memberships.insert_one({
            "league_id": league_id, "user_id": demo_id,
            "user_name": demo_name, "team_name": demo_team,
            "role": "admin", "joined_at": now_iso(),
        })
        for uid, name, team_name in member_records:
            await db.memberships.insert_one({
                "league_id": league_id, "user_id": uid,
                "user_name": name, "team_name": team_name,
                "role": "member", "joined_at": now_iso(),
            })
        # regulations
        await db.regulations.insert_one(Regulations(league_id=league_id).model_dump())
        # standings
        random.seed(7)
        rows = []
        all_managers = [(demo_id, demo_name, demo_team)] + member_records
        for uid, name, team in all_managers:
            wins = random.randint(1, 4)
            draws = random.randint(0, 2)
            losses = random.randint(0, 3)
            rows.append({
                "league_id": league_id, "user_id": uid,
                "user_name": name, "team_name": team,
                "played": wins + draws + losses,
                "wins": wins, "draws": draws, "losses": losses,
                "points": wins * 3 + draws,
                "goals_for": random.randint(3, 15),
                "goals_against": random.randint(2, 12),
            })
        rows.sort(key=lambda r: r["points"], reverse=True)
        await db.standings.insert_many(rows)

        # activity
        acts = [
            {"kind": "goal", "title": "Lautaro Martinez ha segnato!", "subtitle": "Inter - Milan (1-0) • 34'"},
            {"kind": "assist", "title": "Assist di Barella", "subtitle": "Inter - Milan • 34'"},
            {"kind": "bid", "title": "Nuova offerta su Højlund", "subtitle": "Luca Bianchi ha rilanciato a 45"},
            {"kind": "goal", "title": "Nico Paz in gol!", "subtitle": "Como - Roma (2-1) • 67'"},
            {"kind": "lineup", "title": "Deadline formazione", "subtitle": "Mancano 2h alla scadenza della 6ª giornata"},
            {"kind": "info", "title": "Regolamento aggiornato", "subtitle": "Il modificatore difesa è ora attivo"},
            {"kind": "goal", "title": "Kean decisivo", "subtitle": "Fiorentina - Lazio (1-1) • 82'"},
        ]
        now = datetime.now(timezone.utc)
        act_docs = []
        for i, a in enumerate(acts):
            act_docs.append({
                "id": str(uuid.uuid4()),
                "league_id": league_id,
                "kind": a["kind"], "title": a["title"], "subtitle": a["subtitle"],
                "created_at": (now - timedelta(minutes=i * 17)).isoformat(),
            })
        await db.activity.insert_many(act_docs)

        # === Wallets, Rosters, Fixtures, Live events (v5) ===
        random.seed(101)
        all_players = await db.players.find({}, {"_id": 0}).to_list(2000)
        by_role = {"P": [], "D": [], "C": [], "A": []}
        for p in all_players:
            by_role.setdefault(p["role"], []).append(p)
        for role in by_role:
            random.shuffle(by_role[role])

        # Assign small random rosters + wallets to each demo manager
        managers = [(demo_id, demo_name, demo_team)] + member_records
        pick_counts = {"P": 3, "D": 8, "C": 8, "A": 6}
        for uid, uname, tname in managers:
            entries = []
            spent = 0
            for role, count in pick_counts.items():
                for _ in range(count):
                    if not by_role[role]:
                        continue
                    p = by_role[role].pop()
                    price = max(1, int(p["price"]))
                    if spent + price > 480:  # keep some budget free
                        break
                    entries.append({"player_id": p["id"], "price_paid": price})
                    spent += price
            await db.rosters.insert_one({
                "league_id": league_id, "user_id": uid,
                "team_name": tname, "entries": entries,
            })
            await db.wallets.insert_one({
                "league_id": league_id, "user_id": uid,
                "budget": 500, "spent": spent, "remaining": 500 - spent,
            })

        # Build fixtures with round-robin
        await build_fixtures(league_id)

        # Seed live events for current matchday (6)
        current_md = 6
        live_events = [
            ("Lautaro Martinez", "Inter", "goal", 12, "Gol! Inter-Milan 1-0", "p0003"),
            ("Marcus Thuram", "Inter", "assist", 12, "Assist per Lautaro Martinez", None),
            ("Rafael Leao", "Milan", "yellow", 24, "Ammonizione per fallo tattico", None),
            ("Pulisic", "Milan", "goal", 38, "Pareggio Milan! Inter-Milan 1-1", None),
            ("Nico Paz", "Como", "goal", 41, "Como avanti 1-0 sul Napoli", None),
            ("De Bruyne", "Napoli", "assist", 55, "Assist di De Bruyne per Højlund", None),
            ("Hojlund", "Napoli", "goal", 55, "Napoli pareggia 1-1", None),
            ("Yildiz", "Juventus", "goal", 61, "Juve avanti sulla Lazio", None),
            ("Kean", "Fiorentina", "penalty_missed", 68, "Kean sbaglia il rigore!", None),
            ("Maignan", "Milan", "penalty_saved", 74, "Maignan para il penalty!", None),
            ("Dybala", "Roma", "red", 82, "Rosso diretto a Dybala", None),
            ("Orsolini", "Bologna", "goal", 88, "Gol Orsolini nel finale", None),
        ]
        live_docs = []
        base = datetime.now(timezone.utc)
        for i, (name, team, kind, minute, desc, pid) in enumerate(live_events):
            live_docs.append({
                "id": str(uuid.uuid4()),
                "matchday": current_md,
                "player_id": pid,
                "player_name": name,
                "team": team,
                "kind": kind,
                "minute": minute,
                "description": desc,
                "created_at": (base - timedelta(minutes=(len(live_events) - i) * 3)).isoformat(),
            })
        await db.live_events.insert_many(live_docs)

    await db.meta.update_one(
        {"_id": "seed"}, {"$set": {"version": SEED_VERSION}}, upsert=True
    )


@app.on_event("startup")
async def on_start():
    await seed()

@app.on_event("shutdown")
async def on_stop():
    client.close()

@api.get("/")
async def root():
    return {"message": "Fantacalcio API", "status": "ok"}


# ------------------------------------------------------------
# One-shot source-code export endpoint (self-hosting migration)
# Token-gated download of the pre-built ZIP. Remove after use.
# ------------------------------------------------------------
_EXPORT_TOKEN = "jUkNl7GI3esnJRL2J-gOdmKfaCkj896X"
_EXPORT_ZIP_PATH = Path("/app/backend/exports/fantacalcio-source.zip")


@api.get("/export/source")
async def download_source(token: str):
    """Download the project ZIP for self-hosting migration.
    Usage: /api/export/source?token=<token>
    """
    from fastapi.responses import FileResponse
    if token != _EXPORT_TOKEN:
        raise HTTPException(403, "Token non valido")
    if not _EXPORT_ZIP_PATH.exists():
        raise HTTPException(404, "Archivio non trovato — rigenera lo ZIP")
    return FileResponse(
        path=str(_EXPORT_ZIP_PATH),
        filename="fantacalcio-source.zip",
        media_type="application/zip",
    )

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("fantacalcio")
