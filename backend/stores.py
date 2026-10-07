"""
Punti vendita reali vicino all'utente, da OpenStreetMap (Overpass API, dati ODbL).

Per ogni catena dell'app si sceglie il punto vendita più vicino. La distanza è in
linea d'aria moltiplicata per un fattore strada (1,3), quindi è "circa".
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import httpx

from prices.chains import chain_of
from prices.geo import haversine_km

log = logging.getLogger("mi_conviene.stores")

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
USER_AGENT = "MiConviene/0.1 (https://github.com/augustocoppola73/mi-conviene)"
ROAD_FACTOR = 1.3  # strada reale ≈ 1,3 volte la linea d'aria in città
CACHE_TTL_S = 7 * 24 * 3600
CACHE_FILE = Path(os.environ.get("STORES_CACHE", Path(__file__).resolve().parent / "data" / "stores_cache.json"))
BRANDS = "Esselunga|Conad|Coop|Ipercoop|Lidl|Carrefour|Pam|Panorama|Eurospin|Aldi|MD|Penny|Ekom|Dpiù|Dpiu|Tuodì|Tuodi|Prix"


def overpass_query(lat: float, lon: float, radius_m: int, include_convenience: bool = False) -> str:
    shops = "supermarket|convenience" if include_convenience else "supermarket"
    return (f'[out:json][timeout:25];nwr["shop"~"^({shops})$"]["brand"~"{BRANDS}",i]'
            f"(around:{radius_m},{lat},{lon});out center tags;")


def parse_elements(elements: list[dict]) -> list[dict]:
    out = []
    for e in elements:
        tags = e.get("tags") or {}
        chain = chain_of({"osm_brand": tags.get("brand"), "osm_name": tags.get("name")})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if not chain or lat is None or lon is None:
            continue
        street = " ".join(x for x in (tags.get("addr:street"), tags.get("addr:housenumber")) if x).strip()
        out.append({
            "chain": chain,
            "name": tags.get("name") or tags.get("brand") or chain,
            "address": ", ".join(x for x in (street, tags.get("addr:city")) if x) or None,
            "lat": float(lat), "lon": float(lon),
            "osm_id": f"{e.get('type')}/{e.get('id')}",
            "opening_hours": tags.get("opening_hours"),
            "website": tags.get("website") or tags.get("contact:website"),
        })
    return out


def nearest_per_chain(stores: list[dict], lat: float, lon: float) -> dict[str, dict]:
    best: dict[str, dict] = {}
    for s in stores:
        d = haversine_km(lat, lon, s["lat"], s["lon"]) * ROAD_FACTOR
        if s["chain"] not in best or d < best[s["chain"]]["distance_km"]:
            best[s["chain"]] = {**s, "distance_km": round(max(d, 0.1), 1)}
    return best


class StoreLocator:
    def __init__(self, radius_m: int = 6000):
        self.radius_m = radius_m
        self.cache: dict[str, dict] = {}
        try:
            self.cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    @staticmethod
    def _key(lat: float, lon: float) -> str:
        return f"{round(lat, 2)},{round(lon, 2)}"  # ~1 km: stessa zona, stessa ricerca

    async def stores_around(self, lat: float, lon: float) -> list[dict]:
        key = self._key(lat, lon)
        hit = self.cache.get(key)
        fresh = hit and time.time() - hit["at"] < CACHE_TTL_S
        # cache di una versione precedente (senza il campo "website"): si rifà la ricerca
        if fresh and hit["stores"] and "website" not in hit["stores"][0]:
            fresh = False
        if fresh:
            return hit["stores"]
        async with httpx.AsyncClient(timeout=40, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.post(OVERPASS_URL, data={"data": overpass_query(lat, lon, self.radius_m)})
            r.raise_for_status()
            stores = parse_elements(r.json().get("elements", []))
        self.cache[key] = {"at": time.time(), "stores": stores}
        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
        except OSError as e:
            log.warning("Cache punti vendita non salvata: %s", e)
        return stores

    async def nearest(self, lat: float, lon: float) -> dict[str, dict]:
        return nearest_per_chain(await self.stores_around(lat, lon), lat, lon)
