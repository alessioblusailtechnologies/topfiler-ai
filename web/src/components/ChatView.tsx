'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import TopNav from './TopNav';
import type { ChatMessage, InitialChat } from '@/lib/types';
import styles from './chat.module.scss';

let counter = 0;
const uid = () => `m${Date.now()}_${counter++}`;

const SUGGESTIONS = [
    'Quante fatture ci sono, suddivise tra attive e passive?',
    'Quali contratti di lavoro sono ancora attivi a giugno 2026?',
    'Trovami documenti che parlano di specifiche tecniche di cantieri',
    'Idoneità mediche in scadenza nel 2026',
];

export default function ChatView({ initialChat }: { initialChat?: InitialChat }) {
    const [chatId, setChatId] = useState<string | null>(initialChat?.id ?? null);
    const [messages, setMessages] = useState<ChatMessage[]>(initialChat?.messages ?? []);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [thinking, setThinking] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        // Durante lo streaming lo scroll è istantaneo: ri-lanciare uno scroll
        // "smooth" a ogni aggiornamento (decine al secondo) creerebbe a sua volta
        // un effetto a scatti perché l'animazione viene continuamente reimpostata.
        endRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
    }, [messages, streaming]);

    const runTurn = useCallback(async (targetChatId: string, content: string, prior: ChatMessage[]) => {
        setStreaming(true);
        setThinking(true);
        setStatus(null);
        const botId = uid();
        setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: '' }]);
        let got = ''; // tutto il testo ricevuto finora (target)
        let shown = 0; // caratteri attualmente mostrati
        let finished = false; // lo stream è terminato
        let raf: number | null = null;

        // I delta dal backend arrivano "a blocchi" (~100 caratteri ogni ~500ms):
        // mostrarli così fa apparire la risposta a scatti. Li accumuliamo in `got`
        // e li riveliamo in modo fluido a ogni frame (effetto macchina da scrivere),
        // svuotando una frazione del backlog → rapido sui blocchi, morbido in coda.
        const apply = () =>
            setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, content: got.slice(0, shown) } : m)));
        const paint = () => {
            raf = null;
            const gap = got.length - shown;
            if (gap > 0) {
                shown = Math.min(got.length, shown + Math.max(2, Math.ceil(gap / 6)));
                apply();
            }
            // continua finché c'è arretrato da rivelare o lo stream è ancora aperto
            if (shown < got.length || !finished) raf = requestAnimationFrame(paint);
        };
        const ensureLoop = () => {
            if (raf === null) raf = requestAnimationFrame(paint);
        };

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    chat_id: targetChatId,
                    message: content,
                    messages: prior.map((m) => ({ role: m.role, content: m.content })),
                }),
            });
            if (!res.body) throw new Error('nessuna risposta dal server');
            const reader = res.body.getReader();
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
                            got += data.content;
                            setThinking(false);
                            setStatus(null);
                            ensureLoop();
                        } else if (data.type === 'status') {
                            setStatus(typeof data.content === 'string' ? data.content : null);
                        } else if (data.type === 'title') {
                            window.dispatchEvent(new CustomEvent('tfai:chats-updated'));
                        } else if (data.type === 'error') {
                            got += `\n\n_Errore: ${data.content}_`;
                            ensureLoop();
                        }
                    } catch {
                        /* SSE malformato */
                    }
                }
            }
            // Stream finito: lascia che il typewriter riveli l'eventuale arretrato
            // residuo in modo fluido, poi si arresta da solo.
            finished = true;
            ensureLoop();
            window.dispatchEvent(new CustomEvent('tfai:chats-updated'));
        } catch (e) {
            finished = true;
            if (raf !== null) cancelAnimationFrame(raf);
            setMessages((prev) =>
                prev.map((m) => (m.id === botId ? { ...m, content: `_Errore di rete: ${(e as Error).message}_` } : m)),
            );
        } finally {
            finished = true;
            setStreaming(false);
            setThinking(false);
            setStatus(null);
        }
    }, []);

    const send = useCallback(
        async (raw: string) => {
            const content = raw.trim();
            if (!content || streaming) return;
            setInput('');
            if (taRef.current) taRef.current.style.height = 'auto';

            if (!chatId) {
                // nuova chat: render IMMEDIATO del messaggio, creazione inline,
                // nessuna navigazione/SSR (l'URL si aggiorna con replaceState).
                setMessages([{ id: uid(), role: 'user', content }]);
                try {
                    const r = await fetch('/api/chats', { method: 'POST' });
                    const { chat } = await r.json();
                    setChatId(chat.id);
                    window.history.replaceState(null, '', `/chat/${chat.id}`);
                    window.dispatchEvent(new CustomEvent('tfai:chats-updated'));
                    await runTurn(chat.id, content, []);
                } catch (e) {
                    setMessages((prev) => [
                        ...prev,
                        { id: uid(), role: 'assistant', content: `_Errore creazione chat: ${(e as Error).message}_` },
                    ]);
                }
                return;
            }

            const prior = messages;
            setMessages((prev) => [...prev, { id: uid(), role: 'user', content }]);
            await runTurn(chatId, content, prior);
        },
        [chatId, messages, streaming, runTurn],
    );

    // Reset a "nuova chat": azzera lo stato del ChatView montato (la navigazione a "/"
    // non lo rimonterebbe — stesso componente — quindi resettiamo qui) e riporta l'URL a "/".
    const newChat = useCallback(() => {
        setStreaming(false);
        setThinking(false);
        setStatus(null);
        setInput('');
        setMessages([]);
        setChatId(null);
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState(null, '', '/');
        }
    }, []);

    // "Nuova chat" dalla sidebar (componente diverso) → evento globale.
    useEffect(() => {
        const h = () => newChat();
        window.addEventListener('tfai:new-chat', h);
        return () => window.removeEventListener('tfai:new-chat', h);
    }, [newChat]);

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const el = e.target;
        setInput(el.value);
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send(input);
        }
    };

    const hasMessages = messages.length > 0;

    return (
        <div className={styles.chat}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <i className="fas fa-comments" />
                    <span className={styles.title}>topFiler3 · Assistente documentale</span>
                </div>
                <div className={styles.headerRight}>
                    <TopNav />
                    <button className={styles.newBtn} onClick={newChat}>
                        <i className="fas fa-plus" /> Nuova chat
                    </button>
                </div>
            </div>

            <div className={styles.messages}>
                {!hasMessages ? (
                    <div className={styles.welcome}>
                        <div className={styles.welcomeIcon}>
                            <i className="fas fa-wand-magic-sparkles" />
                        </div>
                        <h2>Ciao! Sono l&apos;assistente di topFiler3</h2>
                        <p>Interroga l&apos;archivio: conteggi, scadenze, correlazioni tra documenti, ricerca semantica e download dei file.</p>
                        <div className={styles.suggestions}>
                            {SUGGESTIONS.map((s) => (
                                <button key={s} className={styles.suggestion} onClick={() => send(s)}>
                                    <i className="fas fa-chevron-right" /> {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((m) => (
                        <div
                            key={m.id}
                            className={`${styles.message} ${m.role === 'user' ? styles.user : styles.assistant}`}
                        >
                            <div className={styles.avatar}>
                                <i className={m.role === 'user' ? 'fas fa-user' : 'fas fa-comments'} />
                            </div>
                            <div className={styles.body}>
                                <div className={styles.role}>{m.role === 'user' ? 'Tu' : 'topFiler3'}</div>
                                <div className={styles.text}>
                                    {m.role === 'user' ? (
                                        m.content
                                    ) : m.content ? (
                                        <MarkdownRenderer content={m.content} />
                                    ) : thinking ? (
                                        <div className={styles.typing}>
                                            <span />
                                            <span />
                                            <span />
                                            <span className={styles.typingLabel}>{status ?? 'Sto ragionando…'}</span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ))
                )}
                <div ref={endRef} />
            </div>

            <div className={styles.inputArea}>
                <div className={styles.inputBar}>
                    <textarea
                        ref={taRef}
                        value={input}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                        placeholder="Scrivi una domanda sull'archivio…"
                        rows={1}
                        disabled={streaming}
                    />
                    <button
                        className={styles.sendBtn}
                        onClick={() => send(input)}
                        disabled={streaming || !input.trim()}
                        aria-label="Invia"
                    >
                        <i className="fas fa-paper-plane" />
                    </button>
                </div>
                <div className={styles.disclaimer}>
                    topFiler3 risponde solo in base ai documenti indicizzati. Verifica sempre il criterio applicato.
                </div>
            </div>
        </div>
    );
}
