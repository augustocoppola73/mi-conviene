"""
Mi Conviene - backend FastAPI.

Contiene: dati seed (catalogo simulato), motore di ottimizzazione deterministico
e tutte le API (prefisso /api). Nessuna AI: solo regole e formule spiegabili.
Vedi docs/DOCUMENTAZIONE.md per il perché di ogni scelta.
"""
from __future__ import annotations

import asyncio
import math
import logging
import os
import random
import secrets
import statistics
import string
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

import storage
import stores as stores_mod
from stores import StoreLocator
from prices import fuel as fuel_mod
from prices.geo import haversine_km
from prices.service import PriceService

# ---------------------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------------------
def _load_dotenv(path: str = os.path.join(os.path.dirname(__file__), ".env")) -> None:
    """Legge backend/.env (se c'è) senza sovrascrivere le variabili già impostate."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


_load_dotenv()
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "pago_meno")

# Collegato all'avvio (lifespan): MongoDB se c'è, altrimenti modalità locale su file.
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
STORAGE_MODE = "mongodb"

# Zona per cui si cercano i prezzi reali (default: Milano centro).
PRICE_LAT = float(os.environ.get("PRICE_LAT", "45.4642"))
PRICE_LON = float(os.environ.get("PRICE_LON", "9.1900"))
PRICE_RADIUS_KM = float(os.environ.get("PRICE_RADIUS_KM", "30"))
PRICES_AUTO_REFRESH = os.environ.get("PRICES_AUTO_REFRESH", "1") == "1"
PRICES_REFRESH_HOURS = float(os.environ.get("PRICES_REFRESH_HOURS", "12"))

prices = PriceService(PRICE_LAT, PRICE_LON, PRICE_RADIUS_KM)
locator = StoreLocator(int(float(os.environ.get("STORES_RADIUS_KM", "6")) * 1000))
PRICE_RECENTER_KM = 15  # oltre questa distanza dalla zona prezzi, la si sposta sull'utente
_recenter_task: Optional[asyncio.Task] = None
log = logging.getLogger("mi_conviene")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# 1. Dati seed
# ---------------------------------------------------------------------------
CATEGORIES = [
    {"id": "frutta", "name": "Frutta", "emoji": "🍎"},
    {"id": "verdura", "name": "Verdura", "emoji": "🥦"},
    {"id": "carne", "name": "Carne", "emoji": "🥩"},
    {"id": "pesce", "name": "Pesce", "emoji": "🐟"},
    {"id": "latticini", "name": "Latticini e uova", "emoji": "🧀"},
    {"id": "pane", "name": "Pane e forno", "emoji": "🥖"},
    {"id": "dispensa", "name": "Dispensa", "emoji": "🍝"},
    {"id": "bevande", "name": "Bevande", "emoji": "🥤"},
    {"id": "surgelati", "name": "Surgelati", "emoji": "🧊"},
    {"id": "casa", "name": "Casa e igiene", "emoji": "🧴"},
]

# (id, nome, categoria, qty_default, unità)
PRODUCTS = [
    ("mele", "Mele Golden", "frutta", 1, "kg"),
    ("banane", "Banane", "frutta", 1, "kg"),
    ("arance", "Arance da spremuta", "frutta", 2, "kg"),
    ("pere", "Pere Abate", "frutta", 1, "kg"),
    ("fragole", "Fragole", "frutta", 0.5, "kg"),
    ("pomodori", "Pomodori ramati", "verdura", 1, "kg"),
    ("insalata", "Insalata iceberg", "verdura", 1, "pz"),
    ("zucchine", "Zucchine", "verdura", 1, "kg"),
    ("patate", "Patate", "verdura", 2, "kg"),
    ("carote", "Carote", "verdura", 1, "kg"),
    ("cipolle", "Cipolle dorate", "verdura", 1, "kg"),
    ("petto_pollo", "Petto di pollo", "carne", 0.5, "kg"),
    ("macinato", "Macinato di manzo", "carne", 0.5, "kg"),
    ("salsiccia", "Salsiccia di suino", "carne", 0.4, "kg"),
    ("prosciutto", "Prosciutto cotto", "carne", 0.15, "kg"),
    ("bistecca", "Bistecca di manzo", "carne", 0.4, "kg"),
    ("salmone", "Filetto di salmone", "pesce", 0.3, "kg"),
    ("tonno", "Tonno in scatola 3x80g", "pesce", 1, "conf"),
    ("merluzzo", "Filetti di merluzzo", "pesce", 0.4, "kg"),
    ("latte", "Latte intero 1L", "latticini", 1, "L"),
    ("uova", "Uova fresche x6", "latticini", 1, "conf"),
    ("mozzarella", "Mozzarella 125g", "latticini", 1, "pz"),
    ("parmigiano", "Parmigiano Reggiano", "latticini", 0.3, "kg"),
    ("yogurt", "Yogurt bianco 4x125g", "latticini", 1, "conf"),
    ("burro", "Burro 250g", "latticini", 1, "pz"),
    ("pane", "Pane comune", "pane", 0.5, "kg"),
    ("fette_biscottate", "Fette biscottate", "pane", 1, "conf"),
    ("biscotti", "Biscotti frollini", "pane", 1, "conf"),
    ("cracker", "Cracker salati", "pane", 1, "conf"),
    ("pasta", "Pasta di semola", "dispensa", 2, "kg"),
    ("riso", "Riso Carnaroli 1kg", "dispensa", 1, "kg"),
    ("passata", "Passata di pomodoro 700g", "dispensa", 1, "pz"),
    ("olio_evo", "Olio extravergine 1L", "dispensa", 1, "L"),
    ("farina", "Farina 00 1kg", "dispensa", 1, "kg"),
    ("zucchero", "Zucchero 1kg", "dispensa", 1, "kg"),
    ("caffe", "Caffè macinato 250g", "dispensa", 1, "pz"),
    ("legumi", "Ceci in scatola", "dispensa", 1, "pz"),
    ("acqua", "Acqua naturale 6x1,5L", "bevande", 1, "conf"),
    ("succo", "Succo di frutta 1L", "bevande", 1, "L"),
    ("birra", "Birra 3x33cl", "bevande", 1, "conf"),
    ("vino", "Vino rosso 75cl", "bevande", 1, "pz"),
    ("piselli", "Piselli surgelati 1kg", "surgelati", 1, "conf"),
    ("pizza_surg", "Pizza margherita surgelata", "surgelati", 1, "pz"),
    ("gelato", "Gelato vaschetta 500g", "surgelati", 1, "pz"),
    ("detersivo", "Detersivo lavatrice", "casa", 1, "pz"),
    ("piatti", "Detersivo piatti", "casa", 1, "pz"),
    ("carta_igienica", "Carta igienica x8", "casa", 1, "conf"),
    ("shampoo", "Shampoo", "casa", 1, "pz"),
]
PRODUCT_INDEX = {
    p[0]: {"id": p[0], "name": p[1], "category_id": p[2], "default_qty": p[3], "unit": p[4]}
    for p in PRODUCTS
}

# Zona Milano. distance_km è fisso finché non arriva la geolocalizzazione reale.
STORES = [
    {"id": "conad", "name": "Conad", "lat": 45.4781, "lng": 9.2272, "distance_km": 0.8, "price_level": 1.00},
    {"id": "esselunga", "name": "Esselunga", "lat": 45.4855, "lng": 9.2043, "distance_km": 2.1, "price_level": 0.94},
    {"id": "coop", "name": "Coop", "lat": 45.4699, "lng": 9.2170, "distance_km": 1.4, "price_level": 1.03},
    {"id": "lidl", "name": "Lidl", "lat": 45.4950, "lng": 9.2350, "distance_km": 3.6, "price_level": 0.88},
    {"id": "carrefour", "name": "Carrefour", "lat": 45.4640, "lng": 9.1900, "distance_km": 1.1, "price_level": 1.07},
    {"id": "pam", "name": "PAM", "lat": 45.4760, "lng": 9.2100, "distance_km": 1.0, "price_level": 1.04},
    {"id": "eurospin", "name": "Eurospin", "lat": 45.5050, "lng": 9.2150, "distance_km": 4.2, "price_level": 0.86},
]
STORE_INDEX = {s["id"]: s for s in STORES}

# Prezzo di riferimento (€) per la qty di default, baseline Conad.
BASE_PRICES = {
    "mele": 2.19, "banane": 1.89, "arance": 3.20, "pere": 2.49, "fragole": 2.99,
    "pomodori": 2.79, "insalata": 1.19, "zucchine": 2.29, "patate": 2.40, "carote": 1.29,
    "cipolle": 1.49, "petto_pollo": 5.45, "macinato": 5.90, "salsiccia": 4.20,
    "prosciutto": 2.95, "bistecca": 8.80, "salmone": 7.50, "tonno": 3.99, "merluzzo": 5.60,
    "latte": 1.55, "uova": 2.19, "mozzarella": 1.09, "parmigiano": 6.90, "yogurt": 2.29,
    "burro": 2.69, "pane": 2.10, "fette_biscottate": 1.79, "biscotti": 2.39, "cracker": 1.65,
    "pasta": 3.20, "riso": 2.99, "passata": 1.19, "olio_evo": 9.49, "farina": 0.99,
    "zucchero": 1.19, "caffe": 3.49, "legumi": 0.89, "acqua": 2.29, "succo": 1.69,
    "birra": 2.99, "vino": 4.99, "piselli": 2.49, "pizza_surg": 2.79, "gelato": 3.49,
    "detersivo": 6.99, "piatti": 1.89, "carta_igienica": 3.49, "shampoo": 2.99,
}

# Nessuna promozione inventata: le offerte arrivano solo da fonti reali
# (Open Prices oggi, volantini in futuro). Le stime sono sempre a prezzo pieno.


def build_catalog(real: Optional[dict] = None) -> dict:
    """CATALOG[store_id][product_id].

    Parte dalle STIME (prezzi simulati, source="stima", affidabilità rossa) e le
    sostituisce con i prezzi REALI dove una fonte li ha (es. Open Prices)."""
    real = real or {}
    retrieved_at = now_iso()
    rng = random.Random(42)  # piccola variazione deterministica tra catene
    catalog: dict = {}
    for store in STORES:
        sid = store["id"]
        catalog[sid] = {}
        for pid, base_price in BASE_PRICES.items():
            jitter = 1 + rng.uniform(-0.04, 0.04)
            normal = round(base_price * store["price_level"] * jitter, 2)
            entry = {
                "normal_price": normal,
                "promo_price": None,
                "final_price": normal,
                "loyalty_required": False,
                "confidence": "red",
                "source": "stima",
                "retrieved_at": retrieved_at,
                "observed_at": None,
                "location_name": None,
                "sample_product": None,
                "proof_url": None,
            }
            r = real.get((sid, pid))
            if r:
                entry.update({
                    "normal_price": r["normal_price"],
                    "promo_price": r.get("promo_price"),
                    "final_price": r["promo_price"] if r.get("promo_price") else r["normal_price"],
                    "loyalty_required": False,
                    "confidence": r["confidence"],
                    "source": r["source"],
                    "observed_at": r.get("observed_at"),
                    "location_name": r.get("location_name"),
                    "sample_product": r.get("sample_product"),
                    "proof_url": r.get("proof_url"),
                })
            catalog[sid][pid] = entry
    return catalog


def rebuild_catalog() -> None:
    global CATALOG
    CATALOG = build_catalog(prices.real)


CATALOG = build_catalog()

# ---------------------------------------------------------------------------
# 2. Motore di ottimizzazione
# ---------------------------------------------------------------------------
FUEL_CONSUMPTION_L_100KM = 7.0  # consumo medio di un'auto
FALLBACK_FUEL_PRICE = 1.85  # €/l, usato se il dato MIMIT non è disponibile
TRANSPORT_SPEED = {"walk": 5, "bike": 15, "car": 40, "transit": 25}  # km/h
TIME_VALUE = 8.0  # € per ora percepita
TIME_WEIGHT = 0.5  # il tempo conta, ma non deve dominare sul prezzo

Transport = Literal["walk", "bike", "car", "transit"]


class ListItem(BaseModel):
    product_id: str
    quantity: float = Field(gt=0)


class OptimizeRequest(BaseModel):
    user_id: str
    items: list[ListItem] = Field(min_length=1)
    budget: Optional[float] = None
    transport: Transport = "car"
    habitual_store_id: Optional[str] = None
    min_savings_threshold: float = 3.0
    fuel_type: Literal["benzina", "gasolio", "gpl", "metano"] = "benzina"
    # posizione dell'utente: se c'è si usano i punti vendita reali più vicini
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)


def compute_virtual_receipt(store_id: str, items: list[ListItem]) -> dict:
    lines, unknown = [], []
    total = normal_total = 0.0
    for it in items:
        product = PRODUCT_INDEX.get(it.product_id)
        price_info = CATALOG[store_id].get(it.product_id)
        if not product or not price_info:
            unknown.append(it.product_id)
            continue
        ratio = it.quantity / product["default_qty"]
        line_price = round(price_info["final_price"] * ratio, 2)
        line_normal = round(price_info["normal_price"] * ratio, 2)
        total += line_price
        normal_total += line_normal
        lines.append({
            "product_id": it.product_id,
            "name": product["name"],
            "quantity": it.quantity,
            "unit": product["unit"],
            "unit_price": price_info["final_price"],
            "normal_price": line_normal,
            "line_price": line_price,
            "in_promo": price_info["promo_price"] is not None,
            "loyalty_required": price_info["loyalty_required"],
            "confidence": price_info["confidence"],
            "source": price_info["source"],
            "observed_at": price_info["observed_at"],
            "location_name": price_info["location_name"],
            "sample_product": price_info["sample_product"],
            "proof_url": price_info["proof_url"],
        })
    real_lines = sum(1 for l in lines if l["source"] != "stima")
    return {
        "lines": lines,
        "unknown_products": unknown,
        "real_lines": real_lines,
        "total": round(total, 2),
        "normal_total": round(normal_total, 2),
        "savings_vs_normal": round(normal_total - total, 2),
    }


def fuel_info(fuel_type: str = "benzina") -> dict:
    """Prezzo al litro: mediana MIMIT di oggi vicino a te, altrimenti un valore fisso."""
    f = prices.fuel.get(fuel_type)
    if f:
        return {"fuel_type": fuel_type, "price_per_liter": f["price_per_liter"], "source": "mimit",
                "observed_at": f.get("observed_at"), "stations": f.get("stations")}
    return {"fuel_type": fuel_type, "price_per_liter": FALLBACK_FUEL_PRICE, "source": "stima",
            "observed_at": None, "stations": 0}


def compute_travel(store: dict, transport: str, fuel: Optional[dict] = None) -> dict:
    fuel = fuel or fuel_info()
    distance = store["distance_km"]
    time_min = (distance * 2 / TRANSPORT_SPEED[transport]) * 60
    cost_per_km = FUEL_CONSUMPTION_L_100KM / 100 * fuel["price_per_liter"]
    fuel_cost = distance * 2 * cost_per_km if transport == "car" else 0.0
    time_cost = (time_min / 60) * TIME_VALUE
    return {
        "distance_km": distance,
        "time_min": round(time_min),
        "fuel_cost": round(fuel_cost, 2),
        "time_cost": round(time_cost, 2),
    }


def store_confidence(receipt: dict) -> str:
    n = len(receipt["lines"]) or 1
    share = receipt["real_lines"] / n
    return "green" if share >= 0.7 else "yellow" if share >= 0.3 else "red"


def euro(x: float) -> str:
    return f"€{x:.2f}".replace(".", ",")


def compute_savings(ranked: list[dict], recommended: dict, habitual: Optional[dict]) -> dict:
    """Risparmio da mettere nel Salvadanaio. Il budget NON entra mai nel calcolo.

    Riferimento: il supermercato abituale se impostato, altrimenti la spesa "tipica"
    (mediana delle catene). Se il consigliato è l'abituale il risparmio è 0: le promo
    che avresti preso comunque sono mostrate a parte (promo_savings)."""
    if habitual:
        reference_cost, reference = habitual["total_cost"], {
            "type": "habitual", "label": f"rispetto a {habitual['store_name']}, il tuo abituale",
            "store_id": habitual["store_id"]}
    else:
        costs = sorted(r["total_cost"] for r in ranked)
        reference_cost = statistics.median(costs)
        reference = {"type": "median", "label": "rispetto alla spesa tipica in zona (mediana delle catene)",
                     "store_id": None}
    amount = round(max(0.0, reference_cost - recommended["total_cost"]), 2)
    lines = recommended["receipt"]["lines"]
    real = recommended["receipt"]["real_lines"]
    basis = "reale" if lines and real == len(lines) else "misto" if real else "stima"
    return {
        "amount": amount,
        "reference_cost": round(reference_cost, 2),
        "reference": reference,
        "price_basis": basis,  # su che prezzi è calcolato: il risparmio resta "stimato" finché non c'è lo scontrino
        "promo_savings": recommended["receipt"]["savings_vs_normal"],
    }


def optimize_list(req: OptimizeRequest, stores: Optional[list[dict]] = None) -> dict:
    """stores: punti vendita da confrontare (default: STORES con distanze di esempio)."""
    ranked = []
    fuel = fuel_info(req.fuel_type)
    for store in stores if stores is not None else STORES:
        receipt = compute_virtual_receipt(store["id"], req.items)
        travel = compute_travel(store, req.transport, fuel)
        total_cost = round(receipt["total"] + travel["fuel_cost"], 2)
        score = round(total_cost + TIME_WEIGHT * travel["time_cost"], 2)
        ranked.append({
            "store_id": store["id"],
            "store_name": store["name"],
            "branch": store.get("branch"),  # punto vendita reale (nome, indirizzo), se c'è la posizione
            "confidence": store_confidence(receipt),
            "receipt": receipt,
            "travel": travel,
            "total_cost": total_cost,
            "score": score,
        })
    ranked.sort(key=lambda r: r["score"])
    best = ranked[0]
    recommended = best
    habitual = next((r for r in ranked if r["store_id"] == req.habitual_store_id), None)

    # Regola anti-fatica: non cambiare supermercato per pochi euro.
    if habitual and habitual is not best:
        delta = round(habitual["total_cost"] - best["total_cost"], 2)
        if delta < req.min_savings_threshold:
            recommended = habitual
            reasoning = (
                f"Resta da {habitual['store_name']}: andando da {best['store_name']} "
                f"risparmieresti solo {euro(max(delta, 0))}, sotto la tua soglia di "
                f"{euro(req.min_savings_threshold)}."
            )
        else:
            reasoning = (
                f"Ti conviene {best['store_name']}: risparmi {euro(delta)} rispetto a "
                f"{habitual['store_name']}, viaggio incluso."
            )
    elif habitual:
        reasoning = f"Il tuo {habitual['store_name']} è già la scelta migliore per questa lista."
    else:
        second = ranked[1] if len(ranked) > 1 else None
        diff = round(second["total_cost"] - best["total_cost"], 2) if second else 0
        if second and diff < 0:
            # il secondo costa meno in euro, ma il tempo di viaggio in più non lo ripaga
            reasoning = (
                f"{best['store_name']} è la scelta migliore: {second['store_name']} costerebbe "
                f"{euro(-diff)} in meno, ma è più lontano e non vale il tempo in più."
            )
        else:
            reasoning = (
                f"{best['store_name']} è il più conveniente: {euro(best['total_cost'])} "
                f"viaggio incluso" + (f", {euro(diff)} in meno di {second['store_name']}." if second else ".")
            )

    budget_status = None
    if req.budget is not None and req.budget > 0:
        spend = recommended["total_cost"]
        diff = round(req.budget - spend, 2)
        budget_status = {"budget": req.budget, "spend": spend, "diff": diff,
                         "status": "ok" if diff >= 0 else "over", "alternative": None}
        if diff < 0:
            # il più economico in assoluto che rientra nel budget (se esiste)
            fits = sorted((r for r in ranked if r["total_cost"] <= req.budget), key=lambda r: r["total_cost"])
            if fits:
                budget_status["alternative"] = {"store_id": fits[0]["store_id"], "store_name": fits[0]["store_name"],
                                                "total_cost": fits[0]["total_cost"]}

    return {
        "ranked": ranked,
        "recommended": recommended,
        "reasoning": reasoning,
        "budget_status": budget_status,
        "savings": compute_savings(ranked, recommended, habitual),
        "fuel": fuel,
        "price_coverage": {
            "real_lines": recommended["receipt"]["real_lines"],
            "total_lines": len(recommended["receipt"]["lines"]),
        },
    }


# ---------------------------------------------------------------------------
# 3. Lista abituale appresa (conteggio frequenze, nessuna AI)
# ---------------------------------------------------------------------------
def habitual_from_history(shops: list[dict]) -> list[dict]:
    if not shops:
        return []
    agg: dict[str, dict] = {}
    for shop in shops:
        seen = set()
        for it in shop.get("items", []):
            pid = it["product_id"]
            if pid in seen or pid not in PRODUCT_INDEX:
                continue
            seen.add(pid)
            a = agg.setdefault(pid, {"count": 0, "qty_sum": 0.0})
            a["count"] += 1
            a["qty_sum"] += float(it["quantity"])
    threshold = max(2, int(len(shops) * 0.3))
    result = [
        {"product_id": pid, "name": PRODUCT_INDEX[pid]["name"], "count": a["count"],
         "quantity": round(a["qty_sum"] / a["count"], 2)}
        for pid, a in agg.items() if a["count"] >= threshold
    ]
    result.sort(key=lambda r: (-r["count"], r["name"]))
    return result


# ---------------------------------------------------------------------------
# 3b. Budget suggerito dallo storico (regole, nessuna AI)
# ---------------------------------------------------------------------------
BUDGET_MARGIN = 0.10  # +10% sulla spesa tipica, per non sforare per poco
BUDGET_SIMILARITY = 0.5  # almeno metà dei prodotti in comune (indice di Jaccard)
BUDGET_HISTORY_LIMIT = 50
SIZE_BUCKETS = [(5, "piccola"), (15, "media"), (10**9, "grande")]


def cart_size(n_items: int) -> str:
    return next(label for limit, label in SIZE_BUCKETS if n_items <= limit)


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a or b else 0.0


def suggest_budget(product_ids: list[str], shops: list[dict]) -> dict:
    """Budget proposto = mediana delle spese passate dello stesso tipo + margine.

    1) spese SIMILI (Jaccard >= 0.5 sui prodotti), se ce ne sono almeno 2;
    2) altrimenti spese della stessa TAGLIA (piccola / media / grande), almeno 2;
    3) altrimenti nessuna proposta: meglio niente che un numero inventato."""
    current = set(product_ids)
    if not current:
        return {"suggested": None, "reason": "lista vuota"}
    shops = [s for s in shops if s.get("total_cost")]
    similar = [s for s in shops if jaccard(current, {i["product_id"] for i in s.get("items", [])}) >= BUDGET_SIMILARITY]
    basis, label = similar, "spese simili"
    if len(similar) < 2:
        size = cart_size(len(current))
        basis = [s for s in shops if cart_size(len({i["product_id"] for i in s.get("items", [])})) == size]
        label = f"spese di taglia {size}"
    if len(basis) < 2:
        return {"suggested": None, "reason": "storico insufficiente", "history_count": len(shops)}
    typical = statistics.median(s["total_cost"] for s in basis)
    suggested = float(math.ceil(typical * (1 + BUDGET_MARGIN)))
    return {
        "suggested": suggested,
        "typical": round(typical, 2),
        "margin_pct": round(BUDGET_MARGIN * 100),
        "based_on": len(basis),
        "basis": label,
        "reason": f"mediana di {len(basis)} {label} ({euro(typical)}) + {round(BUDGET_MARGIN * 100)}%",
    }


def last_similar_shop(product_ids: list[str], shops: list[dict]) -> Optional[dict]:
    """L'ultima spesa confermata simile a questa lista (shops: dalla più recente)."""
    current = set(product_ids)
    for shop in shops:
        sid = shop.get("store_id")
        if sid not in STORE_INDEX:
            continue
        sim = jaccard(current, {i["product_id"] for i in shop.get("items", [])})
        if sim >= BUDGET_SIMILARITY:
            return {"store_id": sid, "store_name": STORE_INDEX[sid]["name"], "date": shop.get("created_at"),
                    "total_cost": shop.get("total_cost"), "similarity": round(sim, 2)}
    return None


