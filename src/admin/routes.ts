import { Router } from 'express';
import { adminAuth } from './middleware.js';
import { renderOverview } from './templates/overview.js';

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

export default router;
