import { env, requireMistral } from '../env';
import { log } from './logger';

// ===========================================================================
// EmbeddingProvider — interfaccia dietro cui si nasconde il fornitore di
// embedding. Implementazione: Mistral `mistral-embed` (1024 dim) via REST
// DIRETTA a https://api.mistral.ai/v1/embeddings (no SDK), con batch e retry
// con backoff sui 429. Cambiare fornitore = nuova implementazione, zero impatto
// sui chiamanti (ingestion, hybrid_search).
// ===========================================================================

export interface EmbeddingProvider {
    readonly dims: number;
    embed(texts: string[]): Promise<number[][]>;
    embedOne(text: string): Promise<number[]>;
}

const MISTRAL_EMBEDDINGS_URL = 'https://api.mistral.ai/v1/embeddings';
const BATCH_SIZE = 64;
const MAX_CHARS = 14_000; // cap conservativo: mistral-embed ~8192 token/input

class MistralEmbeddingProvider implements EmbeddingProvider {
    readonly dims = env.MISTRAL_EMBED_DIMS;

    async embed(texts: string[]): Promise<number[][]> {
        if (!texts.length) return [];
        const apiKey = requireMistral();
        const out: number[][] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE).map((t) => (t || ' ').slice(0, MAX_CHARS));
            const vectors = await this.callWithRetry(apiKey, batch);
            if (vectors.length !== batch.length) {
                throw new Error(`embed: richiesti ${batch.length} vettori, ricevuti ${vectors.length}`);
            }
            out.push(...vectors);
        }
        for (const v of out) {
            if (!Array.isArray(v) || typeof v[0] !== 'number') {
                throw new Error('embed: formato embedding non valido da Mistral');
            }
        }
        return out;
    }

    async embedOne(text: string): Promise<number[]> {
        const [v] = await this.embed([text || ' ']);
        if (!v) throw new Error('embedOne: nessun vettore restituito');
        return v;
    }

    private async callWithRetry(apiKey: string, batch: string[], attempts = 4): Promise<number[][]> {
        let lastErr: unknown;
        for (let i = 0; i < attempts; i++) {
            try {
                const res = await fetch(MISTRAL_EMBEDDINGS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({ model: env.MISTRAL_EMBED_MODEL, input: batch }),
                });
                if (res.status === 429 || res.status >= 500) {
                    throw new RetryableError(`HTTP ${res.status}`);
                }
                if (!res.ok) {
                    const body = await res.text().catch(() => '');
                    throw new Error(`Mistral embeddings HTTP ${res.status}: ${body.slice(0, 300)}`);
                }
                const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
                return (json.data ?? []).map((d) => d.embedding);
            } catch (e) {
                lastErr = e;
                const retryable = e instanceof RetryableError;
                if (!retryable || i === attempts - 1) {
                    if (!retryable) throw e;
                    break;
                }
                const delay = 1000 * 2 ** i;
                log.warn('embed.retry', { attempt: i + 1, delayMs: delay, reason: (e as Error).message });
                await sleep(delay);
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error('embed: esauriti i tentativi');
    }
}

class RetryableError extends Error {}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

let provider: EmbeddingProvider | null = null;
export function getEmbeddingProvider(): EmbeddingProvider {
    if (!provider) provider = new MistralEmbeddingProvider();
    return provider;
}
