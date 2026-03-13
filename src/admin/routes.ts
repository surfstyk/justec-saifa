import { Router } from 'express';
import { adminAuth } from './middleware.js';
import { renderOverview } from './templates/overview.js';
import { renderSessions } from './templates/sessions.js';
import { renderSessionDetail } from './templates/session-detail.js';
import { renderPrompts } from './templates/prompts.js';
import { renderConfig } from './templates/config.js';
import { renderHistory } from './templates/history.js';
import { renderPerformance } from './templates/performance.js';

const router = Router();

// All admin routes require authentication
router.use('/admin/justec', adminAuth);

// Overview
router.get('/admin/justec/', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderOverview());
});

router.get('/admin/justec', (_req, res) => {
  res.redirect('/admin/justec/');
});

// Active Sessions
router.get('/admin/justec/sessions', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderSessions());
});

// Session Detail
router.get('/admin/justec/sessions/:id', (req, res) => {
  res.set('Content-Type', 'text/html').send(renderSessionDetail(req.params.id));
});

// Prompts
router.get('/admin/justec/prompts', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderPrompts());
});

// Config
router.get('/admin/justec/config', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderConfig());
});

// History
router.get('/admin/justec/history', (req, res) => {
  res.set('Content-Type', 'text/html').send(renderHistory(req.query as {
    page?: string;
    per_page?: string;
    classification?: string;
    from?: string;
  }));
});

// Performance
router.get('/admin/justec/performance', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderPerformance());
});

export default router;
