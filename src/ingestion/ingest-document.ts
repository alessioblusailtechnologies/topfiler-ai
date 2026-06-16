import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import { sha256 } from '../lib/text';
import { log } from '../lib/logger';
import { env } from '../env';
import { getEntry, allTipologie } from '../config/registry';
import {
    existsByHash,
    insertDocumento,
    insertChunks,
    uploadFile,
    distinctEmployeeNames,
    DuplicateHashError,
    type DocumentoRow,
} from '../lib/supabase';
import { extractText } from './extract-text';
import { getOcrProvider } from './ocr';
import { classifyDocument } from './classify';
import { extractMetadata } from './extract-metadata';
import { applySanityRules } from './sanity';
import { normalizeEmployee } from './normalize-employee';
import { embedDocument } from './embed-doc';
import type { RawDocument, IngestResult, StatoIngestion } from './types';

// ===========================================================================
// Orchestratore per singolo documento: chiama gli step in sequenza.
// Ordine effettivo: dedup → estrai testo → classifica → upload storage →
// estrai metadati → sanità → normalizza dipendente → embed → salva.
// (L'upload avviene DOPO la classificazione per usare la tipologia definitiva
// nel path; il BLOB resta in memoria, quindi Oracle non è più necessario —
// vedi DECISIONS.md.)
// ===========================================================================

export interface IngestContext {
    /** Insieme condiviso dei nomi dipendente canonici (per la deduplica). */
    nameRegistry: Set<string>;
    force?: boolean;
}

export async function ingestDocument(raw: RawDocument, ctx: IngestContext): Promise<IngestResult> {
    const base: Pick<IngestResult, 'sourceOracleId' | 'filename'> = {
        sourceOracleId: raw.sourceOracleId,
        filename: raw.filename,
    };

    if (!raw.buffer || raw.buffer.length === 0) {
        return { ...base, id: null, tipologia: null, status: 'ERRORE', confidence: null, chunks: 0, note: 'buffer vuoto' };
    }

    // 1. dedup idempotente
    const hash = sha256(raw.buffer);
    if (!ctx.force && (await existsByHash(hash))) {
        return { ...base, id: null, tipologia: null, status: 'DUPLICATE', confidence: null, chunks: 0 };
    }

    const id = randomUUID();

    // 2. estrazione testo
    let ext = await extractText(raw.buffer, { filename: raw.filename, mimeHint: raw.mimeHint });
    let ocrUsed = false;

    // 2b. OCR (Mistral) per scansioni/immagini senza testo estraibile. Salta le
    // immagini molto piccole (probabili icone/asset, non documenti).
    if (!ext.indexable && ext.needsOcr && env.OCR_ENABLED && raw.buffer.length >= 6000) {
        try {
            const ocrText = await getOcrProvider().extract(raw.buffer, { mime: ext.mime ?? '', filename: raw.filename });
            if (ocrText && ocrText.trim().length >= 20) {
                ext = { ...ext, text: ocrText.trim(), indexable: true, needsOcr: false, method: 'mistral-ocr' };
                ocrUsed = true;
            }
        } catch (e) {
            log.warn('ocr.failed', { filename: raw.filename, error: (e as Error).message });
        }
    }

    // Scansione/immagine ancora senza testo: tracciala comunque, DA_REVISIONARE.
    if (!ext.indexable) {
        const tipologia = isKnown(raw.tipologiaHint) ? raw.tipologiaHint! : 'MANUALE';
        const storagePath = await safeUpload(id, tipologia, raw, ext.mime);
        try {
            await insertDocumento(rowOf({
                id, tipologia, metadata: {}, storagePath, raw, mime: ext.mime, hash,
                stato: 'DA_REVISIONARE', confidence: null,
            }));
        } catch (e) {
            if (e instanceof DuplicateHashError) return duplicateResult(base, tipologia);
            throw e;
        }
        return { ...base, id, tipologia, status: 'DA_REVISIONARE', confidence: null, chunks: 0, note: 'OCR richiesto' };
    }

    // 4. classificazione
    const cls = await classifyDocument({ text: ext.text, filename: raw.filename, tipologiaHint: raw.tipologiaHint });
    const tipologia = cls.tipologia;
    const entry = getEntry(tipologia);

    // 3/2. upload su storage con la tipologia definitiva
    const storagePath = await safeUpload(id, tipologia, raw, ext.mime);

    // 5. estrazione metadati (tool use forzato, schema = registry; AJV + 1 retry)
    const extr = await extractMetadata({ tipologia, text: ext.text });

    // 6. regole di sanità deterministiche
    const sane = applySanityRules(tipologia, extr.metadata);

    // 7. normalizzazione dipendente (HR) + deduplica via Levenshtein
    const norm = normalizeEmployee(sane.metadata, [...ctx.nameRegistry]);
    if (typeof norm.metadata['dipendente_nome_norm'] === 'string') {
        ctx.nameRegistry.add(norm.metadata['dipendente_nome_norm']);
    }
    const metadata = norm.metadata;

    // 8. embedding selettivo
    let chunks: Awaited<ReturnType<typeof embedDocument>> = [];
    try {
        chunks = await embedDocument({ embedStrategy: entry.embed_strategy, tipologia, fullText: ext.text, metadata });
    } catch (e) {
        log.warn('embed.failed', { id, tipologia, error: (e as Error).message });
    }

    // 9. confidenza finale e stato
    const confidence = Math.min(cls.confidence, extr.confidence);
    const notes: string[] = [];
    if (ocrUsed) notes.push('testo da OCR (Mistral)');
    if (!extr.valid) notes.push('metadati non conformi allo schema');
    if (sane.violations.length) notes.push(...sane.violations);
    if (norm.ambiguous && norm.note) notes.push(norm.note);

    let stato: StatoIngestion = 'VALIDATO';
    if (!extr.valid || sane.violations.length > 0 || norm.ambiguous || confidence < env.CONFIDENCE_THRESHOLD) {
        stato = 'DA_REVISIONARE';
        if (confidence < env.CONFIDENCE_THRESHOLD) notes.push(`confidenza ${confidence.toFixed(2)} < soglia ${env.CONFIDENCE_THRESHOLD}`);
    }

    // 10. salvataggio
    try {
        await insertDocumento(rowOf({ id, tipologia, metadata, storagePath, raw, mime: ext.mime, hash, stato, confidence }));
    } catch (e) {
        if (e instanceof DuplicateHashError) return duplicateResult(base, tipologia);
        throw e;
    }
    if (chunks.length) await insertChunks(id, chunks);

    return {
        ...base,
        id,
        tipologia,
        status: stato,
        confidence,
        chunks: chunks.length,
        note: notes.length ? notes.join('; ') : undefined,
    };
}

