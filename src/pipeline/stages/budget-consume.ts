import { consume } from '../../session/budget.js';
import { getConfig } from '../../config.js';
import { updateSession } from '../../session/manager.js';
import {
  writeMessageComplete, writeBudgetWarning, writeBudgetExhausted,
  writeStructuredMessage, writeStreamEnd,
} from '../../sse/writer.js';
import type { PipelineContext, StageResult } from '../types.js';
import type { Message } from '../../types.js';

/**
 * Stage 8: Budget Consume — token consumption + exhaustion check.
 * Reads: tokenUsage, session
 * Writes: session.tokens_used
 * Can halt: budget_exhausted → terminate
 * Emits SSE: message_complete, budget_warning, budget_exhausted, stream_end
 */
export async function budgetConsume(ctx: PipelineContext): Promise<StageResult> {
  const { session, res } = ctx;

  if (ctx.clientDisconnected) return { action: 'continue', ctx };

  const config = getConfig();
  const tokenCount = ctx.tokenUsage.input + ctx.tokenUsage.output;

  // Store assistant message in history
  const assistantMessage: Message = {
    role: config.persona.assistant_role,
    content: ctx.fullResponse,
    structured: ctx.structuredMessages,
    timestamp: new Date().toISOString(),
    tokens: tokenCount,
  };
  session.history.push(assistantMessage);

  // Consume tokens from budget
  const budgetResult = consume(session, tokenCount);
  const lang = session.language || 'en';

  writeMessageComplete(res, tokenCount, budgetResult.remaining);

  if (budgetResult.exhausted) {
    const endMessages = config.conversation_end_messages[lang] || config.conversation_end_messages.en;
    writeBudgetExhausted(res, session.tokens_used, budgetResult.total);
    writeStructuredMessage(res, 'conversation_end', {
      reason: 'budget_exhausted',
      message: endMessages.budget_exhausted,
      show_contact: true,
      phone: config.client.phone,
    });
  } else if (budgetResult.warning) {
    writeBudgetWarning(res, budgetResult.remaining, budgetResult.total);
  }

  updateSession(session);
  writeStreamEnd(res);

  return { action: 'continue', ctx };
}
