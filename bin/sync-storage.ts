import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { env } from '../src/env';
import {
    ensureBucket,
    documentsNeedingStorage,
    uploadFile,
    setStoragePath,
    storageBucket,
} from '../src/lib/supabase';

// ===========================================================================
// sync:storage — backfill dei file su Supabase Storage SENZA ri-ingestire.
// I metadati (source_oracle_id = nome file, mime_type) sono già a DB: ri-leggiamo
// i file da DOCS_DIR, li carichiamo e aggiorniamo storage_path. Nessuna chiamata
// LLM/embedding. Abilita i link di download in get_document.
// Idempotente: processa solo i documenti con storage_path nullo.
// ===========================================================================

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOCS_DIR = resolve(PROJECT_ROOT, env.DOCS_DIR);

function safeName(name: string): string {
    return name.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'documento';
}

async function main(): Promise<void> {
    console.log(`=== sync:storage (bucket=${storageBucket()}, dir=${DOCS_DIR}) ===\n`);

    const created = await ensureBucket();
    console.log(created ? 'Bucket creato.' : 'Bucket già presente.');

    const rows = await documentsNeedingStorage();
    console.log(`Documenti da caricare: ${rows.length}\n`);

    const limit = pLimit(6);
    let ok = 0;
    let missing = 0;
    let err = 0;

    await Promise.all(
        rows.map((r) =>
            limit(async () => {
                const file = join(DOCS_DIR, r.source_oracle_id);
                try {
                    await stat(file);
                } catch {
                    missing++;
                    return;
                }
                try {
                    const buffer = await readFile(file);
                    const path = `${r.tipologia}/${r.id}/${safeName(r.source_oracle_id)}`;
                    await uploadFile(path, buffer, r.mime_type);
                    await setStoragePath(r.id, path);
                    ok++;
                    if (ok % 50 === 0) console.log(`  caricati ${ok}…`);
                } catch (e) {
                    err++;
                    console.warn(`  errore ${r.source_oracle_id}: ${(e as Error).message}`);
                }
            }),
        ),
    );

    console.log('\n=== Fatto ===');
    console.table({ caricati: ok, file_mancanti: missing, errori: err, totale: rows.length });
}

main().catch((e) => {
    console.error('Errore fatale:', e);
    process.exit(1);
});
