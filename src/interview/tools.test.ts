import { describe, it, expect } from 'vitest';
import {
  handleRoundComplete,
  handleCheckCapabilities,
  handleEstimateCost,
  handleCheckFeasibility,
  handleInterviewTool,
  INTERVIEW_TOOLS,
} from './tools.js';

// ── Sample Blueprint data (reused from blueprint.test.ts) ─

const validSeed = {
  domain: 'Real estate',
  purpose: 'Morning briefing agent',
  identity: { prospect_name: 'Marcus', company: 'Berlin Properties', role: 'MD', industry: 'Real estate' },
  complexity_signal: 'moderate',
  raw_needs: 'I need help with morning email triage.',
};

const validShape = {
  inputs: [{ source: 'Gmail', description: 'Inbox triage' }],
  logic: { autonomous_actions: ['Categorize emails'], approval_required: ['Send replies'] },
  output: { channels: ['Telegram'], audience: 'Marcus only' },
  rhythm: { schedule: 'Daily at 06:00' },
  language: { primary: 'German' },
  budget: { ceiling: '50 EUR/month', sensitivity: 'value_focused' },
};

const validGaps = {
  failure_handling: { strategy: 'Retry then alert', escalation: 'Alert after 2h' },
  safety_rails: [{ rule: 'Never send emails without approval' }],
  persona: { style: 'Professional but warm' },
  agent_name: 'Elena Vasquez',
};

const validConfirmed = {
  playback_text: 'Elena Vasquez wakes up at 6 AM every morning...',
  approved: true,
  adjustments: [],
};

// ── round_complete ────────────────────────────────────────

describe('round_complete', () => {
  it('round 1 valid — returns success', () => {
    const result = handleRoundComplete({ round: 1, blueprint: { seed: validSeed } });
    expect(result.result.success).toBe(true);
    expect(result.result.round).toBe(1);
  });

  it('round 1 missing seed — returns missing fields', () => {
    const result = handleRoundComplete({ round: 1, blueprint: {} });
    expect(result.result.success).toBe(false);
    expect(result.result.missing_fields).toBeDefined();
  });

  it('round 2 valid — returns success', () => {
    const result = handleRoundComplete({
      round: 2,
      blueprint: { seed: validSeed, shape: validShape },
    });
    expect(result.result.success).toBe(true);
    expect(result.result.round).toBe(2);
  });

  it('round 2 missing shape — returns missing fields', () => {
    const result = handleRoundComplete({ round: 2, blueprint: { seed: validSeed } });
    expect(result.result.success).toBe(false);
  });

  it('round 3 valid — returns success', () => {
    const result = handleRoundComplete({
      round: 3,
      blueprint: { seed: validSeed, shape: validShape, gaps: validGaps },
    });
    expect(result.result.success).toBe(true);
  });

  it('round 4 valid — returns finalization message', () => {
    const result = handleRoundComplete({
      round: 4,
      blueprint: { seed: validSeed, shape: validShape, gaps: validGaps, confirmed: validConfirmed },
    });
    expect(result.result.success).toBe(true);
    expect(result.result.message).toContain('finalized');
  });

  it('round 4 missing confirmed — returns missing fields', () => {
    const result = handleRoundComplete({
      round: 4,
      blueprint: { seed: validSeed, shape: validShape, gaps: validGaps },
    });
    expect(result.result.success).toBe(false);
  });

  it('invalid round number — returns error', () => {
    const result = handleRoundComplete({ round: 5, blueprint: { seed: validSeed } });
    expect(result.result.success).toBe(false);
    expect(result.result.error).toBeDefined();
  });

  it('no blueprint — returns error', () => {
    const result = handleRoundComplete({ round: 1 });
    expect(result.result.success).toBe(false);
  });
});

// ── check_capabilities ────────────────────────────────────

describe('check_capabilities', () => {
  it('known capability (Gmail) — returns feasible with details', () => {
    const result = handleCheckCapabilities({ capability: 'Gmail', context: 'Read inbox' });
    expect(result.result.feasible).toBe(true);
    expect(result.result.complexity).toBeDefined();
    expect(result.result.notes).toBeDefined();
  });

  it('known capability (Telegram) — trivial complexity', () => {
    const result = handleCheckCapabilities({ capability: 'Telegram bot' });
    expect(result.result.feasible).toBe(true);
    expect(result.result.complexity).toBe('trivial');
  });

  it('known capability (WhatsApp) — custom complexity', () => {
    const result = handleCheckCapabilities({ capability: 'WhatsApp' });
    expect(result.result.feasible).toBe(true);
    expect(result.result.complexity).toBe('custom');
  });

  it('unknown capability — feasible but custom', () => {
    const result = handleCheckCapabilities({ capability: 'SAP ERP' });
    expect(result.result.feasible).toBe(true);
    expect(result.result.complexity).toBe('custom');
    expect((result.result.notes as string)).toContain('custom development');
  });

  it('empty capability — returns error', () => {
    const result = handleCheckCapabilities({ capability: '' });
    expect(result.result.error).toBe(true);
  });
});

// ── estimate_cost ─────────────────────────────────────────

describe('estimate_cost', () => {
  it('simple daily agent — returns low range', () => {
    const result = handleEstimateCost({
      complexity: 'simple',
      integrations_count: 2,
      schedule_frequency: 'daily',
    });
    expect(result.result.range_eur).toBeDefined();
    const range = result.result.range_eur as { low: number; high: number };
    expect(range.low).toBeGreaterThan(0);
    expect(range.high).toBeGreaterThan(range.low);
  });

  it('complex realtime agent — returns high range', () => {
    const result = handleEstimateCost({
      complexity: 'complex',
      integrations_count: 5,
      schedule_frequency: 'realtime',
    });
    const range = result.result.range_eur as { low: number; high: number };
    expect(range.high).toBeGreaterThan(200);
  });

  it('includes internal-only note', () => {
    const result = handleEstimateCost({
      complexity: 'moderate',
      integrations_count: 1,
      schedule_frequency: 'daily',
    });
    expect((result.result.note as string)).toContain('NOT share');
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
    const result = handleInterviewTool('round_complete', { round: 1, blueprint: { seed: validSeed } });
    expect(result.result.success).toBe(true);
  });

  it('routes check_capabilities correctly', () => {
    const result = handleInterviewTool('check_capabilities', { capability: 'Telegram' });
    expect(result.result.feasible).toBe(true);
  });

  it('routes estimate_cost correctly', () => {
    const result = handleInterviewTool('estimate_cost', { complexity: 'simple', integrations_count: 1, schedule_frequency: 'daily' });
    expect(result.result.range_eur).toBeDefined();
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
  it('exports 4 tool definitions', () => {
    expect(INTERVIEW_TOOLS).toHaveLength(4);
  });

  it('all tools have name, description, and parameters', () => {
    for (const tool of INTERVIEW_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });
});
