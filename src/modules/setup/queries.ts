import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import type { CompanyDto } from "./dto";
import { toCompanyDto } from "./dto";
import * as repo from "./repository";

/**
 * `GET /api/company` — `API.md` §3.2 SET-1.
 *
 * No capability is checked **on purpose**: `API.md` §8.3 lists SET-1 among the
 * seven session-only endpoints ("all · authenticated — company data appears on
 * every screen header and every PDF"), and `ARCHITECTURE.md` §6.2 has no
 * company-read row to check. The session guard (`requireRequestSession` +
 * `PASSWORD_CHANGE_REQUIRED`) is the whole access rule; a `403` here would be an
 * invented rule (`AGENTS.md` §6).
 */
export async function getCompany(): Promise<CompanyDto> {
  const row = await repo.findCompany(db());
  // First run: the UI shows the setup empty state (PRD §12, API.md SET-1).
  if (!row) throw new AppError("COMPANY_NOT_CONFIGURED");
  return toCompanyDto(row);
}
