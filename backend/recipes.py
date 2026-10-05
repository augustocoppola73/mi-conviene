"""
Ricette -> lista della spesa (regole, nessuna AI).

- Raccolta libera: Wikibooks "Libro di cucina" (CC BY-SA), scaricata con scripts/scarica_ricette_wikibooks.py.
- Ricette da link (GialloZafferano, blog...): si leggono solo titolo, porzioni e ingredienti dai dati
  strutturati della pagina (schema.org Recipe), per uso personale; il procedimento resta sul sito.
- Ricette personali: scritte dall'utente.

Ogni riga ingrediente ("500 g di spaghetti", "Pecorino 50 g", "2 spicchi d'aglio", "sale q.b.")
viene interpretata, abbinata a un prodotto del catalogo, scalata per le persone e convertita nella
quantità da comprare (confezioni intere, kg arrotondati).
"""
from __future__ import annotations

import ipaddress
import json
import math
import re
import socket
from html import unescape
from pathlib import Path
from urllib.parse import urlparse

from classify import normalize, tokens

DATA = Path(__file__).resolve().parent / "ricette" / "ricette_wikibooks.json"

NUM_WORDS = {"un": 1, "uno": 1, "una": 1, "mezzo": 0.5, "mezza": 0.5, "due": 2, "tre": 3, "quattro": 4,
             "cinque": 5, "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10, "dodici": 12}
FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}

# unità -> (tipo, fattore verso g/ml/pezzi)
UNITS = {
    "kg": ("g", 1000), "chili": ("g", 1000), "chilo": ("g", 1000), "hg": ("g", 100), "etti": ("g", 100), "etto": ("g", 100),
    "g": ("g", 1), "gr": ("g", 1), "grammi": ("g", 1), "grammo": ("g", 1),
    "l": ("ml", 1000), "lt": ("ml", 1000), "litri": ("ml", 1000), "litro": ("ml", 1000),
    "dl": ("ml", 100), "cl": ("ml", 10), "ml": ("ml", 1),
    "cucchiai": ("ml", 15), "cucchiaio": ("ml", 15), "cucchiaini": ("ml", 5), "cucchiaino": ("ml", 5),
    "bicchiere": ("ml", 200), "bicchieri": ("ml", 200), "tazza": ("ml", 250), "tazze": ("ml", 250),
    "tazzina": ("ml", 50), "noce": ("g", 15), "noci": ("g", 15),
    "spicchio": ("spicchio", 1), "spicchi": ("spicchio", 1),
    "fette": ("fetta", 1), "fetta": ("fetta", 1),
    "foglie": ("foglia", 1), "foglia": ("foglia", 1), "rametto": ("foglia", 1), "rametti": ("foglia", 1),
    "ciuffo": ("foglia", 1), "mazzetto": ("foglia", 1),
    "pizzico": ("qb", 0), "presa": ("qb", 0),
    "pz": ("pz", 1), "pezzi": ("pz", 1), "confezione": ("pz", 1), "confezioni": ("pz", 1),
    "barattolo": ("pz", 1), "lattina": ("pz", 1), "scatola": ("pz", 1), "bustina": ("pz", 1), "bustine": ("pz", 1),
    "vasetto": ("pz", 1), "vasetti": ("pz", 1), "panetto": ("pz", 1), "rotolo": ("pz", 1),
}
# misure "di casa": si mostrano così come sono scritte; per le cose solide si convertono in grammi
HOUSEHOLD = {"cucchiai": ("cucchiaio", "cucchiai"), "cucchiaio": ("cucchiaio", "cucchiai"),
             "cucchiaini": ("cucchiaino", "cucchiaini"), "cucchiaino": ("cucchiaino", "cucchiaini"),
             "bicchiere": ("bicchiere", "bicchieri"), "bicchieri": ("bicchiere", "bicchieri"),
             "tazza": ("tazza", "tazze"), "tazze": ("tazza", "tazze"), "tazzina": ("tazzina", "tazzine"),
             "noce": ("noce", "noci"), "noci": ("noce", "noci"), "pizzico": ("pizzico", "pizzichi")}
