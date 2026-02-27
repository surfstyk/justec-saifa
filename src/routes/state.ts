import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import { getBudget } from '../session/budget.js';
import { getConfig } from '../config.js';
import type { Session } from '../types.js';

const router = Router();

router.get('/api/session/:id/state', sessionLookup, (req, res) => {
  const session = res.locals.session as Session;
  const config = getConfig();
  const budget = getBudget(session);

  res.json({
    session_id: session.id,
    status: session.status,
    tier: session.tier,
    language: session.language,
    consent: session.consent === 'granted',
    score: {
      composite: session.score_composite,
      behavioral: session.score_behavioral,
      explicit: session.score_explicit,
      fit: session.score_fit,
      classification: session.classification,
    },
    visitor: {
      name: session.visitor_info.name,
      company: session.visitor_info.company,
      role: session.visitor_info.role,
    },
    budget: {
      tokens_used: session.tokens_used,
      tokens_remaining: Math.max(0, budget - session.tokens_used),
      messages_sent: session.messages_count,
      messages_limit: config.rate_limits.messages_per_session,
    },
    payment: {
      status: session.payment_status || null,
      provider: session.payment_provider || null,
    },
    booking_time: session.booking_time || null,
    guard_level: session.guard_level,
    created_at: new Date(session.created_at).toISOString(),
  });
});

export default router;
