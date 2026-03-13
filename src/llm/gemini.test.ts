import { describe, it, expect, vi } from 'vitest';

// We test the buildContents logic by importing the module and examining behavior.
// Since buildContents is private, we test through the public chat() interface
// with a mocked Google client.

// Mock the entire @google/genai module
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            text: 'Hello',
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
          };
        },
      }),
    },
  })),
}));

vi.mock('../config.js', () => ({
  getConfig: () => ({
    credentials_path: '/tmp/test',
    security: { internal_keywords: [] },
  }),
  loadConfig: () => ({
    credentials_path: '/tmp/test',
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('gemini_api_key')) return 'test-api-key';
      return actual.readFileSync(path, 'utf-8');
    }),
  };
});

const { GeminiAdapter } = await import('./gemini.js');

describe('Gemini Adapter', () => {
  it('1. user message → yields token events', async () => {
    const adapter = new GeminiAdapter('test-model');
    const events = [];
    for await (const event of adapter.chat({
      system: 'You are a test assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    })) {
      events.push(event);
    }
    expect(events.some(e => e.type === 'token')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('2. done event includes usage with input_tokens and output_tokens', async () => {
    const adapter = new GeminiAdapter('test-model');
    const events = [];
    for await (const event of adapter.chat({
      system: 'System prompt',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    })) {
      events.push(event);
    }
    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.usage.input_tokens).toBeGreaterThan(0);
      expect(done.usage.output_tokens).toBeGreaterThan(0);
    }
  });

  it('3. empty message content → handled (no crash)', async () => {
    const adapter = new GeminiAdapter('test-model');
    const events = [];
    for await (const event of adapter.chat({
      system: '',
      messages: [{ role: 'user', content: '' }],
      max_tokens: 100,
    })) {
      events.push(event);
    }
    // Should complete without throwing
    expect(events.length).toBeGreaterThan(0);
  });
});
