import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { env, requireSmtp } from '../../env';
import { downloadFileBase64 } from '../../lib/supabase';

// ===========================================================================
// Tool send_email — invio email via SMTP (nodemailer). Provider configurato via
// env (default GMX): cambiare provider = cambiare SMTP_HOST/PORT/USER/PASS, zero
// codice. Può allegare i file generati (create_excel/csv/pdf) o i documenti
// dell'archivio passando il loro storage_path. nodemailer è importato in modo
// DINAMICO per non gravare sullo startup del server.
// ===========================================================================

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
        "Invia un'email via SMTP. Usalo quando l'utente chiede di INVIARE/MANDARE via email un riepilogo, una risposta o un documento. " +
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
        const smtp = requireSmtp();
        const recipients = splitEmails(to);
        if (!recipients.length) return { sent: false, note: 'Nessun destinatario valido.' };

        // Il "from" deve coincidere con l'account autenticato (GMX non consente spoofing).
        const from = env.SMTP_FROM_NAME ? `${env.SMTP_FROM_NAME} <${smtp.user}>` : smtp.user;

        const atts: Array<{ filename: string; content: string; encoding: 'base64' }> = [];
        for (const p of attachments ?? []) {
            try {
                const { base64, filename } = await downloadFileBase64(p);
                atts.push({ filename, content: base64, encoding: 'base64' });
            } catch (e) {
                return { sent: false, note: `Allegato non recuperabile (${p}): ${(e as Error).message}` };
            }
        }

        try {
            // import dinamico: nodemailer fuori dallo startup.
            const nodemailer = (await import('nodemailer')).default;
            const transporter = nodemailer.createTransport({
                host: smtp.host,
                port: smtp.port,
                secure: smtp.port === 465, // 465 = SSL implicito; 587 = STARTTLS
                requireTLS: smtp.port !== 465, // forza STARTTLS sui 587 (richiesto da mail.com/GMX)
                auth: { user: smtp.user, pass: smtp.pass },
            });
            const info = await transporter.sendMail({
                from,
                to: recipients,
                cc: cc ? splitEmails(cc) : undefined,
                subject,
                text: body,
                html: toHtml(body),
                attachments: atts.length ? atts : undefined,
            });
            return { sent: true, id: info.messageId };
        } catch (e) {
            return { sent: false, note: `Invio SMTP fallito: ${(e as Error).message}` };
        }
    },
});
