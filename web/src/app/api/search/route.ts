import { NextRequest } from 'next/server';
import { backendUrl } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/search — proxy verso il backend topFiler3 (/api/search). Stesso
// motore di ricerca ibrida dell'assistente, ma con output a lista di documenti.
export async function POST(req: NextRequest) {
    let body: { query?: string; tipologia?: string | null; top_k?: number };
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'JSON non valido' }, { status: 400 });
    }
    const query = (body.query ?? '').trim();
    if (!query) return Response.json({ error: 'query richiesta' }, { status: 400 });

    try {
        const res = await fetch(`${backendUrl()}/api/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, tipologia: body.tipologia ?? null, top_k: body.top_k ?? 20 }),
        });
        const json = await res.json();
        return Response.json(json, { status: res.status });
    } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 502 });
    }
}
