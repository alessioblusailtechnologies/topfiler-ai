import { getEmbeddingProvider } from '../lib/embeddings';
import { rpcMatchChunks, getDocsMetaByIds } from '../lib/supabase';

// ===========================================================================
// searchDocuments — adattatore "lista documenti" sopra lo stesso motore di
// ricerca ibrida (RRF) usato dall'agente conversazionale. Mentre il tool
// hybrid_search ritorna i CHUNK migliori, questa funzione li AGGREGA per
// documento (best score per doc, chunk corrispondenti, metadati e link al file)
// per alimentare una vista a tabella in stile vecchio POC topFiler.
// ===========================================================================

export interface MatchingChunk {
    chunk_type: string;
    riga_index: number | null;
    testo: string;
    score: number;
    score_percent: number;
}

export interface SearchDocResult {
    doc_id: string;
    tipologia: string;
    filename: string | null;
    downloadable: boolean;
    score: number;
    score_percent: number;
    relevance: 'alta' | 'media' | 'bassa';
    data: string | null;
    snippet: string;
    metadata: Record<string, unknown>;
    matching_chunks: MatchingChunk[];
}

export interface SearchDocsResponse {
    query: string;
    tipologia: string | null;
    results: SearchDocResult[];
    total: number;
    elapsed_ms: number;
}

// Campi candidati per la "data" del documento (in ordine di preferenza). I
// metadati sono eterogenei per tipologia: prendiamo la prima data ISO trovata.
const DATE_FIELDS = [
    'data_documento',
    'data_emissione',
    'data',
    'data_inizio',
    'data_assunzione',
    'data_visita',
    'data_rilascio',
    'data_ordine',
    'data_offerta',
    'data_scadenza',
];

function pickDate(metadata: Record<string, unknown>): string | null {
    for (const k of DATE_FIELDS) {
        const v = metadata[k];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    return null;
}

function relevanceOf(percent: number): 'alta' | 'media' | 'bassa' {
    if (percent >= 66) return 'alta';
    if (percent >= 33) return 'media';
    return 'bassa';
}

function snippetFrom(text: string, max = 220): string {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

interface Accum {
    doc_id: string;
    tipologia: string;
    score: number; // best (primo) chunk
    metadata: Record<string, unknown>;
    chunks: { chunk_type: string; riga_index: number | null; testo: string; score: number }[];
}

export async function searchDocuments(
    query: string,
    tipologia: string | null = null,
    topK = 20,
): Promise<SearchDocsResponse> {
    const started = Date.now();
    const trimmed = query.trim();
    if (!trimmed) {
        return { query, tipologia, results: [], total: 0, elapsed_ms: Date.now() - started };
    }

    const embedding = await getEmbeddingProvider().embedOne(trimmed);
    // Richiediamo più chunk dei documenti desiderati: più chunk dello stesso
    // documento collassano in un'unica riga, quindi sovra-campioniamo.
    const matchCount = Math.min(Math.max(topK, 10) * 5, 120);
    const rows = await rpcMatchChunks({
        embedding,
        queryText: trimmed,
        matchCount,
        filterTipologia: tipologia,
        filterMetadata: {},
    });

    // Aggregazione per documento mantenendo l'ordine (le righe sono già ordinate
    // per score desc, quindi il primo chunk di un doc è il suo migliore).
    const byDoc = new Map<string, Accum>();
    for (const r of rows) {
        const docId = String(r['doc_id']);
        const score = Number(r['score'] ?? 0);
        const chunk = {
            chunk_type: String(r['chunk_type'] ?? ''),
            riga_index: (r['riga_index'] as number | null) ?? null,
            testo: String(r['testo'] ?? ''),
            score,
        };
        const cur = byDoc.get(docId);
        if (cur) {
            cur.chunks.push(chunk);
        } else {
            byDoc.set(docId, {
                doc_id: docId,
                tipologia: String(r['tipologia'] ?? ''),
                score,
                metadata: (r['metadata'] as Record<string, unknown>) ?? {},
                chunks: [chunk],
            });
        }
    }

    const docs = [...byDoc.values()].sort((a, b) => b.score - a.score).slice(0, topK);
    const topScore = docs[0]?.score ?? 0;

    // Metadati di display (filename, storage_path) in un solo round-trip.
    const meta = await getDocsMetaByIds(docs.map((d) => d.doc_id));

    const results: SearchDocResult[] = docs.map((d) => {
        const m = meta.get(d.doc_id);
        const percent = topScore > 0 ? Math.round((d.score / topScore) * 100) : 0;
        const bestChunk = d.chunks[0]?.score ?? 0;
        const matching_chunks: MatchingChunk[] = d.chunks.map((c) => ({
            chunk_type: c.chunk_type,
            riga_index: c.riga_index,
            testo: c.testo,
            score: c.score,
            score_percent: bestChunk > 0 ? Math.round((c.score / bestChunk) * 100) : 0,
        }));
        return {
            doc_id: d.doc_id,
            tipologia: d.tipologia,
            filename: m?.filename ?? null,
            downloadable: !!m?.storage_path,
            score: d.score,
            score_percent: percent,
            relevance: relevanceOf(percent),
            data: pickDate(d.metadata),
            snippet: snippetFrom(d.chunks[0]?.testo ?? ''),
            metadata: d.metadata,
            matching_chunks,
        };
    });

    return { query, tipologia, results, total: results.length, elapsed_ms: Date.now() - started };
}
