import { describe, it, expect, vi } from 'vitest';

// We test the buildContents logic by importing the module and examining behavior.
// Since buildContents is private, we test through the public chat() interface
// with a mocked Google client.

// Configurable mock response for testing different scenarios
let mockStreamChunks: Array<Record<string, unknown>> = [
  {
    text: 'Hello',
    candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
    usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 5 },
  },
];

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: vi.fn().mockImplementation(async () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamChunks) {
            yield chunk;
          }
        },
      })),
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

  it('2. done event uses actual token counts from usageMetadata', async () => {
    mockStreamChunks = [
      {
        text: 'Hello world',
        candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 8 },
      },
    ];
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
      expect(done.usage.input_tokens).toBe(150);
      expect(done.usage.output_tokens).toBe(8);
      expect(done.usage.estimated).toBeUndefined();
    }
  });

  it('3. falls back to char/4 estimation when usageMetadata missing', async () => {
    mockStreamChunks = [
      {
        text: 'Hello',
        candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
        // No usageMetadata
      },
    ];
    const adapter = new GeminiAdapter('test-model');
    const events = [];
    for await (const event of adapter.chat({
      system: 'System prompt here',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    })) {
      events.push(event);
    }
    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.usage.estimated).toBe(true);
      expect(done.usage.input_tokens).toBeGreaterThan(0);
      expect(done.usage.output_tokens).toBeGreaterThan(0);
    }
  });

  it('4. usageMetadata from last chunk is used when multiple chunks', async () => {
    mockStreamChunks = [
      {
        text: 'Hello ',
        candidates: [{ content: { parts: [{ text: 'Hello ' }] } }],
        // First chunk may not have usageMetadata
      },
      {
        text: 'world',
        candidates: [{ content: { parts: [{ text: 'world' }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 12 },
      },
    ];
    const adapter = new GeminiAdapter('test-model');
    const events = [];
    for await (const event of adapter.chat({
      system: 'System',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    })) {
      events.push(event);
    }
    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.usage.input_tokens).toBe(200);
      expect(done.usage.output_tokens).toBe(12);
    }
  });

  it('5. empty message content → handled (no crash)', async () => {
    mockStreamChunks = [
      {
        text: 'Hello',
        candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      },
    ];
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
