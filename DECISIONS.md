# DECISIONS — topFiler3

Decisioni di design non coperte (o coperte solo in parte) dal prompt di specifica, con la motivazione. Regola seguita: a parità di esito, la soluzione più semplice.

## Pipeline di ingestion

- **Ordine upload ↔ classificazione.** La specifica elenca l'upload su Storage come step 2 (path `{tipologia}/{uuid}/{filename}`) prima della classificazione (step 4). Ma la tipologia definitiva è nota solo dopo la classificazione. Poiché il BLOB resta in memoria dopo la lettura, l'upload **non** dipende più da Oracle a prescindere da quando avviene. Quindi: estraiamo il testo, **classifichiamo**, poi facciamo l'upload con la tipologia definitiva nel path. Il vincolo "da qui in poi Oracle non serve più" è rispettato (nessun secondo accesso a Oracle). L'`uuid` del documento è generato lato applicazione prima dell'insert, così coincide tra `storage_path` e `documenti.id`.

- **Confidenza dell'estrazione.** Lo schema del tool di estrazione **è** il JSON Schema della tipologia (come richiesto): non c'è quindi un campo `confidence` da far produrre all'LLM. La confidenza dell'estrazione è derivata **deterministicamente** dall'esito della validazione AJV: `1.0` se valida al primo tentativo, `0.8` se valida dopo il retry con feedback, `0.4` se ancora invalida. La confidenza finale resta `min(classificazione, estrazione)` come da specifica.

- **Estrazione testo + OCR.** Si usa `pdf-parse` per i PDF e `officeparser` per Office; testo/XML/HTML decodificati direttamente. Per immagini e PDF scansionati (testo vuoto/quasi) l'`OcrProvider` è ora **implementato con Mistral OCR** (`mistral-ocr-latest`): immagini come data URI, PDF via Files API + signed URL. Se l'OCR estrae testo, il documento prosegue il flusso normale (classifica/estrai/embed) con nota "testo da OCR"; altrimenti resta `DA_REVISIONARE`. Configurabile con `OCR_ENABLED` (default true); le immagini molto piccole (&lt; ~6 KB, probabili icone) saltano l'OCR. L'embedding resta via REST; l'SDK Mistral è usato solo per l'OCR.

- **Chunking.** Recursive character splitter proprio: target ~500 token (~2000 caratteri), overlap ~50 token (~200), approssimazione `token ≈ char/4`. Per i chunk si antepone — **solo nel testo embeddato, non in quello salvato** — un header distintivo (tipologia + metadati identificativi) per evitare il collasso dei vettori su template quasi identici (lezione dei PoC).

- **Deduplica nomi dipendente.** Set condiviso in memoria, seminato una volta dai valori distinti già presenti e aggiornato man mano. Con concorrenza > 1 due documenti dello stesso nuovo dipendente potrebbero, in rarissimi casi di gara, creare due forme: accettabile per il volume in gioco e comunque sanabile in revisione.

## Aggiornamento accesso runtime (supabase-js, senza pg diretto)

Per restare su un singolo progetto Supabase (`mepmdgkvcuosqddehwmg`) usando SOLO la libreria supabase-js (niente connessione Postgres diretta / pooler), i tool di lettura passano da RPC:
- `text_to_sql` → `supabase.rpc('topfiler_final_ai_run_select', { q })`. La SELECT è già validata dal **SqlGuard** lato app; la funzione SQL aggiunge `statement_timeout`. (Versione semplice SECURITY INVOKER: la protezione primaria è il SqlGuard, non un ruolo dedicato. La variante "hardened" — funzione SECURITY DEFINER di proprietà di un ruolo con solo SELECT — resta in `supabase/migrations/...readonly_role.sql` ma non è necessaria con supabase-js.)
- `hybrid_search` → `supabase.rpc('topfiler_final_ai_match_doc_chunks', …)`.
- `get_document` → `supabase.from('…documenti').select(…)` + signed URL Storage.

Di conseguenza `READONLY_DATABASE_URL` e il modulo `pg-readonly` non sono più usati a runtime; ingestion/seed restano su supabase-js (service key). Le sezioni qui sotto descrivono il modello a 3 credenziali originale (valido se si torna alla connessione pg diretta).

