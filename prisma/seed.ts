/**
 * Seed entry point — `ARCHITECTURE.md` §4.1 (`prisma/seed.ts`).
 *
 * Intentionally empty in the Step 8 scaffold: this step ships **no seed data**
 * (DATABASE.md §10.2 defines the reference data, AGENTS.md AG-Q5 defines the
 * demo dataset, and IMPLEMENTATION-PLAN.md §1.6 assigns seeding to Phase 1).
 *
 * Phase 1 replaces this body with the reference roles, cash categories and the
 * synthetic demo dataset. It must never contain real PII (ARCHITECTURE.md §4.1).
 */
async function main(): Promise<void> {
  // No-op until Phase 1 implements the seed (IMPLEMENTATION-PLAN.md §1.6).
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
