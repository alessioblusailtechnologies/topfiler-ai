import { randomUUID } from 'node:crypto';
import { getSupabase } from '../src/lib/supabase';

// ===========================================================================
// seed:demo — inserisce dati sintetici COERENTI con le 10 domande della
// checklist di verifica (README), inclusi i casi negativi:
//   - un apprendista 2025 con SOLO l'attestato sicurezza (BIANCHI LUCA)
//   - un contratto stipulato a luglio 2026 (VERDI GIULIA), non attivo a giugno 2026
// Inserisce SOLO righe `documenti` (i 10 quesiti sono tutti text-to-SQL sui
// metadati). La ricerca semantica richiede embedding reali (vedi README).
// Reseed idempotente: cancella prima le righe seed (hash 'seed:%').
// ===========================================================================

interface Spec {
    tipologia: string;
    metadata: Record<string, unknown>;
    filename: string;
}

const SPECS: Spec[] = [
    // --- MARINO ALESSIO (set HR completo) — Q1 -------------------------------
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_marino.pdf', metadata: { dipendente_nome_norm: 'MARINO ALESSIO', tipo_contratto: 'INDETERMINATO', data_stipula: '2022-03-01', data_scadenza: null, mansione: 'tecnico helpdesk', settore: 'IT', stato: 'ATTIVO' } },
    { tipologia: 'RICHIAMO_DISCIPLINARE', filename: 'richiamo_marino.pdf', metadata: { dipendente_nome_norm: 'MARINO ALESSIO', data: '2023-06-15', motivo: 'ritardi reiterati' } },
    { tipologia: 'IDONEITA_MEDICA', filename: 'idoneita_marino.pdf', metadata: { dipendente_nome_norm: 'MARINO ALESSIO', data_emissione: '2024-05-20', esito: 'IDONEO' } },
    { tipologia: 'ATTESTATO', filename: 'attestato_ps_marino.pdf', metadata: { dipendente_nome_norm: 'MARINO ALESSIO', tipo_corso: 'PRIMO_SOCCORSO', data_emissione: '2023-04-10', validita_mesi: 36 } },
    { tipologia: 'ATTESTATO', filename: 'attestato_sic_marino.pdf', metadata: { dipendente_nome_norm: 'MARINO ALESSIO', tipo_corso: 'SICUREZZA', data_emissione: '2023-04-12', validita_mesi: 60 } },

    // --- ROMANO MATTEO (set HR completo) — Q1, Q3, Q4(attivo), Q6, Q10 -------
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_romano.pdf', metadata: { dipendente_nome_norm: 'ROMANO MATTEO', tipo_contratto: 'DETERMINATO', data_stipula: '2024-01-15', data_scadenza: '2026-09-30', mansione: 'addetto controllo qualità', settore: 'IT', stato: 'ATTIVO' } },
    { tipologia: 'RICHIAMO_DISCIPLINARE', filename: 'richiamo_romano.pdf', metadata: { dipendente_nome_norm: 'ROMANO MATTEO', data: '2025-02-20', motivo: 'uso improprio strumenti aziendali' } },
    { tipologia: 'IDONEITA_MEDICA', filename: 'idoneita_romano.pdf', metadata: { dipendente_nome_norm: 'ROMANO MATTEO', data_emissione: '2024-09-10', esito: 'IDONEO CON PRESCRIZIONI' } },
    { tipologia: 'ATTESTATO', filename: 'attestato_ps_romano.pdf', metadata: { dipendente_nome_norm: 'ROMANO MATTEO', tipo_corso: 'PRIMO_SOCCORSO', data_emissione: '2024-03-01', validita_mesi: 36 } },
    { tipologia: 'ATTESTATO', filename: 'attestato_sic_romano.pdf', metadata: { dipendente_nome_norm: 'ROMANO MATTEO', tipo_corso: 'SICUREZZA', data_emissione: '2024-03-03', validita_mesi: 60 } },

    // --- MORETTI DAVIDE: apprendista 2025 con ENTRAMBI gli attestati — Q2 (+) -
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_moretti.pdf', metadata: { dipendente_nome_norm: 'MORETTI DAVIDE', tipo_contratto: 'APPRENDISTATO', data_stipula: '2025-04-01', data_scadenza: '2028-03-31', mansione: 'sviluppatore junior', settore: 'IT', stato: 'ATTIVO' } },
    { tipologia: 'ATTESTATO', filename: 'attestato_sic_moretti.pdf', metadata: { dipendente_nome_norm: 'MORETTI DAVIDE', tipo_corso: 'SICUREZZA', data_emissione: '2025-05-10', validita_mesi: 60 } },
    { tipologia: 'ATTESTATO', filename: 'attestato_ps_moretti.pdf', metadata: { dipendente_nome_norm: 'MORETTI DAVIDE', tipo_corso: 'PRIMO_SOCCORSO', data_emissione: '2025-05-12', validita_mesi: 36 } },

    // --- BIANCHI LUCA: apprendista 2025 con SOLO sicurezza — Q2 (caso negativo) -
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_bianchi.pdf', metadata: { dipendente_nome_norm: 'BIANCHI LUCA', tipo_contratto: 'APPRENDISTATO', data_stipula: '2025-06-01', data_scadenza: '2028-05-31', mansione: 'magazziniere', settore: 'LOGISTICA', stato: 'ATTIVO' } },
    { tipologia: 'ATTESTATO', filename: 'attestato_sic_bianchi.pdf', metadata: { dipendente_nome_norm: 'BIANCHI LUCA', tipo_corso: 'SICUREZZA', data_emissione: '2025-06-15', validita_mesi: 60 } },

    // --- VERDI GIULIA: contratto stipulato a luglio 2026 — Q10 (caso negativo) -
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_verdi.pdf', metadata: { dipendente_nome_norm: 'VERDI GIULIA', tipo_contratto: 'INDETERMINATO', data_stipula: '2026-07-01', data_scadenza: null, mansione: 'impiegata amministrativa', settore: 'AMMINISTRAZIONE', stato: 'ATTIVO' } },

    // --- Contratti controllo/IT scaduti/non rinnovati — Q4 -------------------
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_ferrari.pdf', metadata: { dipendente_nome_norm: 'FERRARI CHIARA', tipo_contratto: 'DETERMINATO', data_stipula: '2021-01-01', data_scadenza: '2024-12-31', mansione: 'responsabile controllo accessi', settore: 'IT', stato: 'SCADUTO' } },
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_gallo.pdf', metadata: { dipendente_nome_norm: 'GALLO PAOLO', tipo_contratto: 'DETERMINATO', data_stipula: '2022-05-01', data_scadenza: '2025-04-30', mansione: 'addetto controllo qualità', settore: 'IT', stato: 'NON_RINNOVATO' } },

    // --- Helpdesk scaduto — Q5 ----------------------------------------------
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_costa.pdf', metadata: { dipendente_nome_norm: 'COSTA SARA', tipo_contratto: 'DETERMINATO', data_stipula: '2020-02-01', data_scadenza: '2023-01-31', mansione: 'tecnico helpdesk', settore: 'IT', stato: 'SCADUTO' } },

    // --- Contratto con scadenza 2026 (non controllo) — Q3 -------------------
    { tipologia: 'CONTRATTO_LAVORO', filename: 'contratto_rizzo.pdf', metadata: { dipendente_nome_norm: 'RIZZO MARCO', tipo_contratto: 'DETERMINATO', data_stipula: '2023-03-01', data_scadenza: '2026-02-28', mansione: 'operaio specializzato', settore: 'PRODUZIONE', stato: 'ATTIVO' } },

    // --- Idoneità che NON scade nel 2026 (caso negativo Q6) ------------------
    { tipologia: 'IDONEITA_MEDICA', filename: 'idoneita_ferrari.pdf', metadata: { dipendente_nome_norm: 'FERRARI CHIARA', data_emissione: '2025-02-01', esito: 'IDONEO' } },

    // --- Fatture attive con manutenzione, per tipo — Q7 ---------------------
    { tipologia: 'FATTURA', filename: 'fattura_ft2025001.pdf', metadata: { direzione: 'ATTIVA', numero: 'FT-2025-001', data_emissione: '2025-03-10', controparte: 'OMICRON DATA SRL', importo_totale: 12000, num_righe_servizio: 2, righe: [{ descrizione: 'manutenzione server', tipo: 'SERVIZIO', importo: 5000, tipo_manutenzione: 'ORDINARIA' }, { descrizione: 'manutenzione rete', tipo: 'SERVIZIO', importo: 3000, tipo_manutenzione: 'STRAORDINARIA' }, { descrizione: 'licenza software', tipo: 'BENE', importo: 4000, tipo_manutenzione: null }] } },
    { tipologia: 'FATTURA', filename: 'fattura_ft2025002.pdf', metadata: { direzione: 'ATTIVA', numero: 'FT-2025-002', data_emissione: '2025-04-05', controparte: 'ACME SPA', importo_totale: 8000, num_righe_servizio: 1, righe: [{ descrizione: 'manutenzione impianti', tipo: 'SERVIZIO', importo: 8000, tipo_manutenzione: 'ORDINARIA' }] } },
    { tipologia: 'FATTURA', filename: 'fattura_ft2025003.pdf', metadata: { direzione: 'ATTIVA', numero: 'FT-2025-003', data_emissione: '2025-05-20', controparte: 'BETA SRL', importo_totale: 4500, num_righe_servizio: 1, righe: [{ descrizione: 'manutenzione preventiva climatizzatori', tipo: 'SERVIZIO', importo: 4500, tipo_manutenzione: 'PREVENTIVA' }] } },
    { tipologia: 'FATTURA', filename: 'fattura_passiva.pdf', metadata: { direzione: 'PASSIVA', numero: 'FP-2025-009', data_emissione: '2025-02-01', controparte: 'FORNITORE X', importo_totale: 2000, num_righe_servizio: 1, righe: [{ descrizione: 'manutenzione caldaia', tipo: 'SERVIZIO', importo: 2000, tipo_manutenzione: 'CORRETTIVA' }] } },

    // --- Offerte con licenze, per anno — Q8 ---------------------------------
    { tipologia: 'OFFERTA_ACQUISTO', filename: 'offerta_soft.pdf', metadata: { data: '2024-06-01', anno: 2024, fornitore: 'Soft SRL', num_licenze: 50, oggetto: 'licenze suite ufficio', righe: [{ descrizione: 'licenze annuali 50 utenti', importo: 15000 }] } },
    { tipologia: 'OFFERTA_ACQUISTO', filename: 'offerta_licensehub.pdf', metadata: { data: '2025-03-15', anno: 2025, fornitore: 'LicenseHub', num_licenze: 35, oggetto: 'licenze gestionale', righe: [{ descrizione: 'licenze 35 utenti', importo: 12250 }] } },
    { tipologia: 'OFFERTA_ACQUISTO', filename: 'offerta_bigsoft.pdf', metadata: { data: '2025-09-01', anno: 2025, fornitore: 'BigSoft', num_licenze: 120, oggetto: 'licenze enterprise', righe: [{ descrizione: 'licenze 120 utenti', importo: 60000 }] } },
    { tipologia: 'OFFERTA_ACQUISTO', filename: 'offerta_small.pdf', metadata: { data: '2025-07-10', anno: 2025, fornitore: 'PiccoloSoft', num_licenze: 20, oggetto: 'licenze base', righe: [{ descrizione: 'licenze 20 utenti', importo: 4000 }] } },
    { tipologia: 'OFFERTA_ACQUISTO', filename: 'offerta_servizi.pdf', metadata: { data: '2025-05-05', anno: 2025, fornitore: 'ConsultIT', num_licenze: null, oggetto: 'consulenza sistemistica', righe: [{ descrizione: 'giornate consulenza', importo: 9000 }] } },

    // --- Ordini con/ senza hardware — Q9 ------------------------------------
    { tipologia: 'ORDINE_ACQUISTO', filename: 'ordine_oa001.pdf', metadata: { numero: 'OA-001', data: '2025-02-10', fornitore: 'Digital Hardware Srl', righe: [{ descrizione: 'server rack', categoria: 'HARDWARE', quantita: 2, importo: 8000 }, { descrizione: 'licenza sistema operativo', categoria: 'SOFTWARE', quantita: 2, importo: 500 }] } },
    { tipologia: 'ORDINE_ACQUISTO', filename: 'ordine_oa002.pdf', metadata: { numero: 'OA-002', data: '2025-03-22', fornitore: 'PC Store', righe: [{ descrizione: 'notebook business', categoria: 'HARDWARE', quantita: 5, importo: 6000 }] } },
    { tipologia: 'ORDINE_ACQUISTO', filename: 'ordine_oa003.pdf', metadata: { numero: 'OA-003', data: '2025-04-18', fornitore: 'CloudOnly', righe: [{ descrizione: 'abbonamento cloud', categoria: 'SERVIZIO', quantita: 1, importo: 1200 }] } },

    // --- Documenti non-HR per list_schema / completezza ---------------------
    { tipologia: 'MANUALE', filename: 'manuale_topfiler.pdf', metadata: { prodotto: 'topFiler', versione: '3.0', argomento: 'gestione utenti e ruoli' } },
    { tipologia: 'MATERIALE_PUBBLICITARIO', filename: 'promo_primavera.pdf', metadata: { campagna: 'Promo Primavera', anno: 2025, target: 'PMI' } },
];

async function main(): Promise<void> {
    const sb = getSupabase();

    console.log('seed:demo — pulizia righe seed precedenti…');
    await sb.from('topfiler_final_ai_documenti').delete().like('hash_sha256', 'seed:%');

    const rows = SPECS.map((s, i) => ({
        id: randomUUID(),
        tipologia: s.tipologia,
        metadata: s.metadata,
        storage_path: null,
        source_oracle_id: null,
        filename: s.filename,
        mime_type: 'application/pdf',
        hash_sha256: `seed:${String(i).padStart(3, '0')}`,
        stato_ingestion: 'VALIDATO',
        confidence: 0.99,
    }));

    console.log(`seed:demo — inserimento ${rows.length} documenti…`);
    for (let i = 0; i < rows.length; i += 100) {
        const { error } = await sb.from('topfiler_final_ai_documenti').insert(rows.slice(i, i + 100));
        if (error) throw new Error(`insert seed: ${error.message}`);
    }

    const byTip = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.tipologia] = (acc[r.tipologia] ?? 0) + 1;
        return acc;
    }, {});
    console.log('seed:demo — completato.');
    console.table(byTip);
}

main().catch((e) => {
    console.error('Errore seed:demo:', e);
    process.exit(1);
});
