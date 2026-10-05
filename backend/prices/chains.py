"""Riconosce la catena di un punto vendita reale (brand OpenStreetMap o nome)."""
from __future__ import annotations

import re

# id catena dell'app -> pattern che riconoscono brand/nome del negozio
CHAIN_PATTERNS: dict[str, re.Pattern] = {
    "esselunga": re.compile(r"\besselunga\b", re.I),
    "conad": re.compile(r"\bconad\b", re.I),
    "coop": re.compile(r"\b(coop|ipercoop|incoop|novacoop)\b", re.I),
    "lidl": re.compile(r"\blidl\b", re.I),
    "carrefour": re.compile(r"\bcarrefour\b", re.I),
}


def chain_of(location: dict | None) -> str | None:
    if not location:
        return None
    for text in (location.get("osm_brand"), location.get("osm_name")):
        if not text:
            continue
        for chain, pattern in CHAIN_PATTERNS.items():
            if pattern.search(text):
                return chain
    return None
