#!/usr/bin/env npx tsx
/**
 * Interview CLI — Phase 0 test harness.
 *
 * Runs a real Maren interview in the terminal using the Anthropic adapter.
 * Logs token usage per turn and per session.
 *
 * Usage:
 *   CONFIG_PATH=config/surfstyk.json npx tsx scripts/interview-cli.ts [--lang de]
 *
 * Requires ANTHROPIC_API_KEY env var or key file at credentials_path/anthropic_api_key.
 */

import * as readline from 'readline';
import { AnthropicAdapter } from '../src/llm/anthropic.js';
import { buildInterviewPrompt } from '../src/interview/persona.js';
import { handleInterviewTool, INTERVIEW_TOOLS } from '../src/interview/tools.js';
import { SIGNAL_TOOL } from '../src/tools/signal-tool.js';
import type { LLMChatRequest, LLMMessage, LLMEvent, ToolDefinition, TokenUsage } from '../src/types.js';

// ── Config bootstrap ──────────────────────────────────────
// Load SAIFA config so template variables resolve
await import('../src/config.js').then(m => m.loadConfig());

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const langIdx = args.indexOf('--lang');
const lang = langIdx >= 0 ? args[langIdx + 1] || 'en' : 'en';

const MODEL = process.env.INTERVIEW_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

// ── State ─────────────────────────────────────────────────

interface TurnStats {
  turn: number;
  role: 'user' | 'assistant';
  input_tokens: number;
  output_tokens: number;
  tool_calls: string[];
}

const history: LLMMessage[] = [];
const turnLog: TurnStats[] = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;
let turnCount = 0;
let currentRound = 0;

// ── Prompt setup ──────────────────────────────────────────

// Simulate a minimal lobby context based on language
const lobbyContextByLang: Record<string, LLMMessage[]> = {
  en: [
    { role: 'user', content: 'I want to build an AI agent for my business.' },
    { role: 'assistant', content: 'That sounds exciting! Let me connect you to our design studio.' },
  ],
  de: [
    { role: 'user', content: 'Ich möchte einen KI-Agenten für mein Unternehmen bauen.' },
    { role: 'assistant', content: 'Das klingt spannend! Lass mich dich mit unserem Design-Studio verbinden.' },
  ],
  pt: [
    { role: 'user', content: 'Quero construir um agente de IA para o meu negócio.' },
    { role: 'assistant', content: 'Isso parece emocionante! Deixe-me conectar você ao nosso estúdio de design.' },
  ],
};

const lobbyHistory = lobbyContextByLang[lang] || lobbyContextByLang.en;
const { system } = buildInterviewPrompt(lobbyHistory);

// All tools available to Maren: interview tools + report_signals
const tools: ToolDefinition[] = [...INTERVIEW_TOOLS, SIGNAL_TOOL];

// ── Adapter ───────────────────────────────────────────────

const adapter = new AnthropicAdapter(MODEL);

// ── UI helpers ────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

