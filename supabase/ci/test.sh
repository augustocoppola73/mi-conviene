#!/usr/bin/env bash
# Lancia le prove SQL di supabase/tests: ognuna finisce con «TUTTE LE PROVE OK ✓» o «PROVE FALLITE: n».
set -uo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
fail=0
[ "${1:-}" = "--fixtures" ] && { $PSQL -v ON_ERROR_STOP=1 -q -f ci/fixtures.sql > /dev/null || exit 1; }
for f in tests/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -At -f "$f" 2>&1)
  if echo "$out" | grep -q 'TUTTE LE PROVE OK'; then echo "✓ $f"; else echo "✗ $f"; echo "$out" | grep -v '^✓' | tail -20; fail=1; fi
done
exit $fail
