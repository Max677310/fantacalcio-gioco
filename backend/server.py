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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Literal
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

SEED_VERSION = 6  # bump to force re-seed with wallets/rosters/fixtures/live_events

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

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
    budget_per_user: int = 500
    transfer_window_open: bool = False
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
    """Regenerate the full round-robin fixtures for a league."""
    memberships = await db.memberships.find(
        {"league_id": league_id}, {"_id": 0}
    ).sort("joined_at", 1).to_list(100)
    if len(memberships) < 2:
        await db.fixtures.delete_many({"league_id": league_id})
        return
    uid_to_team = {m["user_id"]: m["team_name"] for m in memberships}
    user_ids = [m["user_id"] for m in memberships]
    rounds = generate_round_robin(user_ids)

    await db.fixtures.delete_many({"league_id": league_id})
    docs = []
    for idx, pairs in enumerate(rounds):
        matchday = idx + 1
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


async def create_league_for_user(user: dict, league_name: str, team_name: str) -> dict:
    league_id = str(uuid.uuid4())
    code = await gen_invite_code()
    league_doc = {
        "id": league_id,
        "name": league_name.strip() or f"Lega di {user['name']}",
        "code": code,
        "admin_id": user["id"],
        "member_ids": [user["id"]],
        "budget_per_user": 500,
        "transfer_window_open": False,
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
# League routes
# ------------------------------------------------------------
class LeagueCreate(BaseModel):
    name: Optional[str] = None
    team_name: str = Field(min_length=1, max_length=48)

class LeagueJoin(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    team_name: str = Field(min_length=1, max_length=48)

@api.post("/leagues/create", response_model=League)
async def create_league(body: LeagueCreate, current=Depends(get_current_user)):
    league = await create_league_for_user(
        current, body.name or f"Lega di {current['name']}", body.team_name
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

# ------------------------------------------------------------
# Auction routes
# ------------------------------------------------------------
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
        }
        await db.auction_state.insert_one(dict(st))
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
    st["current_bid"] = body.amount
    st["current_bidder_id"] = current["id"]
    st["current_bidder_name"] = bidder_label
    await db.auction_state.update_one(
        {"league_id": league_id},
        {"$set": {
            "current_bid": st["current_bid"],
            "current_bidder_id": st["current_bidder_id"],
            "current_bidder_name": st["current_bidder_name"],
        }}
    )
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
    }
    await db.auction_state.update_one(
        {"league_id": league_id},
        {"$set": new_state},
        upsert=True,
    )
    return AuctionState(**new_state)


@api.post("/auction/{league_id}/assign", response_model=AuctionState)
async def assign_current_bid(league_id: str, current=Depends(get_current_user)):
    """Admin assigns the current active player to the highest bidder, deducts wallet and adds to roster."""
    await require_admin(league_id, current)
    st = await db.auction_state.find_one({"league_id": league_id}, {"_id": 0})
    if not st or not st.get("active_player_id"):
        raise HTTPException(400, "Nessun giocatore in asta")
    if not st.get("current_bidder_id"):
        raise HTTPException(400, "Nessuna offerta valida da assegnare")
    winner_id = st["current_bidder_id"]
    amount = int(st["current_bid"])
    player_id = st["active_player_id"]

    # Prevent duplicate assignment
    existing_roster = await db.rosters.find_one({
        "league_id": league_id, "user_id": winner_id
    }, {"_id": 0})
    if existing_roster:
        already = any(e["player_id"] == player_id for e in existing_roster.get("entries", []))
        if already:
            raise HTTPException(400, "Giocatore già in rosa del vincitore")

    # Deduct wallet
    wallet = await db.wallets.find_one({"league_id": league_id, "user_id": winner_id})
    if not wallet:
        raise HTTPException(400, "Wallet del vincitore mancante")
    if amount > wallet["remaining"]:
        raise HTTPException(400, "Fantamilioni insufficienti del vincitore")
    await db.wallets.update_one(
        {"league_id": league_id, "user_id": winner_id},
        {"$inc": {"spent": amount, "remaining": -amount}},
    )
    # Add to roster
    await db.rosters.update_one(
        {"league_id": league_id, "user_id": winner_id},
        {"$push": {"entries": {"player_id": player_id, "price_paid": amount}}},
        upsert=True,
    )
    # Mark auction as sold + reset
    new_state = {
        "league_id": league_id,
        "active_player_id": None,
        "current_bid": 1,
        "current_bidder_id": None,
        "current_bidder_name": None,
        "status": "sold",
    }
    await db.auction_state.update_one({"league_id": league_id}, {"$set": new_state})
    return AuctionState(**new_state)


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
    if not (league or {}).get("transfer_window_open"):
        raise HTTPException(400, "Il mercato di riparazione non è aperto")
    roster = await db.rosters.find_one(
        {"league_id": league_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not roster:
        raise HTTPException(404, "Rosa non trovata")
    entry = next((e for e in roster.get("entries", []) if e["player_id"] == body.player_id), None)
    if not entry:
        raise HTTPException(404, "Giocatore non presente nella tua rosa")
    refund = max(1, int(entry["price_paid"] * 0.5))
    # Remove from roster
    await db.rosters.update_one(
        {"league_id": league_id, "user_id": current["id"]},
        {"$pull": {"entries": {"player_id": body.player_id}}},
    )
    # Refund wallet
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
    if not (league or {}).get("transfer_window_open"):
        raise HTTPException(400, "Il mercato di riparazione non è aperto")
    # Ensure player is a free agent (not owned in this league)
    owned = await db.rosters.find_one(
        {"league_id": league_id, "entries.player_id": body.player_id}, {"_id": 0}
    )
    if owned:
        raise HTTPException(400, "Giocatore già di proprietà di un altro manager")
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


@api.get("/leagues/{league_id}/free-agents", response_model=List[Player])
async def free_agents(
    league_id: str,
    role: Optional[Role] = None,
    q: Optional[str] = None,
    current=Depends(get_current_user),
):
    await require_membership(league_id, current)
    # Collect owned player ids across all rosters in this league
    cursor = db.rosters.find({"league_id": league_id}, {"_id": 0, "entries": 1})
    owned_ids = set()
    async for r in cursor:
        for e in r.get("entries", []):
            owned_ids.add(e["player_id"])
    query = {"id": {"$nin": list(owned_ids)}}
    if role:
        query["role"] = role
    if q:
        query["name"] = {"$regex": re.escape(q[:64]), "$options": "i"}
    cur2 = db.players.find(query, {"_id": 0}).sort("price", -1).limit(80)
    return [Player(**p) for p in await cur2.to_list(80)]


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
    return DashboardSummary(
        league=League(**l),
        my_team_name=team_name,
        rank=rank,
        points=points,
        next_matchday=6,
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
            "budget_per_user": 500,
            "transfer_window_open": False,
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
