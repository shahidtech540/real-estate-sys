import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { AppError, errorEnvelope } from "@/core/errors";
import {
  AUDIT_ACTION_CODES,
  isAuditActionCode,
} from "@/modules/audit/action-codes";
import { toProjectDto } from "@/modules/setup/dto";
import {
  ASPECT_RATIO_TOLERANCE,
  assertPositiveMarla,
  changedProjectFields,
  planAspectRatioChanged,
  type ProjectSnapshot,
} from "@/modules/setup/policies";
import type { ProjectRecord } from "@/modules/setup/repository";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  masterPlanBodySchema,
  updateProjectSchema,
} from "@/modules/setup/schemas";

/**
 * Setup *project* unit rules — `API.md` §3.2 SET-3…SET-7 and §4 V-12/V-18/V-19/
 * V-25/V-27, `ARCHITECTURE.md` §7.3/§7.5, `DATABASE.md` §1.7/§3.2.
 *
 * Pure only: schemas, the aspect-ratio threshold, the audit field list and the
 * DTO. The CAS, constraints and role checks are in
 * `tests/integration/projects.test.ts`.
 */

const PROJECT = {
  name: "  Green City Phase 1  ",
  location: "  Bahria Town, Lahore ",
  marlaSqft: "225.00",
};

describe("SET-3 list query", () => {
  it("defaults to page 1, pageSize 50, sorted by name ascending", () => {
    const parsed = listProjectsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.sort).toBe("name");
  });

  it("parses the isActive filter from the query string", () => {
    expect(listProjectsQuerySchema.parse({ isActive: "true" }).isActive).toBe(
      true,
    );
    expect(listProjectsQuerySchema.parse({ isActive: "false" }).isActive).toBe(
      false,
    );
    expect(listProjectsQuerySchema.parse({}).isActive).toBeUndefined();
  });

  it("enforces V-25 — pageSize 1…100, known sort columns, asc|desc only", () => {
    expect(() => listProjectsQuerySchema.parse({ pageSize: "0" })).toThrow();
    expect(() => listProjectsQuerySchema.parse({ pageSize: "101" })).toThrow();
    expect(() => listProjectsQuerySchema.parse({ page: "0" })).toThrow();
    expect(() => listProjectsQuerySchema.parse({ sort: "version" })).toThrow();
    expect(() => listProjectsQuerySchema.parse({ order: "up" })).toThrow();
    expect(listProjectsQuerySchema.parse({ pageSize: "100" }).pageSize).toBe(
      100,
    );
  });

  it("rejects an unknown query parameter instead of ignoring it", () => {
    expect(() =>
      listProjectsQuerySchema.parse({ page: "1", companyId: "x" }),
    ).toThrow();
    expect(() => listProjectsQuerySchema.parse({ active: "true" })).toThrow();
  });
});

describe("SET-4 create body", () => {
  it("trims name and location", () => {
    expect(createProjectSchema.parse(PROJECT)).toEqual({
      name: "Green City Phase 1",
      location: "Bahria Town, Lahore",
      marlaSqft: "225.00",
    });
  });

  it("keeps marlaSqft null when omitted, null or blank-adjacent", () => {
    expect(createProjectSchema.parse({ name: "A" }).marlaSqft).toBeNull();
    expect(
      createProjectSchema.parse({ name: "A", marlaSqft: null }).marlaSqft,
    ).toBeNull();
  });

  it("turns a blank location into null (API.md §1.8)", () => {
    expect(
      createProjectSchema.parse({ name: "A", location: "   " }).location,
    ).toBeNull();
    expect(createProjectSchema.parse({ name: "A" }).location).toBeNull();
  });

  it("requires a non-blank name", () => {
    expect(() => createProjectSchema.parse({ name: "" })).toThrow();
    expect(() => createProjectSchema.parse({ name: "   " })).toThrow();
    expect(() => createProjectSchema.parse({})).toThrow();
  });

  it("refuses a caller-supplied companyId and any other unknown key (V-27)", () => {
    expect(() =>
      createProjectSchema.parse({ ...PROJECT, companyId: "x" }),
    ).toThrow();
    expect(() => createProjectSchema.parse({ ...PROJECT, id: "x" })).toThrow();
    expect(() =>
      createProjectSchema.parse({ ...PROJECT, version: 0 }),
    ).toThrow();
  });

  it("accepts well-formed decimals only; zero and negative parse for the 422 step", () => {
    for (const value of ["225", "225.5", "0", "-5.00"]) {
      expect(
        createProjectSchema.parse({ name: "A", marlaSqft: value }).marlaSqft,
      ).toBe(value);
    }
    for (const value of ["", "abc", "225.000", "1e3", ".5"]) {
      expect(() =>
        createProjectSchema.parse({ name: "A", marlaSqft: value }),
      ).toThrow();
    }
  });
});

