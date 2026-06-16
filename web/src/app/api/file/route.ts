import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'topfiler-final-ai-documenti';

// GET /api/file?path=generati/<uuid>/<nome> — genera una signed URL fresca per
// un file GENERATO dall'assistente (Excel/CSV/PDF) e reindirizza al download.
// Limitato al prefisso `generati/` per non esporre percorsi arbitrari.
export async function GET(req: NextRequest) {
    const path = req.nextUrl.searchParams.get('path') ?? '';
    if (!path.startsWith('generati/') || path.includes('..')) {
        return NextResponse.json({ error: 'percorso non consentito' }, { status: 400 });
    }
    const filename = path.split('/').pop() || 'file';
    const sb = getServerSupabase();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600, { download: filename });
    if (error || !data) {
        return NextResponse.json({ error: error?.message ?? 'file non disponibile' }, { status: 404 });
    }
    return NextResponse.redirect(data.signedUrl);
}
