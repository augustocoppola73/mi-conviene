import json

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import recipes
import server

P = server.PRODUCT_INDEX
CARBONARA = ["500 g di spaghetti", "200 g di guanciale (o pancetta)", "4 tuorli", "pecorino grattugiato",
             "pepe nero macinato al momento"]


@pytest.mark.parametrize("line,name,amount,kind", [
    ("500 g di spaghetti", "spaghetti", 500, "g"),
    ("Spaghetti 320 g", "Spaghetti", 320, "g"),
    ("2 spicchi d'aglio", "aglio", 2, "spicchio"),
    ("1/2 l di latte", "latte", 500, "ml"),
    ("3 cucchiai di olio extravergine d'oliva", "olio extravergine d'oliva", 45, "ml"),
    ("Uova (medie) 2", "Uova", 2, "pz"),
    ("Sale fino q.b.", "Sale fino", None, None),
])
def test_parse_ingredient(line, name, amount, kind):
    i = recipes.parse_ingredient(line)
    assert i["name"] == name and i["amount"] == amount and i["kind"] == kind


def test_plan_scales_and_rounds_to_packs():
    rows = {r["name"]: r for r in recipes.plan(CARBONARA, 4, 2, P)}   # da 4 a 2 persone
    assert rows["spaghetti"]["product_id"] == "spaghetti" and rows["spaghetti"]["quantity"] == 1   # 250 g -> 1 pacco da 500
    assert rows["spaghetti"]["amount"] == 250
    assert rows["tuorli"]["product_id"] == "uova" and rows["tuorli"]["quantity"] == 1             # 2 uova -> 1 confezione da 6
    assert rows["guanciale"]["product_id"] is None                                                 # non in catalogo: prodotto nuovo
    assert rows["pepe nero macinato al momento"]["pantry"]                                          # di solito in casa
    big = {r["name"]: r for r in recipes.plan(["Riso Carnaroli 320 g", "1 cipolla", "Uova 8"], 4, 8, P)}
    assert big["Riso Carnaroli"]["quantity"] == 1.0            # 640 g -> 1 pacco da 1 kg
    assert big["cipolla"]["quantity"] == 0.3                    # 2 cipolle ~ 300 g
    assert big["Uova"]["quantity"] == 3                         # 16 uova -> 3 confezioni da 6


GZ_PAGE = """<html><head><title>Spaghetti alla Carbonara Ricetta</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
{"@type":"Recipe","name":"Spaghetti alla Carbonara","recipeYield":"4 persone",
"recipeIngredient":["Spaghetti 320 g","Guanciale 150 g","Tuorli (medi) 6","Pecorino Romano 50 g","Pepe nero q.b."]}]}</script>
</head><body>...</body></html>"""


def test_parse_recipe_page_jsonld():
    r = recipes.parse_recipe_html(GZ_PAGE, "https://ricette.giallozafferano.it/Spaghetti-alla-Carbonara.html")
    assert r["name"] == "Spaghetti alla Carbonara" and r["servings"] == 4 and len(r["ingredients"]) == 5
    assert r["source"] == "ricette.giallozafferano.it"


def test_parse_recipe_page_html_fallback():
    html = '<h1>Pasta e ceci</h1><dl><dd class="gz-ingredient"><a href="#">Ceci</a> 250 g</dd>' \
           '<dd class="gz-ingredient"><a>Ditalini</a> 200 g</dd></dl> Dosi per 4 persone'
    r = recipes.parse_recipe_html(html, "https://www.giallozafferano.it/x")
    assert r["ingredients"] == ["Ceci 250 g", "Ditalini 200 g"] and r["servings"] == 4


def test_safe_url_blocks_local():
    with pytest.raises(ValueError):
        recipes._safe_url("http://127.0.0.1:8001/api")
    with pytest.raises(ValueError):
        recipes._safe_url("file:///etc/passwd")


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    monkeypatch.setattr(recipes, "_COLLECTION", [{"id": "wb:amatriciana", "name": "Amatriciana", "servings": 4,
        "ingredients": ["400 g di spaghetti", "150 g di guanciale", "400 g di pomodori pelati", "pecorino"],
        "source": "Wikibooks", "url": "https://it.wikibooks.org/x", "categories": ["Primi piatti"]}])
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c


async def test_personal_recipes_and_plan(client):
    r = (await client.post("/api/recipes", json={"user_id": "a", "name": "Pasta della nonna", "servings": 2,
                                                  "ingredients": ["200 g di spaghetti", "", "passata 300 g"]})).json()
    assert r["source"] == "mia" and r["ingredients"] == ["200 g di spaghetti", "passata 300 g"]
    lst = (await client.get("/api/recipes", params={"user_id": "a"})).json()["recipes"]
    assert [x["name"] for x in lst] == ["Pasta della nonna", "Amatriciana"] and lst[0]["mine"]
    # un altro utente non vede le mie ricette, la raccolta sì
    other = (await client.get("/api/recipes", params={"user_id": "b"})).json()["recipes"]
    assert [x["name"] for x in other] == ["Amatriciana"]
    assert (await client.get(f"/api/recipes/{r['id']}", params={"user_id": "b"})).status_code == 404
    # in famiglia sì
    f = (await client.post("/api/family/create", json={"user_id": "a"})).json()
    await client.post("/api/family/join", json={"user_id": "b", "code": f["code"]})
    assert (await client.get(f"/api/recipes/{r['id']}", params={"user_id": "b"})).status_code == 200
    plan = (await client.post("/api/recipes/plan", json={"recipe_id": r["id"], "user_id": "a", "servings": 4})).json()
    assert plan["recipe_servings"] == 2 and {i["product_id"] for i in plan["items"]} == {"spaghetti", "passata"}
    # ricerca per ingrediente
    found = (await client.get("/api/recipes", params={"q": "guanciale", "user_id": "a"})).json()["recipes"]
    assert [x["id"] for x in found] == ["wb:amatriciana"]
    p2 = (await client.post("/api/recipes/plan", json={"recipe_id": "wb:amatriciana", "servings": 2})).json()
    g = next(i for i in p2["items"] if i["name"] == "guanciale")
    assert g["product_id"] is None and g["category_id"]
    up = (await client.put(f"/api/recipes/{r['id']}", json={"user_id": "b", "name": "Pasta nonna", "servings": 2,
                                                            "ingredients": ["spaghetti 200 g"]})).json()
    assert up["name"] == "Pasta nonna"
    assert (await client.delete(f"/api/recipes/{r['id']}", params={"user_id": "a"})).json()["ok"]
