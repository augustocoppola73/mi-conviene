import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import server


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c


LIST = [{"product_id": "pasta", "quantity": 2}, {"product_id": "olio_evo", "quantity": 1},
        {"product_id": "latte", "quantity": 3}, {"product_id": "petto_pollo", "quantity": 1}]


async def test_health_and_bootstrap(client):
    assert (await client.get("/api/")).json()["status"] == "ok"
    b = (await client.get("/api/bootstrap")).json()
    assert len(b["categories"]) == 10 and len(b["products"]) == 48 and len(b["stores"]) == 5


def test_catalog_consistency():
    assert set(server.BASE_PRICES) == set(server.PRODUCT_INDEX)
    # nessuna promozione inventata: le stime sono a prezzo pieno
    for products in server.CATALOG.values():
        for info in products.values():
            if info["source"] == "stima":
                assert info["promo_price"] is None and info["final_price"] == info["normal_price"]


async def test_optimize_ranking(client):
    r = (await client.post("/api/optimize", json={"user_id": "u", "items": LIST, "transport": "car"})).json()
    scores = [s["score"] for s in r["ranked"]]
    assert scores == sorted(scores) and len(scores) == 5
    assert r["recommended"]["store_id"] == r["ranked"][0]["store_id"]
    assert r["reasoning"]


async def test_quantity_scaling():
    one = server.compute_virtual_receipt("conad", [server.ListItem(product_id="latte", quantity=1)])
    three = server.compute_virtual_receipt("conad", [server.ListItem(product_id="latte", quantity=3)])
    assert three["total"] == pytest.approx(one["total"] * 3, abs=0.02)


def test_travel_costs():
    store = server.STORE_INDEX["lidl"]
    assert server.compute_travel(store, "walk")["fuel_cost"] == 0
    car = server.compute_travel(store, "car")
    # 7 l/100 km x prezzo al litro, andata e ritorno
    assert car["fuel_cost"] == round(3.6 * 2 * 0.07 * server.FALLBACK_FUEL_PRICE, 2)


async def test_anti_fatigue_rule(client):
    base = {"user_id": "u", "items": LIST, "transport": "car"}
    best = (await client.post("/api/optimize", json=base)).json()["ranked"]
    habitual = best[1]
    delta = habitual["total_cost"] - best[0]["total_cost"]
    # soglia sopra il delta -> resta dall'abituale
    r = (await client.post("/api/optimize", json={**base, "habitual_store_id": habitual["store_id"],
                                                   "min_savings_threshold": delta + 1})).json()
    assert r["recommended"]["store_id"] == habitual["store_id"]
    assert r["reasoning"].startswith("Resta")
    # soglia sotto il delta -> consiglia il migliore
    r = (await client.post("/api/optimize", json={**base, "habitual_store_id": habitual["store_id"],
                                                   "min_savings_threshold": 0})).json()
    assert r["recommended"]["store_id"] == best[0]["store_id"]


async def test_unknown_product_reported(client):
    items = [{"product_id": "inesistente", "quantity": 1}, {"product_id": "pane", "quantity": 1}]
    r = (await client.post("/api/optimize", json={"user_id": "u", "items": items})).json()
    assert r["ranked"][0]["receipt"]["unknown_products"] == ["inesistente"]


async def test_budget(client):
    r = (await client.post("/api/optimize", json={"user_id": "u", "items": LIST, "budget": 5})).json()
    assert r["budget_status"]["status"] == "over"


async def test_savings_crud(client):
    e = (await client.post("/api/savings", json={"user_id": "u", "store_id": "lidl", "amount": 4.5})).json()
    await client.post("/api/savings", json={"user_id": "u", "store_id": "coop", "amount": 2})
    s = (await client.get("/api/savings/u")).json()
    assert s["total"] == 6.5 and s["total_estimated"] == 6.5 and s["total_verified"] == 0 and s["to_verify"] == 2
    assert (await client.delete(f"/api/savings/{e['id']}")).status_code == 200
    assert (await client.delete(f"/api/savings/{e['id']}")).status_code == 404


async def test_lists_crud(client):
    l = (await client.post("/api/lists", json={"user_id": "u", "name": "Settimana", "items": LIST})).json()
    assert len((await client.get("/api/lists/u")).json()) == 1
    assert (await client.delete(f"/api/lists/{l['id']}")).status_code == 200
    assert (await client.delete(f"/api/lists/{l['id']}")).status_code == 404


async def test_offers_sorted(client):
    o = (await client.get("/api/offers")).json()
    assert all(x["source"] != "stima" for x in o)  # solo offerte vere
    assert [x["discount_pct"] for x in o] == sorted((x["discount_pct"] for x in o), reverse=True)


