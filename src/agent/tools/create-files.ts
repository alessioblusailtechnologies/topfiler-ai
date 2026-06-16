import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { ensureBucket, uploadFile } from '../../lib/supabase';

// ===========================================================================
// Tool di ESPORTAZIONE — create_excel / create_csv / create_pdf.
// Trasformano dati tabellari (ottenuti dagli altri tool) in un file scaricabile:
// generano il file, lo caricano su Storage sotto il prefisso `generati/` e
// restituiscono un link markdown già pronto (schema file:) che l'interfaccia
// trasforma in un pulsante di download.
// ===========================================================================

const ColumnSchema = z.object({
    key: z.string().describe('Nome del campo nella riga (chiave dell\'oggetto).'),
    label: z.string().optional().describe('Intestazione di colonna mostrata (default: key).'),
});

const tabularInput = {
    filename: z.string().describe('Nome del file SENZA estensione (verrà aggiunta automaticamente).'),
    title: z.string().optional().describe('Titolo/intestazione opzionale del documento.'),
    columns: z
        .array(ColumnSchema)
        .optional()
        .describe('Ordine e intestazioni delle colonne. Se omesso, usa le chiavi della prima riga.'),
    rows: z
        .array(z.record(z.any()))
        .describe('Righe di dati come oggetti chiave→valore. Usa i dati REALI ottenuti dai tool, non inventarli.'),
};

const tabularOutput = z.object({
    created: z.boolean(),
    format: z.string(),
    filename: z.string(),
    storage_path: z.string().optional(),
    link: z.string().optional().describe('Link markdown già pronto: inseriscilo TALE E QUALE nella risposta.'),
    note: z.string().optional(),
});

interface Col {
    key: string;
    label: string;
}

function resolveColumns(columns: Array<{ key: string; label?: string }> | undefined, rows: Record<string, unknown>[]): Col[] {
    if (columns && columns.length) return columns.map((c) => ({ key: c.key, label: c.label ?? c.key }));
    const first = rows[0] ?? {};
    return Object.keys(first).map((k) => ({ key: k, label: k }));
}

function asText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function safeName(name: string): string {
    return (name || 'export').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
}

let bucketReady = false;
async function ensureBucketOnce(): Promise<void> {
    if (bucketReady) return;
    await ensureBucket();
    bucketReady = true;
}

/** Carica il buffer sotto generati/<uuid>/<file> e ritorna path + link markdown. */
async function publish(
    baseName: string,
    ext: string,
    buffer: Buffer,
    contentType: string,
): Promise<{ storage_path: string; link: string; filename: string }> {
    await ensureBucketOnce();
    const filename = `${safeName(baseName).replace(/\.+$/g, '')}.${ext}`;
    const storage_path = `generati/${randomUUID()}/${filename}`;
    await uploadFile(storage_path, buffer, contentType);
    return { storage_path, filename, link: `[${filename}](file:${storage_path})` };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) via exceljs
