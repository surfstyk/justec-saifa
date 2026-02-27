import { getConfig } from '../config.js';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const sessionLimits = new Map<string, RateLimitEntry>();
const ipLimits = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

/**
 * Check per-session message rate limit.
 */
export function checkSessionLimit(sessionId: string): RateLimitResult {
  const config = getConfig();
  const limit = config.rate_limits.messages_per_session;

  let entry = sessionLimits.get(sessionId);
  if (!entry) {
    entry = { count: 0, windowStart: Date.now() };
    sessionLimits.set(sessionId, entry);
  }

  entry.count++;

  const remaining = Math.max(0, limit - entry.count);
  const resetAt = Math.floor((entry.windowStart + 3600000) / 1000); // 1 hour from session start

  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfterSeconds: 60,
    };
  }

  return { allowed: true, remaining, limit, resetAt };
}

/**
 * Check per-IP hourly rate limit.
 */
export function checkIpLimit(ipHash: string): RateLimitResult {
  const config = getConfig();
  const limit = config.rate_limits.messages_per_ip_per_hour;
  const windowMs = 3600000; // 1 hour
  const now = Date.now();

  let entry = ipLimits.get(ipHash);
  if (!entry || (now - entry.windowStart) > windowMs) {
    entry = { count: 0, windowStart: now };
    ipLimits.set(ipHash, entry);
  }

  entry.count++;

  const remaining = Math.max(0, limit - entry.count);
  const resetAt = Math.floor((entry.windowStart + windowMs) / 1000);

  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfterSeconds: Math.ceil((entry.windowStart + windowMs - now) / 1000),
    };
  }

  return { allowed: true, remaining, limit, resetAt };
}

/**
 * Set rate limit headers on the response.
 */
export function setRateLimitHeaders(
  res: { setHeader(name: string, value: string | number): void },
  result: RateLimitResult,
): void {
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Reset', result.resetAt);
}

/**
 * Clean up expired entries.
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  const windowMs = 3600000;

  for (const [key, entry] of ipLimits) {
    if ((now - entry.windowStart) > windowMs) ipLimits.delete(key);
  }
}
