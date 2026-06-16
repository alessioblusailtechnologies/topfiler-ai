-- ===========================================================================
-- topFiler3 · tabella doc_chunks (ricerca semantica) — prefisso topfiler_final_ai_
-- ===========================================================================

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
