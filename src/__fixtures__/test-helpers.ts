import type { Session, AppConfig, Language, QualificationSignals, BehavioralSignals } from '../types.js';

/**
 * Creates a minimal test session with sensible defaults.
 * Override any field via the partial parameter.
 */
export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session-001',
    status: 'active',
    tier: 'lobby',
    language: 'en' as Language,
    consent: 'granted',
    guard_level: 0,
    ip_hash: 'abc123',
    score_composite: 0,
    score_behavioral: 0,
    score_explicit: 0,
    score_fit: 0,
    classification: 'cold',
    visitor_info: {
      name: null,
      company: null,
      role: null,
      company_size: null,
      industry: null,
      language: 'en' as Language,
    },
    tokens_used: 0,
    messages_count: 0,
    offered_slot_ids: [],
    history: [],
    created_at: Date.now(),
    last_activity: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a test-friendly config object.
 */
export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    client: {
      name: 'test',
      company: 'Test Corp',
      company_pt: 'Test LDA',
      owner: 'Hendrik Bondzio',
      timezone: 'Europe/Lisbon',
      languages: ['en', 'de', 'pt'],
      phone: '+351 000 000 000',
      website: 'https://test.com',
      cors_origins: ['https://test.com'],
      location: 'Lisbon, Portugal',
    },
    persona: {
      name: 'TestBot',
      assistant_role: 'testbot',
      system_name: 'Test System',
      contact_channel: 'WhatsApp',
      prompts_dir: 'prompts',
    },
    services: {
      name: 'Strategy Session',
      duration_display: '60-minute',
    },
    llm: {
      lobby: { provider: 'google', model: 'test-model', max_tokens: 1024 },
      meeting_room: { provider: 'google', model: 'test-model', max_tokens: 2048 },
    },
    scoring: {
      weights: { explicit: 0.40, behavioral: 0.35, fit: 0.25 },
      thresholds: { qualified: 70, warm: 45, cold: 25 },
    },
    budgets: {
      anonymous: 300000,
      engaged: 600000,
      qualified: 1500000,
      post_booking: 3000000,
    },
    rate_limits: {
      messages_per_session: 25,
      messages_per_ip_per_hour: 40,
      max_concurrent_sessions: 10,
      session_ttl_minutes: 60,
    },
    calendar: {
      working_hours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timezone: 'Europe/Lisbon' },
      slot_duration_minutes: 60,
      lookahead_days: 14,
      buffer_minutes: 15,
      max_offered_slots: 3,
      hold_ttl_minutes: 30,
    },
    payment: {
      deposit_amount: 8000,
      currency: 'eur',
      currency_symbol: '\u20ac',
      providers: ['stripe', 'paypal'],
      deposit_credited: true,
      deposit_display: '80 EUR',
      product_name: 'Strategy Session Deposit',
      product_description: '60-minute strategy session',
    },
    trello: {
      board_name: 'Test Leads',
      lists: { lobby: 'Lobby', meeting_room: 'Meeting Room', phone_captured: 'Phone Captured', booked: 'Booked', completed: 'Completed' },
    },
    notification: {
      activity_bot_token_path: '/tmp/test-bot-token',
      admin_bot_token_path: '/tmp/test-admin-token',
      chat_id: '12345',
    },
    greetings: {
      en: 'Welcome',
      de: 'Willkommen',
      pt: 'Bem-vindo',
    },
    consent_messages: {
      en: { text: 'Consent text', privacy_url: 'https://test.com/privacy', accept_label: 'Accept', decline_label: 'Decline' },
      de: { text: 'Einwilligung', privacy_url: 'https://test.com/privacy', accept_label: 'Akzeptieren', decline_label: 'Ablehnen' },
      pt: { text: 'Consentimento', privacy_url: 'https://test.com/privacy', accept_label: 'Aceitar', decline_label: 'Recusar' },
    },
    post_consent_messages: {
      en: { accepted: 'Thanks', declined: 'Okay' },
      de: { accepted: 'Danke', declined: 'Okay' },
      pt: { accepted: 'Obrigado', declined: 'Ok' },
    },
    conversation_end_messages: {
      en: { budget_exhausted: 'Limit reached.', security_terminated: 'Ended.' },
      de: { budget_exhausted: 'Limit erreicht.', security_terminated: 'Beendet.' },
      pt: { budget_exhausted: 'Limite atingido.', security_terminated: 'Terminado.' },
    },
    security: {
      internal_keywords: [
        'Claw God',
        'gemini-3-flash',
        'localhost:3100',
      ],
    },
    credentials_path: '/tmp/test-creds',
    database_path: '/tmp/test.db',
    dev_mode: true,
    port: 3100,
    ...overrides,
  };
}

/**
 * Creates qualification signals for testing scoring.
 */
export function makeSignals(overrides: Partial<QualificationSignals['qualification']> = {}): QualificationSignals {
  return {
    qualification: {
      problem_specificity: 5,
      authority_level: 5,
      timeline_urgency: 5,
      need_alignment: 5,
      budget_indicator: 5,
      engagement_depth: 5,
      ...overrides,
    },
    visitor_info: {
      name: null,
      company: null,
      role: null,
      company_size: null,
      industry: null,
      language: 'en' as Language,
    },
    conversation_state: {
      intent: 'exploring',
      buying_signals: [],
      disqualification_signals: [],
      recommended_action: 'continue_discovery',
    },
  };
}

export function makeBehavioral(overrides: Partial<BehavioralSignals> = {}): BehavioralSignals {
  return { ...overrides };
}
