import { checkSessionLimit, checkIpLimit, setRateLimitHeaders } from '../../security/rate-limiter.js';
import { moveToPhoneCaptured } from '../../integrations/trello-cards.js';
import { recordMessage } from '../../admin/stats.js';
import type { PipelineContext, StageResult } from '../types.js';
import type { ChatRequest, Message } from '../../types.js';

/**
 * Stage 1: Validate — rate limiting, request validation, action translation, phone extraction.
 * Writes: processedText
 * Can halt: 429 (rate limit), 400 (bad request)
 */
export async function validate(ctx: PipelineContext): Promise<StageResult> {
  const { session, res } = ctx;
  const body = ctx.requestBody as ChatRequest;

  // Consent must be granted before any message processing
  if (session.consent !== 'granted') {
    const message = session.consent === 'pending'
      ? 'Consent is required before sending messages.'
      : 'This session has declined consent and cannot send messages.';
    res.status(403).json({
      error: 'consent_required',
      consent_state: session.consent,
      message,
    });
    return { action: 'halt', ctx, reason: `consent_${session.consent}` };
  }

  // Rate limiter checks
  const sessionLimit = checkSessionLimit(session.id);
  const ipLimit = checkIpLimit(session.ip_hash);
  setRateLimitHeaders(res, sessionLimit.allowed ? sessionLimit : ipLimit);

  if (!sessionLimit.allowed) {
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many messages. Please wait before sending another.',
      retry_after_seconds: sessionLimit.retryAfterSeconds,
    });
    return { action: 'halt', ctx, reason: 'session_rate_limited' };
  }
  if (!ipLimit.allowed) {
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests from your network. Please try again later.',
      retry_after_seconds: ipLimit.retryAfterSeconds,
    });
    return { action: 'halt', ctx, reason: 'ip_rate_limited' };
  }

  // Must have text or action (not both, not neither)
  if (!body.text && !body.action) {
    res.status(400).json({ error: 'invalid_request', message: 'Message must include text or action' });
    return { action: 'halt', ctx, reason: 'no_text_or_action' };
  }
  if (body.text && body.action) {
    res.status(400).json({ error: 'invalid_request', message: 'Message cannot include both text and action' });
    return { action: 'halt', ctx, reason: 'both_text_and_action' };
  }

  // Handle typed actions — translate to text for LLM context
  if (body.action) {
    switch (body.action.type) {
      case 'slot_selected': {
        const slotId = body.action.payload.slot_id as string;
        const slotDisplay = body.action.payload.display as string | undefined;
        body.text = slotDisplay
          ? `I'd like to book the ${slotDisplay} slot. [slot_id: ${slotId}]`
          : `I'd like to book slot ${slotId}.`;
        break;
      }
      case 'phone_submitted': {
        const phone = body.action.payload.phone as string;
        session.metadata = session.metadata || {};
        session.metadata.phone = phone;
        if (session.trello_card_id) {
          moveToPhoneCaptured(session).catch(e => console.error('[trello] Phone captured move failed:', e));
        }
        body.text = `My phone number is ${phone}.`;
        break;
      }
      default:
        break;
    }
  }

  // Extract phone number from text if not already captured
  if (body.text && !session.metadata?.phone) {
    const phoneMatch = body.text.match(/\+?\d[\d\s\-().]{7,}\d/);
    if (phoneMatch) {
      const cleaned = phoneMatch[0].replace(/[\s\-().]/g, '');
      if (cleaned.length >= 8 && cleaned.length <= 16) {
        console.log(`[pipeline:validate] Phone extracted from text: ${cleaned}`);
        session.metadata = session.metadata || {};
        session.metadata.phone = cleaned;
        if (session.trello_card_id) {
          moveToPhoneCaptured(session).catch(e => console.error('[trello] Phone captured move failed:', e));
        }
      }
    }
  }

  // Store visitor message in history
  const visitorMessage: Message = {
    role: 'visitor',
    content: body.text || null,
    action: body.action,
    structured: [],
    timestamp: new Date().toISOString(),
  };

  session.history.push(visitorMessage);
  session.messages_count++;
  session.last_activity = Date.now();
  recordMessage();

  ctx.processedText = body.text || '';

  return { action: 'continue', ctx };
}
