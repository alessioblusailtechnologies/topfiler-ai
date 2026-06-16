import { requireOracle, env } from '../env';
import { log } from '../lib/logger';
import type { RawDocument } from './types';

// ===========================================================================
// Sorgente Oracle (SOLA LETTURA): legge i BLOB + metadati dal documentale.
// Replica le query del documentale topfiler (DOCLIGHT.TD000_DOC +
// TD001_DOC_DET, contenuto via FN_GET_DOC_CONTENT che unifica BLOB e BFILE).
// Lettura PAGINATA con cursore: non carica tutto in memoria.
// node-oracledb è importato dinamicamente, così il server (che non usa Oracle)
// non richiede il driver installato per partire.
// ===========================================================================

const PAGE_SQL = `
    SELECT * FROM (
        SELECT
            d.NAME                              AS nome_file,
            d.MIME_TYPE                         AS mime_type,
            DOCLIGHT.FN_GET_DOC_CONTENT(d.NAME) AS file_content,
            det.CD_TIP                          AS tipo,
            ROW_NUMBER() OVER (ORDER BY det.DT_INS DESC, d.NAME) AS rn
        FROM DOCLIGHT.TD000_DOC d
        JOIN DOCLIGHT.TD001_DOC_DET det ON det.CD_DOC = d.NAME
    )
    WHERE rn > :lo AND rn <= :hi`;

export async function* oracleSource(opts: { limit?: number; pageSize?: number } = {}): AsyncGenerator<RawDocument> {
    const { user, password, connectString } = requireOracle();
    const pageSize = opts.pageSize ?? env.INGEST_BATCH_SIZE;
    const limit = opts.limit ?? 0;

    const { default: oracledb } = await import('oracledb');
    const pool = await oracledb.createPool({ user, password, connectString, poolMin: 1, poolMax: 4, poolIncrement: 1 });
    log.info('oracle.connected', { connectString });

    try {
        let offset = 0;
        let emitted = 0;
        for (;;) {
            const hi = limit ? Math.min(offset + pageSize, limit) : offset + pageSize;
            if (limit && offset >= limit) break;

            const conn = await pool.getConnection();
            let rows: Record<string, unknown>[];
            try {
                // BLOB restituito come Lob: lo materializziamo con getData() più sotto
                // (evita le incompatibilità di tipo di fetchInfo tra versioni del driver).
                const res = await conn.execute(
                    PAGE_SQL,
                    { lo: offset, hi },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                rows = (res.rows as Record<string, unknown>[]) ?? [];
            } finally {
                await conn.close();
            }

            if (rows.length === 0) break;

            for (const row of rows) {
                let buffer = row['FILE_CONTENT'] as Buffer | { getData?: () => Promise<Buffer> } | null;
                if (buffer && typeof (buffer as { getData?: unknown }).getData === 'function') {
                    buffer = await (buffer as { getData: () => Promise<Buffer> }).getData();
                }
                yield {
                    sourceOracleId: String(row['NOME_FILE'] ?? ''),
                    filename: String(row['NOME_FILE'] ?? 'documento'),
                    mimeHint: (row['MIME_TYPE'] as string) || null,
                    buffer: (buffer as Buffer) ?? Buffer.alloc(0),
                    tipologiaHint: (row['TIPO'] as string) || null,
                };
                emitted++;
                if (limit && emitted >= limit) return;
            }

            offset = hi;
        }
    } finally {
        await pool.close(0);
        log.info('oracle.closed', {});
    }
}
