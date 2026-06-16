import type Anthropic from '@anthropic-ai/sdk';
import { forceToolUse, type SystemBlocks } from '../lib/anthropic';
import { serializeRegistryForPrompt } from '../config/registry';
import { QUERY_EXAMPLES } from '../../config/query-examples';
import { env } from '../env';

// ===========================================================================
// Generatore SQL (chiamata DIRETTA @anthropic-ai/sdk, tool use forzato).
// Prompt strutturato per il PROMPT CACHING nativo, come array di blocchi system
// in quest'ordine:
//   (a) istruzioni fisse + regole di sintassi Postgres/JSONB
//   (b) schemi del registry
//   (c) esempi da config/query-examples  ← cache_control ephemeral su questo blocco
// La domanda utente segue nei messages. Il tool restituisce SQL + criterio NL.
// ===========================================================================

const INSTRUCTIONS = `Sei un generatore di SQL Postgres per il database topFiler3. Traduci la domanda dell'utente in UN solo SELECT sulla SOLA tabella \`topfiler_final_ai_documenti\`, poi invoca il tool \`genera_sql\`.

SCHEMA TABELLA topfiler_final_ai_documenti:
- id uuid, tipologia text, metadata jsonb, storage_path text, source_oracle_id text, filename text, mime_type text, hash_sha256 text, data_caricamento timestamptz, stato_ingestion text, confidence numeric
- Tutto lo specifico del documento vive in \`metadata\` (JSONB). La forma di metadata dipende dalla tipologia (vedi schemi sotto).

REGOLE DI SINTASSI POSTGRES/JSONB (obbligatorie):
- Accesso ai campi: metadata->>'campo' (testo), metadata->'campo' (jsonb). Array: jsonb_array_elements(metadata->'righe'), jsonb_array_length, jsonb_path_exists(metadata, '$.righe[*] ? (@.x == "Y")').
- Le DATE sono memorizzate come TESTO ISO 'YYYY-MM-DD': si confrontano/ordinano correttamente come stringhe (es. metadata->>'data_scadenza' >= '2026-01-01'). Per aritmetica sulle date usa il cast a query-time: (metadata->>'data_emissione')::date + interval '24 months'. I cast ::date/::numeric sono LECITI nelle query (non negli indici).
- Numeri: (metadata->>'campo')::numeric. Mansioni/testo libero: ILIKE con wildcard TRA le parole per intercettare le varianti, es. mansione ILIKE '%help%desk%' (NON solo '%helpdesk%', che perde "help desk" con lo spazio).
- "Attivo a una data D" = (metadata->>'data_stipula') <= D AND ((metadata->>'data_scadenza') >= D OR metadata->>'data_scadenza' IS NULL). Usa SOLO le date: NON aggiungere in OR metadata->>'stato'='ATTIVO' né tipo_contratto (lo "stato" può essere obsoleto, e un contratto stipulato dopo D non è attivo a D). NON confondere con "scadenza nel periodo X" (che NON include gli indeterminati).

CORRELAZIONE HR: i documenti dello stesso dipendente sono uniti SOLO dal valore metadata->>'dipendente_nome_norm' (UPPERCASE 'COGNOME NOME'). Per collegarli usa self-join/subquery/EXISTS su \`topfiler_final_ai_documenti\` (non esistono altre tabelle).

VINCOLI DI OUTPUT:
- Un SOLO statement SELECT, niente commenti, niente ';' multipli.
- Includi SEMPRE id e tipologia nella SELECT (servono al chiamante).
- Aggiungi LIMIT 200 se la domanda non chiede un'aggregazione che lo rende superfluo.
- \`criterio\`: una frase in ITALIANO che descrive il criterio applicato (es. "contratti con data_scadenza tra 2026-01-01 e 2026-12-31"), così l'utente può verificare la logica.`;

function buildExamplesBlock(): string {
    return QUERY_EXAMPLES.map((e, i) => {
        const note = e.note ? `\n-- nota: ${e.note}` : '';
        return `Esempio ${i + 1}\nDomanda: ${e.domanda}\nSQL:\n${e.sql}${note}`;
    }).join('\n\n');
}

function buildSystem(): SystemBlocks {
    const blocks: Anthropic.TextBlockParam[] = [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: `SCHEMI DEL REGISTRY (forma di metadata per tipologia):\n\n${serializeRegistryForPrompt()}` },
        {
            type: 'text',
            text: `ESEMPI VERIFICATI (text-to-SQL):\n\n${buildExamplesBlock()}`,
            cache_control: { type: 'ephemeral' },
        },
    ];
    return blocks;
}

const TOOL = {
    name: 'genera_sql',
    description: 'Registra la query SELECT Postgres generata e il criterio applicato in linguaggio naturale.',
    input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sql', 'criterio'],
        properties: {
            sql: { type: 'string', description: 'Un solo SELECT Postgres sulla tabella documenti.' },
            criterio: { type: 'string', description: 'Frase in italiano che descrive il criterio applicato.' },
        },
    } as Record<string, unknown>,
};

export interface GeneratedSql {
    sql: string;
    criterio: string;
}

/**
 * Genera SQL per la domanda. `feedback` (opzionale) contiene gli errori del
 * tentativo precedente (SqlGuard o esecuzione) per la rigenerazione.
 */
export async function generateSql(domanda: string, feedback?: string): Promise<GeneratedSql> {
    const userText = feedback
        ? `DOMANDA: ${domanda}\n\nIl tentativo precedente è stato RIFIUTATO: ${feedback}\nRigenera l'SQL correggendo il problema.`
        : `DOMANDA: ${domanda}`;

    const { input } = await forceToolUse<GeneratedSql>({
        model: env.SQLGEN_MODEL,
        system: buildSystem(),
        messages: [{ role: 'user', content: userText }],
        tool: TOOL,
        maxTokens: 1024,
        purpose: feedback ? 'sqlgen-retry' : 'sqlgen',
    });

    return { sql: String(input.sql ?? '').trim(), criterio: String(input.criterio ?? '').trim() };
}
