# Pago Meno — Documentazione tecnica completa

> "Non devi spendere meno a tutti i costi. Devi spendere meglio."
> App mobile che ottimizza la spesa familiare: l'utente scrive la lista, l'app dice **dove conviene andare** bilanciando prezzo + viaggio + carburante + tempo.

Documento di handoff: contiene **come è fatta l'app**, **perché** ogni scelta, e **come continuare**.

---

## 1. Stack tecnologico

| Livello | Tecnologia | Note |
|---|---|---|
| Frontend | Expo SDK 57, React Native 0.86, React 19 | file-based routing con `expo-router` |
| Navigazione | `expo-router` (Tabs) | 4 tab in basso |
| Stato | React Context + AsyncStorage | nessun Redux/Zustand, non serviva |
| UI | StyleSheet nativo, `@gorhom/bottom-sheet`, `@react-native-vector-icons/ionicons` | nessun CSS, nessuna libreria web |
| Backend | FastAPI (Python) + `motor` (MongoDB async) | tutte le route con prefisso `/api` |
| DB | MongoDB | solo dati transazionali utente |
| Logica | **Deterministica** (regole + formule) | ZERO LLM/AI, per scelta di prodotto |

Dipendenze chiave già installate: vedi `/app/frontend/package.json` e `/app/backend/requirements.txt`.
Installare SEMPRE con `yarn expo install <pkg>` (frontend) e `pip install <pkg> && pip freeze > requirements.txt` (backend).

---

## 2. Struttura dei file

```
/app
├── backend/
│   ├── server.py              ← TUTTO il backend (618 righe): dati seed + motore + API
│   ├── requirements.txt
│   └── tests/
│       ├── test_margine_api.py   (test MVP 1)
│       └── test_mvp2_api.py      (test MVP 2)
│
├── frontend/
│   ├── app/                   ← SOLO schermate navigabili (expo-router)
│   │   ├── _layout.tsx        root: StoreProvider + GestureHandler + SafeArea
│   │   ├── index.tsx          redirect → /(tabs)
│   │   └── (tabs)/
│   │       ├── _layout.tsx    definizione dei 4 tab + icone
│   │       ├── index.tsx      Tab "Lista"       (683 righe)
│   │       ├── risultati.tsx  Tab "Risultati"   (386 righe)
│   │       ├── salvadanaio.tsx Tab "Salvadanaio"(183 righe)
│   │       └── profilo.tsx    Tab "Profilo"     (351 righe)
│   ├── src/                   ← codice NON navigabile
│   │   ├── api.ts             client HTTP + tutti i tipi TypeScript
│   │   ├── store.tsx          Context globale (lista + preferenze + ultimo risultato)
│   │   ├── user.ts            user_id locale anonimo (SecureStore / localStorage su web)
│   │   ├── theme.ts           palette light+dark, spacing, radius, makeStyles()
│   │   └── components/error-boundary.tsx
│   ├── app.json               nome app, slug, permessi
│   └── .env                   ⚠️ NON MODIFICARE (EXPO_PACKAGER_*, EXPO_PUBLIC_BACKEND_URL)
│
└── memory/
    ├── PRD.md                 requisiti di prodotto
    └── test_credentials.md
```

**Regola d'oro di expo-router**: ogni file dentro `app/` diventa una rotta. Componenti, hook e utility vanno in `src/`, mai in `app/`.

---

## 3. Autenticazione: non esiste (per scelta)

Nessuna registrazione, nessuna password, nessun login.
Al primo avvio `src/user.ts` genera un UUID v4 e lo salva in `expo-secure-store` (su web: `localStorage`). Quell'`user_id` viene passato a tutte le API.

```ts
export async function getUserId(): Promise<string> {
  let id = await get("margine_user_id");
  if (!id) { id = uuid(); await set("margine_user_id", id); }
  return id;
}
```

Conseguenza: **i dati vivono sul dispositivo + su Mongo legati all'user_id**. Se l'utente cancella l'app, perde lo storico. Per il sync multi-device serve auth vera (vedi §9).

