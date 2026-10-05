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
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

import receipts
import recipes
import storage
from catalog_extra import EXTRA_PRODUCTS, NEW_CATEGORIES
from classify import Classifier, normalize
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
    ("prosciutto", "Prosciutto cotto", "salumi", 0.15, "kg"),
    ("bistecca", "Bistecca di manzo", "carne", 0.4, "kg"),
    ("salmone", "Filetto di salmone", "pesce", 0.3, "kg"),
    ("tonno", "Tonno in scatola 3x80g", "pesce", 1, "conf"),
    ("merluzzo", "Filetti di merluzzo", "pesce", 0.4, "kg"),
    ("latte", "Latte intero 1L", "latticini", 1, "L"),
    ("uova", "Uova fresche x6", "latticini", 1, "conf"),
    ("mozzarella", "Mozzarella 125g", "latticini", 1, "pz"),
    ("parmigiano", "Parmigiano Reggiano", "salumi", 0.3, "kg"),
    ("yogurt", "Yogurt bianco 4x125g", "latticini", 1, "conf"),
    ("burro", "Burro 250g", "latticini", 1, "pz"),
    ("pane", "Pane comune", "pane", 0.5, "kg"),
    ("fette_biscottate", "Fette biscottate", "colazione", 1, "conf"),
    ("biscotti", "Biscotti frollini", "colazione", 1, "conf"),
    ("cracker", "Cracker salati", "pane", 1, "conf"),
    ("pasta", "Pasta di semola", "dispensa", 2, "kg"),
    ("riso", "Riso Carnaroli 1kg", "dispensa", 1, "kg"),
    ("passata", "Passata di pomodoro 700g", "dispensa", 1, "pz"),
    ("olio_evo", "Olio extravergine 1L", "condimenti", 1, "L"),
    ("farina", "Farina 00 1kg", "dispensa", 1, "kg"),
    ("zucchero", "Zucchero 1kg", "colazione", 1, "kg"),
    ("caffe", "Caffè macinato 250g", "colazione", 1, "pz"),
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
    ("shampoo", "Shampoo", "persona", 1, "pz"),
]
# Catalogo esteso (altre categorie e prodotti): vedi catalog_extra.py
CATEGORIES += NEW_CATEGORIES
PRODUCTS += [p[:5] for p in EXTRA_PRODUCTS]

PRODUCT_INDEX = {
    p[0]: {"id": p[0], "name": p[1], "category_id": p[2], "default_qty": p[3], "unit": p[4]}
    for p in PRODUCTS
}
classifier = Classifier(list(PRODUCT_INDEX.values()), CATEGORIES)

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

BASE_PRICES.update({p[0]: p[5] for p in EXTRA_PRODUCTS})

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


# Prezzi veri letti dagli scontrini degli utenti: (negozio, prodotto) -> ultimo prezzo
RECEIPT_PRICES: dict[tuple[str, str], dict] = {}


def receipt_entry(doc: dict) -> dict:
    age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(doc["date"]).date()).days
    return {"normal_price": doc["ref_price"], "promo_price": None, "source": "scontrino",
            "observations": 1, "observed_at": doc["date"], "age_days": age,
            "confidence": "green" if age <= 60 else "yellow" if age <= 365 else "red",
            "location_name": doc.get("location_name") or STORE_INDEX[doc["store_id"]]["name"],
            "sample_product": doc.get("receipt_text"), "proof_url": None}


async def load_receipt_prices() -> None:
    RECEIPT_PRICES.clear()
    async for doc in db.user_prices.find({}, NO_ID).sort("date", 1):
        if doc.get("store_id") in STORE_INDEX and doc.get("product_id") in PRODUCT_INDEX:
            RECEIPT_PRICES[(doc["store_id"], doc["product_id"])] = receipt_entry(doc)


def rebuild_catalog() -> None:
    global CATALOG
    # priorità: scontrini degli utenti (il prezzo vero del negozio) > Open Prices > stime
    CATALOG = build_catalog({**prices.real, **RECEIPT_PRICES})


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
    product_id: str  # id del catalogo, oppure "custom:..." per un prodotto scritto a mano
    quantity: float = Field(gt=0)
    # solo per i prodotti scritti a mano (stile Bring)
    name: Optional[str] = Field(default=None, max_length=80)
    category_id: Optional[str] = None
    unit: Optional[str] = Field(default=None, max_length=10)


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
    # "devo anche fare carburante": si cerca il distributore migliore sulla strada di ogni negozio
    refuel: bool = False
    refuel_liters: Optional[float] = Field(default=None, gt=0, le=200)  # facoltativo: default 40 l


def compute_virtual_receipt(store_id: str, items: list[ListItem]) -> dict:
    lines, unknown = [], []
    total = normal_total = 0.0
    custom = []
    for it in items:
        if it.product_id.startswith("custom:"):
            # scritto a mano: senza prezzo, costa uguale ovunque -> fuori dal confronto
            custom.append({"product_id": it.product_id, "name": it.name or it.product_id[7:],
                           "quantity": it.quantity, "unit": it.unit or "pz", "category_id": it.category_id})
            continue
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
        "custom_items": custom,  # prodotti scritti a mano: in lista, ma senza prezzo
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
        # risparmio sul pieno sulla strada: a parte, conta solo se il pieno lo fai davvero
        "fuel_saving": (recommended.get("fuel_stop") or {}).get("saving", 0.0),
    }


