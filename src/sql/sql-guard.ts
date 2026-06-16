import nodeSqlParser from 'node-sql-parser';
import { allMetadataFields } from '../config/registry';

const { Parser } = nodeSqlParser;

// ===========================================================================
// SqlGuard — guardrail SQL ISOLATO, senza alcuna dipendenza LLM.
//  - parsing con node-sql-parser (dialetto Postgres): UN solo statement, solo
//    SELECT; vietati DML/DDL/funzioni di sistema, `;` multipli, commenti
//  - whitelist sorgenti: SOLO la tabella `documenti` (self-join ammessi)
//  - validazione dei path JSONB usati contro i campi dichiarati nel registry
//  - LIMIT 200 forzato se assente
// È la rete deterministica attorno all'SQL generato dall'LLM; la connessione
// read-only e lo statement_timeout sono l'ultima linea di difesa a runtime.
// ===========================================================================

const parser = new Parser();
const DIALECT = { database: 'postgresql' as const };

const ALLOWED_TABLES = new Set(['topfiler_final_ai_documenti']);

// Colonne reali di `documenti` (i path JSONB sono validati a parte).
const DOC_COLUMNS = new Set([
    'id', 'tipologia', 'metadata', 'storage_path', 'source_oracle_id', 'filename',
    'mime_type', 'hash_sha256', 'data_caricamento', 'stato_ingestion', 'confidence',
]);

const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|analyze|comment|set|reset|begin|commit|rollback)\b/i;
const FORBIDDEN_FUNCTIONS = /\b(pg_sleep|pg_read_file|pg_ls_dir|pg_read_binary_file|lo_import|lo_export|dblink|set_config|current_setting|pg_terminate_backend|pg_cancel_backend|txid_current)\b/i;

export type GuardOk = { ok: true; sql: string };
export type GuardErr = { ok: false; error: string };
export type GuardResult = GuardOk | GuardErr;

export function guardSql(rawSql: string): GuardResult {
    let sql = (rawSql || '').trim();
    if (!sql) return fail('SQL vuoto');

    // Commenti vietati.
    if (sql.includes('--') || sql.includes('/*')) return fail('commenti SQL non ammessi');

    // Un solo statement: rimuovi un eventuale `;` finale, poi vieta altri `;`.
    sql = sql.replace(/;\s*$/, '');
    if (sql.includes(';')) return fail('statement multipli non ammessi (`;`)');

    // Difesa keyword (prima del parser, su tutto il testo).
    if (FORBIDDEN_KEYWORDS.test(sql)) return fail('sono ammesse solo query SELECT (rilevata keyword DML/DDL)');
    if (FORBIDDEN_FUNCTIONS.test(sql)) return fail('funzione di sistema non ammessa');

    // Parsing: deve essere UN solo SELECT.
    let ast: unknown;
    try {
        ast = parser.astify(sql, DIALECT);
    } catch (e) {
        return fail(`SQL non parsabile: ${(e as Error).message}`);
    }
    if (Array.isArray(ast)) {
        if (ast.length !== 1) return fail('è ammesso un solo statement');
        ast = ast[0];
    }
    const stmtType = (ast as { type?: string })?.type;
    if (stmtType !== 'select') return fail(`è ammesso solo SELECT (rilevato ${stmtType ?? 'sconosciuto'})`);

    // Whitelist sorgenti: solo `documenti`.
    let tables: string[];
    try {
        tables = parser.tableList(sql, DIALECT); // es. "select::null::documenti"
    } catch (e) {
        return fail(`analisi tabelle fallita: ${(e as Error).message}`);
    }
    for (const t of tables) {
        const parts = t.split('::');
        const op = parts[0];
        const table = parts[parts.length - 1];
        if (op !== 'select') return fail(`operazione non SELECT su ${table}`);
        if (!table || !ALLOWED_TABLES.has(table)) return fail(`tabella non ammessa: ${table} (solo "documenti")`);
    }

    // Validazione path JSONB contro il registry.
    const jsonErr = validateJsonPaths(sql);
    if (jsonErr) return fail(jsonErr);

    // LIMIT 200 forzato se assente.
    if (!/\blimit\b/i.test(sql)) sql = `${sql}\nLIMIT 200`;

    return { ok: true, sql };
}

/** Estrae i riferimenti metadata->>'x' / metadata->'x' e li valida sul registry. */
function validateJsonPaths(sql: string): string | null {
    const allowed = allMetadataFields();
    const re = /->>?\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
        const key = m[1]!;
        if (!allowed.has(key) && !DOC_COLUMNS.has(key)) {
            return `campo JSONB non dichiarato nel registry: '${key}'`;
        }
    }
    return null;
}

function fail(error: string): GuardErr {
    return { ok: false, error };
}
