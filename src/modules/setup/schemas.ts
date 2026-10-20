import { z } from "zod";

/**
 * Setup request schemas — `API.md` §3.2 SET-1/SET-2.
 *
 * Two rules drive the shapes below:
 * 1. `V-27` — unknown JSON properties are rejected, so every object is `.strict()`.
 * 2. `V-19` — a *malformed* `marlaSqft` is a shape error (`400`), while a
 *    well-formed zero/negative value is a domain error (`422`). The schema
 *    therefore accepts the sign and only checks the decimal grammar; the
 *    positivity rule lives in `policies.ts`.
 */

/**
 * Optional free text. Omitted, `null` and a blank string all normalize to
 * `null` — `API.md` §1.8 ("null, never `""` for an absent optional value") and
 * SET-2's "omitted optional text becomes `null`". The bounds are sanity limits;
 * `DATABASE.md` §3.2 declares these columns as unbounded `text`.
 */
const optionalText = (max: number) =>
  z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().max(max).nullish(),
    )
    .transform((value) => value ?? null);

/** An empty email input means "no email", not an invalid one. */
const optionalEmail = z
  .preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(320).email().nullish(),
  )
  .transform((value) => value ?? null);

/**
 * `numeric(10,2)` = at most 8 integer digits and 2 decimals. The minus sign is
 * grammar, not policy: `"-5.00"` parses here and fails positivity in the
 * command with `422` (`V-19`).
 */
const decimal10x2 = z
  .string()
  .trim()
  .regex(/^-?\d{1,8}(\.\d{1,2})?$/, "decimal");

/** `PUT /api/company` body — `API.md` §3.2 SET-2. */
export const companyBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: optionalText(2000),
    phone: optionalText(32),
    email: optionalEmail,
    pdfTermsText: optionalText(20000),
    marlaSqft: decimal10x2,
    logoFileId: z
      .string()
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();

export type CompanyBody = z.infer<typeof companyBodySchema>;

// ---------------------------------------------------------------------------
// Projects — `API.md` §3.2 SET-3 … SET-7
// ---------------------------------------------------------------------------

/** `marlaSqft` for a project is nullable: `null` means "inherit the company". */
const optionalMarla = z
  .string()
  .trim()
  .regex(/^-?\d{1,8}(\.\d{1,2})?$/, "decimal")
  .nullish()
  .transform((value) => value ?? null);

const projectName = z.string().trim().min(1).max(200);

const projectLocation = optionalText(2000);

/** `isActive` arrives as a query string (`SET-3`) and a JSON boolean (`SET-6`). */
const booleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** `GET /api/projects` — `API.md` §3.2 SET-3, §1.5 pagination (`V-25`). */
export const listProjectsQuerySchema = z
  .object({
    isActive: booleanQuery.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sort: z.enum(["name", "createdAt"]).default("name"),
    order: z.enum(["asc", "desc"]).optional(),
  })
  .strict();
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/**
 * `POST /api/projects` — `API.md` SET-4.
 *
 * `companyId` is deliberately absent: it is derived from the singleton company
 * ("derived, never sent") and `.strict()` rejects a caller that tries to send it
 * anyway (`V-27`).
 */
export const createProjectSchema = z
  .object({
    name: projectName,
    location: projectLocation,
    marlaSqft: optionalMarla,
  })
  .strict();
export type CreateProjectBody = z.infer<typeof createProjectSchema>;

/**
 * `PATCH /api/projects/{id}` — `API.md` SET-6. `version` is required (`V-18`);
 * every other field is optional, and "absent" is distinct from "null" for
 * `location`/`marlaSqft` because the command only writes what was sent.
 */
export const updateProjectSchema = z
  .object({
    version: z.number().int().min(0),
    name: projectName.optional(),
    location: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim() === "" ? null : value,
        z.string().trim().max(2000).nullish(),
      )
      .optional(),
    marlaSqft: optionalMarla.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

/**
 * `PUT /api/projects/{id}/master-plan` — `API.md` SET-7.
 *
 * `confirmAspectRatioChange` defaults to `false`, so the aspect-ratio guard is
 * on unless the Admin explicitly accepts the distortion warning.
 */
export const masterPlanBodySchema = z
  .object({
    fileId: z.string().uuid(),
    version: z.number().int().min(0),
    confirmAspectRatioChange: z.boolean().default(false),
  })
  .strict();
export type MasterPlanBody = z.infer<typeof masterPlanBodySchema>;

/** Path parameter of SET-5…SET-7; a non-UUID id can never match a row. */
export const projectIdParamSchema = z.string().uuid();