DEFAULT_REFUEL_LITERS = 40.0  # pieno medio, se l'utente non indica i litri
MAX_DETOUR_KM = 3.0  # oltre, non è più "sulla strada"


def best_fuel_stop(home: tuple[float, float], store_pt: tuple[float, float], stations: list[dict],
                   fuel_type: str, liters: float, median: Optional[float]) -> Optional[dict]:
    """Il distributore che conviene di più fermandosi sulla strada casa -> negozio.

    deviazione = (casa->distributore + distributore->negozio - casa->negozio) x fattore strada
    costo      = prezzo x litri + carburante della deviazione + tempo della deviazione (pesato)
    risparmio  = pieno al prezzo medio della zona - (prezzo x litri + carburante della deviazione)"""
    if not median:
        return None
    direct = haversine_km(*home, *store_pt)
    cands = []
    for st in stations:
        price = (st["prices"].get(fuel_type) or {}).get("self")
        if price is None:
            continue
        detour = (haversine_km(*home, st["lat"], st["lon"]) + haversine_km(st["lat"], st["lon"], *store_pt) - direct) \
            * stores_mod.ROAD_FACTOR
        detour = max(detour, 0.0)
        if detour > MAX_DETOUR_KM:
            continue
        detour_fuel = detour * FUEL_CONSUMPTION_L_100KM / 100 * price
        detour_min = detour / TRANSPORT_SPEED["car"] * 60
        cost = price * liters + detour_fuel
        rank = cost + TIME_WEIGHT * detour_min / 60 * TIME_VALUE
        cands.append({"_rank": rank, "_cost": cost, "station_id": st["id"], "brand": st["brand"], "address": st["address"],
                      "city": st["city"], "lat": st["lat"], "lon": st["lon"], "price": price,
                      "detour_km": round(detour, 1), "detour_min": round(detour_min), "detour_cost": round(detour_fuel, 2),
                      "liters": liters, "median": median, "fill_cost": round(price * liters, 2),
                      "saving": round(median * liters - cost, 2), "updated": st.get("updated"),
                      "maps_url": f"https://www.google.com/maps/search/?api=1&query={st['lat']},{st['lon']}"})
    if not cands:
        return None
    cands.sort(key=lambda c: c["_rank"])
    best = cands[0]
    # gli altri distributori sulla strada, con quanto costerebbero in più: così si vede perché
    # è stato scelto proprio quello (spesso la differenza è di pochi centesimi)
    best["alternatives"] = [
        {k: c[k] for k in ("brand", "address", "city", "price", "detour_km", "maps_url", "updated")}
        | {"extra_cost": round(c["_cost"] - best["_cost"], 2)}
        for c in cands[1:4]
    ]
    for c in cands:
        c.pop("_rank", None)
        c.pop("_cost", None)
    return best


def optimize_list(req: OptimizeRequest, stores: Optional[list[dict]] = None) -> dict:
    """stores: punti vendita da confrontare (default: STORES con distanze di esempio)."""
    ranked = []
    fuel = fuel_info(req.fuel_type)
    liters = req.refuel_liters or DEFAULT_REFUEL_LITERS
    can_refuel = req.refuel and req.transport == "car" and req.lat is not None and req.lon is not None
    for store in stores if stores is not None else STORES:
        receipt = compute_virtual_receipt(store["id"], req.items)
        travel = compute_travel(store, req.transport, fuel)
        total_cost = round(receipt["total"] + travel["fuel_cost"], 2)
        score = round(total_cost + TIME_WEIGHT * travel["time_cost"], 2)
        stop = None
        if can_refuel:
            b = store.get("branch") or {}
            pt = (b.get("lat", store.get("lat")), b.get("lon", store.get("lng")))
            stop = best_fuel_stop((req.lat, req.lon), pt, prices.stations, req.fuel_type, liters,
                                  fuel["price_per_liter"] if fuel["source"] == "mimit" else None)
            if stop and stop["saving"] > 0:
                # il pieno conveniente sulla strada rende più conveniente questo negozio
                score = round(score - stop["saving"] + TIME_WEIGHT * stop["detour_min"] / 60 * TIME_VALUE, 2)
            elif stop:
                stop = None  # nessun distributore sulla strada batte la media: niente deviazione
        ranked.append({
            "fuel_stop": stop,
            "store_id": store["id"],
            "store_name": store["name"],
            "branch": store.get("branch"),  # punto vendita reale (nome, indirizzo), se c'è la posizione
            "confidence": store_confidence(receipt),
            "receipt": receipt,
            "travel": travel,
            "total_cost": total_cost,
            "score": score,
        })
    for r in ranked:
        # costo complessivo per il confronto: spesa + viaggio - risparmio sul pieno
        r["effective_cost"] = round(r["total_cost"] - (r["fuel_stop"]["saving"] if r["fuel_stop"] else 0), 2)
    ranked.sort(key=lambda r: r["score"])
    best = ranked[0]
    recommended = best
    habitual = next((r for r in ranked if r["store_id"] == req.habitual_store_id), None)

    # Regola anti-fatica: non cambiare supermercato per pochi euro.
    if habitual and habitual is not best:
        delta = round(habitual["effective_cost"] - best["effective_cost"], 2)
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
        diff = round(second["effective_cost"] - best["effective_cost"], 2) if second else 0
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

    stop = recommended.get("fuel_stop")
    if stop:
        reasoning += (f" Sulla strada fai {req.fuel_type} da {stop['brand']} a {stop['price']:.3f} €/l".replace(".", ",")
                      + f": risparmi {euro(stop['saving'])} sul pieno.")
    elif can_refuel:
        reasoning += " Nessun distributore sulla strada costa meno della media in zona."

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
HABITUAL_MIN_OCCASIONS = 3   # sotto, non si può ancora parlare di abitudini
HABITUAL_MIN_SHARE = 0.4     # il prodotto deve esserci in almeno il 40% delle spese (pesate per recenza)
HABITUAL_RECENCY = 0.9       # ogni spesa più vecchia conta un po' meno
DUPLICATE_DAYS = 3           # stesso carrello confermato di nuovo entro pochi giorni = stessa spesa


