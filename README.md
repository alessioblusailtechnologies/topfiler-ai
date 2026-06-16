# topFiler3

Assistente conversazionale che risponde a domande e recupera documenti da un corpus eterogeneo (contratti di lavoro, attestati, idoneità mediche, richiami, fatture, ordini, offerte, manuali, materiale pubblicitario). I documenti sorgente risiedono come BLOB in un **database Oracle esterno (sola lettura)**; tutta la persistenza del sistema (metadati, chunk, vettori, file) è su **Supabase**.

- **Agente conversazionale**: Mastra AI (`Agent` + tool con `createTool`), modello via model router (`anthropic/<id>`).
- **Chiamate LLM di servizio** (classificazione, estrazione, generazione SQL): SDK Anthropic ufficiale, diretto (tool use forzato + `cache_control`).
- **Ingestion**: progetto Node semplice, funzioni sequenziali pure + runner CLI (no workflow Mastra).
- **Embedding**: Mistral `mistral-embed` (1024 dim) via REST diretta, dietro `EmbeddingProvider`.
- **Storage/DB**: Supabase Postgres con `pgvector`, `tsvector` (full-text italiano), JSONB, Supabase Storage.

## Architettura

```
                    ┌─────────────────────── INGESTION (CLI / POST /api/ingest) ───────────────────────┐
 Oracle (RO)  ──►   read BLOB ─► extract text ─► classify ─► upload Storage ─► extract metadata ─►
                    sanity rules ─► normalize employee ─► embed (Mistral) ─► insert documenti+chunks
                    └──────────────────────────────────────────────────────────────────────────────────┘
                              │ Anthropic SDK (tool use forzato)        │ Mistral REST (embed)
                              ▼                                          ▼
              Supabase: topfiler_final_ai_documenti (jsonb)  +  topfiler_final_ai_doc_chunks (vector + tsvector)

 Utente ─► POST /api/chat ─► Mastra Agent (anthropic/<id>) ─► tools:
     • text_to_sql   → genera SELECT (Anthropic+cache) ─► SqlGuard ─► RPC run_select (supabase-js)
     • hybrid_search → Mistral embed ─► RPC match_doc_chunks (RRF) (supabase-js)
     • get_document  → signed URL (Supabase Storage) + metadati
     • list_schema   → tipologie e campi dal registry
```

Il **registry** delle tipologie (`config/registry/*.json`) e la **libreria di esempi text-to-SQL** (`config/query-examples.ts`) sono **file di configurazione**, non tabelle. Lo schema DB è minimale: solo `topfiler_final_ai_documenti` e `topfiler_final_ai_doc_chunks` (prefisso per convivere con gli oggetti dei PoC nello stesso progetto Supabase).

### Layout

```
config/registry/*.json        # una tipologia per file: {tipologia, descrizione, json_schema, embed_strategy}
config/query-examples.ts      # coppie {domanda, sql, note} iniettate nel generatore SQL (prompt caching)
supabase/migrations/*.sql     # schema, indici, funzione RRF, ruolo read-only (supabase db push)
supabase/schema.sql           # stesso schema in un unico file (SQL editor)
src/env.ts                    # config .env validata con Zod
src/lib/                      # anthropic, supabase, pg-readonly, embeddings (Mistral REST), text, logger
src/config/registry.ts        # caricamento + validazione AJV del registry, whitelist campi per SqlGuard
src/ingestion/                # oracle-source, extract-text, classify, extract-metadata, sanity,
                              #   normalize-employee, embed-doc, ingest-document (orchestratore + runner)
src/sql/                      # generate-sql (Anthropic + cache_control), sql-guard (node-sql-parser)
src/agent/                    # instructions + tools (text_to_sql, hybrid_search, get_document, list_schema, stub)
src/mastra/index.ts           # istanza Mastra + Agent topFiler3 (usata anche da `mastra dev`)
src/server/server.ts          # Hono: POST /api/chat, POST /api/ingest, GET /api/health
bin/ingest.ts                 # runner CLI ingestion da Oracle
bin/seed-demo.ts              # dati sintetici per la checklist di verifica
```

