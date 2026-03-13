import { updateScore } from '../../scoring/engine.js';
import { createLeadCard, moveToPhoneCaptured } from '../../integrations/trello-cards.js';
import { notifyQualifiedLead } from '../../integrations/telegram.js';
import { recordEscalation } from '../../admin/stats.js';
import { writeTierChange } from '../../sse/writer.js';
import type { PipelineContext, StageResult } from '../types.js';

/**
 * Stage 7: Score Update — scoring + tier escalation.
 * Reads: capturedSignals, session, requestBody.behavioral
 * Writes: session.scores, session.tier
 * Cannot halt.
 * Emits SSE: tier_change
 */
export async function scoreUpdate(ctx: PipelineContext): Promise<StageResult> {
  const { session, res } = ctx;

  if (ctx.clientDisconnected) return { action: 'continue', ctx };

  // Apply visitor info from captured signals
  const signals = ctx.capturedSignals;
  if (signals?.visitor_info) {
    const vi = signals.visitor_info;
    if (vi.name) session.visitor_info.name = vi.name;
    if (vi.company) session.visitor_info.company = vi.company;
    if (vi.role) session.visitor_info.role = vi.role;
    if (vi.company_size) session.visitor_info.company_size = vi.company_size;
    if (vi.industry) session.visitor_info.industry = vi.industry;
    if (vi.language) {
      session.visitor_info.language = vi.language;
      session.language = vi.language;
    }
  }

  const scoreResult = updateScore(session, ctx.requestBody.behavioral, signals);

  if (scoreResult.shouldEscalate) {
    recordEscalation();
    const previousTier = session.tier;
    session.tier = 'meeting_room';
    createLeadCard(session).catch(e => console.error('[trello] Lead card creation failed:', e));
    notifyQualifiedLead(session);
    writeTierChange(res, previousTier, 'meeting_room', scoreResult.composite);
  }

  return { action: 'continue', ctx };
}
