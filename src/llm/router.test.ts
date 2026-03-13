import { describe, it, expect, vi } from 'vitest';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

// Mock the GeminiAdapter to avoid hitting real API
vi.mock('./gemini.js', () => ({
  GeminiAdapter: vi.fn().mockImplementation((model: string) => ({
    model,
    chat: vi.fn(),
  })),
}));

const { resolveModel } = await import('./router.js');

describe('LLM Router — resolveModel', () => {
  it('1. lobby session → lobby model config', () => {
    const session = makeSession({ tier: 'lobby' });
    const { config } = resolveModel(session);
    expect(config.model).toBe('test-model');
    expect(config.max_tokens).toBe(1024);
  });

  it('2. meeting room session → meeting_room model config', () => {
    const session = makeSession({ tier: 'meeting_room' });
    const { config } = resolveModel(session);
    expect(config.max_tokens).toBe(2048);
  });

  it('3. adapter is returned', () => {
    const session = makeSession({ tier: 'lobby' });
    const { adapter } = resolveModel(session);
    expect(adapter).toBeDefined();
    expect(adapter.chat).toBeDefined();
  });

  it('4. adapter cached by provider:model key', () => {
    const session1 = makeSession({ tier: 'lobby' });
    const session2 = makeSession({ tier: 'lobby' });
    const { adapter: a1 } = resolveModel(session1);
    const { adapter: a2 } = resolveModel(session2);
    // Same tier → same adapter instance
    expect(a1).toBe(a2);
  });
});
