import { describe, it, expect } from 'vitest';
import { scoreBehavioral } from './behavioral.js';

describe('Behavioral Scoring — scoreBehavioral', () => {
  it('1. no signals → default score = 30', () => {
    expect(scoreBehavioral(undefined, 0)).toBe(30);
  });

  it('2. typing_duration_ms = 500 → 10 (bot-like)', () => {
    const score = scoreBehavioral({ typing_duration_ms: 500 }, 0);
    // factors: typing=10, message_count=0 (no bonus, but factors++ → 0 bonus)
    // score = (10 + 0) / 2 = 5
    expect(score).toBeLessThanOrEqual(15);
  });

  it('3. typing_duration_ms = 2000 → 40 (quick)', () => {
    const score = scoreBehavioral({ typing_duration_ms: 2000 }, 0);
    // (40 + 0) / 2 = 20
    expect(score).toBeGreaterThanOrEqual(15);
    expect(score).toBeLessThanOrEqual(30);
  });

  it('4. typing_duration_ms = 15000 → 70 (normal)', () => {
    const score = scoreBehavioral({ typing_duration_ms: 15000 }, 0);
    // (70 + 0) / 2 = 35
    expect(score).toBeGreaterThanOrEqual(30);
  });

  it('5. typing_duration_ms = 45000 → 85 (thoughtful)', () => {
    const score = scoreBehavioral({ typing_duration_ms: 45000 }, 0);
    // (85 + 0) / 2 = 43
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it('6. typing_duration_ms = 90000 → 95 (very thoughtful)', () => {
    const score = scoreBehavioral({ typing_duration_ms: 90000 }, 0);
    // (95 + 0) / 2 = 48
    expect(score).toBeGreaterThanOrEqual(45);
  });

  it('7. keypress_count = 3 → 15 (minimal)', () => {
    const score = scoreBehavioral({ keypress_count: 3 }, 0);
    // (15 + 0) / 2 = 8
    expect(score).toBeLessThanOrEqual(15);
  });

  it('8. keypress_count = 50 → 65 (moderate)', () => {
    const score = scoreBehavioral({ keypress_count: 50 }, 0);
    // (65 + 0) / 2 = 33
    expect(score).toBeGreaterThanOrEqual(25);
  });

  it('9. correction_count = 0 → 40 (ambiguous)', () => {
    const score = scoreBehavioral({ correction_count: 0 }, 0);
    // (40 + 0) / 2 = 20
    expect(score).toBeLessThanOrEqual(30);
  });

  it('10. correction_count = 3 → 75 (very human)', () => {
    const score = scoreBehavioral({ correction_count: 3 }, 0);
    // (75 + 0) / 2 = 38
    expect(score).toBeGreaterThanOrEqual(30);
  });

  it('11. correction_count = 20 → 30 (excessive)', () => {
    const score = scoreBehavioral({ correction_count: 20 }, 0);
    // (30 + 0) / 2 = 15
    expect(score).toBeLessThanOrEqual(25);
  });

  it('12. time_since_last_message_ms = 1000 → 20 (too fast)', () => {
    const score = scoreBehavioral({ time_since_last_message_ms: 1000 }, 0);
    // (20 + 0) / 2 = 10
    expect(score).toBeLessThanOrEqual(15);
  });

  it('13. time_since_last_message_ms = 30000 → 80 (thoughtful)', () => {
    const score = scoreBehavioral({ time_since_last_message_ms: 30000 }, 0);
    // (80 + 0) / 2 = 40
    expect(score).toBeGreaterThanOrEqual(35);
  });

  it('14. time_since_last_message_ms = 300000 → 20 (disengaged)', () => {
    const score = scoreBehavioral({ time_since_last_message_ms: 300000 }, 0);
    // (20 + 0) / 2 = 10
    expect(score).toBeLessThanOrEqual(15);
  });

  it('15. mouse_movement_detected = true → 70', () => {
    const score = scoreBehavioral({ mouse_movement_detected: true }, 0);
    // (70 + 0) / 2 = 35
    expect(score).toBeGreaterThanOrEqual(30);
  });

  it('16. mouse_movement_detected = false → 30', () => {
    const score = scoreBehavioral({ mouse_movement_detected: false }, 0);
    // (30 + 0) / 2 = 15
    expect(score).toBeLessThanOrEqual(20);
  });

  it('17. message_count >= 5 → +20 bonus', () => {
    const withBonus = scoreBehavioral({ typing_duration_ms: 15000 }, 5);
    const without = scoreBehavioral({ typing_duration_ms: 15000 }, 1);
    expect(withBonus).toBeGreaterThan(without);
  });

  it('18. message_count = 3 → +10 bonus', () => {
    const with3 = scoreBehavioral({ typing_duration_ms: 15000 }, 3);
    const with1 = scoreBehavioral({ typing_duration_ms: 15000 }, 1);
    expect(with3).toBeGreaterThan(with1);
  });

  it('19. all signals present → weighted average of all 6 factors', () => {
    const score = scoreBehavioral({
      typing_duration_ms: 15000,   // 70
      keypress_count: 50,           // 65
      correction_count: 3,          // 75
      time_since_last_message_ms: 30000, // 80
      mouse_movement_detected: true, // 70
    }, 5);                           // +20
    // avg = (70 + 65 + 75 + 80 + 70 + 20) / 6 = 380/6 = 63.3 → 63
    expect(score).toBeGreaterThanOrEqual(55);
    expect(score).toBeLessThanOrEqual(75);
  });

  it('20. partial signals (only typing + mouse) → average of present factors', () => {
    const score = scoreBehavioral({
      typing_duration_ms: 15000,    // 70
      mouse_movement_detected: true, // 70
    }, 0);                           // 0 (message_count < 3)
    // factors = 3 (typing, mouse, messageCount)
    // score = (70 + 70 + 0) / 3 = 46.7 → 47
    expect(score).toBeGreaterThanOrEqual(40);
    expect(score).toBeLessThanOrEqual(55);
  });
});