LIQUIDS = ("olio", "latte", "acqua", "vino", "aceto", "succo", "panna", "brodo", "liquore", "rum", "brandy",
           "marsala", "grappa", "caffe", "birra", "sciroppo", "salsa di soia", "limoncello", "cognac", "spumante")
# grammi per ml (polveri e granuli pesano meno dell'acqua)
DENSITY = {"farin": 0.55, "fecol": 0.6, "amido": 0.6, "zuccher": 0.85, "sale": 1.2, "cacao": 0.45, "caff": 0.4,
           "riso": 0.85, "pangratt": 0.45, "parmigian": 0.4, "grana": 0.4, "pecorin": 0.4, "burro": 0.95,
           "miele": 1.4, "marmellat": 1.3, "lievit": 0.8, "semol": 0.65, "maizen": 0.6}


def _is_liquid(name: str) -> bool:
    n = normalize(name)
    return any(re.search(r"\b" + re.escape(l), n) for l in LIQUIDS)


def _density(name: str) -> float:
    n = normalize(name)
    return next((d for k, d in DENSITY.items() if re.search(r"\b" + k, n)), 0.7)


QB = re.compile(r"\b(q\.?\s?b\.?|quanto basta|a piacere|qualche|un po'?|q\.?\s?s\.?)\b", re.I)
DESCRIPTORS = {"fresco", "fresca", "freschi", "fresche", "grattugiato", "grattugiata", "tritato", "tritata", "tritati",
               "tagliato", "tagliata", "tagliati", "medio", "media", "medie", "medi", "grande", "grandi", "piccolo",
               "piccola", "piccoli", "piccole", "maturo", "maturi", "mature", "circa", "abbondante", "extra", "di", "del",
               "della", "dei", "delle", "da", "per", "il", "la", "le", "lo", "gli", "i", "e", "o", "q", "b", "qb",
               "al", "momento", "intero", "intera", "interi", "sbucciato", "sbucciati", "pulito",
               "puliti", "dop", "igp", "biologico", "bio", "secco", "secca", "secchi", "secche", "setacciata", "setacciato", "bianca", "bianco", "dolce", "tipo", "ben", "sodo", "sode"}
# ingrediente -> prodotto del catalogo (quando il nome non basta)
ALIASES = {"tuorli": "uova", "tuorlo": "uova", "albumi": "uova", "albume": "uova", "uovo": "uova", "uova": "uova",
           "olio": "olio_evo", "extravergine": "olio_evo", "spaghetti": "spaghetti", "parmigiano": "parmigiano",
           "grana": "parmigiano", "pecorino": "pecorino", "riso": "riso", "patate": "patate", "patata": "patate",
           "cipolla": "cipolle", "cipolle": "cipolle", "aglio": "aglio", "burro": "burro", "latte": "latte",
           "farina": "farina", "zucchero": "zucchero", "passata": "passata", "panna": "panna",
           # formati di pasta senza un prodotto dedicato: il più simile in catalogo
           "linguine": "spaghetti", "bucatini": "spaghetti", "vermicelli": "spaghetti", "spaghettoni": "spaghetti",
           "bavette": "spaghetti", "maccheroni": "penne", "rigatoni": "penne", "sedanini": "penne", "mezze": "penne",
           "paccheri": "penne", "ditalini": "penne", "ditali": "penne", "orecchiette": "penne", "farfalle": "fusilli",
           "tagliatelle": "pasta_uovo", "fettuccine": "pasta_uovo", "pappardelle": "pasta_uovo", "tagliolini": "pasta_uovo",
           "lasagne": "lasagne_secche", "macinato": "macinato", "carne macinata": "macinato"}