def shopping_occasions(shops: list[dict]) -> list[dict]:
    """Raggruppa lo storico in spese "vere": lo stesso carrello confermato più volte
    (o quasi uguale, a pochi giorni di distanza) conta una volta sola.
    shops: dal più recente al più vecchio. Ogni spesa: {date, items: {pid: qty}}."""
    occ: list[dict] = []
    for shop in shops:
        items: dict[str, float] = {}
        for it in shop.get("items", []):
            pid = it["product_id"]
            if pid in PRODUCT_INDEX:
                items[pid] = max(items.get(pid, 0.0), float(it["quantity"]))
        if not items:
            continue
        try:
            when = datetime.fromisoformat(shop["created_at"])
        except Exception:
            when = None
        dup = None
        for o in occ[-3:]:
            close = when is None or o["date"] is None or abs((o["date"] - when).days) <= DUPLICATE_DAYS
            if close and jaccard(set(items), set(o["items"])) >= 0.7:
                dup = o
                break
        if dup:
            for pid, q in items.items():
                dup["items"][pid] = max(dup["items"].get(pid, 0.0), q)
        else:
            occ.append({"date": when, "items": items})
    return occ


def habitual_from_history(shops: list[dict]) -> dict:
    """Prodotti che compri davvero spesso (regole, nessuna AI):
    - le conferme ripetute dello stesso carrello contano una spesa sola;
    - servono almeno 3 spese diverse;
    - il prodotto deve comparire in almeno 2 spese e nel 40% di quelle recenti (le recenti pesano di più);
    - quantità: la mediana di quelle che metti di solito."""
    occ = shopping_occasions(shops)
    if len(occ) < HABITUAL_MIN_OCCASIONS:
        return {"items": [], "occasions": len(occ), "needed": HABITUAL_MIN_OCCASIONS}
    weights = [HABITUAL_RECENCY ** i for i in range(len(occ))]  # occ[0] è la più recente
    total_w = sum(weights)
    agg: dict[str, dict] = {}
    for w, o in zip(weights, occ):
        for pid, q in o["items"].items():
            a = agg.setdefault(pid, {"count": 0, "w": 0.0, "qty": []})
            a["count"] += 1
            a["w"] += w
            a["qty"].append(q)
    result = []
    for pid, a in agg.items():
        share = a["w"] / total_w
        if a["count"] >= 2 and share >= HABITUAL_MIN_SHARE:
            result.append({"product_id": pid, "name": PRODUCT_INDEX[pid]["name"], "count": a["count"],
                           "share": round(share, 2), "quantity": round(statistics.median(a["qty"]), 3)})
    result.sort(key=lambda r: (-r["share"], r["name"]))
    return {"items": result, "occasions": len(occ), "needed": HABITUAL_MIN_OCCASIONS}


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
    try:
        await load_receipt_prices()
    except Exception as e:
        log.warning("Prezzi da scontrino non caricati: %s", e)
    prices.load_cache()
    rebuild_catalog()
    if PRICES_AUTO_REFRESH:
        tasks.append(asyncio.create_task(prices.refresh_forever(PRICES_REFRESH_HOURS, rebuild_catalog)))
    # ricette: si preparano in background (abbinamento ingredienti -> prodotti), qualche secondo
    tasks.append(asyncio.create_task(run_in_threadpool(lambda: [recipe_core(r) for r in recipes.collection()])))
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


class ClassifyIn(BaseModel):
    text: str = Field(min_length=1, max_length=80)


@api.post("/products/classify")
async def classify_product(body: ClassifyIn):
    """Prodotto scritto a mano: categoria e prodotti simili del catalogo (regole, niente AI)."""
    return classifier.classify(body.text)


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
    # pieno sulla strada (facoltativo): stima a parte, conta solo se il pieno viene fatto
    fuel_saving: float = 0.0
    fuel_liters: Optional[float] = None
    fuel_median: Optional[float] = None
    fuel_detour_cost: Optional[float] = None
    fuel_station: Optional[str] = None
    # scontrino virtuale calcolato alla conferma (negozio, righe, totali): per rivederlo nello storico
    snapshot: Optional[dict] = None


