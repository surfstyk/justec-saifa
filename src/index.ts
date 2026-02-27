import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { getDb } from './db/sqlite.js';
import { startExpiryTimer, stopExpiryTimer } from './session/manager.js';
import { cleanupBlocklist } from './security/ip-blocklist.js';
import { cleanupRateLimits } from './security/rate-limiter.js';
import { cleanupRapidFireMap } from './security/input-filter.js';
import healthRoutes from './routes/health.js';
import sessionRoutes from './routes/session.js';
import statusRoutes from './routes/status.js';
import stateRoutes from './routes/state.js';
import historyRoutes from './routes/history.js';
import consentRoutes from './routes/consent.js';
import languageRoutes from './routes/language.js';
import closeRoutes from './routes/close.js';
import messageRoutes from './routes/message.js';
import webhookRoutes from './routes/webhooks.js';

const config = loadConfig();
const app = express();

// Initialize database
getDb();

// CORS
const corsOrigin = config.dev_mode
  ? true
  : config.client.cors_origins;

app.use(cors({
  origin: corsOrigin,
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-ID', 'X-Turnstile-Token'],
}));

// Webhook routes (before body parsing — Stripe needs raw body)
app.use(webhookRoutes);

// Body parsing (10kb limit)
app.use(express.json({ limit: '10kb' }));
app.use(express.text({ limit: '10kb', type: 'text/plain' }));

// Request logger
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
  });
  next();
});

// Routes
app.use(healthRoutes);
app.use(sessionRoutes);
app.use(statusRoutes);
app.use(stateRoutes);
app.use(historyRoutes);
app.use(consentRoutes);
app.use(languageRoutes);
app.use(closeRoutes);
app.use(messageRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message, err.stack);
  res.status(500).json({
    error: 'internal_error',
    message: 'Something went wrong. Please try again.',
  });
});

// Start session expiry timer
startExpiryTimer();

// Periodic security cleanup (every 5 minutes)
const securityCleanupInterval = setInterval(() => {
  cleanupBlocklist();
  cleanupRateLimits();
  cleanupRapidFireMap();
}, 300000);

// Start server
const server = app.listen(config.port, () => {
  console.log(`[saifa] Server running on port ${config.port} (dev_mode: ${config.dev_mode})`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[saifa] ${signal} received, shutting down...`);
  stopExpiryTimer();
  clearInterval(securityCleanupInterval);
  server.close(() => {
    console.log('[saifa] Server closed');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
