import { normalizeName, levenshtein } from '../lib/text';

// ===========================================================================
// Step 7 — Normalizzazione dipendente (solo tipologie HR, riconosciute dalla
// presenza del campo dipendente_nome_norm). Porta il nome in 'COGNOME NOME'
// uppercase, poi lo confronta con i valori canonici GIÀ presenti: se ne esiste
// uno a distanza di Levenshtein <= 2, riusa quella forma (è ciò che tiene uniti
// i documenti dello stesso dipendente senza tabella anagrafica). Due candidati
// vicini → ambiguo → DA_REVISIONARE.
// ===========================================================================

const MAX_DISTANCE = 2;

export interface NormalizeResult {
    metadata: Record<string, unknown>;
    ambiguous: boolean;
    note?: string;
}

export function normalizeEmployee(
    metadata: Record<string, unknown>,
    existingNames: string[],
): NormalizeResult {
    if (!('dipendente_nome_norm' in metadata) || metadata['dipendente_nome_norm'] == null) {
        return { metadata, ambiguous: false };
    }

    const normalized = normalizeName(metadata['dipendente_nome_norm']);
    if (!normalized) return { metadata, ambiguous: false };

    // Candidati canonici vicini (esclusa l'identità esatta, già canonica).
    const close = existingNames
        .filter((n) => n && n !== normalized)
        .map((n) => ({ name: n, dist: levenshtein(normalized, n) }))
        .filter((c) => c.dist <= MAX_DISTANCE)
        .sort((a, b) => a.dist - b.dist);

    const out = { ...metadata };

    if (close.length === 0) {
        out['dipendente_nome_norm'] = normalized;
        return { metadata: out, ambiguous: false };
    }

    // Ambiguità: due candidati distinti entrambi vicini → non scegliere a caso.
    if (close.length >= 2 && close[0]!.dist === close[1]!.dist && close[0]!.name !== close[1]!.name) {
        out['dipendente_nome_norm'] = normalized;
        return {
            metadata: out,
            ambiguous: true,
            note: `nome dipendente ambiguo: "${normalized}" vicino a "${close[0]!.name}" e "${close[1]!.name}"`,
        };
    }

    // Riusa la forma canonica già presente.
    out['dipendente_nome_norm'] = close[0]!.name;
    return { metadata: out, ambiguous: false };
}
