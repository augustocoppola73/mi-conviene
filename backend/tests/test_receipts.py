import base64
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import receipts
import server

FIX = Path(__file__).parent / "fixtures"
ROWS = ["CONAD CITY", "VIA ROMA 1", "DOCUMENTO COMMERCIALE", "DESCRIZIONE IVA PREZZO",
        "SPAGHETTI N.5 500G 4% 0,89", "OLIO EXTRAV. ITALIANO 1L 4% 7,99", "PARMIGIANO REGG.300G 4% 5,49",
        "SCONTO -0,50", "2 X 0,79", "PASSATA POMODORO 700G 4% 1,58", "BANANE KG 1,120 x 1,59", "BANANE 4% 1,78",
        "TOTALE COMPLESSIVO 17,23", "DI CUI IVA 0,66", "PAGAMENTO ELETTRONICO 17,23", "05/10/26 18:02"]


def test_parse_italian_receipt():
    p = receipts.parse_rows(ROWS)
    assert p["store_id"] == "conad" and p["date"] == "2026-10-05" and p["total"] == 17.23 and p["total_matches"]
    by = {l["text"].split()[0]: l for l in p["lines"]}
    assert by["PARMIGIANO"]["discount"] == 0.5 and by["PARMIGIANO"]["net_price"] == 4.99
    assert by["PASSATA"]["quantity"] == 2          # "2 X 0,79" prima dell'articolo
    assert by["BANANE"]["weight_kg"] == 1.12
    assert len(p["lines"]) == 5                     # totale, iva, pagamento esclusi


def test_match_and_reference_prices():
    p = receipts.match_lines(receipts.parse_rows(ROWS), server.PRODUCT_INDEX, ["olio_evo", "parmigiano", "passata", "banane"])
    m = {l["text"].split()[0]: l for l in p["lines"]}
    assert m["OLIO"]["product_id"] == "olio_evo" and m["OLIO"]["expected"]
    assert m["PARMIGIANO"]["product_id"] == "parmigiano"
    assert m["BANANE"]["product_id"] == "banane"
    P = server.PRODUCT_INDEX
    assert receipts.reference_price(m["BANANE"], P["banane"]) == round(1.78 / 1.12, 2)    # al kg
    assert receipts.reference_price(m["PARMIGIANO"], P["parmigiano"]) == 4.99           # 300 g = riferimento
    assert receipts.reference_price(m["PASSATA"], P["passata"]) == 0.79                 # prezzo del pezzo


def test_ocr_on_photo():
    pytest.importorskip("rapidocr_onnxruntime")
    rows = receipts.group_rows(receipts.ocr_image((FIX / "scontrino_prova.jpg").read_bytes()))
    p = receipts.parse_rows(rows)
    assert p["store_id"] == "lidl" and p["total"] == 18.52 and p["total_matches"]


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["test"])
    server.RECEIPT_PRICES.clear()
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as c:
        yield c
    server.RECEIPT_PRICES.clear()
    server.rebuild_catalog()


async def test_apply_receipt_saves_real_prices_and_verifies(client):
    items = [{"product_id": "olio_evo", "quantity": 1}, {"product_id": "banane", "quantity": 1}]
    r = (await client.post("/api/optimize", json={"user_id": "r", "items": items})).json()
    rec = r["recommended"]
    e = (await client.post("/api/savings", json={"user_id": "r", "store_id": rec["store_id"], "amount": 1,
                                                 "estimated_spend": rec["receipt"]["total"], "snapshot": rec})).json()
    body = {"saving_id": e["id"], "user_id": "r", "store_id": rec["store_id"], "date": "2026-10-05", "total": 9.77,
            "lines": [{"product_id": "olio_evo", "text": "OLIO EXTRAV. 1L", "net_price": 7.99},
                      {"product_id": "banane", "text": "BANANE", "net_price": 1.78, "weight_kg": 1.12}]}
    out = (await client.post("/api/receipts/apply", json=body)).json()
    assert out["prices_saved"] == 2 and out["verified"]["paid"] == 9.77
    info = server.CATALOG[rec["store_id"]]["olio_evo"]
    assert info["source"] == "scontrino" and info["normal_price"] == 7.99
    # la prossima ricerca usa il prezzo vero
    r2 = (await client.post("/api/optimize", json={"user_id": "r", "items": items})).json()
    st = next(x for x in r2["ranked"] if x["store_id"] == rec["store_id"])
    assert next(l for l in st["receipt"]["lines"] if l["product_id"] == "olio_evo")["source"] == "scontrino"


async def test_scan_endpoint_rejects_garbage(client):
    r = await client.post("/api/receipts/scan", json={"image_base64": base64.b64encode(b"x" * 200).decode()})
    assert r.status_code in (422, 503)