describe("SET-6 patch body", () => {
  it("requires an integer version (V-18) and keeps the rest optional", () => {
    expect(updateProjectSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(() => updateProjectSchema.parse({})).toThrow();
    expect(() => updateProjectSchema.parse({ version: "3" })).toThrow();
    expect(() => updateProjectSchema.parse({ version: 1.5 })).toThrow();
    expect(() => updateProjectSchema.parse({ version: -1 })).toThrow();
  });

  it("distinguishes an omitted field from an explicit null", () => {
    const cleared = updateProjectSchema.parse({ version: 1, location: null });
    expect(cleared.location).toBeNull();
    expect(
      updateProjectSchema.parse({ version: 1, location: "  " }).location,
    ).toBeNull();
    expect("location" in updateProjectSchema.parse({ version: 1 })).toBe(false);
  });

  it("accepts isActive false and rejects unknown keys", () => {
    expect(
      updateProjectSchema.parse({ version: 1, isActive: false }).isActive,
    ).toBe(false);
    expect(() =>
      updateProjectSchema.parse({ version: 1, companyId: "x" }),
    ).toThrow();
    expect(() =>
      updateProjectSchema.parse({ version: 1, masterPlanFileId: "x" }),
    ).toThrow();
  });
});

describe("SET-7 master-plan body", () => {
  const fileId = "11111111-1111-4111-8111-111111111111";

  it("defaults confirmAspectRatioChange to false", () => {
    expect(masterPlanBodySchema.parse({ fileId, version: 2 })).toEqual({
      fileId,
      version: 2,
      confirmAspectRatioChange: false,
    });
  });

  it("requires a uuid fileId and an integer version", () => {
    expect(() =>
      masterPlanBodySchema.parse({ fileId: "nope", version: 1 }),
    ).toThrow();
    expect(() => masterPlanBodySchema.parse({ version: 1 })).toThrow();
    expect(() => masterPlanBodySchema.parse({ fileId })).toThrow();
  });

  it("rejects unknown keys, including a client-supplied path or filename", () => {
    expect(() =>
      masterPlanBodySchema.parse({ fileId, version: 1, storageKey: "x" }),
    ).toThrow();
    expect(() =>
      masterPlanBodySchema.parse({ fileId, version: 1, url: "/x" }),
    ).toThrow();
  });
});

describe("marla positivity reuses the SET-2 rule (V-19, ck_project_marla)", () => {
  it("accepts positive values and rejects zero/negative with 422", () => {
    expect(() => assertPositiveMarla("225.00")).not.toThrow();
    for (const value of ["0", "0.00", "-5.00"]) {
      try {
        assertPositiveMarla(value);
        expect.unreachable("expected a 422");
      } catch (error) {
        const appError = error as AppError;
        expect(appError.code).toBe("VALIDATION_FAILED");
        expect(appError.status).toBe(422);
        expect(appError.wireFields).toEqual({ marlaSqft: "TOO_SMALL" });
      }
    }
  });
});

describe("stale-write contract (API.md §1.6, SET-6/SET-7)", () => {
  it("serialises fields.version = STALE on the 409", () => {
    const error = new AppError("CONFLICT_STALE_WRITE", {
      fields: { version: "STALE" },
    });
    expect(error.status).toBe(409);
    expect(errorEnvelope(error, "req-stale")).toEqual({
      error: {
        code: "CONFLICT_STALE_WRITE",
        message: error.message,
        requestId: "req-stale",
        fields: { version: "STALE" },
      },
    });
  });
});

describe("aspect-ratio guard (API.md V-12, ARCHITECTURE.md §7.3)", () => {
  it("fixes the tolerance at 0.5% 'more than'", () => {
    expect(ASPECT_RATIO_TOLERANCE).toBe(0.005);
  });

  it("skips the check on the first upload and when already confirmed", () => {
    expect(
      planAspectRatioChanged(null, { widthPx: 4000, heightPx: 1000 }, false),
    ).toBe(false);
    expect(
      planAspectRatioChanged(
        { widthPx: 4000, heightPx: 3000 },
        { widthPx: 1000, heightPx: 4000 },
        true,
      ),
    ).toBe(false);
  });

  it("allows an unchanged ratio and one that differs by exactly 0.5%", () => {
    expect(
      planAspectRatioChanged(
        { widthPx: 4000, heightPx: 3000 },
        { widthPx: 800, heightPx: 600 },
        false,
      ),
    ).toBe(false);
    // 1.3333… → 1.34 is +0.5% exactly (within tolerance, "more than" is strict).
    expect(
      planAspectRatioChanged(
        { widthPx: 4000, heightPx: 3000 },
        { widthPx: 1340, heightPx: 1000 },
        false,
      ),
    ).toBe(false);
  });

  it("blocks a ratio change beyond 0.5%", () => {
    expect(
      planAspectRatioChanged(
        { widthPx: 4000, heightPx: 3000 },
        { widthPx: 1000, heightPx: 4000 },
        false,
      ),
    ).toBe(true);
    // 1.3333… → 1.35 is +1.25%.
    expect(
      planAspectRatioChanged(
        { widthPx: 4000, heightPx: 3000 },
        { widthPx: 1350, heightPx: 1000 },
        false,
      ),
    ).toBe(true);
  });

  it("cannot compare a missing or zero dimension, so it does not invent a rejection", () => {
    expect(
      planAspectRatioChanged({ widthPx: 4000, heightPx: 3000 }, null, false),
    ).toBe(false);
    expect(
      planAspectRatioChanged(null, { widthPx: 1000, heightPx: 1000 }, false),
    ).toBe(false);
    expect(
      planAspectRatioChanged(
        { widthPx: 0, heightPx: 3000 },
        { widthPx: 10, heightPx: 10 },
        false,
      ),
    ).toBe(false);
  });
});

describe("project audit field list (ARCHITECTURE.md §13.2)", () => {
  const previous: ProjectSnapshot = {
    name: "Green City Phase 1",
    location: "Bahria Town",
    marlaSqft: new Decimal("225.00"),
    isActive: true,
  };

  it("lists changed field names only", () => {
    expect(
      changedProjectFields(previous, {
        name: "Green City Phase 2",
        isActive: false,
      }),
    ).toEqual(["name", "isActive"]);
  });

  it("reports a cleared optional field by name", () => {
    expect(changedProjectFields(previous, { location: null })).toEqual([
      "location",
    ]);
    expect(changedProjectFields(previous, { marlaSqft: null })).toEqual([
      "marlaSqft",
    ]);
  });

  it("treats an omitted field as unchanged and ignores decimal formatting", () => {
    expect(changedProjectFields(previous, {})).toEqual([]);
    expect(changedProjectFields(previous, { marlaSqft: "225" })).toEqual([]);
  });
});

describe("Project DTO (API.md §1.9)", () => {
  const row: ProjectRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333333",
    name: "Green City Phase 1",
    location: null,
    marlaSqft: new Decimal("225"),
    masterPlanFileId: null,
    masterPlanWidthPx: null,
    masterPlanHeightPx: null,
    masterPlanUploadedAt: null,
    isActive: true,
    version: 4,
    createdAt: new Date("2026-10-19T09:15:00.000Z"),
    updatedAt: new Date("2026-10-20T10:00:00.000Z"),
  };

  it("projects the documented fields and no companyId", () => {
    const dto = toProjectDto(row);
    expect(dto).toEqual({
      id: row.id,
      name: "Green City Phase 1",
      location: null,
      marlaSqft: "225.00",
      isActive: true,
      version: 4,
      masterPlan: null,
      createdAt: "2026-10-19T09:15:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
    });
    expect("companyId" in dto).toBe(false);
  });

  it("derives masterPlan as a FileRef plus stored dimensions", () => {
    const dto = toProjectDto({
      ...row,
      masterPlanFileId: "44444444-4444-4444-8444-444444444444",
      masterPlanWidthPx: 4000,
      masterPlanHeightPx: 3000,
      masterPlanUploadedAt: new Date("2026-10-20T10:00:00.000Z"),
    });
    expect(dto.masterPlan).toEqual({
      fileId: "44444444-4444-4444-8444-444444444444",
      url: "/api/files/44444444-4444-4444-8444-444444444444",
      widthPx: 4000,
      heightPx: 3000,
      uploadedAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("keeps a null marlaSqft as null (inherit) and never emits a JSON number", () => {
    expect(toProjectDto({ ...row, marlaSqft: null }).marlaSqft).toBeNull();
    expect(typeof toProjectDto(row).marlaSqft).toBe("string");
  });

  it("fails loudly if a plan reference has no stored dimensions", () => {
    expect(() =>
      toProjectDto({
        ...row,
        masterPlanFileId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow(/without stored dimensions/);
  });
});

describe("audit registry", () => {
  it("contains the three codes named by API.md SET-4/SET-6/SET-7", () => {
    expect(AUDIT_ACTION_CODES.projectCreated).toBe("project.created");
    expect(AUDIT_ACTION_CODES.projectUpdated).toBe("project.updated");
    expect(AUDIT_ACTION_CODES.projectMasterPlanReplaced).toBe(
      "project.master_plan_replaced",
    );
    expect(isAuditActionCode("project.master_plan_replaced")).toBe(true);
    expect(isAuditActionCode("project.deleted")).toBe(false);
  });
});
