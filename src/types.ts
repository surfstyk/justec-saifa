// ── Session ──────────────────────────────────────────────

export type SessionTier = 'lobby' | 'meeting_room';
export type SessionStatus = 'active' | 'queued' | 'closed';
export type Language = 'en' | 'de' | 'pt';
export type ScoreClassification = 'hot' | 'warm' | 'cold' | 'disqualified';
export type ConsentState = 'pending' | 'granted' | 'declined';
export type CloseReason = 'visitor_left' | 'new_session' | 'timeout' | 'security' | 'budget_exhausted';
export type GuardLevel = 0 | 1 | 2 | 3 | 4;

export interface Session {
  id: string;
  status: SessionStatus;
  tier: SessionTier;
  language: Language;
  consent: ConsentState;
  guard_level: GuardLevel;
  ip_hash: string;
  referrer?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;

  // Scoring
  score_composite: number;
  score_behavioral: number;
  score_explicit: number;
  score_fit: number;
  classification: ScoreClassification;

  // Visitor info (extracted by LLM)
  visitor_info: VisitorInfo;

  // Token budget
  tokens_used: number;
  messages_count: number;

  // Conversation history
  history: Message[];

  // Timestamps
  created_at: number;
  last_activity: number;
  closed_at?: number;
  close_reason?: CloseReason;

  // Calendar slot scarcity — track which slots have been offered
  offered_slot_ids: string[];

  // Conversion
  trello_card_id?: string;
  booking_time?: string;
  payment_provider?: string;
  payment_status?: string;
  payment_id?: string;
}

export interface VisitorInfo {
  name: string | null;
  company: string | null;
  role: string | null;
  company_size: string | null;
  industry: string | null;
  language: Language;
}

// ── Messages ─────────────────────────────────────────────

export interface Message {
  role: 'visitor' | string;
  content: string | null;
  action?: ActionPayload;
  structured: StructuredMessage[];
  timestamp: string;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ActionPayload {
  type: ActionType;
  payload: Record<string, unknown>;
}

export type ActionType =
  | 'slot_selected'
  | 'phone_submitted'
  | 'payment_provider_selected'
  | 'consent_response'
  | 'language_changed';

export interface StructuredMessage {
  type: string;
  payload: Record<string, unknown>;
}

// ── Chat Request (from frontend) ─────────────────────────

export interface ChatRequest {
  text?: string;
  action?: ActionPayload;
  behavioral?: BehavioralSignals;
}

export interface BehavioralSignals {
  typing_duration_ms?: number;
  keypress_count?: number;
  correction_count?: number;
  time_since_last_message_ms?: number;
  mouse_movement_detected?: boolean;
  viewport_scroll_depth?: number;
}

// ── SSE Events ───────────────────────────────────────────

export type ChatEventType =
  | 'processing'
  | 'token'
  | 'message_complete'
  | 'structured_message'
  | 'tier_change'
  | 'budget_warning'
  | 'budget_exhausted'
  | 'session_terminated'
  | 'consent_state'
  | 'error'
  | 'stream_end';

export interface ChatEvent {
  event: ChatEventType;
  data: Record<string, unknown>;
}

// ── LLM Types ────────────────────────────────────────────

export interface LLMChatRequest {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  max_tokens: number;
  temperature?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_result?: Record<string, unknown>;
  thought_signature?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LLMEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; thought_signature?: string }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'error'; message: string };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

// ── Qualification Signals (from LLM) ─────────────────────

export interface QualificationSignals {
  qualification: {
    problem_specificity: number;
    authority_level: number;
    timeline_urgency: number;
    need_alignment: number;
    budget_indicator: number;
    engagement_depth: number;
  };
  visitor_info: VisitorInfo;
  conversation_state: {
    intent: string;
    buying_signals: string[];
    disqualification_signals: string[];
    recommended_action: string;
  };
}

// ── Security ─────────────────────────────────────────────

export interface InputFilterResult {
  passed: boolean;
  modified_text: string;
  threat_level: 0 | 1 | 2 | 3;
  reason?: string;
}

// ── Config ───────────────────────────────────────────────

export interface AppConfig {
  client: {
    name: string;
    company: string;
    company_pt: string;
    owner: string;
    timezone: string;
    languages: Language[];
    phone: string;
    website: string;
    cors_origins: string[];
    location: string;
  };
  persona: {
    name: string;
    assistant_role: string;
    system_name: string;
    contact_channel: string;
    prompts_dir: string;
  };
  services: {
    name: string;
    duration_display: string;
  };
  llm: {
    lobby: LLMModelConfig;
    meeting_room: LLMModelConfig;
  };
  scoring: {
    weights: {
      explicit: number;
      behavioral: number;
      fit: number;
    };
    thresholds: {
      qualified: number;
      warm: number;
      cold: number;
    };
  };
  budgets: {
    anonymous: number;
    engaged: number;
    qualified: number;
    post_booking: number;
  };
  rate_limits: {
    messages_per_session: number;
    messages_per_ip_per_hour: number;
    max_concurrent_sessions: number;
    session_ttl_minutes: number;
  };
  calendar: {
    working_hours: {
      days: number[];
      start: string;
      end: string;
      timezone: string;
    };
    slot_duration_minutes: number;
    lookahead_days: number;
    buffer_minutes: number;
    max_offered_slots: number;
  };
  payment: {
    deposit_amount: number;
    currency: string;
    currency_symbol: string;
    providers: string[];
    deposit_credited: boolean;
    return_base_url?: string;
    deposit_display: string;
    product_name: string;
    product_description: string;
  };
  trello: {
    board_name: string;
    lists: Record<string, string>;
  };
  notification: {
    activity_bot_token_path: string;
    admin_bot_token_path: string;
    chat_id: string;
  };
  greetings: Record<Language, string>;
  security: {
    internal_keywords: string[];
  };
  credentials_path: string;
  database_path: string;
  turnstile_secret?: string;
  dev_mode: boolean;
  port: number;
}

export interface LLMModelConfig {
  provider: string;
  model: string;
  max_tokens: number;
  temperature?: number;
}

