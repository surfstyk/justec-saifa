import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config.js';

let cachedCredentials: { username: string; passwordHash: string } | null = null;

function loadCredentials(): { username: string; passwordHash: string } | null {
  if (cachedCredentials) return cachedCredentials;

  const config = getConfig();
  const credPath = resolve(config.credentials_path, 'admin_password');

  try {
    const raw = readFileSync(credPath, 'utf-8').trim();
    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) return null;

    cachedCredentials = {
      username: raw.slice(0, colonIdx),
      passwordHash: raw.slice(colonIdx + 1),
    };
    return cachedCredentials;
  } catch {
    return null;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function verifyPassword(password: string, storedHash: string): boolean {
  // Support plain sha256 hashes (format: sha256:<hash>)
  if (storedHash.startsWith('sha256:')) {
    return sha256(password) === storedHash.slice(7);
  }
  // Fallback: direct comparison (for simple setups)
  return sha256(password) === storedHash;
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();

  // Dev mode bypass
  if (config.dev_mode) {
    next();
    return;
  }

  const credentials = loadCredentials();
  if (!credentials) {
    // No credentials file — block access in production
    res.status(503).set('Content-Type', 'text/plain').send('Admin not configured');
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.status(401)
      .set('WWW-Authenticate', 'Basic realm="SAIFA Admin"')
      .set('Content-Type', 'text/plain')
      .send('Authentication required');
    return;
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    res.status(401)
      .set('WWW-Authenticate', 'Basic realm="SAIFA Admin"')
      .send('Invalid credentials');
    return;
  }

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  if (username !== credentials.username || !verifyPassword(password, credentials.passwordHash)) {
    res.status(401)
      .set('WWW-Authenticate', 'Basic realm="SAIFA Admin"')
      .send('Invalid credentials');
    return;
  }

  next();
}
