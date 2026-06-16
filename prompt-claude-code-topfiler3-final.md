# Prompt per Claude Code — topFiler3 (Node + Mastra Agent + Supabase, schema minimale)

Copia tutto il contenuto da qui in giù in Claude Code.

---

Devi implementare **topFiler3**, un assistente conversazionale che risponde a domande e recupera documenti da un corpus eterogeneo (contratti di lavoro, attestati, idoneità mediche, fatture, ordini, offerte, manuali, materiale pubblicitario). I documenti sorgente risiedono come BLOB in un **database Oracle esterno (sola lettura)**; tutta la persistenza del sistema (metadati, chunk, vettori, file) è su **Supabase**.

## Stack tecnologico

- Node.js 20+, TypeScript strict, singolo package con due entrypoint: `ingestion` (CLI) e `server` (API chat)
- **Agente conversazionale: Mastra AI** — classe `Agent` + tool con `createTool` (Zod inputSchema), modello via model router di Mastra (`anthropic/<modello>` con `ANTHROPIC_API_KEY`). NON importare né usare direttamente il Vercel AI SDK nel codice applicativo: la gestione provider è interamente delegata a Mastra.
- **Chiamate LLM di servizio** (classificazione tipologia, estrazione metadati, generazione SQL dentro il tool text_to_sql): **`@anthropic-ai/sdk` ufficiale, diretto**, perché servono tool use forzato e `cache_control` espliciti.
- **Ingestion: semplice progetto Node** — funzioni sequenziali pure + runner CLI. NON usare i workflow di Mastra per l'ingestion.
- **Supabase**: Postgres con `pgvector`, `tsvector` (full-text italiano), JSONB (metadati), Supabase Storage (file)
- `node-oracledb` solo per la lettura dei documenti sorgente da Oracle
- **Embedding: Mistral** — modello `mistral-embed` (1024 dimensioni), chiamata **REST diretta** a `https://api.mistral.ai/v1/embeddings` con `MISTRAL_API_KEY`, dietro un'interfaccia `EmbeddingProvider` (batch di input dove possibile, retry con backoff su 429)
- Zod + AJV per validazione, migrations con Supabase CLI

**Schema DB minimale**: il core è la tabella `documenti` con il suo JSONB di metadati, più `doc_chunks` per la ricerca semantica. NON creare viste, NON creare tabelle accessorie (niente anagrafica dipendenti, niente tabelle per registry o libreria query): registry delle tipologie ed esempi text-to-SQL vivono come **file di configurazione nel repository**.

**Niente test automatici per ora**: non installare Vitest/Jest, non creare cartelle di test. La verifica è manuale (checklist in fondo, da riportare nel README).

Procedi **per fasi nell'ordine indicato**. Se una decisione di design non è coperta da questo documento, scegli la soluzione più semplice e documentala in `DECISIONS.md`.

---

## FASE 1 — Modello dati (migrations Supabase) e file di configurazione

### Tabelle (solo queste due)

**`documenti`**:
- `id uuid PK`, `tipologia text`, `metadata jsonb`, `storage_path` (path su Supabase Storage), `source_oracle_id`, `filename`, `mime_type`, `hash_sha256`, `data_caricamento timestamptz`
- `stato_ingestion`: enum `VALIDATO` / `DA_REVISIONARE` / `ERRORE`
- `confidence numeric` (0-1)

**`doc_chunks`**:
- `id uuid PK`, `doc_id` FK verso documenti, `testo text`, `embedding vector(1024)`, `chunk_type` (`CONTENUTO` / `RIGA`), `riga_index int null`
- `tsv tsvector GENERATED ALWAYS AS (to_tsvector('italian', testo)) STORED` (lecito: `to_tsvector` con config esplicita è IMMUTABLE)

### Indici

