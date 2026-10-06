# Prova completa della versione online (senza toccare Supabase vero)

Serve un Postgres locale con `supabase/schema.sql` (più ruoli `anon`, `authenticated`, `authenticator`
e uno schema `auth` finto con `auth.uid()` che legge `request.jwt.claims`), PostgREST sulla porta 3099
con `jwt-secret = "e2e-secret-e2e-secret-e2e-secret-e2e-secret"`, poi:

    EXPO_PUBLIC_MODE=cloud EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_SUPABASE_URL=http://localhost:8790 EXPO_PUBLIC_SUPABASE_KEY=test \
      npx expo export -p web --clear --output-dir /tmp/dist-e2e
    node e2e/gateway.mjs /tmp/dist-e2e &      # app + /rest/v1 → PostgREST + /auth/v1 finto
    node e2e/e2e.mjs /tmp                     # due utenti: spesa, salvadanaio, ricette, famiglia, spesa in corso, sicurezza

OpenStreetMap e Nominatim sono simulati con i dati di `src/engine/__golden__/places_golden.json`.
