import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import { updateSession } from '../session/manager.js';
import type { Session } from '../types.js';

const router = Router();

router.post('/api/session/:id/consent', sessionLookup, (req, res) => {
  const session = res.locals.session as Session;
  const { consent } = req.body as { consent?: boolean };

  if (typeof consent !== 'boolean') {
    res.status(400).json({ error: 'invalid_request', message: 'consent must be a boolean' });
    return;
  }

  session.consent = consent ? 'granted' : 'declined';
  updateSession(session);

  res.json({
    status: 'ok',
    consent,
    mode: consent ? 'full' : 'stateless',
  });
});

export default router;
