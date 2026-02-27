import type { QualificationSignals } from '../types.js';

/**
 * Scores explicit qualification signals extracted by the LLM.
 * Returns explicit score (0-100) and fit score (0-100).
 */
export function scoreExplicit(signals: QualificationSignals | null): {
  explicit: number;
  fit: number;
  visitorInfo: QualificationSignals['visitor_info'] | null;
  conversationState: QualificationSignals['conversation_state'] | null;
} {
  if (!signals) {
    return { explicit: 0, fit: 0, visitorInfo: null, conversationState: null };
  }

  const q = signals.qualification;

  // Explicit score: average of all 6 dimensions, scaled to 0-100
  const dimensions = [
    q.problem_specificity,
    q.authority_level,
    q.timeline_urgency,
    q.need_alignment,
    q.budget_indicator,
    q.engagement_depth,
  ];
  const avgDimension = dimensions.reduce((sum, val) => sum + val, 0) / dimensions.length;
  const explicit = Math.round(avgDimension * 10); // 0-10 scale -> 0-100

  // Fit score: weighted combination of need_alignment, authority_level, budget_indicator
  const fit = Math.round(
    (q.need_alignment * 0.45 + q.authority_level * 0.30 + q.budget_indicator * 0.25) * 10
  );

  return {
    explicit: Math.min(100, explicit),
    fit: Math.min(100, fit),
    visitorInfo: signals.visitor_info,
    conversationState: signals.conversation_state,
  };
}
