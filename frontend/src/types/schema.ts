// Matches TaskBase from backend/app/models/schemas.py
export interface Task {
    title: string;
    description: string | null;
    assignee_name: string | null; // Raw extracted name
    assignee_id: number | null;   // Resolved Vikunja User ID
    priority: number;             // 1-5
    due_date: string | null;      // ISO Date "YYYY-MM-DD"
}

// Matches AnalysisResponse
export interface AnalysisResponse {
    tasks: Task[];
    token_count: number;
    processing_time: number;
    file_count?: number;
    file_names?: string[];
}

// Matches Vikunja Sync Response
export interface SyncDetail {
    title: string;
    status: 'success' | 'error';
    error?: string;
}

export interface SyncResponse {
    total: number;
    success: number;
    failed: number;
    details: SyncDetail[];
}

export interface VoiceState {
    title: string | null;
    description: string | null;
    dueDate: string | null;
    assignee: string | null;
    status: 'draft' | 'ready'; // Based on typical voice agent flows
    priority?: number;
    _reply_text?: string; // Metadata for UI text display
}

export interface VoiceTurnResponse {
    updated_state: VoiceState;
    reply_audio: string; // Base64 encoded audio
    reply_text?: string;
    user_transcript?: string;
    should_end_session?: boolean;
}

// --- History Models ---

export interface HistorySummary {
    id: string;
    timestamp: string;
    source_files: string[];
    file_count: number;
    task_count: number;
    model_used: string;
}

// --- Save Conversation Models (shared by Standard + Live agents) ---

export interface SaveConversationRequest {
    session_id: string;
    transcript: { role: string; content: string }[];
    task_draft: {
        title: string | null;
        description: string | null;
        assignee: string | null;
        due_date: string | null;
        priority: number;
    };
    sync_to_vikunja: boolean;
}

export interface SaveConversationResponse {
    conversation_id: string;
    saved: boolean;
    synced: boolean;
    sync_error: string | null;
}

// --- Conversation Viewer Models ---

export interface ConversationSummary {
    id: string;
    timestamp: string;
    agent_type: 'live' | 'standard';
    synced_to_vikunja: boolean;
    task_title: string | null;
    turn_count: number;
}

export interface ConversationDetail {
    id: string;
    session_id: string;
    timestamp: string;
    agent_type: string;
    agent_version: string;
    synced_to_vikunja: boolean;
    transcript: { role: string; content: string }[];
    task_draft: {
        title: string | null;
        description: string | null;
        assignee: string | null;
        due_date: string | null;
        priority: number;
    };
}

export interface HistoryDetail {
    id: string;
    timestamp: string;
    source_files: string[];
    file_count: number;
    model_used: string;
    token_count: number;
    processing_time: number;
    analysis: {
        tasks: Task[];
    };
}
