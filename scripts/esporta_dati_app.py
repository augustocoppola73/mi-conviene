"""
Esporta i dati statici per il motore dentro l'app (versione online, senza server Python):
catalogo, catene, stime di prezzo per catena, parole chiave della classificazione, costanti
delle ricette e raccolta Wikibooks. Fonte unica: il codice Python, così le due versioni non divergono.

Uso:  python scripts/esporta_dati_app.py   ->  frontend/src/engine/data/*.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
import classify  # noqa: E402
import recipes  # noqa: E402
import server  # noqa: E402

OUT = Path(__import__("os").environ.get("ENGINE_DATA_DIR", ROOT / "frontend" / "src" / "engine" / "data"))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    estimates = server.build_catalog({})  # solo stime (i prezzi reali arrivano da Supabase)
    static = {
        "categories": server.CATEGORIES,
        "products": list(server.PRODUCT_INDEX.values()),
        "stores": server.STORES,
        "estimates": {sid: {pid: e["normal_price"] for pid, e in prods.items()} for sid, prods in estimates.items()},
        "chain_flyers": server.CHAIN_FLYERS,
        "official_domains": {k: list(v) for k, v in server.OFFICIAL_DOMAINS.items()},
        "classify": {"keywords": classify.KEYWORDS, "stopwords": sorted(classify.STOPWORDS), "generic": sorted(classify.GENERIC)},
        "recipes": {
            "num_words": recipes.NUM_WORDS, "fractions": recipes.FRACTIONS,
            "units": {k: list(v) for k, v in recipes.UNITS.items()},
            "household": {k: list(v) for k, v in recipes.HOUSEHOLD.items()},
            "liquids": list(recipes.LIQUIDS), "density": recipes.DENSITY,
            "descriptors": sorted(recipes.DESCRIPTORS), "aliases": recipes.ALIASES, "piece_g": recipes.PIECE_G,
            "pantry": list(recipes.PANTRY), "skip": list(recipes.SKIP),
            "fruit_juice_ml": {k: list(v) for k, v in recipes.FRUIT_JUICE_ML.items()},
            "substitutes": [sorted(g) for g in recipes.SUBSTITUTES],
        },
        "constants": {
            "fuel_consumption_l_100km": server.FUEL_CONSUMPTION_L_100KM, "fallback_fuel_price": server.FALLBACK_FUEL_PRICE,
            "transport_speed": server.TRANSPORT_SPEED, "time_value": server.TIME_VALUE, "time_weight": server.TIME_WEIGHT,
            "default_refuel_liters": server.DEFAULT_REFUEL_LITERS, "max_detour_km": server.MAX_DETOUR_KM,
            "road_factor": server.stores_mod.ROAD_FACTOR, "promo_default_days": server.PROMO_DEFAULT_DAYS,
        },
    }
    (OUT / "static.json").write_text(json.dumps(static, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    coll = {"license": recipes.LICENSE or "", "recipes": recipes.collection()}
    recipes.collection()
    coll["license"] = recipes.LICENSE
    (OUT / "recipes_wikibooks.json").write_text(json.dumps(coll, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for f in OUT.iterdir():
        print(f"{f.name}: {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