## Prerequisiti

- Node.js 20+
- Un progetto Supabase (cloud) **oppure** Supabase locale (`supabase start`)
- Chiavi: `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`
- Per l'ingestion reale: accesso read-only al documentale Oracle + client Oracle per `node-oracledb`

## Setup

1. **Dipendenze**
   ```bash
   npm install
   ```

2. **Variabili d'ambiente**
   ```bash
   cp .env.example .env      # poi compila i valori
   ```
   Tre credenziali distinte (vedi sezione Sicurezza). Modelli e soglie sono configurabili.

3. **Schema Supabase**
   - Con la CLI (consigliato):
     ```bash
     supabase start            # se locale
     supabase db push          # applica supabase/migrations/
     ```
   - Oppure incolla `supabase/schema.sql` nel **SQL Editor** di Supabase.
   - **Imposta la password del ruolo read-only** e mettila in `READONLY_DATABASE_URL`:
     ```sql
     ALTER ROLE topfiler_final_ai_readonly PASSWORD 'la-tua-password-forte';
     ```
     `READONLY_DATABASE_URL` deve puntare al **pooler** Supabase con utente `topfiler_final_ai_readonly`.

4. **Storage**: crea (se non esiste) il bucket **privato** `topfiler-final-ai-documenti` (nome configurabile con `SUPABASE_STORAGE_BUCKET`). Serve solo per l'ingestion reale e `get_document`, non per la checklist via `seed:demo`.

5. **Memory dell'agente**: imposta `MASTRA_DATABASE_URL` (può essere la connection string Supabase con un ruolo che può scrivere lo schema `mastra`). Senza, l'agente funziona ma **senza** history persistente.

## Esecuzione

```bash
# Ingestion batch da Oracle (paginazione + concorrenza limitata)
npm run ingest -- --limit 100 --concurrency 3
npm run ingest -- --force            # ri-elabora anche i già presenti

# Server HTTP (chat + ingest manuale)
npm run server                       # POST /api/chat, POST /api/ingest, GET /api/health

# Playground Mastra in sviluppo
npm run mastra:dev

# Dati di prova per la checklist
npm run seed:demo

# Type-check
npm run typecheck
```

Esempio chat:
```bash
curl -s localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"u1","message":"Contratti di lavoro ancora attivi a giugno 2026"}'
```

Esempio ingest manuale:
```bash
curl -s localhost:3000/api/ingest -F 'file=@/percorso/documento.pdf'
```

## Sicurezza — tre credenziali, mai mescolate

| Credenziale | Dove | Uso |
|---|---|---|
| Oracle read-only | `ORACLE_*` | **Solo ingestion**: lettura BLOB sorgente |
| Supabase service role | `SUPABASE_SERVICE_KEY` | **Solo ingestion/storage**: scrittura metadati/chunk, upload e signed URL |
| Postgres `topfiler_final_ai_readonly` | `READONLY_DATABASE_URL` | **Solo tool di lettura** (`text_to_sql`, `hybrid_search`) |

A runtime l'unico accesso al **database** è `topfiler_final_ai_readonly` (SELECT su `documenti` + EXECUTE sulla funzione RRF). Difese del `text_to_sql`: SqlGuard + connessione read-only + transazione `READ ONLY` + `statement_timeout`. Dettagli in [DECISIONS.md](./DECISIONS.md).

## Logging

Log strutturato JSON-line su stdout. In particolare:
- `sql.exec`: ogni query generata ed eseguita (domanda, sql, righe, durata, retry, ok/errore).
- `llm.call`: ogni chiamata diretta all'SDK Anthropic con `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` e `cache_hit`.

## Aggiungere una nuova tipologia (zero codice)

