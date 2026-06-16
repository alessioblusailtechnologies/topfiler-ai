import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, TABLES, type DbChat } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/chats/:id — metadati + cronologia messaggi
export async function GET(_req: NextRequest, ctx: Ctx) {
    try {
        const { id } = await ctx.params;
        const sb = getServerSupabase();
        const { data: chat } = await sb
            .from(TABLES.chats)
            .select('id, title, created_at, updated_at')
            .eq('id', id)
            .maybeSingle<DbChat>();
        if (!chat) return NextResponse.json({ error: 'chat non trovata' }, { status: 404 });
        const { data: rows } = await sb
            .from(TABLES.messages)
            .select('id, role, content')
            .eq('chat_id', id)
            .order('created_at', { ascending: true });
        return NextResponse.json({ chat, messages: rows ?? [] });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// DELETE /api/chats/:id — elimina la conversazione (cascade sui messaggi)
export async function DELETE(_req: NextRequest, ctx: Ctx) {
    try {
        const { id } = await ctx.params;
        const sb = getServerSupabase();
        const { error } = await sb.from(TABLES.chats).delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
