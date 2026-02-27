import { buildSystemPrompt } from './loader.js';
import { SIGNAL_TOOL } from '../tools/signal-tool.js';
import type { Session, LLMMessage, ToolDefinition } from '../types.js';

const LOBBY_HISTORY_WINDOW = 5; // Last 5 exchanges (10 messages)

export function buildLobbyPrompt(session: Session): {
  system: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
} {
  const system = buildSystemPrompt('lobby');

  // Window the history for lobby (conserve tokens)
  const maxMessages = LOBBY_HISTORY_WINDOW * 2;
  const historySlice = session.history.length > maxMessages
    ? session.history.slice(-maxMessages)
    : session.history;

  const messages: LLMMessage[] = historySlice
    .filter(msg => msg.content !== null)
    .map(msg => ({
      role: msg.role === 'visitor' ? 'user' as const : 'assistant' as const,
      content: msg.content!,
    }));

  return { system, messages, tools: [SIGNAL_TOOL] };
}
