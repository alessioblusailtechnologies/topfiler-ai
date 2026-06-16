import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/logger';
import type { RawDocument } from './types';

// ===========================================================================
// Sorgente FILESYSTEM: legge i documenti da una cartella locale (per ora il
// campione in topfiler-ai/docs_in_db), in alternativa a Oracle (che richiede
// la VPN). Stessa interfaccia RawDocument dell'oracleSource.
// ===========================================================================

const MIME_BY_EXT: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.xml': 'text/xml',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

/** Risolve un path che può essere assoluto o relativo alla ROOT del progetto. */
function resolveFromProjectRoot(dir: string): string {
    const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
    return resolve(projectRoot, dir);
}

export async function* filesystemSource(opts: { dir: string; limit?: number }): AsyncGenerator<RawDocument> {
    const root = resolveFromProjectRoot(opts.dir);
    log.info('filesystem.source', { dir: root });

    let entries: string[];
    try {
        entries = await readdir(root);
    } catch (e) {
        throw new Error(`DOCS_DIR non leggibile: ${root} (${(e as Error).message})`);
    }
    entries.sort();

    let emitted = 0;
    for (const name of entries) {
        if (opts.limit && emitted >= opts.limit) return;
        const full = join(root, name);
        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }
        if (!st.isFile()) continue;

        const buffer = await readFile(full);
        const ext = extname(name).toLowerCase();
        yield {
            sourceOracleId: name, // il nome file fa da id sorgente (la dedup vera è sull'hash)
            filename: basename(name),
            mimeHint: MIME_BY_EXT[ext] ?? null,
            buffer,
            tipologiaHint: null,
        };
        emitted++;
    }
}
