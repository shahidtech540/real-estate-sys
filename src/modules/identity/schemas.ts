import { z } from "zod";

/**
 * Request schemas for the 13 identity/auth endpoints — `API.md` §2.4, §3.1.
 * Every external value is parsed here before use (`AGENTS.md` §5.1).
 */

const email = z
  .string()
  .trim()
  .max(320)
  .email()
  // Stored lowercase (`ck_app_user_email_lower`, DATABASE.md §3.1).
  .transform((value) => value.toLowerCase());

/** Login is shape-validated only; a weak password is still a credential check. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const languageSchema = z.object({
  preferredLanguage: z.enum(["EN", "UR"]),
});
export type LanguageInput = z.infer<typeof languageSchema>;

/**
 * Bounded, not policy-checked: the 12–128 rule is a command-level rule so a
 * violation is `422 PASSWORD_POLICY_VIOLATION`, not `400` (`API.md` §2.4).
 */
export const passwordField = z.string().min(1).max(1024);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * `phone` is `text` for staff and deliberately has no buyer-phone format rule
 * (`DATABASE.md` §3.1); it is bounded, not pattern-checked.
 */
const staffPhone = z.string().trim().min(3).max(32);

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email,
  phone: staffPhone.nullish(),
  role: z.enum(["ADMIN", "SALES_AGENT", "ACCOUNTANT"]),
  password: passwordField,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** `PATCH /api/users/{id}` — no `version`: `app_user` has none (`API.md` §3.1 IDN-6). */
export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: staffPhone.nullish(),
  role: z.enum(["ADMIN", "SALES_AGENT", "ACCOUNTANT"]).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** `GET /api/users` — `API.md` §1.5 pagination, IDN-3 filters. */
export const listUsersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(["ADMIN", "SALES_AGENT", "ACCOUNTANT"]).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["name", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Path parameter of IDN-5…8; a non-UUID id can never match, so it is a validation error. */
export const userIdParamSchema = z.string().uuid();
