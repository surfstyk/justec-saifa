import { Router } from 'express';
import { getConfig } from '../config.js';

const router = Router();
const startTime = Date.now();

// Public health check
router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.2.0',
    active_sessions: 0, // Updated by session manager later
    queue_length: 0,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  });
});

// Detailed health check (localhost only)
router.get('/api/health/detailed', (req, res) => {
  const remoteIp = req.ip || req.socket.remoteAddress || '';
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';

  if (!isLocal) {
    res.status(403).json({ error: 'forbidden', message: 'Detailed health is localhost only' });
    return;
  }

  const config = getConfig();
  res.json({
    status: 'ok',
    version: '2.2.0',
    active_sessions: 0,
    queue_length: 0,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    llm: {
      provider: config.llm.lobby.provider,
      model: config.llm.lobby.model,
      last_call_ms: null,
      errors_last_hour: 0,
    },
    database: {
      status: 'ok',
    },
  });
});

export default router;