1. Crea un file in `config/registry/`, es. `NOTA_SPESE.json`:
   ```json
   {
     "tipologia": "NOTA_SPESE",
     "descrizione": "Nota spese di un dipendente con voci di rimborso.",
     "embed_strategy": "RIGHE",
     "json_schema": {
       "type": "object",
       "additionalProperties": false,
       "required": ["dipendente_nome_norm", "data", "importo_totale", "righe"],
       "properties": {
         "dipendente_nome_norm": { "type": "string", "pattern": "^[A-ZÀ-Ù' ]{2,}$" },
         "data": { "type": "string", "format": "date" },
         "importo_totale": { "type": "number" },
         "righe": { "type": "array", "items": {
           "type": "object", "additionalProperties": false,
           "required": ["descrizione", "importo"],
           "properties": { "descrizione": { "type": "string" }, "importo": { "type": "number" } } } }
       }
     }
   }
   ```
2. Riavvia ingestion/server. Il registry viene ricaricato e validato all'avvio: la nuova tipologia è automaticamente disponibile per classificazione, estrazione (lo `json_schema` diventa l'`input_schema` del tool), `list_schema`, e i suoi campi entrano nella whitelist del SqlGuard.
3. (Opzionale) aggiungi esempi mirati in `config/query-examples.ts`.

`embed_strategy`: `FULL` (chunk semantici del testo), `RIGHE` (un chunk per riga), `NONE` (nessun embedding).

---

## Checklist di verifica manuale

Dopo `npm run seed:demo`, prova queste 10 domande in chat. Tra parentesi il comportamento atteso sui dati di prova (inclusi i casi negativi che NON devono comparire).

1. **Tutti i documenti del personale di Alessio Marino e Matteo Romano** → per ciascuno: contratto, richiamo, idoneità medica, attestato primo soccorso, attestato sicurezza (5 documenti a testa, correlati via `dipendente_nome_norm` = `MARINO ALESSIO` / `ROMANO MATTEO`).
2. **Contratti di apprendistato 2025 i cui dipendenti hanno anche attestati sicurezza e primo soccorso** → **Davide Moretti** (con l'estrazione dei due attestati). *Escluso* Luca Bianchi (apprendista 2025 con il **solo** attestato sicurezza).
3. **Contratti di lavoro con scadenza nel 2026** → Matteo Romano (2026-09-30) e Marco Rizzo (2026-02-28).
4. **Contratti con mansione di controllo nel settore IT, suddivisi tra attivi e scaduti/non rinnovati** → Romano (ATTIVO), Ferrari (SCADUTO), Gallo (NON_RINNOVATO).
5. **Contratti con mansione helpdesk, verificando quali sono attivi** → Marino (ATTIVO) e Costa (SCADUTO) → attivo: Marino.
6. **Idoneità mediche (validità 24 mesi dall'emissione) in scadenza nel 2026** → Marino (2024-05-20 → 2026-05-20) e Romano (2024-09-10 → 2026-09-10). *Esclusa* Ferrari (2025-02-01 → 2027).
7. **Fatture attive con attività di manutenzione, suddivise per tipologia di manutenzione** → ORDINARIA: 2 (FT-2025-001, FT-2025-002), STRAORDINARIA: 1 (FT-2025-001), PREVENTIVA: 1 (FT-2025-003). *Esclusa* la fattura passiva.
8. **Offerte di acquisto con licenze per più di 30 utenti, suddivise per anno** → 2024: 1 (50 licenze), 2025: 2 (35 e 120 licenze). *Escluse* quella da 20 e quella senza licenze.
9. **Ordini di acquisto con componenti hardware** → OA-001 e OA-002. *Escluso* OA-003 (solo servizio).
10. **Contratti di lavoro ancora attivi a giugno 2026** → Marino, Romano, Moretti, Bianchi. *Esclusi* gli scaduti (Rizzo/Ferrari/Gallo/Costa) e il contratto di Giulia Verdi **stipulato a luglio 2026** (non ancora attivo).

> Nota: i 10 quesiti sono risolti dal tool `text_to_sql` sui metadati. Per provare `hybrid_search` serve un'ingestion reale (embedding Mistral); il seed inserisce solo le righe `documenti`.

Per ogni risposta, l'agente deve riportare il **criterio** applicato dal text-to-SQL (così la logica è verificabile) e citare solo i `doc_id` realmente restituiti.
