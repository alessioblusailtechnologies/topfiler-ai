import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateSql } from '../../sql/generate-sql';
import { guardSql } from '../../sql/sql-guard';
import { rpcRunSelect } from '../../lib/supabase';
import { logSql } from '../../lib/logger';

// ===========================================================================
// Tool 1 — text_to_sql(domanda)
// Genera un SELECT su `documenti` (Anthropic SDK diretto), lo valida col
// SqlGuard, lo esegue sul ruolo read-only e restituisce le righe + il CRITERIO
// applicato in linguaggio naturale (che l'agente deve riportare all'utente).
// Rigenera con feedback su rifiuto del guard o errore di esecuzione (max 2).
// ===========================================================================

const MAX_RETRIES = 2;

export const textToSqlTool = createTool({
    id: 'text_to_sql',
    description:
        'Per conteggi, filtri su date/numeri/enum, aggregazioni e correlazioni tra documenti (es. documenti dello stesso dipendente). Genera ed esegue una query SQL sui metadati strutturati e restituisce le righe trovate PIÙ il criterio applicato in linguaggio naturale. Usalo quando la domanda è precisa e strutturata.',
    inputSchema: z.object({
        domanda: z.string().describe('La domanda dell\'utente da tradurre in SQL (in italiano).'),
    }),
    outputSchema: z.object({
        criterio: z.string(),
        rows: z.array(z.record(z.any())),
        rowCount: z.number(),
        sql: z.string(),
        note: z.string().optional(),
    }),
    execute: async ({ domanda }) => {
        let feedback: string | undefined;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const gen = await generateSql(domanda, feedback);
            const guard = guardSql(gen.sql);

            if (!guard.ok) {
                feedback = `SqlGuard: ${guard.error}`;
                logSql({ domanda, sql: gen.sql, ok: false, error: feedback, retries: attempt });
                continue;
            }

            const startedAt = Date.now();
            try {
                const rows = await rpcRunSelect(guard.sql);
                logSql({ domanda, sql: guard.sql, ok: true, rows: rows.length, durationMs: Date.now() - startedAt, retries: attempt });
                const note = rows.length === 0 ? '0 risultati con questo criterio.' : undefined;
                return { criterio: gen.criterio, rows, rowCount: rows.length, sql: guard.sql, note };
            } catch (e) {
                feedback = `esecuzione: ${(e as Error).message}`;
                logSql({ domanda, sql: guard.sql, ok: false, error: feedback, durationMs: Date.now() - startedAt, retries: attempt });
            }
        }

        return {
            criterio: 'impossibile generare una query valida per questa domanda',
            rows: [],
            rowCount: 0,
            sql: '',
            note: `Generazione SQL fallita dopo ${MAX_RETRIES + 1} tentativi (${feedback ?? 'motivo sconosciuto'}).`,
        };
    },
});
