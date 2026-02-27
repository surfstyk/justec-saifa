const DEFAULT_TTL_MS = 3600000; // 1 hour

interface BlockEntry {
  blockedAt: number;
  ttlMs: number;
}

const blocklist = new Map<string, BlockEntry>();

export function blockIp(ipHash: string, ttlMs: number = DEFAULT_TTL_MS): void {
  blocklist.set(ipHash, { blockedAt: Date.now(), ttlMs });
}

export function isBlocked(ipHash: string): boolean {
  const entry = blocklist.get(ipHash);
  if (!entry) return false;

  if (Date.now() - entry.blockedAt > entry.ttlMs) {
    blocklist.delete(ipHash);
    return false;
  }

  return true;
}

export function unblockIp(ipHash: string): void {
  blocklist.delete(ipHash);
}

export function cleanupBlocklist(): void {
  const now = Date.now();
  for (const [key, entry] of blocklist) {
    if (now - entry.blockedAt > entry.ttlMs) {
      blocklist.delete(key);
    }
  }
}
