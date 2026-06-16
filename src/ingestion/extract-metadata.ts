import type Anthropic from '@anthropic-ai/sdk';
import { forceToolUse } from '../lib/anthropic';
import { getJsonSchema, validateMetadata } from '../config/registry';
import { env } from '../env';

// ===========================================================================
// Step 5 — Estrazione metadati. TOOL USE FORZATO dove l'input_schema del tool
// È il JSON Schema della tipologia (dal registry). Si valida comunque con AJV;
// se non valido, UN retry passando gli errori in feedback, poi DA_REVISIONARE.
//
// Confidenza dell'estrazione: poiché lo schema del tool È quello della tipologia
// (nessun campo extra per la confidenza), la deriviamo deterministicamente
// dall'esito della validazione (1.0 al primo colpo, 0.8 dopo retry, 0.4 se
// invalida). Vedi DECISIONS.md.
// ===========================================================================

const SYSTEM_BASE = `Sei un estrattore di metadati da documenti aziendali italiani. Estrai SOLO i campi previsti dallo schema del tool, rispettando rigorosamente i tipi.
REGOLE TRASVERSALI OBBLIGATORIE:
- Date SEMPRE in formato ISO YYYY-MM-DD.
- Numeri come numeri JSON (mai stringhe), punto come separatore decimale.
- Enum: usa esclusivamente i valori ammessi.
- Nomi dei dipendenti: UPPERCASE nel formato 'COGNOME NOME' nel campo dipendente_nome_norm.
- Non inventare valori non presenti nel documento: ometti i campi opzionali assenti.
Rispondi esclusivamente invocando il tool \`estrai\`.`;

export interface ExtractionResult {
    metadata: Record<string, unknown>;
    valid: boolean;
    confidence: number;
    errors: string[];
}

export async function extractMetadata(input: { tipologia: string; text: string }): Promise<ExtractionResult> {
    const schema = getJsonSchema(input.tipologia);
    const tool = {
        name: 'estrai',
        description: `Estrai i metadati strutturati per un documento di tipo ${input.tipologia}.`,
        input_schema: schema as Record<string, unknown>,
    };

    const baseUser = `TIPOLOGIA: ${input.tipologia}\n\nTESTO DOCUMENTO:\n${input.text.slice(0, 60_000)}`;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: baseUser }];

    // Primo tentativo
    let { input: metadata } = await forceToolUse<Record<string, unknown>>({
        model: env.EXTRACT_MODEL,
        system: SYSTEM_BASE,
        messages,
        tool,
        maxTokens: 4096,
        purpose: 'extract',
    });

    let check = validateMetadata(input.tipologia, metadata);
    if (check.valid) return { metadata, valid: true, confidence: 1.0, errors: [] };

    // Retry con feedback degli errori AJV
    messages.push(
        { role: 'assistant', content: [{ type: 'tool_use', id: 'prev', name: 'estrai', input: metadata }] as Anthropic.ContentBlockParam[] },
        {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'prev',
                    content: `I metadati non rispettano lo schema. Correggi questi errori e re-invoca \`estrai\`:\n- ${check.errors.join('\n- ')}`,
                    is_error: true,
                },
            ] as Anthropic.ContentBlockParam[],
        },
    );

    ({ input: metadata } = await forceToolUse<Record<string, unknown>>({
        model: env.EXTRACT_MODEL,
        system: SYSTEM_BASE,
        messages,
        tool,
        maxTokens: 4096,
        purpose: 'extract-retry',
    }));

    check = validateMetadata(input.tipologia, metadata);
    if (check.valid) return { metadata, valid: true, confidence: 0.8, errors: [] };
    return { metadata, valid: false, confidence: 0.4, errors: check.errors };
}