async def test_habitual(client):
    for _ in range(3):
        await client.post("/api/history", json={"user_id": "u", "items": [{"product_id": "pasta", "quantity": 2}]})
    await client.post("/api/history", json={"user_id": "u", "items": [{"product_id": "vino", "quantity": 1}]})
    h = (await client.get("/api/habitual/u")).json()
    assert [i["product_id"] for i in h["items"]] == ["pasta"]
    assert h["items"][0]["quantity"] == 2


async def test_family_flow(client):
    f = (await client.post("/api/family/create", json={"user_id": "a", "display_name": "Augusto"})).json()
    code = f["code"]
    assert len(code) == 6
    # idempotente
    assert (await client.post("/api/family/create", json={"user_id": "a"})).json()["code"] == code
    assert (await client.post("/api/family/join", json={"user_id": "b", "code": "XXXXXX"})).status_code == 404
    j = (await client.post("/api/family/join", json={"user_id": "b", "code": code.lower()})).json()
    assert len(j["members"]) == 2
    await client.post("/api/family/list", json={"code": code, "user_id": "b", "items": LIST})
    assert len((await client.get(f"/api/family/list/{code}")).json()["items"]) == 4
    assert (await client.post("/api/family/list", json={"code": code, "user_id": "z", "items": []})).status_code == 403
    await client.post("/api/family/leave", json={"user_id": "a"})
    await client.post("/api/family/leave", json={"user_id": "b"})
    assert (await client.get("/api/family/by-user/a")).json() == {}
    assert (await client.post("/api/family/join", json={"user_id": "c", "code": code})).status_code == 404


def test_reasoning_never_negative():
    # nessuna combinazione deve produrre "€-x in meno"
    for transport in ("walk", "bike", "car", "transit"):
        for items in (LIST, LIST[:1], LIST[1:3]):
            r = server.optimize_list(server.OptimizeRequest(user_id="u", items=items, transport=transport))
            assert "€-" not in r["reasoning"], r["reasoning"]


def _req(**kw):
    return server.OptimizeRequest(user_id="u", items=LIST, transport="car", **kw)


def test_savings_ignore_budget():
    # il budget non cambia il risparmio
    a = server.optimize_list(_req())["savings"]
    b = server.optimize_list(_req(budget=1000))["savings"]
    c = server.optimize_list(_req(budget=1))["savings"]
    assert a == b == c


def test_savings_vs_median_without_habitual():
    r = server.optimize_list(_req())
    costs = sorted(x["total_cost"] for x in r["ranked"])
    assert r["savings"]["reference"]["type"] == "median"
    assert r["savings"]["amount"] == round(max(0, costs[2] - r["recommended"]["total_cost"]), 2)
    assert r["savings"]["price_basis"] == "stima"


def test_savings_zero_when_staying_at_habitual():
    best = server.optimize_list(_req())["recommended"]["store_id"]
    r = server.optimize_list(_req(habitual_store_id=best))
    assert r["savings"]["amount"] == 0 and r["savings"]["reference"]["type"] == "habitual"


def test_savings_vs_habitual():
    ranked = server.optimize_list(_req())["ranked"]
    worst = ranked[-1]
    r = server.optimize_list(_req(habitual_store_id=worst["store_id"], min_savings_threshold=0))
    assert r["savings"]["amount"] == round(worst["total_cost"] - r["recommended"]["total_cost"], 2) > 0


def test_no_budget_still_recommends():
    r = server.optimize_list(_req())
    assert r["recommended"] and r["budget_status"] is None


def test_budget_alternative_when_over():
    r = server.optimize_list(_req(budget=0.01))
    assert r["budget_status"]["status"] == "over" and r["budget_status"]["alternative"] is None
    ranked = server.optimize_list(_req())["ranked"]
    cheapest = min(ranked, key=lambda x: x["total_cost"])
    rec = server.optimize_list(_req())["recommended"]
    if cheapest["store_id"] != rec["store_id"]:
        r = server.optimize_list(_req(budget=cheapest["total_cost"]))
        assert r["budget_status"]["alternative"]["store_id"] == cheapest["store_id"]


async def _shop(client, items, cost):
    await client.post("/api/history", json={"user_id": "b", "items": [{"product_id": p, "quantity": 1} for p in items],
                                            "total_cost": cost})


