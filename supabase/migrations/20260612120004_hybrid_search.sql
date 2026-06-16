-- ===========================================================================
-- topFiler3 · ricerca ibrida RRF (SECURITY DEFINER) — prefisso topfiler_final_ai_
-- Il ruolo topfiler_final_ai_readonly invoca questa funzione per la semantica
-- senza avere SELECT diretto su doc_chunks. Parametrica → niente injection.
-- ===========================================================================

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
    chunk_id   uuid,
    doc_id     uuid,
    tipologia  text,
    chunk_type text,
    riga_index int,
    testo      text,
    metadata   jsonb,
    score      float
)
language sql
stable
security definer
set search_path = public
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
        from filt
        where query_embedding is not null and embedding is not null
        order by embedding <=> query_embedding
        limit match_count * 5
    ),
    bm as (
        select f.id, row_number() over (order by ts_rank(f.tsv, q.query) desc) as rnk
        from filt f, q
        where q.query is not null and f.tsv @@ q.query
        order by ts_rank(f.tsv, q.query) desc
        limit match_count * 5
    ),
    fused as (
        select
            coalesce(vec.id, bm.id) as id,
            coalesce(w_vec / (rrf_k + vec.rnk), 0) + coalesce(w_bm / (rrf_k + bm.rnk), 0) as score
        from vec
        full outer join bm on vec.id = bm.id
    )
    select f.id, f.doc_id, f.tipologia, f.chunk_type, f.riga_index, f.testo, f.metadata, fu.score
    from fused fu
    join filt f on f.id = fu.id
    order by fu.score desc
    limit match_count;
$$;
