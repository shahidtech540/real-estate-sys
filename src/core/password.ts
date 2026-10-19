import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing — `ARCHITECTURE.md` §6.1: Argon2id, m=64 MiB (65536 KiB),
 * t=3, p=1, target under 250 ms, parameters stored inside the PHC string so a
 * future change needs no migration.
 *
 * `@node-rs/argon2` is a native binding (no WASM startup cost, no JS port);
 * `ARCHITECTURE.md` §3.1 pins it. Hashing runs on the Node runtime, never on
 * Edge, because the API routes declare `export const runtime = 'nodejs'`.
 */
// @node-rs/argon2 exports `Algorithm` as an ambient const enum, which
// `isolatedModules` forbids. 2 is `Argon2id` (0 Argon2d, 1 Argon2i), which is
// the algorithm `ARCHITECTURE.md` §6.1 mandates.
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65_536, // KiB = 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * A precomputed hash of a random throwaway password. When the email is unknown
 * the login handler still verifies against this so the response time does not
 * reveal whether the account exists (`ARCHITECTURE.md` §6.1: "one generic
 * error"; `API.md` §2.1).
 *
 * Generated once with `ARGON2_OPTIONS`; it has no relationship to any account.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$n1HLmVH94WgaE7rgY0J0gA$4nN6Ujhxtk72LK7VsEpQqyDmvCJNn4sSYpPwS6Qr0E8";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Returns `false` on a malformed or foreign hash instead of throwing: a corrupt
 * `password_hash` must read as "wrong password", never as a 500 that leaks state.
 */
export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Password policy — `API.md` §2.4 (API-Q5): 12–128 characters, no composition
 * rules, must differ from the current password. Returned as
 * `422 PASSWORD_POLICY_VIOLATION` with field details.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicyResult {
  code: "TOO_SHORT" | "TOO_LONG" | "UNCHANGED";
}

export function checkPasswordPolicy(
  next: string,
  currentPlain?: string,
): PasswordPolicyResult | null {
  if (next.length < PASSWORD_MIN_LENGTH) return { code: "TOO_SHORT" };
  if (next.length > PASSWORD_MAX_LENGTH) return { code: "TOO_LONG" };
  if (currentPlain !== undefined && next === currentPlain)
    return { code: "UNCHANGED" };
  return null;
}
