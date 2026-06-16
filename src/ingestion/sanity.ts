import { normIsoDate, isPlausibleDate } from '../lib/text';

// ===========================================================================
// Step 6 — Regole di sanità deterministiche (in TypeScript, niente LLM).
//   - num_righe_servizio RICALCOLATO dall'array righe (mai fidarsi dell'LLM)
//   - data_scadenza > data_stipula
//   - date plausibili (>= 1990, non nel futuro remoto)
//   - num_licenze >= 0
// Ritorna i metadati (eventualmente corretti su num_righe_servizio) e l'elenco
// delle violazioni: se non vuoto → il documento va in DA_REVISIONARE.
// ===========================================================================

export interface SanityResult {
    metadata: Record<string, unknown>;
    violations: string[];
}

const DATE_FIELDS = ['data_stipula', 'data_scadenza', 'data_emissione', 'data'];

export function applySanityRules(tipologia: string, input: Record<string, unknown>): SanityResult {
    const metadata = { ...input };
    const violations: string[] = [];

    // num_righe_servizio: SEMPRE ricalcolato dal codice (FATTURA).
    if (Array.isArray(metadata['righe'])) {
        const righe = metadata['righe'] as Array<Record<string, unknown>>;
        if (tipologia === 'FATTURA') {
            metadata['num_righe_servizio'] = righe.filter((r) => r?.['tipo'] === 'SERVIZIO').length;
        }
    }

    // Date plausibili.
    for (const f of DATE_FIELDS) {
        const v = metadata[f];
        if (v == null) continue;
        const iso = normIsoDate(v);
        if (!iso) {
            violations.push(`${f}: data non interpretabile (${String(v)})`);
            continue;
        }
        metadata[f] = iso; // normalizza la forma
        if (!isPlausibleDate(iso)) violations.push(`${f}: data implausibile (${iso})`);
    }

    // data_scadenza > data_stipula (contratti).
    const stip = metadata['data_stipula'];
    const scad = metadata['data_scadenza'];
    if (typeof stip === 'string' && typeof scad === 'string' && scad <= stip) {
        violations.push(`data_scadenza (${scad}) non successiva a data_stipula (${stip})`);
    }

    // num_licenze >= 0.
    const lic = metadata['num_licenze'];
    if (typeof lic === 'number' && lic < 0) {
        violations.push(`num_licenze negativo (${lic})`);
    }

    return { metadata, violations };
}
