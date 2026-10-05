# Mi Conviene · app Expo

App React Native (Expo SDK 57, expo-router) con 4 tab: Lista, Risultati, Salvadanaio, Profilo.

```powershell
npm install
npx expo start        # poi: w = browser, oppure scansiona il QR con Expo Go
```

Il backend deve girare su http://localhost:8001 (vedi README principale).
Da telefono fisico l'app usa in automatico l'IP del PC; se serve, imposta
`EXPO_PUBLIC_BACKEND_URL` in un file `.env` (vedi `.env.example`).

## Struttura

```
src/app/            solo schermate (ogni file è una rotta)
  (tabs)/index.tsx      Lista
  (tabs)/risultati.tsx  Risultati e scontrino virtuale
  (tabs)/salvadanaio.tsx
  (tabs)/profilo.tsx    preferenze e famiglia
src/api.ts          client HTTP e tipi
src/store.tsx       stato globale (lista, preferenze, ultimo risultato)
src/theme.ts        palette Moss Green chiaro/scuro, spacing, makeStyles
src/components/ui.tsx  componenti condivisi
```

Controlli prima di ogni commit: `npx tsc --noEmit`
