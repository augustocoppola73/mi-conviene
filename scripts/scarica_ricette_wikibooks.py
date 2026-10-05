"""
Scarica la raccolta di ricette di Wikibooks "Libro di cucina" (licenza CC BY-SA 4.0)
e salva solo quello che serve alla lista della spesa: titolo, porzioni, righe degli
ingredienti, categorie e link alla pagina originale (il procedimento resta su Wikibooks).

Uso:  python scripts/scarica_ricette_wikibooks.py   ->  backend/ricette/ricette_wikibooks.json
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://it.wikibooks.org/w/api.php"
PREFIX = "Libro di cucina/Ricette/"
UA = "MiConviene/0.1 (app personale per la lista della spesa)"
OUT = Path(__file__).resolve().parent.parent / "backend" / "ricette" / "ricette_wikibooks.json"


def call(params: dict) -> dict:
    params = {**params, "format": "json", "formatversion": "2"}
    data = urllib.parse.urlencode(params).encode()  # POST: con molti titoli l'URL sarebbe troppo lungo
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(API, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # rete o limite di richieste: si riprova con calma
            last = e
            time.sleep(3 + attempt * 5)
    raise RuntimeError(f"Wikibooks non risponde: {last!r}")


def all_titles() -> list[str]:
    titles, cont = [], None
    while True:
        p = {"action": "query", "list": "allpages", "apprefix": PREFIX, "aplimit": "500", "apnamespace": "0"}
        if cont:
            p["apcontinue"] = cont
        r = call(p)
        titles += [x["title"] for x in r["query"]["allpages"]]
        cont = (r.get("continue") or {}).get("apcontinue")
        if not cont:
            return titles


SECTION = re.compile(r"^==+\s*(.*?)\s*==+\s*$", re.M)


def ingredients_section(text: str) -> tuple[str, list[str]]:
    """(intestazione con le porzioni, righe degli ingredienti) dalla sezione Ingredienti."""
    heads = list(SECTION.finditer(text))
    for i, h in enumerate(heads):
        if h.group(1).lower().startswith("ingredient"):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            body = text[h.end():end]
            lines = [re.sub(r"^[*#:]+\s*", "", l).strip() for l in body.splitlines() if re.match(r"^\s*[*#]", l)]
            intro = "\n".join(l for l in body.splitlines() if not re.match(r"^\s*[*#]", l))
            return intro, [l for l in lines if l]
    return "", []


def clean_wiki(s: str) -> str:
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)        # [[link|testo]] -> testo
    s = re.sub(r"\{\{[^}]*\}\}", "", s)                               # template
    s = re.sub(r"<ref[^>]*>.*?</ref>|<[^>]+>", "", s, flags=re.S)     # ref e tag
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", s).strip(" .;,")


def servings(intro: str, text: str) -> int | None:
    for src in (intro, text[:1500]):
        m = re.search(r"(?:per|dosi per|porzioni:?|persone:?)\s*'*\s*(\d{1,2})\s*'*\s*(?:persone|porzioni|pers)?", clean_wiki(src), re.I)
        if m and 0 < int(m.group(1)) <= 30:
            return int(m.group(1))
    return None


def main() -> None:
    titles = all_titles()
    print(f"{len(titles)} pagine di ricette")
    out = []
    for i in range(0, len(titles), 20):
        batch = titles[i:i + 20]
        r = call({"action": "query", "prop": "revisions|categories", "rvprop": "content", "rvslots": "main",
                  "cllimit": "max", "titles": "|".join(batch)})
        for p in r["query"]["pages"]:
            revs = p.get("revisions") or []
            if not revs:
                continue
            text = revs[0]["slots"]["main"]["content"]
            if text.lstrip().lower().startswith("#redirect") or text.lstrip().lower().startswith("#rinvia"):
                continue
            intro, lines = ingredients_section(text)
            lines = [clean_wiki(l) for l in lines]
            lines = [l for l in lines if 2 <= len(l) <= 140]
            if len(lines) < 2:
                continue
            name = p["title"][len(PREFIX):]
            cats = [c["title"].split(":", 1)[1] for c in p.get("categories", [])]
            out.append({
                "id": "wb:" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "name": name, "servings": servings(intro, text), "ingredients": lines,
                "categories": [c for c in cats if not c.lower().startswith(("pagine", "ricette con", "libro di cucina"))][:6],
                "source": "Wikibooks",
                "url": "https://it.wikibooks.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
            })
        print(f"  {min(i + 20, len(titles))}/{len(titles)}", file=sys.stderr)
        time.sleep(0.5)  # gentili con i server di Wikimedia
    out.sort(key=lambda r: r["name"].lower())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "license": "CC BY-SA 4.0 — testi da Wikibooks, Libro di cucina (https://it.wikibooks.org/wiki/Libro_di_cucina), autori: contributori di Wikibooks",
        "recipes": out}, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"salvate {len(out)} ricette in {OUT}")


if __name__ == "__main__":
    main()
