import { closeSession } from '../session/manager.js';
import { notifySecurityIncident } from '../integrations/telegram.js';
import { validate } from './stages/validate.js';
import { securityIn } from './stages/security-in.js';
import { budgetCheck } from './stages/budget-check.js';
import { promptBuild } from './stages/prompt-build.js';
import { llmStream } from './stages/llm-stream.js';
import { securityOut } from './stages/security-out.js';
import { scoreUpdate } from './stages/score-update.js';
import { budgetConsume } from './stages/budget-consume.js';
import type { PipelineContext, PipelineStage, StageResult } from './types.js';

export type { PipelineContext } from './types.js';

const stages: PipelineStage[] = [
  validate,
  securityIn,
  budgetCheck,
  promptBuild,
  llmStream,
  securityOut,
  scoreUpdate,
  budgetConsume,
];

export async function runPipeline(ctx: PipelineContext): Promise<void> {
  for (const stage of stages) {
    const result: StageResult = await stage(ctx);
    ctx = result.ctx;

    if (result.action === 'halt') {
      console.log(`[pipeline] Halted at ${stage.name}: ${result.reason}`);
      break;
    }

    if (result.action === 'terminate') {
      console.log(`[pipeline] Terminated at ${stage.name}: ${result.reason}`);
      closeSession(ctx.session.id, result.reason === 'security' ? 'security' : 'budget_exhausted');
      if (result.reason === 'security' && ctx.guardAction) {
        notifySecurityIncident(ctx.session, ctx.guardAction.action as 'terminate' | 'block', ctx.guardAction.level);
      }
      break;
    }
  }
}
