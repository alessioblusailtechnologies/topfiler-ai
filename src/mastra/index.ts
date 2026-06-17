import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { env } from '../env';
import { buildInstructions } from '../agent/instructions';
import { textToSqlTool } from '../agent/tools/text-to-sql';
import { hybridSearchTool } from '../agent/tools/hybrid-search';
import { getDocumentTool } from '../agent/tools/get-document';
import { listSchemaTool } from '../agent/tools/list-schema';
import { webSearchTool } from '../agent/tools/stubs';
import { createExcelTool, createCsvTool, createPdfTool } from '../agent/tools/create-files';
import { sendEmailTool } from '../agent/tools/send-email';

// ===========================================================================
// Istanza Mastra + Agent conversazionale topFiler3.
//  - modello via MODEL ROUTER di Mastra: stringa "anthropic/<id>" (ANTHROPIC_API_KEY).
//    La gestione provider è interamente delegata a Mastra: NON importiamo il
//    Vercel AI SDK nel codice applicativo.
//  - memory/history di conversazione su Postgres (Supabase), per sessione.
//  - instructions + tool stabili tra le richieste → prefisso cacheabile.
// `mastra dev` usa questo export; il server Hono importa `topfilerAgent`.
// ===========================================================================

// Store Postgres condiviso (storage Mastra + memory dell'agente). Se
// MASTRA_DATABASE_URL non è impostata, si parte senza persistenza (utile in dev).
const store = env.MASTRA_DATABASE_URL
    ? new PostgresStore({ id: 'topfiler3-store', connectionString: env.MASTRA_DATABASE_URL })
    : undefined;

const memory = store
    ? new Memory({ storage: store, options: { semanticRecall: false, lastMessages: 20 } })
    : undefined;

/** true se la history persistente (memory) è configurata (MASTRA_DATABASE_URL). */
export const hasMemory = !!store;

export const topfilerAgent = new Agent({
    id: 'topfiler3',
    name: 'topFiler3',
    instructions: buildInstructions(),
    model: env.AGENT_MODEL,
    tools: {
        text_to_sql: textToSqlTool,
        hybrid_search: hybridSearchTool,
        get_document: getDocumentTool,
        list_schema: listSchemaTool,
        web_search: webSearchTool,
        create_excel: createExcelTool,
        create_csv: createCsvTool,
        create_pdf: createPdfTool,
        send_email: sendEmailTool,
    },
    memory,
});

export const mastra = new Mastra({
    agents: { topfilerAgent },
    ...(store ? { storage: store } : {}),
});
