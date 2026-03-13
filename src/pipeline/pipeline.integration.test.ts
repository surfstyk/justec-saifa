import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';
import { MockLLMAdapter } from '../__fixtures__/mock-adapter.js';
import type { Session, LLMEvent } from '../types.js';

// ── Mock setup ──────────────────────────────────────────

const testConfig = makeConfig();
let mockAdapter: MockLLMAdapter;

vi.mock('../config.js', () => ({
  getConfig: () => testConfig,
  loadConfig: () => testConfig,
}));

vi.mock('../llm/router.js', () => ({
  resolveModel: () => ({
    adapter: mockAdapter,
    config: { model: 'test', max_tokens: 1024, provider: 'google' },
  }),
}));

vi.mock('../security/rate-limiter.js', () => ({
  checkSessionLimit: () => ({ allowed: true, remaining: 20, limit: 25, resetAt: Date.now() + 3600000 }),
  checkIpLimit: () => ({ allowed: true, remaining: 30, limit: 40, resetAt: Date.now() + 3600000 }),
  setRateLimitHeaders: vi.fn(),
}));

vi.mock('../integrations/trello-cards.js', () => ({
  moveToPhoneCaptured: vi.fn().mockResolvedValue(undefined),
  createLeadCard: vi.fn().mockResolvedValue('card-123'),
  moveToBooked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../integrations/telegram.js', () => ({
  notifySecurityIncident: vi.fn(),
  notifyQualified: vi.fn(),
}));

