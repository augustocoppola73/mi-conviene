import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import server


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c
    for d in (server.RECEIPT_PRICES, server.RECEIPT_PROMOS, server.RECEIPT_VARIANTS):
        d.clear()
    server.rebuild_catalog()


ITEMS = [{"product_id": "mele", "quantity": 1}, {"product_id": "latte", "quantity": 2},
         {"product_id": "petto_pollo", "quantity": 0.5}, {"product_id": "custom:sapone", "quantity": 1,
                                                          "name": "sapone", "category_id": "casa"}]


async def test_shop_flow_check_add_finish(client):
    s = (await client.post("/api/shops", json={"user_id": "a", "store_id": "lidl", "items": ITEMS})).json()
    assert s["progress"] == {"checked": 0, "total": 4, "cart": 0, "estimated": s["progress"]["estimated"]}
    assert s["progress"]["estimated"] > 0 and s["store_name"] == "Lidl"
    assert next(i for i in s["items"] if i["key"] == "custom:sapone")["price"] is None
    a = (await client.get("/api/shops/active", params={"user_id": "a"})).json()["shop"]
    assert a["id"] == s["id"]
    # smarco in negozio: prima il latte, poi la carne (al contrario dell'ordine standard)
    for k in ("latte", "petto_pollo"):
        s = (await client.post(f"/api/shops/{s['id']}/check", json={"user_id": "a", "key": k, "checked": True})).json()
    assert s["progress"]["checked"] == 2 and s["progress"]["cart"] > 0
    s = (await client.post(f"/api/shops/{s['id']}/add", json={"user_id": "a", "item": {"product_id": "caffe", "quantity": 1}})).json()
    added = next(i for i in s["items"] if i["key"] == "caffe")
    assert added["checked"] and added["added_in_store"]
    f = (await client.post(f"/api/shops/{s['id']}/finish", json={"user_id": "a"})).json()
    assert {i["key"] for i in f["missing"]} == {"mele", "custom:sapone"}
    assert (await client.get("/api/shops/active", params={"user_id": "a"})).json()["shop"] is None
    # l'ordine dei reparti imparato in questo negozio: latticini prima della carne
    s2 = (await client.post("/api/shops", json={"user_id": "a", "store_id": "lidl", "items": ITEMS})).json()
    aisles = s2["aisles"]
    assert aisles.index("latticini") < aisles.index("carne")
    # in un altro negozio no
    s3 = (await client.post("/api/shops", json={"user_id": "a", "store_id": "conad", "items": ITEMS})).json()
    assert s3["aisles"] == [c["id"] for c in server.CATEGORIES]


async def test_shop_shared_with_family_and_cancel(client):
    f = (await client.post("/api/family/create", json={"user_id": "a", "display_name": "Augusto"})).json()
    await client.post("/api/family/join", json={"user_id": "b", "code": f["code"], "display_name": "Sara"})
    s = (await client.post("/api/shops", json={"user_id": "a", "store_id": "lidl", "items": ITEMS, "display_name": "Augusto"})).json()
    b = (await client.get("/api/shops/active", params={"user_id": "b"})).json()["shop"]
    assert b["id"] == s["id"] and not b["mine"]
    b = (await client.post(f"/api/shops/{s['id']}/check", json={"user_id": "b", "key": "mele", "checked": True,
                                                                "display_name": "Sara"})).json()
    assert next(i for i in b["items"] if i["key"] == "mele")["checked_by"] == "Sara"
    # un estraneo non la vede
    assert (await client.get("/api/shops/active", params={"user_id": "x"})).json()["shop"] is None
    assert (await client.post(f"/api/shops/{s['id']}/check", json={"user_id": "x", "key": "mele", "checked": False})).status_code == 404
    c = (await client.post(f"/api/shops/{s['id']}/cancel", json={"user_id": "a"})).json()
    assert len(c["items"]) == 4
    assert (await client.get("/api/shops/active", params={"user_id": "b"})).json()["shop"] is None


async def test_price_seen_in_store(client):
    s = (await client.post("/api/shops", json={"user_id": "a", "store_id": "lidl", "items": ITEMS})).json()
    s = (await client.post(f"/api/shops/{s['id']}/price", json={"user_id": "a", "key": "latte", "price": 1.58,
                                                                 "kind": "offerta"})).json()
    it = next(i for i in s["items"] if i["key"] == "latte")
    assert it["checked"] and it["seen"]["kind"] == "offerta" and it["price"] == 1.58
    assert server.CATALOG["lidl"]["latte"]["promo_price"] == 0.79     # 2 litri a 1,58 = 0,79 al litro
    server.RECEIPT_PROMOS.clear(); server.rebuild_catalog()
