#!/usr/bin/env npx tsx
/**
 * Interview Local — Phase 0 test harness using `claude` CLI.
 *
 * Runs a real Maren interview via your Claude Code subscription.
 * No API key needed — uses the `claude` binary directly.
 *
 * Usage:
 *   CONFIG_PATH=config/surfstyk.json npx tsx scripts/interview-local.ts [--lang de]
 *
 * Commands during interview:
 *   /status   — Show round, turn count
 *   /blueprint — Show current Blueprint state
 *   /quit     — End session, print summary
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as readline from 'readline';

// ── Config bootstrap ──────────────────────────────────────
await import('../src/config.js').then(m => m.loadConfig());

import { buildInterviewPrompt } from '../src/interview/persona.js';
import { handleInterviewTool } from '../src/interview/tools.js';
import type { LLMMessage } from '../src/types.js';

// ── CLI args ──────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const langIdx = cliArgs.indexOf('--lang');
const lang = langIdx >= 0 ? cliArgs[langIdx + 1] || 'en' : 'en';
const modelFlag = cliArgs.includes('--opus') ? 'opus' : 'sonnet';

// ── Colors ────────────────────────────────────────────────
const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

// ── State ─────────────────────────────────────────────────
let turnCount = 0;
let currentRound = 0;
let currentBlueprint: Record<string, unknown> = {};
let sessionActive = false; // tracks whether -c is viable
const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
const toolLog: Array<{ turn: number; name: string; success: boolean }> = [];

// ── Prompt assembly ───────────────────────────────────────

const lobbyContextByLang: Record<string, LLMMessage[]> = {
  en: [
    { role: 'user', content: 'I\'m interested in having a personal assistant built.' },
    { role: 'assistant', content: 'That sounds exciting! Let me connect you to our design studio — we\'ll help you design exactly the right partner for what you need.' },
  ],
  de: [
    { role: 'user', content: 'Ich interessiere mich für einen persönlichen Assistenten.' },
    { role: 'assistant', content: 'Das klingt spannend! Lass mich dich mit unserem Design-Studio verbinden.' },
  ],
  pt: [
    { role: 'user', content: 'Estou interessado em ter um assistente pessoal.' },
    { role: 'assistant', content: 'Isso parece emocionante! Deixe-me conectar você ao nosso estúdio de design.' },
  ],
};

const lobbyHistory = lobbyContextByLang[lang] || lobbyContextByLang.en;
const { system: baseSystem } = buildInterviewPrompt(lobbyHistory);

// Append tool calling protocol for text-only mode
const toolProtocol = `

## Tool Calling Protocol (TEXT MODE)

You are running in text-only mode. To call a tool, output a line starting with TOOL_CALL: followed by a SINGLE-LINE JSON object. Example:

TOOL_CALL: {"name": "check_capabilities", "args": {"capability": "Gmail", "context": "inbox triage"}}

Rules:
- Put each tool call on its own line starting with exactly \`TOOL_CALL: \`
- The JSON must be on ONE LINE (no line breaks inside the JSON)
- You may include conversational text before or after the tool call line
- The system will execute the tool and show you the result as "TOOL_RESULT: {...}"
- After seeing the tool result, continue the conversation naturally

Available tools:
1. round_complete — args: { round: 1-3, blueprint: { ... } } — see Blueprint Schema in system prompt for exact fields
2. check_feasibility — args: { request: string, concern?: string }

For round_complete, include the CUMULATIVE blueprint. Use the EXACT field names from the Blueprint Schema section above.
`;

const systemPrompt = baseSystem + toolProtocol;

// Write system prompt to temp file
const tmpDir = resolve(process.cwd(), '.tmp');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const promptFile = resolve(tmpDir, 'interview-prompt.md');
writeFileSync(promptFile, systemPrompt);

// ── Claude CLI wrapper ────────────────────────────────────

/**
 * Build a self-contained prompt packing conversation history into a single message.
 * Trims old exchanges to keep context manageable — keeps the last N exchanges
 * plus a summary of earlier ones.
 */
const MAX_HISTORY_MESSAGES = 12; // keep last 12 messages (~6 exchanges)

