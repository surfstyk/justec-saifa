import type { Session } from '../types.js';

const sessions = new Map<string, Session>();
const queue: string[] = []; // FIFO queue of session IDs waiting for a slot

export function getSessionStore() {
  return sessions;
}

export function getQueue() {
  return queue;
}

export function getActiveSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.status === 'active') count++;
  }
  return count;
}

export function getQueueLength(): number {
  return queue.length;
}

export function addToQueue(sessionId: string): number {
  queue.push(sessionId);
  return queue.length;
}

export function removeFromQueue(sessionId: string): void {
  const idx = queue.indexOf(sessionId);
  if (idx !== -1) queue.splice(idx, 1);
}

export function promoteFromQueue(): string | null {
  return queue.shift() ?? null;
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

export function getStats(): {
  active: number;
  queued: number;
  total: number;
  byTier: Record<string, number>;
  byClassification: Record<string, number>;
} {
  let active = 0;
  let queued = 0;
  const byTier: Record<string, number> = {};
  const byClassification: Record<string, number> = {};

  for (const session of sessions.values()) {
    if (session.status === 'active') active++;
    else if (session.status === 'queued') queued++;

    byTier[session.tier] = (byTier[session.tier] || 0) + 1;
    byClassification[session.classification] = (byClassification[session.classification] || 0) + 1;
  }

  return { active, queued, total: sessions.size, byTier, byClassification };
}
