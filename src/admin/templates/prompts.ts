import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../../config.js';
import { buildSystemPrompt } from '../../persona/loader.js';
import { layout, escapeHtml } from './layout.js';

export function renderPrompts(): string {
  const config = getConfig();
  const promptDir = resolve(process.cwd(), config.persona.prompts_dir);

  // List all prompt files
  let files: string[] = [];
  try {
    files = readdirSync(promptDir).filter(f => f.endsWith('.md')).sort();
  } catch {
    return layout('Prompts', '/admin/justec/prompts', '<p style="color:#e74c3c">Could not read prompts directory.</p>');
  }

  // Individual files
  let fileBlocks = '';
  for (const file of files) {
    try {
      const content = readFileSync(resolve(promptDir, file), 'utf-8');
      fileBlocks += `
        <h2>${escapeHtml(file)}</h2>
        <div class="prompt-content">${escapeHtml(content)}</div>
      `;
    } catch {
      fileBlocks += `<h2>${escapeHtml(file)}</h2><p style="color:#e74c3c">Error reading file</p>`;
    }
  }

  // Assembled prompts
  let lobbyAssembled = '';
  let meetingRoomAssembled = '';
  try {
    lobbyAssembled = buildSystemPrompt('lobby');
  } catch (e) {
    lobbyAssembled = `Error assembling lobby prompt: ${e}`;
  }
  try {
    meetingRoomAssembled = buildSystemPrompt('meeting_room');
  } catch (e) {
    meetingRoomAssembled = `Error assembling meeting_room prompt: ${e}`;
  }

  // Variable table
  const variables: Record<string, string> = {
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

  const varRows = Object.entries(variables).map(([key, value]) =>
    `<div class="config-row">
      <span class="config-key"><code>${escapeHtml(key)}</code></span>
      <span class="config-val">${escapeHtml(value)}</span>
    </div>`
  ).join('');

  const body = `
    <h2>Template Variables</h2>
    <div class="config-section">
      ${varRows}
    </div>

    <h2>Assembled: Lobby Prompt (${lobbyAssembled.length.toLocaleString()} chars)</h2>
    <div class="prompt-content">${escapeHtml(lobbyAssembled)}</div>

    <h2>Assembled: Meeting Room Prompt (${meetingRoomAssembled.length.toLocaleString()} chars)</h2>
    <div class="prompt-content">${escapeHtml(meetingRoomAssembled)}</div>

    <h2>Individual Files (${files.length})</h2>
    ${fileBlocks}
  `;

  return layout('Prompts', '/admin/justec/prompts', body);
}
