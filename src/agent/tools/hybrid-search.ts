import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getEmbeddingProvider } from '../../lib/embeddings';
import { rpcMatchChunks } from '../../lib/supabase';

// ===========================================================================
// Tool 2 — hybrid_search(query, tipologia?, filtri_metadata?)
// Ricerca su doc_chunks fondendo similarità coseno (pgvector) e full-text
// italiano (ts_rank) con Reciprocal Rank Fusion, con pre-filtro opzionale su
// tipologia e predicati JSONB di contenimento sul documento padre. Esegue la
// funzione SECURITY DEFINER match_doc_chunks sulla connessione read-only.
// ===========================================================================

export const hybridSearchTool = createTool({
    id: 'hybrid_search',
    description:
        'Per domande a vocabolario aperto ("parla di / riguarda X", concetti, descrizioni testuali). Ricerca semantica + full-text sui contenuti dei documenti, con eventuale pre-filtro su tipologia e metadati. Usalo quando la domanda non è esprimibile come filtro SQL preciso. Si combina con text_to_sql (prima restringi con SQL, poi cerca nel testo).',
    inputSchema: z.object({
        query: z.string().describe('Il testo concettuale da cercare semanticamente.'),
        tipologia: z.string().optional().describe('Pre-filtro opzionale sulla tipologia del documento.'),
        filtri_metadata: z
            .record(z.any())
            .optional()
            .describe('Pre-filtro opzionale di CONTENIMENTO sui metadati del documento padre, es. {"settore":"IT"}.'),
        top_k: z.number().int().positive().max(50).optional().describe('Numero massimo di risultati (default 20).'),
    }),
    outputSchema: z.object({
        results: z.array(
            z.object({
                doc_id: z.string(),
                tipologia: z.string(),
                chunk_type: z.string(),
                riga_index: z.number().nullable(),
                testo: z.string(),
                metadata: z.record(z.any()),
                score: z.number(),
            }),
        ),
        count: z.number(),
    }),
    execute: async ({ query, tipologia, filtri_metadata, top_k }) => {
        const embedding = await getEmbeddingProvider().embedOne(query);

        const rows = await rpcMatchChunks({
            embedding,
            queryText: query,
            matchCount: top_k ?? 20,
            filterTipologia: tipologia ?? null,
            filterMetadata: filtri_metadata ?? {},
        });

        const results = rows.map((r) => ({
            doc_id: String(r['doc_id']),
            tipologia: String(r['tipologia']),
            chunk_type: String(r['chunk_type']),
            riga_index: (r['riga_index'] as number | null) ?? null,
            testo: String(r['testo'] ?? ''),
            metadata: (r['metadata'] as Record<string, unknown>) ?? {},
            score: Number(r['score'] ?? 0),
        }));

        return { results, count: results.length };
    },
});
