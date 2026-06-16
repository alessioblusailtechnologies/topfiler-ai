'use client';

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import styles from './markdown.module.scss';

const components: Components = {
    table: ({ children }) => (
        <div className={styles.tableWrapper}>
            <table className={styles.table}>{children}</table>
        </div>
    ),
    thead: ({ children }) => <thead className={styles.thead}>{children}</thead>,
    th: ({ children }) => <th className={styles.th}>{children}</th>,
    td: ({ children }) => <td className={styles.td}>{children}</td>,
    a: ({ children, href }) => {
        // Citazioni documento: [etichetta](doc:UUID) → pulsante di download.
        if (href && href.startsWith('doc:')) {
            const id = href.slice(4).trim();
            return (
                <a className={styles.docLink} href={`/api/document/${id}`} target="_blank" rel="noopener noreferrer">
                    <i className="fas fa-file-arrow-down" />
                    <span>{children}</span>
                </a>
            );
        }
        // File generati dall'assistente: [nome.ext](file:percorso) → download.
        if (href && href.startsWith('file:')) {
            const path = href.slice(5).trim();
            const ext = path.split('.').pop()?.toLowerCase() ?? '';
            const icon =
                ext === 'xlsx' || ext === 'csv'
                    ? 'fa-file-excel'
                    : ext === 'pdf'
                      ? 'fa-file-pdf'
                      : 'fa-file-arrow-down';
            return (
                <a
                    className={styles.docLink}
                    href={`/api/file?path=${encodeURIComponent(path)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <i className={`fas ${icon}`} />
                    <span>{children}</span>
                </a>
            );
        }
        return (
            <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
                {children}
            </a>
        );
    },
    code: ({ children, className }) =>
        className?.includes('language-') ? (
            <code className={styles.codeBlock}>{children}</code>
        ) : (
            <code className={styles.codeInline}>{children}</code>
        ),
    pre: ({ children }) => <pre className={styles.pre}>{children}</pre>,
    ul: ({ children }) => <ul className={styles.ul}>{children}</ul>,
    ol: ({ children }) => <ol className={styles.ol}>{children}</ol>,
    li: ({ children }) => <li className={styles.li}>{children}</li>,
    p: ({ children }) => <p className={styles.p}>{children}</p>,
    h1: ({ children }) => <h3 className={styles.heading}>{children}</h3>,
    h2: ({ children }) => <h4 className={styles.heading}>{children}</h4>,
    h3: ({ children }) => <h4 className={styles.heading}>{children}</h4>,
    strong: ({ children }) => <strong className={styles.strong}>{children}</strong>,
    blockquote: ({ children }) => <blockquote className={styles.blockquote}>{children}</blockquote>,
    hr: () => <hr className={styles.hr} />,
};

function MarkdownRenderer({ content }: { content: string }) {
    return (
        <div className={styles.markdown}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={components}
                // Non sanitizzare gli URL: serve a preservare lo schema doc: dei link di download.
                urlTransform={(url) => url}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

// Memoizzato sul contenuto: durante lo streaming si ri-parsa solo il messaggio
// che cambia, non l'intera cronologia (il parsing markdown è costoso).
export default memo(MarkdownRenderer);
