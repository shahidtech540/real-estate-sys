import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * SET-1/SET-2 against a real PostgreSQL — `AGENTS.md` §7.1–§7.2, `API.md`
 * §3.2, §4 (V-14, V-19, V-27) and `DATABASE.md` §3.2/§6.2.
 *
 * Requires `TEST_DATABASE_URL` pointing at a database with the migration set
 * applied (`npx prisma migrate deploy`); CI supplies it. Without the variable
 * the suite is skipped so `npm run test:unit` stays pure.
 *
 * The company table is **reset at the start of the suite**: the first-run cases
 * must not assume the demo seed is present (`AGENTS.md` §7.4: integration tests
 * create their own data; `DATABASE.md` §10.6).
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = "integration-password-123";

/**
 * Audit-failure injection for the atomicity test. `vi.hoisted` so the factory
 * below can see it; the flag is false for every other test in this file.
 */
const auditState = vi.hoisted(() => ({ fail: false }));

vi.mock("@/modules/audit/record", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/audit/record")>();
  return {
    ...actual,
    record: async (...args: Parameters<typeof actual.record>) => {
      if (auditState.fail) throw new Error("audit write failed (test)");
      return actual.record(...args);
    },
  };
});

describe.skipIf(!databaseUrl)(
  "company profile SET-1/SET-2 (integration)",
  () => {
    let prisma: PrismaClient;

    type Setup = typeof import("@/modules/setup");
    type Schemas = typeof import("@/modules/setup/schemas");
    type CompanyRoute = typeof import("@/app/api/company/route");
    type IdentityCommands = typeof import("@/modules/identity/commands");

    let setup: Setup;
    let schema: Schemas;
    let companyRoute: CompanyRoute;
    let identity: IdentityCommands;
    let sessionCookie: string;

    interface TestUser {
      id: string;
      name: string;
      email: string;
      role: "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
    }

    const stamp = Date.now();
    const users: Record<"admin" | "sales" | "accountant", TestUser> = {
      admin: {
        id: "",
        name: "Integration Admin",
        email: `company-admin-${stamp}@example.test`,
        role: "ADMIN",
      },
      sales: {
        id: "",
        name: "Integration Sales",
        email: `company-sales-${stamp}@example.test`,
        role: "SALES_AGENT",
      },
      accountant: {
        id: "",
        name: "Integration Accountant",
        email: `company-accountant-${stamp}@example.test`,
        role: "ACCOUNTANT",
      },
    };
    const cookies: Record<"admin" | "sales" | "accountant", string> = {
      admin: "",
      sales: "",
      accountant: "",
    };

    const meta = {
      requestId: "it-company",
      ip: "203.0.113.9",
      userAgent: "vitest",
    };

    const validBody = {
      name: "Green City Developers",
      address: "12 Mall Road, Lahore",
      phone: "+924200000000",
      email: "info@example.test",
      pdfTermsText: "Payment is due on the date printed above.",
      marlaSqft: "225.00",
      logoFileId: null,
    };

    beforeAll(async () => {
      if (!databaseUrl) return;
      prisma = new PrismaClient();
      process.env.DATABASE_URL = databaseUrl;

      const [
        setupModule,
        schemaModule,
        routeModule,
        identityModule,
        dbModule,
        passwordModule,
        sessionModule,
      ] = await Promise.all([
        import("@/modules/setup"),
        import("@/modules/setup/schemas"),
        import("@/app/api/company/route"),
        import("@/modules/identity/commands"),
        import("@/core/db"),
        import("@/core/password"),
        import("@/core/session"),
      ]);

      setup = setupModule;
      schema = schemaModule;
      companyRoute = routeModule;
      identity = identityModule;
      sessionCookie = sessionModule.SESSION_COOKIE;

      // Fail fast if the schema is missing rather than reporting business errors.
      await dbModule.db().$queryRaw`SELECT 1`;

      await resetCompanyFixture();

      for (const key of ["admin", "sales", "accountant"] as const) {
        const created = await prisma.user.create({
          data: {
            name: users[key].name,
            email: users[key].email,
            role: users[key].role,
            passwordHash: await passwordModule.hashPassword(PASSWORD),
          },
        });
        users[key].id = created.id;

        const loggedIn = await identity.login(
          { email: users[key].email, password: PASSWORD },
          { ...meta, requestId: `it-login-${key}` },
        );
        cookies[key] = `${sessionCookie}=${loggedIn.token}`;
      }
    }, 120_000);

    afterAll(async () => {
      // Sessions are hard-deletable; users and audit rows are not
      // (`DATABASE.md` §1.6, §3.10), so each run uses fresh emails.
      if (prisma) {
        await prisma.session.deleteMany({
          where: {
            userId: { in: Object.values(users).map((user) => user.id) },
          },
        });
        await prisma.$disconnect();
      }
    }, 60_000);

    /** The first-run fixture: no company row (`DATABASE.md` §10.6). */
    async function resetCompanyFixture(): Promise<void> {
      // `project.company_id` is ON DELETE RESTRICT; nothing in this phase creates
      // projects, so this is normally a no-op and never silently cascades.
      await prisma.project.deleteMany({});
      await prisma.company.deleteMany({});
    }

    function actor(key: "admin" | "sales" | "accountant") {
      return {
        id: users[key].id,
        name: users[key].name,
        email: users[key].email,
        role: users[key].role,
      };
    }

    function request(
      method: "GET" | "PUT",
      options: {
        cookie?: string;
        body?: unknown;
        origin?: string;
        requestId?: string;
      } = {},
    ): Request {
      const headers: Record<string, string> = {
        // `assertSameOrigin` prefers `x-forwarded-host` (API.md §1.10); undici
        // drops a hand-set `Host`, so the proxied header is what the test uses.
        "x-forwarded-host": "localhost:3000",
        "x-request-id": options.requestId ?? `it-${method.toLowerCase()}`,
        origin: options.origin ?? "http://localhost:3000",
      };
      if (options.cookie) headers.cookie = options.cookie;
      if (options.body !== undefined)
        headers["content-type"] = "application/json";
      return new Request("http://localhost:3000/api/company", {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    }

    interface ErrorEnvelopeBody {
      error: {
        code: string;
        message: string;
        requestId: string;
        fields?: Record<string, string>;
      };
    }

    async function envelope(response: Response): Promise<ErrorEnvelopeBody> {
      return (await response.json()) as ErrorEnvelopeBody;
    }

    let fileCounter = 0;

    /** A `file_object` row that satisfies every `DATABASE.md` §3.11 CHECK. */
    async function createFile(
      kind: "COMPANY_LOGO" | "MASTER_PLAN" | "BUYER_PHOTO",
      options: { deletedAt?: Date } = {},
    ): Promise<string> {
      fileCounter += 1;
      const sha256 = randomBytes(32).toString("hex");
      const created = await prisma.fileObject.create({
        data: {
          kind,
          // ck_file_object_key — <kind>/<xx>/<yy>/<sha256>.<ext>
          storageKey: `${kind}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.png`,
          originalFilename: `integration-${fileCounter}.png`,
          mimeType: "image/png",
          byteSize: BigInt(1024 + fileCounter),
          sha256,
          widthPx: null,
          heightPx: null,
          deletedAt: options.deletedAt ?? null,
        },
      });
      return created.id;
    }

    /** The singleton row, required — every caller runs after the create case. */
    async function requireCompany() {
      const row = await prisma.company.findFirst();
      if (!row) throw new Error("expected the company singleton to exist");
      return row;
    }

    function countAudit(actionCode: string): Promise<number> {
      return prisma.auditLog.count({ where: { actionCode } });
    }

    // -------------------------------------------------------------------------
    // First run — the empty state is a documented state, not an error
    // -------------------------------------------------------------------------

    describe("first run", () => {
      it("SET-1 answers 404 COMPANY_NOT_CONFIGURED before the singleton exists", async () => {
        await expect(setup.getCompany()).rejects.toMatchObject({
          code: "COMPANY_NOT_CONFIGURED",
          status: 404,
        });

        const response = await companyRoute.GET(
          request("GET", { cookie: cookies.admin }),
        );
        expect(response.status).toBe(404);
        const body = await envelope(response);
        expect(body.error.code).toBe("COMPANY_NOT_CONFIGURED");
        expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
      });

      it("SET-1 requires a session and never leaks company data to an anonymous caller", async () => {
        const response = await companyRoute.GET(request("GET"));
        expect(response.status).toBe(401);
        expect((await envelope(response)).error.code).toBe("AUTH_REQUIRED");
      });

      it("the database rejects marla_sqft <= 0 (ck_company_marla)", async () => {
        await expect(
          prisma.company.create({ data: { name: "Bad Marla", marlaSqft: 0 } }),
        ).rejects.toThrow();
        await expect(
          prisma.company.create({
            data: { name: "Negative Marla", marlaSqft: -1 },
          }),
        ).rejects.toThrow();
        expect(await prisma.company.count()).toBe(0);
      });

      it("SET-2 is Admin-only — Sales and Accountant are refused before any write", async () => {
        for (const key of ["sales", "accountant"] as const) {
          await expect(
            setup.putCompany(actor(key), validBody, meta),
          ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN", status: 403 });

          const response = await companyRoute.PUT(
            request("PUT", { cookie: cookies[key], body: validBody }),
          );
          expect(response.status).toBe(403);
          expect((await envelope(response)).error.code).toBe("AUTH_FORBIDDEN");
        }
        expect(await prisma.company.count()).toBe(0);
      });

      it("SET-2 rejects a cross-origin PUT with 403 CSRF_ORIGIN_REJECTED", async () => {
        const response = await companyRoute.PUT(
          request("PUT", {
            cookie: cookies.admin,
            body: validBody,
            origin: "https://evil.example",
          }),
        );
        expect(response.status).toBe(403);
        expect((await envelope(response)).error.code).toBe(
          "CSRF_ORIGIN_REJECTED",
        );
        expect(await prisma.company.count()).toBe(0);
      });

      it("creates the singleton on the first PUT with 201 + Location", async () => {
        const response = await companyRoute.PUT(
          request("PUT", { cookie: cookies.admin, body: validBody }),
        );
        expect(response.status).toBe(201);
        expect(response.headers.get("location")).toBe("/api/company");

        const dto = (await response.json()) as Record<string, unknown>;
        expect(dto.name).toBe(validBody.name);
        expect(dto.marlaSqft).toBe("225.00");
        expect(dto.logo).toBeNull();
        expect(typeof dto.updatedAt).toBe("string");
        expect(String(dto.updatedAt)).toMatch(/Z$/);

        const row = await requireCompany();
        expect(row.logoFileId).toBeNull();
        expect(row.address).toBe(validBody.address);
      });

      it("serves SET-1 to every authenticated role", async () => {
        for (const key of ["admin", "sales", "accountant"] as const) {
          const response = await companyRoute.GET(
            request("GET", { cookie: cookies[key] }),
          );
          expect(response.status).toBe(200);
          const dto = (await response.json()) as {
            name: string;
            marlaSqft: string;
          };
          expect(dto.name).toBe(validBody.name);
          expect(dto.marlaSqft).toBe("225.00");
        }
      });

      it("the database rejects a second company row (uq_company_singleton)", async () => {
        await expect(
          prisma.company.create({
            data: { name: "Second Company", marlaSqft: 225 },
          }),
        ).rejects.toThrow();
        expect(await prisma.company.count()).toBe(1);
      });
    });

    // -------------------------------------------------------------------------
    // Full replace
    // -------------------------------------------------------------------------

    describe("SET-2 full replace", () => {
      it("updates with 200 and clears omitted optional text to null", async () => {
        const response = await companyRoute.PUT(
          request("PUT", {
            cookie: cookies.admin,
            body: { name: "Green City Developers", marlaSqft: "226.50" },
          }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();

        const dto = (await response.json()) as {
          name: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          pdfTermsText: string | null;
          marlaSqft: string;
          logo: unknown;
        };
        expect(dto.address).toBeNull();
        expect(dto.phone).toBeNull();
        expect(dto.email).toBeNull();
        expect(dto.pdfTermsText).toBeNull();
        expect(dto.marlaSqft).toBe("226.50");
        expect(dto.logo).toBeNull();

        const row = await requireCompany();
        expect(row.address).toBeNull();
        expect(row.phone).toBeNull();
        expect(row.email).toBeNull();
        expect(row.pdfTermsText).toBeNull();
        expect(String(row.marlaSqft)).toBe("226.5");
      });

      it("writes one company.updated audit row naming the changed fields only", async () => {
        const row = await prisma.auditLog.findFirst({
          where: { actionCode: "company.updated" },
          orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        if (!row) return;
        expect(row.entityType).toBe("company");
        expect(row.entityId).toBe((await requireCompany()).id);

        const summary = row.summary as unknown as { fields: string[] };
        expect(summary.fields).toEqual(
          expect.arrayContaining([
            "address",
            "phone",
            "email",
            "pdfTermsText",
            "marlaSqft",
          ]),
        );
        expect(summary.fields).not.toContain("name");
        // No contact details in the summary (ARCHITECTURE.md §13.2).
        expect(JSON.stringify(summary)).not.toContain("info@example.test");
        expect(JSON.stringify(summary)).not.toContain("Mall Road");
      });

      it("returns 422 VALIDATION_FAILED for a well-formed non-positive marlaSqft", async () => {
        for (const value of ["0", "0.00", "-5.00"]) {
          const response = await companyRoute.PUT(
            request("PUT", {
              cookie: cookies.admin,
              body: { ...validBody, marlaSqft: value },
            }),
          );
          expect(response.status).toBe(422);
          const body = await envelope(response);
          expect(body.error.code).toBe("VALIDATION_FAILED");
          expect(body.error.fields).toEqual({ marlaSqft: "TOO_SMALL" });
        }
        expect(String((await requireCompany()).marlaSqft)).toBe("226.5");
      });

      it("returns 400 for shape failures — blank name, bad email, malformed marla, unknown key, missing marla", async () => {
        const cases: Array<{ body: unknown; field: string }> = [
          { body: { ...validBody, name: "   " }, field: "name" },
          { body: { ...validBody, email: "not-an-email" }, field: "email" },
          { body: { ...validBody, marlaSqft: "abc" }, field: "marlaSqft" },
          { body: { ...validBody, marlaSqft: "225.000" }, field: "marlaSqft" },
          {
            body: { ...validBody, name: "A", unknownField: true },
            // Zod reports an unrecognized key at the object root, so the
            // envelope names the root path `_` (core/http.ts).
            field: "_",
          },
          { body: { name: "Only a name" }, field: "marlaSqft" },
        ];
        for (const testCase of cases) {
          const response = await companyRoute.PUT(
            request("PUT", { cookie: cookies.admin, body: testCase.body }),
          );
          expect(response.status).toBe(400);
          const body = await envelope(response);
          expect(body.error.code).toBe("VALIDATION_FAILED");
          expect(Object.keys(body.error.fields ?? {})).toContain(
            testCase.field,
          );
        }
        expect(await prisma.company.count()).toBe(1);
      });
    });

    // -------------------------------------------------------------------------
    // Logo binding and replacement
    // -------------------------------------------------------------------------

    describe("logo binding (V-14, ARCHITECTURE.md §7.5)", () => {
      it("rejects an unknown file id with 404 FILE_NOT_FOUND", async () => {
        await expect(
          setup.putCompany(
            actor("admin"),
            { ...validBody, marlaSqft: "226.50", logoFileId: randomUUID() },
            meta,
          ),
        ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 });
        expect((await requireCompany()).logoFileId).toBeNull();
      });

      it("rejects a soft-deleted file with 404 FILE_NOT_FOUND", async () => {
        const deleted = await createFile("COMPANY_LOGO", {
          deletedAt: new Date(),
        });
        await expect(
          setup.putCompany(
            actor("admin"),
            { ...validBody, marlaSqft: "226.50", logoFileId: deleted },
            meta,
          ),
        ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 });
        expect((await requireCompany()).logoFileId).toBeNull();
      });

      it("rejects a live object of the wrong kind with 422 FILE_KIND_MISMATCH", async () => {
        const plan = await createFile("MASTER_PLAN");
        await expect(
          setup.putCompany(
            actor("admin"),
            { ...validBody, marlaSqft: "226.50", logoFileId: plan },
            meta,
          ),
        ).rejects.toMatchObject({ code: "FILE_KIND_MISMATCH", status: 422 });
        expect((await requireCompany()).logoFileId).toBeNull();
      });

      it("binds by file_object id and returns the FileRef", async () => {
        const logo = await createFile("COMPANY_LOGO");
        const result = await setup.putCompany(
          actor("admin"),
          { ...validBody, marlaSqft: "226.50", logoFileId: logo },
          { ...meta, requestId: "it-logo-bind" },
        );

        expect(result.created).toBe(false);
        expect(result.company.logo).toEqual({
          id: logo,
          url: `/api/files/${logo}`,
        });
        expect((await requireCompany()).logoFileId).toBe(logo);
        expect(
          (await prisma.fileObject.findUnique({ where: { id: logo } }))
            ?.deletedAt,
        ).toBeNull();

        const audit = await prisma.auditLog.findFirst({
          where: { actionCode: "company.updated" },
          orderBy: { id: "desc" },
        });
        const summary = audit?.summary as unknown as { fields: string[] };
        expect(summary.fields).toContain("logoFileId");
        // The id is allowed in the summary; a storage key never is.
        expect(JSON.stringify(summary)).not.toMatch(/COMPANY_LOGO\//);
      });

      it("soft-deletes the replaced logo only after nothing references it", async () => {
        const first = (await requireCompany()).logoFileId;
        expect(first).not.toBeNull();
        const second = await createFile("COMPANY_LOGO");

        const result = await setup.putCompany(
          actor("admin"),
          { ...validBody, marlaSqft: "226.50", logoFileId: second },
          { ...meta, requestId: "it-logo-replace" },
        );
        expect(result.company.logo?.id).toBe(second);

        const oldFile = await prisma.fileObject.findUnique({
          where: { id: first ?? "" },
        });
        const newFile = await prisma.fileObject.findUnique({
          where: { id: second },
        });
        expect(oldFile?.deletedAt).not.toBeNull();
        expect(newFile?.deletedAt).toBeNull();
      });

      it("keeps the current object when the same logo is re-submitted", async () => {
        const current = (await requireCompany()).logoFileId ?? "";
        await setup.putCompany(
          actor("admin"),
          { ...validBody, marlaSqft: "226.50", logoFileId: current },
          { ...meta, requestId: "it-logo-same" },
        );
        expect(
          (await prisma.fileObject.findUnique({ where: { id: current } }))
            ?.deletedAt,
        ).toBeNull();
      });

      it("clears the logo with null and soft-deletes the unreferenced object", async () => {
        const current = (await requireCompany()).logoFileId ?? "";
        const response = await companyRoute.PUT(
          request("PUT", {
            cookie: cookies.admin,
            body: { ...validBody, marlaSqft: "226.50", logoFileId: null },
          }),
        );
        expect(response.status).toBe(200);
        expect(((await response.json()) as { logo: unknown }).logo).toBeNull();
        expect((await requireCompany()).logoFileId).toBeNull();
        expect(
          (await prisma.fileObject.findUnique({ where: { id: current } }))
            ?.deletedAt,
        ).not.toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    // The concurrent first-run race
    // -------------------------------------------------------------------------

    describe("simultaneous first-run PUTs", () => {
      it("creates exactly one row and one company.created audit row", async () => {
        // Back to the unconfigured state; no audit row is removed (§13.3).
        await resetCompanyFixture();

        const createdBefore = await countAudit("company.created");
        const updatedBefore = await countAudit("company.updated");

        const results = await Promise.all([
          setup.putCompany(actor("admin"), validBody, {
            ...meta,
            requestId: "it-race-a",
          }),
          setup.putCompany(actor("admin"), validBody, {
            ...meta,
            requestId: "it-race-b",
          }),
        ]);

        // One create (201) and one update (200) — `uq_company_singleton` proves it.
        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(await prisma.company.count()).toBe(1);
        expect(await countAudit("company.created")).toBe(createdBefore + 1);
        expect(await countAudit("company.updated")).toBe(updatedBefore + 1);

        const row = await requireCompany();
        expect(row.name).toBe(validBody.name);
        expect(row.address).toBe(validBody.address);
      });
    });

    // -------------------------------------------------------------------------
    // Audit atomicity and content
    // -------------------------------------------------------------------------

    describe("audit", () => {
      it("records the creation with field names and ids only", async () => {
        const row = await prisma.auditLog.findFirst({
          where: { actionCode: "company.created" },
          orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        if (!row) return;
        expect(row.entityType).toBe("company");
        expect(row.entityId).toBe((await requireCompany()).id);
        expect(row.actorUserId).toBe(users.admin.id);
        expect(row.actorLabel).toBe(users.admin.name);

        const summary = row.summary as unknown as { fields: string[] };
        expect(summary.fields).toEqual(
          expect.arrayContaining(["name", "address", "marlaSqft"]),
        );
        expect(JSON.stringify(summary)).not.toContain("Green City");
        expect(JSON.stringify(summary)).not.toContain("Mall Road");
      });

      it("rolls the company write back when the audit insert fails", async () => {
        const before = await requireCompany();
        const auditBefore = await countAudit("company.updated");

        auditState.fail = true;
        try {
          await expect(
            setup.putCompany(
              actor("admin"),
              { ...validBody, name: "Should Roll Back" },
              { ...meta, requestId: "it-audit-fail" },
            ),
          ).rejects.toThrow(/audit write failed/);
        } finally {
          auditState.fail = false;
        }

        const after = await requireCompany();
        expect(after.name).toBe(before.name);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
        expect(await countAudit("company.updated")).toBe(auditBefore);
      });
    });

    it("parses the documented body with the shared schema", () => {
      expect(schema.companyBodySchema.safeParse(validBody).success).toBe(true);
    });
  },
);