class VerifyIn(BaseModel):
    paid: float = Field(gt=0, description="totale pagato alla cassa, dallo scontrino vero")
    refueled: Optional[bool] = None  # hai fatto il pieno consigliato? (solo se c'era)
    fuel_price: Optional[float] = Field(default=None, gt=0, lt=5)  # €/l pagati davvero


def verified_fuel_saving(entry: dict, refueled: Optional[bool], fuel_price: Optional[float]) -> float:
    est = entry.get("fuel_saving") or 0.0
    if not est and fuel_price is None:
        return 0.0
    if refueled is False:
        return 0.0  # il pieno non l'hai fatto: niente risparmio carburante
    if fuel_price is not None and entry.get("fuel_median") and entry.get("fuel_liters"):
        return round((entry["fuel_median"] - fuel_price) * entry["fuel_liters"] - (entry.get("fuel_detour_cost") or 0), 2)
    return round(est, 2)  # confermato senza prezzo: resta la stima


def verified_saving(entry: dict, paid: float) -> float:
    """Risparmio verificato = stimato + (spesa prevista - pagato davvero).
    Può essere NEGATIVO: se alla cassa hai speso più del riferimento, la differenza
    viene tolta dal Salvadanaio. Il riferimento resta quello calcolato alla conferma."""
    expected = entry.get("estimated_spend")
    shop = entry["amount"] - (entry.get("fuel_saving") or 0.0)  # parte spesa della stima
    if expected is None:  # voci vecchie senza spesa prevista: si conferma lo stimato
        return round(shop, 2)
    return round(shop + expected - paid, 2)


def saving_value(e: dict) -> float:
    return e["verified_amount"] if e.get("verified") else e["amount"]


@api.post("/savings")
async def add_saving(s: SavingIn):
    doc = {"id": str(uuid.uuid4()), **s.model_dump(), "verified": False, "verified_amount": None, "paid": None,
           "store_name": STORE_INDEX.get(s.store_id, {}).get("name", s.store_id),
           "created_at": now_iso()}
    await db.savings.insert_one(dict(doc))
    return doc


class ScanIn(BaseModel):
    # una foto sola oppure più pezzi dello stesso scontrino, dall'alto in basso
    image_base64: Optional[str] = Field(default=None, min_length=100)
    images: list[str] = Field(default_factory=list, max_length=6)
    saving_id: Optional[str] = None


@api.post("/receipts/scan")
async def scan_receipt(body: ScanIn):
    """Legge la foto dello scontrino e la abbina alla spesa confermata (se indicata)."""
    images = ([body.image_base64] if body.image_base64 else []) + body.images
    if not images:
        raise HTTPException(422, "Nessuna foto")
    if len(images) > 6:
        raise HTTPException(422, "Al massimo 6 foto per scontrino")
    parts, n_boxes = [], 0
    for img in images:
        try:
            data = receipts.decode_image(img)
        except Exception:
            raise HTTPException(422, "Immagine non valida")
        if len(data) > 15_000_000:
            raise HTTPException(413, "Foto troppo grande")
        try:
            boxes = await run_in_threadpool(receipts.ocr_image, data)
        except ImportError:
            raise HTTPException(503, "Lettura scontrini non installata: riavvia l'app per installarla")
        except Exception:
            raise HTTPException(422, "Non riesco a leggere questa foto")
        n_boxes += len(boxes)
        parts.append(receipts.group_rows(boxes))
    rows, overlaps = receipts.merge_rows(parts)
    parsed = receipts.parse_rows(rows)
    expected, entry = [], None
    if body.saving_id:
        entry = await db.savings.find_one({"id": body.saving_id}, NO_ID)
        snap = (entry or {}).get("snapshot") or {}
        expected = [l["product_id"] for l in (snap.get("receipt") or {}).get("lines", [])]
    parsed = receipts.match_lines(parsed, PRODUCT_INDEX, expected)
    # confronto riga per riga con lo scontrino calcolato
    calc = {l["product_id"]: l for l in (((entry or {}).get("snapshot") or {}).get("receipt") or {}).get("lines", [])}
    for line in parsed["lines"]:
        c = calc.get(line["product_id"])
        line["calculated_price"] = c["line_price"] if c else None
        p = PRODUCT_INDEX.get(line["product_id"]) if line["product_id"] else None
        line["ref_price"] = receipts.reference_price(line, p) if p else None
    if not parsed["store_id"] and entry:
        parsed["store_id"] = entry.get("store_id")
    parsed["rows"] = rows  # testo letto, per controllo
    parsed["ocr_boxes"] = n_boxes
    parsed["photos"] = len(images)
    parsed["overlaps"] = overlaps  # righe ripetute tolte tra una foto e la successiva
    if parsed["total"] is not None and not parsed["total_matches"]:
        parsed["missing_amount"] = round(parsed["total"] - parsed["lines_sum"], 2)
    return parsed


class ReceiptLineIn(BaseModel):
    product_id: Optional[str] = None
    text: str = Field(max_length=120)
    net_price: float = Field(ge=0, lt=1000)
    quantity: float = Field(default=1, gt=0, le=999)
    weight_kg: Optional[float] = Field(default=None, gt=0, le=100)


