"""Genera i casi golden per src/engine/kitchen.ts (costi ricette, suggerimenti, menu, spesa in corso).
Usa gli stessi prezzi e storico di core_golden.json, così il catalogo è quello già verificato."""
import asyncio
import json
import os
import random
import sys
import tempfile
from pathlib import Path

os.environ["PRICES_AUTO_REFRESH"] = "0"
os.environ["STORAGE"] = "local"
os.environ["LOCAL_DB_FILE"] = str(Path(tempfile.mkdtemp()) / "db.json")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402
from server import recipes  # noqa: E402

FRONT = Path(os.environ.get("ENGINE_DIR", ROOT / "frontend" / "src" / "engine"))
G = json.loads((FRONT / "__golden__" / "core_golden.json").read_text(encoding="utf-8"))
OUT = FRONT / "__golden__" / "kitchen_golden.json"

MY_RECIPES = [
    {"id": "r1", "user_id": "u1", "name": "Pasta al pomodoro di casa", "servings": 4, "source": "mia", "categories": ["Primi piatti"],
     "ingredients": ["400 g di spaghetti", "500 g di passata di pomodoro", "1 spicchio d'aglio", "olio q.b.", "basilico"]},
    {"id": "r2", "user_id": "u1", "name": "Frittata", "servings": 2, "source": "mia", "categories": ["Secondi piatti"],
     "ingredients": ["4 uova", "50 g di parmigiano grattugiato", "100 ml di latte", "sale q.b."]},
    {"id": "r3", "user_id": "u1", "name": "Torta di mele della nonna", "servings": None, "source": "mia", "categories": [],
     "ingredients": ["3 mele", "200 g di farina", "150 g di zucchero", "3 uova", "1 bustina di lievito", "100 g di burro"]},
]