# peso medio di un pezzo (per gli ingredienti contati che in negozio si comprano a peso)
PIECE_G = {"cipoll": 150, "aglio": 5, "patat": 200, "pomodor": 120, "carot": 80, "zucchin": 200, "limon": 120,
           "mel": 180, "melanzan": 300, "peperon": 200, "aranc": 200, "banan": 180, "porr": 150, "finocch": 300,
           "sedan": 40, "cetriol": 250, "pera": 180, "pere": 180, "scalogn": 30, "peperoncin": 5, "avocad": 200}
PANTRY = ("sale", "pepe", "olio", "aceto", "acqua", "zucchero", "lievito", "bicarbonato", "origano", "noce moscata",
          "brodo", "vino")
SKIP = ("acqua",)


def _num(tok: str) -> float | None:
    tok = tok.strip().lower()
    if tok in FRACTIONS:
        return FRACTIONS[tok]
    if tok in NUM_WORDS:
        return float(NUM_WORDS[tok])
    m = re.fullmatch(r"(\d+)\s*/\s*(\d+)", tok)
    if m and int(m.group(2)):
        a, b = int(m.group(1)), int(m.group(2))
        return a / b if b <= 16 and a < b else float(a)  # "1/2" = metà; "320/350" = da 320 a 350
    try:
        return float(tok.replace(",", "."))
    except ValueError:
        return None


NUMBER = r"(\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?|[½¼¾⅓⅔]|un|uno|una|mezzo|mezza|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dodici)"
UNIT_RE = "|".join(sorted((re.escape(u) for u in UNITS), key=len, reverse=True))
QTY_FIRST = re.compile(rf"^\s*{NUMBER}(?:\s*[-–]\s*\d+)?\s*(?:({UNIT_RE})\b\.?)?\s*(?:di\s+|d['’]\s*)?(.*)$", re.I)
QTY_LAST = re.compile(rf"^(.*?)[\s:,(]+{NUMBER}\s*(?:({UNIT_RE})\b\.?)?\s*\)?\s*$", re.I)


def parse_ingredient(line: str) -> dict:
    """'500 g di spaghetti' -> {name: 'spaghetti', amount: 500, kind: 'g'}."""
    text = unescape(re.sub(r"\s+", " ", line)).strip(" -•*·.;")
    text = re.sub(r"\([^)]*\)", lambda m: " " if not re.search(r"\d", m.group(0)) else m.group(0), text)
    qb = bool(QB.search(text))
    text_noqb = QB.sub(" ", text).strip(" ,:")
    amount, kind, name = None, None, text_noqb
    m = QTY_FIRST.match(text_noqb)
    if m and m.group(3).strip():
        amount, unit, name = _num(m.group(1)), (m.group(2) or "").lower(), m.group(3)
        kind = UNITS[unit][0] if unit in UNITS else "pz"
        if unit in UNITS:
            amount = (amount or 0) * UNITS[unit][1] if UNITS[unit][1] else None
    else:
        m = QTY_LAST.match(text_noqb)
        if m and m.group(1).strip():
            name, amount, unit = m.group(1), _num(m.group(2)), (m.group(3) or "").lower()
            kind = UNITS[unit][0] if unit in UNITS else "pz"
            if unit in UNITS:
                amount = (amount or 0) * UNITS[unit][1] if UNITS[unit][1] else None
    measure = None
    if kind == "qb":
        amount, kind, qb = None, None, True
    elif m and unit in HOUSEHOLD and amount is not None:
        count = amount / UNITS[unit][1] if UNITS[unit][1] else None
        measure = {"count": count, "one": HOUSEHOLD[unit][0], "many": HOUSEHOLD[unit][1]}
        if kind == "ml" and not _is_liquid(name):   # 2 cucchiai di zucchero = grammi, non millilitri
            amount, kind = amount * _density(name), "g"
    elif kind == "ml" and amount is not None and re.search(r"\b(farin|zuccher|pangratt|cacao|semol|fecol|amido)", normalize(name)):
        amount, kind = amount * _density(name), "g"  # polveri misurate a volume
    name = re.sub(r"\([^)]*\)", " ", name)
    name = re.split(r"\s+(?:o|oppure|per|tagliat\w*|a cubetti|a fette)\s+", name, maxsplit=1)[0]
    name = re.sub(r"\s+", " ", name).strip(" ,.:;-")
    return {"text": text, "name": name, "amount": amount, "kind": kind, "qb": qb or amount is None, "measure": measure}


