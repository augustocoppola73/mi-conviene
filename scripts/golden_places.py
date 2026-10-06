"""Casi golden per src/engine/places.ts (catene OSM, negozio più vicino, volantini, distributori)."""
import asyncio, json, os, random, sys, tempfile
from pathlib import Path
os.environ["PRICES_AUTO_REFRESH"] = "0"
os.environ["STORES_CACHE"] = str(Path(tempfile.mkdtemp()) / "s.json")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
import server, stores  # noqa: E402
from prices.chains import chain_of  # noqa: E402

FRONT = Path(os.environ.get("ENGINE_DIR", ROOT / "frontend" / "src" / "engine"))
G = json.loads((FRONT / "__golden__" / "core_golden.json").read_text(encoding="utf-8"))
rnd = random.Random(3)
names = ["Conad City", "CONAD", "Ipercoop", "Coop Alleanza 3.0", "Lidl", "Carrefour Express", "Pam Local", "Panorama",
         "Euro Spin", "Eurospin", "Esselunga", "Despar", "Pampero", "Coopera", "Lidl Italia", "incoop", "Novacoop", "Superconad"]
elements = []
for i in range(120):
    n = rnd.choice(names)
    e = {"type": rnd.choice(["node", "way"]), "id": 1000 + i, "tags": {"brand": n if rnd.random() < .6 else None, "name": rnd.choice(names)}}
    e["tags"] = {k: v for k, v in e["tags"].items() if v}
    if rnd.random() < .5: e["tags"].update({"addr:street": "Via Roma", "addr:housenumber": str(i)})
    if rnd.random() < .5: e["tags"]["addr:city"] = "Livorno"
    if rnd.random() < .4: e["tags"]["website"] = rnd.choice(["https://www.conad.it/negozi/x", "https://lidl.it/s/1", "http://altro.com/x",
                                                                "https://www.coop.it/n", "https://www.pampanorama.it/p"])
    if rnd.random() < .3: e["tags"]["opening_hours"] = "Mo-Sa 08:00-21:00"
    pt = (43.55 + rnd.uniform(-.05, .05), 10.31 + rnd.uniform(-.05, .05))
    if e["type"] == "node": e["lat"], e["lon"] = pt
    elif rnd.random() < .9: e["center"] = {"lat": pt[0], "lon": pt[1]}
    elements.append(e)
parsed = stores.parse_elements(elements)
out = {"chains": [[n, chain_of({"osm_name": n})] for n in names], "elements": elements, "parsed": parsed, "near": [], "flyers": [], "fuel": []}

class Fake:
    radius_m = 6000
    def __init__(self, s): self.s = s
    async def stores_around(self, lat, lon): return self.s
    async def nearest(self, lat, lon): return stores.nearest_per_chain(self.s, lat, lon)

async def main():
    server.maybe_recenter_prices = lambda *a: None
    for lat, lon, sub in ((43.55, 10.31, parsed), (43.6, 10.4, parsed[:10]), (43.5, 10.2, [p for p in parsed if p["chain"] != "conad"]), (43.5, 10.2, [])):
        server.locator = Fake(sub)
        near = stores.nearest_per_chain(sub, lat, lon)
        chosen, loc = await server.stores_for(lat, lon)
        out["near"].append({"lat": lat, "lon": lon, "stores": sub, "near": near, "chosen": chosen, "loc": loc})
        out["flyers"].append({"lat": lat, "lon": lon, "stores": sub, "out": await server.flyers(lat, lon)})
    STATIONS = [{**s, "name": s["brand"] + " " + s["id"]} for s in G["stations"]]
    out["stations"] = STATIONS
    server.prices.stations = STATIONS
    for fuel in ("benzina", "gasolio", "gpl"):
        for med in (None, {"price_per_liter": 1.9, "observed_at": "2026-10-05"}):
            server.prices.fuel = {fuel: med} if med else {}
            for lat, lon, liters, rad in ((43.55, 10.31, 40, 5), (43.53, 10.3, 25, 10), (44.0, 11.0, 40, 5)):
                res = await server.fuel_nearby(fuel, lat, lon, liters, rad)
                out["fuel"].append({"fuel": fuel, "med": med, "lat": lat, "lon": lon, "liters": liters, "radius": rad, "out": res})
    (FRONT / "__golden__" / "places_golden.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("ok", len(parsed), "negozi")
asyncio.run(main())
