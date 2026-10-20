import { z } from "zod";

/**
 * Environment configuration — `ARCHITECTURE.md` §5.12 (`core/config`:
 * "Zod-validated environment; fail fast on missing/malformed values").
 *
 * Parsed lazily so that `next build` (which imports route modules) does not need
 * a database URL, while the first real request fails loudly if the environment is
 * wrong. Keys come from `AGENTS.md` AG-Q4 and `.env.example`.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Idle window in minutes (`ARCHITECTURE.md` §6.1: 30). */
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  /** Absolute cap in hours (`ARCHITECTURE.md` §6.1: 12). */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  /** Business timezone (`ARCHITECTURE.md` §12.7). */
  PKT_TZ: z.string().default("Asia/Karachi"),
  /** Local file store root — `ARCHITECTURE.md` §7.2 defaults to /srv/spm/files. */
  FILE_STORE: z.enum(["local"]).default("local"),
  FILE_STORE_ROOT: z.string().default("/srv/spm/files"),
  /** Bearer token for COR-4 (`API.md` §3.12). Required in production. */
  HEALTH_DETAILS_TOKEN: z.string().optional(),
  REMINDER_MODE: z.enum(["dry_run", "live"]).default("dry_run"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${detail}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    !parsed.data.HEALTH_DETAILS_TOKEN
  ) {
    // AGENTS.md §5.10: fail fast rather than silently exposing a tokenless route.
    throw new Error("HEALTH_DETAILS_TOKEN is required in production");
  }
  cached = parsed.data;
  return parsed.data;
}

/** Test helper: forget the parsed environment after mutating `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function sessionLifetimes(): { idleMs: number; absoluteMs: number } {
  const { SESSION_IDLE_MINUTES, SESSION_ABSOLUTE_HOURS } = env();
  return {
    idleMs: SESSION_IDLE_MINUTES * 60_000,
    absoluteMs: SESSION_ABSOLUTE_HOURS * 60 * 60_000,
  };
}
