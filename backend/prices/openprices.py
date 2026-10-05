"""
Fonte prezzi: Open Prices (Open Food Facts) — https://prices.openfoodfacts.org
Database aperto (licenza ODbL) di prezzi reali, ognuno con foto di prova
(scontrino o cartellino), negozio e data.
"""
from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone

import httpx

from .chains import chain_of
from .matching import RULES, is_special, match_product, reference_price

API = "https://prices.openfoodfacts.org/api/v1/prices"
USER_AGENT = "PagoMeno/0.1 (https://github.com/augustocoppola73/mi-conviene)"
SOURCE = "openprices"


@dataclass
class Observation:
    store_id: str
    product_id: str
    ref_price: float  # prezzo pagato, riportato alla confezione dell'app
    ref_normal: float  # prezzo pieno (senza sconto), riportato alla confezione
    discounted: bool
    date: str
    location_name: str
    product_name: str
    price_id: int


async def fetch_prices(lat: float, lon: float, radius_km: float, max_pages: int = 20,
                       client: httpx.AsyncClient | None = None) -> list[dict]:
    """Scarica tutti i prezzi entro il raggio, dal più recente."""
    own = client is None
    client = client or httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT})
    items: list[dict] = []
    try:
        page = 1
        while page <= max_pages:
            r = await client.get(API, params={
                "lat": lat, "lon": lon, "radius_km": radius_km, "size": 100,
                "page": page, "order_by": "-date",
            })
            r.raise_for_status()
            data = r.json()
            items.extend(data.get("items", []))
            if page >= (data.get("pages") or 1):
                break
            page += 1
    finally:
        if own:
            await client.aclose()
    return items


def _obs_date(item: dict) -> str:
    return (item.get("date") or (item.get("created") or "")[:10]) or "1970-01-01"


def parse_observations(items: list[dict]) -> list[Observation]:
    """Trasforma i prezzi grezzi in osservazioni utili (catena + prodotto dell'app)."""
    seen: set[tuple] = set()
    out: list[Observation] = []
    for it in items:
        if it.get("currency") not in (None, "EUR") or it.get("duplicate_of"):
            continue
        store_id = chain_of(it.get("location"))
        if not store_id:
            continue
        product = it.get("product") or {}
        categories = product.get("categories_tags") or ([it["category_tag"]] if it.get("category_tag") else [])
        pid = match_product(categories)
        if not pid or is_special(product.get("product_name")):
            continue
        price = it.get("price")
        if not price or price <= 0:
            continue
        # stesso prezzo caricato più volte (succede spesso): lo contiamo una volta
        key = (it.get("product_code") or it.get("category_tag"), it.get("location_id"), price, _obs_date(it))
        if key in seen:
            continue
        seen.add(key)
        rule = RULES[pid]
        ref = reference_price(price, product, it.get("category_tag"), it.get("price_per"), rule)
        if ref is None:
            continue
        discounted = bool(it.get("price_is_discounted"))
        full = it.get("price_without_discount") if discounted else None
        ref_normal = ref * (full / price) if full and full > price else ref
        out.append(Observation(
            store_id=store_id, product_id=pid, ref_price=round(ref, 2), ref_normal=round(ref_normal, 2),
            discounted=discounted, date=_obs_date(it),
            location_name=(it.get("location") or {}).get("osm_name") or store_id,
            product_name=product.get("product_name") or it.get("category_tag") or "",
            price_id=it.get("id") or 0,
        ))
    return out


def aggregate(observations: list[Observation], today: date | None = None,
              max_age_days: int = 730, promo_days: int = 21) -> dict[tuple[str, str], dict]:
    """Un prezzo per (catena, prodotto): mediana dei prezzi pieni recenti.
    La promo vale solo se osservata negli ultimi `promo_days` giorni."""
    today = today or datetime.now(timezone.utc).date()
    cutoff = (today - timedelta(days=max_age_days)).isoformat()
    promo_cutoff = (today - timedelta(days=promo_days)).isoformat()
    groups: dict[tuple[str, str], list[Observation]] = {}
    for o in observations:
        if o.date >= cutoff:
            groups.setdefault((o.store_id, o.product_id), []).append(o)
    result = {}
    for key, obs in groups.items():
        obs.sort(key=lambda o: o.date, reverse=True)
        normal = round(statistics.median(o.ref_normal for o in obs), 2)
        recent_promo = next((o for o in obs if o.discounted and o.date >= promo_cutoff and o.ref_price < normal), None)
        latest = obs[0]
        age = (today - date.fromisoformat(latest.date)).days
        result[key] = {
            "normal_price": normal,
            "promo_price": recent_promo.ref_price if recent_promo else None,
            "source": SOURCE,
            "observations": len(obs),
            "observed_at": latest.date,
            "age_days": age,
            # verde: visto negli ultimi 2 mesi; giallo: entro un anno; rosso: più vecchio
            "confidence": "green" if age <= 60 else "yellow" if age <= 365 else "red",
            "location_name": latest.location_name,
            "sample_product": latest.product_name,
            "proof_url": f"https://prices.openfoodfacts.org/prices/{latest.price_id}" if latest.price_id else None,
        }
    return result


def observations_to_dicts(obs: list[Observation]) -> list[dict]:
    return [asdict(o) for o in obs]
