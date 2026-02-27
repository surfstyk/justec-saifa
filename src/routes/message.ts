import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import { updateSession, closeSession } from '../session/manager.js';
import { getBudget, consume } from '../session/budget.js';
import { resolveModel } from '../llm/router.js';
import { buildLobbyPrompt } from '../persona/lobby.js';
import { buildMeetingRoomPrompt } from '../persona/meeting-room.js';
import { updateScore } from '../scoring/engine.js';
import { filterInput } from '../security/input-filter.js';
import { filterOutput } from '../security/output-filter.js';
import { checkSessionLimit, checkIpLimit, setRateLimitHeaders } from '../security/rate-limiter.js';
import { evaluateGuard } from '../security/guard.js';
import { isBlocked } from '../security/ip-blocklist.js';
import { logSecurityEvent } from '../db/conversations.js';
import { handleToolCall } from '../tools/handler.js';
import { createLeadCard, moveToPhoneCaptured } from '../integrations/trello-cards.js';
import { notifyQualifiedLead, notifySecurityIncident } from '../integrations/telegram.js';
import { getConfig } from '../config.js';
import {
  setupSSE, writeProcessing, writeToken, writeMessageComplete,
  writeStructuredMessage, writeSessionTerminated, writeTierChange,
  writeBudgetWarning, writeBudgetExhausted, writeError, writeStreamEnd,
} from '../sse/writer.js';
import type { Session, Message, ChatRequest, QualificationSignals, LLMChatRequest, ToolDefinition } from '../types.js';

const router = Router();
const MAX_TOOL_ROUNDS = 3;

