# Mi Conviene · Pago Meno

> "Non devi spendere meno a tutti i costi. Devi spendere meglio."

App mobile che ottimizza la spesa familiare: scrivi la lista e l'app ti dice **dove conviene andare**, bilanciando prezzo, viaggio, carburante e tempo. Logica 100% deterministica, nessuna AI.

Documentazione tecnica completa: [`docs/DOCUMENTAZIONE.md`](docs/DOCUMENTAZIONE.md)

## Struttura

```
backend/    FastAPI + MongoDB: catalogo simulato, motore di ottimizzazione, API /api
frontend/   App Expo / React Native (4 tab)
docs/       Documentazione di prodotto e tecnica
```

## Usarla dal PC (web app)

Doppio clic su **`Avvia Pago Meno.cmd`**: la prima volta prepara tutto (qualche minuto), poi apre l'app nel browser su http://localhost:8001. Per fermarla basta chiudere la finestra nera.

Non serve Docker: se MongoDB non è attivo i dati (salvadanaio, storico, famiglia) vengono salvati in `backend/data/local_db.json`.

## Avvio rapido (Windows / PowerShell)

```powershell
# 1. Database
docker compose up -d

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn server:app --reload --port 8001
```

API su http://localhost:8001/api, documentazione interattiva su http://localhost:8001/docs

```powershell
# 3. App (in un secondo terminale)
cd frontend
npm install
npx expo start   # w = apri nel browser, oppure QR con Expo Go
```

## Prezzi reali

Il backend parte dalle **stime** (catalogo simulato) e le sostituisce con prezzi **reali** dove disponibili:

- **Open Prices** (Open Food Facts, licenza ODbL): prezzi con prova (scontrino/cartellino) nel raggio di `PRICE_RADIUS_KM` da `PRICE_LAT/PRICE_LON`. Il matching prodotto generico ↔ prodotto reale è in `backend/prices/matching.py` (regole per categoria, esclusione delle varianti speciali, prezzo riportato alla confezione di riferimento).
- **MIMIT carburanti** (open data): prezzo mediano di oggi dei distributori entro 10 km, usato nel costo del viaggio.

Aggiornamento automatico ogni 12 ore, con cache in `backend/data/` (non versionata). Stato e copertura: `GET /api/prices/status`; aggiornamento manuale: `POST /api/prices/refresh`. Configurazione in `backend/.env` (vedi `.env.example`).

## Test

```powershell
cd backend
python -m pytest -v
```

I test usano un MongoDB in memoria: non serve Docker.

## Stato

- [x] Backend MVP 1: catalogo, motore di ottimizzazione, regola anti-fatica, salvadanaio, liste
- [x] Backend MVP 2: offerte del giorno, spesa abituale appresa, condivisione familiare
- [x] Frontend Expo: tab Lista, Risultati, Salvadanaio, Profilo (tema chiaro/scuro)
- [x] Prezzi reali (prima fonte): Open Prices + carburanti MIMIT
- [ ] Più copertura prezzi (fornitore dati, scontrini degli utenti)
- [ ] Geolocalizzazione e punti vendita reali
