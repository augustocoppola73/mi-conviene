"""
Aggiornamento giornaliero dei dati pubblici su Supabase (gira con GitHub Actions, gratis).

- Carburanti MIMIT: tutti i distributori d'Italia con i prezzi di oggi (tabella sovrascritta).
- Prezzi Open Prices: un prezzo per catena e prodotto (tabella sovrascritta).
- Pulizia notturna del database (offerte scadute, spese in corso abbandonate).
  Tiene anche "sveglio" il progetto Supabase gratuito.

Variabili d'ambiente: SUPABASE_URL, SUPABASE_SECRET_KEY (segreto di GitHub, mai nel codice).
Uso:  python scripts/aggiorna_prezzi_supabase.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from prices import fuel, openprices  # noqa: E402

# zone da cui raccogliere i prezzi Open Prices (le catene hanno prezzi quasi uguali in tutta Italia)
ZONES = [(45.464, 9.190), (45.070, 7.686), (44.405, 8.946), (44.494, 11.343), (43.770, 11.255),
         (43.548, 10.310), (41.903, 12.496), (40.852, 14.268), (41.117, 16.872), (38.116, 13.361),
         (45.438, 12.327), (45.438, 10.993)]
ITALY_CENTER, ITALY_RADIUS_KM = (42.5, 12.5), 1300
BATCH = 500


def env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"Manca la variabile {name}")
    return v


class Supa:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        # le chiavi nuove vanno nell'header apikey (non sono JWT)
        self.h = {"apikey": key, "Content-Type": "application/json", "User-Agent": "mi-conviene-aggiornamento/1.0"}
        self.c = httpx.AsyncClient(timeout=120)

    async def upsert(self, table: str, rows: list[dict]) -> None:
        for i in range(0, len(rows), BATCH):
            r = await self.c.post(f"{self.base}/{table}", json=rows[i:i + BATCH],
                                  headers={**self.h, "Prefer": "resolution=merge-duplicates,return=minimal"})
            if r.status_code >= 300:
                raise RuntimeError(f"{table}: {r.status_code} {r.text[:300]}")

    async def delete_older(self, table: str, column: str, before: str) -> None:
        r = await self.c.delete(f"{self.base}/{table}", params={column: f"lt.{before}"},
                                headers={**self.h, "Prefer": "return=minimal"})
        if r.status_code >= 300:
            raise RuntimeError(f"{table} delete: {r.status_code} {r.text[:300]}")

    async def rpc(self, fn: str, body: dict | None = None):
        r = await self.c.post(f"{self.base}/rpc/{fn}", json=body or {}, headers=self.h)
        if r.status_code >= 300:
            raise RuntimeError(f"rpc {fn}: {r.status_code} {r.text[:300]}")
        return r.json() if r.text else None


def fuel_rows(stations_csv: str, prices_csv: str, now: str) -> list[dict]:
    stations = fuel.stations_near(stations_csv, prices_csv, *ITALY_CENTER, radius_km=ITALY_RADIUS_KM)
    return [{"id": s["id"], "brand": s["brand"], "name": s["name"], "address": s["address"], "city": s["city"],
             "lat": s["lat"], "lon": s["lon"], "prices": s["prices"], "updated": s.get("updated"), "refreshed_at": now}
            for s in stations]


def price_rows(real: dict, now: str) -> list[dict]:
    return [{"store_id": sid, "product_id": pid, "normal_price": v["normal_price"], "promo_price": v.get("promo_price"),
             "source": v.get("source", "openprices"), "observations": v.get("observations"),
             "observed_at": v.get("observed_at"), "confidence": v.get("confidence"),
             "location_name": v.get("location_name"), "sample_product": v.get("sample_product"),
             "proof_url": v.get("proof_url"), "updated_at": now}
            for (sid, pid), v in real.items()]


async def main() -> None:
    supa = Supa(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    status: dict = {"refreshed_at": now, "errors": []}

    # 1. carburanti
    try:
        s_csv, p_csv = await fuel.fetch_csvs()
        rows = fuel_rows(s_csv, p_csv, now)
        if len(rows) < 1000:  # file incompleto: meglio tenere quelli di ieri
            raise RuntimeError(f"solo {len(rows)} distributori letti")
        await supa.upsert("fuel_stations", rows)
        await supa.delete_older("fuel_stations", "refreshed_at", now)  # chiusi o spariti
        status["fuel_stations"] = len(rows)
        status["fuel_date"] = fuel.extraction_date(p_csv)
        print(f"carburanti: {len(rows)} distributori")
    except Exception as e:
        status["errors"].append(f"mimit: {e}")
        print(f"ERRORE carburanti: {e}")

    # 2. prezzi Open Prices
    try:
        items: list[dict] = []
        seen: set = set()
        async with httpx.AsyncClient(timeout=60, headers={"User-Agent": openprices.USER_AGENT}) as c:
            for lat, lon in ZONES:
                try:
                    for it in await openprices.fetch_prices(lat, lon, 40, max_pages=10, client=c):
                        if it.get("id") not in seen:
                            seen.add(it.get("id"))
                            items.append(it)
                except Exception as e:
                    print(f"  zona {lat},{lon}: {e}")
        real = openprices.aggregate(openprices.parse_observations(items))
        if real:
            await supa.upsert("product_prices", price_rows(real, now))
        status["raw_prices"], status["store_products"] = len(items), len(real)
        print(f"prezzi: {len(items)} grezzi -> {len(real)} catena/prodotto")
    except Exception as e:
        status["errors"].append(f"openprices: {e}")
        print(f"ERRORE prezzi: {e}")

    # 3. pulizia e stato
    try:
        status["cleanup"] = await supa.rpc("nightly_cleanup")
    except Exception as e:
        status["errors"].append(f"cleanup: {e}")
    await supa.upsert("meta", [{"key": "prices_status", "value": status, "updated_at": now}])
    print("stato:", status)
    if len(status["errors"]) >= 2:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
