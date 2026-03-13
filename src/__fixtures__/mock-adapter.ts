import type { LLMAdapter } from '../llm/adapter.js';
import type { LLMChatRequest, LLMEvent } from '../types.js';

/**
 * MockLLMAdapter — yields predetermined events for pipeline testing.
 *
 * Usage:
 *   const adapter = new MockLLMAdapter([
 *     { type: 'token', text: 'Hello' },
 *     { type: 'done', usage: { input_tokens: 100, output_tokens: 20 } },
 *   ]);
 */
export class MockLLMAdapter implements LLMAdapter {
  private rounds: LLMEvent[][];
  private callIndex = 0;
  public lastRequest: LLMChatRequest | null = null;

  constructor(events: LLMEvent[] | LLMEvent[][]) {
    // Support single round (flat array) or multi-round (array of arrays)
    if (events.length > 0 && !Array.isArray(events[0])) {
      this.rounds = [events as LLMEvent[]];
    } else {
      this.rounds = events as LLMEvent[][];
    }
  }

  async *chat(request: LLMChatRequest): AsyncGenerator<LLMEvent> {
    this.lastRequest = request;
    const events = this.rounds[Math.min(this.callIndex, this.rounds.length - 1)];
    this.callIndex++;

    for (const event of events) {
      yield event;
    }
  }
}