router.post('/api/session/:id/message', sessionLookup, async (req, res) => {
  const session = res.locals.session as Session;
  const body = req.body as ChatRequest;

  // 0. Check if IP is blocked
  if (isBlocked(session.ip_hash)) {
    res.status(403).json({ error: 'blocked', message: 'Access denied.' });
    return;
  }

  // 1. Rate limiter checks
  const sessionLimit = checkSessionLimit(session.id);
  const ipLimit = checkIpLimit(session.ip_hash);
  setRateLimitHeaders(res, sessionLimit.allowed ? sessionLimit : ipLimit);

  if (!sessionLimit.allowed) {
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many messages. Please wait before sending another.',
      retry_after_seconds: sessionLimit.retryAfterSeconds,
    });
    return;
  }
  if (!ipLimit.allowed) {
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests from your network. Please try again later.',
      retry_after_seconds: ipLimit.retryAfterSeconds,
    });
    return;
  }

  // Validate: must have text or action (not both, not neither)
  if (!body.text && !body.action) {
    res.status(400).json({ error: 'invalid_request', message: 'Message must include text or action' });
    return;
  }
  if (body.text && body.action) {
    res.status(400).json({ error: 'invalid_request', message: 'Message cannot include both text and action' });
    return;
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
        // Other actions (consent, language) pass through as-is
        break;
    }
  }

  // 2. Input filter (on text messages)
  let threatLevel: 0 | 1 | 2 | 3 = 0;
  if (body.text) {
    const inputResult = filterInput(body.text, session.id, session.ip_hash);

    if (!inputResult.passed) {
      body.text = inputResult.modified_text ?? body.text.slice(0, 2000);
    }

    threatLevel = inputResult.threat_level as 0 | 1 | 2 | 3;

    if (threatLevel > 0) {
      logSecurityEvent(session.id, inputResult.reason ?? 'unknown', body.text.slice(0, 200), session.ip_hash);
    }
  }

  // 3. Guard evaluation
  const guardAction = evaluateGuard(session, threatLevel, body.text?.slice(0, 100));

  if (guardAction.action === 'block' || guardAction.action === 'terminate') {
    setupSSE(res, session.tier);
    writeProcessing(res);
    if (guardAction.overrideResponse) {
      writeToken(res, guardAction.overrideResponse);
    }
    writeSessionTerminated(res, guardAction.action, guardAction.level, guardAction.overrideResponse ?? '');
    writeStreamEnd(res);

    closeSession(session.id, 'security');
    notifySecurityIncident(session, guardAction.action as 'terminate' | 'block', guardAction.level);
    return;
  }

  // Check token budget
  const budget = getBudget(session);
  if (session.tokens_used >= budget) {
    res.status(429).json({ error: 'rate_limited', message: 'Token budget exhausted', retry_after_seconds: 0 });
    return;
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

  // Set up SSE
  setupSSE(res, session.tier);
  writeProcessing(res);

  // Handle client disconnect
  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
  });

  try {
    // Build prompt based on tier
    const prompt = session.tier === 'meeting_room'
      ? buildMeetingRoomPrompt(session)
      : buildLobbyPrompt(session);

    let { system, messages } = prompt;
    const tools: ToolDefinition[] = prompt.tools;

    // 4. If guard is at redirect level, inject guard instruction into system prompt
    if (guardAction.action === 'inject_redirect' && guardAction.systemPromptAddition) {
      system = system + '\n\n' + guardAction.systemPromptAddition;
    }

    // Resolve model and adapter
    const { adapter, config: modelConfig } = resolveModel(session);

    // 5. LLM call with tool call loop
    let fullResponse = '';
    let tokenCount = 0;
    let capturedSignals: QualificationSignals | null = null;
    const structuredMessages: Message['structured'] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (clientDisconnected) break;

      const chatRequest: LLMChatRequest = {
        system,
        messages,
        max_tokens: modelConfig.max_tokens,
        temperature: modelConfig.temperature ?? 0.7,
        ...(tools.length > 0 ? { tools } : {}),
      };

      type ToolCallInfo = { id: string; name: string; args: Record<string, unknown>; thought_signature?: string };
      const toolCalls: ToolCallInfo[] = [];

      const stream = adapter.chat(chatRequest);

      for await (const event of stream) {
        if (clientDisconnected) break;

        switch (event.type) {
          case 'token': {
            fullResponse += event.text;
            writeToken(res, event.text);
            break;
          }
          case 'tool_call': {
            toolCalls.push({ id: event.id, name: event.name, args: event.args, thought_signature: event.thought_signature });
            break;
          }
          case 'done': {
            tokenCount += event.usage.input_tokens + event.usage.output_tokens;
            break;
          }
          case 'error': {
            console.error(`[message] LLM error in round ${round}:`, event.message);
            writeError(res, 'llm_error', "We're experiencing a technical issue. Please try again.");
            writeStreamEnd(res);
            return;
          }
        }
      }

      // If no tool calls, we're done streaming
      if (toolCalls.length === 0) break;

      // Separate report_signals from action tools
      const signalCall = toolCalls.find(tc => tc.name === 'report_signals');
      const actionCalls = toolCalls.filter(tc => tc.name !== 'report_signals');

      // Always capture signals if present
      if (signalCall) {
        capturedSignals = signalCall.args as unknown as QualificationSignals;
        console.log('[message] Captured report_signals');
      }

      // If there are no action tools, handle signal-only case
      if (actionCalls.length === 0 && signalCall) {
        // If text was already produced alongside the function call, we're done
        if (fullResponse.trim()) {
          console.log('[message] report_signals with text — done');
          break;
        }

        // Already captured once but still no text — Gemini is looping, bail out
        if (round > 0) {
          console.warn('[message] report_signals repeated without text — breaking');
          break;
        }

        // Feed result back so Gemini continues with its conversational response
        console.log('[message] report_signals only, no text yet — continuing for text');
        messages = [
          ...messages,
          {
            role: 'assistant' as const,
            content: '',
            tool_call_id: signalCall.id,
            tool_name: 'report_signals',
            tool_result: signalCall.args,
            thought_signature: signalCall.thought_signature,
          },
          {
            role: 'tool' as const,
            content: JSON.stringify({ acknowledged: true, instruction: 'Assessment received. Now write your conversational response to the visitor.' }),
            tool_call_id: signalCall.id,
            tool_name: 'report_signals',
            tool_result: { acknowledged: true },
          },
        ];
        continue;
      }

      // Process all action tool calls
      for (const tc of actionCalls) {
        console.log(`[message] Tool call round ${round + 1}: ${tc.name}`);
        const toolResult = await handleToolCall(session, tc.name, tc.args);

        // Emit structured message to frontend if present
        if (toolResult.structured && !clientDisconnected) {
          writeStructuredMessage(res, toolResult.structured.type, toolResult.structured.payload);
          structuredMessages.push(toolResult.structured);
        }

        // Append tool call + result to messages for next LLM round
        messages = [
          ...messages,
          {
            role: 'assistant' as const,
            content: '',
            tool_call_id: tc.id,
            tool_name: tc.name,
            tool_result: tc.args,
            thought_signature: tc.thought_signature,
          },
          {
            role: 'tool' as const,
            content: JSON.stringify(toolResult.result),
            tool_call_id: tc.id,
            tool_name: tc.name,
            tool_result: toolResult.result,
          },
        ];
      }

      // Also append report_signals call + result if it came alongside action tools
      if (signalCall) {
        messages = [
          ...messages,
          {
            role: 'assistant' as const,
            content: '',
            tool_call_id: signalCall.id,
            tool_name: 'report_signals',
            tool_result: signalCall.args,
            thought_signature: signalCall.thought_signature,
          },
          {
            role: 'tool' as const,
            content: JSON.stringify({ acknowledged: true }),
            tool_call_id: signalCall.id,
            tool_name: 'report_signals',
            tool_result: { acknowledged: true },
          },
        ];
      }

      // Safety: last round with no more continuation
      if (round === MAX_TOOL_ROUNDS) {
        console.warn(`[message] Max tool call rounds (${MAX_TOOL_ROUNDS}) reached`);
      }
    }

    // 6. Output filter scan on accumulated text
    const outputCheck = filterOutput(fullResponse);
    if (!outputCheck.passed) {
      logSecurityEvent(session.id, `output_filter:${outputCheck.reason}`, fullResponse.slice(0, 200), session.ip_hash);
      // Use threatLevel 1 (not 2) — output leakage is less severe than input injection.
      // With level 1: first offense → guard 1 (redirect), second → guard 2 (redirect),
      // third → guard 3 (terminate). Gives 3 chances instead of 2 before termination.
      evaluateGuard(session, 1, `output_filter:${outputCheck.reason}`);
    }

    // Store assistant message in history
    const assistantMessage: Message = {
      role: getConfig().persona.assistant_role,
      content: fullResponse,
      structured: structuredMessages,
      timestamp: new Date().toISOString(),
      tokens: tokenCount,
    };
    session.history.push(assistantMessage);

    // Consume tokens from budget
    const budgetResult = consume(session, tokenCount);

    if (!clientDisconnected) {
      writeMessageComplete(res, tokenCount, budgetResult.remaining);

      if (budgetResult.exhausted) {
        writeBudgetExhausted(res, session.tokens_used, budgetResult.total);
      } else if (budgetResult.warning) {
        writeBudgetWarning(res, budgetResult.remaining, budgetResult.total);
      }

      // Use captured signals from report_signals tool call
      const signals = capturedSignals;

      if (signals?.visitor_info) {
        const vi = signals.visitor_info;
        if (vi.name) session.visitor_info.name = vi.name;
        if (vi.company) session.visitor_info.company = vi.company;
        if (vi.role) session.visitor_info.role = vi.role;
        if (vi.company_size) session.visitor_info.company_size = vi.company_size;
        if (vi.industry) session.visitor_info.industry = vi.industry;
        if (vi.language) {
          session.visitor_info.language = vi.language;
          // Also sync to session root so guard termination messages use correct language
          session.language = vi.language;
        }
      }

      const scoreResult = updateScore(session, body.behavioral, signals);

      if (scoreResult.shouldEscalate) {
        const previousTier = session.tier;
        session.tier = 'meeting_room';
        createLeadCard(session).catch(e => console.error('[trello] Lead card creation failed:', e));
        notifyQualifiedLead(session);
        writeTierChange(res, previousTier, 'meeting_room', scoreResult.composite);
      }

      updateSession(session);

      writeStreamEnd(res);
    }
  } catch (err) {
    console.error('[message] Stream error:', err);
    if (!clientDisconnected && !res.writableEnded) {
      writeError(res, 'internal_error', 'Something went wrong. Please try again.');
      writeStreamEnd(res);
    }
  }
});

export default router;
