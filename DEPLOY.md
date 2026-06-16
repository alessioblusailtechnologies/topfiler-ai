# Deploy su Render

topFiler3 è composto da **due servizi** (definiti in `render.yaml`):

| Servizio | Cartella | Cos'è | Health |
|---|---|---|---|
| `topfiler3-backend` | `.` | Server Hono + agente Mastra (chat, ricerca, export) | `/api/health` |
| `topfiler3-web` | `web` | Client Next.js (assistente + ricerca) | — |

Il database/Storage **Supabase è già popolato** (documenti, chunk, file): il deploy non rifà l'ingestion, riusa lo stesso progetto Supabase.

## 1. Push del repo

Questo progetto è un repo git a sé stante. Crea un repo vuoto su GitHub e poi:

```bash
git remote add origin https://github.com/<tuo-utente>/<tuo-repo>.git
git push -u origin main
```

## 2. Crea il Blueprint su Render

1. Render → **New** → **Blueprint** → collega il repo GitHub.
2. Render legge `render.yaml` e propone i due servizi. Conferma.

## 3. Imposta i segreti (variabili `sync: false`)

Al primo deploy Render chiede i valori mancanti. Usa gli stessi del `.env` locale.

**topfiler3-backend**
- `ANTHROPIC_API_KEY`
- `MISTRAL_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

**topfiler3-web**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (la service role key Supabase)
- `TOPFILER_BACKEND_URL` → iniettato in automatico dal backend (`fromService`). Se Render fornisce solo l'host, lo schema `https://` viene aggiunto dal codice. In caso di problemi, impostalo a mano: `https://topfiler3-backend.onrender.com`.

Le variabili non segrete (modelli, `SUPABASE_STORAGE_BUCKET`, dimensioni embedding) sono già nel `render.yaml`.

## 4. Deploy

Render builda e avvia entrambi. Il backend espone `/api/health`; il web è l'app pubblica.

## Note

- **Piano free**: i servizi vanno in sleep dopo inattività e hanno un cold start di qualche secondo (il backend transpila con `tsx` all'avvio).
- **Niente Oracle in produzione**: l'ingestion da Oracle è solo per popolare i dati offline; il runtime usa esclusivamente Supabase. Le variabili `ORACLE_*` / `READONLY_DATABASE_URL` non servono al deploy.
- **Memory Mastra** (`MASTRA_DATABASE_URL`) è opzionale: lo streaming invia già l'intera history, e la persistenza delle chat è gestita dal web direttamente su Supabase.
- I file generati dall'assistente (Excel/CSV/PDF) finiscono su Storage sotto `generati/` e si scaricano via `/api/file`.
