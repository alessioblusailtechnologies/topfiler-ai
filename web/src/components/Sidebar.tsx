'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ChatSummary } from '@/lib/types';
import styles from './sidebar.module.scss';

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [chats, setChats] = useState<ChatSummary[]>([]);
    // Su mobile la sidebar è un drawer a scomparsa: aperta/chiusa via burger.
    const [mobileOpen, setMobileOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await fetch('/api/chats', { cache: 'no-store' });
            const json = await r.json();
            setChats(json.chats ?? []);
        } catch {
            /* noop */
        }
    }, []);

    useEffect(() => {
        load();
        const h = () => load();
        window.addEventListener('tfai:chats-updated', h);
        return () => window.removeEventListener('tfai:chats-updated', h);
    }, [load]);

    // Toggle dal burger nell'header (componente diverso) → evento globale.
    useEffect(() => {
        const h = () => setMobileOpen((o) => !o);
        window.addEventListener('tfai:toggle-sidebar', h);
        return () => window.removeEventListener('tfai:toggle-sidebar', h);
    }, []);

    // Chiudi il drawer a ogni cambio rotta (apertura di una chat, ecc.).
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    const del = async (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        setChats((prev) => prev.filter((c) => c.id !== id));
        if (pathname === `/chat/${id}`) router.push('/');
    };

    const activeId = pathname?.startsWith('/chat/') ? pathname.split('/')[2] : null;

    // La sidebar (con la lista chat) appartiene alla sola sezione Assistente:
    // sulla Ricerca non va mostrata.
    if (pathname?.startsWith('/search')) return null;

    return (
        <>
            <div
                className={`${styles.backdrop} ${mobileOpen ? styles.backdropOpen : ''}`}
                onClick={() => setMobileOpen(false)}
                aria-hidden="true"
            />
            <aside className={`${styles.sidebar} ${mobileOpen ? styles.open : ''}`}>
                <div className={styles.brand}>
                    <i className="fas fa-cube" />
                    <span>
                        topFiler<b>3</b>
                    </span>
                    <button
                        className={styles.closeDrawer}
                        onClick={() => setMobileOpen(false)}
                        aria-label="Chiudi menu"
                    >
                        <i className="fas fa-xmark" />
                    </button>
                </div>

                <a
                    href="/"
                    className={styles.newChat}
                    onClick={(e) => {
                        e.preventDefault();
                        setMobileOpen(false);
                        window.dispatchEvent(new CustomEvent('tfai:new-chat'));
                        router.push('/');
                    }}
                >
                    <i className="fas fa-plus" /> Nuova chat
                </a>

                <div className={styles.listLabel}>Conversazioni</div>
                <nav className={styles.list}>
                    {chats.length === 0 ? (
                        <div className={styles.empty}>Nessuna conversazione</div>
                    ) : (
                        chats.map((c) => (
                            <Link
                                key={c.id}
                                href={`/chat/${c.id}`}
                                className={`${styles.item} ${activeId === c.id ? styles.active : ''}`}
                                onClick={() => setMobileOpen(false)}
                            >
                                <i className="fas fa-comment-dots" />
                                <span className={styles.itemTitle}>{c.title}</span>
                                <button className={styles.del} onClick={(e) => del(e, c.id)} aria-label="Elimina">
                                    <i className="fas fa-trash-can" />
                                </button>
                            </Link>
                        ))
                    )}
                </nav>

                <div className={styles.footer}>Archivio documentale · topFiler3</div>
            </aside>
        </>
    );
}
