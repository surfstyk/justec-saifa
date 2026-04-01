import { Router } from 'express';
import { getSession, closeSession, verifySessionToken } from '../session/manager.js';
import type { CloseReason } from '../types.js';

const router = Router();

router.post('/api/session/:id/close', (req, res) => {
  const sessionId = req.params.id;

  // Handle sendBeacon text/plain (Content-Type may be text/plain;charset=UTF-8)
  let reason: CloseReason = 'visitor_left';
  let token: string | undefined;

  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed.reason) reason = parsed.reason;
      if (parsed.session_token) token = parsed.session_token;
    } catch {
      // Ignore parse errors from sendBeacon
    }
  } else if (req.body) {
    if (req.body.reason) reason = req.body.reason;
    if (req.body.session_token) token = req.body.session_token;
  }

  // Also accept from Authorization header (non-sendBeacon callers)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  const session = getSession(sessionId);
  if (!session) {
    // Session may already be expired — that's fine for close
    res.json({ status: 'closed', reason });
    return;
  }

  // Verify token
  if (!token || !verifySessionToken(session, token)) {
    res.status(403).json({ error: 'invalid_token', message: 'Invalid session authorization.' });
    return;
  }

  closeSession(sessionId, reason);
  res.json({ status: 'closed', reason });
});

export default router;
