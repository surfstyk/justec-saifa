import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';
import type { LLMMessage } from '../types.js';

let cachedPrompt: string | null = null;

function loadInterviewPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const config = getConfig();
  const promptPath = resolve(process.cwd(), config.persona.prompts_dir, 'interview.md');
  cachedPrompt = readFileSync(promptPath, 'utf-8');
  return cachedPrompt;
}

function resolveTemplateVariables(text: string): string {
  const config = getConfig();
  const vars: Record<string, string> = {
    '{{owner}}': config.client.owner,
    '{{owner_first}}': config.client.owner.split(' ')[0],
    '{{company}}': config.client.company,
    '{{persona_name}}': config.persona.name,
    '{{website}}': config.client.website,
    '{{location}}': config.client.location,
  };

  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

/**
 * Transform lobby/meeting room conversation history for the interview context.
 * Strips tool call messages, keeps only visitor text + assistant text responses.
 * Returns a formatted summary block for injection into the prompt.
 */
function transformLobbyContext(history: LLMMessage[]): string {
  const textMessages = history.filter(msg => {
    // Keep user messages
    if (msg.role === 'user') return true;
    // Keep assistant messages that are NOT tool calls
    if (msg.role === 'assistant' && !msg.tool_call_id) return true;
    // Skip tool messages and assistant tool calls
    return false;
  });

  if (textMessages.length === 0) return '(No prior conversation — visitor was routed directly.)';

  return textMessages
    .map(msg => {
      const speaker = msg.role === 'user' ? 'Visitor' : 'Justec';
      return `${speaker}: ${msg.content}`;
    })
    .join('\n\n');
}

export interface InterviewPromptResult {
  system: string;
  lobbyContext: string;
}

/**
 * Build the complete interview system prompt.
 * Injects lobby conversation context and resolves template variables.
 */
export function buildInterviewPrompt(lobbyHistory: LLMMessage[]): InterviewPromptResult {
  const template = loadInterviewPrompt();
  const lobbyContext = transformLobbyContext(lobbyHistory);

  const assembled = template.replace('[LOBBY_CONTEXT]', lobbyContext);
  const system = resolveTemplateVariables(assembled);

  return { system, lobbyContext };
}

/** Clear cached prompt (for tests or hot reload). */
export function clearInterviewPromptCache(): void {
  cachedPrompt = null;
}
