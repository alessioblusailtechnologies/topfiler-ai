// ===========================================================================
// Logging strutturato minimale (JSON line). Centralizza i due log che il
// documento richiede esplicitamente:
//   - logSql:   ogni query SQL generata ed eseguita
//   - logLlm:   ogni chiamata LLM con token usati e cache hit/miss
// Niente dipendenze: una riga JSON su stdout, facile da spedire a un collector.
// ===========================================================================

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, event: string, data: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

export const log = {
    debug: (event: string, data: Record<string, unknown> = {}) => emit('debug', event, data),
    info: (event: string, data: Record<string, unknown> = {}) => emit('info', event, data),
    warn: (event: string, data: Record<string, unknown> = {}) => emit('warn', event, data),
    error: (event: string, data: Record<string, unknown> = {}) => emit('error', event, data),
};

/** Log di una query SQL generata/eseguita dal tool text_to_sql. */
export function logSql(input: {
    domanda: string;
    sql: string;
    ok: boolean;
    rows?: number;
    durationMs?: number;
    error?: string;
    retries?: number;
}): void {
    emit(input.ok ? 'info' : 'warn', 'sql.exec', input);
}

export interface AnthropicUsage {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
}

/** Log di una chiamata LLM diretta (Anthropic SDK) con token e cache hit/miss. */
export function logLlm(input: {
    purpose: string;
    model: string;
    usage?: AnthropicUsage | null;
    durationMs?: number;
}): void {
    const u = input.usage || {};
    emit('info', 'llm.call', {
        purpose: input.purpose,
        model: input.model,
        durationMs: input.durationMs,
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_hit: (u.cache_read_input_tokens ?? 0) > 0,
    });
}