- HNSW su `doc_chunks.embedding` (`vector_cosine_ops`)
- GIN su `doc_chunks.tsv`
- GIN `jsonb_path_ops` su `documenti.metadata`
- B-tree a espressione sui campi caldi, indicizzando il **testo ISO** (le date in formato `YYYY-MM-DD` si ordinano e confrontano correttamente come stringhe, e `->>` è IMMUTABLE quindi l'expression index è lecito — NON castare a `::date` nell'indice, il cast non è IMMUTABLE):
  ```sql
  CREATE INDEX idx_doc_tip_scad ON documenti (tipologia, (metadata->>'data_scadenza'));
  CREATE INDEX idx_doc_dipendente ON documenti ((metadata->>'dipendente_nome_norm'));
  ```

### Ruolo read-only

Ruolo Postgres dedicato `topfiler_readonly` con **solo SELECT sulla tabella `documenti`** (il tool text-to-SQL interroga direttamente la tabella, nessuna vista), usato da una connessione pg diretta separata (connection string del pooler Supabase) con `default_transaction_read_only = on` e `statement_timeout` (es. 10s). Il tool text-to-SQL NON passa da supabase-js.

### Registry delle tipologie (file di configurazione, NON tabella)

Directory `config/registry/` con un file JSON per tipologia: `{tipologia, descrizione, json_schema, embed_strategy: FULL|RIGHE|NONE}`. Caricati e validati all'avvio. Aggiungere una tipologia = aggiungere un file, zero codice.

Tipologie e campi minimi dei rispettivi JSON Schema:

- **CONTRATTO_LAVORO**: `dipendente_nome_norm`, `tipo_contratto` (enum: `APPRENDISTATO`, `DETERMINATO`, `INDETERMINATO`), `data_stipula` (date ISO), `data_scadenza` (date ISO, nullable), `mansione` (testo libero), `settore`, `stato` (enum: `ATTIVO`, `SCADUTO`, `RINNOVATO`, `NON_RINNOVATO`) — embed_strategy: `FULL` (le clausole sono semantiche)
- **ATTESTATO**: `dipendente_nome_norm`, `tipo_corso` (enum: `SICUREZZA`, `PRIMO_SOCCORSO`, `ANTINCENDIO`, `ALTRO`), `data_emissione`, `validita_mesi` — embed_strategy: `NONE`
- **IDONEITA_MEDICA**: `dipendente_nome_norm`, `data_emissione`, `esito` — embed_strategy: `NONE`
- **RICHIAMO_DISCIPLINARE**: `dipendente_nome_norm`, `data`, `motivo` — embed_strategy: `NONE`
- **FATTURA**: `direzione` (enum: `ATTIVA`, `PASSIVA`), `numero`, `data_emissione`, `controparte`, `importo_totale`, `righe` (array di `{descrizione, tipo: BENE|SERVIZIO, importo, tipo_manutenzione nullable}`), `num_righe_servizio` (precomputato) — embed_strategy: `RIGHE`
- **ORDINE_ACQUISTO**: `numero`, `data`, `fornitore`, `righe` (array `{descrizione, categoria: HARDWARE|SOFTWARE|SERVIZIO|ALTRO, quantita, importo}`) — embed_strategy: `RIGHE`
- **OFFERTA_ACQUISTO**: `data`, `anno`, `fornitore`, `num_licenze` (integer, nullable), `oggetto`, `righe` — embed_strategy: `RIGHE`
- **MANUALE**: `prodotto`, `versione`, `argomento` — embed_strategy: `FULL`
- **MATERIALE_PUBBLICITARIO**: `campagna`, `anno`, `target` — embed_strategy: `FULL`

Regole trasversali da imporre in estrazione: date sempre ISO `YYYY-MM-DD`, numeri come numeri JSON (mai stringhe), enum chiusi, nomi dipendente normalizzati uppercase formato `COGNOME NOME` nel campo `dipendente_nome_norm`. Il nome normalizzato è la **chiave di correlazione** tra i documenti HR dello stesso dipendente (non esiste tabella anagrafica).

### Libreria esempi text-to-SQL (file, NON tabella)

File `config/query-examples.ts` (o JSON) con coppie `{domanda, sql, note}` verificate a mano, caricato all'avvio e iniettato staticamente nel prompt del generatore SQL.

