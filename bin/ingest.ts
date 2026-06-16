import { env } from '../src/env';
import { oracleSource } from '../src/ingestion/oracle-source';
import { filesystemSource } from '../src/ingestion/filesystem-source';
import { ingestAll } from '../src/ingestion/ingest-document';
import type { IngestResult, RawDocument } from '../src/ingestion/types';

// ===========================================================================
// Runner CLI dell'ingestion (batch).
//   npm run ingest -- [--source filesystem|oracle] [--dir PATH] [--limit N] [--concurrency K] [--force]
// Default: filesystem su DOCS_DIR (Oracle richiede la VPN). Concorrenza limitata (p-limit).
// ===========================================================================

interface Args {
    source: 'filesystem' | 'oracle';
    dir: string;
    limit: number;
    concurrency: number;
    force: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        source: env.INGEST_SOURCE,
        dir: env.DOCS_DIR,
        limit: 0,
        concurrency: env.INGEST_CONCURRENCY,
        force: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--source') args.source = (argv[++i] as Args['source']) ?? args.source;
        else if (a === '--dir') args.dir = argv[++i] ?? args.dir;
        else if (a === '--limit') args.limit = parseInt(argv[++i] ?? '0', 10);
        else if (a === '--concurrency') args.concurrency = parseInt(argv[++i] ?? '3', 10);
        else if (a === '--force') args.force = true;
    }
    return args;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    const where = args.source === 'filesystem' ? `filesystem:${args.dir}` : 'oracle';
    console.log(`=== topFiler3 · ingest (source=${where}, limit=${args.limit || 'tutti'}, concurrency=${args.concurrency}${args.force ? ', FORCE' : ''}) ===\n`);

    let n = 0;
    const onResult = (r: IngestResult) => {
        n++;
        const status = r.status.padEnd(14);
        const tip = (r.tipologia ?? '-').padEnd(22);
        const chunks = r.chunks ? ` ${r.chunks} chunk` : '';
        const note = r.note ? ` — ${r.note}` : '';
        console.log(`[${String(n).padStart(4)}] ${status} ${tip} ${r.filename}${chunks}${note}`);
    };

    const source: AsyncIterable<RawDocument> =
        args.source === 'oracle'
            ? oracleSource({ limit: args.limit, pageSize: env.INGEST_BATCH_SIZE })
            : filesystemSource({ dir: args.dir, limit: args.limit });

    const { stats } = await ingestAll(source, { concurrency: args.concurrency, force: args.force, onResult });

    console.log('\n=== Riepilogo ===');
    console.table(stats);
}

main().catch((e) => {
    console.error('Errore fatale:', e);
    process.exit(1);
});
