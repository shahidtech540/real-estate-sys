/**
 * Public surface of the Setup module (`ARCHITECTURE.md` §4.4 rule 1).
 *
 * Phase 2 scope so far: the company profile only (SET-1/SET-2). Projects,
 * blocks and the master-plan binding are later PRs of the same phase
 * (`IMPLEMENTATION-PLAN.md` §2.2 build order).
 */
export { putCompany, type PutCompanyResult } from "./commands";
export { getCompany } from "./queries";
export type { CompanyDto, CompanyFileRefDto } from "./dto";
export type { CompanyBody } from "./schemas";
