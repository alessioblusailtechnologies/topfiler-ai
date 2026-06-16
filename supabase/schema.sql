-- ===========================================================================
-- topFiler3 · schema completo — prefisso oggetti: topfiler_final_ai_
-- Esegui questo script nel SQL Editor di Supabase (progetto mepmdgkvcuosqddehwmg).
-- Convive con gli oggetti dei PoC (topfiler_documents / topfiler_chunks / topfiler_hybrid):
-- nomi e indici sono prefissati per evitare collisioni.
-- ===========================================================================

-- 1) estensioni ------------------------------------------------------------
create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- 2) documenti -------------------------------------------------------------
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

create index if not exists idx_tfai_doc_metadata_gin on topfiler_final_ai_documenti using gin (metadata jsonb_path_ops);
create index if not exists idx_tfai_doc_tip_scad   on topfiler_final_ai_documenti (tipologia, (metadata->>'data_scadenza'));
create index if not exists idx_tfai_doc_dipendente on topfiler_final_ai_documenti ((metadata->>'dipendente_nome_norm'));
create index if not exists idx_tfai_doc_tipologia  on topfiler_final_ai_documenti (tipologia);

-- 3) doc_chunks ------------------------------------------------------------
create table if not exists topfiler_final_ai_doc_chunks (
    id         uuid primary key default gen_random_uuid(),
    doc_id     uuid not null references topfiler_final_ai_documenti (id) on delete cascade,
    testo      text not null,
    embedding  vector(1024),
    chunk_type text not null default 'CONTENUTO' check (chunk_type in ('CONTENUTO', 'RIGA')),
    riga_index int,
    tsv        tsvector generated always as (to_tsvector('italian', testo)) stored,
    created_at timestamptz not null default now()
);
alter table topfiler_final_ai_doc_chunks disable row level security;

create index if not exists idx_tfai_chunks_embedding on topfiler_final_ai_doc_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists idx_tfai_chunks_tsv        on topfiler_final_ai_doc_chunks using gin (tsv);
create index if not exists idx_tfai_chunks_doc        on topfiler_final_ai_doc_chunks (doc_id);

-- 4) ricerca ibrida (RRF, SECURITY DEFINER) --------------------------------
create or replace function topfiler_final_ai_match_doc_chunks(
    query_embedding   vector(1024),
    query_text        text    default '',
    match_count       int     default 20,
    filter_tipologia  text    default null,
    filter_metadata   jsonb   default '{}'::jsonb,
    rrf_k             int     default 60,
    w_vec             float   default 1.0,
    w_bm              float   default 1.0
)
returns table (
    chunk_id uuid, doc_id uuid, tipologia text, chunk_type text,
    riga_index int, testo text, metadata jsonb, score float
)
language sql stable security definer set search_path = public
as $$
    with q as (
        select websearch_to_tsquery('italian', nullif(query_text, '')) as query
    ),
    filt as (
        select c.id, c.doc_id, c.testo, c.embedding, c.tsv, c.chunk_type, c.riga_index,
               d.tipologia, d.metadata
        from topfiler_final_ai_doc_chunks c
        join topfiler_final_ai_documenti d on d.id = c.doc_id
        where (filter_tipologia is null or d.tipologia = filter_tipologia)
          and (filter_metadata is null or filter_metadata = '{}'::jsonb or d.metadata @> filter_metadata)
    ),
    vec as (
        select id, row_number() over (order by embedding <=> query_embedding) as rnk
        from filt where query_embedding is not null and embedding is not null
        order by embedding <=> query_embedding limit match_count * 5
    ),
    bm as (
        select f.id, row_number() over (order by ts_rank(f.tsv, q.query) desc) as rnk
        from filt f, q where q.query is not null and f.tsv @@ q.query
        order by ts_rank(f.tsv, q.query) desc limit match_count * 5
    ),
    fused as (
        select coalesce(vec.id, bm.id) as id,
               coalesce(w_vec / (rrf_k + vec.rnk), 0) + coalesce(w_bm / (rrf_k + bm.rnk), 0) as score
        from vec full outer join bm on vec.id = bm.id
    )
    select f.id, f.doc_id, f.tipologia, f.chunk_type, f.riga_index, f.testo, f.metadata, fu.score
    from fused fu join filt f on f.id = fu.id
    order by fu.score desc limit match_count;
$$;

-- 5) ruolo read-only (tool text_to_sql) -----------------------------------
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

-- L'unica sorgente interrogabile dal text_to_sql.
grant select on table topfiler_final_ai_documenti to topfiler_final_ai_readonly;

-- La ricerca semantica passa SOLO dalla funzione SECURITY DEFINER.
revoke all on table topfiler_final_ai_doc_chunks from topfiler_final_ai_readonly;
revoke all on function topfiler_final_ai_match_doc_chunks(vector, text, int, text, jsonb, int, float, float) from public;
grant execute on function topfiler_final_ai_match_doc_chunks(vector, text, int, text, jsonb, int, float, float) to topfiler_final_ai_readonly;

alter default privileges in schema public revoke all on tables from topfiler_final_ai_readonly;

-- Nota: la password del ruolo è 'Tfai_RO_2026_kP9vXz' (coerente con READONLY_DATABASE_URL nel .env).
-- Per cambiarla: ALTER ROLE topfiler_final_ai_readonly PASSWORD 'nuova-password';  (aggiorna anche il .env)
