"""
Lettura dello scontrino vero (foto) e allineamento con la spesa calcolata.

1. OCR locale (RapidOCR, open source, gira sul PC: la foto non va a servizi esterni).
2. Ricostruzione delle righe: i pezzi di testo vengono raddrizzati (foto storta) e
   raggruppati per riga.
3. Interpretazione a regole del "documento commerciale" italiano: articoli con prezzo,
   righe quantità ("2 x 0,79"), pesi ("KG 1,120 x 1,59"), sconti, totale, data, negozio.
4. Abbinamento righe <-> prodotti: prima quelli della spesa confermata, poi il catalogo.
Nessuna AI generativa: OCR + regole + somiglianza di testo, tutto ispezionabile.
"""
from __future__ import annotations

import base64
import io
import math
import re
import statistics
from difflib import SequenceMatcher
from functools import lru_cache

from classify import normalize, tokens
from prices.chains import chain_of

PRICE = r"-?\d{1,4}[,.]\d{2}"
SKIP = re.compile(r"\b(sub\s*totale|totale|iva|contant|resto|pagament|bancomat|carta|elettronic|importo|"
                  r"documento|commerciale|p\.?\s*iva|c\.?f\.?|cassa|cassiere|scontrino|n\.?\s*doc|doc\.?\s*n|"
                  r"articoli|pezzi|reso|vendita|prestazione|descrizione|prezzo|euro|tel\.?|www|grazie|arrivederci|"
                  r"punti|saldo|ricevuta|rt\b|matricola|operatore|non fiscale)", re.I)
TOTAL = re.compile(r"\b(totale\s*complessivo|totale\s*euro|totale\s*eur|importo\s*pagato|totale)\b", re.I)
DISCOUNT = re.compile(r"\b(sconto|sc\.|promo|offerta|risparmio|buono)\b", re.I)
QTY_LINE = re.compile(r"^\s*(\d+(?:[,.]\d+)?)\s*(?:pz|n\.?)?\s*[x×*]?\s+(" + PRICE + r")\s*$", re.I)
WEIGHT = re.compile(r"\bkg\s*(\d+[,.]\d{1,3})\s*[x×*]?\s*(?:€\s*)?(\d+[,.]\d{2})?", re.I)
DATE = re.compile(r"\b(\d{2})[-/.](\d{2})[-/.](\d{2,4})\b")
VAT = re.compile(r"\b\d{1,2}\s?%|\b(?:vi|v\.i\.|esente|es)\b", re.I)
PACK = re.compile(r"(\d+(?:[,.]\d+)?)\s*(kg|g|gr|l|lt|ml|cl)\b", re.I)

# abbreviazioni comuni sugli scontrini -> parola intera
ABBR = {"extrav": "extravergine", "ev": "extravergine", "regg": "reggiano", "parm": "parmigiano", "pom": "pomodoro",
        "pomod": "pomodoro", "mozz": "mozzarella", "prosc": "prosciutto", "biol": "biologico", "integr": "integrale",
        "fr": "fresco", "uht": "latte", "pz": "", "conf": "", "gr": "", "bott": "bottiglia", "nat": "naturale",
        "friz": "frizzante", "verd": "verdura", "detersiv": "detersivo", "lav": "lavatrice", "spagh": "spaghetti",
        "carta ig": "carta igienica", "zucch": "zucchine", "insal": "insalata", "yog": "yogurt"}


def num(s: str) -> float:
    return float(s.replace(",", "."))


# ---------------------------------------------------------------- OCR
@lru_cache(maxsize=1)
def _engine():
    from rapidocr_onnxruntime import RapidOCR  # import lento: solo al primo scontrino
    return RapidOCR()


def ocr_image(data: bytes) -> list[tuple[list, str, float]]:
    import numpy as np
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    if max(img.size) > 2000:  # foto del telefono troppo grandi: si riducono (più veloce, stesso risultato)
        img.thumbnail((2000, 2000))
    result, _ = _engine()(np.array(img))
    return [(box, text, float(conf)) for box, text, conf in (result or [])]


