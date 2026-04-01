import { describe, it, expect } from 'vitest';
import {
  SeedSchema,
  ShapeSchema,
  GapsSchema,
  ConfirmedSchema,
  BlueprintSchema,
  validateAtRound,
} from './blueprint.js';

// ── Sample Data ───────────────────────────────────────────

const validSeed = {
  domain: 'Real estate',
  purpose: 'Morning briefing agent that triages email and calendar for a real estate team',
  identity: {
    prospect_name: 'Marcus',
    company: 'Berlin Properties GmbH',
    role: 'Managing Director',
    industry: 'Real estate',
  },
  complexity_signal: 'moderate' as const,
  raw_needs: 'I spend 2 hours every morning triaging emails and checking what my team needs. I want something that does that for me before I even open my laptop.',
};

const validShape = {
  inputs: [
    { source: 'Gmail', description: 'Email inbox — triage by priority and topic' },
    { source: 'Google Calendar', description: 'Today\'s schedule and upcoming deadlines' },
    { source: 'Trello', description: 'Team task board for status updates' },
  ],
  logic: {
    autonomous_actions: ['Categorize emails by urgency', 'Flag overdue tasks', 'Draft daily summary'],
    approval_required: ['Send replies on behalf of Marcus', 'Reschedule meetings'],
  },
  output: {
    channels: ['Telegram'],
    audience: 'Marcus only',
  },
  rhythm: {
    schedule: 'Daily at 06:00 CET',
    specific_times: ['06:00'],
  },
  language: {
    primary: 'German',
    additional: ['English'],
  },
  budget: {
    ceiling: '50 EUR/month',
    sensitivity: 'value_focused' as const,
  },
  existing_assets: ['Gmail API access', 'Trello API key'],
};

const validGaps = {
  failure_handling: {
    strategy: 'Retry once, then send a Telegram alert saying the briefing could not be completed',
    escalation: 'If email API is unreachable for more than 2 hours, alert Marcus directly',
  },
  safety_rails: [
    { rule: 'Never send emails without explicit approval', rationale: 'Marcus wants full control of outbound communication' },
    { rule: 'Never access financial data', rationale: 'Separate system, separate agent' },
  ],
  persona: {
    style: 'Professional but warm, brief and to the point',
    traits: ['Direct', 'Organized', 'Calm under pressure'],
  },
  agent_name: 'Elena Vasquez',
  additional_needs: ['Weekly Friday summary at 17:00'],
};

const validConfirmed = {
  playback_text: 'So here\'s what we\'ve designed: Elena Vasquez will wake up at 6 AM every morning, check your Gmail, Calendar, and Trello, and send you a structured briefing on Telegram before you even open your laptop. She\'ll categorize your emails, flag overdue tasks, and draft a daily summary. She won\'t send any emails on your behalf without your say-so. On Fridays, she\'ll add a weekly wrap-up. Sound right?',
  approved: true as const,
  adjustments: ['Add a Slack notification option for urgent items'],
};

// ── Individual Schema Tests ───────────────────────────────