class ApplyReceiptIn(BaseModel):
    saving_id: Optional[str] = None
    user_id: str
    store_id: str
    date: Optional[str] = None
    total: Optional[float] = Field(default=None, gt=0, lt=5000)
    lines: list[ReceiptLineIn] = Field(max_length=200)
    refueled: Optional[bool] = None
    fuel_price: Optional[float] = Field(default=None, gt=0, lt=5)


@api.post("/receipts/apply")
async def apply_receipt(body: ApplyReceiptIn):
    """Salva i prezzi veri dello scontrino (diventano prezzi reali "R" per quel negozio)
    e, se c'è la spesa, la verifica con il totale pagato."""
    if body.store_id not in STORE_INDEX:
        raise HTTPException(422, "Negozio sconosciuto")
    date = body.date or datetime.now(timezone.utc).date().isoformat()
    try:
        datetime.fromisoformat(date)
    except ValueError:
        date = datetime.now(timezone.utc).date().isoformat()
    saved = 0
    entry = await db.savings.find_one({"id": body.saving_id}, NO_ID) if body.saving_id else None
    branch = (((entry or {}).get("snapshot") or {}).get("branch") or {}).get("name")
    for l in body.lines:
        p = PRODUCT_INDEX.get(l.product_id or "")
        if not p:
            continue
        ref = receipts.reference_price(l.model_dump(), p)
        if not ref or ref <= 0:
            continue
        doc = {"id": str(uuid.uuid4()), "user_id": body.user_id, "store_id": body.store_id, "product_id": p["id"],
               "ref_price": ref, "paid": l.net_price, "quantity": l.quantity, "weight_kg": l.weight_kg,
               "receipt_text": l.text, "date": date, "location_name": branch, "saving_id": body.saving_id,
               "created_at": now_iso()}
        await db.user_prices.insert_one(dict(doc))
        RECEIPT_PRICES[(body.store_id, p["id"])] = receipt_entry(doc)
        saved += 1
    rebuild_catalog()
    out = {"prices_saved": saved}
    if entry and body.total:
        update = {"real_receipt": {"store_id": body.store_id, "date": date, "total": body.total,
                                   "lines": [l.model_dump() for l in body.lines]}}
        await db.savings.update_one({"id": entry["id"]}, {"$set": update})
        out["verified"] = await verify_saving(entry["id"], VerifyIn(paid=body.total, refueled=body.refueled,
                                                                     fuel_price=body.fuel_price))
    return out


@api.post("/savings/{entry_id}/verify")
async def verify_saving(entry_id: str, body: VerifyIn):
    entry = await db.savings.find_one({"id": entry_id}, NO_ID)
    if not entry:
        raise HTTPException(404, "Voce non trovata")
    shop = verified_saving(entry, body.paid)
    fuel_part = verified_fuel_saving(entry, body.refueled, body.fuel_price)
    update = {"verified": True, "verified_amount": round(shop + fuel_part, 2), "verified_fuel": fuel_part,
              "paid": round(body.paid, 2), "fuel_price_paid": body.fuel_price, "refueled": body.refueled,
              "verified_at": now_iso()}
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
    shops = await db.history.find({"user_id": user_id}, NO_ID).sort("created_at", -1).to_list(40)
    out = habitual_from_history(shops)
    return {**out, "based_on": len(shops)}


# --- Ricette ---
class RecipeIn(BaseModel):
    user_id: str
    name: str = Field(min_length=1, max_length=120)
    servings: Optional[int] = Field(default=4, ge=1, le=50)
    ingredients: list[str] = Field(min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=4000)
    url: Optional[str] = Field(default=None, max_length=500)
    source: Optional[str] = Field(default=None, max_length=80)


class PlanIn(BaseModel):
    servings: int = Field(ge=1, le=50)
    recipe_id: Optional[str] = None
    user_id: Optional[str] = None
    # oppure la ricetta "al volo" (es. appena letta da un link, non ancora salvata)
    ingredients: Optional[list[str]] = None
    recipe_servings: Optional[int] = None


class ImportIn(BaseModel):
    url: str = Field(min_length=8, max_length=500)


async def family_user_ids(user_id: Optional[str]) -> list[str]:
    if not user_id:
        return []
    fam = await db.families.find_one({"members.user_id": user_id}, NO_ID)
    return [m["user_id"] for m in (fam or {}).get("members", [])] or [user_id]


def recipe_summary(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "name", "servings", "source", "url", "categories", "user_id")} | \
        {"n_ingredients": len(r.get("ingredients", [])), "mine": r.get("source") != "Wikibooks"}


async def find_recipe(recipe_id: str, user_id: Optional[str]) -> Optional[dict]:
    if recipe_id.startswith("wb:"):
        return next((r for r in recipes.collection() if r["id"] == recipe_id), None)
    r = await db.recipes.find_one({"id": recipe_id}, NO_ID)
    if r and r["user_id"] not in await family_user_ids(user_id):
        return None  # ricette personali: solo per te e la tua famiglia
    return r


# --- Ricette x lista x prezzi x abitudini (regole, nessuna AI) ---
_RECIPE_CORE: dict[str, dict] = {}
MAIN_DISH = ("Primi piatti", "Secondi piatti", "Piatti unici", "Risotti", "Torte salate", "Pizza")


