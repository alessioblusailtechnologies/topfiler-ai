import { forceToolUse } from '../lib/anthropic';
import { allTipologie } from '../config/registry';
import { env } from '../env';

// ===========================================================================
// Step 4 — Classificazione tipologia. Messages API con modello economico
// (CLASSIFY_MODEL, es. Haiku) e TOOL USE FORZATO: l'input_schema del tool ha
// `tipologia` come enum CHIUSO letto dal registry + `confidence`. Se la sorgente
// fornisce già una tipologia, è solo un HINT da verificare.
// ===========================================================================

const SYSTEM = `Sei un classificatore di documenti aziendali italiani. Devi assegnare al documento UNA tipologia tra quelle ammesse e una confidenza 0..1.
Basati su contenuto e struttura del testo. Se ti viene fornito un HINT di tipologia dalla sorgente, consideralo ma VERIFICALO sul testo: se il testo contraddice l'hint, ignoralo.
Rispondi esclusivamente invocando il tool \`classifica\`.`;

export interface Classification {
    tipologia: string;
    confidence: number;
}

export async function classifyDocument(input: {
    text: string;
    filename: string;
    tipologiaHint: string | null;
}): Promise<Classification> {
    const tipologie = allTipologie();

    const tool = {
        name: 'classifica',
        description: 'Registra la tipologia del documento (enum chiuso dal registry) e la confidenza della classificazione.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            required: ['tipologia', 'confidence'],
            properties: {
                tipologia: { type: 'string', enum: tipologie },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
        } as Record<string, unknown>,
    };

    const hint = input.tipologiaHint ? `\nHINT tipologia dalla sorgente (da verificare): ${input.tipologiaHint}` : '';
    const user = `NOME FILE: ${input.filename}${hint}\n\nTESTO (estratto):\n${input.text.slice(0, 12_000)}`;

    const { input: out } = await forceToolUse<Classification>({
        model: env.CLASSIFY_MODEL,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
        tool,
        maxTokens: 256,
        purpose: 'classify',
    });

    const tipologia = tipologie.includes(out.tipologia) ? out.tipologia : 'MANUALE';
    const confidence = clamp01(Number(out.confidence));
    return { tipologia, confidence };
}

function clamp01(n: number): number {
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
}