def decode_image(b64: str) -> bytes:
    if "," in b64[:100]:  # data URL "data:image/jpeg;base64,...."
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


# ---------------------------------------------------------------- righe
def group_rows(boxes: list[tuple[list, str, float]]) -> list[str]:
    """Raggruppa i pezzi di testo per riga, compensando la rotazione della foto."""
    if not boxes:
        return []
    slopes, heights = [], []
    for box, _, _ in boxes:
        (x0, y0), (x1, y1) = box[0], box[1]
        if x1 - x0 > 40:
            slopes.append((y1 - y0) / (x1 - x0))
        heights.append(abs(box[3][1] - box[0][1]) or 10)
    slope = statistics.median(slopes) if slopes else 0.0
    h = statistics.median(heights)
    items = []
    for box, text, _ in boxes:
        cx = sum(p[0] for p in box) / 4
        cy = sum(p[1] for p in box) / 4
        items.append((cy - slope * cx, cx, text))  # y "raddrizzata"
    items.sort()
    rows: list[list[tuple[float, float, str]]] = []
    for it in items:
        if rows and abs(it[0] - statistics.mean(r[0] for r in rows[-1])) < h * 0.6:
            rows[-1].append(it)
        else:
            rows.append([it])
    return [" ".join(t for _, _, t in sorted(r, key=lambda z: z[1])) for r in rows]


# ---------------------------------------------------------------- interpretazione
def parse_rows(rows: list[str]) -> dict:
    lines: list[dict] = []
    pending_qty: tuple[float, float] | None = None  # "2 x 0,79" letto prima del suo articolo
    total = None
    date = None
    store = None
    for raw in rows:
        text = raw.strip()
        if not text:
            continue
        if not store:
            store = chain_of({"osm_name": text})
        m = DATE.search(text)
        if m and not date:
            d, mo, y = m.groups()
            y = ("20" + y) if len(y) == 2 else y
            date = f"{y}-{mo}-{d}"
        prices = re.findall(PRICE, text)
        if TOTAL.search(text) and not re.search(r"sub\s*totale|di cui|iva", text, re.I) and prices:
            total = num(prices[-1])
            continue
        q = QTY_LINE.match(VAT.sub(" ", text))
        if q:  # "2 x 0,79": riguarda l'articolo vicino il cui prezzo torna (prima o dopo)
            qty, unit = num(q.group(1)), num(q.group(2))
            if not _attach_qty(lines, qty, unit):
                pending_qty = (qty, unit)
            continue
        w = WEIGHT.search(text)
        if w and not re.search(r"[a-z]{3,}.*" + PRICE + r"\s*$", WEIGHT.sub("", text), re.I):
            lines.append({"_weight": num(w.group(1)), "_unit_price": num(w.group(2)) if w.group(2) else None})
            continue
        if DISCOUNT.search(text) and prices and lines:
            d = abs(num(prices[-1]))
            prev = next((l for l in reversed(lines) if "price" in l), None)
            if prev:
                prev["discount"] = round(prev.get("discount", 0) + d, 2)
            continue
        if SKIP.search(text) or not prices:
            continue
        desc = re.sub(PRICE + r"\s*€?\s*$", "", VAT.sub(" ", text)).strip(" .-*€")
        if len(re.sub(r"[^a-zA-Z]", "", desc)) < 3:
            continue
        line = {"text": desc, "price": num(prices[-1]), "quantity": 1.0, "weight_kg": None}
        # peso indicato nella riga precedente ("BANANE KG 1,120 x 1,59")
        if lines and "_weight" in lines[-1]:
            pending = lines.pop()
            line["weight_kg"] = pending["_weight"]
        if pending_qty and abs(pending_qty[0] * pending_qty[1] - line["price"]) < 0.02:
            line["quantity"] = pending_qty[0]
        pending_qty = None
        lines.append(line)
    items = [l for l in lines if "price" in l]
    for l in items:
        l["net_price"] = round(l["price"] - l.get("discount", 0), 2)
        l.setdefault("discount", 0)
    lines_sum = round(sum(l["net_price"] for l in items), 2)
    return {"store_id": store, "date": date, "total": total, "lines": items, "lines_sum": lines_sum,
            "total_matches": total is not None and abs(total - lines_sum) < 0.02}


