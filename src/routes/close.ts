import { Router } from 'express';
import { getSession, closeSession } from '../session/manager.js';
import type { CloseReason } from '../types.js';

const router = Router();

router.post('/api/session/:id/close', (req, res) => {
  const sessionId = req.params.id;

  // Handle sendBeacon text/plain (Content-Type may be text/plain;charset=UTF-8)
  let reason: CloseReason = 'visitor_left';
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed.reason) reason = parsed.reason;
    } catch {
      // Ignore parse errors from sendBeacon
    }
  } else if (req.body?.reason) {
    reason = req.body.reason;
  }

  const session = getSession(sessionId);
  if (!session) {
    // Session may already be expired — that's fine for close
    res.json({ status: 'closed', reason });
    return;
  }

  closeSession(sessionId, reason);
  res.json({ status: 'closed', reason });
});

export default router;