# ---------------------------------------------------------------------------
# 4. API
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    global db, STORAGE_MODE
    db, STORAGE_MODE = await storage.connect(MONGO_URL, DB_NAME)
    log.warning("Archivio dati: %s", STORAGE_MODE)
    tasks = []
    if STORAGE_MODE == "locale":
        tasks.append(asyncio.create_task(storage.autosave(db)))
    # prezzi: 1) riparte subito con gli ultimi reali salvati, 2) li aggiorna in background
    if prices.load_cache():
        rebuild_catalog()
    if PRICES_AUTO_REFRESH:
        tasks.append(asyncio.create_task(prices.refresh_forever(PRICES_REFRESH_HOURS, rebuild_catalog)))
    yield
    for t in tasks:
        t.cancel()
    if STORAGE_MODE == "locale":
        await storage.save(db)


app = FastAPI(title="Mi Conviene API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
api = APIRouter(prefix="/api")

NO_ID = {"_id": 0}


@api.get("/")
async def health():
    return {"status": "ok", "app": "Mi Conviene", "storage": STORAGE_MODE}


@api.get("/bootstrap")
async def bootstrap():
    return {
        "categories": CATEGORIES,
        "products": list(PRODUCT_INDEX.values()),
        "stores": [{k: s[k] for k in ("id", "name", "lat", "lng", "distance_km")} for s in STORES],
    }


async def stores_for(lat: Optional[float], lon: Optional[float]) -> tuple[list[dict], dict]:
    """Catene da confrontare: con la posizione, il punto vendita reale più vicino di
    ognuna (le catene senza negozi vicini restano fuori); senza, le distanze di esempio."""
    if lat is None or lon is None:
        return STORES, {"mode": "esempio", "missing_chains": []}
    try:
        near = await locator.nearest(lat, lon)
    except Exception as e:
        log.warning("Punti vendita non disponibili (%s): uso le distanze di esempio", e)
        return STORES, {"mode": "esempio", "missing_chains": [], "error": "OpenStreetMap non raggiungibile"}
    maybe_recenter_prices(lat, lon)
    chosen = []
    for s in STORES:
        b = near.get(s["id"])
        if b:
            chosen.append({**s, "distance_km": b["distance_km"],
                           "branch": {k: b[k] for k in ("name", "address", "lat", "lon", "osm_id", "opening_hours")}})
    missing = [s["name"] for s in STORES if s["id"] not in near]
    if not chosen:
        return STORES, {"mode": "esempio", "missing_chains": missing, "error": "nessun punto vendita nel raggio"}
    return chosen, {"mode": "reale", "missing_chains": missing, "radius_km": locator.radius_m / 1000}


def maybe_recenter_prices(lat: float, lon: float) -> None:
    """Se l'utente è lontano dalla zona dei prezzi, sposta lì la ricerca e aggiorna in background."""
    global _recenter_task
    if haversine_km(lat, lon, prices.lat, prices.lon) < PRICE_RECENTER_KM:
        return
    if _recenter_task and not _recenter_task.done():
        return
    prices.lat, prices.lon = round(lat, 3), round(lon, 3)

    async def run():
        await prices.refresh()
        rebuild_catalog()

    try:
        _recenter_task = asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        pass


# Volantini ufficiali delle catene (pagine pubbliche dei siti). Se il punto vendita
# vicino ha una sua pagina su OpenStreetMap, si apre quella (volantino del negozio).
CHAIN_FLYERS = {
    "esselunga": "https://www.esselunga.it/it-it/promozioni/volantini.html",
    "conad": "https://www.conad.it/ricerca-negozi",
    "coop": "https://www.coop.it/le-nostre-promozioni",
    "lidl": "https://www.lidl.it/c/volantino-lidl/s10018048",
    "carrefour": "https://www.carrefour.it/volantino",
    "pam": "https://www.pampanorama.it/volantini",
    "eurospin": "https://www.eurospin.it/volantino/",
}
OFFICIAL_DOMAINS = {"esselunga": ("esselunga.it",), "conad": ("conad.it",), "coop": ("coop",), "lidl": ("lidl.it",),
                    "carrefour": ("carrefour.it",), "pam": ("pampanorama.it", "e-pam.it"),
                    "eurospin": ("eurospin.it",)}


def flyer_url(chain: str, website: Optional[str]) -> tuple[str, bool]:
    """(url, è la pagina del negozio). Si usa il sito OSM solo se è del dominio ufficiale."""
    if website and website.startswith("http") and any(d in website.split("/")[2] for d in OFFICIAL_DOMAINS[chain]):
        return website, True
    return CHAIN_FLYERS[chain], False


@api.get("/flyers")
async def flyers(lat: Optional[float] = None, lon: Optional[float] = None):
    """Volantini delle catene: per ognuna il punto vendita più vicino che ha una sua pagina
    ufficiale (volantino di zona). Se nessun negozio vicino ce l'ha, il volantino nazionale."""
    all_stores: list[dict] = []
    if lat is not None and lon is not None:
        try:
            all_stores = await locator.stores_around(lat, lon)
        except Exception:
            all_stores = []
    out = []
    for s in STORES:
        mine = [dict(x) for x in all_stores if x["chain"] == s["id"]]
        if all_stores and not mine:
            continue  # catena senza negozi vicini
        for x in mine:
            x["_d"] = round(max(haversine_km(lat, lon, x["lat"], x["lon"]) * stores_mod.ROAD_FACTOR, 0.1), 1)
        mine.sort(key=lambda x: x["_d"])
        with_page = [x for x in mine if flyer_url(s["id"], x.get("website"))[1]]
        pick = with_page[0] if with_page else (mine[0] if mine else None)
        url, store_page = flyer_url(s["id"], (pick or {}).get("website"))
        out.append({"store_id": s["id"], "store_name": s["name"], "url": url, "store_page": store_page,
                    "branch_name": (pick or {}).get("name"), "address": (pick or {}).get("address"),
                    "distance_km": (pick or {}).get("_d"),
                    "nearest_km": mine[0]["_d"] if mine else None})
    out.sort(key=lambda f: (f["distance_km"] is None, f["nearest_km"] or 0))
    return out


@api.get("/fuel/nearby")
async def fuel_nearby(fuel: Literal["benzina", "gasolio", "gpl", "metano"] = "benzina",
                      lat: Optional[float] = None, lon: Optional[float] = None,
                      liters: float = Query(40, gt=0, le=200), radius_km: float = Query(5, gt=0, le=15)):
    """Dove fare carburante: i distributori più convenienti vicino a te (dati MIMIT di oggi).

    Si ordina per costo EFFETTIVO del pieno: prezzo x litri + carburante per andarci e
    tornare. Un distributore 2 cent più economico ma a 5 km non conviene."""
    if lat is None or lon is None:
        lat, lon = prices.lat, prices.lon
    else:
        maybe_recenter_prices(lat, lon)
    median = (prices.fuel.get(fuel) or {}).get("price_per_liter")
    cands = fuel_mod.cheapest(prices.stations, lat, lon, fuel, radius_km=radius_km, limit=50)
    if not cands:
        return {"fuel": fuel, "median": median, "stations": [], "best": None, "liters": liters,
                "observed_at": (prices.fuel.get(fuel) or {}).get("observed_at")}
    for c in cands:
        trip = c["distance_km"] * 2 * FUEL_CONSUMPTION_L_100KM / 100 * c["price"]
        c["trip_cost"] = round(trip, 2)
        c["fill_cost"] = round(c["price"] * liters, 2)
        c["effective_cost"] = round(c["fill_cost"] + trip, 2)
        c["saving_vs_median"] = round((median - c["price"]) * liters - trip, 2) if median else None
        c["maps_url"] = f"https://www.google.com/maps/search/?api=1&query={c['lat']},{c['lon']}"
    cands.sort(key=lambda c: c["effective_cost"])
    return {"fuel": fuel, "median": median, "liters": liters, "radius_km": radius_km,
            "observed_at": (prices.fuel.get(fuel) or {}).get("observed_at"),
            "best": cands[0], "stations": cands[:5]}


@api.get("/stores/nearby")
async def stores_nearby(lat: float, lon: float):
    try:
        near = await locator.nearest(lat, lon)
    except Exception:
        raise HTTPException(503, "OpenStreetMap non raggiungibile")
    return {"radius_km": locator.radius_m / 1000,
            "stores": sorted(near.values(), key=lambda s: s["distance_km"]),
            "missing_chains": [s["name"] for s in STORES if s["id"] not in near]}


@api.post("/optimize")
async def optimize(req: OptimizeRequest):
    if req.habitual_store_id and req.habitual_store_id not in STORE_INDEX:
        raise HTTPException(422, "Supermercato abituale sconosciuto")
    stores, location = await stores_for(req.lat, req.lon)
    if req.habitual_store_id and not any(s["id"] == req.habitual_store_id for s in stores):
        location["habitual_missing"] = STORE_INDEX[req.habitual_store_id]["name"]
    result = optimize_list(req, stores)
    result["location"] = location
    shops = await db.history.find({"user_id": req.user_id}, NO_ID).sort("created_at", -1).to_list(BUDGET_HISTORY_LIMIT)
    last = last_similar_shop([i.product_id for i in req.items], shops)
    if last:
        last["same_as_recommended"] = last["store_id"] == result["recommended"]["store_id"]
    result["last_similar"] = last
    return result


# --- Salvadanaio ---
class SavingIn(BaseModel):
    user_id: str
    store_id: str
    amount: float = Field(ge=0)  # risparmio STIMATO al momento della conferma
    note: Optional[str] = None
    reference_type: Optional[Literal["habitual", "median"]] = None
    price_basis: Optional[Literal["reale", "misto", "stima"]] = None
    history_id: Optional[str] = None  # la spesa confermata a cui si riferisce
    estimated_spend: Optional[float] = Field(default=None, ge=0)  # totale scontrino previsto (senza viaggio)
    estimated_total: Optional[float] = Field(default=None, ge=0)  # previsto + carburante


class VerifyIn(BaseModel):
    paid: float = Field(gt=0, description="totale pagato alla cassa, dallo scontrino vero")


def verified_saving(entry: dict, paid: float) -> float:
    """Risparmio verificato = stimato + (spesa prevista - pagato davvero).
    Può essere NEGATIVO: se alla cassa hai speso più del riferimento, la differenza
    viene tolta dal Salvadanaio. Il riferimento resta quello calcolato alla conferma."""
    expected = entry.get("estimated_spend")
    if expected is None:  # voci vecchie senza spesa prevista: si conferma lo stimato
        return round(entry["amount"], 2)
    return round(entry["amount"] + expected - paid, 2)


def saving_value(e: dict) -> float:
    return e["verified_amount"] if e.get("verified") else e["amount"]


@api.post("/savings")
async def add_saving(s: SavingIn):
    doc = {"id": str(uuid.uuid4()), **s.model_dump(), "verified": False, "verified_amount": None, "paid": None,
           "store_name": STORE_INDEX.get(s.store_id, {}).get("name", s.store_id),
           "created_at": now_iso()}
    await db.savings.insert_one(dict(doc))
    return doc


@api.post("/savings/{entry_id}/verify")
async def verify_saving(entry_id: str, body: VerifyIn):
    entry = await db.savings.find_one({"id": entry_id}, NO_ID)
    if not entry:
        raise HTTPException(404, "Voce non trovata")
    amount = verified_saving(entry, body.paid)
    update = {"verified": True, "verified_amount": amount, "paid": round(body.paid, 2), "verified_at": now_iso()}
    await db.savings.update_one({"id": entry_id}, {"$set": update})
    # lo storico usa la spesa vera (viaggio incluso): i budget suggeriti diventano più precisi
    if entry.get("history_id"):
        travel = (entry.get("estimated_total") or 0) - (entry.get("estimated_spend") or 0)
        await db.history.update_one({"id": entry["history_id"]},
                                    {"$set": {"total_cost": round(body.paid + max(travel, 0), 2), "paid": body.paid}})
    return {**entry, **update}


@api.post("/savings/{entry_id}/unverify")
async def unverify_saving(entry_id: str):
    res = await db.savings.update_one({"id": entry_id}, {"$set": {"verified": False, "verified_amount": None, "paid": None}})
    if res.matched_count == 0:
        raise HTTPException(404, "Voce non trovata")
    return {"ok": True}


@api.get("/savings/{user_id}")
async def get_savings(user_id: str):
    entries = await db.savings.find({"user_id": user_id}, NO_ID).sort("created_at", -1).to_list(500)
    return {
        "entries": entries,
        "total": round(sum(saving_value(e) for e in entries), 2),
        "total_verified": round(sum(e["verified_amount"] for e in entries if e.get("verified")), 2),
        "total_estimated": round(sum(e["amount"] for e in entries if not e.get("verified")), 2),
        "to_verify": sum(1 for e in entries if not e.get("verified")),
    }


@api.delete("/savings/{entry_id}")
async def delete_saving(entry_id: str):
    res = await db.savings.delete_one({"id": entry_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Voce non trovata")
    return {"deleted": 1}


# --- Liste salvate ---
class ListIn(BaseModel):
    user_id: str
    name: str
    items: list[ListItem]


@api.post("/lists")
async def save_list(body: ListIn):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.lists.insert_one(dict(doc))
    return doc


@api.get("/lists/{user_id}")
async def get_lists(user_id: str):
    return await db.lists.find({"user_id": user_id}, NO_ID).sort("created_at", -1).to_list(200)


@api.delete("/lists/{list_id}")
async def delete_list(list_id: str):
    res = await db.lists.delete_one({"id": list_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Lista non trovata")
    return {"deleted": 1}


# --- Offerte del giorno ---
@api.get("/offers")
async def offers():
    out = []
    for sid, products in CATALOG.items():
        for pid, info in products.items():
            if info["promo_price"] is None:
                continue
            out.append({
                "store_id": sid, "store_name": STORE_INDEX[sid]["name"],
                "product_id": pid, "product_name": PRODUCT_INDEX[pid]["name"],
                "normal_price": info["normal_price"], "promo_price": info["promo_price"],
                "discount_pct": round((1 - info["promo_price"] / info["normal_price"]) * 100),
                "loyalty_required": info["loyalty_required"],
                "source": info["source"], "observed_at": info["observed_at"],
            })
    # prima le offerte reali, poi le stime; dentro ogni gruppo per sconto
    out.sort(key=lambda o: (o["source"] == "stima", -o["discount_pct"]))
    return out


# --- Fonti prezzi ---
@api.get("/prices/status")
async def prices_status():
    """Da dove vengono i prezzi e quanti sono reali, per catena."""
    per_store = {}
    for sid, products in CATALOG.items():
        real = [pid for pid, i in products.items() if i["source"] != "stima"]
        per_store[sid] = {"real_products": len(real), "total_products": len(products), "products": real}
    return {
        "area": {"lat": PRICE_LAT, "lon": PRICE_LON, "radius_km": PRICE_RADIUS_KM},
        "sources": prices.status,
        "fuel": prices.fuel,
        "coverage": per_store,
    }


@api.post("/prices/refresh")
async def prices_refresh():
    await prices.refresh()
    rebuild_catalog()
    return await prices_status()


# --- Storico e lista abituale ---
class HistoryIn(BaseModel):
    user_id: str
    items: list[ListItem]
    store_id: Optional[str] = None
    total_cost: Optional[float] = Field(default=None, ge=0)  # quanto è costata (viaggio incluso)


@api.post("/history")
async def add_history(body: HistoryIn):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.history.insert_one(dict(doc))
    return doc


class BudgetSuggestIn(BaseModel):
    user_id: str
    items: list[ListItem]


@api.post("/budget/suggest")
async def budget_suggest(body: BudgetSuggestIn):
    shops = await db.history.find({"user_id": body.user_id, "total_cost": {"$gt": 0}}, NO_ID) \
        .sort("created_at", -1).to_list(BUDGET_HISTORY_LIMIT)
    out = suggest_budget([i.product_id for i in body.items], shops)
    out["last_similar"] = last_similar_shop([i.product_id for i in body.items], shops)
    return out


@api.get("/habitual/{user_id}")
async def habitual(user_id: str):
    shops = await db.history.find({"user_id": user_id}, NO_ID).sort("created_at", -1).to_list(20)
    return {"items": habitual_from_history(shops), "based_on": len(shops)}


# --- Famiglia ---
class FamilyCreate(BaseModel):
    user_id: str
    display_name: str = "Io"


class FamilyJoin(FamilyCreate):
    code: str


class FamilyLeave(BaseModel):
    user_id: str


class FamilyListIn(BaseModel):
    code: str
    user_id: str
    items: list[ListItem]


def new_code() -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


@api.post("/family/create")
async def family_create(body: FamilyCreate):
    existing = await db.families.find_one({"members.user_id": body.user_id}, NO_ID)
    if existing:
        return existing
    code = new_code()
    while await db.families.find_one({"code": code}):
        code = new_code()
    doc = {"code": code, "created_at": now_iso(),
           "members": [{"user_id": body.user_id, "display_name": body.display_name}]}
    await db.families.insert_one(dict(doc))
    return doc


@api.post("/family/join")
async def family_join(body: FamilyJoin):
    code = body.code.strip().upper()
    fam = await db.families.find_one({"code": code}, NO_ID)
    if not fam:
        raise HTTPException(404, "Codice famiglia non trovato")
    # un utente sta in una sola famiglia
    await _leave_families(body.user_id, keep_code=code)
    if not any(m["user_id"] == body.user_id for m in fam["members"]):
        await db.families.update_one(
            {"code": code},
            {"$push": {"members": {"user_id": body.user_id, "display_name": body.display_name}}})
    return await db.families.find_one({"code": code}, NO_ID)


async def _leave_families(user_id: str, keep_code: Optional[str] = None) -> None:
    query: dict = {"members.user_id": user_id}
    if keep_code:
        query["code"] = {"$ne": keep_code}
    async for fam in db.families.find(query, NO_ID):
        await db.families.update_one({"code": fam["code"]},
                                     {"$pull": {"members": {"user_id": user_id}}})
        updated = await db.families.find_one({"code": fam["code"]}, NO_ID)
        if updated and not updated["members"]:
            await db.families.delete_one({"code": fam["code"]})
            await db.family_lists.delete_one({"code": fam["code"]})


@api.post("/family/leave")
async def family_leave(body: FamilyLeave):
    await _leave_families(body.user_id)
    return {"ok": True}


@api.get("/family/by-user/{user_id}")
async def family_by_user(user_id: str):
    return await db.families.find_one({"members.user_id": user_id}, NO_ID) or {}


@api.post("/family/list")
async def family_list_push(body: FamilyListIn):
    fam = await db.families.find_one({"code": body.code, "members.user_id": body.user_id})
    if not fam:
        raise HTTPException(403, "Non fai parte di questa famiglia")
    doc = {"code": body.code, "items": [i.model_dump() for i in body.items],
           "updated_by": body.user_id, "updated_at": now_iso()}
    await db.family_lists.update_one({"code": body.code}, {"$set": doc}, upsert=True)
    return doc


@api.get("/family/list/{code}")
async def family_list_pull(code: str):
    return await db.family_lists.find_one({"code": code.upper()}, NO_ID) or {"code": code, "items": []}


app.include_router(api)


# ---------------------------------------------------------------------------
# 5. Web app: se esiste la build (frontend/dist) la serviamo dallo stesso server,
#    così basta aprire http://localhost:8001 nel browser.
# ---------------------------------------------------------------------------
WEB_DIST = Path(os.environ.get("WEB_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"))


class SPAStaticFiles(StaticFiles):
    """File statici con ritorno a index.html per le rotte dell'app (es. /risultati)."""

    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code != 404:
                raise
            response = None
        if response is None or response.status_code == 404:
            return await super().get_response("index.html", scope)
        return response


if (WEB_DIST / "index.html").exists():
    app.mount("/", SPAStaticFiles(directory=WEB_DIST, html=True), name="web")
