"""
Classificazione dei prodotti scritti a mano (stile Bring), senza AI.

1. Somiglianza con i nomi del catalogo (difflib + parole in comune): se il testo
   assomiglia a un prodotto esistente, lo si propone ("Intendevi ...?").
2. Categoria: parole chiave del dizionario qui sotto + parole dei nomi del catalogo,
   anche come radice (es. "mozzarelline" -> "mozzarell" -> latticini).
Tutto deterministico e ispezionabile.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Parole chiave aggiuntive per categoria (radici, minuscole, senza accenti).
KEYWORDS: dict[str, list[str]] = {
    "frutta": ["mela", "mele", "pera", "banan", "arancia", "aranc", "limon", "kiwi", "uva", "pesca", "pesche", "albicocc",
               "ciliegi", "fragol", "anguria", "melon", "ananas", "mango", "papaya", "lampon", "mirtill", "ribes", "more",
               "castagn", "noci", "nocciol", "mandorl", "pistacch", "datter", "fichi", "cachi", "melagran", "frutta", "pompelm",
               "mandarin", "clementin", "cocco", "lime", "susin", "prugn", "avocado"],
    "verdura": ["pomodor", "insalat", "lattug", "zucchin", "melanzan", "peperon", "patat", "carot", "cipoll", "aglio",
                "sedano", "finocch", "spinac", "bietol", "cavol", "broccol", "verza", "radicch", "rucola", "carciof",
                "asparag", "fagiolin", "piselli freschi", "zucca", "funghi", "porcin", "porri", "scalogn", "basilic",
                "prezzemol", "rosmarin", "salvia", "menta", "verdur", "cetriol", "ravanell", "valerian", "songino", "cicoria",
                "erbett", "rapa", "rape", "germogli", "mais pannocch"],
    "carne": ["pollo", "tacchin", "manzo", "vitell", "maial", "suino", "agnell", "conigl", "anatra", "salsicc", "macinat",
              "bistecc", "fettin", "spezzatin", "arrost", "braciol", "costat", "costin", "hamburger", "polpett", "cotolett",
              "wurstel", "würstel", "scaloppin", "filetto di manzo", "carne", "petto", "cosce", "ossobuc", "lonza", "arista",
              "fegato", "trippa", "involtin", "spiedin"],
    "pesce": ["pesce", "salmon", "tonno", "merluzz", "nasell", "baccal", "orata", "branzin", "spigol", "sogliol", "trota",
              "sgombr", "alici", "acciugh", "sardin", "gamber", "scampi", "cozze", "vongol", "calamar", "seppi", "polpo",
              "totan", "surimi", "pesce spada", "platessa", "halibut", "frutti di mare", "bastoncini"],
    "latticini": ["latte", "yogurt", "jogurt", "panna", "burro", "mozzarell", "ricotta", "mascarpon", "uova", "uovo",
                  "kefir", "budin", "stracchin", "burrat", "fiordilatt", "crescenz", "squacquer", "skyr", "bevanda di soia",
                  "bevanda d'avena", "latte di"],
    "salumi": ["prosciutt", "salame", "salami", "mortadell", "bresaol", "speck", "pancett", "coppa", "lardo", "guanciale",
               "cotechin", "zampone", "parmigian", "grana", "pecorin", "gorgonzol", "provolon", "asiago", "fontina",
               "emmental", "taleggio", "scamorz", "caciotta", "feta", "brie", "camembert", "formagg", "sottilett",
               "philadelphia", "spalmabil", "edamer", "gouda", "montasio", "caciocaval"],
    "pane": ["pane", "panin", "baguette", "rosetta", "ciabatt", "focacc", "piadin", "tortilla", "grissin", "crackers",
             "cracker", "taralli", "fette biscott", "pancarr", "pan carr", "pan bauletto", "gallett", "pangrattat",
             "pasta sfoglia", "brise", "pizza base", "base pizza", "croissant", "cornett", "brioche", "friselle", "schiacciat"],
    "colazione": ["cereal", "muesli", "granola", "fiocchi", "caffe", "capsul", "cialde", "orzo solubil", "te ", "tè",
                  "tisan", "camomill", "infuso", "cacao", "marmellat", "confettur", "miele", "nutella", "crema spalmabile",
                  "merendin", "plumcake", "biscott", "frollin", "fette per colazione", "zucchero", "dolcificant",
                  "cornflakes", "corn flakes"],
    "dolci": ["cioccolat", "patatin", "chips", "snack", "salatin", "arachid", "pop corn", "popcorn", "caramell",
              "chewing", "gomme", "wafer", "barrett", "torta", "crostat", "pandoro", "panettone", "colomba", "gelatin",
              "liquiriz", "pralin", "ovett", "kinder", "dolci", "dolce", "tiramisu", "brownie", "muffin", "ciambell",
              "nutella b", "mars", "twix", "pringles", "taralli dolci"],
    "dispensa": ["pasta", "spaghett", "penne", "fusill", "rigaton", "maccheron", "linguin", "tagliatell", "fettuccin",
                 "lasagn", "gnocch", "tortellin", "ravioli", "riso", "risotto", "cous", "farro", "orzo", "quinoa",
                 "polenta", "farina", "lievit", "fecola", "amido", "legumi", "lenticch", "ceci", "fagiol", "piselli",
                 "mais", "pelati", "passata", "polpa di pomodoro", "concentrat", "sugo", "pesto", "ragu", "dado", "brodo",
                 "olive", "capperi", "sottacet", "sottoli", "funghi secchi", "zuppa", "minestr", "pure", "tonno in scatola",
                 "scatolam", "conserva", "pan di spagna", "zucchero a velo", "vanillina", "cioccolato fondente da cucina"],
    "condimenti": ["olio", "aceto", "sale", "pepe", "spezie", "origano", "curry", "paprika", "peperoncin", "noce moscata",
                   "cannella", "maionese", "ketchup", "senape", "salsa", "salse", "soia", "tabasco", "worcester",
                   "glassa", "rosmarino secco", "dado vegetale", "burro di arachidi"],
    "bevande": ["acqua", "frizzant", "coca", "cola", "aranciat", "gassos", "chinott", "tonica", "te freddo", "tè freddo",
                "succo", "succhi", "spremut", "vino", "rosso", "bianco", "prosecco", "spumant", "champagne", "birra",
                "liquor", "amaro", "grappa", "vodka", "gin", "rum", "whisky", "aperitiv", "spritz", "sciropp",
                "energy", "bibita", "bibite", "integrator"],
    "surgelati": ["surgelat", "congelat", "gelato", "gelati", "ghiacciol", "ghiaccio", "sofficin", "frozen", "4 salti",
                  "findus", "pizza surgelata", "patatine surgelate", "verdure surgelate"],
    "gastronomia": ["pronto", "pronta", "pronti", "gastronomia", "insalatona", "tramezzin", "sandwich", "piatto pronto",
                    "hummus", "tofu", "seitan", "tempeh", "burger veg", "vegetal", "pollo arrosto", "sushi", "poke"],
    "casa": ["detersiv", "ammorbident", "candeggin", "varechin", "sgrassator", "anticalcar", "vetri", "pavimenti",
             "lavastovigli", "lavatrice", "brillantant", "piatti", "carta igienic", "carta cucina", "scottex", "fazzolett",
             "tovaglioli", "sacchi", "sacchett", "spazzatura", "pellicol", "alluminio", "carta forno", "spugn", "guanti",
             "panno", "panni", "scopa", "mocio", "pile", "batteri", "lampadin", "insetticid", "zanzar", "deodorante per ambienti",
             "profumatore", "candela", "fiammifer", "accendin", "stuzzicadent", "piatti di plastica", "bicchieri"],
    "persona": ["shampoo", "balsamo", "bagnoschiuma", "doccia", "sapone", "dentifric", "spazzolin", "collutori", "filo interdentale",
                "deodorant", "rasoi", "lamette", "schiuma da barba", "dopobarba", "assorbent", "salvaslip", "tampon",
                "cotton", "dischetti", "crema", "lozione", "struccant", "trucco", "mascara", "rossetto", "smalto",
                "solare", "salviett", "cerott", "garze", "disinfettant", "termometro", "profumo", "lacca", "gel capelli",
                "tinta", "pettine"],
    "bambini": ["pannolin", "omogeneizz", "pappa", "latte in polvere", "latte di crescita", "biberon", "ciuccio",
                "salviette bimbi", "infanzia", "neonat", "bimbi", "bambin", "plasmon", "mellin"],
    "animali": ["cane", "cani", "gatto", "gatti", "crocchett", "lettiera", "umido per", "croccantin", "pet", "animali",
                "uccelli", "pesci rossi", "mangime", "osso per", "antiparassit"],
}

STOPWORDS = {"di", "del", "della", "dei", "degli", "delle", "da", "al", "alla", "allo", "ai", "agli", "alle", "con", "per",
             "e", "in", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "x", "g", "kg", "ml", "l", "cl", "pz",
             "conf", "confezione", "fresco", "fresca", "freschi", "fresche", "classico", "classica", "bio", "piccolo",
             "grande", "misto", "mista", "misti"}

# Parole troppo generiche per dire che due prodotti sono "lo stesso" (ok per la categoria)
GENERIC = {"surgelat", "surgelato", "surgelati", "surgelate", "pronto", "pronta", "pronti", "fette", "fetta", "scatola",
           "vetro", "busta", "pezzi", "naturale", "integrale", "light", "zero", "classic"}


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9' ]+", " ", t).strip()


def tokens(text: str) -> list[str]:
    return [w for w in normalize(text).replace("'", " ").split() if w not in STOPWORDS and not w.isdigit() and len(w) > 1]


def _stem(word: str) -> str:
    return word[:-1] if len(word) > 4 and word[-1] in "aeio" else word


class Classifier:
    def __init__(self, products: list[dict], categories: list[dict]):
        self.products = products
        self.categories = {c["id"]: c for c in categories}
        self.norm_names = {p["id"]: normalize(p["name"]) for p in products}
        # parole dei nomi del catalogo -> categoria (pesate meno delle parole chiave)
        self.catalog_words: dict[str, dict[str, int]] = {}
        for p in products:
            for w in tokens(p["name"]):
                self.catalog_words.setdefault(_stem(w), {}).setdefault(p["category_id"], 0)
                self.catalog_words[_stem(w)][p["category_id"]] += 1

    def category_of(self, text: str) -> tuple[str | None, float]:
        norm = " " + normalize(text) + " "
        scores: dict[str, float] = {}
        for cat, keys in KEYWORDS.items():
            for k in keys:
                k = normalize(k)
                if not k:
                    continue
                # radice all'inizio di una parola ("mozzarell" in "mozzarelline")
                if re.search(r"(?<![a-z])" + re.escape(k), norm):
                    scores[cat] = scores.get(cat, 0) + 2 + len(k) / 10  # parole chiave più lunghe = più specifiche
        for w in tokens(text):
            for cat, n in self.catalog_words.get(_stem(w), {}).items():
                scores[cat] = scores.get(cat, 0) + min(n, 3) * 0.5
        if not scores:
            return None, 0.0
        best = max(scores.items(), key=lambda kv: kv[1])
        return best[0], round(best[1], 2)

    def similar_products(self, text: str, limit: int = 3) -> list[dict]:
        norm = normalize(text)
        qt = {_stem(w) for w in tokens(text) if w not in GENERIC and _stem(w) not in GENERIC}
        out = []
        for p in self.products:
            name = self.norm_names[p["id"]]
            ratio = SequenceMatcher(None, norm, name).ratio()
            pt = {_stem(w) for w in tokens(p["name"]) if w not in GENERIC and _stem(w) not in GENERIC}
            overlap = len(qt & pt) / len(qt) if qt else 0
            prefix = 1.0 if any(n.startswith(q[:5]) or q.startswith(n[:5]) for q in qt for n in pt if len(q) >= 6 and len(n) >= 6 and (n.startswith(q[:6]) or q.startswith(n[:6]))) else 0
            if not overlap and not prefix and ratio < 0.85:
                continue  # nessuna parola significativa in comune: non è lo stesso prodotto
            score = max(ratio, 0.55 * overlap + 0.45 * ratio, 0.6 * prefix + 0.4 * ratio)
            if score >= 0.7:
                out.append({"product_id": p["id"], "name": p["name"], "category_id": p["category_id"], "score": round(score, 2)})
        out.sort(key=lambda x: -x["score"])
        return out[:limit]

    def classify(self, text: str) -> dict:
        cat, conf = self.category_of(text)
        similar = self.similar_products(text)
        if not cat and similar:
            cat = similar[0]["category_id"]
        cat = cat or "altro"
        c = self.categories.get(cat, {"id": "altro", "name": "Altro", "emoji": "🛒"})
        return {"text": text.strip(), "category_id": c["id"], "category_name": c["name"], "emoji": c["emoji"],
                "confidence": conf, "similar": similar,
                "exact": next((s for s in similar if s["score"] >= 0.92), None)}
