import { db, type Db } from "@/core/db";
import type { ThrottleRow } from "./throttle";

/**
 * The only file in the Identity module that talks to Prisma
 * (`ARCHITECTURE.md` §4.4 rule 4, `AGENTS.md` §5.9). Commands and queries accept
 * a `Db`/`Tx` and pass it down; nothing here opens its own transaction.
 *
 * Row types are structural so the module reads the same once the generated
 * Prisma types are available; every field maps 1:1 to `DATABASE.md` §3.1.
 */
export type UserRoleValue = "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
export type PreferredLanguageValue = "EN" | "UR";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRoleValue;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: PreferredLanguageValue;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}

const userSelection = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  passwordHash: true,
  isActive: true,
  mustChangePassword: true,
  preferredLanguage: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function findUserByEmail(
  client: Db,
  email: string,
): Promise<UserRecord | null> {
  return (await client.user.findUnique({
    where: { email },
    select: userSelection,
  })) as UserRecord | null;
}

export async function findUserById(
  client: Db,
  id: string,
): Promise<UserRecord | null> {
  return (await client.user.findUnique({
    where: { id },
    select: userSelection,
  })) as UserRecord | null;
}

export interface CreateUserData {
  name: string;
  email: string;
  phone: string | null;
  role: UserRoleValue;
  passwordHash: string;
}

export async function insertUser(
  client: Db,
  data: CreateUserData,
): Promise<UserRecord> {
  return (await client.user.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      passwordHash: data.passwordHash,
    },
    select: userSelection,
  })) as UserRecord;
}

export interface UpdateUserData {
  name?: string;
  phone?: string | null;
  role?: UserRoleValue;
  isActive?: boolean;
}

export async function updateUser(
  client: Db,
  id: string,
  data: UpdateUserData,
): Promise<UserRecord> {
  return (await client.user.update({
    where: { id },
    data,
    select: userSelection,
  })) as UserRecord;
}

export async function setPassword(
  client: Db,
  id: string,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<UserRecord> {
  return (await client.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword },
    select: userSelection,
  })) as UserRecord;
}

export async function markLogin(
  client: Db,
  id: string,
  lastLoginAt: Date,
): Promise<void> {
  await client.user.update({ where: { id }, data: { lastLoginAt } });
}

export async function setPreferredLanguage(
  client: Db,
  id: string,
  preferredLanguage: PreferredLanguageValue,
): Promise<void> {
  await client.user.update({ where: { id }, data: { preferredLanguage } });
}

export interface UserListFilters {
  q?: string;
  role?: UserRoleValue;
  isActive?: boolean;
  page: number;
  pageSize: number;
  sort: "name" | "createdAt";
  order: "asc" | "desc";
}

function userWhere(filters: UserListFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filters.role) where.role = filters.role;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listUsers(
  client: Db,
  filters: UserListFilters,
): Promise<{ data: UserRecord[]; total: number }> {
  const where = userWhere(filters);
  const [data, total] = await Promise.all([
    client.user.findMany({
      where,
      select: userSelection,
      orderBy: { [filters.sort]: filters.order },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }) as Promise<UserRecord[]>,
    client.user.count({ where }),
  ]);
  return { data, total };
}

/** `ix_app_user_role_active` — the "at least one active Admin" read (`API.md` IDN-6). */
export async function countOtherActiveAdmins(
  client: Db,
  excludeUserId: string,
): Promise<number> {
  return await client.user.count({
    where: { role: "ADMIN", isActive: true, id: { not: excludeUserId } },
  });
}

// ---------------------------------------------------------------------------
// login_throttle — DATABASE.md §3.1
// ---------------------------------------------------------------------------

export async function findThrottle(
  client: Db,
  email: string,
): Promise<ThrottleRow | null> {
  const row = (await client.loginThrottle.findUnique({
    where: { email },
  })) as ThrottleRow | null;
  return row;
}

export async function upsertThrottle(
  client: Db,
  email: string,
  row: ThrottleRow,
): Promise<void> {
  await client.loginThrottle.upsert({
    where: { email },
    create: { email, ...row },
    update: row,
  });
}

/** Success and unlock both delete the row (`API.md` §2.2, IDN-8). */
export async function deleteThrottle(client: Db, email: string): Promise<void> {
  await client.loginThrottle.deleteMany({ where: { email } });
}

// ---------------------------------------------------------------------------
// session — DATABASE.md §3.1
// ---------------------------------------------------------------------------

export interface CreateSessionData {
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export async function insertSession(
  client: Db,
  data: CreateSessionData,
): Promise<SessionRecord> {
  return (await client.session.create({
    data,
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      createdAt: true,
      lastSeenAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
    },
  })) as SessionRecord;
}

export async function findSessionWithUser(
  client: Db,
  tokenHash: string,
): Promise<SessionWithUser | null> {
  const row = (await client.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      createdAt: true,
      lastSeenAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      user: { select: userSelection },
    },
  })) as (SessionRecord & { user: UserRecord }) | null;
  if (!row) return null;
  const { user, ...session } = row;
  return { session, user };
}

export async function deleteSessionById(client: Db, id: string): Promise<void> {
  await client.session.deleteMany({ where: { id } });
}

export async function deleteSessionByTokenHash(
  client: Db,
  tokenHash: string,
): Promise<void> {
  await client.session.deleteMany({ where: { tokenHash } });
}

/** Password change keeps the current session and deletes the rest (`API.md` AUTH-5). */
export async function deleteOtherSessions(
  client: Db,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await client.session.deleteMany({
    where: { userId, id: { not: keepSessionId } },
  });
}

export async function deleteSessionsForUser(
  client: Db,
  userId: string,
): Promise<void> {
  await client.session.deleteMany({ where: { userId } });
}

export async function touchSession(
  client: Db,
  id: string,
  lastSeenAt: Date,
  idleExpiresAt: Date,
): Promise<void> {
  await client.session.update({
    where: { id },
    data: { lastSeenAt, idleExpiresAt },
  });
}

export function client(): Db {
  return db();
}
