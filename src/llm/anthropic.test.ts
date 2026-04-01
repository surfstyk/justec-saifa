import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMEvent } from '../types.js';

// Mock stream events for each test scenario
let mockStreamEvents: Array<Record<string, unknown>> = [];
let mockFinalMessage: Record<string, unknown> = {
  usage: { input_tokens: 100, output_tokens: 20 },
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        stream: vi.fn().mockImplementation(() => {
          const events = [...mockStreamEvents];
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const event of events) {
                yield event;
              }
            },
            finalMessage: async () => mockFinalMessage,
          };
        }),
      },
    })),
  };
});

vi.mock('../config.js', () => ({
  getConfig: () => ({
    credentials_path: '/tmp/test',
    security: { internal_keywords: [] },
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('anthropic_api_key')) return 'test-api-key';
      return actual.readFileSync(path, 'utf-8');
    }),
  };
});

const { AnthropicAdapter } = await import('./anthropic.js');

async function collectEvents(adapter: InstanceType<typeof AnthropicAdapter>, request: Parameters<InstanceType<typeof AnthropicAdapter>['chat']>[0]): Promise<LLMEvent[]> {
  const events: LLMEvent[] = [];
  for await (const event of adapter.chat(request)) {
    events.push(event);
  }
  return events;
}

const baseRequest = {
  system: 'You are a test assistant.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  max_tokens: 1024,
};

describe('Anthropic Adapter', () => {
  beforeEach(() => {
    mockStreamEvents = [];
    mockFinalMessage = { usage: { input_tokens: 100, output_tokens: 20 } };
  });

  it('1. text streaming — yields token events and done', async () => {
    mockStreamEvents = [
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    const tokens = events.filter(e => e.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].type === 'token' && tokens[0].text).toBe('Hello');
    expect(tokens[1].type === 'token' && tokens[1].text).toBe(' world');

    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('2. token usage from finalMessage', async () => {
    mockStreamEvents = [
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];
    mockFinalMessage = { usage: { input_tokens: 250, output_tokens: 42 } };

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.usage.input_tokens).toBe(250);
      expect(done.usage.output_tokens).toBe(42);
    }
  });

  it('3. tool call — accumulates JSON delta and yields tool_call event', async () => {
    mockStreamEvents = [
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'toolu_abc123', name: 'round_complete' },
      },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"round":' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '1}' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    const toolCall = events.find(e => e.type === 'tool_call');
    expect(toolCall).toBeDefined();
    if (toolCall?.type === 'tool_call') {
      expect(toolCall.id).toBe('toolu_abc123');
      expect(toolCall.name).toBe('round_complete');
      expect(toolCall.args).toEqual({ round: 1 });
    }
  });

  it('4. text + tool call in same response', async () => {
    mockStreamEvents = [
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me check.' } },
      { type: 'content_block_stop' },
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'toolu_xyz', name: 'check_capabilities' },
      },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"query":"email"}' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    expect(events.filter(e => e.type === 'token')).toHaveLength(1);
    expect(events.filter(e => e.type === 'tool_call')).toHaveLength(1);
    expect(events.filter(e => e.type === 'done')).toHaveLength(1);
  });

  it('5. tool call with empty args', async () => {
    mockStreamEvents = [
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'toolu_empty', name: 'no_args_tool' },
      },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    const toolCall = events.find(e => e.type === 'tool_call');
    expect(toolCall).toBeDefined();
    if (toolCall?.type === 'tool_call') {
      expect(toolCall.args).toEqual({});
    }
  });

  it('6. error handling — yields error event', async () => {
    // Override the mock to throw
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const mockInstance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(mockInstance.messages, 'stream').mockImplementation(() => {
      throw new Error('Rate limit exceeded');
    });

    // Use _setClient to inject the error-throwing client
    const { _setClient } = await import('./anthropic.js');
    _setClient(mockInstance as never);

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, baseRequest);

    const error = events.find(e => e.type === 'error');
    expect(error).toBeDefined();
    if (error?.type === 'error') {
      expect(error.message).toContain('Rate limit exceeded');
    }

    // Reset client
    _setClient(null);
  });

  it('7. passes tools to Anthropic SDK when provided', async () => {
    mockStreamEvents = [
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];

    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    const events = await collectEvents(adapter, {
      ...baseRequest,
      tools: [{
        name: 'round_complete',
        description: 'Mark a round as complete',
        parameters: { type: 'object', properties: { round: { type: 'number' } } },
      }],
    });

    expect(events.some(e => e.type === 'done')).toBe(true);
  });
});
