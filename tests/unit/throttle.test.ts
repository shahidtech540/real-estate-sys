import { describe, expect, it } from "vitest";
import {
  applyFailure,
  checkLock,
  emptyThrottleRow,
  nextLockMinutes,
  THROTTLE,
  type ThrottleRow,
} from "@/modules/identity/throttle";

/**
 * Login throttle — `API.md` §2.2 / API-Q4: 10 consecutive failures inside a
 * 15-minute window lock the account for 15 minutes, doubling to 30 and 60 for
 * repeats inside 24 hours; a success clears the row.
 */
const T0 = new Date("2026-10-20T09:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function failTimes(
  count: number,
  row: ThrottleRow | null = null,
  at = T0,
): ThrottleRow {
  let current = row;
  for (let i = 0; i < count; i += 1) current = applyFailure(current, at);
  return current ?? emptyThrottleRow();
}

describe("failure window", () => {
  it("locks after the tenth failure inside fifteen minutes", () => {
    const afterNine = failTimes(9);
    expect(afterNine.failedCount).toBe(9);
    expect(afterNine.lockedUntil).toBeNull();

    const afterTen = applyFailure(afterNine, T0);
    expect(afterTen.lockedUntil?.toISOString()).toBe(
      "2026-10-20T09:15:00.000Z",
    );
  });

  it("starts a new window when the first failure is older than 15 minutes", () => {
    const first = applyFailure(null, T0);
    const stale = { ...first, failedCount: 9 };
    const next = applyFailure(stale, minutes(16));
    expect(next.failedCount).toBe(1);
    expect(next.lockedUntil).toBeNull();
    expect(next.firstFailedAt).toEqual(minutes(16));
  });

  it("keeps the window when failures are close together", () => {
    const first = applyFailure(null, T0);
    const second = applyFailure(first, minutes(14));
    expect(second.failedCount).toBe(2);
    expect(second.firstFailedAt).toEqual(T0);
  });

  it("blocks with a Retry-After in whole seconds", () => {
    const locked = failTimes(10);
    const decision = checkLock(locked, new Date("2026-10-20T09:05:30.500Z"));
    expect(decision.locked).toBe(true);
    expect(decision.retryAfterSeconds).toBe(570);
  });

  it("is open again after the lock expires", () => {
    const locked = failTimes(10);
    expect(checkLock(locked, new Date("2026-10-20T09:15:00.000Z")).locked).toBe(
      false,
    );
  });

  it("does not lock for an unknown email differently — state is keyed by email only", () => {
    const locked = failTimes(10);
    expect(checkLock(locked, minutes(1)).locked).toBe(true);
  });
});

describe("escalation ladder (API-Q4)", () => {
  it("is 15, then 30, then 60, then 60", () => {
    const first = failTimes(10, null, T0);
    expect(nextLockMinutes(first, minutes(20))).toBe(30);

    const second = failTimes(10, first, minutes(20));
    expect(second.lockedUntil).toEqual(minutes(50));
    expect(nextLockMinutes(second, minutes(60))).toBe(60);

    const third = failTimes(10, second, minutes(60));
    expect(nextLockMinutes(third, minutes(130))).toBe(60);
  });

  it("forgets the ladder after 24 quiet hours", () => {
    const first = failTimes(10, null, T0);
    expect(
      nextLockMinutes(first, new Date(T0.getTime() + 25 * 3_600_000)),
    ).toBe(15);
  });

  it("never exceeds the last step", () => {
    expect(THROTTLE.ladderMinutes[THROTTLE.ladderMinutes.length - 1]).toBe(60);
  });
});
