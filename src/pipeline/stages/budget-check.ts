import { getBudget } from '../../session/budget.js';
import type { PipelineContext, StageResult } from '../types.js';

/**
 * Stage 3: Budget Check — pre-flight budget verification.
 * Reads: session
 * Can halt: 429 if budget exhausted
 */
export async function budgetCheck(ctx: PipelineContext): Promise<StageResult> {
  const { session, res } = ctx;

  const budget = getBudget(session);
  if (session.tokens_used >= budget) {
    res.status(429).json({ error: 'rate_limited', message: 'Token budget exhausted', retry_after_seconds: 0 });
    return { action: 'halt', ctx, reason: 'budget_exhausted' };
  }

  return { action: 'continue', ctx };
}
