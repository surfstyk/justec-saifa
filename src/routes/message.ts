import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import { isBlocked } from '../security/ip-blocklist.js';
import { getConfig } from '../config.js';
import { writeError, writeStreamEnd } from '../sse/writer.js';
import { runPipeline } from '../pipeline/index.js';
import type { PipelineContext } from '../pipeline/index.js';
import type { Session, ChatRequest } from '../types.js';

const router = Router();

router.post('/api/session/:id/message', sessionLookup, async (req, res) => {
  const session = res.locals.session as Session;
  const body = req.body as ChatRequest;

  // Check if IP is blocked (pre-pipeline, before SSE setup)
  if (isBlocked(session.ip_hash)) {
    res.status(403).json({ error: 'blocked', message: 'Access denied.' });
    return;
  }

  const ctx: PipelineContext = {
    session,
    requestBody: body,
    ipHash: session.ip_hash,
    config: getConfig(),
    processedText: '',
    threatLevel: 0,
    guardAction: null,
    guardRedirect: null,
    systemPrompt: '',
    messages: [],
    tools: [],
    fullResponse: '',
    toolCalls: [],
    structuredMessages: [],
    capturedSignals: null,
    tokenUsage: { input: 0, output: 0 },
    res,
    clientDisconnected: false,
  };

  res.on('close', () => { ctx.clientDisconnected = true; });

  try {
    await runPipeline(ctx);
  } catch (err) {
    console.error('[message] Pipeline error:', err);
    if (!ctx.clientDisconnected && !res.writableEnded) {
      writeError(res, 'internal_error', 'Something went wrong. Please try again.');
      writeStreamEnd(res);
    }
  }
});

export default router;
