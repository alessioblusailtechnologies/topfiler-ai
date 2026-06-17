import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as WsWebSocket } from 'ws';
import { env, requireSupabase } from '../env';

// supabase-js 2.108+ (modulo realtime) pretende un `WebSocket` GLOBALE: su
// Node < 22 non esiste e i tool (rpc/from) falliscono con "Node.js 20 detected
// without native WebSocket support". Forniamo un polyfill, così il backend
// funziona su qualunque versione di Node a prescindere dal runtime di Render.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
    (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}

// ===========================================================================
// Client Supabase con SERVICE ROLE. Usato per:
//   - ingestion: scrittura di documenti e chunk (Postgres via PostgREST)
//   - storage:   upload dei file e generazione delle signed URL
// NON usato dal tool text_to_sql (quello passa dalla connessione pg read-only).
// ===========================================================================

const DOCS = 'topfiler_final_ai_documenti';
const CHUNKS = 'topfiler_final_ai_doc_chunks';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!client) {
        const { url, key } = requireSupabase();
        client = createClient(url, key, { auth: { persistSession: false } });
    }
    return client;
}

export function storageBucket(): string {
    return env.SUPABASE_STORAGE_BUCKET;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function uploadFile(path: string, buffer: Buffer, contentType: string | null): Promise<void> {
    const sb = getSupabase();
    const { error } = await sb.storage.from(storageBucket()).upload(path, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true,
    });
    if (error) throw new Error(`storage.upload(${path}): ${error.message}`);
}

/** Crea (o aggiorna) il bucket privato. Ritorna true se creato ora. */
export async function ensureBucket(): Promise<boolean> {
    const sb = getSupabase();
    const opts = { public: false, fileSizeLimit: 52_428_800 }; // 50 MB (limite globale del progetto)
    const { error } = await sb.storage.createBucket(storageBucket(), opts);
    if (!error) return true;
    if (/already exists|exists/i.test(error.message)) {
        await sb.storage.updateBucket(storageBucket(), opts).catch(() => {});
        return false;
    }
    throw new Error(`createBucket(${storageBucket()}): ${error.message}`);
}

export async function createSignedUrl(path: string, expiresInSeconds = 600): Promise<string> {
    const sb = getSupabase();
    const { data, error } = await sb.storage.from(storageBucket()).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`storage.createSignedUrl(${path}): ${error?.message ?? 'no data'}`);
    return data.signedUrl;
}

/** Scarica un file da Storage e lo ritorna come base64 (per gli allegati email). */
export async function downloadFileBase64(path: string): Promise<{ base64: string; filename: string }> {
    const sb = getSupabase();
    const { data, error } = await sb.storage.from(storageBucket()).download(path);
    if (error || !data) throw new Error(`storage.download(${path}): ${error?.message ?? 'no data'}`);
    const buf = Buffer.from(await data.arrayBuffer());
    return { base64: buf.toString('base64'), filename: path.split('/').pop() || 'allegato' };
}

// ---------------------------------------------------------------------------
// Scrittura ingestion (service role)
// ---------------------------------------------------------------------------

export interface DocumentoRow {
    id: string;
    tipologia: string;
    metadata: Record<string, unknown>;
    storage_path: string | null;
    source_oracle_id: string | null;
    filename: string | null;
    mime_type: string | null;
    hash_sha256: string | null;
    stato_ingestion: 'VALIDATO' | 'DA_REVISIONARE' | 'ERRORE';
    confidence: number | null;
}

export interface ChunkRow {
    testo: string;
    embedding: number[] | null;
    chunk_type: 'CONTENUTO' | 'RIGA';
    riga_index: number | null;
}

export async function existsByHash(hash: string): Promise<boolean> {
    if (!hash) return false;
    const sb = getSupabase();
    const { data, error } = await sb.from(DOCS).select('id').eq('hash_sha256', hash).limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
}

/** Sollevato quando l'hash è già presente (es. due doc identici processati in parallelo). */
export class DuplicateHashError extends Error {}

export async function insertDocumento(row: DocumentoRow): Promise<string> {
    const sb = getSupabase();
    const { data, error } = await sb.from(DOCS).insert(row).select('id').single();
    if (error) {
        // 23505 = unique_violation (race sulla dedup per hash sotto concorrenza).
        if ((error as { code?: string }).code === '23505' || /duplicate key|hash_sha256/.test(error.message)) {
            throw new DuplicateHashError(error.message);
        }
        throw new Error(`insert documento: ${error.message}`);
    }
    return (data as { id: string }).id;
}

