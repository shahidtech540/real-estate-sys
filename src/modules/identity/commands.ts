import { randomInt } from "node:crypto";
import { AppError } from "@/core/errors";
import { db, isUniqueViolation, type Tx } from "@/core/db";
import { requireCapability } from "@/core/authz/policy";
import {
  checkPasswordPolicy,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "@/core/password";
import { record } from "@/modules/audit/record";
import { recordLoginFailure } from "@/modules/audit/standalone";
import { applyFailure, checkLock } from "./throttle";
import * as repo from "./repository";
import { issueSession, revokeAll, revokeOthers } from "./session-service";
import type { SessionInfoDto, UserDto } from "./dto";
import { toSessionInfoDto, toUserDto } from "./dto";
import type {
  ChangePasswordInput,
  CreateUserInput,
  LanguageInput,
  LoginInput,
  UpdateUserInput,
} from "./schemas";

/**
 * Commands for Identity — `API.md` §2.4 (AUTH-1…5) and §3.1 (IDN-2, IDN-4,
 * IDN-6, IDN-7, IDN-8). Each function checks its capability itself
 * (`ARCHITECTURE.md` §6.3 layer 3) and writes its audit row in the same
 * transaction as the change (`ARCHITECTURE.md` §13.1).
 */

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
}

export interface RequestMeta {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// AUTH-1 — login
// ---------------------------------------------------------------------------

export interface LoginResult {
  token: string;
  info: SessionInfoDto;
}

/**
 * `POST /api/auth/login` (`API.md` §2.4 AUTH-1).
 *
 * Order is fixed by `API.md` §2.2: **lock check → password verify →** success or
 * failure. The lock check comes first so a correct password during a lockout
 * still returns `429` and never becomes an oracle.
 */
export async function login(
  input: LoginInput,
  meta: RequestMeta,
): Promise<LoginResult> {
  const now = new Date();
  const client = db();

  const throttle = await repo.findThrottle(client, input.email);
  const lock = checkLock(throttle, now);
  if (lock.locked) {
    throw new AppError("AUTH_ACCOUNT_THROTTLED", {
      retryAfterSeconds: lock.retryAfterSeconds,
    });
  }

  const user = await repo.findUserByEmail(client, input.email);
  // Always hash: the dummy verifies for an unknown email so timing is uniform
  // (`ARCHITECTURE.md` §6.1).
  const passwordOk = await verifyPassword(
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    input.password,
  );
  const authenticated = user !== null && passwordOk && user.isActive;

  if (!authenticated || !user) {
    await recordFailure(input.email, now);
    // Login-failure rows have no transaction and no actor (`ARCHITECTURE.md` §13.6).
    await recordLoginFailure({
      entityType: "session",
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {},
    });
    // One generic message for unknown email, wrong password and inactive user.
    throw new AppError("AUTH_INVALID_CREDENTIALS");
  }

  const issued = await client.$transaction(async (tx: Tx) => {
    // Re-read inside the transaction: the account may have been deactivated
    // between the verify and the insert.
    const current = await repo.findUserById(tx, user.id);
    if (!current?.isActive) throw new AppError("AUTH_INVALID_CREDENTIALS");

    // A successful login clears the throttle row (`API.md` §2.2).
    await repo.deleteThrottle(tx, input.email);

    const created = await issueSession(tx, current.id, meta, now);
    await repo.markLogin(tx, current.id, now);

    await record(tx, {
      action: "auth.login",
      entityType: "session",
      entityId: created.session.id,
      actor: { id: current.id, label: current.name },
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {},
    });
    return { created, current };
  });

  return {
    token: issued.created.token,
    info: toSessionInfoDto(issued.current, issued.created.session),
  };
}

async function recordFailure(email: string, now: Date): Promise<void> {
  const client = db();
  const write = async (): Promise<void> => {
    await client.$transaction(async (tx: Tx) => {
      const row = await repo.findThrottle(tx, email);
      await repo.upsertThrottle(tx, email, applyFailure(row, now));
    });
  };

  try {
    await write();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Two simultaneous first failures both tried to INSERT the row: one wins,
    // the other retries as an UPDATE. Under this rare race one increment can be
    // lost, which does not weaken a 10-failure lockout (`API.md` §6).
    await write();
  }
}

// ---------------------------------------------------------------------------
// AUTH-2 — logout
// ---------------------------------------------------------------------------

/** `POST /api/auth/logout` (`API.md` §2.4 AUTH-2): audit before the delete. */
export async function logout(
  actor: Actor,
  sessionId: string,
  meta: RequestMeta,
): Promise<void> {
  await db().$transaction(async (tx: Tx) => {
    await record(tx, {
      action: "auth.logout",
      entityType: "session",
      entityId: sessionId,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {},
    });
    await tx.session.deleteMany({ where: { id: sessionId } });
  });
}

// ---------------------------------------------------------------------------
// AUTH-5 — change password
// ---------------------------------------------------------------------------

export async function changePassword(
  actor: Actor,
  sessionId: string,
  input: ChangePasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const client = db();
  const user = await repo.findUserById(client, actor.id);
  if (!user) throw new AppError("AUTH_REQUIRED");

  const currentOk = await verifyPassword(
    user.passwordHash,
    input.currentPassword,
  );
  if (!currentOk) {
    throw new AppError("PASSWORD_CURRENT_INVALID", {
      fields: { currentPassword: "INVALID" },
    });
  }
  assertPolicy(input.newPassword, input.currentPassword);
  const passwordHash = await hashPassword(input.newPassword);

  await client.$transaction(async (tx: Tx) => {
    await repo.setPassword(tx, actor.id, passwordHash, false);
    // All other devices are revoked; this session stays valid (`API.md` AUTH-5).
    await revokeOthers(tx, actor.id, sessionId);
    await record(tx, {
      action: "auth.password_changed",
      entityType: "user",
      entityId: actor.id,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {},
    });
  });
}

function assertPolicy(next: string, current: string | undefined): void {
  const violation = checkPasswordPolicy(next, current);
  if (!violation) return;
  const code =
    violation.code === "UNCHANGED" ? "SAME_AS_CURRENT" : violation.code;
  throw new AppError("PASSWORD_POLICY_VIOLATION", {
    fields: { newPassword: code },
  });
}

// ---------------------------------------------------------------------------
// IDN-2 — preferred language
// ---------------------------------------------------------------------------

/** `PATCH /api/me/language` — **not** audited (`API.md` §3.1 IDN-2). */
export async function setLanguage(
  actor: Actor,
  input: LanguageInput,
): Promise<{ preferredLanguage: "EN" | "UR" }> {
  await repo.setPreferredLanguage(db(), actor.id, input.preferredLanguage);
  return { preferredLanguage: input.preferredLanguage };
}

// ---------------------------------------------------------------------------
// IDN-4 — create user
// ---------------------------------------------------------------------------

export async function createUser(
  actor: Actor,
  input: CreateUserInput,
  meta: RequestMeta,
): Promise<UserDto> {
  requireCapability(actor, "user.manage");
  assertPolicy(input.password, undefined);
  const passwordHash = await hashPassword(input.password);
  const client = db();

  try {
    return await client.$transaction(async (tx: Tx) => {
      const created = await repo.insertUser(tx, {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        role: input.role,
        passwordHash,
      });
      await record(tx, {
        action: "user.created",
        entityType: "user",
        entityId: created.id,
        actor: { id: actor.id, label: actor.name },
        requestId: meta.requestId,
        ip: meta.ip,
        summary: { role: created.role },
      });
      return toUserDto(created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("USER_EMAIL_EXISTS", { fields: { email: "EXISTS" } });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// IDN-6 — update user
// ---------------------------------------------------------------------------

export async function updateUser(
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
  meta: RequestMeta,
): Promise<UserDto> {
  requireCapability(actor, "user.manage");
  const client = db();

  return client.$transaction(async (tx: Tx) => {
    const target = await repo.findUserById(tx, userId);
    if (!target) throw new AppError("USER_NOT_FOUND");

    if (target.id === actor.id && input.isActive === false) {
      // `ARCHITECTURE.md` §5.1; `API.md` IDN-6.
      throw new AppError("USER_SELF_DEACTIVATION");
    }

    const losesAdmin =
      target.role === "ADMIN" &&
      target.isActive &&
      (input.isActive === false ||
        (input.role !== undefined && input.role !== "ADMIN"));

    if (losesAdmin) {
      // Lock every active Admin row so two concurrent changes serialize and the
      // second one sees the first (`ARCHITECTURE.md` §6.3, AGENTS.md §9).
      await tx.$queryRaw`SELECT id FROM app_user WHERE role = 'ADMIN' AND is_active = true FOR UPDATE`;
      const others = await repo.countOtherActiveAdmins(tx, target.id);
      if (others === 0) throw new AppError("USER_LAST_ADMIN");
    }

    const roleChanged = input.role !== undefined && input.role !== target.role;
    const deactivated = input.isActive === false && target.isActive;

    const updated = await repo.updateUser(tx, userId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    // Role change or deactivation revokes every session of that user
    // (`ARCHITECTURE.md` §6.1).
    if (roleChanged || deactivated) {
      await revokeAll(tx, userId);
    }

    if (roleChanged) {
      await record(tx, {
        action: "user.role_changed",
        entityType: "user",
        entityId: userId,
        actor: { id: actor.id, label: actor.name },
        requestId: meta.requestId,
        ip: meta.ip,
        summary: { from: target.role, to: updated.role },
      });
    } else if (deactivated) {
      await record(tx, {
        action: "user.deactivated",
        entityType: "user",
        entityId: userId,
        actor: { id: actor.id, label: actor.name },
        requestId: meta.requestId,
        ip: meta.ip,
        summary: {},
      });
    } else {
      await record(tx, {
        action: "user.updated",
        entityType: "user",
        entityId: userId,
        actor: { id: actor.id, label: actor.name },
        requestId: meta.requestId,
        ip: meta.ip,
        summary: { fields: changedFields(target, input) },
      });
    }
    return toUserDto(updated);
  });
}

function changedFields(
  target: repo.UserRecord,
  input: UpdateUserInput,
): string[] {
  const fields: string[] = [];
  if (input.name !== undefined && input.name !== target.name)
    fields.push("name");
  if (input.phone !== undefined && (input.phone ?? null) !== target.phone)
    fields.push("phone");
  if (input.isActive !== undefined && input.isActive !== target.isActive) {
    fields.push("isActive");
  }
  return fields;
}

// ---------------------------------------------------------------------------
// IDN-7 — password reset
// ---------------------------------------------------------------------------

const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 16 characters from an unambiguous alphabet — `API.md` IDN-7. */
export function generateTemporaryPassword(length = 16): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return value;
}

export interface ResetPasswordResult {
  temporaryPassword: string;
  mustChangePassword: true;
}

export async function resetPassword(
  actor: Actor,
  userId: string,
  meta: RequestMeta,
): Promise<ResetPasswordResult> {
  requireCapability(actor, "user.manage");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db().$transaction(async (tx: Tx) => {
    const target = await repo.findUserById(tx, userId);
    if (!target) throw new AppError("USER_NOT_FOUND");

    await repo.setPassword(tx, userId, passwordHash, true);
    await revokeAll(tx, userId);
    await record(tx, {
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      // Never the password (`ARCHITECTURE.md` §13.2).
      summary: {},
    });
  });

  return { temporaryPassword, mustChangePassword: true };
}

// ---------------------------------------------------------------------------
// IDN-8 — unlock
// ---------------------------------------------------------------------------

export async function unlockUser(
  actor: Actor,
  userId: string,
  meta: RequestMeta,
): Promise<void> {
  requireCapability(actor, "user.manage");

  await db().$transaction(async (tx: Tx) => {
    const target = await repo.findUserById(tx, userId);
    // Unknown emails have throttle rows but no user id; only a real user can be
    // unlocked (`API.md` IDN-8).
    if (!target) throw new AppError("USER_NOT_FOUND");

    await repo.deleteThrottle(tx, target.email);
    await record(tx, {
      action: "user.unlocked",
      entityType: "user",
      entityId: userId,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {},
    });
  });
}