---

## FASE 2 — Pipeline di ingestion (Node semplice + SDK Anthropic)

Implementa l'ingestion come **modulo Node senza framework**: ogni step è una funzione pura, un orchestratore `ingestDocument(source)` le chiama in sequenza, un runner CLI gestisce il batch (`npm run ingest`, con paginazione e concorrenza limitata, es. p-limit a 3). Connettore sorgente: `node-oracledb` in sola lettura, lettura paginata dei BLOB con cursore. Tutte le chiamate LLM usano `@anthropic-ai/sdk` (client unico condiviso, retry/backoff dell'SDK).

Step in sequenza per ogni documento:

1. **Lettura da Oracle**: scarica BLOB + metadati sorgente disponibili (tipologia se presente, filename, id sorgente). Calcola `hash_sha256` e salta i documenti già ingeriti (idempotenza).
2. **Upload su Supabase Storage**: bucket privato `documenti`, path `{tipologia}/{uuid}/{filename}`. Da qui in poi Oracle non serve più per quel documento.
3. **Estrazione testo**: `pdf-parse`/`officeparser` per PDF e Office; se il testo è vuoto o quasi (scansione), marca `DA_REVISIONARE` con nota "OCR richiesto" e predisponi solo l'interfaccia `OcrProvider` (implementazione fuori scope).
4. **Classificazione tipologia**: Messages API con modello economico (es. Haiku, da config) e **tool use forzato** (`tool_choice: {type: "tool", name: "classifica"}`) con un tool il cui `input_schema` ha `tipologia` come enum chiuso letto dal registry + `confidence`. Se Oracle fornisce già la tipologia, usala come hint nel prompt ma verifica.
5. **Estrazione metadati**: Messages API con tool use forzato, dove l'`input_schema` del tool È il JSON Schema della tipologia letto dal registry. Valida comunque la risposta con AJV; se non valida, un retry passando l'errore in feedback, poi `DA_REVISIONARE`.
6. **Regole di sanità** post-estrazione (deterministiche, in TypeScript): `data_scadenza > data_stipula`; date non nel futuro remoto né antecedenti al 1990; `num_licenze >= 0`; `num_righe_servizio` **ricalcolato dal codice** dall'array `righe` (mai fidarsi dell'LLM per i conteggi). Violazione → `DA_REVISIONARE`.
7. **Normalizzazione dipendente** (solo tipologie HR): porta il nome in `COGNOME NOME` uppercase. Poi confronta con i valori distinti di `dipendente_nome_norm` già presenti in `documenti`: se esiste un valore a distanza di Levenshtein ≤ 2, riusa la forma già presente (canonica) invece di crearne una variante — è ciò che tiene uniti i documenti dello stesso dipendente senza tabella anagrafica. Ambiguità (due candidati vicini) → `DA_REVISIONARE`.
8. **Embedding selettivo** secondo `embed_strategy`:
   - `FULL`: chunking con una funzione propria (recursive character splitter, target ~500 token, overlap ~50), un record `doc_chunks` per chunk
   - `RIGHE`: un chunk per ogni riga del documento (la sola `descrizione`), `chunk_type = RIGA` e `riga_index`
   - `NONE`: nessun embedding
   - Vettori tramite `EmbeddingProvider` Mistral (`mistral-embed`, batch di più testi per chiamata)
9. **Confidence finale**: minimo tra classificazione ed estrazione. Sotto soglia configurabile (default 0.85) → `DA_REVISIONARE`, altrimenti `VALIDATO`.

Esponi anche `POST /api/ingest` (upload manuale di un file) che riusa lo stesso orchestratore saltando lo step 1.

---

## FASE 3 — Agente conversazionale (Mastra Agent)

