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
        description: 'The round number being completed (1-3).',
        enum: [1, 2, 3],
      },
      blueprint: {
        type: 'object',
        description: 'The cumulative Blueprint data gathered through all completed rounds so far.',
      },
    },
    required: ['round', 'blueprint'],
  },
};

export const CHECK_FEASIBILITY_TOOL: ToolDefinition = {
  name: 'check_feasibility',
  description:
    'Flag a request that may need consulting or custom development. Call this when the prospect describes something ' +
    'unusual or very specific. Returns a recommendation on how to handle it in the conversation.',
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
  CHECK_FEASIBILITY_TOOL,
];

// ── Tool Handlers ─────────────────────────────────────────

export function handleRoundComplete(args: Record<string, unknown>): ToolCallResult {
  const round = args.round as number;
  const blueprint = args.blueprint as Record<string, unknown> | undefined;

  if (!round || round < 1 || round > 3) {
    return { result: { success: false, error: 'Invalid round number. Must be 1-3.' } };
  }

  if (!blueprint) {
    return { result: { success: false, error: 'Blueprint data is required.' } };
  }

  const validation = validateAtRound(blueprint, round as 1 | 2 | 3);

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
      message: round === 3
        ? 'All rounds complete. Blueprint finalized. Proceeding to proposal generation.'
        : `Round ${round} complete. You may proceed to round ${round + 1}.`,
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
      message: `This is doable. Acknowledge the request warmly and let them know their agent can learn this skill over time. If it's complex, mention the follow-up call with Hendrik as the place to discuss details.`,
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
    case 'check_feasibility':
      return handleCheckFeasibility(args);
    default:
      return { result: { error: true, message: `Unknown interview tool: ${toolName}` } };
  }
}