function printHeader() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  Maren Interview CLI — Phase 0 Test Harness${RESET}`);
  console.log(`${DIM}  Model: ${MODEL} | Language: ${lang} | Max tokens: ${MAX_TOKENS}${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}\n`);
}

function printTokens(usage: TokenUsage) {
  console.log(`\n${DIM}  ┌─ Turn ${turnCount} tokens: in=${usage.input_tokens} out=${usage.output_tokens} │ Session total: in=${totalInputTokens} out=${totalOutputTokens} ─┐${RESET}`);
}

function printRound(round: number) {
  const names = ['', 'The Seed', 'The Shape', 'The Gaps', 'Playback & Confirm'];
  console.log(`\n${BOLD}${MAGENTA}  ▶ Round ${round}: ${names[round] || '???'}${RESET}\n`);
}

function printToolCall(name: string, args: Record<string, unknown>) {
  const preview = JSON.stringify(args).slice(0, 120);
  console.log(`${DIM}  [tool] ${name}(${preview})${RESET}`);
}

function printToolResult(name: string, result: Record<string, unknown>) {
  const preview = JSON.stringify(result).slice(0, 120);
  console.log(`${DIM}  [result] ${name} → ${preview}${RESET}`);
}

function printSessionSummary() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Session Summary${RESET}`);
  console.log(`${DIM}  Total turns: ${turnCount}${RESET}`);
  console.log(`${DIM}  Total tokens: in=${totalInputTokens} out=${totalOutputTokens} combined=${totalInputTokens + totalOutputTokens}${RESET}`);

  // Cost estimate (Sonnet 4.6 pricing: $3/M input, $15/M output)
  const inputCost = (totalInputTokens / 1_000_000) * 3.0;
  const outputCost = (totalOutputTokens / 1_000_000) * 15.0;
  const totalCost = inputCost + outputCost;
  const eurTotal = totalCost * 0.92; // rough USD→EUR
  console.log(`${DIM}  Estimated cost: $${totalCost.toFixed(4)} (~€${eurTotal.toFixed(4)})${RESET}`);
  console.log(`${DIM}  Breakdown: input $${inputCost.toFixed(4)} + output $${outputCost.toFixed(4)}${RESET}`);

  if (currentRound > 0) {
    console.log(`${DIM}  Last completed round: ${currentRound}${RESET}`);
  }

  console.log(`\n${DIM}  Per-turn log:${RESET}`);
  for (const t of turnLog) {
    const tools = t.tool_calls.length > 0 ? ` [${t.tool_calls.join(', ')}]` : '';
    console.log(`${DIM}    Turn ${t.turn} (${t.role}): in=${t.input_tokens} out=${t.output_tokens}${tools}${RESET}`);
  }
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}\n`);
}

// ── Main loop ─────────────────────────────────────────────

async function runTurn(userMessage: string): Promise<string> {
  turnCount++;
  history.push({ role: 'user', content: userMessage });

  let fullResponse = '';
  const toolCallsThisTurn: string[] = [];
  let lastUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  // Tool call loop (max 5 rounds per turn)
  for (let toolRound = 0; toolRound < 5; toolRound++) {
    const request: LLMChatRequest = {
      system,
      messages: history,
      tools,
      max_tokens: MAX_TOKENS,
    };

    let turnText = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

    for await (const event of adapter.chat(request)) {
      switch (event.type) {
        case 'token':
          process.stdout.write(event.text);
          turnText += event.text;
          break;

        case 'tool_call':
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
          break;

        case 'done':
          lastUsage = event.usage;
          break;

        case 'error':
          console.error(`\n${BOLD}\x1b[31m  ERROR: ${event.message}${RESET}`);
          return '';
      }
    }

    // If there was text, add it to response and history
    if (turnText) {
      fullResponse += turnText;
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
      if (turnText) {
        history.push({ role: 'assistant', content: turnText });
      }
      break;
    }

    // Process tool calls
    // Add assistant message with tool use to history
    if (turnText) {
      history.push({ role: 'assistant', content: turnText });
    }
    for (const tc of toolCalls) {
      toolCallsThisTurn.push(tc.name);
      printToolCall(tc.name, tc.args);

      // Add assistant tool call to history
      history.push({
        role: 'assistant',
        content: '',
        tool_call_id: tc.id,
        tool_name: tc.name,
        tool_result: tc.args,
      });

      // Execute tool
      let toolResult: Record<string, unknown>;
      if (tc.name === 'report_signals') {
        toolResult = { acknowledged: true };
      } else {
        const handled = handleInterviewTool(tc.name, tc.args);
        toolResult = handled.result;

        // Track round completion
        if (tc.name === 'round_complete' && toolResult.success) {
          currentRound = toolResult.round as number;
          printRound(currentRound);
        }
      }

      printToolResult(tc.name, toolResult);

      // Add tool result to history
      history.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
        tool_call_id: tc.id,
        tool_name: tc.name,
        tool_result: toolResult,
      });
    }

    // Continue loop — LLM will see tool results and may respond with text or more tool calls
  }

  // Track usage
  totalInputTokens += lastUsage.input_tokens;
  totalOutputTokens += lastUsage.output_tokens;

  turnLog.push({
    turn: turnCount,
    role: 'assistant',
    input_tokens: lastUsage.input_tokens,
    output_tokens: lastUsage.output_tokens,
    tool_calls: toolCallsThisTurn,
  });

  printTokens(lastUsage);
  return fullResponse;
}

// ── Entry point ───────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

printHeader();

// Maren's opening — first turn with empty user message to trigger greeting
console.log(`${BOLD}${GREEN}Maren:${RESET} `);
await runTurn(lang === 'de'
  ? 'Hallo, ich bin bereit für die Design-Session.'
  : lang === 'pt'
    ? 'Olá, estou pronto para a sessão de design.'
    : 'Hi, I\'m ready for the design session.');
console.log('');

function prompt() {
  rl.question(`\n${BOLD}${YELLOW}You:${RESET} `, async (input) => {
    const trimmed = input.trim();

    if (!trimmed || trimmed === '/quit' || trimmed === '/exit') {
      printSessionSummary();
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/status') {
      console.log(`${DIM}  Round: ${currentRound} | Turns: ${turnCount} | Tokens: in=${totalInputTokens} out=${totalOutputTokens}${RESET}`);
      prompt();
      return;
    }

    if (trimmed === '/history') {
      console.log(`${DIM}  Messages in history: ${history.length}${RESET}`);
      for (const msg of history) {
        const preview = msg.content.slice(0, 80);
        console.log(`${DIM}    [${msg.role}${msg.tool_name ? ':' + msg.tool_name : ''}] ${preview}${RESET}`);
      }
      prompt();
      return;
    }

    console.log(`\n${BOLD}${GREEN}Maren:${RESET} `);
    await runTurn(trimmed);
    console.log('');
    prompt();
  });
}

prompt();
