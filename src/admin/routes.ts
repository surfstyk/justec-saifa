import { Router } from 'express';
import { adminAuth } from './middleware.js';
import { renderOverview } from './templates/overview.js';
import { renderSessions } from './templates/sessions.js';
import { renderSessionDetail } from './templates/session-detail.js';

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

export default router;
