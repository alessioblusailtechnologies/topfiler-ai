import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDocumentById, createSignedUrl } from '../../lib/supabase';

// ===========================================================================
// Tool 3 — get_document(doc_id)
// Genera una signed URL temporanea da Supabase Storage e la restituisce con i
// metadati. È il tool che chiude le domande "estrai/estrapola". Il documento è
// letto dalla connessione read-only; la signed URL è generata via Storage.
// ===========================================================================

export const getDocumentTool = createTool({
    id: 'get_document',
    description:
        'Quando l\'utente chiede di ESTRARRE/ESTRAPOLARE/aprire/scaricare un documento, chiama questo tool con il doc_id (preso dai risultati di text_to_sql o hybrid_search) per ottenere un link temporaneo al file e i suoi metadati.',
    inputSchema: z.object({
        doc_id: z.string().describe('id del documento (uuid), preso dai risultati di un altro tool.'),
        expires_in: z.number().int().positive().max(3600).optional().describe('Validità del link in secondi (default 600).'),
    }),
    outputSchema: z.object({
        found: z.boolean(),
        doc_id: z.string(),
        tipologia: z.string().optional(),
        filename: z.string().nullable().optional(),
        signed_url: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        note: z.string().optional(),
    }),
    execute: async ({ doc_id, expires_in }) => {
        const doc = await getDocumentById(doc_id);
        if (!doc) {
            return { found: false, doc_id, note: `Nessun documento con id ${doc_id}.` };
        }
        if (!doc.storage_path) {
            return { found: true, doc_id, tipologia: doc.tipologia, filename: doc.filename, metadata: doc.metadata, note: 'Documento senza file su storage.' };
        }
        try {
            const signed_url = await createSignedUrl(doc.storage_path, expires_in ?? 600);
            return { found: true, doc_id, tipologia: doc.tipologia, filename: doc.filename, signed_url, metadata: doc.metadata };
        } catch (e) {
            return { found: true, doc_id, tipologia: doc.tipologia, filename: doc.filename, metadata: doc.metadata, note: `signed URL non disponibile: ${(e as Error).message}` };
        }
    },
});
