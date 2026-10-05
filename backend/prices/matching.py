"""
Corrispondenza tra i prodotti GENERICI dell'app ("Latte intero 1L") e i prodotti
REALI con codice a barre che arrivano dalle fonti (Open Prices).

Regola: un prodotto reale corrisponde a un prodotto generico se ha almeno uno dei
`tags` tra le sue categorie Open Food Facts e nessuno degli `exclude`.
Il prezzo reale viene poi riportato alla confezione di riferimento del prodotto
generico (`ref`, in kg / L / pezzi) usando il prezzo al kg/L/pezzo.
Tutto deterministico e ispezionabile: niente AI.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class MatchRule:
    tags: tuple[str, ...]
    ref: float  # quantità della confezione di riferimento dell'app (vedi measure)
    measure: str = "kg"  # "kg", "l" oppure "unit" (pezzi, es. uova)
    exclude: tuple[str, ...] = field(default=())


# Esclusioni comuni: varianti "speciali" che costano molto di più del prodotto base.
SPECIAL = ("en:gluten-free", "en:lactose-free", "en:organic", "en:products-without-gluten",
           "en:gluten-free-pasta", "en:lactose-free-milk", "en:lactose-free-dairies")

# Parole nel nome che indicano una variante speciale (più cara): esclusa dal confronto.
SPECIAL_WORDS = re.compile(
    r"senza glutine|gluten.?free|senza lattosio|lactose|\bbio\b|biologic|organic|khorasan|kamut|"
    r"farro|proteic|protein|hi-?pro|\bvegan|integrale|spelt|piadin",
    re.I,
)

RULES: dict[str, MatchRule] = {
    # frutta e verdura (quasi sempre sfuse: si confrontano al kg)
    "mele": MatchRule(("en:apples",), 1),
    "banane": MatchRule(("en:bananas",), 1),
    "arance": MatchRule(("en:oranges",), 2, exclude=("en:orange-juices",)),
    "pere": MatchRule(("en:pears",), 1, exclude=("en:pear-jams", "en:jams")),
    "fragole": MatchRule(("en:strawberries",), 0.5, exclude=("en:jams", "en:yogurts")),
    "pomodori": MatchRule(("en:tomatoes", "en:fresh-tomatoes"), 1,
                          exclude=("en:dried-tomatoes", "en:tomato-sauces", "en:canned-tomatoes")),
    "insalata": MatchRule(("en:lettuces", "en:iceberg-lettuces"), 0.4),
    "zucchine": MatchRule(("en:zucchini", "en:courgettes"), 1),
    "patate": MatchRule(("en:potatoes",), 2, exclude=("en:crisps", "en:chips-and-fries")),
    "carote": MatchRule(("en:carrots",), 1, exclude=("en:carrot-juices",)),
    "cipolle": MatchRule(("en:onions",), 1),
    # carne e pesce
    "petto_pollo": MatchRule(("en:chicken-breasts", "en:chicken-breast-fillets"), 0.5),
    "macinato": MatchRule(("en:minced-beef", "en:ground-beef", "en:minced-meats"), 0.5),
    "salsiccia": MatchRule(("en:sausages", "en:pork-sausages"), 0.4, exclude=("en:vegetarian-sausages",)),
    "prosciutto": MatchRule(("en:cooked-hams",), 0.15),
    "bistecca": MatchRule(("en:beef-steaks", "en:steaks"), 0.4),
    "salmone": MatchRule(("en:salmon-fillets", "en:fresh-salmon"), 0.3,
                         exclude=("en:smoked-salmons", "en:salmon-analogues", "en:fish-sandwiches")),
    "tonno": MatchRule(("en:canned-tunas", "en:tunas-in-olive-oil"), 0.24),
    "merluzzo": MatchRule(("en:cod-fillets", "en:cods"), 0.4),
    # latticini e uova
    "latte": MatchRule(("en:whole-milks", "en:semi-skimmed-milks", "en:cow-milks"), 1, "l",
                       exclude=SPECIAL + ("en:plant-based-milk-alternatives", "en:milk-chocolates")),
    "uova": MatchRule(("en:chicken-eggs", "en:eggs"), 6, "unit"),
    "mozzarella": MatchRule(("en:mozzarella",), 0.125, exclude=("en:buffalo-mozzarella", "en:mozzarella-di-bufala-campana")),
    "parmigiano": MatchRule(("en:parmigiano-reggiano", "en:grana-padano"), 0.3),
    "yogurt": MatchRule(("en:plain-yogurts", "en:yogurts"), 0.5,
                        exclude=SPECIAL + ("en:fruit-yogurts", "en:greek-style-yogurts", "en:kefir", "en:kefir-yogurts",
                                           "en:yogurt-drinks", "en:dairies-high-in-proteins", "en:flavoured-yogurts")),
    "burro": MatchRule(("en:butters",), 0.25, exclude=("en:peanut-butters", "en:nut-butters")),
    # pane e forno
    "pane": MatchRule(("en:breads",), 0.5, exclude=SPECIAL + ("en:sliced-breads", "en:gluten-free-breads", "en:breadsticks", "it:taralli",
                                         "en:taralli", "en:crackers", "en:crispbreads", "en:rusks", "en:wholemeal-breads",
                                         "en:flatbreads", "en:piadinas", "it:piadina", "en:wraps", "en:pizza-bases",
                                         "en:brioches", "en:sweet-breads", "en:special-breads")),
    "fette_biscottate": MatchRule(("en:rusks",), 0.315),
    "biscotti": MatchRule(("en:shortbread-cookies", "en:biscuits"), 0.35, exclude=SPECIAL),
    "cracker": MatchRule(("en:crackers",), 0.25, exclude=("en:crackers-appetizers",) + SPECIAL),
    # dispensa
    "pasta": MatchRule(("en:dry-pastas", "en:durum-wheat-pasta", "en:penne-rigate", "en:spaghetti"), 2,
                       exclude=SPECIAL + ("en:fresh-pasta", "en:pasta-dishes", "en:prepared-lasagne")),
    "riso": MatchRule(("en:rices", "en:arborio-rices", "en:carnaroli-rices"), 1, exclude=("en:puffed-rice-cakes", "en:rice-drinks")),
    "passata": MatchRule(("en:tomato-purees", "en:tomato-passata", "en:sieved-tomatoes"), 0.7),
    "olio_evo": MatchRule(("en:extra-virgin-olive-oils",), 1, "l"),
    "farina": MatchRule(("en:wheat-flours", "en:type-00-flours"), 1),
    "zucchero": MatchRule(("en:white-sugars", "en:granulated-sugars", "en:sugars"), 1, exclude=("en:brown-sugars",)),
    "caffe": MatchRule(("en:ground-coffees",), 0.25, exclude=("en:coffee-capsules", "en:coffee-pods")),
    "legumi": MatchRule(("en:canned-chickpeas", "en:canned-legumes", "en:canned-common-beans"), 0.24),
    # bevande
    "acqua": MatchRule(("en:still-waters", "en:mineral-waters", "en:natural-mineral-waters"), 9, "l",
                       exclude=("en:sparkling-waters", "en:flavored-waters")),
    "succo": MatchRule(("en:fruit-juices", "en:orange-juices", "en:fruit-nectars"), 1, "l"),
    "birra": MatchRule(("en:beers", "en:lagers"), 0.99, "l", exclude=("en:non-alcoholic-beers",)),
    "vino": MatchRule(("en:red-wines",), 0.75, "l"),
    # surgelati
    "piselli": MatchRule(("en:frozen-peas",), 1),
    "pizza_surg": MatchRule(("en:frozen-pizzas", "en:margherita-pizzas"), 0.35),
    "gelato": MatchRule(("en:ice-cream-tubs", "en:ice-creams"), 0.5, exclude=("en:ice-cream-cones", "en:ice-cream-bars")),
    # casa e igiene: dati quasi assenti nelle fonti aperte, restano stime
}


def kg_or_l(quantity: float | None, unit: str | None, measure: str) -> float | None:
    """Converte la quantità della confezione reale nell'unità della regola."""
    if not quantity or quantity <= 0 or not unit:
        return None
    u = unit.strip().lower()
    factors = {"kg": ("kg", 1), "g": ("kg", 0.001), "mg": ("kg", 1e-6),
               "l": ("l", 1), "cl": ("l", 0.01), "ml": ("l", 0.001)}
    if u not in factors:
        return None
    base, f = factors[u]
    # 1 L ≈ 1 kg per i liquidi alimentari: accettiamo la conversione incrociata
    if measure in ("kg", "l") and base in ("kg", "l"):
        return quantity * f
    return None


