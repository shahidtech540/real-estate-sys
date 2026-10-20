import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { AppError } from "@/core/errors";
import {
  AUDIT_ACTION_CODES,
  isAuditActionCode,
} from "@/modules/audit/action-codes";
import { toCompanyDto } from "@/modules/setup/dto";
import {
  assertPositiveMarla,
  changedCompanyFields,
  shouldSoftDeleteLogo,
  type CompanyValues,
} from "@/modules/setup/policies";
import type { CompanyRecord } from "@/modules/setup/repository";
import { companyBodySchema } from "@/modules/setup/schemas";

/**
 * Setup company unit rules — `API.md` §3.2 SET-1/SET-2, §4 V-14/V-19/V-27,
 * `ARCHITECTURE.md` §7.5 and §13.2.
 *
 * Pure only: schema shapes, the 422 positivity rule, the audit field list and
 * the DTO mapper. The transaction, singleton and constraint behaviour is in
 * `tests/integration/company.test.ts`.
 */

const VALID_BODY = {
  name: "  Green City Developers  ",
  address: " 12 Mall Road, Lahore ",
  phone: "+924200000000",
  email: "info@example.test",
  pdfTermsText: "Terms line one.\nTerms line two.",
  marlaSqft: "225.00",
  logoFileId: null,
};

function parse(body: unknown) {
  return companyBodySchema.safeParse(body);
}

describe("SET-2 body schema", () => {
  it("accepts the documented body and trims the text fields", () => {
    const result = parse(VALID_BODY);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      name: "Green City Developers",
      address: "12 Mall Road, Lahore",
      phone: "+924200000000",
      email: "info@example.test",
      pdfTermsText: "Terms line one.\nTerms line two.",
      marlaSqft: "225.00",
      logoFileId: null,
    });
  });

  it("turns omitted, null and blank optional text into null (API.md §1.8, SET-2)", () => {
    for (const body of [
      { name: "A", marlaSqft: "225.00" },
      {
        name: "A",
        marlaSqft: "225.00",
        address: null,
        phone: null,
        email: null,
        pdfTermsText: null,
      },
      {
        name: "A",
        marlaSqft: "225.00",
        address: "   ",
        phone: " ",
        email: "",
        pdfTermsText: "\n",
      },
    ]) {
      const result = parse(body);
      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.data.address).toBeNull();
      expect(result.data.phone).toBeNull();
      expect(result.data.email).toBeNull();
      expect(result.data.pdfTermsText).toBeNull();
      expect(result.data.logoFileId).toBeNull();
    }
  });

  it("requires a non-blank name (SET-2: 400 VALIDATION_FAILED)", () => {
    expect(parse({ ...VALID_BODY, name: "" }).success).toBe(false);
    expect(parse({ ...VALID_BODY, name: "   " }).success).toBe(false);
    expect(parse({ name: undefined, marlaSqft: "225.00" }).success).toBe(false);
  });

  it("rejects a malformed email but accepts an empty one as null", () => {
    expect(parse({ ...VALID_BODY, email: "not-an-email" }).success).toBe(false);
    const blank = parse({ ...VALID_BODY, email: "   " });
    expect(blank.success && blank.data.email).toBeNull();
  });

  it("rejects unknown properties (V-27)", () => {
    expect(
      parse({ ...VALID_BODY, id: "11111111-1111-4111-8111-111111111111" })
        .success,
    ).toBe(false);
    expect(parse({ ...VALID_BODY, createdBy: "someone" }).success).toBe(false);
    expect(parse({ ...VALID_BODY, marla: "225.00" }).success).toBe(false);
  });

  it("parses well-formed decimals — including zero and negative — and only them (V-19)", () => {
    for (const value of [
      "225.00",
      "225",
      "225.5",
      "0",
      "0.00",
      "-5.00",
      " 225.00 ",
    ]) {
      expect(parse({ ...VALID_BODY, marlaSqft: value }).success).toBe(true);
    }
    // Malformed numbers are shape errors (400); the schema must not hide them
    // as 422 by accepting arbitrary strings.
    for (const value of [
      "",
      "abc",
      "1e3",
      ".5",
      "225.",
      "225.000",
      "225,00",
      "123456789",
      "-",
    ]) {
      expect(parse({ ...VALID_BODY, marlaSqft: value }).success).toBe(false);
    }
  });

  it("requires marlaSqft — the column is NOT NULL (DATABASE.md §3.2)", () => {
    expect(parse({ name: "A" }).success).toBe(false);
  });

  it("accepts a uuid logoFileId, and null/omitted as null", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const withLogo = parse({ ...VALID_BODY, logoFileId: id });
    expect(withLogo.success && withLogo.data.logoFileId).toBe(id);
    expect(parse({ name: "A", marlaSqft: "225.00" }).success).toBe(true);
    expect(parse({ ...VALID_BODY, logoFileId: "nope" }).success).toBe(false);
  });
});

