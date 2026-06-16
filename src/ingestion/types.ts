// ===========================================================================
// Tipi condivisi dalla pipeline di ingestion.
// RawDocument è il contratto comune tra la sorgente Oracle e l'upload manuale
// (POST /api/ingest): entrambi alimentano lo stesso orchestratore.
// ===========================================================================

export interface RawDocument {
    sourceOracleId: string | null;
    filename: string;
    mimeHint: string | null;
    buffer: Buffer;
    /** Tipologia eventualmente nota dalla sorgente (hint, da verificare in classificazione). */
    tipologiaHint: string | null;
}

export type StatoIngestion = 'VALIDATO' | 'DA_REVISIONARE' | 'ERRORE';

export interface IngestResult {
    id: string | null;
    sourceOracleId: string | null;
    filename: string;
    tipologia: string | null;
    status: StatoIngestion | 'DUPLICATE';
    confidence: number | null;
    chunks: number;
    note?: string;
}
