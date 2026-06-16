-- ===========================================================================
-- topFiler3 · persistenza chat per il client web (conversazioni + messaggi)
-- ===========================================================================

create table if not exists topfiler_final_ai_chats (
    id         uuid primary key default gen_random_uuid(),
    title      text not null default 'Nuova chat',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_tfai_chats_updated on topfiler_final_ai_chats (updated_at desc);
alter table topfiler_final_ai_chats disable row level security;

create table if not exists topfiler_final_ai_messages (
    id         uuid primary key default gen_random_uuid(),
    chat_id    uuid not null references topfiler_final_ai_chats (id) on delete cascade,
    role       text not null check (role in ('user', 'assistant')),
    content    text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists idx_tfai_messages_chat on topfiler_final_ai_messages (chat_id, created_at asc);
alter table topfiler_final_ai_messages disable row level security;

-- Aggiorna updated_at della chat quando arriva un nuovo messaggio.
create or replace function topfiler_final_ai_bump_chat()
returns trigger language plpgsql as $fn$
begin
    update topfiler_final_ai_chats set updated_at = now() where id = new.chat_id;
    return new;
end;
$fn$;

drop trigger if exists tfai_messages_bump on topfiler_final_ai_messages;
create trigger tfai_messages_bump
    after insert on topfiler_final_ai_messages
    for each row execute function topfiler_final_ai_bump_chat();
