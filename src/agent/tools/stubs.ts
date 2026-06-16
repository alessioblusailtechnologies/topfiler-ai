import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ===========================================================================
// Tool predisposti (interfacce + stub): web_search e create_file per la
// generazione di report. La forma è definitiva; l'implementazione è fuori scope.
// ===========================================================================

export const webSearchTool = createTool({
    id: 'web_search',
    description: 'Ricerca sul web (PREDISPOSTO, non ancora implementato). Usalo solo se esplicitamente abilitato.',
    inputSchema: z.object({
        query: z.string().describe('Query di ricerca web.'),
    }),
    outputSchema: z.object({
        results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
        note: z.string().optional(),
    }),
    execute: async () => ({ results: [], note: 'web_search non implementato (stub).' }),
});

export const createFileTool = createTool({
    id: 'create_file',
    description: 'Genera un file di report a partire da un contenuto (PREDISPOSTO, non ancora implementato).',
    inputSchema: z.object({
        filename: z.string().describe('Nome del file da generare.'),
        content: z.string().describe('Contenuto testuale/markdown del report.'),
    }),
    outputSchema: z.object({
        path: z.string().optional(),
        note: z.string().optional(),
    }),
    execute: async () => ({ note: 'create_file non implementato (stub).' }),
});
