-- ===========================================================================
-- topFiler3 · estensioni Postgres
-- pgvector per gli embedding (1024 dim → HNSW lecito, limite 2000),
-- pgcrypto per gen_random_uuid(), pg_trgm per eventuali ricerche fuzzy.
-- ===========================================================================
create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
