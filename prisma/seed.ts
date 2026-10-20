import { PrismaClient } from "@prisma/client";

/**
 * Demo seed — `ARCHITECTURE.md` §4.1 (`prisma/seed.ts`) and `AGENTS.md` AG-Q5.
 *
 * Phase 2 needs **one company** and **one project** (`IMPLEMENTATION-PLAN.md`
 * §1.6, §2.6): SET-1 answers `404 COMPANY_NOT_CONFIGURED` until the singleton
 * exists, every later screen header reads it, and SET-3…SET-7 need a project to
 * list. Blocks join in the next Phase-2 PR, plots in §3.6, buyers and the demo
 * booking in §4.6 — this file grows one phase at a time, never ahead of the
 * module that reads it.
 *
 * Rules this file keeps:
 * - **Deterministic** ids (`AGENTS.md` AG-Q5), so `npm run db:reset` recreates
 *   the same dataset.
 * - **Idempotent**: each row is looked up first and left untouched when present
 *   — never an upsert that would rewrite an Admin's real data.
 * - **Synthetic only** — no real PII (`DATABASE.md` §9, `AGENTS.md` §7.4).
 * - `pdf_terms_text` stays `null`: the wording is a pending client deliverable
 *   and inventing legal copy is forbidden (`AGENTS.md` AG-Q11).
 * - Every constraint is satisfied rather than bypassed: `ck_company_marla`
 *   (`DATABASE.md` §3.2), `uq_company_singleton` (§6.2), `uq_project_company_name`,
 *   `ck_project_marla` and `ck_project_plan_dims` (§3.2). The seeded project
 *   deliberately has **no** master plan — `npm run db:seed` cannot upload an
 *   image, and a fabricated `file_object` would fail the checksum/kind rules.
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

const DEMO_PROJECT = {
  id: "7b2c3d4e-5f60-4a71-8b92-c3d4e5f6a702",
  name: "Green City Phase 1",
  location: "Bahria Town, Lahore",
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
  project: {
    findFirst(args: {
      where: { companyId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: typeof DEMO_PROJECT & { companyId: string };
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
    // ---- company (singleton) ------------------------------------------------
    let company = await prisma.company.findFirst({ select: { id: true } });
    if (company) {
      // Never overwrite an Admin's real company profile on a re-run.
      console.log(`seed: company already present (${company.id}) — skipped`);
    } else {
      company = await prisma.company.create({
        data: DEMO_COMPANY,
        select: { id: true },
      });
      console.log(`seed: created demo company ${company.id}`);
    }

    // ---- project (one per company) -----------------------------------------
    const existingProject = await prisma.project.findFirst({
      where: { companyId: company.id },
      select: { id: true },
    });
    if (existingProject) {
      console.log(
        `seed: project already present (${existingProject.id}) — skipped`,
      );
      return;
    }

    const project = await prisma.project.create({
      data: { ...DEMO_PROJECT, companyId: company.id },
      select: { id: true },
    });
    console.log(`seed: created demo project ${project.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