---

## 4. Dati seed (il "finto catalogo prezzi")

Non esistono API pubbliche gratuite con i prezzi reali dei supermercati italiani. Per questo il catalogo è **generato in memoria all'avvio del backend**, in modo realistico e deterministico.

### 4.1 I blocchi di dati (in `server.py`)

| Costante | Contenuto |
|---|---|
| `CATEGORIES` | 10 categorie con emoji (Frutta 🍎, Verdura 🥬, Carne 🥩, …) |
| `PRODUCTS` | 48 prodotti come tuple `(id, nome, categoria, qty_default, unità)` |
| `STORES` | 5 catene (Conad, Esselunga, Coop, Lidl, Carrefour) con `lat/lng`, `distance_km`, `price_level` |
| `BASE_PRICES` | prezzo di riferimento € per la qty di default (baseline Conad) |
| `PROMOTIONS` | dict `(store_id, product_id) → fattore sconto` (es. `0.78` = −22%) |
| `LOYALTY_PROMOTIONS` | set di promo che richiedono la carta fedeltà |
| `STORE_CONFIDENCE` | affidabilità dato per catena: `green` / `yellow` / `red` |

### 4.2 Come nasce il prezzo finale

```python
base        = BASE_PRICES[prodotto] * store["price_level"]   # posizionamento catena
promo_price = base * PROMOTIONS[(store, prodotto)]           # se esiste promo
final_price = promo_price or base
```

`price_level` è il moltiplicatore che rende realistico il posizionamento: Lidl `0.88` (discount), Esselunga `0.94`, Conad `1.00` (baseline), Coop `1.03`, Carrefour `1.07`.

Tutto questo finisce in `CATALOG[store_id][product_id] = {normal_price, promo_price, final_price, loyalty_required, confidence, retrieved_at}`, costruito una volta sola da `build_catalog()` all'avvio.

**Per passare ai prezzi reali** basta sostituire `build_catalog()` con una funzione che legge da Mongo/scraper/API: il resto del motore non cambia di una riga. È il punto di estensione principale.

---

## 5. Il motore di ottimizzazione (il cuore dell'app)

`POST /api/optimize` — tutto deterministico, nessuna AI.

### 5.1 Costanti economiche

```python
FUEL_COST_PER_KM = 0.26   # €/km andata+ritorno (7 l/100km @ 1,85 €/l)
TRANSPORT_SPEED  = {"walk": 5, "bike": 15, "car": 40, "transit": 25}  # km/h
TIME_VALUE       = 8.0    # € per ora percepita
```

### 5.2 I tre passi

**Passo 1 — Scontrino virtuale** (`compute_virtual_receipt`)
Per ogni supermercato, per ogni articolo della lista: il prezzo viene **scalato sulla quantità** rispetto alla qty di default.

```python
ratio      = it.quantity / default_qty      # 2 kg di pasta su default 2 kg → 1.0
line_price = price_info["final_price"] * ratio
```
Output: righe dettagliate + `total`, `normal_total`, `savings_vs_normal`.

**Passo 2 — Costo del viaggio** (`compute_travel`)
```python
time_min  = (distance_km * 2 / speed) * 60        # andata e ritorno
fuel_cost = distance_km * 2 * 0.26  se auto else 0
time_cost = (time_min / 60) * 8.0                 # valore percepito del tempo
```

**Passo 3 — Punteggio composito** (più basso = meglio)
```python
total_cost = receipt_total + fuel_cost
score      = total_cost + 0.5 * time_cost
```
Il tempo pesa **metà** del suo valore nominale: conta, ma non deve dominare sul prezzo. È il parametro di tuning più importante dell'app.

### 5.3 La regola anti-fatica (la più importante del prodotto)

Il supermercato più economico **non viene consigliato automaticamente**. Se l'utente ha un supermercato abituale e il risparmio nel cambiare è sotto la sua `min_savings_threshold` (default €3), l'app consiglia di **restare dov'è**:

