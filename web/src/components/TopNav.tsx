'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './topnav.module.scss';

// Toggle di sezione mostrato nella topbar di entrambe le viste: alterna tra
// l'assistente conversazionale (/) e la ricerca a lista documenti (/search).
export default function TopNav() {
    const pathname = usePathname();
    const onSearch = pathname?.startsWith('/search') ?? false;

    return (
        <div className={styles.nav} role="tablist" aria-label="Sezioni">
            <Link
                href="/"
                role="tab"
                aria-selected={!onSearch}
                className={`${styles.btn} ${!onSearch ? styles.active : ''}`}
            >
                <i className="fas fa-comments" /> Assistente
            </Link>
            <Link
                href="/search"
                role="tab"
                aria-selected={onSearch}
                className={`${styles.btn} ${onSearch ? styles.active : ''}`}
            >
                <i className="fas fa-magnifying-glass" /> Ricerca
            </Link>
        </div>
    );
}
