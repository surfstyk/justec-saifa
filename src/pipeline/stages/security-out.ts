import { filterOutput } from '../../security/output-filter.js';
import { evaluateGuard } from '../../security/guard.js';
import { logSecurityEvent } from '../../db/conversations.js';
import { recordSecurityEvent } from '../../admin/stats.js';
import type { PipelineContext, StageResult } from '../types.js';

/**
 * Stage 6: Security Out — output filter + leakage detection.
 * Reads: fullResponse
 * Writes: fullResponse (replaced if leak detected)
 * Cannot halt (replaces text, continues).
 */
export async function securityOut(ctx: PipelineContext): Promise<StageResult> {
  const { session } = ctx;

  const outputCheck = filterOutput(ctx.fullResponse);
  if (!outputCheck.passed) {
    logSecurityEvent(session.id, `output_filter:${outputCheck.reason}`, ctx.fullResponse.slice(0, 200), session.ip_hash);
    recordSecurityEvent();
    // Sanitize stored text so the model doesn't see its own leaked content in subsequent turns
    ctx.fullResponse = "That's a great point — let me take a moment to consider how best to respond to that. Could you tell me a bit more?";
    // Use threatLevel 1 (not 2) — output leakage is less severe than input injection.
    evaluateGuard(session, 1, `output_filter:${outputCheck.reason}`);
  }

  return { action: 'continue', ctx };
}
