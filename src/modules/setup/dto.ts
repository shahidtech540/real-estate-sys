import { toWireAmount } from "@/core/money";
import type { CompanyRecord } from "./repository";

/**
 * The only place a `company` row becomes a wire object — `AGENTS.md` §5.4
 * ("a DTO mapper is the only place that converts Prisma `Decimal`/`Date`").
 *
 * Shape is `API.md` §1.9 `Company`, exactly: `logo` is a `FileRef`
 * (`{id, url}` with `url = /api/files/{id}`) built from `logo_file_id`, never a
 * storage key. There is no `createdAt` and no `marlaSqft` number.
 */
export interface CompanyFileRefDto {
  id: string;
  url: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: string;
  logo: CompanyFileRefDto | null;
  updatedAt: string;
}

export function toCompanyDto(row: CompanyRecord): CompanyDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    pdfTermsText: row.pdfTermsText,
    marlaSqft: toWireAmount(row.marlaSqft),
    logo: row.logoFileId
      ? { id: row.logoFileId, url: `/api/files/${row.logoFileId}` }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
