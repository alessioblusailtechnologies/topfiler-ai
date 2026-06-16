import PDFDocument from 'pdfkit';
import pLimit from 'p-limit';
import { getSupabase, ensureBucket, uploadFile, setStoragePath, storageBucket } from '../src/lib/supabase';

// ===========================================================================
// seed:files — rende SCARICABILI i documenti del seed (sintetici, senza file
// sorgente) generando per ciascuno un PDF dai suoi metadati e caricandolo su
// Storage, impostando storage_path. Mantiene gli id esistenti (i link doc: in
// chat continuano a funzionare). Idempotente: solo i seed con storage_path nullo.
// ===========================================================================

interface SeedRow {
    id: string;
    tipologia: string;
    filename: string | null;
    metadata: Record<string, unknown>;
}

function buildPdf(tipologia: string, filename: string, metadata: Record<string, unknown>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: filename } });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(22).fillColor('#1565C0').text('topFiler3', { continued: false });
        doc.fontSize(15).fillColor('#212121').text(tipologia.replace(/_/g, ' '));
        doc.moveDown(0.4);
        const y = doc.y;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#1976D2').lineWidth(1).stroke();
        doc.moveDown(0.8);

        doc.fontSize(11).fillColor('#212121');
        for (const [k, v] of Object.entries(metadata)) {
            if (v === null || v === undefined) continue;
            if (k === 'righe' && Array.isArray(v)) {
                doc.font('Helvetica-Bold').text('Righe:');
                doc.font('Helvetica');
                v.forEach((r, i) => {
                    const parts = Object.entries(r as Record<string, unknown>)
                        .filter(([, rv]) => rv !== null && rv !== undefined)
                        .map(([rk, rv]) => `${rk}: ${rv}`)
                        .join('  ·  ');
                    doc.text(`   ${i + 1}. ${parts}`);
                });
                doc.moveDown(0.4);
            } else {
                doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
                doc.font('Helvetica').text(String(v));
            }
        }

        doc.moveDown(2);
        doc.fontSize(8).fillColor('#9E9E9E').text(
            'Documento dimostrativo generato automaticamente da topFiler3 a partire dai metadati (dati sintetici di esempio).',
        );
        doc.end();
    });
}

async function main(): Promise<void> {
    console.log(`=== seed:files (bucket=${storageBucket()}) ===\n`);
    await ensureBucket();

    const sb = getSupabase();
    const { data, error } = await sb
        .from('topfiler_final_ai_documenti')
        .select('id, tipologia, filename, metadata')
        .like('hash_sha256', 'seed:%')
        .is('storage_path', null)
        .limit(1000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SeedRow[];
    console.log(`Documenti seed da rendere scaricabili: ${rows.length}\n`);

    const limit = pLimit(5);
    let ok = 0;
    let err = 0;
    await Promise.all(
        rows.map((r) =>
            limit(async () => {
                try {
                    const safeName = (r.filename || `${r.tipologia}.pdf`).replace(/[^\w.\- ]+/g, '_');
                    const buf = await buildPdf(r.tipologia, safeName, r.metadata ?? {});
                    const path = `${r.tipologia}/${r.id}/${safeName}`;
                    await uploadFile(path, buf, 'application/pdf');
                    await setStoragePath(r.id, path);
                    ok++;
                } catch (e) {
                    err++;
                    console.warn(`  errore ${r.filename}: ${(e as Error).message}`);
                }
            }),
        ),
    );

    console.log('\n=== Fatto ===');
    console.table({ generati: ok, errori: err, totale: rows.length });
}

main().catch((e) => {
    console.error('Errore fatale:', e);
    process.exit(1);
});
