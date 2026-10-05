"""
Servizio prezzi: scarica dalle fonti reali, aggrega e tiene una cache su disco
(così il backend riparte anche senza rete con gli ultimi dati scaricati).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from . import fuel, openprices

log = logging.getLogger("mi_conviene.prices")

CACHE_FILE = Path(os.environ.get("PRICES_CACHE", Path(__file__).resolve().parent.parent / "data" / "prices_cache.json"))


class PriceService:
    def __init__(self, lat: float, lon: float, radius_km: float = 30, fuel_radius_km: float = 10):
        self.lat, self.lon = lat, lon
        self.radius_km, self.fuel_radius_km = radius_km, fuel_radius_km
        self.real: dict[tuple[str, str], dict] = {}
        self.fuel: dict[str, dict] = {}
        self.stations: list[dict] = []
        self.status: dict = {"openprices": None, "mimit": None, "last_refresh": None, "errors": []}

    # ---------- cache ----------
    def load_cache(self, path: Path = CACHE_FILE) -> bool:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        self.real = {tuple(k.split("|")): v for k, v in data.get("real", {}).items()}
        self.fuel = data.get("fuel", {})
        self.stations = data.get("stations", [])
        self.status = data.get("status", self.status)
        return True

    def save_cache(self, path: Path = CACHE_FILE) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"real": {"|".join(k): v for k, v in self.real.items()}, "fuel": self.fuel, "stations": self.stations, "status": self.status}
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---------- aggiornamento ----------
    def apply_openprices(self, items: list[dict]) -> None:
        obs = openprices.parse_observations(items)
        self.real = openprices.aggregate(obs)
        self.status["openprices"] = {
            "raw_prices": len(items), "matched_observations": len(obs),
            "store_products": len(self.real), "refreshed_at": _now(),
        }

    def apply_fuel(self, stations_csv: str, prices_csv: str) -> None:
        out = {}
        for f in ("benzina", "gasolio", "gpl", "metano"):
            m = fuel.median_price(stations_csv, prices_csv, self.lat, self.lon, self.fuel_radius_km, f)
            if m:
                out[f] = m
        self.fuel = out
        # distributori vicini con i prezzi di oggi, per proporre dove fare carburante
        self.stations = fuel.stations_near(stations_csv, prices_csv, self.lat, self.lon, self.fuel_radius_km + 5)
        self.status["mimit"] = {"fuels": list(out), "stations": len(self.stations), "refreshed_at": _now()}

    async def refresh(self) -> None:
        errors = []
        try:
            items = await openprices.fetch_prices(self.lat, self.lon, self.radius_km)
            self.apply_openprices(items)
        except Exception as e:  # rete assente, API giù...: si tengono i dati in cache
            errors.append(f"openprices: {e}")
            log.warning("Open Prices non raggiungibile: %s", e)
        try:
            s, p = await fuel.fetch_csvs()
            self.apply_fuel(s, p)
        except Exception as e:
            errors.append(f"mimit: {e}")
            log.warning("MIMIT carburanti non raggiungibile: %s", e)
        self.status["last_refresh"] = _now()
        self.status["errors"] = errors
        try:
            self.save_cache()
        except OSError as e:
            log.warning("Cache prezzi non salvata: %s", e)

    async def refresh_forever(self, every_hours: float, on_update) -> None:
        while True:
            await self.refresh()
            on_update()
            await asyncio.sleep(every_hours * 3600)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
