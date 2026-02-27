import { getConfig } from '../config.js';
import type { Session } from '../types.js';

export function getBudget(session: Session): number {
  const config = getConfig();
  if (session.payment_status === 'completed') return config.budgets.post_booking;
  if (session.tier === 'meeting_room') return config.budgets.qualified;
  if (session.messages_count >= 2) return config.budgets.engaged;
  return config.budgets.anonymous;
}

export function canAfford(session: Session, estimatedTokens: number): boolean {
  return session.tokens_used + estimatedTokens <= getBudget(session);
}

export function consume(session: Session, tokens: number): {
  remaining: number;
  total: number;
  warning: boolean;
  exhausted: boolean;
} {
  session.tokens_used += tokens;
  const total = getBudget(session);
  const remaining = Math.max(0, total - session.tokens_used);
  const warningThreshold = total * 0.15;

  return {
    remaining,
    total,
    warning: remaining > 0 && remaining <= warningThreshold,
    exhausted: remaining <= 0,
  };
}
