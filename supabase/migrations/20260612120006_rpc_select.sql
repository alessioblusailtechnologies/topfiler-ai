-- ===========================================================================
-- topFiler3 · accesso runtime via SOLO supabase-js (niente connessione pg diretta)
--
-- text_to_sql esegue la SELECT (già validata dall'app SqlGuard: un solo SELECT,
-- solo la tabella documenti, niente DML/funzioni di sistema, path JSONB whitelisted)
-- tramite la RPC run_select. La funzione aggiunge uno statement_timeout. Le due
-- RPC sono esposte a service_role (la chiave usata da supabase-js lato server).
-- Versione semplice: nessun ruolo/ownership separato (la protezione è il SqlGuard).
-- ===========================================================================

create or replace function topfiler_final_ai_run_select(q text)
returns jsonb
language plpgsql
as $fn$
declare
    result jsonb;
begin
    set local statement_timeout = '10s';
    execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) as t', q) into result;
    return result;
end;
$fn$;

grant execute on function topfiler_final_ai_run_select(text) to service_role;
grant execute on function topfiler_final_ai_match_doc_chunks(vector, text, int, text, jsonb, int, float, float) to service_role;
