export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface ChatSummary {
    id: string;
    title: string;
    updated_at: string;
}

export interface InitialChat {
    id: string;
    title: string;
    messages: ChatMessage[];
}

// --- Ricerca documenti (vista a tabella) -----------------------------------

export interface MatchingChunk {
    chunk_type: string;
    riga_index: number | null;
    testo: string;
    score: number;
    score_percent: number;
}

export interface SearchDocResult {
    doc_id: string;
    tipologia: string;
    filename: string | null;
    downloadable: boolean;
    score: number;
    score_percent: number;
    relevance: 'alta' | 'media' | 'bassa';
    data: string | null;
    snippet: string;
    metadata: Record<string, unknown>;
    matching_chunks: MatchingChunk[];
}

export interface SearchDocsResponse {
    query: string;
    tipologia: string | null;
    results: SearchDocResult[];
    total: number;
    elapsed_ms: number;
}