vi.mock('../admin/stats.js', () => ({
  recordSessionCreated: vi.fn(),
  recordMessage: vi.fn(),
  recordLLMError: vi.fn(),
  recordBooking: vi.fn(),
  recordEscalation: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('../db/conversations.js', () => ({
  persistSession: vi.fn(),
  persistMessage: vi.fn(),
  logSecurityEvent: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('../integrations/calendar-holds.js', () => ({
  deleteHoldsForSession: vi.fn().mockResolvedValue(undefined),
  sweepExpiredHolds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../session/store-memory.js', () => {
  const store = new Map();
  const queue: string[] = [];
  return {
    getSessionStore: () => store,
    getQueue: () => queue,
    getActiveSessionCount: () => {
      let count = 0;
      for (const s of store.values()) if ((s as Session).status === 'active') count++;
      return count;
    },
    getQueueLength: () => queue.length,
    addToQueue: (id: string) => { queue.push(id); return queue.length; },
    removeFromQueue: (id: string) => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); },
    promoteFromQueue: () => queue.shift(),
    getAllSessions: () => [...store.values()],
    getStats: () => ({ active: store.size, queued: 0, total: store.size, byTier: {}, byClassification: {} }),
  };
});

const { runPipeline } = await import('./index.js');
import type { PipelineContext } from './types.js';

// ── Helper to build context ──────────────────────────────

function makeMockRes(): {
  res: PipelineContext['res'];
  events: Array<{ event: string; data: string }>;
  ended: boolean;
} {
  const events: Array<{ event: string; data: string }> = [];
  const emitter = new EventEmitter();
  let ended = false;

  const res = {
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn().mockImplementation((data: string) => {
      // Parse SSE format: "event: xxx\ndata: yyy\n\n"
      const lines = data.split('\n');
      let event = 'message';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      events.push({ event, data: dataStr });
    }),
    end: vi.fn().mockImplementation(() => { ended = true; }),
    on: vi.fn().mockImplementation((event: string, cb: () => void) => {
      emitter.on(event, cb);
    }),
    headersSent: false,
    writableEnded: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as PipelineContext['res'];

  return { res, events, ended };
}

function makeCtx(
  session: Session,
  text: string,
  res: PipelineContext['res'],
): PipelineContext {
  return {
    session,
    requestBody: { text },
    ipHash: session.ip_hash,
    config: testConfig,
    processedText: '',
    threatLevel: 0,
    guardAction: null,
    guardRedirect: null,
    systemPrompt: '',
    messages: [],
    tools: [],
    fullResponse: '',
    toolCalls: [],
    structuredMessages: [],
    capturedSignals: null,
    tokenUsage: { input: 0, output: 0 },
    res,
    clientDisconnected: false,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. simple text response → SSE events emitted', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Hello there!' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
    ]);

    const session = makeSession({ messages_count: 1 });
    const { res, events } = makeMockRes();
    const ctx = makeCtx(session, 'Hi', res);

    await runPipeline(ctx);

    expect(ctx.fullResponse).toContain('Hello there!');
    expect(events.some(e => e.event === 'processing')).toBe(true);
    expect(events.some(e => e.event === 'token')).toBe(true);
  });

  it('2. tool call + text → tool executed, text streamed', async () => {
    mockAdapter = new MockLLMAdapter([
      // Round 1: tool call only
      [
        { type: 'tool_call', id: 'tc1', name: 'report_signals', args: { qualification: { problem_specificity: 5, authority_level: 5, timeline_urgency: 5, need_alignment: 5, budget_indicator: 5, engagement_depth: 5 }, visitor_info: { name: null, company: null, role: null, company_size: null, industry: null, language: 'en' }, conversation_state: { intent: 'exploring', buying_signals: [], disqualification_signals: [], recommended_action: 'continue_discovery' } } },
        { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
      ],
      // Round 2: text only
      [
        { type: 'token', text: 'How can I help you today?' },
        { type: 'done', usage: { input_tokens: 80, output_tokens: 20 } },
      ],
    ]);

    const session = makeSession({ messages_count: 1 });
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Hello', res);

    await runPipeline(ctx);

    expect(ctx.capturedSignals).not.toBeNull();
    expect(ctx.fullResponse).toContain('How can I help you today?');
  });

  it('3. regression: report_signals only (no text) → continuation → text produced', async () => {
    mockAdapter = new MockLLMAdapter([
      // Round 1: signal only
      [
        { type: 'tool_call', id: 'tc1', name: 'report_signals', args: { qualification: { problem_specificity: 3, authority_level: 2, timeline_urgency: 1, need_alignment: 4, budget_indicator: 2, engagement_depth: 3 }, visitor_info: { name: null, company: null, role: null, company_size: null, industry: null, language: 'en' }, conversation_state: { intent: 'exploring', buying_signals: [], disqualification_signals: [], recommended_action: 'continue_discovery' } } },
        { type: 'done', usage: { input_tokens: 50, output_tokens: 5 } },
      ],
      // Round 2: text after continuation prompt
      [
        { type: 'token', text: 'Welcome! How can I assist you?' },
        { type: 'done', usage: { input_tokens: 80, output_tokens: 20 } },
      ],
    ]);

    const session = makeSession({ messages_count: 1 });
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Hello', res);

    await runPipeline(ctx);

    expect(ctx.capturedSignals).not.toBeNull();
    expect(ctx.fullResponse).toContain('Welcome!');
  });

  it('7. input filter blocks → guard escalated', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Should not reach here' },
      { type: 'done', usage: { input_tokens: 10, output_tokens: 5 } },
    ]);

    const session = makeSession({ guard_level: 2, messages_count: 1 });
    const { res, events } = makeMockRes();
    const ctx = makeCtx(session, 'I will kill you', res);

    await runPipeline(ctx);

    // Guard should have escalated to terminate
    expect(session.guard_level).toBeGreaterThanOrEqual(3);
  });

  it('9. budget exhausted → session terminated', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Quick response.' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
    ]);

    // Session nearly at budget limit (engaged tier = 600k, validate will bump messages_count to 3)
    const session = makeSession({
      messages_count: 2,
      tokens_used: 599990,
    });
    const { res, events } = makeMockRes();
    const ctx = makeCtx(session, 'Hello', res);

    await runPipeline(ctx);

    // Budget consume should detect exhaustion
    expect(events.some(e => e.event === 'budget_exhausted')).toBe(true);
  });

  it('11. MAX_TOOL_ROUNDS (3) reached → breaks loop', async () => {
    // Mock adapter that always returns a tool call (never text)
    const rounds: LLMEvent[][] = [];
    for (let i = 0; i < 5; i++) {
      rounds.push([
        { type: 'tool_call', id: `tc${i}`, name: 'present_product', args: { product: 'membermagix' } },
        { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
      ]);
    }
    mockAdapter = new MockLLMAdapter(rounds);

    const session = makeSession({ messages_count: 1 });
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Show me products', res);

    await runPipeline(ctx);

    // Should not have more than MAX_TOOL_ROUNDS+1 tool calls
    expect(ctx.toolCalls.length).toBeLessThanOrEqual(4);
  });

  it('13. regression: phone number in text → extracted to metadata', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Thanks for your number!' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
    ]);

    const session = makeSession({ messages_count: 1 });
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'My number is +49 170 1234567', res);

    await runPipeline(ctx);

    expect(session.metadata?.phone).toBe('+491701234567');
  });

  it('14. phone already captured → text phone ignored', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Got it.' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 10 } },
    ]);

    const session = makeSession({
      messages_count: 1,
      metadata: { phone: '+351912345678' },
    });
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Also try +49 170 9999999', res);

    await runPipeline(ctx);

    // Original phone preserved
    expect(session.metadata?.phone).toBe('+351912345678');
  });

  it('17. LLM error → error SSE event, no crash', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'error', message: 'API quota exceeded' },
    ]);

    const session = makeSession({ messages_count: 1 });
    const { res, events } = makeMockRes();
    const ctx = makeCtx(session, 'Hello', res);

    await runPipeline(ctx);

    expect(events.some(e => e.event === 'error')).toBe(true);
  });

  it('18. German conversation → no false security flags', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Willkommen! Wie kann ich Ihnen helfen?' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 15 } },
    ]);

    const session = makeSession({ language: 'de', messages_count: 1 });
    session.visitor_info.language = 'de';
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Die Lösung gefällt mir, dicker Preis aber.', res);

    await runPipeline(ctx);

    // Guard should not have escalated
    expect(session.guard_level).toBe(0);
    expect(ctx.fullResponse).toContain('Willkommen');
  });

  it('19. Portuguese conversation → no false security flags', async () => {
    mockAdapter = new MockLLMAdapter([
      { type: 'token', text: 'Bem-vindo! Como posso ajudá-lo?' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 15 } },
    ]);

    const session = makeSession({ language: 'pt', messages_count: 1 });
    session.visitor_info.language = 'pt';
    const { res } = makeMockRes();
    const ctx = makeCtx(session, 'Qual é o assunto principal da sessão?', res);

    await runPipeline(ctx);

    expect(session.guard_level).toBe(0);
    expect(ctx.fullResponse).toContain('Bem-vindo');
  });
});
