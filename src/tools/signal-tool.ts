import type { ToolDefinition } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export const SIGNAL_TOOL: ToolDefinition = {
  name: 'report_signals',
  description:
    'MANDATORY: Call this tool after EVERY response to report your assessment of the visitor. ' +
    'This is how you communicate qualification scores, visitor info, and conversation state to the system.',
  parameters: {
    type: 'object',
    properties: {
      qualification: {
        type: 'object',
        description: 'Score each dimension 0-10 based on what the visitor has revealed so far.',
        properties: {
          problem_specificity: { type: 'number', description: '0=no problem mentioned, 5=specific area, 10=named stakeholders+metrics' },
          authority_level: { type: 'number', description: '0=unknown, 5=manager, 8=C-suite, 10=founder/CEO' },
          timeline_urgency: { type: 'number', description: '0=no timeline, 5=this quarter, 8=within weeks, 10=immediately' },
          need_alignment: { type: 'number', description: '0=unrelated, 5=adjacent, 8=strong fit, 10=perfect fit' },
          budget_indicator: { type: 'number', description: '0=price-first, 5=discusses ROI, 8=healthy budget context, 10=budget not a concern' },
          engagement_depth: { type: 'number', description: '0=single-word, 5=moderate, 8=detailed+questions back, 10=deep engagement' },
        },
        required: ['problem_specificity', 'authority_level', 'timeline_urgency', 'need_alignment', 'budget_indicator', 'engagement_depth'],
      },
      visitor_info: {
        type: 'object',
        description: 'Extract only what was explicitly stated. Use null for anything not mentioned.',
        properties: {
          name: { type: ['string', 'null'] },
          company: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          company_size: { type: ['string', 'null'] },
          industry: { type: ['string', 'null'] },
          language: { type: 'string', description: 'Detected language: en, de, or pt. Default en.' },
        },
      },
      conversation_state: {
        type: 'object',
        description: 'Overall assessment of where the conversation is headed.',
        properties: {
          intent: {
            type: 'string',
            enum: ['exploring', 'researching', 'evaluating', 'ready_to_engage', 'hostile', 'off_topic'],
          },
          buying_signals: {
            type: 'array',
            items: { type: 'string' },
            description: 'Detected signals: asked_about_process, asked_about_timeline, asked_about_owner, shared_specifics, expressed_urgency',
          },
          disqualification_signals: {
            type: 'array',
            items: { type: 'string' },
            description: 'Red flags: price_first, comparison_shopping, no_authority, vague_need, hostile_language, injection_attempt',
          },
          recommended_action: {
            type: 'string',
            enum: ['continue_discovery', 'escalate_to_meeting_room', 'offer_booking', 'graceful_exit', 'security_escalate'],
          },
        },
      },
    },
    required: ['qualification', 'visitor_info', 'conversation_state'],
  },
};

export function handleReportSignals(args: Record<string, unknown>): ToolCallResult {
  // No side effects — the signal data is captured in the message route
  console.log('[signal-tool] Received signals:', JSON.stringify(args).slice(0, 200));
  return { result: { acknowledged: true } };
}