def _attach_qty(lines: list[dict], qty: float, unit: float) -> bool:
    """Assegna la quantità all'articolo precedente se il prezzo torna; altrimenti False
    (vale per l'articolo che segue)."""
    target = round(qty * unit, 2)
    prev = next((l for l in reversed(lines) if "price" in l), None)
    if prev and abs(prev["price"] - target) < 0.02:
        prev["quantity"] = qty
        return True
    return False


# ---------------------------------------------------------------- abbinamento
def _expand(text: str) -> str:
    t = " " + normalize(text) + " "
    for k, v in ABBR.items():
        t = re.sub(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", " " + v + " ", t)
    return re.sub(r"\s+", " ", t).strip()


def match_score(receipt_text: str, product_name: str) -> float:
    a, b = _expand(receipt_text), normalize(product_name)
    at = [w for w in tokens(a) if len(w) >= 3]
    bt = tokens(b)
    if not at or not bt:
        return 0.0
    hit = sum(1 for w in at if any(x.startswith(w[:max(3, min(len(w), 5))]) or w.startswith(x[:5]) for x in bt))
    cover = hit / len(at)
    back = sum(1 for x in bt if any(x.startswith(w[:4]) or w.startswith(x[:4]) for w in at)) / len(bt)
    ratio = SequenceMatcher(None, a, b).ratio()
    return round(0.45 * cover + 0.35 * back + 0.2 * ratio, 3)


def match_lines(parsed: dict, products: dict[str, dict], expected_ids: list[str]) -> dict:
    """Per ogni riga: il prodotto più probabile (prima tra quelli attesi della spesa)."""
    used: set[str] = set()
    for line in parsed["lines"]:
        best, best_s = None, 0.0
        for pid in list(dict.fromkeys(expected_ids)) + list(products):
            p = products.get(pid)
            if not p:
                continue
            sc = match_score(line["text"], p["name"]) + (0.12 if pid in expected_ids else 0) - (0.2 if pid in used else 0)
            if sc > best_s:
                best, best_s = pid, sc
        ok = best_s >= 0.45
        line["product_id"] = best if ok else None
        line["product_name"] = products[best]["name"] if ok else None
        line["match_score"] = round(best_s, 2)
        line["expected"] = ok and best in expected_ids
        if ok:
            used.add(best)
    parsed["missing_expected"] = [pid for pid in expected_ids if pid not in used]
    return parsed


def reference_price(line: dict, product: dict) -> float | None:
    """Prezzo della riga riportato alla quantità di riferimento del catalogo."""
    price = line["net_price"] if line.get("net_price") is not None else line["price"]
    unit, ref = product["unit"], product["default_qty"]
    if unit == "kg":
        kg = line.get("weight_kg")
        if not kg:
            m = PACK.search(line["text"])
            if m:
                v, u = num(m.group(1)), m.group(2).lower()
                kg = v / 1000 if u in ("g", "gr") else v if u == "kg" else None
        if kg:
            kg *= line.get("quantity", 1)
            return round(price / kg * ref, 2) if kg > 0 else None
        return round(price / max(line.get("quantity", 1), 1), 2) if ref == 1 else None
    if unit == "L":
        m = PACK.search(line["text"])
        if m and m.group(2).lower() in ("l", "lt", "ml", "cl"):
            v, u = num(m.group(1)), m.group(2).lower()
            liters = v / 1000 if u == "ml" else v / 100 if u == "cl" else v
            liters *= line.get("quantity", 1)
            return round(price / liters * ref, 2) if liters > 0 else None
    # pezzi / confezioni / litri senza formato: prezzo della singola confezione
    return round(price / max(line.get("quantity", 1), 1) * ref, 2)
