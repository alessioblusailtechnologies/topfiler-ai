-- ===========================================================================
-- topFiler3 · tabella documenti (core, schema minimale) — prefisso topfiler_final_ai_
-- ===========================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'topfiler_final_ai_stato_ingestion') then
        create type topfiler_final_ai_stato_ingestion as enum ('VALIDATO', 'DA_REVISIONARE', 'ERRORE');
    end if;
end
$$;

create table if not exists topfiler_final_ai_documenti (
    id               uuid primary key default gen_random_uuid(),
    tipologia        text not null,
    metadata         jsonb not null default '{}'::jsonb,
    storage_path     text,
    source_oracle_id text,
    filename         text,
    mime_type        text,
    hash_sha256      text unique,
    data_caricamento timestamptz not null default now(),
    stato_ingestion  topfiler_final_ai_stato_ingestion not null default 'DA_REVISIONARE',
    confidence       numeric
);
alter table topfiler_final_ai_documenti disable row level security;

-- Indice GIN sul JSONB (jsonb_path_ops): contenimento @> e jsonb_path_exists.
create index if not exists idx_tfai_doc_metadata_gin on topfiler_final_ai_documenti using gin (metadata jsonb_path_ops);

-- Indici a espressione sul TESTO ISO (le date 'YYYY-MM-DD' si confrontano come
-- stringhe; ->> è IMMUTABLE → lecito. NON castare a ::date qui).
create index if not exists idx_tfai_doc_tip_scad   on topfiler_final_ai_documenti (tipologia, (metadata->>'data_scadenza'));
create index if not exists idx_tfai_doc_dipendente on topfiler_final_ai_documenti ((metadata->>'dipendente_nome_norm'));
create index if not exists idx_tfai_doc_tipologia  on topfiler_final_ai_documenti (tipologia);
