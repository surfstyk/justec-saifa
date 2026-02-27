import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';
import type { Session } from '../types.js';

const TELEGRAM_API = 'https://api.telegram.org';

// Two bots: activity (lead notifications) and admin (security incidents)
type BotRole = 'activity' | 'admin';

const _tokens: Record<BotRole, string | null> = { activity: null, admin: null };

function loadBotToken(role: BotRole): string | null {
  if (_tokens[role]) return _tokens[role];

  const config = getConfig();
  const tokenPath = resolve(
    role === 'activity'
      ? config.notification.activity_bot_token_path
      : config.notification.admin_bot_token_path,
  );

  try {
    _tokens[role] = readFileSync(tokenPath, 'utf-8').trim();
    return _tokens[role];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[telegram:${role}] Failed to load bot token from ${tokenPath}: ${message}`);
    return null;
  }
}

async function sendMessage(role: BotRole, text: string): Promise<void> {
  const token = loadBotToken(role);
  if (!token) {
    console.warn(`[telegram:${role}] No bot token available, skipping notification`);
    return;
  }

  const config = getConfig();
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.notification.chat_id,
      text,
      parse_mode: 'Markdown',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

// ── Activity Bot (lead notifications) ────────────────────

export function notifyQualifiedLead(session: Session): void {
  const name = session.visitor_info.name || 'Unknown';
  const company = session.visitor_info.company ? ` from ${session.visitor_info.company}` : '';
  const lang = (session.language || 'en').toUpperCase();
  const score = session.score_composite;

  const lines = [
    `🔥 *New qualified lead*: ${name}${company}`,
    `Score: ${score}/100 | Language: ${lang}`,
    `Messages: ${session.messages_count}`,
  ];

  sendMessage('activity', lines.join('\n')).catch(err =>
    console.error('[telegram:activity] Failed to send qualified lead notification:', err),
  );
}

export interface BookingNotificationData {
  visitor_name: string;
  visitor_company?: string;
  visitor_phone?: string;
  slot_display: string;
  provider: string;
  deposit_amount: number;
  currency: string;
}

export function notifyBookingConfirmed(data: BookingNotificationData): void {
  const name = data.visitor_name || 'Unknown';
  const company = data.visitor_company ? ` | ${data.visitor_company}` : '';
  const phone = data.visitor_phone ? ` | 📞 ${data.visitor_phone}` : '';
  const config = getConfig();
  const amount = `${config.payment.currency_symbol}${(data.deposit_amount / 100).toFixed(2)}`;

  const lines = [
    `✅ *Booking confirmed*`,
    `📅 ${data.slot_display}`,
    `👤 ${name}${company}${phone}`,
    `💶 ${amount} deposit received (${data.provider})`,
  ];

  sendMessage('activity', lines.join('\n')).catch(err =>
    console.error('[telegram:activity] Failed to send booking notification:', err),
  );
}

// ── Admin Bot (security incidents) ───────────────────────

export function notifySecurityIncident(session: Session, action: 'terminate' | 'block', guardLevel: number): void {
  const lines = [
    `⚠️ *Security: conversation ${action === 'block' ? 'blocked' : 'terminated'}*`,
    `Guard level: ${guardLevel}`,
    `IP hash: \`${session.ip_hash}\``,
    `Messages exchanged: ${session.messages_count}`,
  ];

  sendMessage('admin', lines.join('\n')).catch(err =>
    console.error('[telegram:admin] Failed to send security notification:', err),
  );
}