export async function insertChunks(docId: string, chunks: ChunkRow[]): Promise<void> {
    if (!chunks.length) return;
    const sb = getSupabase();
    const rows = chunks.map((c) => ({
        doc_id: docId,
        testo: c.testo,
        // pgvector via PostgREST accetta il formato testuale '[...]'
        embedding: c.embedding ? JSON.stringify(c.embedding) : null,
        chunk_type: c.chunk_type,
        riga_index: c.riga_index,
    }));
    for (let i = 0; i < rows.length; i += 100) {
        const { error } = await sb.from(CHUNKS).insert(rows.slice(i, i + 100));
        if (error) throw new Error(`insert chunks (doc ${docId}): ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// Lettura runtime via supabase-js (tool dell'agente) — niente connessione pg
// diretta. text_to_sql passa da una RPC SECURITY DEFINER (run_select) di proprietà
// di un ruolo con solo SELECT; hybrid_search dalla RPC RRF. get_document legge la
// riga e genera la signed URL.
// ---------------------------------------------------------------------------

/** Esegue una SELECT (già validata dal SqlGuard) via RPC e ritorna le righe. */
export async function rpcRunSelect(sql: string): Promise<Record<string, unknown>[]> {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('topfiler_final_ai_run_select', { q: sql });
    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]) ?? [];
}

/** Invoca la funzione RRF di ricerca ibrida via RPC. */
export async function rpcMatchChunks(p: {
    embedding: number[];
    queryText: string;
    matchCount: number;
    filterTipologia: string | null;
    filterMetadata: Record<string, unknown>;
}): Promise<Record<string, unknown>[]> {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('topfiler_final_ai_match_doc_chunks', {
        query_embedding: JSON.stringify(p.embedding), // pgvector accetta il testo '[...]'
        query_text: p.queryText,
        match_count: p.matchCount,
        filter_tipologia: p.filterTipologia,
        filter_metadata: p.filterMetadata ?? {},
    });
    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]) ?? [];
}

export interface DocumentRow {
    id: string;
    tipologia: string;
    filename: string | null;
    storage_path: string | null;
    metadata: Record<string, unknown>;
}

/** Metadati di display (filename, storage_path) per un insieme di doc_id. */
export async function getDocsMetaByIds(
    ids: string[],
): Promise<Map<string, { filename: string | null; storage_path: string | null }>> {
    const out = new Map<string, { filename: string | null; storage_path: string | null }>();
    if (!ids.length) return out;
    const sb = getSupabase();
    const { data, error } = await sb.from(DOCS).select('id, filename, storage_path').in('id', ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; filename: string | null; storage_path: string | null }>) {
        out.set(r.id, { filename: r.filename, storage_path: r.storage_path });
    }
    return out;
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
    const sb = getSupabase();
    const { data, error } = await sb
        .from(DOCS)
        .select('id, tipologia, filename, storage_path, metadata')
        .eq('id', id)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as DocumentRow) ?? null;
}

export interface StorageBackfillRow {
    id: string;
    tipologia: string;
    source_oracle_id: string;
    mime_type: string | null;
}

/** Documenti già ingeriti ma senza file su Storage (per il backfill sync:storage). */
export async function documentsNeedingStorage(): Promise<StorageBackfillRow[]> {
    const sb = getSupabase();
    const { data, error } = await sb
        .from(DOCS)
        .select('id, tipologia, source_oracle_id, mime_type')
        .is('storage_path', null)
        .not('source_oracle_id', 'is', null)
        .limit(100_000);
    if (error) throw new Error(`documentsNeedingStorage: ${error.message}`);
    return (data ?? []) as StorageBackfillRow[];
}

export async function setStoragePath(id: string, path: string): Promise<void> {
    const sb = getSupabase();
    const { error } = await sb.from(DOCS).update({ storage_path: path }).eq('id', id);
    if (error) throw new Error(`setStoragePath(${id}): ${error.message}`);
}

/** Valori distinti di dipendente_nome_norm già presenti (per la deduplica nomi). */
export async function distinctEmployeeNames(): Promise<string[]> {
    const sb = getSupabase();
    const { data, error } = await sb.from(DOCS).select('metadata').limit(10_000);
    if (error) return [];
    const set = new Set<string>();
    for (const r of (data ?? []) as Array<{ metadata: Record<string, unknown> }>) {
        const name = r.metadata?.['dipendente_nome_norm'];
        if (typeof name === 'string' && name.trim()) set.add(name);
    }
    return [...set];
}
