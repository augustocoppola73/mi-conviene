"""
Database dell'app: MongoDB se raggiungibile, altrimenti MODALITÀ LOCALE.

In modalità locale i dati (salvadanaio, storico, liste, famiglia) stanno in
memoria e vengono salvati in un file JSON (backend/data/local_db.json), così
l'app funziona sul PC anche senza Docker e non perde i dati al riavvio.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

log = logging.getLogger("mi_conviene.storage")

COLLECTIONS = ("savings", "lists", "history", "families", "family_lists", "user_prices")
LOCAL_FILE = Path(os.environ.get("LOCAL_DB_FILE", Path(__file__).resolve().parent / "data" / "local_db.json"))


async def connect(mongo_url: str, db_name: str, timeout_ms: int = 1500):
    """Restituisce (db, modalità). Modalità: "mongodb" oppure "locale"."""
    if os.environ.get("STORAGE", "auto") != "local":
        try:
            client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=timeout_ms)
            await client.admin.command("ping")
            return client[db_name], "mongodb"
        except Exception as e:
            log.warning("MongoDB non raggiungibile (%s): uso la modalità locale", type(e).__name__)
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()[db_name]
    await load(db)
    return db, "locale"


async def load(db, path: Path | None = None) -> int:
    path = path or LOCAL_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return 0
    n = 0
    for name in COLLECTIONS:
        docs = data.get(name) or []
        if docs:
            await db[name].insert_many(docs)
            n += len(docs)
    return n


async def dump(db) -> dict:
    return {name: await db[name].find({}, {"_id": 0}).to_list(None) for name in COLLECTIONS}


async def save(db, path: Path | None = None) -> None:
    path = path or LOCAL_FILE
    data = await dump(db)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)  # scrittura atomica: niente file a metà se il PC si spegne


async def autosave(db, every_s: float = 5) -> None:
    """Salva su file quando qualcosa è cambiato (controllo ogni pochi secondi)."""
    last = None
    while True:
        await asyncio.sleep(every_s)
        try:
            snapshot = json.dumps(await dump(db), sort_keys=True)
            if snapshot != last:
                await save(db)
                last = snapshot
        except Exception as e:
            log.warning("Salvataggio locale non riuscito: %s", e)
