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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ.get("JWT_SECRET", "fantacalcio-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 7  # 7 days

SEED_VERSION = 2  # bump to force re-seed of leagues/memberships/standings

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

async def create_league_for_user(user: dict, league_name: str, team_name: str) -> dict:
    league_id = str(uuid.uuid4())
    code = await gen_invite_code()
    league_doc = {
        "id": league_id,
        "name": league_name.strip() or f"Lega di {user['name']}",
        "code": code,
        "admin_id": user["id"],
        "member_ids": [user["id"]],
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
    # seed default regulations
    reg = Regulations(league_id=league_id).model_dump()
    await db.regulations.insert_one(dict(reg))
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
    l = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not l:
        raise HTTPException(404, "Lega non trovata")
    return League(**l)

@api.get("/leagues/{league_id}/members", response_model=List[Membership])
async def league_members(league_id: str, current=Depends(get_current_user)):
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
        query["name"] = {"$regex": q, "$options": "i"}
    cursor = db.players.find(query, {"_id": 0}).sort("price", -1)
    return [Player(**p) for p in await cursor.to_list(500)]

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

# ------------------------------------------------------------
# Regulations
# ------------------------------------------------------------
@api.get("/regulations/{league_id}", response_model=Regulations)
async def get_regulations(league_id: str, current=Depends(get_current_user)):
    r = await db.regulations.find_one({"league_id": league_id}, {"_id": 0})
    if not r:
        r = Regulations(league_id=league_id).model_dump()
        await db.regulations.insert_one(dict(r))
    return Regulations(**r)

@api.put("/regulations/{league_id}", response_model=Regulations)
async def update_regulations(league_id: str, body: Regulations, current=Depends(get_current_user)):
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
SEED_PLAYERS = [
    # === PORTIERI ===
    ("Mike Maignan", "Milan", "P", 20),
    ("Mile Svilar", "Roma", "P", 22),
    ("Marco Carnesecchi", "Atalanta", "P", 20),
    ("Josep Martinez", "Inter", "P", 20),
    ("Jean Butez", "Como", "P", 19),
    ("Alex Meret", "Napoli", "P", 16),
    ("David De Gea", "Fiorentina", "P", 14),
    ("Lukasz Skorupski", "Bologna", "P", 14),
    ("Wladimiro Falcone", "Lecce", "P", 13),
    ("Elia Caprile", "Cagliari", "P", 13),
    ("Michele Di Gregorio", "Juventus", "P", 12),
    ("Maduka Okoye", "Udinese", "P", 12),
    ("Zion Suzuki", "Parma", "P", 11),
    ("Justin Bijlow", "Genoa", "P", 11),
    ("Arijanet Muric", "Sassuolo", "P", 9),
    ("Alberto Paleari", "Torino", "P", 5),
    ("Ivan Provedel", "Lazio", "P", 3),
    ("Lorenzo Montipò", "Verona", "P", 2),
    ("Simone Scuffet", "Pisa", "P", 2),
    ("Marco Silvestri", "Cremonese", "P", 1),

    # === DIFENSORI ===
    ("Bremer", "Juventus", "D", 24),
    ("Alessandro Bastoni", "Inter", "D", 21),
    ("Manuel Akanji", "Inter", "D", 21),
    ("Yann Bisseck", "Inter", "D", 20),
    ("Strahinja Pavlovic", "Milan", "D", 20),
    ("Gianluca Mancini", "Roma", "D", 20),
    ("Giovanni Di Lorenzo", "Napoli", "D", 19),
    ("Amir Rrahmani", "Napoli", "D", 19),
    ("Pierre Kalulu", "Juventus", "D", 18),
    ("Evan Ndicka", "Roma", "D", 18),
    ("Oumar Solet", "Udinese", "D", 18),
    ("Mario Gila", "Lazio", "D", 15),
    ("Jacobo Ramon", "Como", "D", 15),
    ("Leo Ostigard", "Genoa", "D", 15),
    ("Isak Hien", "Atalanta", "D", 13),
    ("Johan Vasquez", "Genoa", "D", 13),
    ("Mario Hermoso", "Roma", "D", 13),
    ("Davide Zappacosta", "Atalanta", "D", 13),
    ("Alessandro Buongiorno", "Napoli", "D", 12),
    ("Matteo Gabbia", "Milan", "D", 12),
    ("Juan Miranda", "Bologna", "D", 12),
    ("Davide Bartesaghi", "Milan", "D", 12),
    ("Yerry Mina", "Cagliari", "D", 11),
    ("Jhon Lucumi", "Bologna", "D", 11),
    ("Adam Marusic", "Lazio", "D", 10),
    ("Fikayo Tomori", "Milan", "D", 10),
    ("Alessio Romagnoli", "Lazio", "D", 10),
    ("Enrico Del Prato", "Parma", "D", 10),
    ("Mergim Vojvoda", "Como", "D", 10),
    ("Berat Djimsiti", "Atalanta", "D", 9),
    ("Raoul Bellanova", "Atalanta", "D", 9),
    ("Sam Beukema", "Napoli", "D", 9),
    ("Pietro Comuzzo", "Fiorentina", "D", 9),
    ("Thomas Kristensen", "Udinese", "D", 9),
    ("Jay Idzes", "Sassuolo", "D", 9),
    ("Ardian Ismajli", "Torino", "D", 9),
    ("Nadir Zortea", "Bologna", "D", 9),
    ("Emil Holm", "Juventus", "D", 9),
    ("Honest Ahanor", "Atalanta", "D", 9),
    ("Devyne Rensch", "Roma", "D", 9),
    ("Miguel Gutierrez", "Napoli", "D", 9),
    ("Alessandro Circati", "Parma", "D", 8),
    ("Mathias Olivera", "Napoli", "D", 8),
    ("Christian Kabasele", "Udinese", "D", 8),
    ("Luca Ranieri", "Fiorentina", "D", 7),
    ("Martin Vitik", "Bologna", "D", 7),
    ("Marin Pongracic", "Fiorentina", "D", 7),
    ("Fabiano Parisi", "Fiorentina", "D", 7),
    ("Koni De Winter", "Milan", "D", 7),
    ("Lautaro Valenti", "Parma", "D", 7),
    ("Gabriele Zappa", "Cagliari", "D", 7),
    ("Odilon Kossounou", "Atalanta", "D", 7),
    ("Sead Kolasinac", "Atalanta", "D", 6),
    ("Federico Gatti", "Juventus", "D", 6),
    ("Nicolò Bertola", "Udinese", "D", 6),
    ("Sebastiano Luperto", "Cremonese", "D", 2),

    # === CENTROCAMPISTI (include ali e ruoli 'CS/CD/AD' del Classic) ===
    ("Hakan Calhanoglu", "Inter", "C", 38),
    ("Scott McTominay", "Napoli", "C", 38),
    ("Adrien Rabiot", "Milan", "C", 32),
    ("Kevin De Bruyne", "Napoli", "C", 31),
    ("Martin Baturina", "Como", "C", 31),
    ("Federico Dimarco", "Inter", "C", 30),
    ("Nicolò Barella", "Inter", "C", 26),
    ("Weston McKennie", "Juventus", "C", 24),
    ("Nikola Vlasic", "Torino", "C", 24),
    ("Ederson", "Atalanta", "C", 21),
    ("Wesley", "Roma", "C", 21),
    ("Manu Kone", "Roma", "C", 20),
    ("Matteo Politano", "Napoli", "C", 20),
    ("Lorenzo Pellegrini", "Roma", "C", 20),
    ("Piotr Zielinski", "Inter", "C", 20),
    ("André-Frank Zambo Anguissa", "Napoli", "C", 19),
    ("Lazar Samardzic", "Atalanta", "C", 19),
    ("Khephren Thuram", "Juventus", "C", 18),
    ("Alexis Saelemaekers", "Milan", "C", 17),
    ("Cesare Casadei", "Torino", "C", 17),
    ("Tommaso Baldanzi", "Genoa", "C", 17),
    ("Kristian Thorstvedt", "Sassuolo", "C", 17),
    ("Maximo Perrone", "Como", "C", 17),
    ("Jurgen Ekkelenkamp", "Udinese", "C", 16),
    ("Petar Sucic", "Inter", "C", 16),
    ("Mario Pasalic", "Atalanta", "C", 16),
    ("Andrea Cambiaso", "Juventus", "C", 15),
    ("Nicolò Fagioli", "Fiorentina", "C", 15),
    ("Eljif Elmas", "Napoli", "C", 15),
    ("Rolando Mandragora", "Fiorentina", "C", 15),
    ("Davide Frattesi", "Inter", "C", 14),
    ("Bryan Cristante", "Roma", "C", 14),
    ("Federico Bernardeschi", "Bologna", "C", 14),
    ("Manuel Locatelli", "Juventus", "C", 14),
    ("Stanislav Lobotka", "Napoli", "C", 14),
    ("Gianluca Gaetano", "Cagliari", "C", 14),
    ("Nicolò Cambiaghi", "Bologna", "C", 14),
    ("Adrian Bernabé", "Parma", "C", 14),
    ("Lewis Ferguson", "Bologna", "C", 14),
    ("Matteo Cancellieri", "Lazio", "C", 14),
    ("Ismaël Koné", "Sassuolo", "C", 14),
    ("Nicola Zalewski", "Atalanta", "C", 12),
    ("Henrikh Mkhitaryan", "Inter", "C", 12),
    ("Morten Frendrup", "Genoa", "C", 12),
    ("Nemanja Matic", "Sassuolo", "C", 11),
    ("Tommaso Pobega", "Bologna", "C", 11),
    ("Ndary Adopo", "Cagliari", "C", 11),
    ("Jacopo Fazzini", "Fiorentina", "C", 11),
    ("Marten De Roon", "Atalanta", "C", 10),
    ("Nicolo Rovella", "Lazio", "C", 10),
    ("Youssouf Fofana", "Milan", "C", 10),
    ("Teun Koopmeiners", "Juventus", "C", 10),
    ("Carlos Augusto", "Inter", "C", 10),
    ("Lassana Coulibaly", "Lecce", "C", 10),
    ("Ardon Jashari", "Milan", "C", 10),
    ("Ruben Loftus-Cheek", "Milan", "C", 9),
    ("Nuno Tavares", "Lazio", "C", 9),
    ("Antonino Gallo", "Lecce", "C", 9),
    ("Danilo Cataldi", "Lazio", "C", 8),
    ("Simon Sohm", "Bologna", "C", 8),
    ("Michael Folorunsho", "Cagliari", "C", 7),
    ("Fabio Miretti", "Juventus", "C", 7),
    ("Samuele Ricci", "Milan", "C", 7),
    ("Marco Brescianini", "Fiorentina", "C", 7),
    ("Neil El Aynaoui", "Roma", "C", 7),
    ("Yunus Musah", "Atalanta", "C", 5),
    ("Alessandro Deiola", "Cagliari", "C", 5),
    ("Reda Belahyane", "Lazio", "C", 3),

    # === ATTACCANTI (include Ali/Trequartisti del Classic) ===
    ("Donyell Malen", "Roma", "A", 58),
    ("Lautaro Martinez", "Inter", "A", 54),
    ("Rasmus Højlund", "Napoli", "A", 46),
    ("Marcus Thuram", "Inter", "A", 46),
    ("Nico Paz", "Como", "A", 42),
    ("Moise Kean", "Fiorentina", "A", 41),
    ("Christian Pulisic", "Milan", "A", 37),
    ("Tasos Douvikas", "Como", "A", 37),
    ("Kenan Yildiz", "Juventus", "A", 35),
    ("Gianluca Scamacca", "Atalanta", "A", 34),
    ("Riccardo Orsolini", "Bologna", "A", 34),
    ("Nikola Krstovic", "Atalanta", "A", 32),
    ("Keinan Davis", "Udinese", "A", 32),
    ("Domenico Berardi", "Sassuolo", "A", 30),
    ("Paulo Dybala", "Roma", "A", 30),
    ("Rafael Leao", "Milan", "A", 29),
    ("Francesco Pio Esposito", "Inter", "A", 29),
    ("Charles De Ketelaere", "Atalanta", "A", 28),
    ("Nicolò Zaniolo", "Udinese", "A", 28),
    ("Giovanni Simeone", "Torino", "A", 28),
    ("Mattia Zaccagni", "Lazio", "A", 27),
    ("Armand Laurienté", "Sassuolo", "A", 27),
    ("Santiago Castro", "Bologna", "A", 27),
    ("Andrea Pinamonti", "Sassuolo", "A", 26),
    ("Lucas Da Cunha", "Como", "A", 26),
    ("Giacomo Raspadori", "Atalanta", "A", 25),
    ("Albert Gudmundsson", "Fiorentina", "A", 24),
    ("Matias Soulé", "Roma", "A", 23),
    ("Artem Dovbyk", "Roma", "A", 23),
    ("Christopher Nkunku", "Milan", "A", 23),
    ("Sebastiano Esposito", "Cagliari", "A", 22),
    ("Francisco Conceicao", "Juventus", "A", 22),
    ("Assane Diao", "Como", "A", 21),
    ("Jesús Rodríguez", "Como", "A", 21),
    ("Jonathan Rowe", "Bologna", "A", 21),
    ("Lorenzo Colombo", "Genoa", "A", 20),
    ("Romelu Lukaku", "Napoli", "A", 19),
    ("Jonathan David", "Juventus", "A", 18),
    ("Che Adams", "Torino", "A", 18),
    ("Duvan Zapata", "Torino", "A", 16),
    ("Roberto Piccoli", "Fiorentina", "A", 16),
    ("Vitinha", "Genoa", "A", 16),
    ("Ange-Yoan Bonny", "Inter", "A", 15),
    ("Gustav Isaksen", "Lazio", "A", 15),
    ("Petar Ratkov", "Lazio", "A", 15),
    ("Nikola Stulic", "Lecce", "A", 15),
    ("Boulaye Dia", "Lazio", "A", 14),
    ("Mateo Pellegrino", "Parma", "A", 14),
    ("David Neres", "Napoli", "A", 14),
    ("Alisson Santos", "Napoli", "A", 14),
    ("Jeremie Boga", "Juventus", "A", 13),
    ("Kamaldeen Sulemana", "Atalanta", "A", 12),
    ("Tijjani Noslin", "Lazio", "A", 12),
    ("Santiago Pierotti", "Lecce", "A", 12),
    ("Santiago Gimenez", "Milan", "A", 11),
    ("Edon Zhegrova", "Juventus", "A", 11),
    ("Jayden Addai", "Como", "A", 10),
    ("Giovane", "Napoli", "A", 10),
    ("Alvaro Morata", "Como", "A", 9),
    ("Ondrej Ondrejka", "Parma", "A", 9),
    ("Luis Henrique", "Inter", "A", 9),
    ("Alieu Fadera", "Sassuolo", "A", 7),
    ("Nicolas Kuhn", "Como", "A", 7),
    ("Junior Messias", "Genoa", "A", 6),
    ("Stephan El Shaarawy", "Roma", "A", 6),
    ("Andrea Belotti", "Cagliari", "A", 6),
    ("Jack Harrison", "Fiorentina", "A", 6),
    ("Riccardo Sottil", "Lecce", "A", 5),
    ("Robinio Vaz", "Roma", "A", 5),
]

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
        await ensure_indexes()

    # Players
    if await db.players.count_documents({}) == 0:
        docs = []
        random.seed(42)
        for i, (name, team, role, price) in enumerate(SEED_PLAYERS):
            avg_vote = round(5.8 + min(price, 40) / 100.0 + random.random() * 0.4, 2)
            docs.append({
                "id": f"p{i+1:03d}",
                "name": name, "team": team, "role": role, "price": price,
                "avg_vote": avg_vote,
                "goals": random.randint(2, 15) if role in ("A", "C") and price >= 15 else random.randint(0, 4),
                "assists": random.randint(0, 10) if price >= 12 else random.randint(0, 4),
            })
        await db.players.insert_many(docs)
        logging.info("Seeded %d players", len(docs))

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
            "name": "Lega Serie A Fantacalcio 2025/26",
            "code": DEMO_LEAGUE_CODE,
            "admin_id": demo_id,
            "member_ids": all_member_ids,
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