def recipe_core(r: dict) -> dict:
    """Piano della ricetta alle sue dosi, in cache: cosa serve (esclusi gli ingredienti "di casa")."""
    key = f"{r.get('id')}|{r.get('servings')}|{hash(tuple(r.get('ingredients', [])))}"
    core = _RECIPE_CORE.get(key)
    if core is None:
        base = r.get("servings") or 4
        rows = recipes.plan(r.get("ingredients", []), base, base, PRODUCT_INDEX)
        core = {"servings": base, "rows": rows,
                "needs": [x for x in rows if x["product_id"] and not x["pantry"]],
                "unknown": [x["name"] for x in rows if not x["product_id"] and not x["pantry"]]}
        _RECIPE_CORE[key] = core
    return core


def _row_cost(store_id: str, pid: str, qty: float) -> Optional[float]:
    info = CATALOG.get(store_id, {}).get(pid)
    p = PRODUCT_INDEX.get(pid)
    if not info or not p:
        return None
    return info["final_price"] * qty / p["default_qty"]


def portion_cost(core: dict, store_id: str) -> Optional[float]:
    """Costo a persona di quello che si usa davvero (mezzo pacco di spaghetti = mezzo prezzo)."""
    tot = 0.0
    for row in core["needs"]:
        p = PRODUCT_INDEX[row["product_id"]]
        used = row.get("used") if row.get("used") is not None else p["default_qty"] * 0.25
        c = _row_cost(store_id, row["product_id"], used)
        if c is None:
            return None
        tot += c
    return round(tot / core["servings"], 2)


def best_portion(core: dict) -> Optional[dict]:
    best = None
    for st in STORES:
        c = portion_cost(core, st["id"])
        if c is not None and (best is None or c < best["portion"]):
            best = {"store_id": st["id"], "store_name": st["name"], "portion": c}
    if best:
        best["complete"] = not core["unknown"]  # ingredienti senza prezzo esclusi dal costo
    return best


def buy_costs(rows: list[dict]) -> list[dict]:
    """Quanto spendi per comprare queste righe in ogni catena (confezioni intere)."""
    out = []
    for st in STORES:
        tot, ok = 0.0, True
        for r in rows:
            if not r.get("product_id") or r.get("pantry"):
                continue
            c = _row_cost(st["id"], r["product_id"], r["quantity"])
            if c is None:
                ok = False
                break
            tot += c
        if ok:
            out.append({"store_id": st["id"], "store_name": st["name"], "total": round(tot, 2)})
    return sorted(out, key=lambda x: x["total"])


async def all_recipes_for(user_id: Optional[str]) -> list[dict]:
    ids = await family_user_ids(user_id)
    mine = await db.recipes.find({"user_id": {"$in": ids}}, NO_ID).to_list(500) if ids else []
    return mine + recipes.collection()


def recipe_summary_priced(r: dict) -> dict:
    out = recipe_summary(r)
    out["cheapest"] = best_portion(recipe_core(r))
    return out


@api.get("/recipes")
async def list_recipes(q: str = "", user_id: Optional[str] = None, limit: int = Query(40, ge=1, le=100),
                       sort: Literal["rilevanza", "prezzo"] = "rilevanza", main: bool = False):
    """Le tue ricette (e della tua famiglia) prima, poi la raccolta libera di Wikibooks.
    sort=prezzo: dalla più economica a persona (solo piatti con tutti gli ingredienti a prezzo)."""
    ids = await family_user_ids(user_id)
    mine = await db.recipes.find({"user_id": {"$in": ids}}, NO_ID).sort("updated_at", -1).to_list(500) if ids else []
    if sort == "prezzo":
        pool = recipes.search(mine, q, 10_000) + recipes.search(recipes.collection(), q, 10_000) if q else mine + recipes.collection()
        priced = []
        for r in pool:
            core = recipe_core(r)
            cats = r.get("categories") or []
            if core["unknown"] or len(core["needs"]) < 2 or any(c.startswith("Bevande") for c in cats):
                continue
            if main and r.get("source") == "Wikibooks" and not any(c.startswith(MAIN_DISH) for c in cats):
                continue  # solo piatti principali (niente biscotti in cima alla classifica)
            b = best_portion(core)
            if b:
                priced.append((b["portion"], r))
        priced.sort(key=lambda x: x[0])
        found = [r for _, r in priced[:limit]]
    else:
        found = (recipes.search(mine, q, limit) + recipes.search(recipes.collection(), q, limit))[:limit]
    return {"recipes": [recipe_summary_priced(r) for r in found], "total_collection": len(recipes.collection()),
            "license": recipes.LICENSE}


@api.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, user_id: Optional[str] = None):
    r = await find_recipe(recipe_id, user_id)
    if not r:
        raise HTTPException(404, "Ricetta non trovata")
    return r


@api.post("/recipes/plan")
async def plan_recipe(body: PlanIn):
    """Ingredienti -> proposta per la lista della spesa, scalata per le persone."""
    if body.recipe_id:
        r = await find_recipe(body.recipe_id, body.user_id)
        if not r:
            raise HTTPException(404, "Ricetta non trovata")
        lines, base = r["ingredients"], r.get("servings")
    elif body.ingredients:
        lines, base = body.ingredients, body.recipe_servings
    else:
        raise HTTPException(422, "Indica la ricetta")
    rows = recipes.plan(lines, base, body.servings, PRODUCT_INDEX)
    for row in rows:  # prodotti non in catalogo: categoria proposta per aggiungerli come nuovi
        if not row["product_id"]:
            row["category_id"] = classifier.classify(row["name"])["category_id"]
    costs = buy_costs(rows)
    core = recipe_core({"id": body.recipe_id or "inline", "servings": base, "ingredients": lines})
    return {"servings": body.servings, "recipe_servings": base or 4, "assumed_servings": base is None, "items": rows,
            "costs": costs, "cheapest": best_portion(core)}


