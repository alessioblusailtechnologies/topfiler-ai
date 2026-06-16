import { NextResponse } from 'next/server';
import { getServerSupabase, TABLES } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/chats — elenco conversazioni (per la sidebar)
export async function GET() {
    const sb = getServerSupabase();
    const { data, error } = await sb
        .from(TABLES.chats)
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ chats: data ?? [] });
}

// POST /api/chats — crea una nuova conversazione vuota
export async function POST() {
    const sb = getServerSupabase();
    const { data, error } = await sb
        .from(TABLES.chats)
        .insert({ title: 'Nuova chat' })
        .select('id, title, updated_at')
        .single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'errore creazione chat' }, { status: 500 });
    return NextResponse.json({ chat: data });
}
