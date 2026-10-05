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