describe("marla positivity (V-19, ck_company_marla)", () => {
  it("accepts a positive value", () => {
    expect(() => assertPositiveMarla("0.01")).not.toThrow();
    expect(() => assertPositiveMarla("225.00")).not.toThrow();
  });

  it("raises 422 VALIDATION_FAILED with a field code for zero or negative", () => {
    for (const value of ["0", "0.00", "-5.00"]) {
      try {
        assertPositiveMarla(value);
        expect.unreachable("expected a 422");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe("VALIDATION_FAILED");
        expect(appError.status).toBe(422);
        expect(appError.wireFields).toEqual({ marlaSqft: "TOO_SMALL" });
      }
    }
  });

  it("refuses to attach the 422 status to another code", () => {
    expect(() => new AppError("FILE_NOT_FOUND", { httpStatus: 422 })).toThrow(
      /cannot be raised/,
    );
  });
});

describe("audit field list (ARCHITECTURE.md §13.2)", () => {
  const existing = {
    name: "Green City Developers",
    address: "12 Mall Road",
    phone: "+924200000000",
    email: "info@example.test",
    pdfTermsText: null,
    marlaSqft: new Decimal("225.00"),
    logoFileId: null,
  };

  it("lists every non-empty field on create", () => {
    const next: CompanyValues = {
      name: "Green City Developers",
      address: "12 Mall Road",
      phone: null,
      email: null,
      pdfTermsText: null,
      marlaSqft: "225.00",
      logoFileId: null,
    };
    expect(changedCompanyFields(null, next)).toEqual([
      "name",
      "address",
      "marlaSqft",
    ]);
  });

  it("lists only changed field names on update", () => {
    const next: CompanyValues = {
      ...existing,
      marlaSqft: "226.00",
      phone: "+924211111111",
      address: "12 Mall Road",
    };
    expect(changedCompanyFields(existing, next)).toEqual([
      "phone",
      "marlaSqft",
    ]);
  });

  it("ignores formatting differences in the decimal string", () => {
    const next: CompanyValues = { ...existing, marlaSqft: "225" };
    expect(changedCompanyFields(existing, next)).toEqual([]);
  });

  it("reports a cleared optional text and a logo binding by name only", () => {
    const next: CompanyValues = {
      ...existing,
      marlaSqft: "225.00",
      address: null,
      logoFileId: "11111111-1111-4111-8111-111111111111",
    };
    expect(changedCompanyFields(existing, next)).toEqual([
      "address",
      "logoFileId",
    ]);
  });
});

describe("logo replacement policy (ARCHITECTURE.md §7.5)", () => {
  const previous = "11111111-1111-4111-8111-111111111111";
  const next = "22222222-2222-4222-8222-222222222222";

  it("soft-deletes the old object only when nothing references it", () => {
    expect(shouldSoftDeleteLogo(previous, next, 0)).toBe(true);
    expect(shouldSoftDeleteLogo(previous, next, 1)).toBe(false);
  });

  it("never deletes the object it just bound, or with no previous logo", () => {
    expect(shouldSoftDeleteLogo(previous, previous, 0)).toBe(false);
    expect(shouldSoftDeleteLogo(null, next, 0)).toBe(false);
    expect(shouldSoftDeleteLogo(previous, null, 0)).toBe(true);
  });
});

describe("Company DTO (API.md §1.9)", () => {
  const row: CompanyRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Green City Developers",
    logoFileId: "44444444-4444-4444-8444-444444444444",
    address: null,
    phone: null,
    email: null,
    pdfTermsText: null,
    marlaSqft: new Decimal("225"),
    createdAt: new Date("2026-10-19T09:15:00.000Z"),
    updatedAt: new Date("2026-10-19T09:15:00.000Z"),
  };

  it("renders decimals as strings, timestamps as ISO-8601 UTC and the logo as a FileRef", () => {
    expect(toCompanyDto(row)).toEqual({
      id: row.id,
      name: "Green City Developers",
      address: null,
      phone: null,
      email: null,
      pdfTermsText: null,
      marlaSqft: "225.00",
      logo: {
        id: "44444444-4444-4444-8444-444444444444",
        url: "/api/files/44444444-4444-4444-8444-444444444444",
      },
      updatedAt: "2026-10-19T09:15:00.000Z",
    });
  });

  it("has no logo when logo_file_id is null", () => {
    expect(toCompanyDto({ ...row, logoFileId: null }).logo).toBeNull();
  });
});

describe("audit registry", () => {
  it("contains the two codes named by API.md SET-2", () => {
    expect(AUDIT_ACTION_CODES.companyCreated).toBe("company.created");
    expect(AUDIT_ACTION_CODES.companyUpdated).toBe("company.updated");
    expect(isAuditActionCode("company.created")).toBe(true);
    expect(isAuditActionCode("company.updated")).toBe(true);
    expect(isAuditActionCode("company.deleted")).toBe(false);
  });
});