# ---------------------------------------------------------------- abbinamento al catalogo
def _core_words(name: str) -> list[str]:
    return [w for w in tokens(normalize(name)) if w not in DESCRIPTORS and len(w) >= 3]


def _stem(w: str) -> str:
    return re.sub(r"[aeiou]+$", "", w) or w


def _same(a: str, b: str) -> bool:
    """Stessa parola a meno di singolare/plurale (cipolla/cipolle, pomodoro/pomodori)."""
    sa, sb = _stem(a), _stem(b)
    if sa == sb:
        return True
    short, long_ = sorted((sa, sb), key=len)
    return len(short) >= 4 and long_.startswith(short) and len(long_) - len(short) <= 2


_HEADS: set[str] | None = None


def _product_words(p: dict) -> list[str]:
    return [w for w in tokens(normalize(p["name"])) if not re.fullmatch(r"\d+\w*|x\d+", w) and w not in DESCRIPTORS]


def match_product(name: str, products: dict[str, dict]) -> tuple[str | None, float]:
    global _HEADS
    if _HEADS is None:  # parole "alimento" del catalogo (pomodoro, limone, soia...)
        _HEADS = {_stem(w) for p in products.values() for w in _product_words(p) if len(w) >= 4}
    words = _core_words(name)
    if not words:
        return None, 0.0
    for w in words[:1]:
        if w in ALIASES and ALIASES[w] in products:
            return ALIASES[w], 0.95
    best, best_s = None, 0.0
    for pid, p in products.items():
        pw = _product_words(p)
        if not pw:
            continue
        hit = [w for w in words if any(_same(w, x) for x in pw)]
        if not hit:
            continue
        first = 0.25 if _same(pw[0], words[0]) else 0.0          # la parola principale coincide
        cover = len(hit) / len(words)
        back = sum(1 for x in pw if any(_same(x, w) for w in words)) / len(pw)
        s = 0.45 * cover + 0.3 * back + first
        # "salsa di pomodoro" non è "salsa di soia": l'ingrediente nomina un altro alimento
        # che il prodotto non ha, e il prodotto ha un alimento che l'ingrediente non nomina
        miss_ing = [w for w in words if w not in hit and _stem(w) in _HEADS]
        miss_prod = [x for x in pw if not any(_same(x, w) for w in words) and _stem(x) in _HEADS]
        if miss_ing and miss_prod:
            s -= 0.3
        if s > best_s:
            best, best_s = pid, s
    return (best, round(best_s, 2)) if best_s >= 0.55 else (None, round(best_s, 2))


PACK = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|l)\b|x\s*(\d+)\b", re.I)


def pack_of(product: dict) -> tuple[str, float] | None:
    """Formato della confezione dal nome: ('g', 500) / ('ml', 1000) / ('pz', 6)."""
    m = PACK.search(product["name"])
    if not m:
        return None
    if m.group(3):
        return ("pz", float(m.group(3)))
    v, u = float(m.group(1).replace(",", ".")), m.group(2).lower()
    return {"kg": ("g", v * 1000), "g": ("g", v), "gr": ("g", v), "l": ("ml", v * 1000),
            "cl": ("ml", v * 10), "ml": ("ml", v)}[u]


def _piece_grams(name: str) -> float | None:
    n = normalize(name)
    for k, g in PIECE_G.items():
        if re.search(r"\b" + k, n):
            return g
    return None


