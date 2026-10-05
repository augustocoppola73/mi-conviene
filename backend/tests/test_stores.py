import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import server
import stores

FIX = Path(__file__).parent / "fixtures"
MILANO = (45.4642, 9.19)


def elements():
    return json.loads((FIX / "overpass_milano.json").read_bytes().decode("utf-8-sig"))["elements"]


def test_parse_real_osm_stores():
    parsed = stores.parse_elements(elements())
    assert {s["chain"] for s in parsed} == {"esselunga", "conad", "coop", "lidl", "carrefour"}
    assert all(s["lat"] and s["lon"] for s in parsed)


def test_nearest_per_chain():
    near = stores.nearest_per_chain(stores.parse_elements(elements()), *MILANO)
    assert set(near) == {"esselunga", "conad", "coop", "lidl", "carrefour"}
    for s in near.values():
        assert 0.1 <= s["distance_km"] < 8
    # il più vicino è davvero il più vicino
    all_esselunga = [s for s in stores.parse_elements(elements()) if s["chain"] == "esselunga"]
    d = min(stores.haversine_km(*MILANO, s["lat"], s["lon"]) for s in all_esselunga) * stores.ROAD_FACTOR
    assert near["esselunga"]["distance_km"] == round(d, 1)


def test_query_excludes_convenience_by_default():
    assert "convenience" not in stores.overpass_query(1, 2, 3000)
    assert "convenience" in stores.overpass_query(1, 2, 3000, include_convenience=True)


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c


@pytest.fixture
def fake_osm(monkeypatch):
    parsed = stores.parse_elements(elements())
    # solo 3 catene vicine: Coop e Lidl "mancano"
    subset = [s for s in parsed if s["chain"] in ("esselunga", "conad", "carrefour")]

    async def fake_around(self, lat, lon):
        return subset
    monkeypatch.setattr(stores.StoreLocator, "stores_around", fake_around)
    monkeypatch.setattr(server, "maybe_recenter_prices", lambda lat, lon: None)


async def test_optimize_with_location(client, fake_osm):
    body = {"user_id": "u", "items": [{"product_id": "pasta", "quantity": 2}], "lat": MILANO[0], "lon": MILANO[1],
            "habitual_store_id": "lidl"}
    r = (await client.post("/api/optimize", json=body)).json()
    assert {x["store_id"] for x in r["ranked"]} == {"esselunga", "conad", "carrefour"}
    assert r["location"]["mode"] == "reale"
    assert set(r["location"]["missing_chains"]) == {"Coop", "Lidl"}
    assert r["location"]["habitual_missing"] == "Lidl"
    assert all(x["branch"]["name"] for x in r["ranked"])


async def test_optimize_without_location_uses_examples(client):
    r = (await client.post("/api/optimize", json={"user_id": "u", "items": [{"product_id": "pasta", "quantity": 1}]})).json()
    assert r["location"]["mode"] == "esempio" and len(r["ranked"]) == 5


async def test_optimize_osm_down_falls_back(client, monkeypatch):
    async def boom(self, lat, lon):
        raise RuntimeError("rete giù")
    monkeypatch.setattr(stores.StoreLocator, "stores_around", boom)
    r = (await client.post("/api/optimize", json={"user_id": "u", "items": [{"product_id": "pasta", "quantity": 1}],
                                                  "lat": 45.0, "lon": 9.0})).json()
    assert r["location"]["mode"] == "esempio" and "error" in r["location"]


async def test_stores_nearby(client, fake_osm):
    r = (await client.get("/api/stores/nearby", params={"lat": MILANO[0], "lon": MILANO[1]})).json()
    ds = [s["distance_km"] for s in r["stores"]]
    assert ds == sorted(ds) and len(ds) == 3
