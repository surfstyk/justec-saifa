import type { ToolDefinition } from '../types.js';
import type { ToolCallResult } from '../tools/calendar-tools.js';
import { validateAtRound } from './blueprint.js';

// ── Tool Definitions ──────────────────────────────────────

export const ROUND_COMPLETE_TOOL: ToolDefinition = {
  name: 'round_complete',
  description:
    'Call this when the current interview round is complete. Provide the round number and the Blueprint data gathered so far. ' +
    'The system validates that required fields for this round are present. If data is missing, the tool returns what is still needed. ' +
    'On success, the round is recorded and you may proceed to the next round.',
  parameters: {
    type: 'object',
    properties: {
      round: {
        type: 'number',
        description: 'The round number being completed (1-4).',
        enum: [1, 2, 3, 4],
      },
      blueprint: {
        type: 'object',
        description: 'The cumulative Blueprint data gathered through all completed rounds so far.',
      },
    },
    required: ['round', 'blueprint'],
  },
};

export const CHECK_CAPABILITIES_TOOL: ToolDefinition = {
  name: 'check_capabilities',
  description:
    'Check whether a specific integration or capability is feasible. Call this during Round 2 when the prospect mentions ' +
    'data sources, channels, or tools they want the agent to work with. Returns feasibility assessment and notes.',
  parameters: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        description: 'The integration or capability to check (e.g., "Gmail API", "Telegram bot", "Slack integration", "WhatsApp").',
      },
      context: {
        type: 'string',
        description: 'Brief context on what the prospect wants to do with this capability.',
      },
    },
    required: ['capability'],
  },
};

export const ESTIMATE_COST_TOOL: ToolDefinition = {
  name: 'estimate_cost',
  description:
    'Estimate the approximate monthly cost for the agent being designed. Call this internally during Round 2 to guide ' +
    'the conversation — the estimate is NOT shown to the prospect. Use it to decide whether to probe budget sensitivity.',
  parameters: {
    type: 'object',
    properties: {
      complexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex'],
        description: 'Overall complexity of the agent.',
      },
      integrations_count: {
        type: 'number',
        description: 'Number of distinct integrations/data sources.',
      },
      schedule_frequency: {
        type: 'string',
        enum: ['daily', 'hourly', 'realtime', 'weekly'],
        description: 'How often the agent runs.',
      },
    },
    required: ['complexity', 'integrations_count', 'schedule_frequency'],
  },
};

export const CHECK_FEASIBILITY_TOOL: ToolDefinition = {
  name: 'check_feasibility',
  description:
    'Flag a request that may need consulting or custom development. Call this when the prospect describes something ' +
    'that goes beyond standard integrations. Returns a recommendation on how to handle it in the conversation.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description: 'What the prospect is asking for.',
      },
      concern: {
        type: 'string',
        description: 'Why this might need special handling (complexity, third-party limitations, etc.).',
      },
    },
    required: ['request'],
  },
};

/** All interview tool definitions, ready for LLM tool config. */
export const INTERVIEW_TOOLS: ToolDefinition[] = [
  ROUND_COMPLETE_TOOL,
  CHECK_CAPABILITIES_TOOL,
  ESTIMATE_COST_TOOL,
  CHECK_FEASIBILITY_TOOL,
];

// ── Known Capabilities ────────────────────────────────────

interface CapabilityInfo {
  feasible: boolean;
  complexity: 'trivial' | 'standard' | 'custom';
  notes: string;
}

const KNOWN_CAPABILITIES: Record<string, CapabilityInfo> = {
  'gmail': { feasible: true, complexity: 'standard', notes: 'Full Gmail API support via OAuth. Read, send, label, search.' },
  'google calendar': { feasible: true, complexity: 'standard', notes: 'Google Calendar API. Create, read, update events.' },
  'google sheets': { feasible: true, complexity: 'standard', notes: 'Sheets API for read/write. Good for structured data.' },
  'google drive': { feasible: true, complexity: 'standard', notes: 'Drive API for file access and management.' },
  'telegram': { feasible: true, complexity: 'trivial', notes: 'Telegram Bot API. Messages, commands, inline keyboards, file sharing.' },
  'telegram bot': { feasible: true, complexity: 'trivial', notes: 'Telegram Bot API. Messages, commands, inline keyboards, file sharing.' },
  'slack': { feasible: true, complexity: 'standard', notes: 'Slack Web API + Events API. Channels, DMs, threads, reactions.' },
  'trello': { feasible: true, complexity: 'standard', notes: 'Trello REST API. Cards, lists, boards, webhooks.' },
  'email': { feasible: true, complexity: 'standard', notes: 'SMTP/IMAP or Gmail API depending on provider.' },
  'whatsapp': { feasible: true, complexity: 'custom', notes: 'WhatsApp Business API available but complex setup. Telegram is simpler for similar use cases.' },
  'notion': { feasible: true, complexity: 'standard', notes: 'Notion API for pages, databases, blocks.' },
  'stripe': { feasible: true, complexity: 'standard', notes: 'Stripe API for payments, invoices, subscriptions.' },
  'webhook': { feasible: true, complexity: 'trivial', notes: 'HTTP webhooks for any service that supports them.' },
  'web scraping': { feasible: true, complexity: 'custom', notes: 'Possible with headless browsers. Site-specific, may need maintenance.' },
  'sms': { feasible: true, complexity: 'standard', notes: 'Twilio or similar provider. Per-message cost applies.' },
  'database': { feasible: true, complexity: 'standard', notes: 'SQLite, PostgreSQL, MySQL — depends on existing infrastructure.' },
  'crm': { feasible: true, complexity: 'custom', notes: 'Depends on CRM provider. HubSpot, Salesforce, Pipedrive all have APIs.' },
  'pdf generation': { feasible: true, complexity: 'standard', notes: 'HTML-to-PDF via Puppeteer or similar.' },
  'voice transcription': { feasible: true, complexity: 'standard', notes: 'Gemini handles voice natively. No separate ASR provider needed.' },
  'image analysis': { feasible: true, complexity: 'standard', notes: 'Multimodal LLMs handle image analysis natively.' },
};

