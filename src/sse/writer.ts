import type { Response } from 'express';

export function setupSSE(res: Response, tier: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Tier': tier,
  });
}

export function writeSSE(res: Response, event: string, data: Record<string, unknown> = {}): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function writeProcessing(res: Response): void {
  writeSSE(res, 'processing');
}

export function writeToken(res: Response, text: string): void {
  writeSSE(res, 'token', { text });
}

export function writeMessageComplete(res: Response, tokensUsed: number, tokensRemaining: number): void {
  writeSSE(res, 'message_complete', {
    tokens_used: tokensUsed,
    session_tokens_remaining: tokensRemaining,
  });
}

export function writeStructuredMessage(res: Response, type: string, payload: Record<string, unknown>): void {
  writeSSE(res, 'structured_message', { type, payload });
}

export function writeTierChange(res: Response, from: string, to: string, score: number): void {
  writeSSE(res, 'tier_change', { from, to, score });
}

export function writeBudgetWarning(res: Response, tokensRemaining: number, budgetTotal: number): void {
  writeSSE(res, 'budget_warning', { tokens_remaining: tokensRemaining, budget_total: budgetTotal, message: 'approaching_limit' });
}

export function writeBudgetExhausted(res: Response, tokensUsed: number, budgetTotal: number): void {
  writeSSE(res, 'budget_exhausted', { tokens_used: tokensUsed, budget_total: budgetTotal });
}

export function writeSessionTerminated(res: Response, reason: string, guardLevel: number, message: string): void {
  writeSSE(res, 'session_terminated', { reason, guard_level: guardLevel, message });
}

export function writeError(res: Response, code: string, message: string): void {
  writeSSE(res, 'error', { code, message });
}

export function writeStreamEnd(res: Response): void {
  writeSSE(res, 'stream_end');
  res.end();
}
