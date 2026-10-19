import { AppError } from "@/core/errors";
import { db } from "@/core/db";
import { capabilitiesFor, requireCapability } from "@/core/authz/policy";
import * as repo from "./repository";
import { refreshSession, type SessionContext } from "./session-service";
import type { SessionInfoDto, UserDto } from "./dto";
import { toSessionInfoDto, toUserDto } from "./dto";
import type { ListUsersQuery } from "./schemas";
import type { Actor } from "./commands";

/** Queries for Identity — `API.md` §2.4 AUTH-3, §3.1 IDN-1, IDN-3, IDN-5. */

/**
 * `GET /api/auth/session` (AUTH-3). Read-only: it deliberately does **not**
 * touch `last_seen_at` — that is AUTH-4 (`API.md` AUTH-3).
 */
export function sessionInfo(context: SessionContext): SessionInfoDto {
  return toSessionInfoDto(context.user, context.session);
}

/** `POST /api/auth/refresh` (AUTH-4): slide the idle window, then report it. */
export async function refresh(
  context: SessionContext,
): Promise<SessionInfoDto> {
  const refreshed = await refreshSession(db(), context);
  return toSessionInfoDto(refreshed.user, refreshed.session);
}

/** `GET /api/me` (IDN-1). Capabilities are derived, never stored. */
export function me(context: SessionContext): {
  user: UserDto;
  capabilities: string[];
} {
  return {
    user: toUserDto(context.user),
    capabilities: capabilitiesFor(context.user.role),
  };
}

export interface PageDto<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** `GET /api/users` (IDN-3), Admin · `user.manage`. */
export async function listUsers(
  actor: Actor,
  query: ListUsersQuery,
): Promise<PageDto<UserDto>> {
  requireCapability(actor, "user.manage");
  const order = query.order ?? (query.sort === "createdAt" ? "desc" : "asc");
  const { data, total } = await repo.listUsers(db(), {
    q: query.q,
    role: query.role,
    isActive:
      query.isActive === undefined ? undefined : query.isActive === "true",
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    order,
  });
  return {
    data: data.map(toUserDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** `GET /api/users/{id}` (IDN-5), Admin · `user.manage`. */
export async function getUser(actor: Actor, userId: string): Promise<UserDto> {
  requireCapability(actor, "user.manage");
  const user = await repo.findUserById(db(), userId);
  if (!user) throw new AppError("USER_NOT_FOUND");
  return toUserDto(user);
}
