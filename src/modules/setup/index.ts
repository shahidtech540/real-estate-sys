/**
 * Public surface of the Setup module (`ARCHITECTURE.md` §4.4 rule 1).
 *
 * Phase 2 scope so far: the company profile (SET-1/SET-2) and projects
 * (SET-3…SET-7). Blocks (SET-8…SET-11) are the next PR of the same phase
 * (`IMPLEMENTATION-PLAN.md` §2.2 build order).
 */
export {
  createProject,
  putCompany,
  replaceProjectMasterPlan,
  updateProject,
  type PutCompanyResult,
} from "./commands";
export { getCompany, getProject, listProjects } from "./queries";
export type {
  CompanyDto,
  CompanyFileRefDto,
  ProjectDto,
  ProjectMasterPlanDto,
} from "./dto";
export type {
  CompanyBody,
  CreateProjectBody,
  ListProjectsQuery,
  MasterPlanBody,
  UpdateProjectBody,
} from "./schemas";
