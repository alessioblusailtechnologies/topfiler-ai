import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

// ===========================================================================
// Registry delle tipologie — caricato dai FILE config/registry/*.json e
// validato all'avvio. Nessuna tabella DB: aggiungere una tipologia = aggiungere
// un file JSON, zero codice. Espone: schemi, validatori AJV (per l'estrazione),
// l'elenco dei campi (whitelist per SqlGuard) e una serializzazione per i prompt.
// ===========================================================================

export type EmbedStrategy = 'FULL' | 'RIGHE' | 'NONE';

export interface RegistryEntry {
    tipologia: string;
    descrizione: string;
    embed_strategy: EmbedStrategy;
    json_schema: Record<string, unknown>;
}

const REGISTRY_DIR = fileURLToPath(new URL('../../config/registry/', import.meta.url));

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
addFormats(ajv);

const entries = new Map<string, RegistryEntry>();
const validators = new Map<string, ValidateFunction>();

function loadRegistry(): void {
    if (entries.size > 0) return;
    const files = readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
    if (files.length === 0) throw new Error(`Registry vuoto: nessun file in ${REGISTRY_DIR}`);

    for (const file of files) {
        let raw: RegistryEntry;
        try {
            raw = JSON.parse(readFileSync(join(REGISTRY_DIR, file), 'utf-8'));
        } catch (e) {
            throw new Error(`Registry: ${file} non è JSON valido (${(e as Error).message})`);
        }
        if (!raw.tipologia || !raw.json_schema || !raw.embed_strategy) {
            throw new Error(`Registry: ${file} deve avere {tipologia, descrizione, json_schema, embed_strategy}`);
        }
        if (!['FULL', 'RIGHE', 'NONE'].includes(raw.embed_strategy)) {
            throw new Error(`Registry: ${file} embed_strategy non valido (${raw.embed_strategy})`);
        }
        let validate: ValidateFunction;
        try {
            validate = ajv.compile(raw.json_schema);
        } catch (e) {
            throw new Error(`Registry: json_schema di ${raw.tipologia} non compilabile (${(e as Error).message})`);
        }
        entries.set(raw.tipologia, raw);
        validators.set(raw.tipologia, validate);
    }
}

loadRegistry();

export function getEntry(tipologia: string): RegistryEntry {
    const e = entries.get(tipologia);
    if (!e) throw new Error(`Tipologia sconosciuta: ${tipologia}`);
    return e;
}

export function allTipologie(): string[] {
    return [...entries.keys()].sort();
}

export function allEntries(): RegistryEntry[] {
    return [...entries.values()];
}

export function getJsonSchema(tipologia: string): Record<string, unknown> {
    return getEntry(tipologia).json_schema;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/** Valida i metadati estratti contro il JSON Schema della tipologia. */
export function validateMetadata(tipologia: string, data: unknown): ValidationResult {
    const validate = validators.get(tipologia);
    if (!validate) return { valid: false, errors: [`Tipologia sconosciuta: ${tipologia}`] };
    const valid = validate(data) as boolean;
    const errors = valid ? [] : (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
    return { valid, errors };
}

/**
 * Insieme di TUTTI i nomi-campo dichiarati nei registry (top-level e annidati).
 * È la whitelist dei path JSONB ammessi dal SqlGuard: un `metadata->>'x'` con x
 * non in questo set viene rifiutato.
 */
let cachedFields: Set<string> | null = null;
export function allMetadataFields(): Set<string> {
    if (cachedFields) return cachedFields;
    const set = new Set<string>();
    for (const e of entries.values()) collectFields(e.json_schema, set);
    cachedFields = set;
    return set;
}

function collectFields(schema: unknown, out: Set<string>): void {
    if (!schema || typeof schema !== 'object') return;
    const s = schema as Record<string, any>;
    if (s.properties && typeof s.properties === 'object') {
        for (const [key, sub] of Object.entries(s.properties)) {
            out.add(key);
            collectFields(sub, out);
        }
    }
    if (s.items) collectFields(s.items, out);
}

/** Serializzazione compatta del registry per i prompt (agente + generatore SQL). */
export function serializeRegistryForPrompt(): string {
    const lines: string[] = [];
    for (const e of entries.values()) {
        lines.push(`### ${e.tipologia} — ${e.descrizione} [embed: ${e.embed_strategy}]`);
        lines.push(describeSchema(e.json_schema));
        lines.push('');
    }
    return lines.join('\n').trim();
}

function describeSchema(schema: Record<string, unknown>, indent = ''): string {
    const props = (schema as any).properties as Record<string, any> | undefined;
    const required: string[] = ((schema as any).required as string[]) || [];
    if (!props) return `${indent}(nessun campo)`;
    const out: string[] = [];
    for (const [name, sub] of Object.entries(props)) {
        const type = describeType(sub);
        const req = required.includes(name) ? '' : ' (opz.)';
        let line = `${indent}- ${name}: ${type}${req}`;
        if (sub.type === 'array' && sub.items?.properties) {
            line += '\n' + describeSchema(sub.items, indent + '    ');
        }
        out.push(line);
    }
    return out.join('\n');
}

function describeType(sub: any): string {
    if (sub.enum) return `enum(${sub.enum.join('|')})`;
    if (sub.format === 'date') return 'date ISO YYYY-MM-DD';
    if (sub.type === 'array') return 'array';
    if (Array.isArray(sub.type)) return sub.type.join('|');
    return String(sub.type ?? 'any');
}
