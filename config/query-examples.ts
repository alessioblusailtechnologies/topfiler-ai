// ===========================================================================
// topFiler3 · libreria di esempi text-to-SQL (FILE, non tabella)
// Coppie {domanda, sql, note} verificate a mano, iniettate STATICAMENTE nel
// prompt del generatore SQL (blocco con cache_control ephemeral → prefisso
// cacheabile da Anthropic). Tutte le query sono Postgres/JSONB sulla SOLA
// tabella `documenti`. Le date sono confrontate come testo ISO 'YYYY-MM-DD'
// (lecito perché normalizzate in ingestion); i cast ::date/::numeric sono leciti
// a query-time (solo negli indici no).
//
// Aggiungere un esempio = aggiungere un elemento qui (zero altro codice).
// ===========================================================================

export interface QueryExample {
    domanda: string;
    sql: string;
    note?: string;
}

export const QUERY_EXAMPLES: QueryExample[] = [
    {
        domanda: 'Contratti di lavoro ancora attivi al 1 giugno 2026',
        sql: `SELECT id, tipologia,
       metadata->>'dipendente_nome_norm' AS dipendente,
       metadata->>'mansione'             AS mansione,
       metadata->>'data_scadenza'        AS data_scadenza
FROM topfiler_final_ai_documenti
WHERE tipologia = 'CONTRATTO_LAVORO'
  AND (metadata->>'data_stipula') <= '2026-06-01'
  AND ((metadata->>'data_scadenza') >= '2026-06-01' OR metadata->>'data_scadenza' IS NULL)
LIMIT 200`,
        note: 'Logica "attivo a una data": stipula <= data E (scadenza >= data OPPURE scadenza NULL). Confronto su testo ISO. data_scadenza NULL = indeterminato → sempre attivo. ATTENZIONE: per "attivo a una data" usa SOLO data_stipula/data_scadenza. NON usare metadata->>\'stato\'=\'ATTIVO\' né tipo_contratto come scorciatoia (con OR): il campo "stato" nel documento può essere obsoleto — un contratto può restare etichettato ATTIVO anche dopo la scadenza — e un contratto stipulato DOPO la data (es. luglio 2026) NON è attivo a giugno 2026. Niente OR con stato/tipo_contratto.',
    },
    {
        domanda: 'Contratti di lavoro con scadenza nel 2026',
        sql: `SELECT id, tipologia,
       metadata->>'dipendente_nome_norm' AS dipendente,
       metadata->>'data_scadenza'        AS data_scadenza
FROM topfiler_final_ai_documenti
WHERE tipologia = 'CONTRATTO_LAVORO'
  AND (metadata->>'data_scadenza') >= '2026-01-01'
  AND (metadata->>'data_scadenza') <= '2026-12-31'
LIMIT 200`,
        note: 'COPPIA DI CONTRASTO con "attivi a giugno 2026": qui basta che la scadenza CADA nel 2026, a prescindere dalla stipula e SENZA includere gli indeterminati (scadenza NULL esclusa). "Attivo a una data" è un concetto diverso: richiede stipula<=data e scadenza>=data o NULL. Non confondere i due criteri.',
    },
    {
        domanda: 'Quante righe di tipo SERVIZIO ha ciascuna fattura con più di 5 servizi',
        sql: `SELECT id, tipologia, metadata->>'numero' AS numero,
       (SELECT count(*) FROM jsonb_array_elements(metadata->'righe') r WHERE r->>'tipo' = 'SERVIZIO') AS n_servizi
FROM topfiler_final_ai_documenti
WHERE tipologia = 'FATTURA'
  AND (SELECT count(*) FROM jsonb_array_elements(metadata->'righe') r WHERE r->>'tipo' = 'SERVIZIO') > 5
LIMIT 200`,
        note: 'Conteggio su array JSONB: jsonb_array_elements espande metadata->\'righe\', poi si filtra/conta. Non usare num_righe_servizio per il filtro se vuoi il conteggio esplicito (ma il campo precomputato esiste ed è affidabile).',
    },
    {
        domanda: 'Contratti di apprendistato stipulati nel 2025 il cui dipendente ha anche attestati di sicurezza e primo soccorso',
        sql: `SELECT c.id, c.metadata->>'dipendente_nome_norm' AS dipendente
FROM topfiler_final_ai_documenti c
WHERE c.tipologia = 'CONTRATTO_LAVORO'
  AND c.metadata->>'tipo_contratto' = 'APPRENDISTATO'
  AND (c.metadata->>'data_stipula') >= '2025-01-01'
  AND (c.metadata->>'data_stipula') <= '2025-12-31'
  AND EXISTS (
        SELECT 1 FROM topfiler_final_ai_documenti a
        WHERE a.tipologia = 'ATTESTATO'
          AND a.metadata->>'dipendente_nome_norm' = c.metadata->>'dipendente_nome_norm'
          AND a.metadata->>'tipo_corso' = 'SICUREZZA')
  AND EXISTS (
        SELECT 1 FROM topfiler_final_ai_documenti a
        WHERE a.tipologia = 'ATTESTATO'
          AND a.metadata->>'dipendente_nome_norm' = c.metadata->>'dipendente_nome_norm'
          AND a.metadata->>'tipo_corso' = 'PRIMO_SOCCORSO')
LIMIT 200`,
        note: 'Correlazione HR senza tabella anagrafica: il join è su metadata->>\'dipendente_nome_norm\' (uppercase COGNOME NOME). Due EXISTS distinti perché servono ENTRAMBI gli attestati. Caso negativo da escludere: apprendista con SOLO l\'attestato sicurezza.',
    },
    {
        domanda: 'Idoneità mediche (validità 24 mesi) in scadenza nel 2026',
        sql: `SELECT id, metadata->>'dipendente_nome_norm' AS dipendente,
       ((metadata->>'data_emissione')::date + interval '24 months')::date AS data_scadenza_calcolata
FROM topfiler_final_ai_documenti
WHERE tipologia = 'IDONEITA_MEDICA'
  AND ((metadata->>'data_emissione')::date + interval '24 months') >= DATE '2026-01-01'
  AND ((metadata->>'data_emissione')::date + interval '24 months') <  DATE '2027-01-01'
LIMIT 200`,
        note: 'Data DERIVATA: la scadenza non è memorizzata, si calcola da data_emissione + 24 mesi. Il cast ::date e l\'aritmetica su intervalli sono leciti a query-time.',
    },
    {
        domanda: 'Fatture attive con attività di manutenzione, suddivise per tipo di manutenzione',
        sql: `SELECT r->>'tipo_manutenzione' AS tipo_manutenzione,
       count(DISTINCT d.id)       AS n_fatture
FROM topfiler_final_ai_documenti d, jsonb_array_elements(d.metadata->'righe') r
WHERE d.tipologia = 'FATTURA'
  AND d.metadata->>'direzione' = 'ATTIVA'
  AND r->>'tipo_manutenzione' IS NOT NULL
GROUP BY r->>'tipo_manutenzione'
ORDER BY n_fatture DESC
LIMIT 200`,
        note: 'Espansione delle righe come tabella (cross join lateral implicito) per aggregare sul tipo_manutenzione delle righe SERVIZIO.',
    },
    {
        domanda: 'Offerte di acquisto con licenze per più di 30 utenti, suddivise per anno',
        sql: `SELECT (metadata->>'anno')::int AS anno, count(*) AS n_offerte
FROM topfiler_final_ai_documenti
WHERE tipologia = 'OFFERTA_ACQUISTO'
  AND (metadata->>'num_licenze')::numeric > 30
GROUP BY (metadata->>'anno')::int
ORDER BY anno
LIMIT 200`,
        note: 'Filtro numerico su campo JSONB con cast a numeric. num_licenze può essere NULL (offerte non-licenze): il confronto > 30 le esclude automaticamente.',
    },
    {
        domanda: 'Ordini di acquisto con componenti hardware',
        sql: `SELECT id, metadata->>'numero' AS numero, metadata->>'fornitore' AS fornitore
FROM topfiler_final_ai_documenti
WHERE tipologia = 'ORDINE_ACQUISTO'
  AND jsonb_path_exists(metadata, '$.righe[*] ? (@.categoria == "HARDWARE")')
LIMIT 200`,
        note: 'jsonb_path_exists con predicato sul valore di categoria dentro l\'array righe: vero se almeno una riga è HARDWARE.',
    },
    {
        domanda: 'Contratti con mansione di controllo nel settore IT, suddivisi tra attivi e scaduti/non rinnovati',
        sql: `SELECT metadata->>'stato' AS stato, id,
       metadata->>'dipendente_nome_norm' AS dipendente,
       metadata->>'mansione'             AS mansione
FROM topfiler_final_ai_documenti
WHERE tipologia = 'CONTRATTO_LAVORO'
  AND metadata->>'settore' = 'IT'
  AND metadata->>'mansione' ILIKE '%controllo%'
ORDER BY (metadata->>'stato' = 'ATTIVO') DESC, metadata->>'stato'
LIMIT 200`,
        note: 'Mansione è testo libero → ILIKE. La suddivisione attivi vs scaduti/non rinnovati si legge dalla colonna stato (ATTIVO / SCADUTO / NON_RINNOVATO / RINNOVATO).',
    },
    {
        domanda: 'Contratti con mansione helpdesk: quali sono ancora attivi?',
        sql: `SELECT id, metadata->>'dipendente_nome_norm' AS dipendente,
       metadata->>'mansione' AS mansione, metadata->>'stato' AS stato
FROM topfiler_final_ai_documenti
WHERE tipologia = 'CONTRATTO_LAVORO'
  AND (metadata->>'mansione') ILIKE '%help%desk%'
  AND metadata->>'stato' = 'ATTIVO'
LIMIT 200`,
        note: 'Mansione è testo LIBERO e scritto in modi diversi: "helpdesk", "help desk", "tecnico helpdesk", "impiegato Help Desk". Per intercettarne le varianti usa pattern ILIKE flessibili con wildcard tra le parole, es. ILIKE \'%help%desk%\' (NON il solo \'%helpdesk%\', che perde "help desk" con lo spazio). Stesso principio per altre mansioni multi-parola.',
    },
    {
        domanda: 'Tutti i documenti del personale di un dipendente (per nome normalizzato)',
        sql: `SELECT id, tipologia,
       metadata->>'data_stipula'   AS data_stipula,
       metadata->>'data_emissione' AS data_emissione,
       metadata->>'data'           AS data
FROM topfiler_final_ai_documenti
WHERE metadata->>'dipendente_nome_norm' = 'MARINO ALESSIO'
ORDER BY tipologia
LIMIT 200`,
        note: 'Tutti i documenti HR dello stesso dipendente sono uniti dal solo valore dipendente_nome_norm (uppercase COGNOME NOME). Nessuna tabella anagrafica.',
    },
];
