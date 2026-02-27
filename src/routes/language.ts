import { Router } from 'express';
import { sessionLookup } from '../middleware/session-lookup.js';
import { updateSession } from '../session/manager.js';
import { getConfig } from '../config.js';
import type { Language, Session } from '../types.js';

const router = Router();
const VALID_LANGUAGES: Language[] = ['en', 'de', 'pt'];

router.post('/api/session/:id/language', sessionLookup, (req, res) => {
  const session = res.locals.session as Session;
  const { language } = req.body as { language?: string };

  if (!language || !VALID_LANGUAGES.includes(language as Language)) {
    res.status(400).json({ error: 'invalid_request', message: 'language must be one of: en, de, pt' });
    return;
  }

  const lang = language as Language;
  session.language = lang;
  session.visitor_info.language = lang;
  updateSession(session);

  res.json({
    status: 'ok',
    language: lang,
    greeting: getConfig().greetings[lang],
  });
});

export default router;
