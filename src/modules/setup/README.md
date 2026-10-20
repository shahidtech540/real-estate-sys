# `setup` module

Company profile, logo, PDF terms text, projects, blocks, marla conversion.

**Implemented starting Phase 2 per IMPLEMENTATION-PLAN.md**

- Phase: `IMPLEMENTATION-PLAN.md` §2.1 (module assigned to Phase 2 in §0.4)
- Responsibility and ownership: `ARCHITECTURE.md` §4.2
- Owns: `company`, `project`, `block`, `app_setting`
- Module anatomy (`index.ts`, `schemas.ts`, `commands.ts`, `queries.ts`, `repository.ts`, `policies.ts`, `errors.ts`, `ui/`): `ARCHITECTURE.md` §4.1

## Status

- **Company profile (SET-1, SET-2)** — implemented: `schemas.ts`, `policies.ts`,
  `repository.ts`, `dto.ts`, `queries.ts`, `commands.ts`, `index.ts`, plus
  `src/app/api/company/route.ts` and the Settings screen
  (`IMPLEMENTATION-PLAN.md` §2.4).
- **Projects (SET-3…SET-7), blocks (SET-8…SET-11)** — later PRs of Phase 2.
- `app_setting` stays **read-only and endpoint-free** (`API.md` §3.2).
