import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client Supabase SOLO lato server (service role): nessuna esposizione al browser.
// Usato unicamente per la persistenza delle chat (conversazioni + messaggi).

export const TABLES = {
    chats: 'topfiler_final_ai_chats',
    messages: 'topfiler_final_ai_messages',
} as const;

let client: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
    if (client) return client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url) throw new Error('SUPABASE_URL non configurata');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurata');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
}

export interface DbChat {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export interface DbMessage {
    id: string;
    chat_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}
