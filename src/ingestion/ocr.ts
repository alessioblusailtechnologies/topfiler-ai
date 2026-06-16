import { Mistral } from '@mistralai/mistralai';
import { env, requireMistral } from '../env';

// ===========================================================================
// OcrProvider — implementazione con Mistral OCR (mistral-ocr-latest).
//   - immagini: passate come data URI base64 (image_url)
//   - PDF: caricati su Files API, OCR via signed URL (document_url), poi rimossi
// Usato dall'ingestion quando pdf-parse/officeparser non estraggono testo
// (scansioni, immagini). L'embedding resta via REST (src/lib/embeddings.ts);
// qui usiamo l'SDK Mistral solo per l'OCR.
// ===========================================================================

export interface OcrProvider {
    extract(buffer: Buffer, opts: { mime: string; filename: string }): Promise<string>;
}

let client: Mistral | null = null;
function getClient(): Mistral {
    if (!client) client = new Mistral({ apiKey: requireMistral() });
    return client;
}

class MistralOcrProvider implements OcrProvider {
    async extract(buffer: Buffer, opts: { mime: string; filename: string }): Promise<string> {
        const c = getClient();
        const mime = opts.mime || 'application/pdf';

        if (mime.startsWith('image/')) {
            const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
            return withRetry(async () => {
                const res = await c.ocr.process({
                    model: env.MISTRAL_OCR_MODEL,
                    document: { type: 'image_url', imageUrl: dataUri },
                    includeImageBase64: false,
                });
                return joinPages(res);
            });
        }

        // PDF: ogni tentativo RICARICA il file (un 404 in OCR deriva dalla
        // propagazione del file appena caricato; ricaricare lo risolve).
        return withRetry(async () => {
            const uploaded = await c.files.upload({
                file: { fileName: opts.filename || 'document.pdf', content: buffer },
                purpose: 'ocr',
            });
            try {
                const signed = await c.files.getSignedUrl({ fileId: uploaded.id });
                const res = await c.ocr.process({
                    model: env.MISTRAL_OCR_MODEL,
                    document: { type: 'document_url', documentUrl: signed.url },
                    includeImageBase64: false,
                });
                return joinPages(res);
            } finally {
                await c.files.delete({ fileId: uploaded.id }).catch(() => {});
            }
        });
    }
}

function joinPages(res: { pages?: Array<{ markdown?: string }> }): string {
    return (res.pages ?? []).map((p) => p.markdown ?? '').join('\n\n').trim();
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelay = 1000): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('OCR: tentativi esauriti');
}

let provider: OcrProvider | null = null;
export function getOcrProvider(): OcrProvider {
    if (!provider) provider = new MistralOcrProvider();
    return provider;
}
