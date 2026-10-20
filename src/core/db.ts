import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton — `ARCHITECTURE.md` §5.12 (`core/db`) and §14.2
 * (one process per container). This and each module's `repository.ts` are the
 * only places that touch Prisma (`AGENTS.md` §5.9).
 *
 * `DbClient` is a narrow structural view of the generated client. It exists so
 * the rest of the codebase is typed even when the generated client is absent:
 * `prisma generate` needs to download an engine, which the build sandbox cannot
 * reach, so `@prisma/client` there is a stub whose `PrismaClient` is `any`.
 * The single cast at `db()` is the only untyped boundary; a generated client is
 * structurally compatible with this interface (every method is declared in
 * bivariant method position). See the PR's "Tooling note".
 */
type Args = Record<string, unknown>;

interface Delegate {
  findUnique(args: Args): Promise<unknown>;
  findFirst(args: Args): Promise<unknown>;
  findMany(args: Args): Promise<unknown[]>;
  create(args: Args): Promise<unknown>;
  update(args: Args): Promise<unknown>;
  /**
   * The compare-and-swap primitive — `DATABASE.md` §1.7. A conditional
   * `updateMany` reports how many rows matched, which is how SET-6/SET-7 learn
   * that `version` was stale without a read-then-compare race.
   */
  updateMany(args: Args): Promise<{ count: number }>;
  upsert(args: Args): Promise<unknown>;
  count(args: Args): Promise<number>;
  deleteMany(args: Args): Promise<unknown>;
}

export interface DbClient {
  user: Delegate;
  session: Delegate;
  loginThrottle: Delegate;
  /**
   * `company`/`project` are the Setup module's tables; `buyer` is read-only and
   * only for the file-lifecycle union: `ARCHITECTURE.md` §7.5 and
   * `DATABASE.md` §3.11 require the "is this object still referenced?" check to
   * look at all three reference columns (company logo, project master plan,
   * buyer photo), which the file owner (`core`) performs.
   */
  company: Delegate;
  project: Delegate;
  buyer: Delegate;
  fileObject: Delegate;
  jobRun: Delegate;
  auditLog: Omit<Delegate, "update" | "updateMany" | "upsert" | "deleteMany">;
  $transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
}

/**
 * Lazy on purpose: importing a module during `next build` must not open a pool,
 * and the first request fails with a configuration error rather than a crash at
 * module evaluation.
 */
const globalForPrisma = globalThis as unknown as { spmPrisma?: DbClient };

export function db(): DbClient {
  if (!globalForPrisma.spmPrisma) {
    // The stub client is `any` when the engine could not be downloaded. This is
    // the only untyped construction in the codebase; callers see `DbClient`.
    // The generated client is structurally compatible with `DbClient`; the
    // double assertion keeps this file compiling both with a generated client
    // and with the untyped stub (no engine download in the sandbox).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const created = new PrismaClient({
      log:
        process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    }) as unknown as DbClient;
    globalForPrisma.spmPrisma = created;
  }
  return globalForPrisma.spmPrisma;
}

/**
 * The transaction-scoped client handed to the callback of `prisma.$transaction`.
 * Collaborators accept the caller's `Tx` and never open their own
 * (`AGENTS.md` §5.7).
 */
export type Tx = DbClient;
export type Db = DbClient;

/** Postgres unique-violation detection without depending on Prisma's error class. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Postgres deadlock (`40P01`) mapped to the retryable conflict of `API.md` §1.6. */
export function isDeadlock(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2034" || code === "40001" || code === "40P01";
}
