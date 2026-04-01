import type { Request, Response, NextFunction } from 'express';
import { getSession, verifySessionToken } from '../session/manager.js';

export function sessionLookup(req: Request, res: Response, next: NextFunction): void {
  const raw = req.params.id || req.headers['x-session-id'];
  const sessionId = Array.isArray(raw) ? raw[0] : raw;

  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    res.status(400).json({ error: 'invalid_request', message: 'Invalid or missing session ID' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'session_not_found', message: 'Session not found or expired' });
    return;
  }

  if (session.status === 'closed') {
    res.status(410).json({ error: 'session_closed', message: 'This conversation has been ended.' });
    return;
  }

  // Verify session token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(403).json({ error: 'invalid_token', message: 'Missing or malformed authorization.' });
    return;
  }

  const token = authHeader.slice(7);
  if (!verifySessionToken(session, token)) {
    res.status(403).json({ error: 'invalid_token', message: 'Invalid session authorization.' });
    return;
  }

  res.locals.session = session;
  next();
}