async def test_budget_suggest_from_similar_carts(client):
    assert (await client.post("/api/budget/suggest", json={"user_id": "b", "items": [{"product_id": "pasta", "quantity": 1}]})).json()["suggested"] is None
    week = ["pasta", "latte", "pane", "mele", "uova"]
    for cost in (40, 50, 45):
        await _shop(client, week, cost)
    await _shop(client, ["vino", "birra"], 15)
    r = (await client.post("/api/budget/suggest", json={"user_id": "b", "items": [{"product_id": p, "quantity": 1} for p in week[:4]]})).json()
    assert r["typical"] == 45 and r["suggested"] == 50 and r["basis"] == "spese simili"  # 45 * 1.1 = 49.5 -> 50


def test_budget_suggest_by_size_fallback():
    shops = [{"items": [{"product_id": "vino"}, {"product_id": "birra"}], "total_cost": 12},
             {"items": [{"product_id": "acqua"}], "total_cost": 8}]
    r = server.suggest_budget(["pane", "latte"], shops)
    assert r["basis"] == "spese di taglia piccola" and r["suggested"] == 11  # mediana 10 * 1.1


async def test_last_similar_shop(client):
    week = [{"product_id": p, "quantity": 1} for p in ("pasta", "latte", "pane", "mele")]
    r = (await client.post("/api/optimize", json={"user_id": "c", "items": week})).json()
    assert r["last_similar"] is None
    await client.post("/api/history", json={"user_id": "c", "items": week, "store_id": "lidl", "total_cost": 20})
    await client.post("/api/history", json={"user_id": "c", "items": week, "store_id": "coop", "total_cost": 22})
    await client.post("/api/history", json={"user_id": "c", "items": [{"product_id": "vino", "quantity": 1}], "store_id": "conad", "total_cost": 5})
    r = (await client.post("/api/optimize", json={"user_id": "c", "items": week[:3]})).json()
    assert r["last_similar"]["store_id"] == "coop"  # la più recente tra le simili, non quella del vino
    assert r["last_similar"]["same_as_recommended"] == (r["recommended"]["store_id"] == "coop")
    s = (await client.post("/api/budget/suggest", json={"user_id": "c", "items": week})).json()
    assert s["last_similar"]["store_name"] == "Coop"


async def test_local_storage_roundtrip(tmp_path):
    import storage
    from mongomock_motor import AsyncMongoMockClient
    f = tmp_path / "db.json"
    db1 = AsyncMongoMockClient()["a"]
    await db1.savings.insert_one({"id": "1", "user_id": "u", "amount": 2.5})
    await storage.save(db1, f)
    db2 = AsyncMongoMockClient()["b"]
    assert await storage.load(db2, f) == 1
    assert (await db2.savings.find_one({"id": "1"}, {"_id": 0}))["amount"] == 2.5


async def test_connect_falls_back_to_local(monkeypatch, tmp_path):
    import storage
    monkeypatch.setattr(storage, "LOCAL_FILE", tmp_path / "x.json")
    db, mode = await storage.connect("mongodb://127.0.0.1:1", "t", timeout_ms=200)
    assert mode == "locale"


async def test_verify_saving_with_real_receipt(client):
    h = (await client.post("/api/history", json={"user_id": "v", "items": LIST, "store_id": "conad", "total_cost": 31})).json()
    e = (await client.post("/api/savings", json={"user_id": "v", "store_id": "conad", "amount": 3, "history_id": h["id"],
                                                 "estimated_spend": 30, "estimated_total": 31})).json()
    assert e["verified"] is False
    # pagato 28 invece di 30: il risparmio sale da 3 a 5
    v = (await client.post(f"/api/savings/{e['id']}/verify", json={"paid": 28})).json()
    assert v["verified"] and v["verified_amount"] == 5 and v["paid"] == 28
    s = (await client.get("/api/savings/v")).json()
    assert s["total"] == 5 and s["total_verified"] == 5 and s["total_estimated"] == 0 and s["to_verify"] == 0
    # lo storico ora ha la spesa vera (+ 1 euro di viaggio)
    hist = await server.db.history.find_one({"id": h["id"]}, {"_id": 0})
    assert hist["total_cost"] == 29
    # pagato molto di più: la differenza viene tolta dal salvadanaio (3 + 30 - 50 = -17)
    v = (await client.post(f"/api/savings/{e['id']}/verify", json={"paid": 50})).json()
    assert v["verified_amount"] == -17
    s = (await client.get("/api/savings/v")).json()
    assert s["total"] == -17 and s["total_verified"] == -17
    await client.post(f"/api/savings/{e['id']}/unverify")
    assert (await client.get("/api/savings/v")).json()["total"] == 3
    assert (await client.post("/api/savings/nope/verify", json={"paid": 1})).status_code == 404
    assert (await client.post(f"/api/savings/{e['id']}/verify", json={"paid": 0})).status_code == 422