// ---------------------------------------------------------------------------
async function buildXlsx(title: string | undefined, cols: Col[], rows: Record<string, unknown>[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dati');
    let r = 1;
    if (title) {
        ws.mergeCells(1, 1, 1, Math.max(1, cols.length));
        const cell = ws.getCell(1, 1);
        cell.value = title;
        cell.font = { bold: true, size: 14 };
        r = 3;
    }
    const header = ws.getRow(r);
    cols.forEach((c, i) => {
        const cell = header.getCell(i + 1);
        cell.value = c.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E88E5' } };
    });
    r++;
    for (const row of rows) {
        const xr = ws.getRow(r++);
        cols.forEach((c, i) => {
            const v = row[c.key];
            xr.getCell(i + 1).value = typeof v === 'number' ? v : asText(v);
        });
    }
    // larghezza colonne in base al contenuto (cap a 60)
    cols.forEach((c, i) => {
        let max = c.label.length;
        for (const row of rows) max = Math.max(max, asText(row[c.key]).length);
        ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 10), 60);
    });
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// CSV (UTF-8 con BOM, così Excel apre correttamente gli accenti)
// ---------------------------------------------------------------------------
function buildCsv(cols: Col[], rows: Record<string, unknown>[]): Buffer {
    const esc = (s: unknown): string => {
        const str = asText(s);
        return /[",\n\r;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [cols.map((c) => esc(c.label)).join(',')];
    for (const row of rows) lines.push(cols.map((c) => esc(row[c.key])).join(','));
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf-8');
}

// ---------------------------------------------------------------------------
// PDF via pdfkit — titolo + tabella semplice con a-capo automatico di pagina
// ---------------------------------------------------------------------------
function buildPdf(title: string | undefined, cols: Col[], rows: Record<string, unknown>[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;
        const bottom = doc.page.height - doc.page.margins.bottom;
        const tableW = right - left;
        const colW = tableW / Math.max(1, cols.length);

        doc.fontSize(16).fillColor('#1565C0').text('topFiler3', left, doc.page.margins.top);
        if (title) doc.fontSize(12).fillColor('#212121').text(title);
        doc.moveDown(0.5);

        const fit = (text: string, w: number): string => {
            let s = text;
            if (doc.widthOfString(s) <= w) return s;
            while (s.length > 1 && doc.widthOfString(s + '…') > w) s = s.slice(0, -1);
            return s + '…';
        };

        const drawRow = (values: string[], opts: { header?: boolean }): void => {
            const h = 18;
            if (doc.y + h > bottom) doc.addPage();
            const y = doc.y;
            if (opts.header) doc.rect(left, y, tableW, h).fill('#1E88E5');
            doc.fontSize(9).font(opts.header ? 'Helvetica-Bold' : 'Helvetica');
            doc.fillColor(opts.header ? '#FFFFFF' : '#212121');
            values.forEach((v, i) => {
                doc.text(fit(v, colW - 8), left + i * colW + 4, y + 5, { width: colW - 8, lineBreak: false });
            });
            doc.fillColor('#212121');
            doc.moveTo(left, y + h).lineTo(right, y + h).strokeColor('#E0E0E0').lineWidth(0.5).stroke();
            doc.y = y + h;
        };

        drawRow(cols.map((c) => c.label), { header: true });
        for (const row of rows) drawRow(cols.map((c) => asText(row[c.key])), {});

        doc.moveDown(1);
        doc.fontSize(7).fillColor('#9E9E9E').text(
            `Documento generato da topFiler3 · ${rows.length} righe.`,
            left,
            doc.y,
        );
        doc.end();
    });
}

function makeTool(id: string, ext: 'xlsx' | 'csv' | 'pdf', label: string, contentType: string) {
    return createTool({
        id,
        description:
            `Genera un file ${label} SCARICABILE dai dati tabellari forniti (columns + rows) e ne restituisce il link. ` +
            `Usalo quando l'utente chiede di ESPORTARE/SCARICARE i risultati in ${label} o di "creare un file/foglio/report". ` +
            `Passa SEMPRE i dati reali ottenuti dagli altri tool: non inventare righe. Nella risposta inserisci il campo "link" così com'è.`,
        inputSchema: z.object(tabularInput),
        outputSchema: tabularOutput,
        execute: async ({ filename, title, columns, rows }) => {
            const cols = resolveColumns(columns, rows ?? []);
            if (!cols.length) {
                return { created: false, format: ext, filename, note: 'Nessuna colonna/dato da esportare.' };
            }
            const data = rows ?? [];
            let buffer: Buffer;
            if (ext === 'xlsx') buffer = await buildXlsx(title, cols, data);
            else if (ext === 'csv') buffer = buildCsv(cols, data);
            else buffer = await buildPdf(title, cols, data);

            const { storage_path, link, filename: finalName } = await publish(filename, ext, buffer, contentType);
            return { created: true, format: ext, filename: finalName, storage_path, link };
        },
    });
}

export const createExcelTool = makeTool(
    'create_excel',
    'xlsx',
    'Excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);
export const createCsvTool = makeTool('create_csv', 'csv', 'CSV', 'text/csv; charset=utf-8');
export const createPdfTool = makeTool('create_pdf', 'pdf', 'PDF', 'application/pdf');