```python
delta = habitual.total_cost - cheapest.total_cost
if delta < min_savings_threshold:
    recommended = habitual
    reasoning = "Resta nel tuo supermercato abituale… risparmieresti solo €X, sotto la tua soglia."
```

Questa è la traduzione in codice della filosofia "spendere meglio, non spendere meno a tutti i costi". **Non toglierla.**

### 5.4 Risposta

```json
{
  "ranked": [ /* 5 store ordinati per score, ognuno con receipt completo */ ],
  "recommended": { /* lo store consigliato */ },
  "reasoning": "frase in italiano che spiega la scelta",
  "budget_status": { "budget": 100, "spend": 87.4, "diff": 12.6, "status": "ok" },
  "potential_savings": 4.35
}
```

---

## 6. Tutte le API (`prefisso /api`)

### Catalogo
| Metodo | Rotta | Descrizione |
|---|---|---|
| GET | `/api/bootstrap` | categorie + prodotti + store. Chiamata una volta all'avvio |
| GET | `/api/` | health check |

### Ottimizzazione
| Metodo | Rotta | Body / Note |
|---|---|---|
| POST | `/api/optimize` | `{user_id, items[], budget?, transport, habitual_store_id?, min_savings_threshold}` → ranking |

### Salvadanaio
| Metodo | Rotta | Descrizione |
|---|---|---|
| POST | `/api/savings` | registra un risparmio (stimato o verificato) |
| GET | `/api/savings/{user_id}` | storico + `total_estimated` + `total_verified` |
| DELETE | `/api/savings/{entry_id}` | elimina voce |

### Liste salvate
| Metodo | Rotta |
|---|---|
| POST | `/api/lists` |
| GET | `/api/lists/{user_id}` |
| DELETE | `/api/lists/{list_id}` |

### Offerte del giorno (MVP 2)
| Metodo | Rotta | Descrizione |
|---|---|---|
| GET | `/api/offers` | tutte le promo con `discount_pct`, prezzo barrato, flag `loyalty_required`, ordinate per sconto decrescente |

### Lista abituale appresa (MVP 2)
| Metodo | Rotta | Descrizione |
|---|---|---|
| POST | `/api/history` | registra una spesa confermata |
| GET | `/api/habitual/{user_id}` | prodotti presenti in ≥30% delle ultime 20 spese (min 2 occorrenze), con quantità media |

Algoritmo (nessuna AI, solo conteggio frequenze):
```python
threshold = max(2, int(len(shops) * 0.3))
frequent  = [p for p in aggregato if p.count >= threshold]
# quantità suggerita = media delle quantità comprate
```

