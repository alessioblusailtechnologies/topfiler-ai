import 'dotenv/config';
import { z } from 'zod';

// ===========================================================================
// Configurazione via .env, validata con Zod all'avvio.
// I campi sono raggruppati per credenziale; quelli usati solo in un contesto
// (es. Oracle solo in ingestion) sono opzionali qui e verificati on-demand con
// le funzioni require*() più sotto, così il server non muore se mancano le
// credenziali Oracle e viceversa.
// ===========================================================================

const Schema = z.object({
    // Anthropic
    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY mancante'),
    AGENT_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),
    CLASSIFY_MODEL: z.string().default('claude-haiku-4-5'),
    EXTRACT_MODEL: z.string().default('claude-sonnet-4-6'),
    SQLGEN_MODEL: z.string().default('claude-sonnet-4-6'),

    // Mistral (embedding + OCR)
    MISTRAL_API_KEY: z.string().optional(),
    MISTRAL_EMBED_MODEL: z.string().default('mistral-embed'),
    MISTRAL_EMBED_DIMS: z.coerce.number().int().positive().default(1024),
    MISTRAL_OCR_MODEL: z.string().default('mistral-ocr-latest'),

    // Supabase (service role: ingestion + storage)
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().default('topfiler-final-ai-documenti'),

    // Postgres per la memory di Mastra
    MASTRA_DATABASE_URL: z.string().optional(),

    // Oracle (sorgente, sola lettura — solo ingestion)
    ORACLE_USER: z.string().optional(),
    ORACLE_PASSWORD: z.string().optional(),
    ORACLE_CONNECTION_STRING: z.string().optional(),

    // Ingestion
    INGEST_SOURCE: z.enum(['filesystem', 'oracle']).default('filesystem'),
    DOCS_DIR: z.string().default('../topfiler-ai/docs_in_db'),
    OCR_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    INGEST_CONCURRENCY: z.coerce.number().int().positive().default(3),
    INGEST_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),

    // Server
    PORT: z.coerce.number().int().positive().default(3000),
});

// Tratta le stringhe vuote (tipiche di un .env appena copiato) come "non
// impostato", così gli optional restano optional e gli errori riguardano solo
// le variabili davvero richieste.
const cleanedEnv = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

const parsed = Schema.safeParse(cleanedEnv);
if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configurazione .env non valida:\n${issues}\nCopia .env.example in .env e compila i valori.`);
}

export const env = parsed.data;
export type Env = typeof env;

export function requireMistral(): string {
    if (!env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY mancante (necessaria per gli embedding).');
    return env.MISTRAL_API_KEY;
}

export function requireSupabase(): { url: string; key: string } {
    // La service key è consigliata (storage privato + scrittura). In assenza si
    // ripiega sull'anon key (lecito perché le tabelle hanno RLS disabilitato).
    const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
    if (!env.SUPABASE_URL || !key) {
        throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY (o SUPABASE_ANON_KEY) mancanti.');
    }
    return { url: env.SUPABASE_URL, key };
}

export function requireOracle(): { user: string; password: string; connectString: string } {
    if (!env.ORACLE_USER || !env.ORACLE_PASSWORD || !env.ORACLE_CONNECTION_STRING) {
        throw new Error('Credenziali Oracle mancanti (ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECTION_STRING).');
    }
    return { user: env.ORACLE_USER, password: env.ORACLE_PASSWORD, connectString: env.ORACLE_CONNECTION_STRING };
}
