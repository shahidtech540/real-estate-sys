# `audit` module

Append-only audit trail and its queries. Write path starts in Phase 1; the read surface (`search`, screen) is Phase 7.

**Implemented starting Phase 1 per IMPLEMENTATION-PLAN.md**

- Phase: `IMPLEMENTATION-PLAN.md` §1.1 (module assigned to Phase 1 in §0.4)
- Responsibility and ownership: `ARCHITECTURE.md` §4.2
- Owns: `audit_log`
- Module anatomy (`index.ts`, `schemas.ts`, `commands.ts`, `queries.ts`, `repository.ts`, `policies.ts`, `errors.ts`, `ui/`): `ARCHITECTURE.md` §4.1

This directory is a stub created by the Step 8 scaffold. Files are added when the
module is built; nothing here is active yet.
