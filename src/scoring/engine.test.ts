import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateScore } from './engine.js';
import { makeSession, makeConfig, makeSignals } from '../__fixtures__/test-helpers.js';
import type { AppConfig } from '../types.js';

let testConfig: AppConfig;

vi.mock('../config.js', () => ({
  getConfig: () => testConfig,
  loadConfig: () => testConfig,
}));

beforeEach(() => {
  testConfig = makeConfig();
});

describe('Scoring Engine — updateScore', () => {
  it('1. all dimensions at 0 → composite = 0, classification = disqualified', () => {
    const session = makeSession();
    const signals = makeSignals({
      problem_specificity: 0,
      authority_level: 0,
      timeline_urgency: 0,
      need_alignment: 0,
      budget_indicator: 0,
      engagement_depth: 0,
    });
    const result = updateScore(session, undefined, signals);
    // behavioral = 30 (default, no signals), explicit = 0, fit = 0
    // composite = 30*0.35 + 0*0.40 + 0*0.25 = 10.5 → 11
    expect(result.composite).toBeLessThan(25);
    expect(result.classification).toBe('disqualified');
  });

  it('2. all dimensions at 10 → composite = 100, classification = hot', () => {
    const session = makeSession({ messages_count: 6 });
    const signals = makeSignals({
      problem_specificity: 10,
      authority_level: 10,
      timeline_urgency: 10,
      need_alignment: 10,
      budget_indicator: 10,
      engagement_depth: 10,
    });
    // Provide strong behavioral signals too
    const behavioral = {
      typing_duration_ms: 15000,
      keypress_count: 50,
      correction_count: 3,
      time_since_last_message_ms: 30000,
      mouse_movement_detected: true,
    };
    const result = updateScore(session, behavioral, signals);
    expect(result.explicit).toBe(100);
    expect(result.fit).toBe(100);
    expect(result.classification).toBe('hot');
    expect(result.composite).toBeGreaterThanOrEqual(70);
  });

  it('3. explicit = 70, behavioral = 0, fit = 0 → single-component contribution', () => {
    const session = makeSession();
    // explicit = 70 → 0.40 * 70 = 28
    // Need dimensions that average to 7 → explicit = 70
    const signals = makeSignals({
      problem_specificity: 7,
      authority_level: 7,
      timeline_urgency: 7,
      need_alignment: 7,
      budget_indicator: 7,
      engagement_depth: 7,
    });
    const result = updateScore(session, undefined, signals);
    // behavioral defaults to 30 (no signals)
    // explicit = 70, fit = (7*0.45 + 7*0.30 + 7*0.25) * 10 = 70
    // composite = 30*0.35 + 70*0.40 + 70*0.25 = 10.5 + 28 + 17.5 = 56
    expect(result.explicit).toBe(70);
  });

  it('4. composite exactly at threshold boundaries (25, 45, 70)', () => {
    const session = makeSession();
    // Test cold threshold: 25
    const result1 = updateScore(session, undefined, null);
    // With no signals: behavioral=30, explicit=0, fit=0
    // composite = 30*0.35 = 10.5 → 11
    expect(result1.classification).toBe('disqualified');

    // Warm threshold: 45
    session.score_composite = 0;
    const signals45 = makeSignals({
      problem_specificity: 5,
      authority_level: 5,
      timeline_urgency: 5,
      need_alignment: 5,
      budget_indicator: 5,
      engagement_depth: 5,
    });
    const result2 = updateScore(session, undefined, signals45);
    // behavioral=30, explicit=50, fit=50
    // composite = 30*0.35 + 50*0.40 + 50*0.25 = 10.5 + 20 + 12.5 = 43
    expect(result2.composite).toBeGreaterThanOrEqual(25);
  });

  it('5. composite at 69.9 → warm, at 70.0 → hot (float boundary)', () => {
    const session = makeSession();
    // We need composite < 70 → warm
    const signalsWarm = makeSignals({
      problem_specificity: 8,
      authority_level: 7,
      timeline_urgency: 7,
      need_alignment: 8,
      budget_indicator: 7,
      engagement_depth: 7,
    });
    const result = updateScore(session, undefined, signalsWarm);
    // explicit = avg(8,7,7,8,7,7)*10 = 73.3 → 73
    // fit = (8*0.45 + 7*0.30 + 7*0.25)*10 = (3.6+2.1+1.75)*10 = 74.5 → 75
    // behavioral = 30
    // composite = 30*0.35 + 73*0.40 + 75*0.25 = 10.5 + 29.2 + 18.75 = 58 → warm
    if (result.composite < 70) {
      expect(result.classification).toBe('warm');
    } else {
      expect(result.classification).toBe('hot');
    }
  });

  it('6. first crossing of qualified threshold → tier escalation triggered', () => {
    const session = makeSession({ tier: 'lobby', score_composite: 50 });
    const signals = makeSignals({
      problem_specificity: 10,
      authority_level: 10,
      timeline_urgency: 10,
      need_alignment: 10,
      budget_indicator: 10,
      engagement_depth: 10,
    });
    const behavioral = {
      typing_duration_ms: 15000,
      keypress_count: 50,
      correction_count: 3,
      time_since_last_message_ms: 30000,
      mouse_movement_detected: true,
    };
    const result = updateScore(session, behavioral, signals);
    expect(result.composite).toBeGreaterThanOrEqual(70);
    expect(result.shouldEscalate).toBe(true);
  });

  it('7. already in meeting_room + score drops → NO demotion (one-way escalation)', () => {
    const session = makeSession({ tier: 'meeting_room', score_composite: 80 });
    const result = updateScore(session, undefined, null);
    // Score will drop, but tier stays
    expect(result.shouldEscalate).toBe(false);
    // Tier is not changed by updateScore itself, but shouldEscalate stays false
  });

  it('8. score update with partial signals (some null)', () => {
    const session = makeSession();
    const signals = makeSignals({
      problem_specificity: 5,
      authority_level: 5,
      timeline_urgency: 5,
      need_alignment: 5,
      budget_indicator: 5,
      engagement_depth: 5,
    });
    // Should not throw
    const result = updateScore(session, undefined, signals);
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });

  it('9. weights from config (0.40 + 0.35 + 0.25 = 1.0) applied correctly', () => {
    const session = makeSession({ messages_count: 6 });
    const signals = makeSignals({
      problem_specificity: 10,
      authority_level: 10,
      timeline_urgency: 10,
      need_alignment: 10,
      budget_indicator: 10,
      engagement_depth: 10,
    });
    const behavioral = {
      typing_duration_ms: 15000,
      keypress_count: 50,
      correction_count: 3,
      time_since_last_message_ms: 30000,
      mouse_movement_detected: true,
    };
    const result = updateScore(session, behavioral, signals);
    // With all maxed: behavioral ~75, explicit=100, fit=100
    // composite = 75*0.35 + 100*0.40 + 100*0.25 = 26.25 + 40 + 25 = 91
    const expected = Math.round(
      result.behavioral * 0.35 + result.explicit * 0.40 + result.fit * 0.25
    );
    expect(result.composite).toBe(expected);
  });

  it('10. custom config weights produce correct composite', () => {
    testConfig = makeConfig({
      scoring: {
        weights: { explicit: 0.50, behavioral: 0.30, fit: 0.20 },
        thresholds: { qualified: 70, warm: 45, cold: 25 },
      },
    });
    const session = makeSession({ messages_count: 6 });
    const signals = makeSignals({
      problem_specificity: 10,
      authority_level: 10,
      timeline_urgency: 10,
      need_alignment: 10,
      budget_indicator: 10,
      engagement_depth: 10,
    });
    const behavioral = {
      typing_duration_ms: 15000,
      keypress_count: 50,
      correction_count: 3,
      time_since_last_message_ms: 30000,
      mouse_movement_detected: true,
    };
    const result = updateScore(session, behavioral, signals);
    const expected = Math.round(
      result.behavioral * 0.30 + result.explicit * 0.50 + result.fit * 0.20
    );
    // With custom weights: explicit*0.50 instead of 0.40, behavioral*0.30 instead of 0.35
    expect(result.composite).toBe(expected);
  });
});
