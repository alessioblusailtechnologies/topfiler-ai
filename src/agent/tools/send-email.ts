import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { env, requireResend } from '../../env';
import { downloadFileBase64 } from '../../lib/supabase';

// ===========================================================================
// Tool send_email — invio email via Resend (REST, niente SDK/dipendenze).
// Può allegare i file generati (create_excel/csv/pdf) o i documenti dell'archivio
// passando il loro storage_path: il tool li scarica da Storage e li allega.
// ===========================================================================

const RESEND_URL = 'https://api.resend.com/emails';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Se il body è già HTML lo lascia, altrimenti escapa e converte gli a-capo.
function toHtml(body: string): string {
    if (/<[a-z][\s\S]*>/i.test(body)) return body;
    return escapeHtml(body).replace(/\n/g, '<br>');
}

function splitEmails(s: string): string[] {
    return s
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter(Boolean);
}

export const sendEmailTool = createTool({
    id: 'send_email',
    description:
        "Invia un'email via Resend. Usalo quando l'utente chiede di INVIARE/MANDARE via email un riepilogo, una risposta o un documento. " +
        'Puoi allegare file passando in "attachments" il loro storage_path: usa quello restituito da create_excel/create_csv/create_pdf, ' +
        'oppure quello di un documento ottenuto con get_document. Scrivi un corpo (body) chiaro; oggetto sempre presente.',
    inputSchema: z.object({
        to: z.string().describe('Destinatario/i: una o più email separate da virgola.'),
        subject: z.string().describe("Oggetto dell'email."),
        body: z.string().describe('Corpo del messaggio (testo semplice; gli a-capo diventano <br>).'),
        cc: z.string().optional().describe('Copia conoscenza: email separate da virgola.'),
        attachments: z
            .array(z.string())
            .optional()
            .describe('storage_path dei file da allegare (da create_excel/csv/pdf o get_document).'),
    }),
    outputSchema: z.object({
        sent: z.boolean(),
        id: z.string().optional(),
        note: z.string().optional(),
    }),
    execute: async ({ to, subject, body, cc, attachments }) => {
        const apiKey = requireResend();
        const recipients = splitEmails(to);
        if (!recipients.length) return { sent: false, note: 'Nessun destinatario valido.' };

        const from = env.RESEND_FROM_NAME ? `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>` : env.RESEND_FROM_EMAIL;

        const atts: Array<{ filename: string; content: string }> = [];
        for (const p of attachments ?? []) {
            try {
                const { base64, filename } = await downloadFileBase64(p);
                atts.push({ filename, content: base64 });
            } catch (e) {
                return { sent: false, note: `Allegato non recuperabile (${p}): ${(e as Error).message}` };
            }
        }

        const payload: Record<string, unknown> = {
            from,
            to: recipients,
            subject,
            html: toHtml(body),
            text: body,
        };
        if (cc) payload.cc = splitEmails(cc);
        if (atts.length) payload.attachments = atts;

        let res: Response;
        try {
            res = await fetch(RESEND_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            return { sent: false, note: `Errore di rete verso Resend: ${(e as Error).message}` };
        }

        const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
        if (!res.ok) {
            return { sent: false, note: json.message || json.name || `Resend HTTP ${res.status}` };
        }
        return { sent: true, id: json.id };
    },
});
