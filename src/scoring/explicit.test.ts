import { describe, it, expect } from 'vitest';
import { scoreExplicit } from './explicit.js';
import type { QualificationSignals } from '../types.js';

function makeQ(overrides: Partial<QualificationSignals['qualification']> = {}): QualificationSignals {
  return {
    qualification: {
      problem_specificity: 0,
      authority_level: 0,
      timeline_urgency: 0,
      need_alignment: 0,
      budget_indicator: 0,
      engagement_depth: 0,
      ...overrides,
    },
    visitor_info: { name: null, company: null, role: null, company_size: null, industry: null, language: 'en' },
    conversation_state: { intent: 'exploring', buying_signals: [], disqualification_signals: [], recommended_action: 'continue_discovery' },
  };
}

describe('Explicit Scoring — scoreExplicit', () => {
  it('1. all 6 dimensions at 5 → score = 50', () => {
    const result = scoreExplicit(makeQ({
      problem_specificity: 5, authority_level: 5, timeline_urgency: 5,
      need_alignment: 5, budget_indicator: 5, engagement_depth: 5,
    }));
    expect(result.explicit).toBe(50);
  });

  it('2. all dimensions at 0 → score = 0', () => {
    const result = scoreExplicit(makeQ());
    expect(result.explicit).toBe(0);
  });

  it('3. all dimensions at 10 → score = 100', () => {
    const result = scoreExplicit(makeQ({
      problem_specificity: 10, authority_level: 10, timeline_urgency: 10,
      need_alignment: 10, budget_indicator: 10, engagement_depth: 10,
    }));
    expect(result.explicit).toBe(100);
  });

  it('4. mixed values → correct average × 10', () => {
    // (0 + 3 + 5 + 8 + 10 + 7) / 6 = 33/6 = 5.5 → 55
    const result = scoreExplicit(makeQ({
      problem_specificity: 0, authority_level: 3, timeline_urgency: 5,
      need_alignment: 8, budget_indicator: 10, engagement_depth: 7,
    }));
    expect(result.explicit).toBe(55);
  });

  it('5. dimension value > 10 → contributes as-is (no clamping in scoreExplicit)', () => {
    // The code does Math.min(100, result) at the end
    const result = scoreExplicit(makeQ({
      problem_specificity: 15, authority_level: 10, timeline_urgency: 10,
      need_alignment: 10, budget_indicator: 10, engagement_depth: 10,
    }));
    // avg = (15+10+10+10+10+10)/6 = 65/6 = 10.83 → 108 → capped at 100
    expect(result.explicit).toBeLessThanOrEqual(100);
  });

  it('6. null signals → explicit = 0', () => {
    const result = scoreExplicit(null);
    expect(result.explicit).toBe(0);
    expect(result.fit).toBe(0);
    expect(result.visitorInfo).toBeNull();
    expect(result.conversationState).toBeNull();
  });

  it('7. fit score weighted correctly (need_alignment × 0.45 + authority × 0.30 + budget × 0.25)', () => {
    const result = scoreExplicit(makeQ({
      problem_specificity: 0, authority_level: 10, timeline_urgency: 0,
      need_alignment: 10, budget_indicator: 10, engagement_depth: 0,
    }));
    // fit = (10*0.45 + 10*0.30 + 10*0.25) * 10 = (4.5 + 3 + 2.5) * 10 = 100
    expect(result.fit).toBe(100);
  });

  it('8. visitor info and conversation state passed through', () => {
    const signals: QualificationSignals = {
      qualification: {
        problem_specificity: 5, authority_level: 5, timeline_urgency: 5,
        need_alignment: 5, budget_indicator: 5, engagement_depth: 5,
      },
      visitor_info: { name: 'Test User', company: 'Acme', role: 'CEO', company_size: '50', industry: 'Tech', language: 'de' },
      conversation_state: { intent: 'evaluating', buying_signals: ['asked_about_process'], disqualification_signals: [], recommended_action: 'offer_booking' },
    };
    const result = scoreExplicit(signals);
    expect(result.visitorInfo?.name).toBe('Test User');
    expect(result.conversationState?.intent).toBe('evaluating');
  });
});
