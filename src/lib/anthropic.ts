import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { logLlm, type AnthropicUsage } from './logger';

// ===========================================================================
// Client Anthropic UNICO e condiviso per le chiamate DIRETTE di servizio
// (classificazione, estrazione metadati, generazione SQL). Qui usiamo l'SDK
// ufficiale — NON Mastra — perché servono tool use forzato e cache_control
// espliciti. L'agente conversazionale invece passa da Mastra (model router).
// ===========================================================================

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
    if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return client;
}

export type SystemBlocks = string | Anthropic.TextBlockParam[];

export interface ToolDef {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

/**
 * Chiamata con TOOL USE FORZATO: il modello È obbligato a invocare `tool` e noi
 * restituiamo l'input (già conforme allo schema del tool) + l'usage (per il log
 * di token e cache hit/miss). Usata per classificazione, estrazione e SQL-gen.
 */
export async function forceToolUse<T = unknown>(opts: {
    model: string;
    system: SystemBlocks;
    messages: Anthropic.MessageParam[];
    tool: ToolDef;
    maxTokens?: number;
    purpose: string;
}): Promise<{ input: T; usage: AnthropicUsage | null }> {
    const c = getAnthropic();
    const started = Date.now();
    const res = await c.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system as Anthropic.MessageCreateParams['system'],
        tools: [
            {
                name: opts.tool.name,
                description: opts.tool.description,
                input_schema: opts.tool.input_schema as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: opts.tool.name },
        messages: opts.messages,
    });
    logLlm({ purpose: opts.purpose, model: opts.model, usage: res.usage, durationMs: Date.now() - started });

    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
        throw new Error(`forceToolUse(${opts.tool.name}): la risposta non contiene un blocco tool_use`);
    }
    return { input: block.input as T, usage: (res.usage as AnthropicUsage) ?? null };
}
