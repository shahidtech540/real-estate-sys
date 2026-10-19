/**
 * Per-account login throttle — `API.md` §2.2 and API-Q4, `ARCHITECTURE.md` §6.1.
 *
 * Constants (API-Q4, restated in `API.md` §2.2):
 *   • 10 consecutive failures inside a 15-minute window → lock
 *   • lock 15 minutes, doubling to 30 and 60 for repeats inside 24 hours
 *   • a successful login clears the row
 *
 * The thresholds are the *only* numbers this module owns; they are constants so
 * a change is one line (API-Q4: "one constant table in Identity").
 *
 * Escalation without a new column: `login_throttle` has no "lock count"
 * (`DATABASE.md` §3.1), so the previous lock's duration is reconstructed from
 * `locked_until − last_failed_at`. `last_failed_at` is therefore written at the
 * moment a lock is applied — that is what "drives the backoff" means here — and
 * is left alone by ordinary failures. A lock that ended more than 24 h ago is
 * forgotten and the ladder restarts at 15 minutes. This is recorded as a
 * judgment call in the PR (no document fixes the mechanism, only the numbers).
 */
export const THROTTLE = {
  windowMinutes: 15,
  failuresBeforeLock: 10,
  ladderMinutes: [15, 30, 60],
  forgetLockAfterHours: 24,
} as const;

export interface ThrottleRow {
  failedCount: number;
  firstFailedAt: Date | null;
  lastFailedAt: Date | null;
  lockedUntil: Date | null;
}

export interface ThrottleDecision {
  locked: boolean;
  retryAfterSeconds: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export function emptyThrottleRow(): ThrottleRow {
  return {
    failedCount: 0,
    firstFailedAt: null,
    lastFailedAt: null,
    lockedUntil: null,
  };
}

/** Checked **before** password verification (`API.md` §2.2). */
export function checkLock(
  row: ThrottleRow | null,
  now: Date,
): ThrottleDecision {
  if (!row?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const remainingMs = row.lockedUntil.getTime() - now.getTime();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };
  return {
    locked: true,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
  };
}

function previousLockMinutes(
  row: ThrottleRow | null,
  now: Date,
): number | null {
  if (!row?.lockedUntil || !row.lastFailedAt) return null;
  const endedAgoMs = now.getTime() - row.lockedUntil.getTime();
  if (endedAgoMs > THROTTLE.forgetLockAfterHours * HOUR_MS) return null;
  if (endedAgoMs < 0) return null; // currently locked; guarded by checkLock
  const minutes = Math.round(
    (row.lockedUntil.getTime() - row.lastFailedAt.getTime()) / MINUTE_MS,
  );
  return minutes > 0 ? minutes : null;
}

/** 15 → 30 → 60 → 60; 15 again after a quiet 24 h. */
export function nextLockMinutes(row: ThrottleRow | null, now: Date): number {
  const previous = previousLockMinutes(row, now);
  const ladder = THROTTLE.ladderMinutes;
  const last = ladder[ladder.length - 1];
  if (previous === null) return ladder[0];
  const index = ladder.findIndex((step) => step >= previous);
  const nextIndex =
    index === -1 ? ladder.length - 1 : Math.min(index + 1, ladder.length - 1);
  return Math.min(ladder[nextIndex], last);
}

/**
 * The row after one failed password attempt. Pure: the caller persists it
 * (`repository.upsertThrottle`) inside the same transaction as the audit row.
 */
export function applyFailure(row: ThrottleRow | null, now: Date): ThrottleRow {
  const current = row ?? emptyThrottleRow();
  const windowStartedAt = current.firstFailedAt;
  const inWindow =
    windowStartedAt !== null &&
    now.getTime() - windowStartedAt.getTime() <
      THROTTLE.windowMinutes * MINUTE_MS;

  const failedCount = inWindow ? current.failedCount + 1 : 1;
  const firstFailedAt = inWindow ? windowStartedAt : now;

  if (failedCount < THROTTLE.failuresBeforeLock) {
    return {
      ...current,
      failedCount,
      firstFailedAt,
    };
  }

  const lockMinutes = nextLockMinutes(current, now);
  return {
    // A fresh window starts after the lock expires; the lock is the reset point.
    failedCount: 0,
    firstFailedAt: null,
    // The lock start; reconstructs this lock's duration for the next escalation.
    lastFailedAt: now,
    lockedUntil: new Date(now.getTime() + lockMinutes * MINUTE_MS),
  };
}
