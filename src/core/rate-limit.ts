/**
 * Per-user rate limits — `API.md` §6 ("Limits are per authenticated user, not
 * per IP, for the four heavy endpoints"). Phase 1 needs one: COR-1 uploads,
 * 10 per minute.
 *
 * Storage is an in-process sliding window. That is sufficient for the deployment
 * shape of `ARCHITECTURE.md` §14.2 (one web process, one worker; the worker
 * never accepts HTTP) and needs no Redis, which `ARCHITECTURE.md` §3.1 rejects
 * for this project. A restart resets the counters; the Nginx layer carries the
 * per-IP limits that must survive (`ARCHITECTURE.md` §6.4).
 */

interface Window {
  timestamps: number[];
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  const recent = bucket.timestamps.filter((stamp) => stamp > cutoff);
  if (recent.length >= limit) {
    const earliest = recent[0] ?? now;
    buckets.set(key, { timestamps: recent });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((earliest + windowMs - now) / 1000),
      ),
    };
  }
  recent.push(now);
  buckets.set(key, { timestamps: recent });
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper: drop all windows. */
export function resetRateLimits(): void {
  buckets.clear();
}
