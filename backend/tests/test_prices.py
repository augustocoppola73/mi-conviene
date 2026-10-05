import json
from datetime import date
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import server
from prices import chains, fuel, matching, openprices

FIX = Path(__file__).parent / "fixtures"


def load_openprices() -> list[dict]:
    items = []
    for f in ("openprices_milano_p1.json", "openprices_milano_p2.json"):
        items += json.loads((FIX / f).read_bytes().decode("utf-8-sig"))["items"]
    return items


def fuel_csvs() -> tuple[str, str]:
    return ((FIX / "mimit_anagrafica_mi.csv").read_text(encoding="utf-8-sig"),
            (FIX / "mimit_prezzi_mi.csv").read_text(encoding="utf-8-sig"))


# ---------- matching ----------
def test_match_milk_and_exclusions():
    assert matching.match_product(["en:dairies", "en:milks", "en:cow-milks", "en:whole-milks"]) == "latte"
    assert matching.match_product(["en:milks", "en:lactose-free-milk"]) is None
    assert matching.match_product(["en:breads", "it:taralli"]) is None
    assert matching.match_product(["en:yogurts", "en:yogurt-drinks"]) is None
    assert matching.match_product(["en:breads", "en:flatbreads", "en:piadinas"]) is None
    assert matching.is_special("Penne rigate Khorasan")
    assert not matching.is_special("Spaghetti n.5")


def test_reference_price_scaling():
    rule = matching.RULES["pasta"]  # riferimento 2 kg
    assert matching.reference_price(0.89, {"product_quantity": 500, "product_quantity_unit": "g"}, None, None, rule) == pytest.approx(3.56)
    # confezione troppo diversa: non confrontabile
    assert matching.reference_price(0.5, {"product_quantity": 50, "product_quantity_unit": "g"}, None, None, rule) is None
    # sfuso al kg
    assert matching.reference_price(2.0, None, "en:apples", "KILOGRAM", matching.RULES["mele"]) == 2.0
    # uova: prezzo per 6
    eggs = {"product_name": "Uova fresche x10", "product_quantity": 0}
    assert matching.reference_price(3.0, eggs, None, None, matching.RULES["uova"]) == pytest.approx(1.8)


def test_chain_recognition():
    assert chains.chain_of({"osm_brand": "Carrefour Market"}) == "carrefour"
    assert chains.chain_of({"osm_brand": None, "osm_name": "Conad City Via Roma"}) == "conad"
    assert chains.chain_of({"osm_brand": "Iperal"}) is None
    assert chains.chain_of({"osm_brand": "EuroSpin"}) == "eurospin"
    assert chains.chain_of({"osm_brand": "Pam Local"}) == "pam"


# ---------- Open Prices su dati reali (Milano) ----------
def test_openprices_real_sample():
    obs = openprices.parse_observations(load_openprices())
    assert obs, "nessuna corrispondenza sui dati reali"
    assert all(o.store_id in server.STORE_INDEX and o.product_id in server.PRODUCT_INDEX for o in obs)
    agg = openprices.aggregate(obs, today=date(2026, 10, 5))
    assert ("carrefour", "latte") in agg
    milk = agg[("carrefour", "latte")]
    assert milk["normal_price"] == 1.89 and milk["confidence"] == "green"
    assert milk["proof_url"].startswith("https://prices.openfoodfacts.org/")


def test_aggregate_dedup_and_promo():
    O = openprices.Observation
    obs = [O("lidl", "latte", 1.0, 1.0, False, "2026-09-01", "Lidl X", "Latte", 1),
           O("lidl", "latte", 1.2, 1.2, False, "2026-08-01", "Lidl X", "Latte", 2),
           O("lidl", "latte", 0.8, 1.1, True, "2026-10-01", "Lidl X", "Latte", 3)]
    r = openprices.aggregate(obs, today=date(2026, 10, 5))[("lidl", "latte")]
    assert r["normal_price"] == 1.1 and r["promo_price"] == 0.8 and r["observations"] == 3
    old = openprices.aggregate(obs, today=date(2029, 1, 1))
    assert old == {}


# ---------- carburante MIMIT ----------
def test_fuel_median():
    s, p = fuel_csvs()
    b = fuel.median_price(s, p, 45.4642, 9.19, 40, "benzina")
    assert b and 1.5 < b["price_per_liter"] < 2.6 and b["stations"] > 10
    assert b["observed_at"] == "2026-10-04"
    assert fuel.median_price(s, p, 37.5, 15.0, 5, "benzina") is None  # nessun impianto vicino


# ---------- integrazione nel motore ----------
@pytest.fixture
def with_real_prices():
    server.prices.apply_openprices(load_openprices())
    server.prices.real = openprices.aggregate(openprices.parse_observations(load_openprices()), today=date(2026, 10, 5))
    server.prices.apply_fuel(*fuel_csvs())
    server.rebuild_catalog()
    yield
    server.prices.real, server.prices.fuel = {}, {}
    server.rebuild_catalog()


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c


async def test_optimize_uses_real_prices(client, with_real_prices):
    r = (await client.post("/api/optimize", json={
        "user_id": "u", "items": [{"product_id": "latte", "quantity": 2}, {"product_id": "pasta", "quantity": 2}],
        "transport": "car"})).json()
    carrefour = next(x for x in r["ranked"] if x["store_id"] == "carrefour")
    milk = next(l for l in carrefour["receipt"]["lines"] if l["product_id"] == "latte")
    assert milk["source"] == "openprices" and milk["line_price"] == pytest.approx(3.78)
    assert carrefour["receipt"]["real_lines"] == 1
    assert r["fuel"]["source"] == "mimit"
    pasta = next(l for l in carrefour["receipt"]["lines"] if l["product_id"] == "pasta")
    assert pasta["source"] == "stima" and pasta["confidence"] == "red"


async def test_fuel_cost_from_mimit(with_real_prices):
    f = server.fuel_info("benzina")
    t = server.compute_travel(server.STORE_INDEX["lidl"], "car", f)
    assert t["fuel_cost"] == round(3.6 * 2 * 0.07 * f["price_per_liter"], 2)


async def test_prices_status(client, with_real_prices):
    s = (await client.get("/api/prices/status")).json()
    assert s["coverage"]["carrefour"]["real_products"] >= 1
    assert "benzina" in s["fuel"]


async def test_offers_marked_with_source(client):
    o = (await client.get("/api/offers")).json()
    assert all(x["source"] in ("stima", "openprices") for x in o)


def test_cache_roundtrip(tmp_path, with_real_prices):
    f = tmp_path / "c.json"
    server.prices.save_cache(f)
    from prices.service import PriceService
    other = PriceService(0, 0)
    assert other.load_cache(f) and other.real == server.prices.real
