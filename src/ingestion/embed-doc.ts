import { getEmbeddingProvider } from '../lib/embeddings';
import { chunkText } from '../lib/text';
import type { EmbedStrategy } from '../config/registry';
import type { ChunkRow } from '../lib/supabase';

// ===========================================================================
// Step 8 — Embedding selettivo secondo embed_strategy:
//   FULL  → chunking (recursive splitter ~500 token) → chunk CONTENUTO
//   RIGHE → un chunk per riga (la sola descrizione) → chunk RIGA + riga_index
//   NONE  → nessun embedding
// A ogni chunk si antepone, SOLO per il vettore, un header distintivo (tipologia
// + metadati identificativi): su un corpus con template quasi identici evita il
// collasso dei vettori. Il `testo` salvato resta quello pulito del chunk.
// ===========================================================================

export async function embedDocument(input: {
    embedStrategy: EmbedStrategy;
    tipologia: string;
    fullText: string;
    metadata: Record<string, unknown>;
}): Promise<ChunkRow[]> {
    const { embedStrategy, tipologia, fullText, metadata } = input;
    if (embedStrategy === 'NONE') return [];

    const header = buildHeader(tipologia, metadata);
    const provider = getEmbeddingProvider();

    if (embedStrategy === 'FULL') {
        const pieces = chunkText(fullText);
        if (!pieces.length) return [];
        const embedTexts = pieces.map((p) => `${header}\n\n${p}`.slice(0, 14_000));
        const vectors = await provider.embed(embedTexts);
        return pieces.map((testo, i) => ({
            testo,
            embedding: vectors[i] ?? null,
            chunk_type: 'CONTENUTO' as const,
            riga_index: null,
        }));
    }

    // RIGHE
    const righe = Array.isArray(metadata['righe']) ? (metadata['righe'] as Array<Record<string, unknown>>) : [];
    const descr = righe.map((r) => String(r?.['descrizione'] ?? '').trim()).filter(Boolean);
    if (!descr.length) return [];
    const embedTexts = descr.map((d) => `${header}\n${d}`.slice(0, 14_000));
    const vectors = await provider.embed(embedTexts);
    return descr.map((testo, i) => ({
        testo,
        embedding: vectors[i] ?? null,
        chunk_type: 'RIGA' as const,
        riga_index: i,
    }));
}

function buildHeader(tipologia: string, metadata: Record<string, unknown>): string {
    const parts = [`Tipo: ${tipologia}.`];
    for (const key of ['controparte', 'fornitore', 'numero', 'dipendente_nome_norm', 'prodotto', 'campagna', 'oggetto']) {
        const v = metadata[key];
        if (typeof v === 'string' && v.trim()) parts.push(`${key}: ${v}.`);
    }
    return parts.join(' ');
}
