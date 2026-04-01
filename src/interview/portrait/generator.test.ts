import { describe, it, expect } from 'vitest';
import { buildPortraitPrompt } from './generator.js';
import type { Blueprint } from '../blueprint.js';

const sampleBlueprint: Blueprint = {
  discovery: {
    owner_name: 'Marcus',
    owner_about: 'Managing director at a real estate firm in Berlin. Spends mornings on email triage.',
    domain: 'work',
    purpose: 'Morning briefing that handles email triage and calendar for me',
  },
  identity: {
    agent_name: 'Lena',
    gender: 'female',
    personality_summary: 'Calm, organized partner who keeps things running. Warm but efficient, professional and thoughtful with dry humor.',
    personality_traits: ['organized', 'warm', 'efficient', 'direct'],
    communication_style: 'Professional but approachable, brief and clear',
    archetype: 'Pepper Potts energy',
    visual_description: 'Early 30s professional woman, smart casual style, warm expression, approachable and confident',
    primary_channel: 'Telegram',
    languages: ['German', 'English'],
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

  it('includes visual_description from identity', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toContain('Early 30s professional woman');
  });

  it('includes gender from identity', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toContain('A woman');
  });

  it('infers expression from personality traits', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toMatch(/warm|approachable|confident/i);
  });

  it('infers personal_assistant role from purpose', () => {
    const prompt = buildPortraitPrompt(sampleBlueprint);
    expect(prompt).toContain('tablet');
  });

  it('handles blueprint without identity (discovery only)', () => {
    const minimal: Blueprint = {
      discovery: sampleBlueprint.discovery,
    };
    const prompt = buildPortraitPrompt(minimal);
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('studio');
  });

  it('maps fitness domain to athletic props', () => {
    const fitnessBlueprint: Blueprint = {
      discovery: {
        owner_name: 'Anna',
        owner_about: 'Marathon runner looking for training support',
        domain: 'fitness',
        purpose: 'Training coach that keeps me accountable',
      },
      identity: {
        agent_name: 'Coach Marco',
        gender: 'male',
        personality_summary: 'Tough, direct coach. Competitive and motivating.',
        personality_traits: ['tough', 'competitive', 'motivating'],
        communication_style: 'Direct, no-nonsense, high energy',
        archetype: null,
        visual_description: 'Athletic man in his mid-30s, fit build, confident stance',
        primary_channel: 'WhatsApp',
        languages: ['English'],
      },
    };
    const prompt = buildPortraitPrompt(fitnessBlueprint);
    expect(prompt).toMatch(/athletic|sport|fitness/i);
    expect(prompt).toContain('A man');
  });

  it('maps market analyst to charts/glasses', () => {
    const tradingBlueprint: Blueprint = {
      discovery: {
        owner_name: 'Kai',
        owner_about: 'Day trader',
        domain: 'work',
        purpose: 'Market analytics and trading signals',
      },
      identity: {
        agent_name: 'KongQuant',
        gender: 'neutral',
        personality_summary: 'Precise, analytical, data-driven',
        personality_traits: ['analytical', 'precise'],
        communication_style: 'Terse, numbers-first',
        archetype: null,
        visual_description: 'Sharp, composed, intellectual appearance',
        primary_channel: 'Telegram',
        languages: ['English'],
      },
    };
    const prompt = buildPortraitPrompt(tradingBlueprint);
    expect(prompt).toMatch(/chart|glasses/i);
  });
});
