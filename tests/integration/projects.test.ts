import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * SET-3 … SET-7 against a real PostgreSQL — `AGENTS.md` §7.1–§7.2, `API.md`
 * §3.2, §4 (V-12, V-14, V-18, V-19, V-25, V-27), `DATABASE.md` §1.7/§3.2 and
 * `ARCHITECTURE.md` §7.3/§7.5.
 *
 * Requires `TEST_DATABASE_URL` pointing at a database with the migration set
 * applied; CI supplies it. Without the variable the suite is skipped, so
 * `npm run test:unit` stays pure.
 *
 * The fixture resets `project` then `company`, so the first-run and
 * `COMPANY_NOT_CONFIGURED` cases never assume the demo seed
 * (`DATABASE.md` §10.6, `AGENTS.md` §7.4).
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = "integration-password-123";

/** Audit-failure injection for the three atomicity tests (`vi.hoisted`). */
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

/**
 * Records the capability every command asks for, so the SET-7 assertion can
 * prove it checks `inventory.manage` rather than `setup.manage` — both happen
 * to map to Admin alone (`ARCHITECTURE.md` §6.2), so role behaviour cannot
 * distinguish them.
 */
const capabilityCalls = vi.hoisted(() => [] as string[]);

vi.mock("@/core/authz/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/authz/policy")>();
  return {
    ...actual,
    requireCapability: (
      actor: Parameters<typeof actual.requireCapability>[0],
      capability: Parameters<typeof actual.requireCapability>[1],
    ) => {
      capabilityCalls.push(capability);
      return actual.requireCapability(actor, capability);
    },
  };
});

