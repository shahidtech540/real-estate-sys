import type { Decimal } from "decimal.js";
import type { Db } from "@/core/db";

/**
 * The only file in the Setup module that talks to Prisma
 * (`ARCHITECTURE.md` §4.4 rule 4, `AGENTS.md` §5.9). It owns `company`
 * (`DATABASE.md` §3.2) and never opens a transaction — the command passes its
 * `Tx` down (`AGENTS.md` §5.7).
 */

export interface CompanyRecord {
  id: string;
  name: string;
  logoFileId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: Decimal;
  createdAt: Date;
  updatedAt: Date;
}

const companySelection = {
  id: true,
  name: true,
  logoFileId: true,
  address: true,
  phone: true,
  email: true,
  pdfTermsText: true,
  marlaSqft: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The singleton is read with `findFirst`: `uq_company_singleton` is an
 * expression index on `((true))`, so Prisma has no unique selector to offer
 * (`DATABASE.md` §6.2). Zero rows is a valid, documented state (SET-1's
 * `COMPANY_NOT_CONFIGURED`).
 */
export async function findCompany(client: Db): Promise<CompanyRecord | null> {
  return (await client.company.findFirst({
    select: companySelection,
  })) as CompanyRecord | null;
}

export interface CompanyWriteData {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  /** A decimal string; Prisma accepts it directly for `numeric(10,2)`. */
  marlaSqft: string;
  logoFileId: string | null;
}

export async function insertCompany(
  client: Db,
  data: CompanyWriteData,
): Promise<CompanyRecord> {
  return (await client.company.create({
    data,
    select: companySelection,
  })) as CompanyRecord;
}

export async function updateCompany(
  client: Db,
  id: string,
  data: CompanyWriteData,
): Promise<CompanyRecord> {
  return (await client.company.update({
    where: { id },
    data,
    select: companySelection,
  })) as CompanyRecord;
}
