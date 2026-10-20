import { isPositive, toWireAmount, type DecimalInput } from "@/core/money";
import { unprocessable } from "@/core/errors";

/**
 * Setup business invariants that are not permissions
 * (`ARCHITECTURE.md` §4.1 module anatomy: `policies.ts`).
 *
 * Pure functions only: no database, no request, no clock — so the rules are
 * unit-tested directly (`AGENTS.md` §7.2).
 */

/**
 * `V-19` / `API.md` SET-2: `marlaSqft` must be strictly positive. The shape was
 * already validated (any well-formed decimal parses), so a zero or negative
 * value is `422 VALIDATION_FAILED` and names the field — the same rule
 * `ck_company_marla` enforces in the database (`DATABASE.md` §3.2, §6.3).
 */
export function assertPositiveMarla(marlaSqft: string): void {
  if (!isPositive(marlaSqft)) {
    throw unprocessable({ marlaSqft: "TOO_SMALL" });
  }
}

/** The full-replace value set of `PUT /api/company` (`API.md` SET-2). */
export interface CompanyValues {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: string;
  logoFileId: string | null;
}

/** The stored side of a comparison; `marlaSqft` is a Prisma `Decimal`. */
export interface CompanySnapshot {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: DecimalInput;
  logoFileId: string | null;
}

/** Field order is the SET-2 body order, so the audit summary is stable. */
const COMPANY_FIELDS = [
  "name",
  "address",
  "phone",
  "email",
  "pdfTermsText",
  "marlaSqft",
  "logoFileId",
] as const;

/**
 * The `fields` list of a `company.updated` audit summary — **names only**
 * (`ARCHITECTURE.md` §13.2: no contact details, no file paths). Passing `null`
 * as `previous` describes a first create and lists every non-empty field.
 */
export function changedCompanyFields(
  previous: CompanySnapshot | null,
  next: CompanyValues,
): string[] {
  const normalize = (values: CompanyValues | CompanySnapshot): string[] => [
    values.name,
    values.address ?? "",
    values.phone ?? "",
    values.email ?? "",
    values.pdfTermsText ?? "",
    toWireAmount(values.marlaSqft),
    values.logoFileId ?? "",
  ];

  const before = previous ? normalize(previous) : null;
  const after = normalize(next);
  return COMPANY_FIELDS.filter((_, index) =>
    before ? before[index] !== after[index] : after[index] !== "",
  );
}

/**
 * `ARCHITECTURE.md` §7.5 (via `API.md` SET-2): the previous logo object is
 * soft-deleted **only when nothing else references it**. A replacement that
 * re-uses the same object, or an object still referenced by another row, stays
 * live.
 */
export function shouldSoftDeleteLogo(
  previousLogoFileId: string | null,
  nextLogoFileId: string | null,
  referenceCount: number,
): boolean {
  if (!previousLogoFileId) return false;
  if (previousLogoFileId === nextLogoFileId) return false;
  return referenceCount === 0;
}

// ---------------------------------------------------------------------------
// Projects — `API.md` §3.2 SET-3 … SET-7, `ARCHITECTURE.md` §7.3
// ---------------------------------------------------------------------------

/**
 * Aspect ratios are compared as `width / height`. `ARCHITECTURE.md` §7.3 and
 * `API.md` SET-7 fix the tolerance: **more than 0.5%** relative difference needs
 * an explicit confirmation. Exactly 0.5% is *within* tolerance ("more than"),
 * so the comparison is `> 0.005`, not `>=`.
 */
export const ASPECT_RATIO_TOLERANCE = 0.005;

export interface PlanDimensions {
  widthPx: number;
  heightPx: number;
}

function hasDimensions(value: PlanDimensions | null): value is PlanDimensions {
  return value !== null && value.widthPx > 0 && value.heightPx > 0;
}

/**
 * `V-12` / `API.md` SET-7: does replacing the plan with `next` need the
 * "polygons will distort" confirmation?
 *
 * Three documented exceptions:
 * - no stored plan yet → nothing to distort, so no check (`SET-7`: the rule is
 *   "differs from the **stored** one");
 * - `confirmAspectRatioChange: true` → the Admin already accepted it;
 * - a missing/zero dimension on either side → cannot compute a ratio, and
 *   inventing a rejection would be a rule the documents do not state.
 */
export function planAspectRatioChanged(
  previous: PlanDimensions | null,
  next: PlanDimensions | null,
  confirmed: boolean,
): boolean {
  if (confirmed || !hasDimensions(previous) || !hasDimensions(next)) {
    return false;
  }
  // Integer form of `|next - previous| / previous > 0.005`, so the boundary case
  // is exact: floating point turns 1.34 vs 4/3 into +0.5000000000000026% and
  // would wrongly demand confirmation for an image that changed by exactly the
  // documented tolerance.
  //   |w₂/h₂ − w₁/h₁| / (w₁/h₁) > 1/200
  //   ⇔ 200 · |w₂h₁ − w₁h₂| > h₂ · w₁
  const delta = Math.abs(
    next.widthPx * previous.heightPx - previous.widthPx * next.heightPx,
  );
  return 200 * delta > next.heightPx * previous.widthPx;
}

/** Fields of a `project.updated` audit summary — names only (`§13.2`). */
const PROJECT_FIELDS = ["name", "location", "marlaSqft", "isActive"] as const;

export interface ProjectSnapshot {
  name: string;
  location: string | null;
  marlaSqft: DecimalInput | null;
  isActive: boolean;
}

/**
 * Which project columns a `PATCH` actually changes — **names only**, so the
 * audit summary never carries a name, a location or a number
 * (`ARCHITECTURE.md` §13.2).
 */
export function changedProjectFields(
  previous: ProjectSnapshot,
  next: Partial<ProjectSnapshot>,
): string[] {
  const before: Record<(typeof PROJECT_FIELDS)[number], string> = {
    name: previous.name,
    location: previous.location ?? "",
    marlaSqft:
      previous.marlaSqft === null ? "" : toWireAmount(previous.marlaSqft),
    isActive: String(previous.isActive),
  };
  const after: Record<(typeof PROJECT_FIELDS)[number], string> = {
    name: next.name ?? previous.name,
    location:
      next.location === undefined
        ? (previous.location ?? "")
        : (next.location ?? ""),
    marlaSqft:
      next.marlaSqft === undefined
        ? before.marlaSqft
        : next.marlaSqft === null
          ? ""
          : toWireAmount(next.marlaSqft),
    isActive: String(next.isActive ?? previous.isActive),
  };
  return PROJECT_FIELDS.filter((field) => before[field] !== after[field]);
}
