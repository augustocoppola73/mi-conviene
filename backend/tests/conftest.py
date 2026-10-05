import os
import sys
import tempfile
from pathlib import Path

# niente rete durante i test: si usano i campioni reali in tests/fixtures
os.environ["PRICES_AUTO_REFRESH"] = "0"
os.environ["LOCAL_DB_FILE"] = str(Path(tempfile.mkdtemp()) / "local_db.json")
os.environ["STORES_CACHE"] = str(Path(tempfile.mkdtemp()) / "stores_cache.json")
os.environ["PRICES_CACHE"] = str(Path(tempfile.mkdtemp()) / "prices_cache.json")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
