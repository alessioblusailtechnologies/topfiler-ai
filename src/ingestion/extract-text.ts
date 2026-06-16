// pdf-parse: si importa il modulo interno per evitare il "debug mode" che il
// wrapper index.js attiva sotto ESM (tenta di leggere un PDF di test e crasha).
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { parseOfficeAsync } from 'officeparser';

// ===========================================================================
// Estrazione testo: pdf-parse per i PDF, officeparser per Office (docx/xlsx/
// pptx), decodifica diretta per testo/XML/HTML. Le immagini e i PDF scansionati
// (testo vuoto/quasi) NON vengono OCR-ati qui: si segnala needsOcr e l'ingestion
// li marca DA_REVISIONARE con nota "OCR richiesto".
// ===========================================================================

export type DocKind = 'pdf' | 'office' | 'text' | 'image' | 'unknown';

export interface ExtractResult {
    text: string;
    kind: DocKind;
    method: string;
    indexable: boolean; // c'è testo sufficiente da indicizzare/analizzare
    needsOcr: boolean;  // scansione/immagine senza testo estraibile
    mime: string | null;
}

const MIN_TEXT_CHARS = 20;

export async function extractText(buffer: Buffer, opts: { filename: string; mimeHint: string | null }): Promise<ExtractResult> {
    const kind = detectKind(buffer, opts.mimeHint);
    let text = '';
    let method: string = kind;

    try {
        switch (kind) {
            case 'pdf': {
                const data = await pdfParse(buffer);
                text = data.text || '';
                method = 'pdf-parse';
                break;
            }
            case 'office': {
                text = (await parseOfficeAsync(buffer)) || '';
                method = 'officeparser';
                break;
            }
            case 'text': {
                text = buffer.toString('utf-8');
                method = 'plain';
                break;
            }
            case 'image':
                method = 'none(image)';
                break;
            default:
                // ultimo tentativo: prova a decodificare come testo
                text = buffer.toString('utf-8');
                method = 'plain?';
        }
    } catch {
        text = '';
        method = `${method}(error)`;
    }

    const normalized = normalize(text);
    const indexable = normalized.length >= MIN_TEXT_CHARS;
    const needsOcr = !indexable && (kind === 'image' || kind === 'pdf');

    return { text: normalized, kind, method, indexable, needsOcr, mime: mimeFor(kind, opts.mimeHint) };
}

function detectKind(buffer: Buffer, mimeHint: string | null): DocKind {
    if (!buffer || buffer.length === 0) return 'unknown';
    const head = buffer.subarray(0, 8);

    if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    // ZIP container (PK\x03\x04) → docx/xlsx/pptx (OOXML)
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) return 'office';
    // immagini comuni
    if (head[0] === 0xff && head[1] === 0xd8) return 'image'; // jpg
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image'; // png
    if (head.subarray(0, 3).toString('latin1') === 'GIF') return 'image';
    if (head.subarray(0, 2).toString('latin1') === 'BM') return 'image'; // bmp
    if (head.subarray(0, 4).toString('latin1') === 'RIFF') return 'image'; // webp

    const hint = (mimeHint || '').toLowerCase();
    if (hint.includes('pdf')) return 'pdf';
    if (hint.includes('word') || hint.includes('sheet') || hint.includes('officedocument') || hint.includes('excel')) return 'office';
    if (hint.startsWith('image/')) return 'image';

    // se è prevalentemente stampabile, trattalo come testo
    if (isMostlyPrintable(buffer)) return 'text';
    return 'unknown';
}

function isMostlyPrintable(buffer: Buffer): boolean {
    const sample = buffer.subarray(0, 1024);
    let printable = 0;
    for (const b of sample) {
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 160) printable++;
    }
    return sample.length > 0 && printable / sample.length > 0.85;
}

function normalize(text: string): string {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function mimeFor(kind: DocKind, hint: string | null): string | null {
    if (hint) return hint;
    switch (kind) {
        case 'pdf': return 'application/pdf';
        case 'office': return 'application/vnd.openxmlformats-officedocument';
        case 'text': return 'text/plain';
        default: return null;
    }
}
