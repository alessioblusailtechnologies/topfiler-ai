import { notFound } from 'next/navigation';
import ChatView from '@/components/ChatView';
import { getServerSupabase, TABLES, type DbChat, type DbMessage } from '@/lib/supabase';
import type { InitialChat } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const sb = getServerSupabase();

    const { data: chat } = await sb
        .from(TABLES.chats)
        .select('id, title, created_at, updated_at')
        .eq('id', id)
        .maybeSingle<DbChat>();
    if (!chat) notFound();

    const { data: rows } = await sb
        .from(TABLES.messages)
        .select('id, role, content')
        .eq('chat_id', id)
        .order('created_at', { ascending: true });

    const messages = ((rows ?? []) as Pick<DbMessage, 'id' | 'role' | 'content'>[]).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
    }));

    const initial: InitialChat = { id: chat.id, title: chat.title, messages };
    return <ChatView key={chat.id} initialChat={initial} />;
}
