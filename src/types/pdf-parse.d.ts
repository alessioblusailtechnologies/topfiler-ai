// pdf-parse non espone i type per l'entrypoint interno (lib/pdf-parse.js), che
// usiamo per evitare il "debug mode" del wrapper. Dichiarazione minimale.
// oracledb (v6) non espone un campo "types": lo importiamo dinamicamente solo
// nel percorso di ingestion da Oracle. Dichiarazione minimale per il compilatore.
declare module 'oracledb';

declare module 'pdf-parse/lib/pdf-parse.js' {
    interface PdfParseResult {
        text: string;
        numpages: number;
        numrender: number;
        info: unknown;
        metadata: unknown;
        version: string;
    }
    function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
    export default pdfParse;
}
