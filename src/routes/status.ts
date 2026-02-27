import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import type { Session } from '../types.js';

const router = Router();

router.get('/api/session/:id/status', sessionLookup, (req, res) => {
  const session = res.locals.session as Session;

  res.json({
    session_id: session.id,
    status: session.status,
    tier: session.tier,
    messages_count: session.messages_count,
    last_message_role: session.history.length > 0
      ? session.history[session.history.length - 1].role
      : null,
    consent: session.consent === 'granted',
  });
});

export default router;
