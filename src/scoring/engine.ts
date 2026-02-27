import { getConfig } from '../config.js';
import { scoreBehavioral } from './behavioral.js';
import { scoreExplicit } from './explicit.js';
import type { Session, ScoreClassification, BehavioralSignals, QualificationSignals } from '../types.js';

export interface ScoreResult {
  composite: number;
  behavioral: number;
  explicit: number;
  fit: number;
  classification: ScoreClassification;
  shouldEscalate: boolean;
  recommendedAction: string | null;
}

export function updateScore(
  session: Session,
  behavioralSignals: BehavioralSignals | undefined,
  qualificationSignals: QualificationSignals | null,
): ScoreResult {
  const config = getConfig();
  const weights = config.scoring.weights;
  const thresholds = config.scoring.thresholds;

  // Score behavioral component
  const behavioral = scoreBehavioral(behavioralSignals, session.messages_count);

  // Score explicit + fit components
  const { explicit, fit, conversationState } = scoreExplicit(qualificationSignals);

  // Composite score: weighted combination
  const composite = Math.round(
    behavioral * weights.behavioral +
    explicit * weights.explicit +
    fit * weights.fit
  );

  // Classification
  let classification: ScoreClassification;
  if (composite >= thresholds.qualified) classification = 'hot';
  else if (composite >= thresholds.warm) classification = 'warm';
  else if (composite >= thresholds.cold) classification = 'cold';
  else classification = 'disqualified';

  // Should we escalate to meeting room?
  const shouldEscalate = session.tier === 'lobby' &&
    composite >= thresholds.qualified &&
    session.score_composite < thresholds.qualified; // First time crossing threshold

  // Update session scores
  session.score_composite = composite;
  session.score_behavioral = behavioral;
  session.score_explicit = explicit;
  session.score_fit = fit;
  session.classification = classification;

  return {
    composite,
    behavioral,
    explicit,
    fit,
    classification,
    shouldEscalate,
    recommendedAction: conversationState?.recommended_action ?? null,
  };
}
