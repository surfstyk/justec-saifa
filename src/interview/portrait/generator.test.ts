import { describe, it, expect } from 'vitest';
import { buildPortraitPrompt } from './generator.js';
import type { Blueprint } from '../blueprint.js';

const sampleBlueprint: Blueprint = {
  seed: {
    domain: 'Real estate',
    purpose: 'Morning briefing agent that triages email and calendar',
    identity: { prospect_name: 'Marcus', company: 'Berlin Properties', role: 'MD', industry: 'Real estate' },
    complexity_signal: 'moderate',
    raw_needs: 'Morning email triage',
  },
  shape: {
    inputs: [{ source: 'Gmail', description: 'Inbox' }],
    logic: { autonomous_actions: ['Categorize'], approval_required: ['Send'] },
    output: { channels: ['Telegram'], audience: 'Marcus' },
    rhythm: { schedule: 'Daily at 06:00' },
    language: { primary: 'German' },
    budget: { ceiling: null, sensitivity: 'not_discussed' },
  },
  gaps: {
    failure_handling: { strategy: 'Retry', escalation: 'Alert' },
    safety_rails: [{ rule: 'No sends' }],
    persona: { style: 'Professional but warm', traits: ['Direct', 'Organized'] },
    agent_name: 'Elena Vasquez',
  },
};

describe('buildPortraitPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes studio photography style anchors', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toContain('studio');
    expect(prompt).toContain('white');
    expect(prompt).toContain('1024x1024');
  });

  it('includes seafoam accent', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toContain('seafoam');
  });

  it('includes expression based on persona traits', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    // 'Direct' + 'Organized' traits should map to confident/composed
    expect(prompt).toMatch(/confident|composed|warm/i);
  });

  it('infers personal_assistant role from purpose', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    // personal_assistant gets a tablet prop
    expect(prompt).toContain('tablet');
  });

  it('produces different prompts for different agent names', () => {
    const blueprint2 = {
      ...sampleBlueprint,
      gaps: { ...sampleBlueprint.gaps!, agent_name: 'Carlos Rivera' },
    };
    const p1 = buildPortraitPrompt(sampleBlueprint);
    const p2 = buildPortraitPrompt(blueprint2);
    // Demographics vary by name hash, so prompts should differ
    expect(p1).not.toBe(p2);
  });

  it('handles blueprint without gaps (seed only)', () => {
    const minimal: Blueprint = {
      seed: sampleBlueprint.seed,
    };
    const prompt = buildPortraitPrompt(minimal);
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('studio');
  });

  it('maps market analyst role to glasses/charts', () => {
    const tradingBlueprint: Blueprint = {
      seed: { ...sampleBlueprint.seed, purpose: 'Market analytics and trading signals' },
      gaps: { ...sampleBlueprint.gaps!, agent_name: 'KongQuant' },
    };
    const prompt = buildPortraitPrompt(tradingBlueprint);
    expect(prompt).toMatch(/chart|glasses/i);
  });
});
