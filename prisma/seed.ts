import { PrismaClient } from "@prisma/client";

/**
 * Demo seed — `ARCHITECTURE.md` §4.1 (`prisma/seed.ts`) and `AGENTS.md` AG-Q5.
 *
 * Phase 2 first needs **exactly one company row** (`IMPLEMENTATION-PLAN.md`
 * §1.6, §2.6): SET-1 answers `404 COMPANY_NOT_CONFIGURED` until it exists, and
 * every later screen header reads it. The project and blocks join in the next
 * Phase-2 PRs, plots in §3.6, buyers and the demo booking in §4.6 — this file
 * grows one phase at a time, never ahead of the module that reads it.
 *
 * Rules this file keeps:
 * - **Deterministic** ids (`AGENTS.md` AG-Q5), so `npm run db:reset` recreates
 *   the same dataset.
 * - **Idempotent**: an existing company is left untouched, and the singleton is
 *   checked first rather than inserted blindly, because `uq_company_singleton`
 *   (`DATABASE.md` §6.2) makes a second row impossible.
 * - **Synthetic only** — no real PII (`DATABASE.md` §9, `AGENTS.md` §7.4).
 * - `pdf_terms_text` stays `null`: the wording is a pending client deliverable
 *   and inventing legal copy is forbidden (`AGENTS.md` AG-Q11).
 * - `marla_sqft` is the PRD D-1 default of 225.00 and satisfies
 *   `ck_company_marla` (`DATABASE.md` §3.2).
 */

const DEMO_COMPANY = {
  id: "6f1a2c3d-4b5e-4f60-8a91-b2c3d4e5f601",
  name: "Green City Developers (Demo)",
  address: "Demo Office, 1 Example Road, Lahore",
  phone: "+920000000000",
  email: "demo@example.test",
  pdfTermsText: null,
  marlaSqft: "225.00",
} as const;

/**
 * The narrow structural view this script needs. Same reason as `core/db.ts`
 * (`DbClient`): when the Prisma engine cannot be downloaded, the generated
 * client is `any`, and the seed still has to type-check strictly.
 */
interface SeedClient {
  company: {
    findFirst(args: { select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: typeof DEMO_COMPANY;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  $disconnect(): Promise<void>;
}

async function main(): Promise<void> {
  // The single untyped boundary, as in `core/db.ts` — see that file's note.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const prisma = new PrismaClient() as unknown as SeedClient;

  try {
    const existing = await prisma.company.findFirst({ select: { id: true } });
    if (existing) {
      // Never overwrite an Admin's real company profile on a re-run.
      console.log(`seed: company already present (${existing.id}) — skipped`);
      return;
    }

    const company = await prisma.company.create({
      data: DEMO_COMPANY,
      select: { id: true },
    });
    console.log(`seed: created demo company ${company.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
