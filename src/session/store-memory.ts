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