def to_buy(ing: dict, product: dict) -> tuple[float, bool]:
    """Quantità da mettere in lista (unità del prodotto) e se è una stima."""
    unit, ref = product["unit"], product["default_qty"]
    amount, kind = ing.get("amount"), ing.get("kind")
    if amount is None:
        return ref, True
    grams = None
    if kind in ("g", "ml"):
        grams = amount
    elif kind == "spicchio":
        grams = amount * 5
    elif kind in ("pz", "fetta", "foglia"):
        pg = _piece_grams(ing["name"]) or _piece_grams(product["name"])
        grams = amount * pg if pg else None
    pack = pack_of(product)
    if unit == "kg":
        if grams is None:
            return ref, True
        if pack and pack[0] == "g":  # "Riso Carnaroli 1kg": si compra il pacco intero
            packs = max(1, math.ceil(grams / pack[1] - 1e-9))
            return round(packs * pack[1] / 1000, 3), False
        return round(max(0.05, math.ceil(grams / 1000 / 0.05 - 1e-9) * 0.05), 2), kind not in ("g", "ml")
    if unit == "L":
        if grams is None:
            return ref, True
        step = pack[1] / 1000 if pack and pack[0] == "ml" else 0.25
        return round(max(step, math.ceil(grams / 1000 / step - 1e-9) * step), 3), False
    # pz / conf: confezioni intere
    if pack and pack[0] == "pz":
        n = amount if kind in ("pz", None) else 1
        return float(max(1, math.ceil(n / pack[1] - 1e-9))), False
    if pack and grams is not None:
        return float(max(1, math.ceil(grams / pack[1] - 1e-9))), False
    if kind in ("pz", None) and amount:
        return float(max(1, math.ceil(amount))), False
    return 1.0, True


def is_pantry(name: str) -> bool:
    n = normalize(name)
    return any(re.search(r"\b" + p, n) for p in PANTRY)


def plan(ingredients: list[str], recipe_servings: int | None, servings: int, products: dict[str, dict]) -> list[dict]:
    """Righe della ricetta -> proposta per la lista, scalata per le persone."""
    base = recipe_servings or 4
    factor = servings / base
    out = []
    for line in ingredients:
        ing = parse_ingredient(line)
        if not ing["name"] or any(normalize(ing["name"]).startswith(s) for s in SKIP):
            continue
        if ing["amount"] is not None:
            ing["amount"] = ing["amount"] * factor
        if ing.get("measure") and ing["measure"]["count"] is not None:
            ing["measure"]["count"] = round(ing["measure"]["count"] * factor, 2)
        pid, score = match_product(ing["name"], products)
        row = {"text": ing["text"], "name": ing["name"], "amount": round(ing["amount"], 1) if ing["amount"] else None,
               "kind": ing["kind"], "measure": ing.get("measure"), "product_id": pid, "match_score": score,
               "pantry": is_pantry(ing["name"]) or ing["qb"]}
        if pid:
            p = products[pid]
            qty, approx = to_buy(ing, p)
            row.update(product_name=p["name"], unit=p["unit"], quantity=round(qty, 3), approx=approx)
        else:
            row.update(product_name=None, unit="pz", quantity=1, approx=True)
        out.append(row)
    # stesso prodotto da più righe (es. tuorli + albumi): si sommano
    merged: dict[str, dict] = {}
    result = []
    for r in out:
        k = r["product_id"]
        if k and k in merged:
            m = merged[k]
            if r["unit"] in ("kg", "L"):
                m["quantity"] = round(m["quantity"] + r["quantity"], 3)
            m["text"] += " + " + r["text"]
            m["pantry"] = m["pantry"] and r["pantry"]
            continue
        if k:
            merged[k] = r
        result.append(r)
    return result


# ---------------------------------------------------------------- raccolta Wikibooks
_COLLECTION: list[dict] | None = None
LICENSE = ""


def collection() -> list[dict]:
    global _COLLECTION, LICENSE
    if _COLLECTION is None:
        try:
            data = json.loads(DATA.read_text(encoding="utf-8"))
            _COLLECTION, LICENSE = data.get("recipes", []), data.get("license", "")
        except FileNotFoundError:
            _COLLECTION = []
    return _COLLECTION