describe('SeedSchema', () => {
  it('accepts valid seed data', () => {
    expect(SeedSchema.safeParse(validSeed).success).toBe(true);
  });

  it('rejects empty domain', () => {
    expect(SeedSchema.safeParse({ ...validSeed, domain: '' }).success).toBe(false);
  });

  it('rejects missing purpose', () => {
    const { purpose: _, ...noProps } = validSeed;
    expect(SeedSchema.safeParse(noProps).success).toBe(false);
  });

  it('accepts null identity fields', () => {
    const result = SeedSchema.safeParse({
      ...validSeed,
      identity: { prospect_name: null, company: null, role: null, industry: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid complexity_signal', () => {
    expect(SeedSchema.safeParse({ ...validSeed, complexity_signal: 'easy' }).success).toBe(false);
  });
});

describe('ShapeSchema', () => {
  it('accepts valid shape data', () => {
    expect(ShapeSchema.safeParse(validShape).success).toBe(true);
  });

  it('rejects empty inputs array', () => {
    expect(ShapeSchema.safeParse({ ...validShape, inputs: [] }).success).toBe(false);
  });

  it('rejects empty channels', () => {
    expect(ShapeSchema.safeParse({
      ...validShape,
      output: { channels: [], audience: 'Marcus' },
    }).success).toBe(false);
  });

  it('accepts minimal shape without optional fields', () => {
    const minimal = {
      inputs: [{ source: 'API', description: 'Main data source' }],
      logic: { autonomous_actions: [], approval_required: [] },
      output: { channels: ['Email'], audience: 'Team' },
      rhythm: { schedule: 'Daily' },
      language: { primary: 'English' },
      budget: { ceiling: null, sensitivity: 'not_discussed' as const },
    };
    expect(ShapeSchema.safeParse(minimal).success).toBe(true);
  });
});

describe('GapsSchema', () => {
  it('accepts valid gaps data', () => {
    expect(GapsSchema.safeParse(validGaps).success).toBe(true);
  });

  it('rejects empty agent_name', () => {
    expect(GapsSchema.safeParse({ ...validGaps, agent_name: '' }).success).toBe(false);
  });

  it('accepts safety_rails without rationale', () => {
    const result = GapsSchema.safeParse({
      ...validGaps,
      safety_rails: [{ rule: 'No external API calls' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('ConfirmedSchema', () => {
  it('accepts valid confirmed data', () => {
    expect(ConfirmedSchema.safeParse(validConfirmed).success).toBe(true);
  });

  it('rejects approved: false', () => {
    expect(ConfirmedSchema.safeParse({ ...validConfirmed, approved: false }).success).toBe(false);
  });

  it('rejects empty playback_text', () => {
    expect(ConfirmedSchema.safeParse({ ...validConfirmed, playback_text: '' }).success).toBe(false);
  });
});

// ── Full Blueprint Tests ──────────────────────────────────

describe('BlueprintSchema', () => {
  it('accepts a full Blueprint with all rounds', () => {
    const full = { seed: validSeed, shape: validShape, gaps: validGaps, confirmed: validConfirmed };
    expect(BlueprintSchema.safeParse(full).success).toBe(true);
  });

  it('accepts a partial Blueprint (seed only)', () => {
    expect(BlueprintSchema.safeParse({ seed: validSeed }).success).toBe(true);
  });

  it('accepts seed + shape (rounds 1-2)', () => {
    expect(BlueprintSchema.safeParse({ seed: validSeed, shape: validShape }).success).toBe(true);
  });

  it('rejects Blueprint with no seed', () => {
    expect(BlueprintSchema.safeParse({ shape: validShape }).success).toBe(false);
  });
});

// ── Progressive Validation ────────────────────────────────

describe('validateAtRound', () => {
  const fullBlueprint = { seed: validSeed, shape: validShape, gaps: validGaps, confirmed: validConfirmed };

  it('round 1: accepts seed only', () => {
    expect(validateAtRound({ seed: validSeed }, 1).success).toBe(true);
  });

  it('round 1: rejects if seed is missing', () => {
    expect(validateAtRound({}, 1).success).toBe(false);
  });

  it('round 1: rejects if shape is present (too early)', () => {
    expect(validateAtRound({ seed: validSeed, shape: validShape }, 1).success).toBe(false);
  });

  it('round 2: accepts seed + shape', () => {
    expect(validateAtRound({ seed: validSeed, shape: validShape }, 2).success).toBe(true);
  });

  it('round 2: rejects if shape is missing', () => {
    expect(validateAtRound({ seed: validSeed }, 2).success).toBe(false);
  });

  it('round 3: accepts seed + shape + gaps', () => {
    expect(validateAtRound({ seed: validSeed, shape: validShape, gaps: validGaps }, 3).success).toBe(true);
  });

  it('round 3: rejects if gaps is missing', () => {
    expect(validateAtRound({ seed: validSeed, shape: validShape }, 3).success).toBe(false);
  });

  it('round 4: accepts full Blueprint', () => {
    expect(validateAtRound(fullBlueprint, 4).success).toBe(true);
  });

  it('round 4: rejects if confirmed is missing', () => {
    expect(validateAtRound({ seed: validSeed, shape: validShape, gaps: validGaps }, 4).success).toBe(false);
  });

  it('round 4: rejects if confirmed.approved is not true', () => {
    expect(validateAtRound({
      ...fullBlueprint,
      confirmed: { ...validConfirmed, approved: false },
    }, 4).success).toBe(false);
  });
});