_COUNT = re.compile(r"(\d{1,2})\s*(?:uova|pz|pezzi|x)\b|\bx\s*(\d{1,2})\b", re.I)


def unit_count(product: dict) -> float | None:
    """Numero di pezzi in confezione (per le uova), letto dal nome o dalla quantità."""
    q = product.get("product_quantity")
    if q and (product.get("product_quantity_unit") in (None, "", "pz", "unit")) and 1 <= q <= 30:
        return float(q)
    for text in (product.get("quantity"), product.get("product_name")):
        if text:
            m = _COUNT.search(str(text))
            if m:
                return float(m.group(1) or m.group(2))
    return None


def is_special(name: str | None) -> bool:
    return bool(name and SPECIAL_WORDS.search(name))


def match_product(categories: list[str] | None) -> str | None:
    """Restituisce l'id del prodotto generico che corrisponde, oppure None.
    Se più regole corrispondono vince quella con il tag più specifico (più in fondo
    nella gerarchia delle categorie Open Food Facts)."""
    if not categories:
        return None
    categories = [c.lower() for c in categories]
    cats = set(categories)
    best: tuple[int, str] | None = None
    for pid, rule in RULES.items():
        if any(t in cats for t in rule.exclude):
            continue
        positions = [categories.index(t) for t in rule.tags if t in cats]
        if positions:
            depth = max(positions)
            if best is None or depth > best[0]:
                best = (depth, pid)
    return best[1] if best else None


def reference_price(price: float, product: dict | None, category_tag: str | None,
                    price_per: str | None, rule: MatchRule) -> float | None:
    """Prezzo riportato alla confezione di riferimento dell'app."""
    # prezzo sfuso a categoria (es. mele a 2,10 €/kg)
    if category_tag and price_per:
        if price_per.upper() == "KILOGRAM" and rule.measure in ("kg", "l"):
            return price * rule.ref
        if price_per.upper() == "UNIT" and rule.measure == "unit":
            return price * rule.ref
        return None
    if not product:
        return None
    if rule.measure == "unit":
        n = unit_count(product)
        return price / n * rule.ref if n else None
    amount = kg_or_l(product.get("product_quantity"), product.get("product_quantity_unit"), rule.measure)
    if not amount:
        return None
    # scarta confezioni troppo diverse (es. 5 g o 20 kg): il prezzo al kg non sarebbe confrontabile
    ratio = amount / rule.ref
    if ratio < 0.1 or ratio > 10:
        return None
    return price / amount * rule.ref