def search(items: list[dict], q: str, limit: int = 40) -> list[dict]:
    nq = normalize(q)
    if not nq:
        return items[:limit]
    words = nq.split()
    scored = []
    for r in items:
        n = normalize(r["name"])
        ing = normalize(" ".join(r.get("ingredients", [])))
        s = 0
        if n.startswith(nq):
            s += 5
        s += sum(2 for w in words if w in n) + sum(1 for w in words if w in ing)
        if all(w in n or w in ing for w in words) and s:
            scored.append((-s, r["name"].lower(), r))
    scored.sort(key=lambda x: (x[0], x[1]))
    return [r for _, _, r in scored[:limit]]


# ---------------------------------------------------------------- ricette da link
def _safe_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("Link non valido")
    try:
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise ValueError("Link non valido")
    except socket.gaierror:
        raise ValueError("Sito non raggiungibile")
    return u.geturl()


def _yield(v) -> int | None:
    if isinstance(v, list):
        for x in v:
            n = _yield(x)
            if n:
                return n
        return None
    if isinstance(v, (int, float)):
        return int(v) if 0 < v <= 50 else None
    m = re.search(r"\d+", str(v or ""))
    return int(m.group(0)) if m and 0 < int(m.group(0)) <= 50 else None


def _find_recipe(node):
    if isinstance(node, list):
        for x in node:
            r = _find_recipe(x)
            if r:
                return r
    elif isinstance(node, dict):
        t = node.get("@type")
        if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
            return node
        for k in ("@graph", "mainEntity", "itemListElement"):
            if k in node:
                r = _find_recipe(node[k])
                if r:
                    return r
    return None


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_recipe_html(html: str, url: str) -> dict:
    """Titolo, porzioni e ingredienti dai dati strutturati della pagina (schema.org Recipe)."""
    for m in re.finditer(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except ValueError:
            continue
        r = _find_recipe(data)
        if r and r.get("recipeIngredient"):
            img = r.get("image")
            if isinstance(img, list):
                img = img[0] if img else None
            if isinstance(img, dict):
                img = img.get("url")
            return {"name": _text(str(r.get("name") or "Ricetta")), "servings": _yield(r.get("recipeYield")),
                    "ingredients": [_text(str(x)) for x in r["recipeIngredient"] if str(x).strip()],
                    "url": url, "source": urlparse(url).hostname.removeprefix("www."), "image": img}
    # microdata (itemprop="recipeIngredient" / "ingredients")
    ings = [_text(x) for x in re.findall(r'itemprop=["\'](?:recipeIngredient|ingredients)["\'][^>]*>(.*?)</', html, re.S | re.I)]
    # GialloZafferano: <dd class="gz-ingredient">...</dd>
    if not ings:
        ings = [_text(x) for x in re.findall(r'class="gz-ingredient"[^>]*>(.*?)</dd>', html, re.S | re.I)]
    ings = [i for i in ings if i]
    if not ings:
        raise ValueError("In questa pagina non trovo la lista degli ingredienti")
    title = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S | re.I) or re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    sv = re.search(r"(?:porzioni|persone|dosi per)\D{0,20}(\d{1,2})", _text(html), re.I)
    return {"name": _text(title.group(1)) if title else "Ricetta", "servings": int(sv.group(1)) if sv else None,
            "ingredients": ings, "url": url, "source": urlparse(url).hostname.removeprefix("www."), "image": None}


async def fetch_recipe(url: str) -> dict:
    import httpx
    url = _safe_url(url)
    async with httpx.AsyncClient(timeout=20, follow_redirects=True,
                                 headers={"User-Agent": "Mozilla/5.0 (MiConviene; lista della spesa personale)",
                                          "Accept-Language": "it-IT,it;q=0.9"}) as c:
        r = await c.get(url)
        if r.status_code >= 400:
            raise ValueError(f"Il sito ha risposto con un errore ({r.status_code})")
        html = r.text[:3_000_000]
    return parse_recipe_html(html, str(r.url))
