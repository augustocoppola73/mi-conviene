#!/usr/bin/env bash
# Applica lo schema e tutte le patch, nell'ordine, a un database (prove automatiche o un Postgres nuovo).
# Uso: PSQL="psql -h localhost -U postgres -d ci" supabase/ci/apply.sh [--stub]
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
STUB=0; [ "${1:-}" = "--stub" ] && STUB=1
# con il finto Supabase pg_net non c'è: net.http_post lo crea ci/stub.sql
run() {
  echo "→ $1"
  if [ $STUB = 1 ]; then sed '/create extension if not exists pg_net/d' "$1" | $PSQL -v ON_ERROR_STOP=1 -q > /dev/null
  else $PSQL -v ON_ERROR_STOP=1 -q -f "$1" > /dev/null; fi
}
[ $STUB = 1 ] && run ci/stub.sql
run schema.sql
for f in $(ls patch_*.sql | sort); do run "$f"; done
echo "schema e $(ls patch_*.sql | wc -l) patch applicati"
