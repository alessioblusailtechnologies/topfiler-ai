import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'topfiler-final-ai-documenti';

// GET /api/document/:id — genera una signed URL fresca e reindirizza al file.
// Usata dai link [etichetta](doc:ID) trasformati in pulsanti di download.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const sb = getServerSupabase();

    const { data } = await sb
        .from('topfiler_final_ai_documenti')
        .select('storage_path, filename')
        .eq('id', id)
        .maybeSingle<{ storage_path: string | null; filename: string | null }>();

    if (!data) return NextResponse.json({ error: 'documento non trovato' }, { status: 404 });
    if (!data.storage_path) {
        return NextResponse.json({ error: 'file non disponibile su storage per questo documento' }, { status: 404 });
    }

    const { data: signed, error } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(data.storage_path, 600, { download: data.filename ?? undefined });

    if (error || !signed) {
        return NextResponse.json({ error: error?.message ?? 'errore generazione link' }, { status: 500 });
    }
    return NextResponse.redirect(signed.signedUrl);
}
