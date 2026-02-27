import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';

const promptCache = new Map<string, string>();

function getPromptDir(): string {
  const config = getConfig();
  return resolve(process.cwd(), config.persona.prompts_dir);
}

function loadPromptFile(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached) return cached;

  const content = readFileSync(resolve(getPromptDir(), filename), 'utf-8');
  promptCache.set(filename, content);
  return content;
}

function buildTemplateVariables(): Record<string, string> {
  const config = getConfig();
  return {
    '{{owner}}': config.client.owner,
    '{{owner_first}}': config.client.owner.split(' ')[0],
    '{{company}}': config.client.company,
    '{{company_pt}}': config.client.company_pt,
    '{{persona_name}}': config.persona.name,
    '{{website}}': config.client.website,
    '{{location}}': config.client.location,
    '{{services_name}}': config.services.name,
    '{{duration_display}}': config.services.duration_display,
    '{{deposit_display}}': config.payment.deposit_display,
    '{{contact_channel}}': config.persona.contact_channel,
    '{{system_name}}': config.persona.system_name,
    '{{currency_symbol}}': config.payment.currency_symbol,
  };
}

function resolveTemplateVariables(text: string): string {
  const vars = buildTemplateVariables();
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }

  // Warn about unresolved variables
  const unresolved = result.match(/\{\{[a-z_]+\}\}/g);
  if (unresolved) {
    console.warn(`[persona] Unresolved template variables in prompt: ${[...new Set(unresolved)].join(', ')}`);
  }

  return result;
}

export function buildSystemPrompt(tier: 'lobby' | 'meeting_room'): string {
  const shared = loadPromptFile('shared-persona.md');
  const knowledge = loadPromptFile('knowledge-base.md');
  const security = loadPromptFile('security-instructions.md');
  const language = loadPromptFile('language-instructions.md');
  const qualification = loadPromptFile('qualification-extraction.md');

  const tierFile = tier === 'lobby' ? 'lobby.md' : 'meeting-room.md';
  const tierPrompt = loadPromptFile(tierFile);

  // Replace structural placeholder tokens
  const assembled = tierPrompt
    .replace('[SHARED_PERSONA]', shared)
    .replace('[KNOWLEDGE_BASE]', knowledge)
    .replace('[SECURITY_INSTRUCTIONS]', security)
    .replace('[LANGUAGE_INSTRUCTIONS]', language)
    .replace('[QUALIFICATION_EXTRACTION]', qualification);

  // Resolve identity template variables
  return resolveTemplateVariables(assembled);
}

export function clearPromptCache(): void {
  promptCache.clear();
}