// ---------------------------------------------------------------------------
// Runner batch con concorrenza limitata (p-limit). Consuma la sorgente
// (async generator) in streaming: paginazione lato sorgente, fan-out qui.
// ---------------------------------------------------------------------------

export async function ingestAll(
    source: AsyncIterable<RawDocument>,
    opts: { concurrency?: number; force?: boolean; onResult?: (r: IngestResult) => void } = {},
): Promise<{ stats: Record<string, number>; results: IngestResult[] }> {
    const limit = pLimit(opts.concurrency ?? env.INGEST_CONCURRENCY);
    const nameRegistry = new Set<string>(await distinctEmployeeNames());
    const ctx: IngestContext = { nameRegistry, force: opts.force ?? false };

    const stats: Record<string, number> = { total: 0, VALIDATO: 0, DA_REVISIONARE: 0, ERRORE: 0, DUPLICATE: 0, chunks: 0 };
    const results: IngestResult[] = [];
    const pending: Promise<void>[] = [];

    for await (const raw of source) {
        stats['total'] = (stats['total'] ?? 0) + 1;
        pending.push(
            limit(async () => {
                let r: IngestResult;
                try {
                    r = await ingestDocument(raw, ctx);
                } catch (e) {
                    r = {
                        sourceOracleId: raw.sourceOracleId,
                        filename: raw.filename,
                        id: null,
                        tipologia: null,
                        status: 'ERRORE',
                        confidence: null,
                        chunks: 0,
                        note: (e as Error).message,
                    };
                }
                stats[r.status] = (stats[r.status] ?? 0) + 1;
                stats['chunks'] = (stats['chunks'] ?? 0) + r.chunks;
                results.push(r);
                opts.onResult?.(r);
            }),
        );
    }

    await Promise.all(pending);
    return { stats, results };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isKnown(t: string | null): boolean {
    return !!t && allTipologie().includes(t);
}

function duplicateResult(
    base: Pick<IngestResult, 'sourceOracleId' | 'filename'>,
    tipologia: string | null,
): IngestResult {
    return { ...base, id: null, tipologia, status: 'DUPLICATE', confidence: null, chunks: 0, note: 'hash già presente (race concorrenza)' };
}

async function safeUpload(id: string, tipologia: string, raw: RawDocument, mime: string | null): Promise<string | null> {
    const safeName = raw.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'documento';
    const path = `${tipologia}/${id}/${safeName}`;
    try {
        await uploadFile(path, raw.buffer, mime);
        return path;
    } catch (e) {
        // Storage opzionale: se il bucket non esiste / mancano i permessi, si
        // procede senza file (storage_path null), il documento resta indicizzato.
        log.warn('storage.upload.skipped', { id, error: (e as Error).message });
        return null;
    }
}

function rowOf(p: {
    id: string;
    tipologia: string;
    metadata: Record<string, unknown>;
    storagePath: string | null;
    raw: RawDocument;
    mime: string | null;
    hash: string;
    stato: StatoIngestion;
    confidence: number | null;
}): DocumentoRow {
    return {
        id: p.id,
        tipologia: p.tipologia,
        metadata: p.metadata,
        storage_path: p.storagePath,
        source_oracle_id: p.raw.sourceOracleId,
        filename: p.raw.filename,
        mime_type: p.mime,
        hash_sha256: p.hash,
        stato_ingestion: p.stato,
        confidence: p.confidence,
    };
}
