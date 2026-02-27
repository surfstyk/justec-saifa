import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import type { Session } from '../types.js';

const router = Router();

router.get('/api/session/:id/history', sessionLookup, (req, res) => {
  const session = res.locals.session as Session;

  const messages = session.history.map(msg => ({
    role: msg.role,
    content: msg.content,
    action: msg.action ?? undefined,
    timestamp: msg.timestamp,
    structured: msg.structured,
  }));

  res.json({ messages });
});

export default router;
