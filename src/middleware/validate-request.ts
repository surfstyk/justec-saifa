import type { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSessionId(req: Request, res: Response, next: NextFunction): void {
  const id = req.params.id as string | undefined;
  if (!id || !UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'invalid_request', message: 'Invalid session ID format' });
    return;
  }
  next();
}

export function validateJsonBody(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['content-type'] && !req.headers['content-type'].includes('application/json') && !req.headers['content-type'].includes('text/plain')) {
    res.status(400).json({ error: 'invalid_request', message: 'Content-Type must be application/json' });
    return;
  }
  next();
}
