import type { BehavioralSignals } from '../types.js';

/**
 * Scores behavioral signals from the frontend.
 * Returns a score from 0-100 based on human-like engagement patterns.
 */
export function scoreBehavioral(signals: BehavioralSignals | undefined, messageCount: number): number {
  if (!signals) return 30; // Default neutral score when no signals provided

  let score = 0;
  let factors = 0;

  // Typing duration: realistic typing indicates human engagement
  // < 1s = suspicious (bot), 3-30s = normal, > 60s = thoughtful
  if (signals.typing_duration_ms !== undefined) {
    const duration = signals.typing_duration_ms;
    if (duration < 1000) score += 10;
    else if (duration < 3000) score += 40;
    else if (duration < 30000) score += 70;
    else if (duration < 60000) score += 85;
    else score += 95;
    factors++;
  }

  // Keypress count: more keypresses with corrections = more human
  if (signals.keypress_count !== undefined) {
    const keypresses = signals.keypress_count;
    if (keypresses < 5) score += 15;
    else if (keypresses < 20) score += 40;
    else if (keypresses < 80) score += 65;
    else score += 80;
    factors++;
  }

  // Corrections: some corrections are normal human behavior
  if (signals.correction_count !== undefined) {
    const corrections = signals.correction_count;
    if (corrections === 0) score += 40; // No corrections — could be either
    else if (corrections <= 5) score += 75; // Normal corrections — very human
    else if (corrections <= 15) score += 60; // Many corrections — still human
    else score += 30; // Excessive — might be paste/edit
    factors++;
  }

  // Time since last message: engaged visitors respond in 5-60s
  if (signals.time_since_last_message_ms !== undefined) {
    const gap = signals.time_since_last_message_ms;
    if (gap < 2000) score += 20; // Too fast — suspicious
    else if (gap < 10000) score += 60; // Quick but reasonable
    else if (gap < 60000) score += 80; // Thoughtful response
    else if (gap < 180000) score += 50; // Slow but still engaged
    else score += 20; // Very long gap
    factors++;
  }

  // Mouse movement: basic human indicator
  if (signals.mouse_movement_detected !== undefined) {
    score += signals.mouse_movement_detected ? 70 : 30;
    factors++;
  }

  // Message count progression bonus (engagement over time)
  if (messageCount >= 5) score += 20;
  else if (messageCount >= 3) score += 10;
  factors++;

  return factors > 0 ? Math.min(100, Math.round(score / factors)) : 30;
}
