import type { LLMChatRequest, LLMEvent } from '../types.js';

export interface LLMAdapter {
  chat(request: LLMChatRequest): AsyncGenerator<LLMEvent>;
}
