import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getBudget, canAfford, consume } from './budget.js';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

describe('Session Budget', () => {
  it('1. anonymous session (0-1 messages) → budget = 300,000', () => {
    const session = makeSession({ messages_count: 0 });
    expect(getBudget(session)).toBe(300000);
  });

  it('2. engaged session (2+ messages) → budget = 600,000', () => {
    const session = makeSession({ messages_count: 2 });
    expect(getBudget(session)).toBe(600000);
  });

  it('3. qualified session (meeting_room) → budget = 1,500,000', () => {
    const session = makeSession({ tier: 'meeting_room', messages_count: 5 });
    expect(getBudget(session)).toBe(1500000);
  });

  it('4. post-booking (payment_status = completed) → budget = 3,000,000', () => {
    const session = makeSession({ payment_status: 'completed', messages_count: 5 });
    expect(getBudget(session)).toBe(3000000);
  });

  it('5. consume 100 tokens → tokens_used updated, not exhausted', () => {
    const session = makeSession({ messages_count: 0, tokens_used: 0 });
    const result = consume(session, 100);
    expect(session.tokens_used).toBe(100);
    expect(result.exhausted).toBe(false);
    expect(result.remaining).toBe(299900);
  });

  it('6. consume to exactly budget → exhausted = true', () => {
    const session = makeSession({ messages_count: 0, tokens_used: 0 });
    const result = consume(session, 300000);
    expect(result.exhausted).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('7. already over budget → canAfford blocks', () => {
    const session = makeSession({ messages_count: 0, tokens_used: 300000 });
    expect(canAfford(session, 1)).toBe(false);
  });

  it('8. budget warning threshold (≤15% remaining) → warning emitted', () => {
    const session = makeSession({ messages_count: 0, tokens_used: 0 });
    // 15% of 300k = 45k. Use 256k leaving 44k → warning
    const result = consume(session, 256000);
    expect(result.warning).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it('9. not at warning threshold → warning = false', () => {
    const session = makeSession({ messages_count: 0, tokens_used: 0 });
    const result = consume(session, 100000);
    expect(result.warning).toBe(false);
  });
});
