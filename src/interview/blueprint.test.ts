import { describe, it, expect } from 'vitest';
import {
  DiscoverySchema,
  IdentitySchema,
  ConfirmedSchema,
  BlueprintSchema,
  validateAtRound,
} from './blueprint.js';

// ── Sample Data ───────────────────────────────────────────

const validDiscovery = {
  owner_name: 'Marcus',
  owner_about: 'Managing director at a real estate firm in Berlin. Spends mornings on email triage and team coordination.',
  domain: 'work',
  purpose: 'I want something that handles my morning routine so I can focus on the actual work.',
};

const validIdentity = {
  agent_name: 'Lena',
  gender: 'female' as const,
  personality_summary: 'Lena is a calm, organized partner who keeps things running while Marcus focuses on the big picture. She is warm but efficient — the kind who flags a scheduling conflict before you even notice it. Professional and thoughtful, with just enough dry humor to make Monday mornings bearable.',
  personality_traits: ['organized', 'warm', 'efficient', 'dry humor'],
  communication_style: 'Professional but approachable. Brief and clear, never robotic. Adds a light touch when appropriate.',
  archetype: 'Pepper Potts energy — competent, warm, occasionally wry',
  visual_description: 'Early 30s professional woman, smart casual style, warm expression, approachable and confident.',
  primary_channel: 'Telegram',
  languages: ['German', 'English'],
};

const validConfirmed = {
  playback_text: 'Here\'s who I\'ve designed for you: Lena is a calm, organized partner who keeps things running while you focus on the big picture. She\'s warm but efficient — the kind who\'d flag a scheduling conflict before you even notice it. Professional, thoughtful, with just enough humor to make Monday mornings bearable. You\'ll reach her on Telegram, and she speaks German and English. Lena starts by getting to know your calendar, your priorities, and how you like to work. Over time she\'ll learn to handle your email triage, prep your meetings, and keep your tasks on track. She grows with you. Sound right?',
  approved: true as const,
  adjustments: ['Make her a bit more direct — less softening when things go wrong'],
};

// ── Individual Schema Tests ───────────────────────────────

describe('DiscoverySchema', () => {
  it('accepts valid discovery data', () => {
    expect(DiscoverySchema.safeParse(validDiscovery).success).toBe(true);
  });

  it('rejects empty owner_name', () => {
    expect(DiscoverySchema.safeParse({ ...validDiscovery, owner_name: '' }).success).toBe(false);
  });

  it('rejects missing purpose', () => {
    const { purpose: _, ...noPurpose } = validDiscovery;
    expect(DiscoverySchema.safeParse(noPurpose).success).toBe(false);
  });

  it('rejects empty domain', () => {
    expect(DiscoverySchema.safeParse({ ...validDiscovery, domain: '' }).success).toBe(false);
  });
});

describe('IdentitySchema', () => {
  it('accepts valid identity data', () => {
    expect(IdentitySchema.safeParse(validIdentity).success).toBe(true);
  });

  it('rejects empty agent_name', () => {
    expect(IdentitySchema.safeParse({ ...validIdentity, agent_name: '' }).success).toBe(false);
  });

  it('rejects invalid gender', () => {
    expect(IdentitySchema.safeParse({ ...validIdentity, gender: 'other' }).success).toBe(false);
  });

  it('rejects empty personality_traits', () => {
    expect(IdentitySchema.safeParse({ ...validIdentity, personality_traits: [] }).success).toBe(false);
  });

  it('rejects empty languages', () => {
    expect(IdentitySchema.safeParse({ ...validIdentity, languages: [] }).success).toBe(false);
  });

  it('accepts null archetype', () => {
    expect(IdentitySchema.safeParse({ ...validIdentity, archetype: null }).success).toBe(true);
  });

  it('rejects missing personality_summary', () => {
    const { personality_summary: _, ...noSummary } = validIdentity;
    expect(IdentitySchema.safeParse(noSummary).success).toBe(false);
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
    const full = { discovery: validDiscovery, identity: validIdentity, confirmed: validConfirmed };
    expect(BlueprintSchema.safeParse(full).success).toBe(true);
  });

  it('accepts a partial Blueprint (discovery only)', () => {
    expect(BlueprintSchema.safeParse({ discovery: validDiscovery }).success).toBe(true);
  });

  it('accepts discovery + identity (rounds 1-2)', () => {
    expect(BlueprintSchema.safeParse({ discovery: validDiscovery, identity: validIdentity }).success).toBe(true);
  });

  it('rejects Blueprint with no discovery', () => {
    expect(BlueprintSchema.safeParse({ identity: validIdentity }).success).toBe(false);
  });
});

// ── Progressive Validation ────────────────────────────────

describe('validateAtRound', () => {
  const fullBlueprint = { discovery: validDiscovery, identity: validIdentity, confirmed: validConfirmed };

  it('round 1: accepts discovery only', () => {
    expect(validateAtRound({ discovery: validDiscovery }, 1).success).toBe(true);
  });

  it('round 1: rejects if discovery is missing', () => {
    expect(validateAtRound({}, 1).success).toBe(false);
  });

  it('round 1: rejects if identity is present (too early)', () => {
    expect(validateAtRound({ discovery: validDiscovery, identity: validIdentity }, 1).success).toBe(false);
  });

  it('round 2: accepts discovery + identity', () => {
    expect(validateAtRound({ discovery: validDiscovery, identity: validIdentity }, 2).success).toBe(true);
  });

  it('round 2: rejects if identity is missing', () => {
    expect(validateAtRound({ discovery: validDiscovery }, 2).success).toBe(false);
  });

  it('round 3: accepts full Blueprint', () => {
    expect(validateAtRound(fullBlueprint, 3).success).toBe(true);
  });

  it('round 3: rejects if confirmed is missing', () => {
    expect(validateAtRound({ discovery: validDiscovery, identity: validIdentity }, 3).success).toBe(false);
  });

  it('round 3: rejects if confirmed.approved is not true', () => {
    expect(validateAtRound({
      ...fullBlueprint,
      confirmed: { ...validConfirmed, approved: false },
    }, 3).success).toBe(false);
  });
});