function lookupCapability(query: string): CapabilityInfo | null {
  const normalized = query.toLowerCase().trim();
  // Exact match
  if (KNOWN_CAPABILITIES[normalized]) return KNOWN_CAPABILITIES[normalized];
  // Partial match
  for (const [key, info] of Object.entries(KNOWN_CAPABILITIES)) {
    if (normalized.includes(key) || key.includes(normalized)) return info;
  }
  return null;
}

// ── Cost Estimation ───────────────────────────────────────

interface CostEstimate {
  range_eur: { low: number; high: number };
  breakdown: string;
}

function estimateCost(
  complexity: string,
  integrationsCount: number,
  scheduleFrequency: string,
): CostEstimate {
  // Base compute cost by complexity
  const baseCost = { simple: 15, moderate: 30, complex: 60 }[complexity] ?? 30;

  // Integration multiplier
  const integrationCost = integrationsCount * 5;

  // Frequency multiplier
  const freqMultiplier = { weekly: 0.5, daily: 1, hourly: 3, realtime: 8 }[scheduleFrequency] ?? 1;

  const low = Math.round((baseCost + integrationCost) * freqMultiplier * 0.7);
  const high = Math.round((baseCost + integrationCost) * freqMultiplier * 1.5);

  return {
    range_eur: { low, high },
    breakdown: `Base: ~€${baseCost}/mo (${complexity}), integrations: ~€${integrationCost}/mo (${integrationsCount}x), frequency: ${scheduleFrequency} (×${freqMultiplier})`,
  };
}

// ── Tool Handlers ─────────────────────────────────────────

export function handleRoundComplete(args: Record<string, unknown>): ToolCallResult {
  const round = args.round as number;
  const blueprint = args.blueprint as Record<string, unknown> | undefined;

  if (!round || round < 1 || round > 4) {
    return { result: { success: false, error: 'Invalid round number. Must be 1-4.' } };
  }

  if (!blueprint) {
    return { result: { success: false, error: 'Blueprint data is required.' } };
  }

  const validation = validateAtRound(blueprint, round as 1 | 2 | 3 | 4);

  if (!validation.success) {
    const missing = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return {
      result: {
        success: false,
        round,
        missing_fields: missing,
        message: `Round ${round} is not complete. The following fields need attention: ${missing.join('; ')}`,
      },
    };
  }

  console.log(`[interview] Round ${round} complete. Blueprint validated.`);

  return {
    result: {
      success: true,
      round,
      message: round === 4
        ? 'All rounds complete. Blueprint finalized. Proceeding to proposal generation.'
        : `Round ${round} complete. You may proceed to round ${round + 1}.`,
    },
  };
}

export function handleCheckCapabilities(args: Record<string, unknown>): ToolCallResult {
  const capability = (args.capability as string || '').trim();
  const context = (args.context as string) || '';

  if (!capability) {
    return { result: { error: true, message: 'Capability name is required.' } };
  }

  const known = lookupCapability(capability);

  if (known) {
    return {
      result: {
        capability,
        feasible: known.feasible,
        complexity: known.complexity,
        notes: known.notes,
        context,
      },
    };
  }

  // Unknown — default to feasible but flag for follow-up
  return {
    result: {
      capability,
      feasible: true,
      complexity: 'custom' as const,
      notes: `"${capability}" is not in the standard integration list. It is likely feasible but may require custom development. Redirect to the follow-up call for specifics.`,
      context,
    },
  };
}

export function handleEstimateCost(args: Record<string, unknown>): ToolCallResult {
  const complexity = (args.complexity as string) || 'moderate';
  const integrationsCount = (args.integrations_count as number) || 1;
  const scheduleFrequency = (args.schedule_frequency as string) || 'daily';

  const estimate = estimateCost(complexity, integrationsCount, scheduleFrequency);

  return {
    result: {
      ...estimate,
      note: 'This estimate is for internal guidance only. Do NOT share specific numbers with the prospect. Use it to gauge budget alignment.',
    },
  };
}

export function handleCheckFeasibility(args: Record<string, unknown>): ToolCallResult {
  const request = (args.request as string || '').trim();
  const concern = (args.concern as string) || '';

  if (!request) {
    return { result: { error: true, message: 'Request description is required.' } };
  }

  return {
    result: {
      request,
      concern,
      feasible: true,
      recommendation: 'redirect_to_followup',
      message: `This is an interesting challenge. Acknowledge that the straightforward parts are covered, and redirect the complex aspects to the follow-up call with Hendrik. Never say no — say "let's figure it out."`,
    },
  };
}

/** Route an interview tool call to its handler. */
export function handleInterviewTool(
  toolName: string,
  args: Record<string, unknown>,
): ToolCallResult {
  switch (toolName) {
    case 'round_complete':
      return handleRoundComplete(args);
    case 'check_capabilities':
      return handleCheckCapabilities(args);
    case 'estimate_cost':
      return handleEstimateCost(args);
    case 'check_feasibility':
      return handleCheckFeasibility(args);
    default:
      return { result: { error: true, message: `Unknown interview tool: ${toolName}` } };
  }
}
