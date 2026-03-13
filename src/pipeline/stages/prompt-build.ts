import { buildLobbyPrompt } from '../../persona/lobby.js';
import { buildMeetingRoomPrompt } from '../../persona/meeting-room.js';
import type { PipelineContext, StageResult } from '../types.js';

/**
 * Stage 4: Prompt Build — tier-aware prompt assembly.
 * Reads: session, config, guardRedirect
 * Writes: systemPrompt, messages, tools
 * Cannot halt.
 */
export async function promptBuild(ctx: PipelineContext): Promise<StageResult> {
  const { session } = ctx;

  const prompt = session.tier === 'meeting_room'
    ? buildMeetingRoomPrompt(session)
    : buildLobbyPrompt(session);

  ctx.systemPrompt = prompt.system;
  ctx.messages = prompt.messages;
  ctx.tools = prompt.tools;

  // If guard is at redirect level, inject guard instruction into system prompt
  if (ctx.guardRedirect) {
    ctx.systemPrompt = ctx.systemPrompt + '\n\n' + ctx.guardRedirect;
  }

  return { action: 'continue', ctx };
}
