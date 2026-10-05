"""
Fonte prezzi carburante: open data MIMIT (Osservatorio prezzi carburanti).
Due CSV aggiornati ogni giorno alle 8: anagrafica degli impianti e prezzi praticati.
"""
from __future__ import annotations

import csv
import io
import statistics

import httpx

from .geo import haversine_km

BASE = "https://www.mimit.gov.it/images/exportCSV"
STATIONS_URL = f"{BASE}/anagrafica_impianti_attivi.csv"
PRICES_URL = f"{BASE}/prezzo_alle_8.csv"

FUELS = {"benzina": "Benzina", "gasolio": "Gasolio", "gpl": "GPL", "metano": "Metano"}


def _rows(text: str) -> list[list[str]]:
    lines = text.lstrip("﻿").splitlines()
    # la prima riga è "Estrazione del AAAA-MM-GG", la seconda l'intestazione
    return [r for r in csv.reader(io.StringIO("\n".join(lines[2:])), delimiter="|") if r]


def extraction_date(text: str) -> str | None:
    first = text.lstrip("﻿").split("\n", 1)[0]
    return first.replace("Estrazione del", "").strip() or None


def median_price(stations_csv: str, prices_csv: str, lat: float, lon: float,
                 radius_km: float = 10, fuel: str = "benzina", self_service: bool = True) -> dict | None:
    """Mediana del prezzo (€/l) del carburante negli impianti entro il raggio."""
    near: set[str] = set()
    for r in _rows(stations_csv):
        try:
            if haversine_km(lat, lon, float(r[8]), float(r[9])) <= radius_km:
                near.add(r[0])
        except (IndexError, ValueError):
            continue
    label = FUELS[fuel]
    prices = []
    for r in _rows(prices_csv):
        try:
            if r[0] in near and r[1] == label and r[3] == ("1" if self_service else "0"):
                p = float(r[2])
                if 0.5 < p < 4:
                    prices.append(p)
        except (IndexError, ValueError):
            continue
    if not prices:
        return None
    return {
        "fuel": fuel,
        "price_per_liter": round(statistics.median(prices), 3),
        "stations": len(prices),
        "radius_km": radius_km,
        "observed_at": extraction_date(prices_csv),
        "source": "mimit",
    }


def suspicious_coordinates(rows: list[list[str]]) -> set[tuple[str, str]]:
    """Coordinate condivise da distributori di comuni DIVERSI: sono segnaposto sbagliati
    (es. la sede della società) e porterebbero l'utente nel posto sbagliato."""
    comuni: dict[tuple[str, str], set[str]] = {}
    for r in rows:
        if len(r) > 9:
            comuni.setdefault((r[8], r[9]), set()).add(r[6].strip().upper())
    return {k for k, v in comuni.items() if len(v) > 1 or k[0] in ("", "0", "0.0")}


def stations_near(stations_csv: str, prices_csv: str, lat: float, lon: float, radius_km: float = 12) -> list[dict]:
    """Distributori stradali entro il raggio con i prezzi di oggi (self e servito)."""
    near: dict[str, dict] = {}
    rows = _rows(stations_csv)
    bad = suspicious_coordinates(rows)
    for r in rows:
        try:
            if r[3].lower().startswith("autostrad") or (r[8], r[9]) in bad:
                continue  # in autostrada costa di più e non ci si va apposta
            la, lo = float(r[8]), float(r[9])
        except (IndexError, ValueError):
            continue
        if haversine_km(lat, lon, la, lo) <= radius_km:
            near[r[0]] = {"id": r[0], "brand": r[2].strip() or "Pompe bianche", "name": r[4].strip(),
                          "address": r[5].strip(), "city": r[6].strip().title(), "lat": la, "lon": lo, "prices": {}}
    labels = {v: k for k, v in FUELS.items()}
    for r in _rows(prices_csv):
        try:
            st = near.get(r[0])
            fuel = labels.get(r[1])
            if not st or not fuel:
                continue
            p = float(r[2])
            if not 0.5 < p < 4:
                continue
            mode = "self" if r[3] == "1" else "servito"
            st["prices"].setdefault(fuel, {})[mode] = p
            st["updated"] = r[4] if len(r) > 4 else None
        except (IndexError, ValueError):
            continue
    return [s for s in near.values() if s["prices"]]


def cheapest(stations: list[dict], lat: float, lon: float, fuel: str, radius_km: float = 5,
             limit: int = 5, road_factor: float = 1.3) -> list[dict]:
    """I distributori più economici (prezzo self) entro il raggio dall'utente."""
    out = []
    for s in stations:
        p = (s["prices"].get(fuel) or {}).get("self")
        if p is None:
            continue
        d = haversine_km(lat, lon, s["lat"], s["lon"]) * road_factor
        if d <= radius_km:
            out.append({**{k: s[k] for k in ("id", "brand", "name", "address", "city", "lat", "lon")},
                        "price": p, "price_servito": (s["prices"].get(fuel) or {}).get("servito"),
                        "distance_km": round(max(d, 0.1), 1), "updated": s.get("updated")})
    out.sort(key=lambda x: (x["price"], x["distance_km"]))
    return out[:limit]


async def fetch_csvs(client: httpx.AsyncClient | None = None) -> tuple[str, str]:
    own = client is None
    client = client or httpx.AsyncClient(timeout=60)
    try:
        s = await client.get(STATIONS_URL)
        p = await client.get(PRICES_URL)
        s.raise_for_status()
        p.raise_for_status()
        return s.content.decode("utf-8", "replace"), p.content.decode("utf-8", "replace")
    finally:
        if own:
            await client.aclose()