function buildFullPrompt(newMessage: string): string {
  let prompt = '';

  if (conversationHistory.length > 0) {
    let historyToInclude = conversationHistory;

    // Trim if history is too long — keep recent, summarize old
    if (conversationHistory.length > MAX_HISTORY_MESSAGES) {
      const trimmed = conversationHistory.length - MAX_HISTORY_MESSAGES;
      prompt += `[Earlier: ${trimmed} messages trimmed. Key context preserved in recent messages.]\n\n`;
      historyToInclude = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
    }

    prompt += 'Conversation so far:\n\n';
    for (const msg of historyToInclude) {
      const label = msg.role === 'user' ? 'VISITOR' : 'MAREN';
      // Truncate very long tool-result messages in history
      const content = msg.content.length > 500
        ? msg.content.slice(0, 500) + '... [truncated]'
        : msg.content;
      prompt += `${label}: ${content}\n\n`;
    }
    prompt += '---\n\n';
  }

  prompt += `VISITOR: ${newMessage}\n\nMAREN:`;

  const charCount = prompt.length;
  if (charCount > 20_000) {
    console.log(`${D}  [context: ${(charCount / 1000).toFixed(1)}KB prompt]${R}`);
  }

  return prompt;
}

function callClaude(message: string, isToolResult = false): string {
  const fullPrompt = isToolResult ? message : buildFullPrompt(message);
  const args: string[] = ['-p', '--model', modelFlag, '--system-prompt-file', promptFile];

  try {
    const result = execSync(
      `claude ${args.map(a => `"${a}"`).join(' ')}`,
      {
        input: fullPrompt,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 300_000, // 5 minutes
        cwd: process.cwd(),
      },
    );
    return result.trim();
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; status?: number; stderr?: string };

    if (e.killed || e.signal === 'SIGTERM') {
      console.error(`\n${RED}  ⏱ Timeout — claude CLI took longer than 5 minutes.${R}`);
      console.error(`${RED}  Context may be too large (${conversationHistory.length} messages in history).${R}`);
    } else if (e.status) {
      const stderr = (e.stderr || '').split('\n')[0].slice(0, 150);
      console.error(`\n${RED}  CLI exited with code ${e.status}: ${stderr}${R}`);
    } else {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.error(`\n${RED}  CLI error: ${msg.slice(0, 150)}${R}`);
    }
    return '';
  }
}

// ── Tool call parsing ─────────────────────────────────────

interface ParsedResponse {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function parseResponse(response: string): ParsedResponse {
  const textLines: string[] = [];
  const toolCalls: ParsedResponse['toolCalls'] = [];

  // Strategy: find TOOL_CALL: markers, then extract the JSON that follows.
  // The JSON may span multiple lines (the LLM often pretty-prints it).
  const lines = response.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^TOOL_CALL:\s*(.*)$/);

    if (match) {
      // Accumulate JSON starting from the match, across multiple lines if needed
      let jsonStr = match[1];

      // Check if the JSON is complete (balanced braces)
      while (!isBalancedJson(jsonStr) && i + 1 < lines.length) {
        i++;
        jsonStr += '\n' + lines[i];
      }

      try {
        const parsed = JSON.parse(jsonStr.trim());
        if (parsed.name && typeof parsed.name === 'string') {
          toolCalls.push({ name: parsed.name, args: parsed.args || {} });
        }
      } catch {
        // Failed to parse — treat original line as text
        textLines.push(line);
      }
    } else {
      textLines.push(line);
    }
    i++;
  }

  return { text: textLines.join('\n').trim(), toolCalls };
}

/** Check if a string has balanced curly braces (rough JSON completeness check). */
function isBalancedJson(str: string): boolean {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  return depth === 0 && str.includes('{');
}

// ── Tool execution ────────────────────────────────────────

function executeTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const result = handleInterviewTool(name, args);

  if (name === 'round_complete' && result.result.success) {
    currentRound = result.result.round as number;
    if (args.blueprint) {
      currentBlueprint = args.blueprint as Record<string, unknown>;
    }
  }

  toolLog.push({ turn: turnCount, name, success: !!result.result.success || !result.result.error });
  return result.result;
}

// ── Turn execution ────────────────────────────────────────

