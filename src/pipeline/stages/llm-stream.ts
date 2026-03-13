import { resolveModel } from '../../llm/router.js';
import { handleToolCall } from '../../tools/handler.js';
import { ToolCallSanitizer } from '../../sse/tool-call-sanitizer.js';
import {
  setupSSE, writeProcessing, writeToken, writeStructuredMessage, writeError, writeStreamEnd,
} from '../../sse/writer.js';
import { recordLLMError } from '../../admin/stats.js';
import type { PipelineContext, StageResult, ToolCallRecord } from '../types.js';
import type { LLMChatRequest, QualificationSignals } from '../../types.js';

const MAX_TOOL_ROUNDS = 3;

/**
 * Stage 5: LLM Stream — LLM call + tool dispatch loop.
 * Reads: systemPrompt, messages, tools, res
 * Writes: fullResponse, toolCalls, structuredMessages, capturedSignals, tokenUsage
 * Can halt: LLM error, client disconnect
 * Emits SSE: processing, tokens, structured_message
 */
export async function llmStream(ctx: PipelineContext): Promise<StageResult> {
  const { session, res } = ctx;

  // Set up SSE
  setupSSE(res, session.tier);
  writeProcessing(res);

  const { adapter, config: modelConfig } = resolveModel(session);
  const sanitizer = new ToolCallSanitizer();
  let calendarCheckUsedThisTurn = false;
  let { messages } = ctx;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (ctx.clientDisconnected) break;

    const chatRequest: LLMChatRequest = {
      system: ctx.systemPrompt,
      messages,
      max_tokens: modelConfig.max_tokens,
      temperature: modelConfig.temperature ?? 0.7,
      ...(ctx.tools.length > 0 ? { tools: ctx.tools } : {}),
    };

    const toolCalls: ToolCallRecord[] = [];
    const stream = adapter.chat(chatRequest);

    for await (const event of stream) {
      if (ctx.clientDisconnected) break;

      switch (event.type) {
        case 'token': {
          const clean = sanitizer.push(event.text);
          ctx.fullResponse += clean;
          if (clean) writeToken(res, clean);
          break;
        }
        case 'tool_call': {
          toolCalls.push({ id: event.id, name: event.name, args: event.args, thought_signature: event.thought_signature });
          break;
        }
        case 'done': {
          ctx.tokenUsage.input += event.usage.input_tokens;
          ctx.tokenUsage.output += event.usage.output_tokens;
          break;
        }
        case 'error': {
          console.error(`[pipeline:llm-stream] LLM error in round ${round}:`, event.message);
          recordLLMError();
          writeError(res, 'llm_error', "We're experiencing a technical issue. Please try again.");
          writeStreamEnd(res);
          return { action: 'halt', ctx, reason: 'llm_error' };
        }
      }
    }

    // Flush any buffered/pending text from the sanitizer
    const flushed = sanitizer.flush();
    if (flushed) {
      ctx.fullResponse += flushed;
      if (!ctx.clientDisconnected) writeToken(res, flushed);
    }

    // If no tool calls, we're done streaming
    if (toolCalls.length === 0) break;

    // Record all tool calls
    ctx.toolCalls.push(...toolCalls);

    // Separate report_signals from action tools
    const signalCall = toolCalls.find(tc => tc.name === 'report_signals');
    const actionCalls = toolCalls.filter(tc => tc.name !== 'report_signals');

    // Always capture signals if present
    if (signalCall) {
      ctx.capturedSignals = signalCall.args as unknown as QualificationSignals;
      console.log('[pipeline:llm-stream] Captured report_signals');
    }

    // If there are no action tools, handle signal-only case
    if (actionCalls.length === 0 && signalCall) {
      // If text was already produced alongside the function call, we're done
      if (ctx.fullResponse.trim()) {
        console.log('[pipeline:llm-stream] report_signals with text — done');
        break;
      }

      // Already captured once but still no text — Gemini is looping, bail out
      if (round > 0) {
        console.warn('[pipeline:llm-stream] report_signals repeated without text — breaking');
        break;
      }

      // Feed result back so Gemini continues with its conversational response
      console.log('[pipeline:llm-stream] report_signals only, no text yet — continuing for text');
      const lastVisitorText = ctx.requestBody.text || 'the visitor';
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
          content: JSON.stringify({
            acknowledged: true,
            instruction: `Assessment received. You MUST now write your conversational reply to the visitor. Do NOT call any tools. The visitor said: "${lastVisitorText.slice(0, 200)}"`,
          }),
          tool_call_id: signalCall.id,
          tool_name: 'report_signals',
          tool_result: { acknowledged: true },
        },
      ];
      continue;
    }

    // Enforce one action tool per round
    if (actionCalls.length > 1) {
      console.warn(`[pipeline:llm-stream] ${actionCalls.length} action tools in one round — executing only first (${actionCalls[0].name}), deferring rest`);
    }

    const primaryAction = actionCalls[0];
    const deferredActions = actionCalls.slice(1);

    // Per-turn dedup: prevent duplicate check_calendar_availability calls
    if (primaryAction.name === 'check_calendar_availability' && calendarCheckUsedThisTurn) {
      console.warn(`[pipeline:llm-stream] Duplicate check_calendar_availability suppressed (round ${round + 1})`);
      messages = [
        ...messages,
        { role: 'assistant' as const, content: '', tool_call_id: primaryAction.id, tool_name: primaryAction.name, tool_result: primaryAction.args, thought_signature: primaryAction.thought_signature },
        { role: 'tool' as const, content: JSON.stringify({ already_checked: true, message: 'Calendar availability was already checked this turn. Use the slots already shown.' }), tool_call_id: primaryAction.id, tool_name: primaryAction.name, tool_result: { already_checked: true } },
      ];
    } else {
      if (primaryAction.name === 'check_calendar_availability') {
        calendarCheckUsedThisTurn = true;
      }

      console.log(`[pipeline:llm-stream] Tool call round ${round + 1}: ${primaryAction.name}`);
      const toolResult = await handleToolCall(session, primaryAction.name, primaryAction.args);

      // Emit structured message to frontend if present
      if (toolResult.structured && !ctx.clientDisconnected) {
        writeStructuredMessage(res, toolResult.structured.type, toolResult.structured.payload);
        ctx.structuredMessages.push(toolResult.structured);
      }

      // Append tool call + result to messages for next LLM round
      messages = [
        ...messages,
        {
          role: 'assistant' as const,
          content: '',
          tool_call_id: primaryAction.id,
          tool_name: primaryAction.name,
          tool_result: primaryAction.args,
          thought_signature: primaryAction.thought_signature,
        },
        {
          role: 'tool' as const,
          content: JSON.stringify(toolResult.result),
          tool_call_id: primaryAction.id,
          tool_name: primaryAction.name,
          tool_result: toolResult.result,
        },
      ];
    }

    // Defer remaining action tools
    for (const tc of deferredActions) {
      console.warn(`[pipeline:llm-stream] Deferred tool call: ${tc.name} (one action per round)`);
      messages = [
        ...messages,
        { role: 'assistant' as const, content: '', tool_call_id: tc.id, tool_name: tc.name, tool_result: tc.args, thought_signature: tc.thought_signature },
        { role: 'tool' as const, content: JSON.stringify({ deferred: true, message: 'One step at a time. Complete the current booking step and wait for the visitor to respond before proceeding.' }), tool_call_id: tc.id, tool_name: tc.name, tool_result: { deferred: true } },
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

    // Inject continuation instruction only if the model hasn't produced text yet
    if (!ctx.fullResponse.trim()) {
      const lastVisitorText = ctx.requestBody.text || 'the visitor';
      messages = [
        ...messages,
        {
          role: 'tool' as const,
          content: JSON.stringify({
            instruction: `Tool execution complete. Now write a brief, natural reply to the visitor acknowledging the action and guiding next steps. Do NOT call any more tools. The visitor said: "${lastVisitorText.slice(0, 200)}"`,
          }),
          tool_call_id: 'system-continuation',
          tool_name: 'system',
          tool_result: { acknowledged: true },
        },
      ];
    } else {
      // Model already produced text — no need for another round
      break;
    }

    // Safety: last round with no more continuation
    if (round === MAX_TOOL_ROUNDS) {
      console.warn(`[pipeline:llm-stream] Max tool call rounds (${MAX_TOOL_ROUNDS}) reached`);
    }
  }

  // Fallback if LLM produced no visible text
  // Skip fallback if structured messages were already sent
  if (!ctx.fullResponse.trim() && ctx.structuredMessages.length === 0 && !ctx.clientDisconnected) {
    console.warn('[pipeline:llm-stream] Empty response after all rounds — sending fallback');
    const fallback = "That's a great point — let me take a moment to consider how best to respond to that. Could you tell me a bit more?";
    ctx.fullResponse = fallback;
    writeToken(res, fallback);
  }

  return { action: 'continue', ctx };
}
