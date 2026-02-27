import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AppConfig } from './types.js';

let _config: AppConfig | null = null;

const DEFAULTS: AppConfig = {
  client: {
    name: 'surfstyk',
    company: 'Surfstyk Limited',
    company_pt: 'Surfstyk LDA',
    owner: 'Hendrik Bondzio',
    timezone: 'Europe/Lisbon',
    languages: ['en', 'de', 'pt'],
    phone: '+351 XXX XXX XXX',
    website: 'https://surfstyk.com',
    cors_origins: ['https://surfstyk.com', 'https://www.surfstyk.com'],
    location: 'Ericeira, Portugal',
  },
  persona: {
    name: 'Justec',
    assistant_role: 'justec',
    system_name: 'Justec Virtual Front Desk',
    contact_channel: 'WhatsApp',
    prompts_dir: 'prompts',
  },
  services: {
    name: 'Strategy Session',
    duration_display: '60-minute',
  },
  llm: {
    lobby: { provider: 'google', model: 'gemini-3-flash-preview', max_tokens: 1024 },
    meeting_room: { provider: 'google', model: 'gemini-3-flash-preview', max_tokens: 2048 },
  },
  scoring: {
    weights: { explicit: 0.40, behavioral: 0.35, fit: 0.25 },
    thresholds: { qualified: 70, warm: 45, cold: 25 },
  },
  budgets: {
    anonymous: 30000,
    engaged: 60000,
    qualified: 150000,
    post_booking: 300000,
  },
  rate_limits: {
    messages_per_session: 15,
    messages_per_ip_per_hour: 20,
    max_concurrent_sessions: 10,
    session_ttl_minutes: 60,
  },
  calendar: {
    working_hours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timezone: 'Europe/Lisbon' },
    slot_duration_minutes: 60,
    lookahead_days: 14,
    buffer_minutes: 15,
    max_offered_slots: 3,
  },
  payment: {
    deposit_amount: 5000,
    currency: 'eur',
    currency_symbol: '\u20ac',
    providers: ['stripe', 'paypal'],
    deposit_credited: true,
    deposit_display: '50 EUR',
    product_name: 'Strategy Session Deposit',
    product_description: '60-minute strategy session \u2014 credited toward your first engagement',
  },
  trello: {
    board_name: 'Website Leads',
    lists: { lobby: 'Lobby', meeting_room: 'Meeting Room', phone_captured: 'Phone Captured', booked: 'Booked', completed: 'Completed' },
  },
  notification: {
    activity_bot_token_path: '/etc/justec-public/credentials/justec_saifa_bot_token',
    admin_bot_token_path: '/etc/justec-public/credentials/justec_saifa_bot_token',
    chat_id: '1465455370',
  },
  greetings: {
    en: "Hello, welcome to Surfstyk Limited. I'm Justec, Hendrik's personal assistant. How can I help you today?",
    de: "Guten Tag und willkommen bei Surfstyk Limited. Ich bin Justec, Hendriks pers\u00f6nliche Assistentin. Wie kann ich Ihnen heute behilflich sein?",
    pt: "Ol\u00e1, bem-vindo \u00e0 Surfstyk LDA. Sou a Justec, assistente pessoal do Hendrik. Como posso ajud\u00e1-lo hoje?",
  },
  consent_messages: {
    en: {
      text: 'We store this conversation to improve our service. Your data is processed in accordance with our privacy policy.',
      privacy_url: 'https://surfstyk.com/privacy',
      accept_label: 'I agree',
      decline_label: 'No thanks',
    },
    de: {
      text: 'Wir speichern dieses Gespräch zur Verbesserung unseres Service. Ihre Daten werden gemäß unserer Datenschutzrichtlinie verarbeitet.',
      privacy_url: 'https://surfstyk.com/privacy',
      accept_label: 'Einverstanden',
      decline_label: 'Nein danke',
    },
    pt: {
      text: 'Armazenamos esta conversa para melhorar o nosso serviço. Os seus dados são tratados de acordo com a nossa política de privacidade.',
      privacy_url: 'https://surfstyk.com/privacy',
      accept_label: 'Concordo',
      decline_label: 'Não, obrigado',
    },
  },
  conversation_end_messages: {
    en: {
      budget_exhausted: 'This conversation has reached its limit. Please contact us directly for further assistance.',
      security_terminated: 'This conversation has been ended. Please contact us directly if you need assistance.',
    },
    de: {
      budget_exhausted: 'Dieses Gespräch hat sein Limit erreicht. Bitte kontaktieren Sie uns direkt für weitere Unterstützung.',
      security_terminated: 'Dieses Gespräch wurde beendet. Bitte kontaktieren Sie uns direkt, wenn Sie Hilfe benötigen.',
    },
    pt: {
      budget_exhausted: 'Esta conversa atingiu o seu limite. Por favor contacte-nos diretamente para mais assistência.',
      security_terminated: 'Esta conversa foi terminada. Por favor contacte-nos diretamente se precisar de assistência.',
    },
  },
  security: {
    internal_keywords: [
      'Claw God',
      'Claw Father',
      'surfjust-0001',
      'surfstykjustec_bot',
      'gemini-2.0-flash',
      'gemini-3-flash',
      'better-sqlite3',
      'systemd',
      'Hetzner VPS',
      'localhost:3100',
    ],
  },
  credentials_path: '/etc/justec-public/credentials',
  database_path: '/var/lib/justec-public/conversations.db',
  dev_mode: false,
  port: 3100,
};

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const configPath = process.env.CONFIG_PATH || resolve(process.cwd(), 'config', 'surfstyk.json');

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;

    _config = {
      client: { ...DEFAULTS.client, ...parsed.client },
      persona: { ...DEFAULTS.persona, ...parsed.persona },
      services: { ...DEFAULTS.services, ...parsed.services },
      llm: parsed.llm ?? DEFAULTS.llm,
      scoring: parsed.scoring ?? DEFAULTS.scoring,
      budgets: parsed.budgets ?? DEFAULTS.budgets,
      rate_limits: parsed.rate_limits ?? DEFAULTS.rate_limits,
      calendar: { ...DEFAULTS.calendar, ...parsed.calendar },
      payment: { ...DEFAULTS.payment, ...parsed.payment },
      trello: parsed.trello ?? DEFAULTS.trello,
      notification: parsed.notification ?? DEFAULTS.notification,
      greetings: parsed.greetings ?? DEFAULTS.greetings,
      consent_messages: { ...DEFAULTS.consent_messages, ...parsed.consent_messages },
      conversation_end_messages: { ...DEFAULTS.conversation_end_messages, ...parsed.conversation_end_messages },
      security: { ...DEFAULTS.security, ...parsed.security },
      credentials_path: parsed.credentials_path ?? DEFAULTS.credentials_path,
      database_path: parsed.database_path ?? DEFAULTS.database_path,
      turnstile_secret: parsed.turnstile_secret,
      dev_mode: parsed.dev_mode ?? (process.env.DEV_MODE === 'true'),
      port: parsed.port ?? parseInt(process.env.PORT || '3100', 10),
    };
  } catch {
    console.warn(`[config] Could not load config from ${configPath}, using defaults`);

    _config = {
      ...DEFAULTS,
      dev_mode: process.env.DEV_MODE === 'true',
      port: parseInt(process.env.PORT || '3100', 10),
    };
  }

  return _config!;
}

export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}
