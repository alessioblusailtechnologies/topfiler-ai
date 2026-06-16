import { NextResponse } from 'next/server';
import { getServerSupabase, TABLES } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/chats — elenco conversazioni (per la sidebar)
export async function GET() {
    try {
        const sb = getServerSupabase();
        const { data, error } = await sb
            .from(TABLES.chats)
            .select('id, title, updated_at')
            .order('updated_at', { ascending: false })
            .limit(200);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ chats: data ?? [] });
    } catch (e) {
        // Tipicamente env Supabase mancante sul servizio web: restituiamo il
        // motivo così è visibile nella risposta (non un 500 muto).
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// POST /api/chats — crea una nuova conversazione vuota
export async function POST() {
    try {
        const sb = getServerSupabase();
        const { data, error } = await sb
            .from(TABLES.chats)
            .insert({ title: 'Nuova chat' })
            .select('id, title, updated_at')
            .single();
        if (error || !data) {
            return NextResponse.json({ error: error?.message ?? 'errore creazione chat' }, { status: 500 });
        }
        return NextResponse.json({ chat: data });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
