import { NextRequest } from 'next/server';
import { getServerSupabase, TABLES } from '@/lib/supabase';
import { backendUrl } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Msg {
    role: 'user' | 'assistant';
    content: string;
}

// POST /api/chat — un turno di conversazione:
// 1) persiste il messaggio utente, 2) (al primo messaggio) imposta il titolo,
// 3) invoca il backend topFiler3 in streaming e ri-emette l'SSE al client
//    accumulando il testo, 4) persiste la risposta dell'assistente.
export async function POST(req: NextRequest) {
    let body: { chat_id?: string; message?: string; messages?: Msg[] };
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'JSON non valido' }, { status: 400 });
    }
    const chatId = body.chat_id;
    const message = body.message?.trim();
    if (!chatId) return Response.json({ error: 'chat_id richiesto' }, { status: 400 });
    if (!message) return Response.json({ error: 'message richiesto' }, { status: 400 });

    const history: Msg[] = (body.messages ?? []).filter((m) => m && m.role && m.content);
    const sb = getServerSupabase();

    // 1) persisti il messaggio utente
    await sb.from(TABLES.messages).insert({ chat_id: chatId, role: 'user', content: message });

    // 2) titolo derivato dal primo messaggio
    let titleToSend: string | null = null;
    if (history.length === 0) {
        const title = message.length > 60 ? `${message.slice(0, 60)}…` : message;
        await sb.from(TABLES.chats).update({ title }).eq('id', chatId);
        titleToSend = title;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            let full = '';
            try {
                const backendRes = await fetch(`${backendUrl()}/api/chat/stream`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ messages: [...history, { role: 'user', content: message }] }),
                });
                if (!backendRes.ok || !backendRes.body) {
                    send({ type: 'error', content: `backend non raggiungibile (HTTP ${backendRes.status})` });
                    send({ type: 'done' });
                    controller.close();
                    return;
                }
                const reader = backendRes.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const parts = buf.split('\n\n');
                    buf = parts.pop() || '';
                    for (const part of parts) {
                        const line = part.split('\n').find((l) => l.startsWith('data: '));
                        if (!line) continue;
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === 'text') {
                                full += data.content;
                                send({ type: 'text', content: data.content });
                            } else if (data.type === 'status') {
                                send({ type: 'status', content: data.content });
                            } else if (data.type === 'error') {
                                send({ type: 'error', content: data.content });
                            }
                        } catch {
                            /* ignora SSE malformati */
                        }
                    }
                }
                // 4) persisti la risposta dell'assistente
                await sb.from(TABLES.messages).insert({ chat_id: chatId, role: 'assistant', content: full });
                if (titleToSend) send({ type: 'title', title: titleToSend });
                send({ type: 'done' });
                controller.close();
            } catch (e) {
                send({ type: 'error', content: (e as Error).message });
                try {
                    await sb.from(TABLES.messages).insert({ chat_id: chatId, role: 'assistant', content: full || '(errore)' });
                } catch {
                    /* best effort */
                }
                send({ type: 'done' });
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
}
