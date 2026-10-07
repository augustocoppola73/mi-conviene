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
    "pam": re.compile(r"\b(pam|pam local|pam panorama|panorama)\b", re.I),
    "eurospin": re.compile(r"\beuro\s?spin\b", re.I),
    "aldi": re.compile(r"\baldi\b", re.I),
    "md": re.compile(r"\bmd\b", re.I),
    "penny": re.compile(r"\bpenny\b", re.I),
    "ekom": re.compile(r"\bekom\b", re.I),
    "dpiu": re.compile(r"\bd\s?pi[uù]\b", re.I),
    "tuodi": re.compile(r"\btuod[iì]\b", re.I),
    "prix": re.compile(r"\bprix\b", re.I),
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
