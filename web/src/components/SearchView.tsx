'use client';

import { useCallback, useState } from 'react';
import TopNav from './TopNav';
import type { SearchDocResult, SearchDocsResponse } from '@/lib/types';
import styles from './search.module.scss';

const SUGGESTIONS = [
    'Specifiche tecniche di cantieri',
    'Contratti di fornitura e helpdesk',
    'Idoneità mediche dei dipendenti',
    'Fatture per materiale edile',
    'Richiami disciplinari',
];

// Etichetta leggibile della tipologia (CONTRATTO_LAVORO → "Contratto Lavoro").
function tipologiaLabel(t: string): string {
    return t
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// Classe-tag (colore) per tipologia, con fallback neutro.
const TAG_CLASS: Record<string, string> = {
    FATTURA: 'tagFattura',
    CONTRATTO_LAVORO: 'tagContratto',
    IDONEITA_MEDICA: 'tagMedica',
    ATTESTATO: 'tagAttestato',
    ORDINE_ACQUISTO: 'tagOrdine',
    OFFERTA_ACQUISTO: 'tagOfferta',
    MANUALE: 'tagManuale',
    MATERIALE_PUBBLICITARIO: 'tagPubblicitario',
    RICHIAMO_DISCIPLINARE: 'tagRichiamo',
};

function humanizeKey(k: string): string {
    return k.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Coppie chiave/valore "piatte" dai metadati eterogenei (solo scalari + conteggi
// per gli array) per la griglia del dettaglio.
function flattenMetadata(metadata: Record<string, unknown>): { key: string; value: string }[] {
    const out: { key: string; value: string }[] = [];
    for (const [k, v] of Object.entries(metadata ?? {})) {
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v)) {
            if (v.length) out.push({ key: humanizeKey(k), value: `${v.length} voci` });
            continue;
        }
        if (typeof v === 'object') continue;
        out.push({ key: humanizeKey(k), value: String(v) });
    }
    return out;
}

export default function SearchView() {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState<SearchDocsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<SearchDocResult | null>(null);

    const run = useCallback(async (raw: string) => {
        const q = raw.trim();
        if (!q) return;
        setLoading(true);
        setError(null);
        setResponse(null);
        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: q, top_k: 20 }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
            setResponse(json as SearchDocsResponse);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') run(query);
    };

    const results = response?.results ?? [];

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <i className="fas fa-magnifying-glass" />
                    <span className={styles.title}>topFiler3 · Ricerca documentale</span>
                </div>
                <div className={styles.headerRight}>
                    <TopNav />
                </div>
            </div>

            <div className={styles.scroll}>
                {/* Barra di ricerca AI */}
                <div className={styles.searchSection}>
                    <div className={styles.searchLabel}>
                        <span className={styles.aiIcon}>
                            <i className="fas fa-wand-magic-sparkles" /> Ricerca AI
                        </span>
                        Descrivi in linguaggio naturale i documenti che stai cercando, su qualsiasi tipologia
                    </div>
                    <div className={styles.inputBar}>
                        <i className={`fas fa-wand-magic-sparkles ${styles.sparkle}`} />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder='Es: "specifiche tecniche cantiere", "contratto helpdesk", "idoneità medica 2026"…'
                        />
                        <button className={styles.searchBtn} onClick={() => run(query)} disabled={loading}>
                            <i className="fas fa-wand-magic-sparkles" /> Ricerca
                        </button>
                    </div>
                    <div className={styles.suggestions}>
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                className={styles.chip}
                                onClick={() => {
                                    setQuery(s);
                                    run(s);
                                }}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Loading */}
                {loading && (
                    <div className={styles.loading}>
                        <div className={styles.spinner} />
                        <div className={styles.loadingText}>
                            <i className="fas fa-wand-magic-sparkles" /> Analisi semantica in corso…
                        </div>
                    </div>
                )}

                {/* Errore */}
                {error && !loading && (
                    <div className={styles.error}>
                        <i className="fas fa-triangle-exclamation" /> {error}
                    </div>
                )}

                {/* Interpretazione AI */}
                {response && !loading && (
                    <div className={styles.interpreted}>
                        <i className="fas fa-brain" />
                        <span className={styles.interpretedLabel}>Interpretazione AI:</span>
                        <span className={styles.interpretedQuery}>{response.query}</span>
                        <span className={styles.meta}>
                            {response.total} documenti · {response.elapsed_ms} ms
                        </span>
                    </div>
                )}

                {/* Tabella risultati */}
                {response && !loading && results.length > 0 && (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Tipo Documento</th>
                                <th>
                                    Descrizione <i className="fas fa-sort-alpha-up" />
                                </th>
                                <th className={styles.center}>Gerarchia</th>
                                <th className={styles.center}>Chiavi</th>
                                <th className={styles.center}>Memo</th>
                                <th className={styles.center}>Allegati</th>
                                <th className={styles.center}>Cartelle</th>
                                <th className={styles.center}>Rilevanza</th>
                                <th className={styles.center}>Dettaglio AI</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((doc) => (
                                <tr key={doc.doc_id} className={styles.aiMatch}>
                                    <td>
                                        <span className={styles.date}>{formatDate(doc.data)}</span>
                                    </td>
                                    <td>
                                        <span
                                            className={`${styles.typeTag} ${styles[TAG_CLASS[doc.tipologia] ?? 'tagAltro']}`}
                                        >
                                            {tipologiaLabel(doc.tipologia)}
                                        </span>
                                    </td>
                                    <td>
                                        {doc.downloadable ? (
                                            <a
                                                className={styles.docLink}
                                                href={`/api/document/${doc.doc_id}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                <i className="fas fa-file-arrow-down" />{' '}
                                                {doc.filename ?? `${tipologiaLabel(doc.tipologia)}`}
                                            </a>
                                        ) : (
                                            <span className={styles.docPlain}>
                                                {doc.filename ?? tipologiaLabel(doc.tipologia)}
                                            </span>
                                        )}
                                    </td>
                                    <td className={styles.center}>
                                        <i className={`fas fa-sitemap ${styles.tblIcon}`} />
                                    </td>
                                    <td className={styles.center}>
                                        <i className={`fas fa-key ${styles.tblIcon}`} />
                                    </td>
                                    <td className={styles.center}>
                                        <i className={`far fa-comment-dots ${styles.tblIcon}`} />
                                    </td>
                                    <td className={styles.center}>
                                        {doc.downloadable ? (
                                            <i className={`fas fa-paperclip ${styles.tblIconDark}`} />
                                        ) : (
                                            <span className={styles.dash}>—</span>
                                        )}
                                    </td>
                                    <td className={styles.center}>
                                        <i className={`far fa-folder-open ${styles.tblIcon}`} />
                                    </td>
                                    <td className={styles.center}>
                                        <span className={`${styles.relevanceTag} ${styles[`rel_${doc.relevance}`]}`}>
                                            {doc.relevance === 'alta'
                                                ? 'Alta'
                                                : doc.relevance === 'media'
                                                  ? 'Media'
                                                  : 'Bassa'}
                                        </span>
                                    </td>
                                    <td className={styles.center}>
                                        <button
                                            className={styles.detailBtn}
                                            onClick={() => setSelected(doc)}
                                            title="Dettaglio AI"
                                        >
                                            <i className="fas fa-wand-magic-sparkles" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {/* Nessun risultato */}
                {response && !loading && results.length === 0 && (
                    <div className={styles.empty}>
                        <i className="fas fa-folder-open" />
                        <p>Nessun documento trovato per «{response.query}».</p>
                    </div>
                )}

                {/* Stato iniziale */}
                {!response && !loading && !error && (
                    <div className={styles.welcome}>
                        <div className={styles.welcomeIcon}>
                            <i className="fas fa-magnifying-glass" />
                        </div>
                        <h2>Ricerca semantica nell&apos;archivio</h2>
                        <p>
                            Usa lo stesso motore dell&apos;assistente per ottenere una lista di documenti ordinata per
                            rilevanza. Scrivi una descrizione o scegli un suggerimento.
                        </p>
                    </div>
                )}
            </div>

            {/* Modale dettaglio */}
            {selected && (
                <div className={styles.overlay} onClick={() => setSelected(null)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div className={styles.modalTitle}>
                                <i className="fas fa-wand-magic-sparkles" />
                                Dettaglio AI — {selected.filename ?? tipologiaLabel(selected.tipologia)}
                            </div>
                            <button className={styles.modalClose} onClick={() => setSelected(null)}>
                                <i className="fas fa-times" />
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>
                                    <i className="fas fa-gauge-high" /> Rilevanza
                                </div>
                                <div className={styles.detailText}>
                                    <span className={`${styles.relevanceTag} ${styles[`rel_${selected.relevance}`]}`}>
                                        {selected.score_percent}% ·{' '}
                                        {selected.relevance.charAt(0).toUpperCase() + selected.relevance.slice(1)}
                                    </span>{' '}
                                    <span className={styles.typeTag + ' ' + (styles[TAG_CLASS[selected.tipologia] ?? 'tagAltro'])}>
                                        {tipologiaLabel(selected.tipologia)}
                                    </span>
                                </div>
                            </div>

                            {selected.snippet && (
                                <div className={styles.section}>
                                    <div className={styles.sectionLabel}>
                                        <i className="fas fa-brain" /> Estratto più rilevante
                                    </div>
                                    <div className={styles.detailText}>{selected.snippet}</div>
                                </div>
                            )}

                            {flattenMetadata(selected.metadata).length > 0 && (
                                <div className={styles.section}>
                                    <div className={styles.sectionLabel}>
                                        <i className="fas fa-tags" /> Metadati
                                    </div>
                                    <div className={styles.metaGrid}>
                                        {flattenMetadata(selected.metadata).map((m) => (
                                            <div key={m.key} className={styles.metaItem}>
                                                <span className={styles.metaKey}>{m.key}:</span>
                                                <span className={styles.metaValue}>{m.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selected.matching_chunks.length > 0 && (
                                <div className={styles.section}>
                                    <div className={styles.sectionLabel}>
                                        <i className="fas fa-puzzle-piece" /> Chunk corrispondenti (
                                        {selected.matching_chunks.length})
                                    </div>
                                    <div className={styles.chunks}>
                                        {selected.matching_chunks.map((c, i) => (
                                            <div key={i} className={styles.chunk}>
                                                <div className={styles.chunkHeader}>
                                                    <span className={styles.chunkType}>
                                                        {c.chunk_type}
                                                        {c.riga_index !== null ? ` · riga ${c.riga_index}` : ''}
                                                    </span>
                                                    <span className={styles.chunkScore}>{c.score_percent}%</span>
                                                </div>
                                                <div className={styles.chunkText}>{c.testo}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selected.downloadable && (
                                <a
                                    className={styles.downloadBtn}
                                    href={`/api/document/${selected.doc_id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <i className="fas fa-file-arrow-down" /> Scarica documento
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
