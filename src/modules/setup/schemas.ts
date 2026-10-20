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
