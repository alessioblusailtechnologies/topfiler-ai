import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { env } from '../env';
import { log } from '../lib/logger';
import { topfilerAgent, hasMemory } from '../mastra/index';
import { ingestDocument } from '../ingestion/ingest-document';
import { distinctEmployeeNames } from '../lib/supabase';
import { searchDocuments } from '../search/search-docs';

// ===========================================================================
// Server HTTP minimale (Hono):
//   POST /api/chat    → invoca l'agente Mastra con la history per sessione
//   POST /api/ingest  → upload manuale di un file, riusa l'orchestratore di
//                       ingestion saltando lo step di lettura da Oracle
//   GET  /api/health  → liveness
// In sviluppo si può usare anche `npm run mastra:dev` (playground Mastra).
// ===========================================================================

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, agent: 'topFiler3' }));

app.post('/api/chat', async (c) => {
    let body: { sessionId?: string; message?: string };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'JSON non valido' }, 400);
    }
    if (!body.message) return c.json({ error: 'campo "message" richiesto' }, 400);

    const sessionId = body.sessionId?.trim() || 'anon';
    try {
        // history per sessione via memory di Mastra, se configurata (MASTRA_DATABASE_URL).
        const res = hasMemory
            ? await topfilerAgent.generate(body.message, { memory: { thread: sessionId, resource: sessionId } })
            : await topfilerAgent.generate(body.message);
        return c.json({ sessionId, text: res.text });
    } catch (e) {
        log.error('chat.failed', { sessionId, error: (e as Error).message });
        return c.json({ error: (e as Error).message }, 500);
    }
});

// Streaming SSE per il client web. Riceve l'intera conversazione (history +
// nuovo messaggio utente) così il contesto multi-turno funziona anche senza la
// memory di Mastra. Emette eventi: {type:'text',content} ... {type:'done'} / {type:'error'}.
interface ChatMsg { role: 'user' | 'assistant'; content: string }

function describeTool(name: string): string {
    switch (name) {
        case 'text_to_sql': return "Sto interrogando l'archivio (query strutturata sui metadati)…";
        case 'hybrid_search': return 'Sto cercando nei documenti (ricerca semantica)…';
        case 'get_document': return 'Sto recuperando il documento…';
        case 'list_schema': return 'Sto consultando le tipologie disponibili…';
        default: return "Sto consultando l'archivio…";
    }
}

app.post('/api/chat/stream', async (c) => {
    let body: { messages?: ChatMsg[]; message?: string };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'JSON non valido' }, 400);
    }
    const history = Array.isArray(body.messages) ? body.messages.filter((m) => m && m.role && m.content) : [];
    if (body.message) history.push({ role: 'user', content: body.message });
    if (history.length === 0) return c.json({ error: 'nessun messaggio' }, 400);

    return streamSSE(c, async (stream) => {
        try {
            const res = await topfilerAgent.stream(history as never);
            // fullStream espone gli eventi dei tool: emettiamo uno STATUS leggibile
            // durante l'esecuzione (così l'utente non vede una pausa muta), poi il testo.
            const full = res.fullStream as AsyncIterable<{ type: string; payload?: Record<string, unknown> }>;
            for await (const chunk of full) {
                const p = chunk.payload ?? {};
                if (chunk.type === 'tool-call-input-streaming-start') {
                    await stream.writeSSE({ data: JSON.stringify({ type: 'status', content: describeTool(p['toolName'] as string) }) });
                } else if (chunk.type === 'tool-result') {
                    await stream.writeSSE({ data: JSON.stringify({ type: 'status', content: 'Sto elaborando i risultati…' }) });
                } else if (chunk.type === 'text-delta') {
                    const t = p['text'] as string;
                    if (t) await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: t }) });
                }
            }
            await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
        } catch (e) {
            log.error('chat.stream.failed', { error: (e as Error).message });
            await stream.writeSSE({ data: JSON.stringify({ type: 'error', content: (e as Error).message }) });
        }
    });
});

// Ricerca "lista documenti" (stesso motore RRF dell'agente, output a tabella).
app.post('/api/search', async (c) => {
    let body: { query?: string; tipologia?: string | null; top_k?: number };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'JSON non valido' }, 400);
    }
    const query = (body.query ?? '').trim();
    if (!query) return c.json({ error: 'campo "query" richiesto' }, 400);
    const topK = Number.isFinite(body.top_k) ? Math.min(Math.max(Number(body.top_k), 1), 50) : 20;
    try {
        const res = await searchDocuments(query, body.tipologia?.trim() || null, topK);
        return c.json(res);
    } catch (e) {
        log.error('search.failed', { query, error: (e as Error).message });
        return c.json({ error: (e as Error).message }, 500);
    }
});

app.post('/api/ingest', async (c) => {
    let form: Record<string, unknown>;
    try {
        form = await c.req.parseBody();
    } catch {
        return c.json({ error: 'atteso multipart/form-data con campo "file"' }, 400);
    }
    const file = form['file'];
    if (!(file instanceof File)) return c.json({ error: 'campo "file" mancante o non valido' }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const nameRegistry = new Set<string>(await distinctEmployeeNames());

    try {
        const result = await ingestDocument(
            {
                sourceOracleId: null,
                filename: file.name || 'documento',
                mimeHint: file.type || null,
                buffer,
                tipologiaHint: (form['tipologia'] as string) || null,
            },
            { nameRegistry },
        );
        return c.json(result);
    } catch (e) {
        log.error('ingest.failed', { filename: file.name, error: (e as Error).message });
        return c.json({ error: (e as Error).message }, 500);
    }
});

serve({ fetch: app.fetch, port: env.PORT });
log.info('server.listening', { port: env.PORT });