### Condivisione familiare (MVP 2)
| Metodo | Rotta | Descrizione |
|---|---|---|
| POST | `/api/family/create` | crea codice 6 caratteri A-Z0-9 (idempotente: se l'utente è già in una famiglia la restituisce) |
| POST | `/api/family/join` | entra con codice (404 se inesistente) |
| POST | `/api/family/leave` | esce; famiglie vuote vengono eliminate |
| GET | `/api/family/by-user/{user_id}` | famiglia dell'utente o `{}` |
| POST | `/api/family/list` | push della lista condivisa (upsert su `code`) |
| GET | `/api/family/list/{code}` | pull della lista condivisa |

**Il sync è pull-based**: la lista condivisa si aggiorna quando si apre la schermata, non in tempo reale. Per il realtime servono WebSocket o push notification.

---

## 7. Collezioni MongoDB

```
savings       { id, user_id, store_id, store_name, amount, verified, note, created_at }
lists         { id, user_id, name, items[], created_at }
history       { id, user_id, items[], created_at }
families      { code, created_at, members: [{user_id, display_name}] }
family_lists  { code, items[], updated_by, updated_at }
```

Nessuna collezione per catalogo/prezzi: sono in memoria (vedi §4).
Convenzione importante: si usa sempre un campo `id` (UUID string), **mai** `_id` di Mongo nelle risposte (`{"_id": 0}` in ogni projection) — perché `ObjectId` non è serializzabile in JSON.

---

## 8. Frontend — come funziona ogni schermata

### 8.1 Stato globale (`src/store.tsx`)

Un solo Context con:
- `items: ListItem[]` — la lista corrente, persistita in AsyncStorage (`margine_list`)
- `prefs` — `{transport, habitualStoreId, budget, minSavingsThreshold}`, persistite (`margine_prefs`)
- `lastResult` — ultima risposta di `/optimize`, solo in memoria (serve al tab Risultati)
- azioni: `addItem` (somma la quantità se il prodotto c'è già), `removeItem`, `updateQty`, `clearItems`, `setPrefs`

Pattern di idratazione: flag `hydrated` per non scrivere su AsyncStorage prima di aver letto (altrimenti i default sovrascrivono i dati salvati). **Attenzione a questo dettaglio se modifichi lo store.**

### 8.2 Tab "Lista" (`app/(tabs)/index.tsx`)

1. `GET /api/bootstrap` all'avvio
2. Strip orizzontale "🔥 Offerte di oggi" (ScrollView orizzontale) — tap = aggiunge il prodotto in lista
3. Pulsante "Carica la mia spesa abituale" → `GET /api/habitual/{user_id}`
4. Griglia categorie con emoji → tap apre un **bottom sheet** (`@gorhom/bottom-sheet`) con i prodotti di quella categoria
5. Lista articoli con stepper +/− e swipe/tap per rimuovere
6. CTA "Trova dove conviene" → `POST /api/optimize`, salva in `lastResult` e naviga a `/risultati`

### 8.3 Tab "Risultati" (`app/(tabs)/risultati.tsx`)

- Card del consigliato in evidenza + `reasoning` in italiano
- Badge budget (verde se dentro, rosso se sopra)
- Classifica degli altri store: prezzo spesa, carburante, km, minuti, costo totale
- Ogni card si espande sullo **scontrino virtuale** con riga per riga, prezzo barrato sulle promo e badge di affidabilità 🟢 green / 🟡 yellow / 🔴 red
- "Confermo questa spesa" → `POST /api/history` (alimenta la lista abituale) + `POST /api/savings` (alimenta il Salvadanaio)

### 8.4 Tab "Salvadanaio" (`app/(tabs)/salvadanaio.tsx`)

`GET /api/savings/{user_id}`: totale stimato, totale verificato, elenco voci con store e data, swipe per eliminare. È il KPI visibile dell'app: "quanto ho risparmiato questo mese".

### 8.5 Tab "Profilo" (`app/(tabs)/profilo.tsx`)

- Budget (input numerico)
- Mezzo di trasporto (piedi / bici / auto / mezzi) — cambia `TRANSPORT_SPEED` e `fuel_cost` nel motore
- Supermercato abituale (picker sui 5 store)
- Soglia minima di convenienza (€) — alimenta la regola anti-fatica
- Sezione **Famiglia**: crea codice o entra con codice (modale), elenco membri, "Esci dalla famiglia"

### 8.6 Tema (`src/theme.ts`)

Palette "Moss Green", light + dark. **Regola: nessun colore hardcoded nei componenti.** Si usa sempre:

```ts
const { colors } = useTheme();
// oppure
const useStyles = makeStyles((c) => ({ card: { backgroundColor: c.surfaceSecondary } }));
```

Spacing su griglia 8pt: `spacing.xs/sm/md/lg/xl/xxl` — raggi: `radius.sm/md/lg/pill`.

---

## 9. Comandi utili

```bash
# riavvio servizi
sudo supervisorctl restart backend
sudo supervisorctl restart expo
sudo supervisorctl status

# log
tail -n 100 /var/log/supervisor/backend.*.log
tail -n 100 /var/log/supervisor/expo.*.log

# test backend
cd /app/backend && python -m pytest tests/ -v

# lint frontend
cd /app/frontend && yarn lint
```

File da **non toccare mai**: `frontend/metro.config.js`, il campo `main` di `package.json`, `EXPO_PACKAGER_PROXY_URL` / `EXPO_PACKAGER_HOSTNAME` in `frontend/.env`, `MONGO_URL` in `backend/.env`.

---

## 10. Debito tecnico noto

> **Aggiornamento ricostruzione (ott 2026):** i punti 1, 2 e 3 sono risolti nel nuovo `server.py` (404 sulle DELETE, confidence letta da `STORE_CONFIDENCE`, prodotti sconosciuti restituiti in `receipt.unknown_products`). I test sono in `backend/tests/test_api.py`.

1. `DELETE /api/savings/{id}` e `DELETE /api/lists/{id}` rispondono `200 {"deleted": 0}` anche quando l'elemento non esiste → sarebbe più corretto un `404`.
2. In `/api/optimize` il campo `confidence` dello store viene letto da `req.items[0].product_id`: se il primo articolo avesse un `product_id` sconosciuto andrebbe in `KeyError`. Da rendere robusto (`.get()` + fallback) oppure prendere la confidence da `STORE_CONFIDENCE[store_id]`.
3. Articoli con `product_id` inesistente vengono silenziosamente ignorati in `compute_virtual_receipt` (`continue`): nessun avviso all'utente.
4. `server.py` è un unico file da 618 righe. Se cresce, dividerlo in `backend/routes/` + `backend/models/` + `backend/engine/`.
5. Chiavi di storage ancora con il vecchio prefisso `margine_*` (`margine_prefs`, `margine_list`, `margine_user_id`). Rinominarle **cancellerebbe i dati degli utenti esistenti**: se le cambi serve una migrazione.

---

## 11. Roadmap / come continuare

**Priorità alta**
- **Prezzi reali**: sostituire `build_catalog()` con una sorgente vera (scraping volantini, API partner). Mantenere la struttura `CATALOG[store][product]` e il campo `confidence`/`retrieved_at` così il resto non cambia.
- **Geolocalizzazione reale**: oggi `distance_km` è un valore fisso per store (zona Milano). Con `expo-location` + formula di Haversine sulle `lat/lng` già presenti in `STORES` il calcolo diventa reale. Ricorda di gestire i permessi in modo contestuale (benefit prima del popup nativo, pulsante "Apri impostazioni" se negato).

**Priorità media**
- Sync realtime della lista familiare (WebSocket o push notification).
- Multi-supermercato: "compra X da Lidl e Y da Esselunga" se il risparmio supera il costo del secondo viaggio.
- Sostituzioni intelligenti (marca equivalente più economica) — sempre a regole.
- Verifica dello scontrino reale (OCR foto) per convertire i risparmi da "stimati" a "verificati".

**Da non fare senza richiesta esplicita**
- LLM/AI per i consigli: requisito di prodotto, tutto deve restare deterministico e spiegabile.
- Autenticazione con account: rompe la promessa "zero attrito" (valutarla solo per il sync multi-device).

---

## 12. Riferimenti rapidi

| Cosa vuoi cambiare | File / punto |
|---|---|
| Aggiungere prodotti o categorie | `server.py` → `PRODUCTS`, `CATEGORIES`, `BASE_PRICES` |
| Aggiungere un supermercato | `server.py` → `STORES`, `STORE_CONFIDENCE` (il catalogo si rigenera) |
| Cambiare promozioni | `server.py` → `PROMOTIONS`, `LOYALTY_PROMOTIONS` |
| Tarare il peso del tempo | `server.py` → `score = total_cost + 0.5 * time_cost` |
| Costo carburante / velocità | `server.py` → `FUEL_COST_PER_KM`, `TRANSPORT_SPEED`, `TIME_VALUE` |
| Regola anti-cambio-market | `server.py` → funzione `optimize`, blocco `min_savings_threshold` |
| Colori e spaziature | `frontend/src/theme.ts` |
| Nuova chiamata API | `frontend/src/api.ts` (oggetto `api` + tipi) |
| Nuova schermata | nuovo file in `frontend/app/` (diventa automaticamente una rotta) |
| Nuovo tab | `frontend/app/(tabs)/_layout.tsx` + file omonimo nella cartella |