## Sicurezza e accessi a runtime

- **Tre credenziali, mai mescolate.** Oracle read-only (solo ingestion), Supabase service role (solo ingestion + storage), Postgres `topfiler_final_ai_readonly` (solo tool di lettura). A runtime l'unico accesso al **database** è `topfiler_final_ai_readonly`.

- **`hybrid_search` e il ruolo read-only.** La specifica riserva a `topfiler_final_ai_readonly` il solo `SELECT` su `documenti`. Per non concedere `SELECT` diretto su `doc_chunks`, la ricerca ibrida passa da `topfiler_final_ai_match_doc_chunks`, una funzione **`SECURITY DEFINER`** (esegue con i privilegi del proprietario) a cui il ruolo ha solo `EXECUTE`. È parametrica (nessun SQL dinamico) → niente superficie di injection. Così la ricerca semantica gira sulla **stessa** connessione read-only del `text_to_sql`, senza una quarta credenziale.

- **`get_document` e lo storage.** La generazione della signed URL richiede un client Supabase con accesso allo Storage: si usa la **service key** ma **esclusivamente** per `storage.createSignedUrl` (nessuna query sui dati: i metadati e lo `storage_path` arrivano dalla connessione read-only). È l'unico punto runtime che tocca la service key ed è confinato alla lettura di storage. In un hardening successivo si può sostituire con una chiave/così policy di Storage dedicata a sola lettura.

## Agente e provider

- **Model router di Mastra.** Il modello dell'agente è una stringa `anthropic/<id>` (`AGENT_MODEL`), risolta dal model router di Mastra con `ANTHROPIC_API_KEY`. Nel codice applicativo **non** si importa il Vercel AI SDK: la gestione provider è delegata a Mastra. Le chiamate di servizio (classificazione, estrazione, generazione SQL) usano invece l'**SDK Anthropic diretto**, perché servono tool use forzato e `cache_control` espliciti.

- **Memory.** History di conversazione su Postgres (`@mastra/pg` `PostgresStore`) per sessione (`threadId`/`resourceId` = `sessionId`). `semanticRecall` disattivato per non richiedere un embedder dedicato alla memory; si usano gli ultimi N messaggi. Se la versione di Mastra in uso adotta la nuova forma `memory: { thread, resource }` al posto di `threadId/resourceId`, adeguare la chiamata in `src/server/server.ts`.

- **Modelli di default.** `AGENT_MODEL=anthropic/claude-sonnet-4-6`, `CLASSIFY_MODEL=claude-haiku-4-5`, `EXTRACT_MODEL`/`SQLGEN_MODEL=claude-sonnet-4-6`. Tutti configurabili da `.env`. Verifica gli id esatti dei modelli disponibili sul tuo account e aggiornali se necessario.

## text_to_sql

- **SqlGuard** è una classe isolata senza dipendenze LLM: parsing con `node-sql-parser` (dialetto Postgres), un solo `SELECT`, whitelist sorgenti = solo `documenti`, niente commenti/`;` multipli/funzioni di sistema, validazione dei path JSONB contro i campi del registry, `LIMIT 200` forzato se assente. Difese ridondanti: connessione **read-only** + transazione `READ ONLY` + `statement_timeout`.

- **Validazione path JSONB** via estrazione regex dei riferimenti `metadata->>'campo'` / `->'campo'` e confronto con l'unione di **tutti** i campi (anche annidati, es. `righe[].tipo_manutenzione`) dichiarati nel registry. Un campo non dichiarato → rigenerazione con feedback (max 2), poi fallimento esplicito.

## Schema e seed

- **Schema minimale**: solo `documenti` (+ JSONB) e `doc_chunks`. Registry tipologie ed esempi text-to-SQL sono **file** (`config/registry/*.json`, `config/query-examples.ts`), non tabelle.
- **`seed:demo`** inserisce solo righe `documenti` (i 10 quesiti della checklist sono tutti text-to-SQL sui metadati). La ricerca semantica richiede embedding reali → eseguibile dopo un'ingestion vera o estendendo il seed con chiamate a Mistral.
