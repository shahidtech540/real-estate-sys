import { capabilitiesFor, type Capability } from "@/core/authz/policy";
import type { SessionRecord, UserRecord } from "./repository";

/**
 * The only place a Prisma row becomes a wire object — `AGENTS.md` §5.4 ("never
 * `JSON.stringify` a Prisma row"). Shapes are `API.md` §1.9 `User`,
 * `SessionUser`, `SessionInfo`. `passwordHash` is never selected into a DTO.
 */

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: "EN" | "UR";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUserDto {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
  preferredLanguage: "EN" | "UR";
  mustChangePassword: boolean;
}

export interface SessionInfoDto {
  user: SessionUserDto;
  capabilities: Capability[];
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    preferredLanguage: user.preferredLanguage,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toSessionUserDto(user: UserRecord): SessionUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    mustChangePassword: user.mustChangePassword,
  };
}

export function toSessionInfoDto(
  user: UserRecord,
  session: Pick<SessionRecord, "idleExpiresAt" | "absoluteExpiresAt">,
): SessionInfoDto {
  return {
    user: toSessionUserDto(user),
    capabilities: capabilitiesFor(user.role),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}