function runTurn(userMessage: string): string {
  turnCount++;
  conversationHistory.push({ role: 'user', content: userMessage });

  let response = callClaude(userMessage);
  if (!response) return '(no response)';

  // Tool call loop (max 3 rounds per turn)
  for (let i = 0; i < 3; i++) {
    const parsed = parseResponse(response);

    if (parsed.text) {
      console.log(`\n${B}${GREEN}Maren:${R} ${parsed.text}`);
    }

    if (parsed.toolCalls.length === 0) {
      conversationHistory.push({ role: 'assistant', content: parsed.text });
      return parsed.text;
    }

    // Execute tool calls and feed results back
    const results: string[] = [];
    for (const tc of parsed.toolCalls) {
      console.log(`${D}  [tool] ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})${R}`);
      const result = executeTool(tc.name, tc.args);
      console.log(`${D}  [result] ${JSON.stringify(result).slice(0, 120)}${R}`);

      if (tc.name === 'round_complete' && result.success) {
        const names = ['', 'Discovery', 'Agent Identity', 'Playback & Confirm'];
        console.log(`\n${B}${MAGENTA}  ▶ Round ${result.round}: ${names[result.round as number] || ''} — Complete${R}\n`);
      }

      results.push(`TOOL_RESULT for ${tc.name}: ${JSON.stringify(result)}`);
    }

    // Record assistant turn in history
    const assistantContent = parsed.text
      ? `${parsed.text}\n[Called tools: ${parsed.toolCalls.map(t => t.name).join(', ')}]`
      : `[Called tools: ${parsed.toolCalls.map(t => t.name).join(', ')}]`;
    conversationHistory.push({ role: 'assistant', content: assistantContent });

    // Feed tool results as the next "user" message — buildFullPrompt will
    // pack history + this new message into one prompt
    response = callClaude(results.join('\n'));
    if (!response) return parsed.text;
  }

  conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

// ── Session summary ───────────────────────────────────────

function printSummary() {
  console.log(`\n${B}${CYAN}═══════════════════════════════════════════════════${R}`);
  console.log(`${B}  Session Summary${R}`);
  console.log(`${D}  Turns: ${turnCount} | Last round: ${currentRound}/3 | Model: ${modelFlag}${R}`);
  console.log(`${D}  Language: ${lang} | History messages: ${conversationHistory.length}${R}`);

  if (toolLog.length > 0) {
    console.log(`\n${D}  Tool calls:${R}`);
    for (const t of toolLog) {
      console.log(`${D}    Turn ${t.turn}: ${t.name} → ${t.success ? '✓' : '✗'}${R}`);
    }
  }

  if (Object.keys(currentBlueprint).length > 0) {
    console.log(`\n${D}  Final Blueprint:${R}`);
    console.log(`${D}${JSON.stringify(currentBlueprint, null, 2)}${R}`);
  }

  console.log(`${B}${CYAN}═══════════════════════════════════════════════════${R}\n`);
}

// ── Main ──────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`\n${B}${CYAN}═══════════════════════════════════════════════════${R}`);
console.log(`${B}${CYAN}  Maren Interview — Local Test (via claude CLI)${R}`);
console.log(`${D}  Model: ${modelFlag} | Language: ${lang}${R}`);
console.log(`${D}  Commands: /status /blueprint /quit${R}`);
console.log(`${B}${CYAN}═══════════════════════════════════════════════════${R}\n`);

// Opening turn
console.log(`${D}  Starting interview session...${R}`);
const greeting = lang === 'de'
  ? 'Hallo, ich bin bereit für die Design-Session.'
  : lang === 'pt'
    ? 'Olá, estou pronto para a sessão de design.'
    : 'Hi, I\'m ready for the design session.';

runTurn(greeting);

function prompt() {
  rl.question(`\n${B}${YELLOW}You:${R} `, (input) => {
    const trimmed = input.trim();

    if (!trimmed || trimmed === '/quit' || trimmed === '/exit') {
      printSummary();
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/status') {
      console.log(`${D}  Round: ${currentRound}/3 | Turns: ${turnCount} | Tools used: ${toolLog.length}${R}`);
      prompt();
      return;
    }

    if (trimmed === '/blueprint') {
      if (Object.keys(currentBlueprint).length === 0) {
        console.log(`${D}  No Blueprint data yet.${R}`);
      } else {
        console.log(`${D}${JSON.stringify(currentBlueprint, null, 2)}${R}`);
      }
      prompt();
      return;
    }

    runTurn(trimmed);
    prompt();
  });
}

prompt();