@api.post("/recipes/import")
async def import_recipe(body: ImportIn):
    """Legge una ricetta da un link (solo titolo, porzioni, ingredienti). Non la salva."""
    try:
        return await recipes.fetch_recipe(body.url)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(502, "Non riesco ad aprire questa pagina")


@api.post("/recipes")
async def create_recipe(body: RecipeIn):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "source": body.source or "mia",
           "created_at": now_iso(), "updated_at": now_iso()}
    doc["ingredients"] = [l.strip() for l in doc["ingredients"] if l.strip()]
    await db.recipes.insert_one(dict(doc))
    return doc


@api.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, body: RecipeIn):
    r = await db.recipes.find_one({"id": recipe_id}, NO_ID)
    if not r or r["user_id"] not in await family_user_ids(body.user_id):
        raise HTTPException(404, "Ricetta non trovata")
    upd = {**body.model_dump(exclude={"user_id"}), "updated_at": now_iso()}
    upd["ingredients"] = [l.strip() for l in upd["ingredients"] if l.strip()]
    upd["source"] = body.source or r.get("source") or "mia"
    await db.recipes.update_one({"id": recipe_id}, {"$set": upd})
    return {**r, **upd}


@api.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, user_id: str):
    r = await db.recipes.find_one({"id": recipe_id}, NO_ID)
    if not r or r["user_id"] not in await family_user_ids(user_id):
        raise HTTPException(404, "Ricetta non trovata")
    await db.recipes.delete_one({"id": recipe_id})
    return {"ok": True}


class MenuEntry(BaseModel):
    recipe_id: str
    servings: int = Field(ge=1, le=50)


class MenuIn(BaseModel):
    user_id: Optional[str] = None
    entries: list[MenuEntry] = Field(min_length=1, max_length=14)


@api.post("/recipes/menu")
async def recipes_menu(body: MenuIn):
    """Più ricette (es. il menu della settimana) in un'unica lista: quantità sommate, poi arrotondate."""
    groups, names = [], []
    for e in body.entries:
        r = await find_recipe(e.recipe_id, body.user_id)
        if not r:
            continue
        rows = recipes.plan(r["ingredients"], r.get("servings"), e.servings, PRODUCT_INDEX)
        for row in rows:
            row["recipe"] = r["name"]
            if not row["product_id"]:
                row["category_id"] = classifier.classify(row["name"])["category_id"]
        groups.append(rows)
        names.append(r["name"])
    items = recipes.merge_rows(groups, PRODUCT_INDEX)
    return {"recipes": names, "items": items, "costs": buy_costs(items)}


class SuggestIn(BaseModel):
    user_id: Optional[str] = None
    items: list[ListItem] = Field(default_factory=list)
    store_id: Optional[str] = None       # il negozio consigliato, se c'è già il calcolo
    budget: Optional[float] = Field(default=None, gt=0)
    spent: Optional[float] = Field(default=None, ge=0)   # quanto costa la spesa nel negozio scelto
    servings: int = Field(default=2, ge=1, le=30)


