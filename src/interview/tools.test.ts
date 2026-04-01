import { describe, it, expect } from 'vitest';
import {
  handleRoundComplete,
  handleCheckFeasibility,
  handleInterviewTool,
  INTERVIEW_TOOLS,
} from './tools.js';

// ── Sample Blueprint data ────────────────────────────────

const validDiscovery = {
  owner_name: 'Marcus',
  owner_about: 'Managing director at a real estate firm in Berlin.',
  domain: 'work',
  purpose: 'I need help with morning email triage.',
};

const validIdentity = {
  agent_name: 'Lena',
  gender: 'female',
  personality_summary: 'Calm, organized, warm but efficient. Dry humor.',
  personality_traits: ['organized', 'warm', 'efficient'],
  communication_style: 'Professional but approachable',
  archetype: 'Pepper Potts energy',
  visual_description: 'Early 30s professional woman, smart casual.',
  primary_channel: 'Telegram',
  languages: ['German', 'English'],
};

const validConfirmed = {
  playback_text: 'Lena is a calm, organized partner who keeps things running...',
  approved: true,
  adjustments: [],
};

// ── round_complete ────────────────────────────────────────

describe('round_complete', () => {
  it('round 1 valid — returns success', () => {
    const result = handleRoundComplete({ round: 1, blueprint: { discovery: validDiscovery } });
    expect(result.result.success).toBe(true);
    expect(result.result.round).toBe(1);
  });

  it('round 1 missing discovery — returns missing fields', () => {
    const result = handleRoundComplete({ round: 1, blueprint: {} });
    expect(result.result.success).toBe(false);
    expect(result.result.missing_fields).toBeDefined();
  });

  it('round 2 valid — returns success', () => {
    const result = handleRoundComplete({
      round: 2,
      blueprint: { discovery: validDiscovery, identity: validIdentity },
    });
    expect(result.result.success).toBe(true);
    expect(result.result.round).toBe(2);
  });

  it('round 2 missing identity — returns missing fields', () => {
    const result = handleRoundComplete({ round: 2, blueprint: { discovery: validDiscovery } });
    expect(result.result.success).toBe(false);
  });

  it('round 3 valid — returns finalization message', () => {
    const result = handleRoundComplete({
      round: 3,
      blueprint: { discovery: validDiscovery, identity: validIdentity, confirmed: validConfirmed },
    });
    expect(result.result.success).toBe(true);
    expect(result.result.message).toContain('finalized');
  });

  it('round 3 missing confirmed — returns missing fields', () => {
    const result = handleRoundComplete({
      round: 3,
      blueprint: { discovery: validDiscovery, identity: validIdentity },
    });
    expect(result.result.success).toBe(false);
  });

  it('invalid round number — returns error', () => {
    const result = handleRoundComplete({ round: 4, blueprint: { discovery: validDiscovery } });
    expect(result.result.success).toBe(false);
    expect(result.result.error).toBeDefined();
  });

  it('no blueprint — returns error', () => {
    const result = handleRoundComplete({ round: 1 });
    expect(result.result.success).toBe(false);
  });
});

// ── check_feasibility ─────────────────────────────────────

describe('check_feasibility', () => {
  it('returns redirect recommendation', () => {
    const result = handleCheckFeasibility({
      request: 'Custom CRM integration with Salesforce',
      concern: 'Complex OAuth + custom objects',
    });
    expect(result.result.feasible).toBe(true);
    expect(result.result.recommendation).toBe('redirect_to_followup');
  });

  it('empty request — returns error', () => {
    const result = handleCheckFeasibility({ request: '' });
    expect(result.result.error).toBe(true);
  });
});

// ── handleInterviewTool router ────────────────────────────

describe('handleInterviewTool', () => {
  it('routes round_complete correctly', () => {
    const result = handleInterviewTool('round_complete', { round: 1, blueprint: { discovery: validDiscovery } });
    expect(result.result.success).toBe(true);
  });

  it('routes check_feasibility correctly', () => {
    const result = handleInterviewTool('check_feasibility', { request: 'Custom API' });
    expect(result.result.recommendation).toBeDefined();
  });

  it('unknown tool — returns error', () => {
    const result = handleInterviewTool('nonexistent', {});
    expect(result.result.error).toBe(true);
  });
});

// ── Tool definitions ──────────────────────────────────────

describe('INTERVIEW_TOOLS', () => {
  it('exports 2 tool definitions', () => {
    expect(INTERVIEW_TOOLS).toHaveLength(2);
  });

  it('all tools have name, description, and parameters', () => {
    for (const tool of INTERVIEW_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });
});
