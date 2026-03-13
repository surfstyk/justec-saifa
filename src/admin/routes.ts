import { Router } from 'express';
import { adminAuth } from './middleware.js';
import { renderOverview } from './templates/overview.js';
import { renderSessions } from './templates/sessions.js';
import { renderSessionDetail } from './templates/session-detail.js';
import { renderPrompts } from './templates/prompts.js';
import { renderConfig } from './templates/config.js';

const router = Router();

// All admin routes require authentication
router.use('/admin', adminAuth);

// Overview
router.get('/admin/', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderOverview());
});

router.get('/admin', (_req, res) => {
  res.redirect('/admin/');
});

// Active Sessions
router.get('/admin/sessions', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderSessions());
});

// Session Detail
router.get('/admin/sessions/:id', (req, res) => {
  res.set('Content-Type', 'text/html').send(renderSessionDetail(req.params.id));
});

// Prompts
router.get('/admin/prompts', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderPrompts());
});

// Config
router.get('/admin/config', (_req, res) => {
  res.set('Content-Type', 'text/html').send(renderConfig());
});

export default router;
