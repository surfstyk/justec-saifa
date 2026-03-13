import { filterInput } from '../../security/input-filter.js';
import { evaluateGuard } from '../../security/guard.js';
import { logSecurityEvent } from '../../db/conversations.js';
import { recordSecurityEvent } from '../../admin/stats.js';
import {
  setupSSE, writeProcessing, writeToken, writeSessionTerminated,
  writeStructuredMessage, writeStreamEnd,
} from '../../sse/writer.js';
import type { PipelineContext, StageResult } from '../types.js';

/**
 * Stage 2: Security In — input filter + guard evaluation.
 * Reads: processedText, session
 * Writes: threatLevel, guardAction, guardRedirect
 * Can halt: terminate/block on guard escalation
 */
export async function securityIn(ctx: PipelineContext): Promise<StageResult> {
  const { session, config, res } = ctx;

  // Input filter (on text messages)
  if (ctx.processedText) {
    const inputResult = filterInput(ctx.processedText, session.id, session.ip_hash);

    if (!inputResult.passed) {
      ctx.processedText = inputResult.modified_text ?? ctx.processedText.slice(0, 2000);
    }

    ctx.threatLevel = inputResult.threat_level;

    if (ctx.threatLevel > 0) {
      logSecurityEvent(session.id, inputResult.reason ?? 'unknown', ctx.processedText.slice(0, 200), session.ip_hash);
      recordSecurityEvent();
    }
  }

  // Guard evaluation
  const guardAction = evaluateGuard(session, ctx.threatLevel, ctx.processedText?.slice(0, 100));
  ctx.guardAction = guardAction;

  if (guardAction.action === 'block' || guardAction.action === 'terminate') {
    const lang = session.language || 'en';
    const endMessages = config.conversation_end_messages[lang] || config.conversation_end_messages.en;

    setupSSE(res, session.tier);
    writeProcessing(res);
    if (guardAction.overrideResponse) {
      writeToken(res, guardAction.overrideResponse);
    }
    writeSessionTerminated(res, 'security', guardAction.level, guardAction.overrideResponse ?? '');
    writeStructuredMessage(res, 'conversation_end', {
      reason: 'security',
      message: endMessages.security_terminated,
      show_contact: true,
      phone: config.client.phone,
    });
    writeStreamEnd(res);

    return {
      action: 'terminate',
      ctx,
      reason: 'security',
      message: guardAction.overrideResponse ?? '',
    };
  }

  // Store guard redirect for prompt injection
  if (guardAction.action === 'inject_redirect' && guardAction.systemPromptAddition) {
    ctx.guardRedirect = guardAction.systemPromptAddition;
  }

  return { action: 'continue', ctx };
}