async def main():
    server.db = AsyncMongoMockClient()["golden"]
    db = server.db
    # catalogo e varianti come in core_golden (verificati uguali al TS)
    server.CATALOG.clear()
    server.CATALOG.update(G["catalog"])
    server.RECEIPT_VARIANTS.clear()
    for d in sorted(G["user_prices"], key=lambda d: d["date"]):
        if d["kind"] == "variante":
            server.RECEIPT_VARIANTS[(d["store_id"], d["product_id"])] = {
                "price": d.get("paid", d["ref_price"]), "ref_price": d["ref_price"], "text": d.get("receipt_text"),
                "observed_at": d["date"], "note": d.get("note")}
    await db.recipes.insert_many([dict(r) for r in MY_RECIPES])
    habit = [{"items": [{"product_id": x, "quantity": q} for x, q in (("latte", 2), ("uova", 1), ("banane", 1 + k % 2),
                                                                    ("pasta", 1), ("mele", 1))[: 3 + k % 3]],
              "store_id": "lidl", "total_cost": 20 + k, "created_at": f"2026-11-{1 + 4 * k:02d}T10:00:00"} for k in range(7)]
    hist = sorted(G["history"][:12] + habit, key=lambda s: s["created_at"], reverse=True)[:40]
    await db.history.insert_many([{**s, "user_id": "u1"} for s in hist])

    coll = recipes.collection()
    rnd = random.Random(7)
    sample = MY_RECIPES + rnd.sample(coll, 250)
    out = {"my_recipes": MY_RECIPES, "history": hist}

    out["priced"] = [{"id": r["id"], "summary": server.recipe_summary_priced(r),
                      "costs": server.buy_costs(server.recipe_core(r)["rows"]),
                      "portions": {s["id"]: server.portion_cost(server.recipe_core(r), s["id"]) for s in server.STORES}}
                     for r in sample]
    out["plans"] = []
    for r in sample[:60]:
        for serv in (1, 3, 6):
            res = await server.plan_recipe(server.PlanIn(ingredients=r["ingredients"], recipe_servings=r.get("servings"), servings=serv))
            out["plans"].append({"lines": r["ingredients"], "base": r.get("servings"), "servings": serv, "out": res})

    menus = []
    for k in range(8):
        ents = [{"recipe_id": r["id"], "servings": rnd.randint(1, 6)} for r in rnd.sample(sample, rnd.randint(1, 6))]
        res = await server.recipes_menu(server.MenuIn(user_id="u1", entries=ents))
        menus.append({"entries": ents, "out": res})
    out["menus"] = menus

    ranks = []
    for q, main in (("", False), ("", True), ("pasta", False), ("pollo", True)):
        res = await server.list_recipes(q=q, user_id="u1", limit=30, sort="prezzo", main=main)
        ranks.append({"q": q, "main": main, "ids": [r["id"] for r in res["recipes"]]})
    out["ranks"] = ranks

    pids = sorted(server.PRODUCT_INDEX)
    suggests = []
    lists = [
        [{"product_id": "spaghetti", "quantity": 1}, {"product_id": "passata", "quantity": 1}],
        [{"product_id": "uova", "quantity": 1}, {"product_id": "custom:zucchine", "quantity": 1, "name": "zucchine"},
         {"product_id": "custom:pomodori", "quantity": 1, "name": "pomodori"}],
        [{"product_id": "custom:guanciale", "quantity": 1, "name": "guanciale"}, {"product_id": "custom:pecorino romano", "quantity": 1, "name": "pecorino romano"},
         {"product_id": "uova", "quantity": 1}],
    ] + [[{"product_id": p, "quantity": 1} for p in rnd.sample(pids, rnd.randint(2, 12))] for _ in range(10)]
    for i, items in enumerate(lists):
        for uid, store, budget, spent in ((None, None, None, None), ("u1", "lidl", 60.0, 41.3), ("u1", None, 30.0, 29.0)):
            body = server.SuggestIn(user_id=uid, items=items, store_id=store, budget=budget, spent=spent, servings=1 + i % 4)
            suggests.append({"body": body.model_dump(), "out": await server.suggest(body)})
    out["suggests"] = suggests

    proposes = []
    for count, serv, budget, store, items in ((5, 2, None, None, []), (7, 4, 40.0, "lidl", lists[0]),
                                               (3, 1, None, "conad", lists[1]), (14, 2, 25.0, None, [])):
        for uid in (None, "u1"):
            body = server.ProposeIn(user_id=uid, count=count, servings=serv, budget=budget, store_id=store,
                                    exclude=[sample[5]["id"]], items=items)
            proposes.append({"body": body.model_dump(), "out": await server.propose_menu(body)})
    out["proposes"] = proposes

    shop_items = []
    for sid in [s["id"] for s in server.STORES]:
        for p in ["latte", "spaghetti", "pasta", "banane", "custom:zucchine"] + rnd.sample(pids, 5):
            it = server.ShopItemIn(product_id=p, quantity=rnd.choice([1, 2, 0.5, 3]), name="zucchine" if p.startswith("custom") else None)
            shop_items.append({"store_id": sid, "item": it.model_dump(), "out": server._shop_item(it, sid, sid == "lidl")})
    out["shop_items"] = shop_items

    aisles = []
    cats = [c["id"] for c in server.CATEGORIES]
    for k in range(6):
        items = []
        for j, c in enumerate(rnd.sample(cats, rnd.randint(1, 7))):
            items.append({"category_id": c, "checked": rnd.random() > 0.2, "checked_at": f"2026-10-0{1 + k}T10:{j:02d}:00"})
        shop = {"user_id": "u1", "store_id": "lidl", "items": items}
        before = (await db.aisles.find_one({"key": "u1:lidl"}, {"_id": 0}) or {}).get("ranks")
        await server.learn_aisles(shop)
        after = (await db.aisles.find_one({"key": "u1:lidl"}, {"_id": 0}) or {}).get("ranks")
        aisles.append({"items": items, "before": before, "after": after if after != before or before is None else after,
                       "learned": after != before, "order": await server.aisle_order("u1", "lidl")})
    out["aisles"] = aisles
    OUT.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")
    print("scritto", OUT, len(out["priced"]), "ricette,", len(suggests), "suggerimenti,", len(proposes), "menu proposti")


asyncio.run(main())