def test_merge_rows_removes_overlap():
    a = ["LIDL", "SPAGHETTI 500G 0,89", "OLIO EXTRAV. 1L 7,99", "PARMIGIANO 4,99"]
    b = ["OLIO EXTRAV 1L 7,99", "PARMIGIANO 4,99", "BANANE 1,78", "TOTALE 15,65"]  # OCR un po' diverso
    rows, removed = receipts.merge_rows([a, b])
    assert removed == [2] and rows == a + ["BANANE 1,78", "TOTALE 15,65"]
    # stesso articolo comprato due volte di seguito ma a cavallo delle foto senza sovrapposizione: resta
    rows, removed = receipts.merge_rows([["LIDL", "BANANE 1,78"], ["BANANE 1,95", "TOTALE 3,73"]])
    assert removed == [0] and len(rows) == 4


def _piece(img, top, bottom):
    import io
    buf = io.BytesIO()
    img.crop((0, top, img.width, bottom)).save(buf, "JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode()


async def test_scan_long_receipt_in_pieces(client):
    pytest.importorskip("rapidocr_onnxruntime")
    from PIL import Image
    img = Image.open(FIX / "scontrino_prova.jpg")
    one = (await client.post("/api/receipts/scan", json={"images": [_piece(img, 0, img.height)]})).json()
    h = img.height
    two = (await client.post("/api/receipts/scan", json={"images": [_piece(img, 0, int(h * 0.6)), _piece(img, int(h * 0.42), h)]})).json()
    assert two["photos"] == 2 and two["overlaps"][0] >= 1
    assert two["total"] == one["total"] == 18.52 and two["total_matches"]
    # stesse righe (il testo può differire di uno spazio tra due letture): stessi prezzi e prodotti
    assert [(l["net_price"], l["product_id"]) for l in two["lines"]] == [(l["net_price"], l["product_id"]) for l in one["lines"]]


async def test_photos_are_never_stored(client, tmp_path, monkeypatch):
    """Dopo la lettura e il salvataggio, nell'archivio non resta nessuna foto: solo righe e prezzi."""
    pytest.importorskip("rapidocr_onnxruntime")
    monkeypatch.chdir(tmp_path)
    b64 = base64.b64encode((FIX / "scontrino_prova.jpg").read_bytes()).decode()
    scan = (await client.post("/api/receipts/scan", json={"images": [b64]})).json()
    await client.post("/api/receipts/apply", json={"user_id": "p", "store_id": "lidl", "total": scan["total"],
                                                   "lines": [{k: l[k] for k in ("product_id", "text", "net_price", "quantity", "weight_kg")}
                                                             for l in scan["lines"]]})
    import json
    dump = {name: await server.db[name].find({}, {"_id": 0}).to_list(None) for name in await server.db.list_collection_names()}
    text = json.dumps(dump, default=str)
    assert b64[:200] not in text and "base64" not in text and len(text) < 20_000
    assert list(tmp_path.iterdir()) == []      # nessun file scritto


async def test_manual_real_prices_next_to_virtual_receipt(client):
    """Prezzi veri scritti a mano accanto allo scontrino calcolato, senza foto."""
    items = [{"product_id": "banane", "quantity": 1.5}, {"product_id": "latte", "quantity": 2},
             {"product_id": "spaghetti", "quantity": 2}]
    rec = (await client.post("/api/optimize", json={"user_id": "m", "items": items})).json()["recommended"]
    e = (await client.post("/api/savings", json={"user_id": "m", "store_id": rec["store_id"], "amount": 1,
                                                 "estimated_spend": rec["receipt"]["total"], "snapshot": rec})).json()
    lines = [{"product_id": "banane", "text": "Banane", "net_price": 2.85, "quantity": 1, "weight_kg": 1.5},
             {"product_id": "latte", "text": "Latte intero 1L", "net_price": 2.58, "quantity": 2},
             {"product_id": "spaghetti", "text": "Spaghetti 500g", "net_price": 1.78, "quantity": 2}]
    out = (await client.post("/api/receipts/apply", json={"saving_id": e["id"], "user_id": "m", "store_id": rec["store_id"],
                                                          "lines": lines})).json()
    assert out["prices_saved"] == 3 and "verified" not in out           # senza totale: solo prezzi
    cat = server.CATALOG[rec["store_id"]]
    assert cat["banane"]["normal_price"] == 1.9 and cat["latte"]["normal_price"] == 1.29 and cat["spaghetti"]["normal_price"] == 0.89
    s = (await client.get("/api/savings/m")).json()
    entry = next(x for x in s["entries"] if x["id"] == e["id"])
    assert entry["real_receipt"]["total"] is None and len(entry["real_receipt"]["lines"]) == 3 and not entry["verified"]
    out = (await client.post("/api/receipts/apply", json={"saving_id": e["id"], "user_id": "m", "store_id": rec["store_id"],
                                                          "total": 7.21, "lines": lines})).json()
    assert out["verified"]["paid"] == 7.21