describe.skipIf(!databaseUrl)("projects SET-3…SET-7 (integration)", () => {
  let prisma: PrismaClient;

  type Setup = typeof import("@/modules/setup");
  type ProjectRoutes = typeof import("@/app/api/projects/route");
  type ProjectRoutesById = typeof import("@/app/api/projects/[id]/route");
  type MasterPlanRoute =
    typeof import("@/app/api/projects/[id]/master-plan/route");
  type IdentityCommands = typeof import("@/modules/identity/commands");

  let setup: Setup;
  let routes: ProjectRoutes;
  let routesById: ProjectRoutesById;
  let masterPlanRoute: MasterPlanRoute;
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
      name: "Projects Admin",
      email: `projects-admin-${stamp}@example.test`,
      role: "ADMIN",
    },
    sales: {
      id: "",
      name: "Projects Sales",
      email: `projects-sales-${stamp}@example.test`,
      role: "SALES_AGENT",
    },
    accountant: {
      id: "",
      name: "Projects Accountant",
      email: `projects-accountant-${stamp}@example.test`,
      role: "ACCOUNTANT",
    },
  };
  const cookies: Record<"admin" | "sales" | "accountant", string> = {
    admin: "",
    sales: "",
    accountant: "",
  };

  const meta = {
    requestId: "it-projects",
    ip: "203.0.113.9",
    userAgent: "vitest",
  };

  let companyId = "";

  beforeAll(async () => {
    if (!databaseUrl) return;
    prisma = new PrismaClient();
    process.env.DATABASE_URL = databaseUrl;

    const [
      setupModule,
      routesModule,
      routesByIdModule,
      masterPlanModule,
      identityModule,
      dbModule,
      passwordModule,
      sessionModule,
    ] = await Promise.all([
      import("@/modules/setup"),
      import("@/app/api/projects/route"),
      import("@/app/api/projects/[id]/route"),
      import("@/app/api/projects/[id]/master-plan/route"),
      import("@/modules/identity/commands"),
      import("@/core/db"),
      import("@/core/password"),
      import("@/core/session"),
    ]);

    setup = setupModule;
    routes = routesModule;
    routesById = routesByIdModule;
    masterPlanRoute = masterPlanModule;
    identity = identityModule;
    sessionCookie = sessionModule.SESSION_COOKIE;

    // Fail fast if the schema is missing rather than reporting business errors.
    await dbModule.db().$queryRaw`SELECT 1`;

    await resetFixture();

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
    if (prisma) {
      await prisma.session.deleteMany({
        where: {
          userId: { in: Object.values(users).map((user) => user.id) },
        },
      });
      await prisma.$disconnect();
    }
  }, 60_000);

  /** `project.company_id` is RESTRICT, so projects go first (`DATABASE.md` §3.2). */
  async function resetFixture(): Promise<void> {
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

  const admin = () => actor("admin");

  function request(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    options: {
      cookie?: string;
      body?: unknown;
      origin?: string;
      requestId?: string;
    } = {},
  ): Request {
    const headers: Record<string, string> = {
      // `assertSameOrigin` prefers `x-forwarded-host`; undici drops `Host`.
      "x-forwarded-host": "localhost:3000",
      "x-request-id":
        options.requestId ?? `it-projects-${method.toLowerCase()}`,
      origin: options.origin ?? "http://localhost:3000",
    };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return new Request(`http://localhost:3000${path}`, {
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

  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  let fileCounter = 0;

  /** A `file_object` row satisfying every `DATABASE.md` §3.11 CHECK. */
  async function createFile(
    kind: "COMPANY_LOGO" | "MASTER_PLAN" | "BUYER_PHOTO",
    options: {
      widthPx?: number | null;
      heightPx?: number | null;
      deletedAt?: Date;
    } = {},
  ): Promise<string> {
    fileCounter += 1;
    const sha256 = randomBytes(32).toString("hex");
    const created = await prisma.fileObject.create({
      data: {
        kind,
        storageKey: `${kind}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.png`,
        originalFilename: `projects-${fileCounter}.png`,
        mimeType: "image/png",
        byteSize: BigInt(2048 + fileCounter),
        sha256,
        widthPx: options.widthPx ?? 4000,
        heightPx: options.heightPx ?? 3000,
        deletedAt: options.deletedAt ?? null,
      },
    });
    return created.id;
  }

  /** Creates the singleton company used by every remaining test. */
  async function ensureCompany(marlaSqft = "225.00"): Promise<void> {
    const company = await setup.putCompany(
      admin(),
      {
        name: "Green City Developers",
        address: null,
        phone: null,
        email: null,
        pdfTermsText: null,
        marlaSqft,
        logoFileId: null,
      },
      meta,
    );
    companyId = company.company.id;
  }

  async function createProject(
    overrides: Partial<{
      name: string;
      location: string | null;
      marlaSqft: string | null;
    }> = {},
  ) {
    return setup.createProject(
      admin(),
      {
        name: overrides.name ?? `Project ${Date.now()}-${fileCounter}`,
        location: overrides.location ?? null,
        marlaSqft: overrides.marlaSqft ?? null,
      },
      meta,
    );
  }

  function countAudit(actionCode: string): Promise<number> {
    return prisma.auditLog.count({ where: { actionCode } });
  }

  function latestAudit(actionCode: string) {
    return prisma.auditLog.findFirst({
      where: { actionCode },
      orderBy: { id: "desc" },
    });
  }

  // -----------------------------------------------------------------------
  // SET-4 first: no company yet
  // -----------------------------------------------------------------------

  describe("SET-4 before the company exists", () => {
    it("answers 404 COMPANY_NOT_CONFIGURED and writes no project", async () => {
      expect(await prisma.company.count()).toBe(0);
      await expect(createProject({ name: "Orphan" })).rejects.toMatchObject({
        code: "COMPANY_NOT_CONFIGURED",
        status: 404,
      });

      const response = await routes.POST(
        request("POST", "/api/projects", {
          cookie: cookies.admin,
          body: { name: "Orphan", location: null, marlaSqft: null },
        }),
      );
      expect(response.status).toBe(404);
      expect((await envelope(response)).error.code).toBe(
        "COMPANY_NOT_CONFIGURED",
      );
      expect(await prisma.project.count()).toBe(0);
    });

    it("lists an empty page before the company exists (SET-3 documents 200 only)", async () => {
      const page = await setup.listProjects(actor("sales"), {
        page: 1,
        pageSize: 50,
        sort: "name",
        order: "asc",
      });
      expect(page).toEqual({ data: [], page: 1, pageSize: 50, total: 0 });

      const response = await routes.GET(
        request("GET", "/api/projects", { cookie: cookies.sales }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: [],
        page: 1,
        pageSize: 50,
        total: 0,
      });
    });

    it("requires a session and an Admin", async () => {
      const anonymous = await routes.POST(
        request("POST", "/api/projects", {
          body: { name: "X", location: null, marlaSqft: null },
        }),
      );
      expect(anonymous.status).toBe(401);

      for (const key of ["sales", "accountant"] as const) {
        const response = await routes.POST(
          request("POST", "/api/projects", {
            cookie: cookies[key],
            body: { name: "X", location: null, marlaSqft: null },
          }),
        );
        expect(response.status).toBe(403);
        expect((await envelope(response)).error.code).toBe("AUTH_FORBIDDEN");
      }
      expect(await prisma.project.count()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // SET-4 — create
  // -----------------------------------------------------------------------

  describe("SET-4 create (Admin · setup.manage)", () => {
    it("creates the first project with 201 and an audit row", async () => {
      await ensureCompany("225.00");
      const before = await countAudit("project.created");

      const response = await routes.POST(
        request("POST", "/api/projects", {
          cookie: cookies.admin,
          body: {
            name: "  Green City Phase 1  ",
            location: "  Bahria Town, Lahore ",
            marlaSqft: null,
          },
        }),
      );
      expect(response.status).toBe(201);

      const dto = (await response.json()) as Record<string, unknown>;
      expect(dto.name).toBe("Green City Phase 1");
      expect(dto.location).toBe("Bahria Town, Lahore");
      // null inherits the company's value *at creation* (PRD D-1).
      expect(dto.marlaSqft).toBe("225.00");
      expect(dto.version).toBe(0);
      expect(dto.isActive).toBe(true);
      expect(dto.masterPlan).toBeNull();

      expect(await countAudit("project.created")).toBe(before + 1);
    });

    it("stores the company's current conversion, not a null that tracks later changes", async () => {
      // The company moves to 230.50; the project created next inherits 230.50.
      await setup.putCompany(
        admin(),
        {
          name: "Green City Developers",
          address: null,
          phone: null,
          email: null,
          pdfTermsText: null,
          marlaSqft: "230.50",
          logoFileId: null,
        },
        meta,
      );

      const inherited = await createProject({ name: "Inherits 230.50" });
      expect(inherited.marlaSqft).toBe("230.50");
      const row = await prisma.project.findUnique({
        where: { id: inherited.id },
      });
      expect(String(row?.marlaSqft)).toBe("230.5");

      // Changing the company again must not move the stored project value.
      await setup.putCompany(
        admin(),
        {
          name: "Green City Developers",
          address: null,
          phone: null,
          email: null,
          pdfTermsText: null,
          marlaSqft: "225.00",
          logoFileId: null,
        },
        meta,
      );
      const unchanged = await prisma.project.findUnique({
        where: { id: inherited.id },
      });
      expect(String(unchanged?.marlaSqft)).toBe("230.5");
    });

    it("derives company_id from the singleton and rejects it in the body (V-27)", async () => {
      const response = await routes.POST(
        request("POST", "/api/projects", {
          cookie: cookies.admin,
          body: {
            name: "Sneaky",
            location: null,
            marlaSqft: null,
            companyId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      );
      expect(response.status).toBe(400);
      expect((await envelope(response)).error.code).toBe("VALIDATION_FAILED");

      const created = await createProject({ name: "Derived company" });
      const row = await prisma.project.findUnique({
        where: { id: created.id },
      });
      expect(row?.companyId).toBe(companyId);
    });

    it("returns 409 PROJECT_NAME_EXISTS on uq_project_company_name", async () => {
      await createProject({ name: "Duplicate Name" });
      await expect(
        createProject({ name: "Duplicate Name" }),
      ).rejects.toMatchObject({ code: "PROJECT_NAME_EXISTS", status: 409 });

      const response = await routes.POST(
        request("POST", "/api/projects", {
          cookie: cookies.admin,
          body: { name: "Duplicate Name", location: null, marlaSqft: null },
        }),
      );
      expect(response.status).toBe(409);
      expect((await envelope(response)).error.code).toBe("PROJECT_NAME_EXISTS");
    });

    it("returns 422 for a well-formed non-positive marlaSqft (V-19, ck_project_marla)", async () => {
      for (const value of ["0", "0.00", "-5.00"]) {
        const response = await routes.POST(
          request("POST", "/api/projects", {
            cookie: cookies.admin,
            body: {
              name: `Bad marla ${value}`,
              location: null,
              marlaSqft: value,
            },
          }),
        );
        expect(response.status).toBe(422);
        const body = await envelope(response);
        expect(body.error.code).toBe("VALIDATION_FAILED");
        expect(body.error.fields).toEqual({ marlaSqft: "TOO_SMALL" });
      }
    });

    it("returns 400 for a malformed decimal or an unknown key", async () => {
      const cases = [
        { body: { name: "A", marlaSqft: "abc" }, field: "marlaSqft" },
        { body: { name: "A", marlaSqft: "225.000" }, field: "marlaSqft" },
        { body: { name: "   " }, field: "name" },
        { body: { name: "A", extra: true }, field: "_" },
      ];
      for (const testCase of cases) {
        const response = await routes.POST(
          request("POST", "/api/projects", {
            cookie: cookies.admin,
            body: testCase.body,
          }),
        );
        expect(response.status).toBe(400);
        const body = await envelope(response);
        expect(body.error.code).toBe("VALIDATION_FAILED");
        expect(Object.keys(body.error.fields ?? {})).toContain(testCase.field);
      }
    });

    it("rejects a cross-origin POST with 403 CSRF_ORIGIN_REJECTED", async () => {
      const response = await routes.POST(
        request("POST", "/api/projects", {
          cookie: cookies.admin,
          body: { name: "Cross origin", marlaSqft: null },
          origin: "https://evil.example",
        }),
      );
      expect(response.status).toBe(403);
      expect((await envelope(response)).error.code).toBe(
        "CSRF_ORIGIN_REJECTED",
      );
    });

    it("rolls the insert back when the audit row fails", async () => {
      const before = await prisma.project.count();
      auditState.fail = true;
      try {
        await expect(
          createProject({ name: "Rollback create" }),
        ).rejects.toThrow(/audit write failed/);
      } finally {
        auditState.fail = false;
      }
      expect(await prisma.project.count()).toBe(before);
    });
  });

  // -----------------------------------------------------------------------
  // Database constraints
  // -----------------------------------------------------------------------

  describe("database constraints (DATABASE.md §3.2)", () => {
    it("rejects marla_sqft <= 0 directly (ck_project_marla)", async () => {
      await expect(
        prisma.project.create({
          data: { companyId, name: "DB zero", marlaSqft: 0 },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.project.create({
          data: { companyId, name: "DB negative", marlaSqft: -1 },
        }),
      ).rejects.toThrow();
    });

    it("accepts a null marla_sqft (inherit) and rejects duplicate names per company", async () => {
      await prisma.project.create({
        data: { companyId, name: "Null marla project", marlaSqft: null },
      });
      await expect(
        prisma.project.create({
          data: { companyId, name: "Null marla project", marlaSqft: 225 },
        }),
      ).rejects.toThrow(/uq_project_company_name|unique/i);
    });

    it("rejects a half-populated plan dimension pair (ck_project_plan_dims)", async () => {
      const project = await createProject({ name: "Dims check" });
      await expect(
        prisma.project.update({
          where: { id: project.id },
          data: { masterPlanWidthPx: 100 },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.project.update({
          where: { id: project.id },
          data: { masterPlanWidthPx: 0, masterPlanHeightPx: 0 },
        }),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // SET-3 — list
  // -----------------------------------------------------------------------

  describe("SET-3 list (all roles · inventory.read)", () => {
    it("serves the Page<Project> shape to every role", async () => {
      for (const key of ["admin", "sales", "accountant"] as const) {
        const response = await routes.GET(
          request("GET", "/api/projects?page=1&pageSize=50", {
            cookie: cookies[key],
          }),
        );
        expect(response.status).toBe(200);
        const page = (await response.json()) as {
          data: unknown[];
          page: number;
          pageSize: number;
          total: number;
        };
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(50);
        expect(page.total).toBeGreaterThan(0);
        expect(Array.isArray(page.data)).toBe(true);
      }
    });

    it("requires a session", async () => {
      const response = await routes.GET(request("GET", "/api/projects"));
      expect(response.status).toBe(401);
    });

    it("filters by isActive", async () => {
      const project = await createProject({ name: "Filter target" });
      await setup.updateProject(
        admin(),
        project.id,
        { version: 0, isActive: false },
        meta,
      );

      const inactive = await setup.listProjects(actor("sales"), {
        page: 1,
        pageSize: 50,
        sort: "name",
        order: "asc",
        isActive: false,
      });
      expect(inactive.data.map((row) => row.id)).toContain(project.id);
      expect(inactive.data.every((row) => !row.isActive)).toBe(true);

      const active = await setup.listProjects(actor("sales"), {
        page: 1,
        pageSize: 50,
        sort: "name",
        order: "asc",
        isActive: true,
      });
      expect(active.data.map((row) => row.id)).not.toContain(project.id);
    });

    it("paginates without overlap and reports the exact total", async () => {
      const all = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 100,
        sort: "name",
        order: "asc",
      });
      const first = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 2,
        sort: "name",
        order: "asc",
      });
      const second = await setup.listProjects(actor("admin"), {
        page: 2,
        pageSize: 2,
        sort: "name",
        order: "asc",
      });
      expect(first.data).toHaveLength(Math.min(2, all.total));
      expect(first.total).toBe(all.total);
      const firstIds = first.data.map((row) => row.id);
      expect(
        second.data.map((row) => row.id).every((id) => !firstIds.includes(id)),
      ).toBe(true);
    });

    it("orders by name and by createdAt, and the reversed order reverses the list", async () => {
      // Comparing the two directions avoids depending on the database
      // collation, which differs between CI images and local machines.
      const ascending = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 100,
        sort: "name",
        order: "asc",
      });
      const descending = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 100,
        sort: "name",
        order: "desc",
      });
      expect(descending.data.map((row) => row.name)).toEqual(
        ascending.data.map((row) => row.name).reverse(),
      );

      const newestFirst = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 100,
        sort: "createdAt",
        order: "desc",
      });
      const oldestFirst = await setup.listProjects(actor("admin"), {
        page: 1,
        pageSize: 100,
        sort: "createdAt",
        order: "asc",
      });
      const newest = Math.max(
        ...newestFirst.data.map((row) => new Date(row.createdAt).getTime()),
      );
      expect(new Date(newestFirst.data[0].createdAt).getTime()).toBe(newest);
      expect(
        new Date(oldestFirst.data[0].createdAt).getTime(),
      ).toBeLessThanOrEqual(newest);
    });

    it("returns 400 for an unknown sort, an out-of-range pageSize or an unknown filter", async () => {
      for (const query of [
        "?sort=version",
        "?pageSize=101",
        "?page=0",
        "?active=true",
      ]) {
        const response = await routes.GET(
          request("GET", `/api/projects${query}`, {
            cookie: cookies.admin,
          }),
        );
        expect(response.status).toBe(400);
        expect((await envelope(response)).error.code).toBe("VALIDATION_FAILED");
      }
    });
  });

  // -----------------------------------------------------------------------
  // SET-5 — read one
  // -----------------------------------------------------------------------

  describe("SET-5 read one (all roles · inventory.read)", () => {
    it("returns the Project DTO to every role", async () => {
      const project = await createProject({ name: "Read one" });
      for (const key of ["admin", "sales", "accountant"] as const) {
        const response = await routesById.GET(
          request("GET", `/api/projects/${project.id}`, {
            cookie: cookies[key],
          }),
          params(project.id),
        );
        expect(response.status).toBe(200);
        const dto = (await response.json()) as { id: string };
        expect(dto.id).toBe(project.id);
      }
    });

    it("returns 404 PROJECT_NOT_FOUND and 400 for a malformed id", async () => {
      const unknown = await routesById.GET(
        request("GET", "/api/projects/11111111-1111-4111-8111-111111111111", {
          cookie: cookies.admin,
        }),
        params("11111111-1111-4111-8111-111111111111"),
      );
      expect(unknown.status).toBe(404);
      expect((await envelope(unknown)).error.code).toBe("PROJECT_NOT_FOUND");

      const malformed = await routesById.GET(
        request("GET", "/api/projects/not-a-uuid", {
          cookie: cookies.admin,
        }),
        params("not-a-uuid"),
      );
      expect(malformed.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // SET-6 — patch with CAS
  // -----------------------------------------------------------------------

  describe("SET-6 patch (Admin · setup.manage, CAS)", () => {
    it("updates and returns the new version", async () => {
      const project = await createProject({ name: "Patch me" });
      expect(project.version).toBe(0);

      const response = await routesById.PATCH(
        request("PATCH", `/api/projects/${project.id}`, {
          cookie: cookies.admin,
          body: { version: 0, name: "Patched", location: "New place" },
        }),
        params(project.id),
      );
      expect(response.status).toBe(200);
      const dto = (await response.json()) as {
        name: string;
        location: string;
        version: number;
      };
      expect(dto.name).toBe("Patched");
      expect(dto.location).toBe("New place");
      expect(dto.version).toBe(1);
    });

    it("returns 409 CONFLICT_STALE_WRITE with fields.version=STALE", async () => {
      const project = await createProject({ name: "Stale target" });
      await setup.updateProject(
        admin(),
        project.id,
        { version: 0, name: "Stale target v1" },
        meta,
      );

      const response = await routesById.PATCH(
        request("PATCH", `/api/projects/${project.id}`, {
          cookie: cookies.admin,
          body: { version: 0, name: "Stale target v2" },
        }),
        params(project.id),
      );
      expect(response.status).toBe(409);
      const body = await envelope(response);
      expect(body.error.code).toBe("CONFLICT_STALE_WRITE");
      expect(body.error.fields).toEqual({ version: "STALE" });

      // The stale write did not change the row.
      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.name).toBe("Stale target v1");
      expect(row?.version).toBe(1);
    });

    it("lets exactly one of two simultaneous PATCHes succeed", async () => {
      const project = await createProject({ name: "Concurrent CAS" });

      const results = await Promise.allSettled([
        setup.updateProject(
          admin(),
          project.id,
          { version: 0, name: "Concurrent A" },
          { ...meta, requestId: "it-cas-a" },
        ),
        setup.updateProject(
          admin(),
          project.id,
          { version: 0, name: "Concurrent B" },
          { ...meta, requestId: "it-cas-b" },
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const failure = rejected[0].reason as { code?: string; status?: number };
      expect(failure.code).toBe("CONFLICT_STALE_WRITE");
      expect(failure.status).toBe(409);

      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.version).toBe(1);
      expect(["Concurrent A", "Concurrent B"]).toContain(row?.name);
      // Exactly one project.updated audit row for this project.
      expect(
        await prisma.auditLog.count({
          where: { actionCode: "project.updated", entityId: project.id },
        }),
      ).toBe(1);
    });

    it("returns 409 PROJECT_NAME_EXISTS when renaming onto an existing name", async () => {
      await createProject({ name: "Taken name" });
      const other = await createProject({ name: "Rename me" });

      await expect(
        setup.updateProject(
          admin(),
          other.id,
          { version: 0, name: "Taken name" },
          meta,
        ),
      ).rejects.toMatchObject({ code: "PROJECT_NAME_EXISTS", status: 409 });
    });

    it("returns 422 for marlaSqft <= 0 and 400 for a malformed value", async () => {
      const project = await createProject({ name: "Marla patch" });
      const zero = await routesById.PATCH(
        request("PATCH", `/api/projects/${project.id}`, {
          cookie: cookies.admin,
          body: { version: 0, marlaSqft: "0.00" },
        }),
        params(project.id),
      );
      expect(zero.status).toBe(422);
      expect((await envelope(zero)).error.fields).toEqual({
        marlaSqft: "TOO_SMALL",
      });

      const malformed = await routesById.PATCH(
        request("PATCH", `/api/projects/${project.id}`, {
          cookie: cookies.admin,
          body: { version: 0, marlaSqft: "abc" },
        }),
        params(project.id),
      );
      expect(malformed.status).toBe(400);
    });

    it("clears marlaSqft to null and deactivates without cascading", async () => {
      const project = await createProject({
        name: "Deactivate me",
        marlaSqft: "230.00",
      });
      const cleared = await setup.updateProject(
        admin(),
        project.id,
        { version: 0, marlaSqft: null, isActive: false },
        meta,
      );
      expect(cleared.marlaSqft).toBeNull();
      expect(cleared.isActive).toBe(false);

      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.isActive).toBe(false);
      // No block/plot rows exist yet; nothing is created or deleted by PATCH.
      expect(
        await prisma.block.count({ where: { projectId: project.id } }),
      ).toBe(0);
      expect(
        await prisma.plot.count({ where: { projectId: project.id } }),
      ).toBe(0);
    });

    it("requires an Admin and a session, and 404s an unknown id", async () => {
      const project = await createProject({ name: "Auth patch" });
      for (const key of ["sales", "accountant"] as const) {
        const response = await routesById.PATCH(
          request("PATCH", `/api/projects/${project.id}`, {
            cookie: cookies[key],
            body: { version: 0, name: "Nope" },
          }),
          params(project.id),
        );
        expect(response.status).toBe(403);
      }

      const unknownId = "11111111-1111-4111-8111-111111111111";
      const unknown = await routesById.PATCH(
        request("PATCH", `/api/projects/${unknownId}`, {
          cookie: cookies.admin,
          body: { version: 0, name: "Nope" },
        }),
        params(unknownId),
      );
      expect(unknown.status).toBe(404);
      expect((await envelope(unknown)).error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("audits field names only, never the values", async () => {
      const project = await createProject({ name: "Audit me" });
      await setup.updateProject(
        admin(),
        project.id,
        { version: 0, name: "Audit renamed", location: "Secret location" },
        { ...meta, requestId: "it-project-audit" },
      );

      const row = await latestAudit("project.updated");
      expect(row?.entityType).toBe("project");
      expect(row?.entityId).toBe(project.id);
      const summary = row?.summary as unknown as { fields: string[] };
      expect(summary.fields.sort()).toEqual(["location", "name"]);
      expect(JSON.stringify(summary)).not.toContain("Audit renamed");
      expect(JSON.stringify(summary)).not.toContain("Secret location");
    });

    it("rolls the update back when the audit row fails", async () => {
      const project = await createProject({ name: "Atomic patch" });
      auditState.fail = true;
      try {
        await expect(
          setup.updateProject(
            admin(),
            project.id,
            { version: 0, name: "Should roll back" },
            meta,
          ),
        ).rejects.toThrow(/audit write failed/);
      } finally {
        auditState.fail = false;
      }
      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.name).toBe("Atomic patch");
      expect(row?.version).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // SET-7 — master plan
  // -----------------------------------------------------------------------

  describe("SET-7 master plan (Admin · inventory.manage, CAS)", () => {
    it("checks inventory.manage, not setup.manage", async () => {
      const project = await createProject({ name: "Capability check" });
      const fileId = await createFile("MASTER_PLAN");
      capabilityCalls.length = 0;

      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId, version: 0, confirmAspectRatioChange: false },
        meta,
      );

      expect(capabilityCalls).toContain("inventory.manage");
      expect(capabilityCalls).not.toContain("setup.manage");
    });

    it("binds a MASTER_PLAN by id and returns dimensions; first upload skips the aspect check", async () => {
      const project = await createProject({ name: "First plan" });
      const fileId = await createFile("MASTER_PLAN", {
        widthPx: 1000,
        heightPx: 4000,
      });

      const response = await masterPlanRoute.PUT(
        request("PUT", `/api/projects/${project.id}/master-plan`, {
          cookie: cookies.admin,
          body: { fileId, version: 0 },
        }),
        params(project.id),
      );
      expect(response.status).toBe(200);
      const dto = (await response.json()) as {
        version: number;
        masterPlan: {
          fileId: string;
          url: string;
          widthPx: number;
          heightPx: number;
          uploadedAt: string;
        };
      };
      expect(dto.version).toBe(1);
      expect(dto.masterPlan.fileId).toBe(fileId);
      expect(dto.masterPlan.url).toBe(`/api/files/${fileId}`);
      expect(dto.masterPlan.widthPx).toBe(1000);
      expect(dto.masterPlan.heightPx).toBe(4000);
      expect(dto.masterPlan.uploadedAt).toMatch(/Z$/);

      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.masterPlanWidthPx).toBe(1000);
      expect(row?.masterPlanHeightPx).toBe(4000);
      expect(row?.masterPlanUploadedAt).not.toBeNull();
    });

    it("returns 404 FILE_NOT_FOUND for an unknown or soft-deleted object", async () => {
      const project = await createProject({ name: "Missing file" });
      const unknownFile = "11111111-1111-4111-8111-111111111111";
      await expect(
        setup.replaceProjectMasterPlan(
          admin(),
          project.id,
          { fileId: unknownFile, version: 0, confirmAspectRatioChange: false },
          meta,
        ),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 });

      const deleted = await createFile("MASTER_PLAN", {
        deletedAt: new Date(),
      });
      await expect(
        setup.replaceProjectMasterPlan(
          admin(),
          project.id,
          { fileId: deleted, version: 0, confirmAspectRatioChange: false },
          meta,
        ),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 });
    });

    it("returns 422 FILE_KIND_MISMATCH for a COMPANY_LOGO", async () => {
      const project = await createProject({ name: "Wrong kind" });
      const logo = await createFile("COMPANY_LOGO");
      await expect(
        setup.replaceProjectMasterPlan(
          admin(),
          project.id,
          { fileId: logo, version: 0, confirmAspectRatioChange: false },
          meta,
        ),
      ).rejects.toMatchObject({ code: "FILE_KIND_MISMATCH", status: 422 });
    });

    it("blocks an aspect change beyond 0.5% unless confirmed (V-12)", async () => {
      const project = await createProject({ name: "Aspect guard" });
      const first = await createFile("MASTER_PLAN", {
        widthPx: 4000,
        heightPx: 3000,
      });
      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId: first, version: 0, confirmAspectRatioChange: false },
        meta,
      );

      const changed = await createFile("MASTER_PLAN", {
        widthPx: 1000,
        heightPx: 4000,
      });
      const blocked = await masterPlanRoute.PUT(
        request("PUT", `/api/projects/${project.id}/master-plan`, {
          cookie: cookies.admin,
          body: { fileId: changed, version: 1 },
        }),
        params(project.id),
      );
      expect(blocked.status).toBe(422);
      expect((await envelope(blocked)).error.code).toBe(
        "MASTER_PLAN_ASPECT_CHANGED",
      );

      // Nothing changed: still the first image, still version 1.
      const unchanged = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(unchanged?.masterPlanFileId).toBe(first);
      expect(unchanged?.version).toBe(1);

      const confirmed = await masterPlanRoute.PUT(
        request("PUT", `/api/projects/${project.id}/master-plan`, {
          cookie: cookies.admin,
          body: {
            fileId: changed,
            version: 1,
            confirmAspectRatioChange: true,
          },
        }),
        params(project.id),
      );
      expect(confirmed.status).toBe(200);
      const dto = (await confirmed.json()) as {
        version: number;
        masterPlan: { fileId: string };
      };
      expect(dto.version).toBe(2);
      expect(dto.masterPlan.fileId).toBe(changed);
    });

    it("allows a replacement whose ratio differs by exactly 0.5% or less", async () => {
      const project = await createProject({ name: "Exact tolerance" });
      const first = await createFile("MASTER_PLAN", {
        widthPx: 4000,
        heightPx: 3000,
      });
      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId: first, version: 0, confirmAspectRatioChange: false },
        meta,
      );

      // 1.3333… → 1.34 is exactly +0.5%: within tolerance ("more than").
      const boundary = await createFile("MASTER_PLAN", {
        widthPx: 1340,
        heightPx: 1000,
      });
      const result = await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId: boundary, version: 1, confirmAspectRatioChange: false },
        meta,
      );
      expect(result.masterPlan?.fileId).toBe(boundary);
      expect(result.version).toBe(2);
    });

    it("returns 409 CONFLICT_STALE_WRITE on a stale version", async () => {
      const project = await createProject({ name: "Plan stale" });
      const fileId = await createFile("MASTER_PLAN");
      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId, version: 0, confirmAspectRatioChange: false },
        meta,
      );

      const stale = await masterPlanRoute.PUT(
        request("PUT", `/api/projects/${project.id}/master-plan`, {
          cookie: cookies.admin,
          body: { fileId, version: 0 },
        }),
        params(project.id),
      );
      expect(stale.status).toBe(409);
      expect((await envelope(stale)).error.fields).toEqual({
        version: "STALE",
      });
    });

    it("never soft-deletes the replaced plan (ARCHITECTURE.md §7.5)", async () => {
      const project = await createProject({ name: "Retain plans" });
      const first = await createFile("MASTER_PLAN", {
        widthPx: 4000,
        heightPx: 3000,
      });
      const second = await createFile("MASTER_PLAN", {
        widthPx: 4000,
        heightPx: 3000,
      });

      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId: first, version: 0, confirmAspectRatioChange: false },
        meta,
      );
      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId: second, version: 1, confirmAspectRatioChange: false },
        meta,
      );

      const oldFile = await prisma.fileObject.findUnique({
        where: { id: first },
      });
      const newFile = await prisma.fileObject.findUnique({
        where: { id: second },
      });
      // SET-2's logo rule would have soft-deleted `first`; SET-7 must not.
      expect(oldFile?.deletedAt).toBeNull();
      expect(newFile?.deletedAt).toBeNull();
      expect(
        await prisma.fileObject.count({
          where: { id: { in: [first, second] }, deletedAt: null },
        }),
      ).toBe(2);
    });

    it("requires an Admin, a session and a known project", async () => {
      const project = await createProject({ name: "Plan auth" });
      const fileId = await createFile("MASTER_PLAN");

      for (const key of ["sales", "accountant"] as const) {
        const response = await masterPlanRoute.PUT(
          request("PUT", `/api/projects/${project.id}/master-plan`, {
            cookie: cookies[key],
            body: { fileId, version: 0 },
          }),
          params(project.id),
        );
        expect(response.status).toBe(403);
      }

      const unknownId = "11111111-1111-4111-8111-111111111111";
      const unknown = await masterPlanRoute.PUT(
        request("PUT", `/api/projects/${unknownId}/master-plan`, {
          cookie: cookies.admin,
          body: { fileId, version: 0 },
        }),
        params(unknownId),
      );
      expect(unknown.status).toBe(404);
      expect((await envelope(unknown)).error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("audits the replacement with ids and field names only", async () => {
      const project = await createProject({ name: "Plan audit" });
      const fileId = await createFile("MASTER_PLAN");
      await setup.replaceProjectMasterPlan(
        admin(),
        project.id,
        { fileId, version: 0, confirmAspectRatioChange: false },
        { ...meta, requestId: "it-plan-audit" },
      );

      const row = await latestAudit("project.master_plan_replaced");
      expect(row?.entityId).toBe(project.id);
      const summary = row?.summary as unknown as {
        fileId: string;
        fields: string[];
      };
      expect(summary.fileId).toBe(fileId);
      expect(summary.fields).toContain("masterPlanFileId");
      expect(JSON.stringify(summary)).not.toMatch(/MASTER_PLAN\//);
    });

    it("rolls the plan binding back when the audit row fails", async () => {
      const project = await createProject({ name: "Plan atomic" });
      const fileId = await createFile("MASTER_PLAN");

      auditState.fail = true;
      try {
        await expect(
          setup.replaceProjectMasterPlan(
            admin(),
            project.id,
            { fileId, version: 0, confirmAspectRatioChange: false },
            meta,
          ),
        ).rejects.toThrow(/audit write failed/);
      } finally {
        auditState.fail = false;
      }

      const row = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(row?.masterPlanFileId).toBeNull();
      expect(row?.version).toBe(0);
      // The uploaded object stays an orphan for the GC, not a broken reference.
      expect(
        (await prisma.fileObject.findUnique({ where: { id: fileId } }))
          ?.deletedAt,
      ).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Fixture sanity
  // -----------------------------------------------------------------------

  it("leaves exactly one company with its projects (the RESTRICT FK never cascaded)", async () => {
    // Every test above went through the fixture: one singleton company, many
    // projects, none of them ever hard-deleted (`DATABASE.md` §1.6).
    expect(await prisma.project.count()).toBeGreaterThan(0);
    expect(await prisma.company.count()).toBe(1);
  });
});
