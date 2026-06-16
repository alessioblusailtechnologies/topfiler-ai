import { createHash } from 'node:crypto';

// ===========================================================================
// Utility di testo pure: hashing, normalizzazione date/nomi, distanza di
// Levenshtein e chunking (recursive character splitter). Nessun side effect.
// ===========================================================================

export function sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Normalizza una data in ISO 'YYYY-MM-DD'. Accetta ISO, dd/mm/yyyy, dd-mm-yyyy.
 * Ritorna null se non interpretabile. (In ingestion le date arrivano già ISO
 * dall'estrazione LLM; questa è una rete di sicurezza deterministica.)
 */
export function normIsoDate(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (m) {
        const d = m[1]!.padStart(2, '0');
        const mo = m[2]!.padStart(2, '0');
        return `${m[3]}-${mo}-${d}`;
    }
    return null;
}

/** true se la data ISO è plausibile: non antecedente al 1990 né nel futuro remoto. */
export function isPlausibleDate(iso: string | null, maxFutureYears = 10): boolean {
    if (!iso) return false;
    const t = Date.parse(iso + 'T00:00:00Z');
    if (Number.isNaN(t)) return false;
    const year = new Date(t).getUTCFullYear();
    const maxYear = new Date().getUTCFullYear() + maxFutureYears;
    return year >= 1990 && year <= maxYear;
}

/**
 * Porta un nome in forma normalizzata UPPERCASE: collassa gli spazi, rimuove la
 * punteggiatura, mantiene le lettere accentate. NON riordina cognome/nome: l'ordine
 * 'COGNOME NOME' è responsabilità dell'estrazione (istruita via prompt); qui si
 * standardizza solo la forma per il confronto.
 */
export function normalizeName(raw: unknown): string {
    return String(raw ?? '')
        .normalize('NFC')
        .replace(/[^\p{L}\s'’]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

/** Distanza di Levenshtein (per la deduplica dei nomi dipendente). */
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array<number>(n + 1);
    let cur = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return prev[n]!;
}

// ---------------------------------------------------------------------------
// Chunking: recursive character splitter. target ~500 token (~2000 char),
// overlap ~50 token (~200 char). Approssimazione token≈char/4.
// ---------------------------------------------------------------------------

export function chunkText(
    text: string,
    { targetTokens = 500, overlapTokens = 50 }: { targetTokens?: number; overlapTokens?: number } = {},
): string[] {
    const maxChars = targetTokens * 4;
    const overlapChars = overlapTokens * 4;
    const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) return [];
    if (clean.length <= maxChars) return [clean];

    // Unità atomiche: paragrafi; i paragrafi troppo lunghi si spezzano in frasi.
    const units = clean
        .split(/\n{2,}/)
        .flatMap((p) => (p.length > maxChars ? p.split(/(?<=[.!?;])\s+/) : [p]))
        .map((u) => u.trim())
        .filter(Boolean);

    const chunks: string[] = [];
    let cur = '';
    for (const piece of units) {
        if (cur && cur.length + 1 + piece.length > maxChars) {
            chunks.push(cur);
            const tail = cur.slice(Math.max(0, cur.length - overlapChars));
            cur = `${tail} ${piece}`.trim();
        } else {
            cur = cur ? `${cur} ${piece}` : piece;
        }
    }
    if (cur.trim()) chunks.push(cur.trim());

    // Rete di sicurezza: spezza con finestra fissa eventuali chunk ancora enormi.
    return chunks.flatMap((c) => (c.length > maxChars * 1.5 ? hardWindow(c, maxChars, overlapChars) : [c]));
}

function hardWindow(text: string, maxChars: number, overlapChars: number): string[] {
    const out: string[] = [];
    const step = Math.max(1, maxChars - overlapChars);
    for (let i = 0; i < text.length; i += step) {
        out.push(text.slice(i, i + maxChars));
        if (i + maxChars >= text.length) break;
    }
    return out;
}
