import type { Metadata } from 'next';
import './globals.scss';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
    title: 'topFiler3 · Assistente documentale',
    description: "Assistente conversazionale sull'archivio documentale topFiler3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="it">
            <head>
                <link
                    rel="stylesheet"
                    href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
                />
            </head>
            <body>
                <div className="app">
                    <Sidebar />
                    <main className="main">{children}</main>
                </div>
            </body>
        </html>
    );
}
