-- ===========================================================================
-- topFiler3 · ruolo read-only per il tool text_to_sql — prefisso topfiler_final_ai_
-- SOLO SELECT su topfiler_final_ai_documenti + EXECUTE sulla funzione RRF.
-- La password 'Tfai_RO_2026_kP9vXz' deve coincidere con READONLY_DATABASE_URL.
-- ===========================================================================

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'topfiler_final_ai_readonly') then
        create role topfiler_final_ai_readonly login password 'Tfai_RO_2026_kP9vXz';
    end if;
end
$$;

alter role topfiler_final_ai_readonly set default_transaction_read_only = on;
alter role topfiler_final_ai_readonly set statement_timeout = '10s';

grant connect on database postgres to topfiler_final_ai_readonly;
grant usage   on schema public    to topfiler_final_ai_readonly;

grant select on table topfiler_final_ai_documenti to topfiler_final_ai_readonly;

revoke all on table topfiler_final_ai_doc_chunks from topfiler_final_ai_readonly;
revoke all on function topfiler_final_ai_match_doc_chunks(vector, text, int, text, jsonb, int, float, float) from public;
grant execute on function topfiler_final_ai_match_doc_chunks(vector, text, int, text, jsonb, int, float, float) to topfiler_final_ai_readonly;

alter default privileges in schema public revoke all on tables from topfiler_final_ai_readonly;
