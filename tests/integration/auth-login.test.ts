import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * End-to-end login flow against a real PostgreSQL database: login → session →
 * lockout → logout, including the rows each step writes.
 *
 * Requires `TEST_DATABASE_URL` pointing at a database that has the migration
 * set applied (`npx prisma migrate deploy`) and a generated client
 * (`npx prisma generate`). CI provides both (`.github/workflows/ci.yml`);
 * without the variable the suite is skipped so `npm run test:unit` stays pure.
 *
 * `API.md` §2.1, §2.2, §2.4; `ARCHITECTURE.md` §6.1.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = "integration-password-123";
/** Unique per run: `audit_log` rows cannot be deleted, so runs must not collide. */
const EMAIL = `integration-${Date.now()}@example.test`;

describe.skipIf(!databaseUrl)("login flow (integration)", () => {
  // Created in `beforeAll`: the constructor throws when no client was generated.
  let prisma: PrismaClient;
  type Identity = typeof import("@/modules/identity/commands");
  type SessionService = typeof import("@/modules/identity/session-service");
  let login: Identity["login"];
  let logout: Identity["logout"];
  let resolveSession: SessionService["resolveSession"];
  let userId: string;

  const meta = {
    requestId: "it-request",
    ip: "203.0.113.9",
    userAgent: "vitest",
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    process.env.DATABASE_URL = databaseUrl;
    const [{ hashPassword }, commands, sessions, dbModule] = await Promise.all([
      import("@/core/password"),
      import("@/modules/identity/commands"),
      import("@/modules/identity/session-service"),
      import("@/core/db"),
    ]);
    login = commands.login;
    logout = commands.logout;
    resolveSession = sessions.resolveSession;
    // Fail fast if the schema is missing rather than reporting a login failure.
    await dbModule.db().$queryRaw`SELECT 1`;

    await cleanup();
    const user = await prisma.user.create({
      data: {
        name: "Integration Admin",
        email: EMAIL,
        role: "ADMIN",
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 60_000);

  /**
   * Sessions and throttle rows are hard-deletable (`DATABASE.md` §1.6). The
   * user and its audit rows are not: `trg_audit_log_append_only` raises on
   * DELETE and `audit_log.actor_user_id` is `ON DELETE RESTRICT` — which is the
   * guarantee this suite is here to respect, so each run uses a fresh email.
   */
  async function cleanup(): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
    }
    await prisma.loginThrottle.deleteMany({ where: { email: EMAIL } });
  }

  it("rejects a wrong password with the one generic error and records the failure", async () => {
    await expect(
      login({ email: EMAIL, password: "wrong-password" }, meta),
    ).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      status: 401,
    });

    const throttle = await prisma.loginThrottle.findUnique({
      where: { email: EMAIL },
    });
    expect(throttle?.failedCount).toBe(1);

    const failures = await prisma.auditLog.findMany({
      where: { actionCode: "auth.login_failed" },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.actorUserId).toBeNull();
    expect(failures[0]?.actorLabel).toBe("system");
  });

  it("creates a session whose stored value is only the SHA-256 hash", async () => {
    const result = await login({ email: EMAIL, password: PASSWORD }, meta);

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.info.user.email).toBe(EMAIL);
    expect(result.info.capabilities).toContain("user.manage");
    expect(result.info.capabilities).toHaveLength(24);
    expect(result.info.idleExpiresAt).toBeTruthy();

    const tokens = await prisma.session.findMany({ where: { userId } });
    expect(tokens).toHaveLength(1);
    const stored = tokens[0];
    expect(stored.tokenHash).toBe(
      // SHA-256 hex of the raw token; the token itself is never stored.
      (await import("node:crypto"))
        .createHash("sha256")
        .update(result.token)
        .digest("hex"),
    );
    expect(JSON.stringify(stored)).not.toContain(result.token);

    const resolved = await resolveSession(
      (await import("@/core/db")).db(),
      result.token,
      new Date(),
    );
    expect(resolved.status).toBe("ok");

    const logins = await prisma.auditLog.findMany({
      where: { actionCode: "auth.login" },
    });
    expect(logins).toHaveLength(1);
    expect(logins[0]?.actorUserId).toBe(userId);

    await logout(
      { id: userId, name: "Integration Admin", email: EMAIL, role: "ADMIN" },
      stored.id,
      meta,
    );
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    const resolvedAfter = await resolveSession(
      (await import("@/core/db")).db(),
      result.token,
      new Date(),
    );
    expect(resolvedAfter.status).toBe("missing");
  });

  it("locks after ten failures and keeps returning 429 even for the right password", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        login({ email: EMAIL, password: `wrong-${attempt}` }, meta),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }

    await expect(
      login({ email: EMAIL, password: PASSWORD }, meta),
    ).rejects.toMatchObject({
      code: "AUTH_ACCOUNT_THROTTLED",
      status: 429,
    });

    const throttle = await prisma.loginThrottle.findUnique({
      where: { email: EMAIL },
    });
    expect(throttle?.lockedUntil).not.toBeNull();
    await prisma.loginThrottle.delete({ where: { email: EMAIL } });
  }, 120_000);

  it("refuses an inactive user with the same generic error", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    await expect(
      login({ email: EMAIL, password: PASSWORD }, meta),
    ).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
  });
});