def _missing_cost(rows: list[dict], store_id: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    stores = [store_id] if store_id in STORE_INDEX else [s["id"] for s in STORES]
    best = None
    for sid in stores:
        tot = 0.0
        for r in rows:
            c = _row_cost(sid, r["product_id"], r["quantity"])
            if c is None:
                tot = None
                break
            tot += c
        if tot is not None and (best is None or tot < best[0]):
            best = (round(tot, 2), sid)
    return best if best else (None, None)


@api.post("/suggest")
async def suggest(body: SuggestIn):
    """Cosa puoi fare con la lista che hai:
    - ricette che puoi già cucinare, e quelle a cui manca poco (con quanto costa il resto);
    - cose che compri di solito e mancano;
    - se c'è un budget: cosa ci sta ancora dentro."""
    in_list = {i.product_id for i in body.items if not i.product_id.startswith("custom:")}
    custom_names = {normalize(i.name or i.product_id[7:]) for i in body.items if i.product_id.startswith("custom:")}
    remaining = round(body.budget - body.spent, 2) if body.budget is not None and body.spent is not None else None
    ready, almost = [], []
    for r in await all_recipes_for(body.user_id):
        core = recipe_core(r)
        needs = core["needs"]
        if len(needs) + len(core["unknown"]) < 2:
            continue
        have = [x for x in needs if x["product_id"] in in_list]
        miss = [x for x in needs if x["product_id"] not in in_list]
        unk_have = [n for n in core["unknown"] if normalize(n) in custom_names]
        unk_miss = [n for n in core["unknown"] if normalize(n) not in custom_names]
        n_have = len(have) + len(unk_have)
        total = len(needs) + len(core["unknown"])
        if n_have < 2 or n_have / total < 0.5:
            continue
        info = {**recipe_summary(r), "uses": [x["product_name"] for x in have] + unk_have,
                "coverage": round(n_have / total, 2)}
        if not miss and not unk_miss:
            ready.append(info)
        elif len(miss) + len(unk_miss) <= 2:
            scale = body.servings / core["servings"]
            buy = []
            for x in miss:  # quanto comprare di quello che manca, per le persone indicate
                p = PRODUCT_INDEX[x["product_id"]]
                used = x["used"] * scale if x.get("used") is not None else None
                buy.append({**x, "quantity": recipes.buy_from_used(used, p)})
            cost, sid = _missing_cost(buy, body.store_id) if buy else (None, None)
            info.update(missing=[{"product_id": x["product_id"], "name": x["product_name"], "quantity": x["quantity"],
                                  "unit": PRODUCT_INDEX[x["product_id"]]["unit"]} for x in buy],
                        missing_new=unk_miss, missing_cost=cost,
                        missing_store=STORE_INDEX[sid]["name"] if sid else None,
                        fits_budget=remaining is not None and cost is not None and cost <= remaining and not unk_miss)
            almost.append(info)
    ready.sort(key=lambda x: (-len(x["uses"]), x["name"]))
    almost.sort(key=lambda x: (len(x["missing"]) + len(x["missing_new"]), x["missing_cost"] if x["missing_cost"] is not None else 99, -x["coverage"]))

    # cose che compri di solito e non sono in lista
    extras = []
    if body.user_id:
        shops = await db.history.find({"user_id": body.user_id}, NO_ID).sort("created_at", -1).to_list(40)
        hab = habitual_from_history(shops)
        left = remaining
        for h in hab["items"]:
            if h["product_id"] in in_list:
                continue
            cost, sid = _missing_cost([{"product_id": h["product_id"], "quantity": h["quantity"]}], body.store_id)
            if cost is None:
                continue
            fits = left is not None and cost <= left
            if fits:
                left = round(left - cost, 2)
            extras.append({"product_id": h["product_id"], "name": h["name"], "quantity": h["quantity"],
                           "unit": PRODUCT_INDEX[h["product_id"]]["unit"], "count": h["count"],
                           "occasions": hab["occasions"], "cost": cost, "fits_budget": fits})
    return {"ready": ready[:6], "almost": almost[:6], "habitual_missing": extras[:8], "remaining": remaining}


class ProposeIn(BaseModel):
    user_id: Optional[str] = None
    count: int = Field(default=5, ge=1, le=14)
    servings: int = Field(default=2, ge=1, le=30)
    budget: Optional[float] = Field(default=None, gt=0)   # per tutto il menu
    store_id: Optional[str] = None
    exclude: list[str] = Field(default_factory=list, max_length=200)
    items: list[ListItem] = Field(default_factory=list)   # la lista attuale: si preferiscono ricette che la usano


@api.post("/recipes/propose")
async def propose_menu(body: ProposeIn):
    """Un menu di piatti principali vari e convenienti (regole):
    economici a persona, che usano quello che hai in lista o compri spesso, senza ripetere
    l'ingrediente principale, alternando primi e secondi, dentro il budget se indicato."""
    in_list = {i.product_id for i in body.items}
    habitual = set()
    if body.user_id:
        shops = await db.history.find({"user_id": body.user_id}, NO_ID).sort("created_at", -1).to_list(40)
        habitual = {h["product_id"] for h in habitual_from_history(shops)["items"]}
    cands = []
    for r in await all_recipes_for(body.user_id):
        if r["id"] in body.exclude:
            continue
        cats = r.get("categories") or []
        if r.get("source") == "Wikibooks" and not any(c.startswith(MAIN_DISH) for c in cats):
            continue
        core = recipe_core(r)
        if core["unknown"] or len(core["needs"]) < 3:
            continue
        sid = body.store_id if body.store_id in STORE_INDEX else None
        portion = portion_cost(core, sid) if sid else (best_portion(core) or {}).get("portion")
        if portion is None or portion <= 0:
            continue
        bonus = 0.25 * sum(1 for x in core["needs"] if x["product_id"] in in_list or x["product_id"] in habitual)
        kind = "primo" if any(c.startswith(("Primi", "Risotti")) for c in cats) else "secondo"
        cands.append((portion - bonus, portion, kind, core["needs"][0]["product_id"], r))
    cands.sort(key=lambda x: (x[0], x[4]["name"]))
    picks, mains, total = [], set(), 0.0
    want = "primo"
    pool = list(cands)
    while pool and len(picks) < body.count:
        # alterna primo/secondo quando possibile, mai lo stesso ingrediente principale
        choice = next((c for c in pool if c[2] == want and c[3] not in mains), None) or \
            next((c for c in pool if c[3] not in mains), None)
        if not choice:
            break
        pool.remove(choice)
        cost = round(choice[1] * body.servings, 2)
        if body.budget is not None and total + cost > body.budget:
            continue
        total = round(total + cost, 2)
        mains.add(choice[3])
        picks.append({**recipe_summary(choice[4]), "portion": choice[1], "cost": cost, "kind": choice[2]})
        want = "secondo" if want == "primo" else "primo"
    return {"recipes": picks, "total": total, "servings": body.servings, "budget": body.budget}


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
