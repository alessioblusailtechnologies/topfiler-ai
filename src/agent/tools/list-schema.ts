import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { allEntries } from '../../config/registry';

// ===========================================================================
// Tool 4 — list_schema()
// Restituisce tipologie e campi disponibili dal registry, così l'agente può
// spiegare all'utente cosa è interrogabile.
// ===========================================================================

export const listSchemaTool = createTool({
    id: 'list_schema',
    description:
        'Elenca le tipologie di documento e i campi interrogabili (dal registry). Usalo quando l\'utente chiede "cosa puoi cercare", "che documenti ci sono", o per capire quali campi sono disponibili prima di interrogare.',
    inputSchema: z.object({}),
    outputSchema: z.object({
        tipologie: z.array(
            z.object({
                tipologia: z.string(),
                descrizione: z.string(),
                embed_strategy: z.string(),
                campi: z.array(z.string()),
            }),
        ),
    }),
    execute: async () => {
        const tipologie = allEntries().map((e) => {
            const props = (e.json_schema as { properties?: Record<string, unknown> }).properties ?? {};
            return {
                tipologia: e.tipologia,
                descrizione: e.descrizione,
                embed_strategy: e.embed_strategy,
                campi: Object.keys(props),
            };
        });
        return { tipologie };
    },
});