Definisci un **`Agent` di Mastra**:
- modello via model router di Mastra: stringa `anthropic/<modello>` (da config), autenticazione con `ANTHROPIC_API_KEY`
- tool registrati con `createTool`, ognuno con `inputSchema` Zod e **descrizione accurata** (la descrizione guida il routing dell'agente)
- `instructions` = regole sotto + schemi del registry serializzati (caricati all'avvio dai file di config); tieni instructions e definizioni dei tool **stabili tra le richieste** così il prefisso resta cacheabile, e abilita il caching Anthropic tramite le opzioni provider esposte da Mastra dove disponibili
- memory/history di conversazione gestita da Mastra (storage Postgres su Supabase)
- esposizione: server Mastra (`mastra dev` in sviluppo) o endpoint `POST /api/chat` minimale (Hono) che invoca l'agente con history per sessione

### Tool 1 — `text_to_sql(domanda)`

- Dentro il tool: una chiamata **diretta `@anthropic-ai/sdk`** genera un SELECT **sulla tabella `documenti`** (sintassi **Postgres/JSONB**: `->`, `->>`, `@>`, `jsonb_path_exists`, `jsonb_array_elements`, `jsonb_array_length`, cast `::date`/`::numeric` a query time — i cast nelle query sono leciti, solo negli indici no), poi il tool lo esegue sulla connessione read-only e restituisce le righe.
- **Prompt del generatore SQL strutturato per il prompt caching nativo**, come array di blocchi system in quest'ordine: (a) istruzioni fisse + regole di sintassi Postgres/JSONB, (b) schemi del registry, (c) esempi da `config/query-examples` (statici) → su quest'ultimo blocco `cache_control: {type: "ephemeral"}`; la domanda utente segue nei `messages`.
- Istruisci il generatore che la correlazione tra documenti HR dello stesso dipendente avviene via `metadata->>'dipendente_nome_norm'` (self-join o subquery su `documenti`, non esistono altre tabelle).
- **Guardrail obbligatori**, in una classe `SqlGuard` isolata e senza dipendenze LLM:
  - parsing con `node-sql-parser` (dialetto Postgres): un solo statement, solo SELECT; vietati DML/DDL/funzioni di sistema, `;` multipli, commenti
  - whitelist sorgenti: solo la tabella `documenti` (self-join ammessi)
  - validazione dei path JSONB usati nella query contro i campi dichiarati nel registry: path inesistente → rigenera con errore in feedback (max 2 retry), poi fallisci esplicitamente
  - `LIMIT 200` forzato se assente
  - esecuzione solo sul ruolo `topfiler_readonly` con `statement_timeout`
- Il tool restituisce: righe risultato (sempre con `id` e `tipologia`), **più il criterio applicato in linguaggio naturale** (es. "cercati contratti con data_scadenza tra 2026-01-01 e 2026-12-31"), che l'agente deve riportare all'utente.
- Risultato vuoto → il tool lo segnala come "0 risultati con questo criterio", mai come "non esistono documenti".

### Tool 2 — `hybrid_search(query, tipologia?, filtri_metadata?)`

- Ricerca su `doc_chunks` combinando in un'unica query Postgres: similarità coseno pgvector (`embedding <=> $1`, vettore della domanda calcolato con Mistral) + full-text italiano (`tsv @@ websearch_to_tsquery('italian', $2)` con `ts_rank`), con pre-filtro opzionale su tipologia e predicati JSONB sul documento padre (join su `documenti`).
- Fusione punteggi: **Reciprocal Rank Fusion (RRF)** tra ranking vettoriale e ranking full-text (due CTE + fusione, oppure due query fuse in applicazione).
- Restituisce: chunk, `doc_id`, tipologia, metadati essenziali del documento padre.

### Tool 3 — `get_document(doc_id)`

- Genera una **signed URL** temporanea da Supabase Storage e la restituisce con i metadati. È il tool che chiude le domande "estrai/estrapola".

### Tool 4 — `list_schema()`

- Restituisce tipologie e campi disponibili dal registry, così l'agente può spiegare cosa è interrogabile.

### Instructions dell'agente

Regole dure da includere:
- cita **solo** `doc_id` presenti nei risultati dei tool; mai inventare documenti, dipendenti, date o importi
- per conteggi, date, filtri numerici, correlazioni tra documenti → `text_to_sql`; per domande "parla di / riguarda X" a vocabolario aperto → `hybrid_search`, eventualmente con pre-filtro; le due cose si combinano (prima SQL per restringere, poi semantica)
- quando l'utente chiede di "estrarre/estrapolare", chiama sempre `get_document` e fornisci i link
- riporta sempre il criterio applicato dal text-to-SQL così l'utente può verificare la logica
- se un tool fallisce o torna vuoto, dillo esplicitamente; non riempire il vuoto con conoscenza generale
- rispondi in italiano

Predisponi (interfacce + stub): tool `web_search` e tool `create_file` per generazione report.

### Seed di `config/query-examples`

Inserisci come esempi verificati (in SQL Postgres) almeno:
1. logica "attivo a una certa data": `(metadata->>'data_stipula') <= $d AND ((metadata->>'data_scadenza') >= $d OR metadata->>'data_scadenza' IS NULL)` — confronto su testo ISO, valido perché le date sono normalizzate `YYYY-MM-DD`
2. conteggio righe: documenti con più di 5 righe di tipo SERVIZIO via `(SELECT count(*) FROM jsonb_array_elements(metadata->'righe') r WHERE r->>'tipo' = 'SERVIZIO') > 5`
3. correlazione HR via self-join: contratti APPRENDISTATO stipulati nel 2025 il cui `dipendente_nome_norm` compare anche in ATTESTATO con tipo_corso SICUREZZA e PRIMO_SOCCORSO
4. data derivata: idoneità mediche con `(metadata->>'data_emissione')::date + interval '24 months'` in scadenza nel 2026
5. la **coppia di contrasto** "contratti con scadenza nel 2026" vs "contratti attivi a giugno 2026", con SQL diverso e nota che spiega la differenza

---

## Checklist di verifica manuale (da riportare nel README)

Niente suite automatica per ora. Nel README inserisci questa checklist di 10 domande da provare a mano dopo l'ingestion di dati di prova, con il comportamento atteso:

1. Tutti i documenti del personale di Alessio Marino e Matteo Romano → contratto, richiamo, idoneità medica, attestato primo soccorso, attestato sicurezza per ciascuno
2. Contratti di apprendistato 2025 i cui dipendenti hanno anche attestati sicurezza e primo soccorso → Davide Moretti, con estrazione dei due attestati
3. Contratti di lavoro con scadenza nel 2026
4. Contratti con mansione di controllo nel settore IT, suddivisi tra attivi e scaduti/non rinnovati
5. Contratti con mansione helpdesk, verificando quali sono attivi
6. Idoneità mediche (validità 24 mesi dall'emissione) in scadenza nel 2026
7. Fatture attive con attività di manutenzione, suddivise per tipologia di manutenzione
8. Offerte di acquisto con licenze per più di 30 utenti, suddivise per anno
9. Ordini di acquisto con componenti hardware
10. Contratti di lavoro ancora attivi a giugno 2026

Fornisci uno script `npm run seed:demo` che inserisce dati sintetici coerenti con queste domande (inclusi casi negativi: un apprendista 2025 con solo l'attestato sicurezza; un contratto stipulato a luglio 2026).

---

## Vincoli generali

- Configurazione via `.env` (validata con Zod all'avvio): connection string Oracle sorgente, Supabase URL/keys, connection string ruolo read-only, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, modelli (agente, classificazione/estrazione), soglia confidence
- Tre credenziali distinte e mai mescolate: Oracle read-only (solo ingestion), Supabase service role (solo ingestion/storage), Postgres `topfiler_readonly` (solo tool text_to_sql)
- Logging strutturato di ogni query SQL generata ed eseguita e di ogni chiamata LLM con token usati e cache hit/miss (per le chiamate dirette SDK: campi `cache_creation_input_tokens` / `cache_read_input_tokens` dalla risposta)
- README con architettura, istruzioni di avvio (incluso `supabase start`), la checklist di verifica, e come aggiungere una nuova tipologia al registry (un file JSON in `config/registry/`, zero codice)

Parti dalla FASE 1.
