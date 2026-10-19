# IMPLEMENTATION-PLAN.md — Phased Build Plan for Steps 8–20

| | |
|---|---|
| **Document status** | **v1.0 — operative** |
| **Date** | 2026-10-20 |
| **Workflow step** | 7 of 20 (governs Steps 8–20) |
| **Audience** | The coding agent (an LLM) building Society Plot Manager phase by phase |
| **Sources** | `PRD.md` v1.0 · `ARCHITECTURE.md` v1.0 · `DATABASE.md` v1.0 · `API.md` v1.0 · `AGENTS.md` v1.0 — all on `main` at `352051d` |
| **What this file is** | A build order and a set of phase gates. Nothing else |
| **What this file is not** | Not a source of product behavior, structure, schema or contract; it never adds an endpoint, table, column, enum, capability, screen or rule |

---

## 0. Scope, precedence, and terms

### 0.1 Precedence

This plan governs **build order only**: which module group is built when, which endpoints and tables belong to that phase, which screens become usable, and what must be true before the phase is called done.

It does **not** govern:

| Question | Answered by |
|---|---|
| What the product does, and its acceptance criteria | `PRD.md` |
| How the code is structured, bounded and transacted | `ARCHITECTURE.md` |
| Tables, columns, enums, constraints, grants, seeds, migrations | `DATABASE.md` |
| Endpoints, payloads, status codes, error codes, validation rules | `API.md` |
| How the agent works, tests, reviews and delivers | `AGENTS.md` |

If this plan and any of those five disagree, the **source wins and this plan is wrong**. Correct it by a PR that cites both sides, following `AGENTS.md` §2.3 — never by silently reordering the work. A phase assignment that turns out to be impossible is a defect in this file, not permission to change a source document.

### 0.2 Terms

- **Phase** — a group of modules that can be built, tested and demonstrated together, in the order fixed by `ARCHITECTURE.md` §4.3.
- **Active table** — the first phase in which a table is read or written by module code reachable from a user action or a job. The eight migrations and the demo seed do **not** count as activation. All 26 tables exist from Phase 1 (`DATABASE.md` §10.1); activation is about code paths, not `CREATE TABLE`.
- **Phase gate** — the subset of `AGENTS.md` §9 that applies to the surface delivered in that phase, with the proof named.
- **Checkpoint** — the end-to-end flow that must be demonstrable at the phase close, expressed as a PRD §7 journey or a named sub-flow.

### 0.3 How a phase closes

1. Every endpoint listed for the phase is merged, each in its own PR under the rules of `AGENTS.md` §8.1–§8.2.
2. The eight gates of `AGENTS.md` §7.3 are green on `main`.
3. The checkpoint in the phase's §x.7 runs against the deployed build (Compose locally, staging when it exists — `AGENTS.md` AG-Q6).
4. Every PR carries its `AGENTS.md` §9 evidence, scoped to that PR.
5. `docs/OPEN-QUESTIONS.md` contains every judgment call made (or a statement that there was none).

**A phase is not a PR.** It is a gate over several PRs. `AGENTS.md` §8.2's one-capability-per-PR rule still applies inside every phase, and a ~600-line non-generated diff still means "split it".

### 0.4 The order is the graph

`ARCHITECTURE.md` §4.3 lists ten dependency lines (twenty directed edges in total). The phases are a topological linearization of them, and each phase sits after every module it points at:

| Phase | Modules built | Edges from §4.3 that force this position |
|---|---|---|
| 1 | Core, Identity | `Identity ──► Audit` and `Audit ──► Core only`; Core depends on nothing |
| 2 | Setup | `Inventory ──► Setup`, and Setup itself needs Core/Audit |
| 3 | Inventory | `Sales ──► Inventory`, and Inventory needs Setup |
| 4 | Sales | `Sales ──► Inventory, Audit`; `Ledger ──► Sales` forces Sales before Ledger |
| 5 | Cashbook, then Ledger | `Ledger ──► Sales, Cashbook, Audit`; Cashbook alone only needs Audit |
| 6 | Recovery, Reminders, Documents, Reporting | `Recovery ──► Sales, Ledger, Setup`; `Reminders ──► Sales, Inventory, Setup, Audit`; `Documents ──► Setup, Sales`; `Reporting ──► Cashbook, Setup` — every target is already built |
| 7 | Audit (read surface) | `Audit ──► Core only`; every module that writes to it is built by now |

**Invariant:** no phase consumes a module from a later phase. If a phase needs something not yet built, the phase order is wrong and this file is defective (`AGENTS.md` §2.3).

---

## 1. Phase 1 — Core and Identity

### 1.1 Modules

`core` (db, config, authz, errors, money, datetime, files, ids, logging, jobs) and `identity` — `ARCHITECTURE.md` §4.2, §5.1, §5.12. The `audit` module is created here for its **write path only** (`record(tx, …)`), because Identity depends on Audit (`ARCHITECTURE.md` §4.3: `Identity ──► Audit`). Its read surface (`AUD-1…AUD-3`) is Phase 7.

### 1.2 Endpoints (17)

| Group | IDs | Source |
|---|---|---|
| Authentication | AUTH-1, AUTH-2, AUTH-3, AUTH-4, AUTH-5 | `API.md` §2 |
| User administration and profile | IDN-1, IDN-2, IDN-3, IDN-4, IDN-5, IDN-6, IDN-7, IDN-8 | `API.md` §3.1 |
| Core platform | COR-1, COR-2, COR-3, COR-4 | `API.md` §3.12 |

**Build order inside the phase:** `core` primitives → Identity commands/queries → AUTH/IDN route handlers → COR-1/COR-2 file pipeline → COR-3/COR-4 health. The session middleware (including the `PASSWORD_CHANGE_REQUIRED` gate of `API.md` §2, AUTH-5) lands before any other route handler exists.

### 1.3 Tables that become active (7)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `app_user` | IDN-3…IDN-8; login (`AUTH-1`) reads it | §3.1 |
| `session` | `AUTH-1` creates; `AUTH-2`/`AUTH-4`/IDN-6/IDN-7 delete or slide | §3.1 |
| `login_throttle` | `AUTH-1` increments; IDN-8 clears | §3.1 |
| `audit_log` | every Identity command writes one row in the same transaction | §3.10 |
| `file_object` | COR-1 stores, COR-2 serves | §3.11 |
| `job_run` | read by COR-4 (`ix_job_run_name_time`, `ix_job_run_running`); first write arrives with the worker in Phase 6 | §3.11 |
| `app_setting` | read by `core/config`; no endpoint by design | §3.2, `API.md` §3.2 |

All 26 tables are created by `0001_init` and the rest of the fixed migration set (`DATABASE.md` §10.1). Nothing in this plan adds a migration; a new schema object would be a conflict under `AGENTS.md` §2.3.

### 1.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 1 | **Login** | Complete: sign-in, throttled/locked states, forced password change (`PRD.md` §11 #1, `DESIGN.md` §13) |
| 15 | **Users** | Complete: list, create, edit role/active, reset password, unlock (`PRD.md` §11 #15) |
| 2 | **Dashboard** | Shell only: persistent navigation, role-aware landing, empty states (`DESIGN.md` §8). No data tile is wired |

### 1.5 Deferred to later phases

- Everything under Setup, Inventory, Sales, Ledger, Cashbook, Recovery, Reminders, Documents, Reporting (`API.md` §3.2–§3.10).
- The Audit Log screen and `AUD-1…AUD-3` (Phase 7), even though `audit_log` is already being written.
- The worker process, session cleanup, orphan-file cleanup and the nightly checks (`ARCHITECTURE.md` §10.4, §12.9) — Phase 6 introduces the worker, Phase 7 adds integrity checks.
- Deployment hardening, backups, monitoring and `RUNBOOK.md` — Phase 7 (`ARCHITECTURE.md` §14, `AGENTS.md` AG-Q6).

### 1.6 Seed data (AG-Q5)

| Seeded entity | First needed | Note |
|---|---|---|
| Staff accounts | — | Not part of AG-Q5's dataset. The first Admin comes from the one-shot `npm run create-admin` (`AGENTS.md` AG-Q9); integration tests create their own actors (`AGENTS.md` §7.4) |
| 8 cash categories, 4 SMS templates, 1 dry-run provider row | Phase 5 / Phase 6 | Already inserted by migration `0008_seed_reference_data` (`DATABASE.md` §9.1–§9.3, §10.1); no code reads them yet |
| Company, project, blocks, plots, buyers, booking | Phase 2–Phase 4 | Added to `prisma/seed.ts` in the phase that first needs them (§2.6, §3.6, §4.6) |

`npm run db:reset` must recreate the dataset deterministically; every addition stays inside AG-Q5's stated shape.

### 1.7 Integration/E2E checkpoint

**Sub-flow: identity and access.** No PRD §7 journey is reachable yet — say so in the phase report rather than inventing one.

1. Wrong password and unknown email both return `401 AUTH_INVALID_CREDENTIALS` with **one** message (`API.md` §2, AUTH-1; `PRD.md` §10).
2. Successful login sets `__Host-spm_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain` (`AGENTS.md` §5.10).
3. Admin creates a user, issues a password reset, the user signs in with the temporary password and is forced through AUTH-5; **other** sessions are revoked on change (`API.md` IDN-7, AUTH-5).
4. `IDN-6` refuses self-deactivation and refuses leaving zero active Admins (`USER_SELF_DEACTIVATION`, `USER_LAST_ADMIN`).
5. Unlock clears the throttle; the next login succeeds (`IDN-8`).
6. `GET /api/health` is public; `GET /api/health/details` rejects a session cookie and accepts only the machine token (`API.md` COR-3, COR-4).

### 1.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | Every change cites `PRD.md` §10, US-1.3, US-1.4; `ARCHITECTURE.md` §6.1/§7/§5.12; `API.md` §2/§3.1/§3.12 |
| No invented entities | Exactly the 17 IDs above; no extra field, code or capability |
| Capability check | `requireCapability` inside IDN-3…IDN-8; guard distribution matches `API.md` §8.3 (AUTH-1 public, AUTH-2…5 session-only, COR-4 token) |
| Validation rules | V-13, V-25, V-26, V-27, V-29 pass + fail (`API.md` §4) |
| Error contract | `AUTH_*`, `PASSWORD_*`, `USER_*`, `FILE_*`, `VALIDATION_FAILED`, `RATE_LIMITED` only; `fields` only on 400/422 |
| Wire format | `SessionInfo`, `User`, `FileObject` DTOs; no `password_hash` ever leaves the server |
| CAS | Not applicable — no `version`-ed aggregate is reachable in this phase |
| Idempotency | Not applicable — only SAL-6 and LED-3 accept `clientRequestId` (`API.md` §1.7) |
| Transaction | user/session/audit writes share one transaction (`ARCHITECTURE.md` §4.4) |
| Schema safety | No migration edited; `grants.sql` re-run; `verify_grants.sql` returns 0 rows (`DATABASE.md` §8.4) |
| Money and dates | `core/money` and `core/datetime` exist and are unit-tested before any endpoint needs them (`ARCHITECTURE.md` §12.6–§12.7) |
| Files and secrets | COR-1 magic-byte allowlist, size caps, EXIF strip; `APP_SECRETS_KEY` never logged |
| i18n | Login/Users strings in `en.json` and `ur.json`; UR render test green; no literals |
| UI states | Loading, empty, error per `DESIGN.md` §8 |
| Tests | Unit + integration + the E2E flow in §1.7; no skips, no `.only` |
| Concurrency | Two simultaneous `PATCH /api/users/{id}` that would each remove the last other Admin → exactly one succeeds, one `409 USER_LAST_ADMIN` |
| Open Questions | Any judgment call logged; none expected in this phase |
| Logging | pino redaction on; no password, token, cookie or CSRF value in any line (`ARCHITECTURE.md` §14.8) |
| Diff hygiene | 17 endpoints delivered as several capability-sized PRs; no unrelated refactor |

---

## 2. Phase 2 — Setup

### 2.1 Modules

`setup` — `ARCHITECTURE.md` §4.2, §5.2. Depends on Core and Audit (`ARCHITECTURE.md` §4.3). Inventory depends on Setup, so this phase must be complete before Phase 3 starts.

### 2.2 Endpoints (11)

| Group | IDs | Source |
|---|---|---|
| Company profile and logo | SET-1, SET-2 | `API.md` §3.2 |
| Projects and master plan | SET-3, SET-4, SET-5, SET-6, SET-7 | `API.md` §3.2 |
| Blocks | SET-8, SET-9, SET-10, SET-11 | `API.md` §3.2 |

**Build order inside the phase:** company (SET-1, SET-2) → projects (SET-3…SET-7) → blocks (SET-8…SET-11). SET-7 binds a `file_object` that was uploaded in Phase 1; the two-step upload flow is mandatory (`API.md` §3.12).

### 2.3 Tables that become active (3)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `company` | SET-1/SET-2, including `marla_sqft` and `pdf_terms_text` | §3.2 |
| `project` | SET-3…SET-7; holds `master_plan_file_id` and the dimensions INV-1 returns | §3.2 |
| `block` | SET-8…SET-11; hard delete only when no plot references it | §3.2 |

`app_setting` was activated in Phase 1 as a read-only config table and still has no endpoint (`API.md` §3.2).

### 2.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 14 | **Settings** | Partial: company profile, logo, PDF terms text, marla conversion, projects, blocks (`PRD.md` §11 #14). Expense categories arrive in Phase 5; reminder templates and channel config in Phase 6 |
| 2 | **Dashboard** | No change (shell only) |

### 2.5 Deferred to later phases

- Plot records, polygons and the map (Phase 3, `API.md` §3.3).
- Booking anything (Phase 4).
- Cash categories in Settings (Phase 5, CSH-4…CSH-6).
- Reminder templates and channel configuration (Phase 6, REM-1…REM-5).
- Rendering the letterhead and `pdf_terms_text` into a PDF (Phase 6, DOC-1; `ARCHITECTURE.md` §8.4). The field is stored here; nothing consumes it yet.

### 2.6 Seed data (AG-Q5)

| Seeded entity | First needed here | Why |
|---|---|---|
| 1 company | Yes — this phase | SET-1 returns `404 COMPANY_NOT_CONFIGURED` until the singleton exists; every later screen header reads it |
| 1 project | Yes — this phase | SET-3…SET-7; the map and every plot hang off it |
| 2 blocks | Yes — this phase | SET-8; plots are created against a block in Phase 3 |

The seed company/project/blocks are created without bypassing any `DATABASE.md` §6 constraint, with deterministic ids (`AGENTS.md` AG-Q5).

### 2.7 Integration/E2E checkpoint

**PRD §7 J-1, steps 1–2, plus the block records step 4 will need.** Admin signs in → creates the company profile and logo → creates a project → uploads the master-plan image → creates two blocks. The screenshot at the close of this phase shows the Settings screen and the project/block lists; the map itself is Phase 3.

### 2.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | Every change cites `PRD.md` §11 #14, US-1.1, US-1.2, §7 J-1 steps 1–2; `ARCHITECTURE.md` §5.2; `API.md` §3.2 |
| No invented entities | Exactly SET-1…SET-11; `app_setting` stays endpoint-free |
| Capability check | `setup.manage` on company/project/block writes; `inventory.read` on project/block reads; `inventory.manage` on SET-7 (`API.md` §8.3) |
| Validation rules | V-12, V-14, V-18 (SET-6, SET-7), V-19 (SET-2, SET-4, SET-6), V-25, V-27 pass + fail |
| Error contract | `COMPANY_NOT_CONFIGURED`, `PROJECT_NOT_FOUND`, `BLOCK_NOT_FOUND`, `BLOCK_IN_USE`, `FILE_KIND_MISMATCH`, `FILE_NOT_FOUND`, `CONFLICT_STALE_WRITE`, `VALIDATION_FAILED` |
| Wire format | `Company`, `Project`, `Block` DTOs; money/area decimal strings; `YYYY-MM-DD` never appears because Setup holds no business dates |
| CAS | `PATCH /api/projects/{id}` (SET-6) and SET-7 send and check `version`; a stale write is `409 CONFLICT_STALE_WRITE` |
| Idempotency | Not applicable |
| Transaction | company/project/block writes + audit row in one transaction (`ARCHITECTURE.md` §4.4) |
| Schema safety | singleton `uq_company_singleton` and `ck_company_marla` exercised; `verify_grants.sql` 0 rows |
| Money and dates | `marla_sqft` handled as a decimal string; no date logic in this phase |
| Files and secrets | A logo or master plan is bound only through its `file_object` id; replaced objects are soft-deleted (`ARCHITECTURE.md` §7.5) |
| i18n | Settings strings in both catalogs; UR render test |
| UI states | Empty state before the singleton exists; error state on `404 COMPANY_NOT_CONFIGURED` (`DESIGN.md` §8) |
| Tests | Unit (marla conversion), integration (SET-1…SET-11), E2E J-1 steps 1–2 |
| Concurrency | Two simultaneous first-run `PUT /api/company` → one create, one update; `uq_company_singleton` proves it (`API.md` SET-2) |
| Open Questions | Any judgment call logged |
| Logging | File storage keys never logged; audit summary holds ids and field names only |
| Diff hygiene | Split by capability: company, projects, blocks |

---

## 3. Phase 3 — Inventory

### 3.1 Modules

`inventory` — `ARCHITECTURE.md` §4.2, §5.3. Depends on Setup (complete in Phase 2) and Audit. Sales depends on Inventory, so the plot lock and status transitions must exist before Phase 4.

### 3.2 Endpoints (12)

| Group | IDs | Source |
|---|---|---|
| Map and plot reads | INV-1, INV-2, INV-4, INV-9 | `API.md` §3.3 |
| Plot create/edit/delete | INV-3, INV-5, INV-6 | `API.md` §3.3 |
| Polygons | INV-7, INV-8 | `API.md` §3.3 |
| Status commands | INV-10, INV-11, INV-12 | `API.md` §3.3 |

**Build order inside the phase:** plot reads (INV-1, INV-2, INV-4, INV-9) → create/edit/delete (INV-3, INV-5, INV-6) → polygons (INV-7, INV-8) → status commands (INV-10…INV-12). The map can render before the drawing tool is finished because a plot may legally have no polygon (`API.md` INV-8 notes).

### 3.3 Tables that become active (2)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `plot` | INV-1…INV-12; `version` CAS, polygon CHECK, price/size CHECKs | §3.3 |
| `plot_status_history` | INV-9 reads; INV-10/11/12 and the Phase 4 booking/cancel write | §3.3 |

### 3.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 3 | **Plot Map** | Complete for drawing and status: master plan, polygons, legend, search, detail panel, reserve/release/mark-sold (`PRD.md` §11 #3, §7 J-1) |
| 4 | **Plot List** | Complete: filters, sort, pagination (`PRD.md` §11 #4) |
| 5 | **Plot Details** | Partial: record, status history, edit, reserve/release; mark-sold is present but its legal `BOOKED_TOKEN` origin first exists in Phase 4. The linked-booking section and the **Book** action need Sales — INV-4 deliberately does not embed booking data; the panel calls `GET /api/bookings?plotId=…` once that exists (`API.md` INV-4 notes) |
| 2 | **Dashboard** | Gains the "available plots" tile only (Sales tile in Phase 4) |

### 3.5 Deferred to later phases

- The **Book** action and any booking-aware filter (Phase 4, SAL-6/SAL-7).
- The full positive path of INV-12 in the UI: `BOOKED_TOKEN → SOLD_CONSTRUCTED` requires a booking, so the browser journey lands in Phase 4 while the integration test covers it here with a fixture (`AGENTS.md` §7.4).
- Buyer photos and buyer CRUD (Phase 4).
- Map colouring for `BOOKED_TOKEN`/`SOLD_CONSTRUCTED` beyond the enum's existence — those states first occur in Phase 4.

### 3.6 Seed data (AG-Q5)

| Seeded entity | First needed here | Why |
|---|---|---|
| 12 plots | Yes — this phase | INV-1/INV-2 need a populated map and list; the drawing tool needs existing polygons to edit |
| Mixed statuses | Partly | `AVAILABLE` and `RESERVED` rows here; the `BOOKED_TOKEN` example arrives with the seeded booking in Phase 4 (`AGENTS.md` AG-Q5, "mixed statuses") |

Plots are created through INV-3 after their blocks exist, or seeded with the same invariants; no polygon outside `[0,1]`, no zero area (`DATABASE.md` §6.3 `ck_plot_polygon`).

### 3.7 Integration/E2E checkpoint

**PRD §7 J-1, complete.** Admin signs in → company/project/master plan already exist → draws polygons and creates plots → edits a price → reserves and releases a plot → sees the status history → the map shows colour-coded, clickable plots.

Nothing in J-1 needs a booking; the **Book** action belongs to J-2 and lands in Phase 4.

### 3.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | `PRD.md` §11 #3–#5, §7 J-1, US-2.x; `ARCHITECTURE.md` §5.3, §12.4; `API.md` §3.3 |
| No invented entities | Exactly INV-1…INV-12; no "status edit" endpoint (INV-5 refuses `status`) |
| Capability check | `inventory.manage` (INV-3, INV-5…INV-8), `inventory.status` (INV-10…INV-12), `inventory.read` (INV-1, INV-2, INV-4, INV-9) |
| Validation rules | V-10, V-11, V-18 (INV-5, INV-7, INV-8), V-19, V-25, V-27 pass + fail |
| Error contract | `PLOT_NOT_FOUND`, `PLOT_NUMBER_EXISTS`, `PLOT_IN_USE`, `PLOT_STATUS_INVALID`, `POLYGON_INVALID`, `BLOCK_PROJECT_MISMATCH`, `CONFLICT_STALE_WRITE` |
| Wire format | `Plot` DTO with decimal-string price/size and `[[x,y], …]` polygon; `PlotHistoryRow` with ISO timestamps |
| CAS | INV-5, INV-7, INV-8 (query param) send and check `version`; new version returned |
| Idempotency | Not applicable — status commands are state-guarded, not keyed (`API.md` §1.7) |
| Transaction | lock plot → update status → history → audit, in one transaction (`ARCHITECTURE.md` §4.4) |
| Schema safety | `ck_plot_polygon`/`spm_polygon_ok`, `ck_plot_history_transition`, partial indexes exercised; `verify_grants.sql` 0 rows |
| Money and dates | price and size through `core/money`; no ad-hoc arithmetic |
| Files and secrets | Master plan served only through COR-2 with an ETag; never a storage path (`ARCHITECTURE.md` §7.4) |
| i18n | Map legend, empty state, history strings in both catalogs; UR render test |
| UI states | No master plan → upload empty state; no polygons → "not drawn" state; 409 stale → reload prompt (`DESIGN.md` §8) |
| Tests | Unit (polygon validation), integration (every INV id, every CHECK), E2E J-1 |
| Concurrency | Two simultaneous INV-5 edits on one `version` → one 200, one `409 CONFLICT_STALE_WRITE`; two simultaneous INV-10 reserves → one 200, one `409 PLOT_STATUS_INVALID` |
| Open Questions | Any judgment call logged |
| Logging | Polygon arrays never logged in full; audit holds ids, status pairs and field names |
| Diff hygiene | Split: map reads, plot CRUD, polygons, status commands |

---

## 4. Phase 4 — Sales

### 4.1 Modules

`sales` — `ARCHITECTURE.md` §4.2, §5.4. Depends on Inventory (Phase 3) and Audit. Ledger depends on Sales, so the booking, plan and due-item APIs must be complete before Phase 5.

### 4.2 Endpoints (13)

| Group | IDs | Source |
|---|---|---|
| Buyers | SAL-1, SAL-2, SAL-3, SAL-4, SAL-5 | `API.md` §3.4 |
| Booking create and reads | SAL-6, SAL-7, SAL-8 | `API.md` §3.4 |
| Booking edits and cancellation | SAL-9, SAL-10, SAL-11 | `API.md` §3.4 |
| Notes | SAL-12, SAL-13 | `API.md` §3.4 |

**Build order inside the phase:** buyers (SAL-1…SAL-5) → booking confirm (SAL-6) → reads (SAL-7, SAL-8) → post-confirm edits (SAL-9, SAL-10) → cancel (SAL-11) → notes (SAL-12, SAL-13). SAL-8 needs the open-balance query that Recovery reuses (`ARCHITECTURE.md` §11.5, `API.md` SAL-8) — implement it inside Sales and expose it; Recovery calls it in Phase 6.

### 4.3 Tables that become active (6)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `buyer` | SAL-1…SAL-5; CNIC uniqueness, phone E.164 | §3.4 |
| `booking` | SAL-6, SAL-7, SAL-8, SAL-9, SAL-11; `version`, booking-ref sequence | §3.4 |
| `payment_plan` | SAL-6 creates the snapshot; SAL-8 reads it | §3.4 |
| `booking_buyer` | SAL-6 inserts shares; SAL-10 replaces the set | §3.4 |
| `booking_note` | SAL-12/SAL-13; append-only | §3.4 |
| `due_item` | SAL-6 generates; SAL-8 reads; `amount_paid` stays zero until Phase 5 | §3.4 |

### 4.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 6 | **Booking Wizard** | Complete for steps 1–6: plot → price → buyers → plan (live preview from the shared `core/money` function) → review → confirm (`PRD.md` §7 J-2) |
| 7 | **Bookings List** | Complete: filters and pagination (`PRD.md` §11 #7) |
| 8 | **Booking Detail** | Partial: buyers, plan, due items, totals, cancel. Ledger panel and PDF downloads arrive in Phases 5 and 6 |
| 9 | **Buyers List / Buyer Detail** | Partial: records, contacts, photo, bookings. Combined ledger arrives in Phase 5 |
| 5 | **Plot Details** | Gains the linked-booking section and the **Book** action (SAL-7 `?plotId=`) |
| 2 | **Dashboard** | Gains the "recent bookings" tile |

### 4.5 Deferred to later phases

- Recording and voiding payments, allocations, advance credit, buyer/booking ledgers (Phase 5, LED-1…LED-5).
- PDF downloads of the Allotment Letter and Payment Schedule (Phase 6, DOC-1/DOC-2). J-2's step 7 is therefore not part of this phase's checkpoint.
- Recovery links and overdue lists (Phase 6).
- The ledger panel inside Booking Detail and Buyer Detail (Phase 5).

### 4.6 Seed data (AG-Q5)

| Seeded entity | First needed here | Why |
|---|---|---|
| 2 buyers | Yes — this phase | SAL-1/SAL-3 need records; one becomes the primary buyer of the seeded booking |
| 1 confirmed booking with a 6-installment plan and its due items | Yes — this phase | Gives SAL-7/SAL-8 a real record and flips one seeded plot to `BOOKED_TOKEN` (completing AG-Q5's "mixed statuses") |
| Ledger rows for that booking | Phase 5 | Deliberately none — Phase 5's payment tests create their own (`AGENTS.md` §7.4) |

The seeded booking is created through `createBooking` — the public Sales function, not raw inserts (`ARCHITECTURE.md` §4.2) — so the plan math, shares and due items satisfy every constraint.

### 4.7 Integration/E2E checkpoint

**PRD §7 J-2, steps 1–6.** A Sales Agent finds an available plot → books it with two buyers at 100% shares → configures a monthly plan → sees the preview → confirms → the plot flips to `BOOKED_TOKEN`, the booking appears in the list and detail, and a second confirm attempt on the same plot gets `409 BOOKING_PLOT_UNAVAILABLE`.

Step 7 (PDFs) is explicitly deferred to Phase 6 and is asserted there.

### 4.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | `PRD.md` §7 J-2, US-3.1–US-3.4, §16 BR-3/BR-5; `ARCHITECTURE.md` §5.4, §12.1, §12.5; `API.md` §3.4 |
| No invented entities | Exactly SAL-1…SAL-13; no price/plan revision endpoint (API-Q2 is resolved as cancel-and-rebook) |
| Capability check | `buyer.read/edit/consent`, `booking.create/manage/cancel/note`, `sales.read` exactly as `API.md` §8.3 |
| Validation rules | V-1…V-9, V-14, V-18 (SAL-4/5/9/10), V-25, V-27, V-30 pass + fail |
| Error contract | `SHARE_*`, `BUYER_*`, `PLAN_INVALID`, `BOOKING_*`, `DUPLICATE_BUYER`, `CNIC_*`, `CONFLICT_STALE_WRITE` |
| Wire format | `Booking`, `BookingDetail`, `Buyer` DTOs; money strings; business dates `YYYY-MM-DD`; enum values from `DATABASE.md` §4 |
| CAS | SAL-4, SAL-5, SAL-9, SAL-10 send and check `version`; new version returned |
| Idempotency | SAL-6 looks up `(created_by, client_request_id)` **before** locking; replay returns `200` + `Idempotent-Replay: true` |
| Transaction | plot lock → booking → buyers → plan → due items → status → history → audit, one transaction, fixed lock order (`ARCHITECTURE.md` §4.4, §12.3) |
| Schema safety | `one_active_booking_per_plot`, `one_primary_buyer_per_booking`, `ck_plan_amounts`, `ck_plan_installments` exercised; `verify_grants.sql` 0 rows |
| Money and dates | plan math only in `core/money`; calendar arithmetic and end-of-month clamping in `core/datetime`; property tests (`ARCHITECTURE.md` §12.6–§12.7) |
| Files and secrets | Buyer photo bound through COR-1; no path or original filename returned (`API.md` COR-1) |
| i18n | Wizard, list, detail, notes in both catalogs; UR render test with form state preserved |
| UI states | Plot unavailable → recovery path (PRD §12); no buyers → empty state; plan preview error state |
| Tests | Unit (plan math, shares), integration (every SAL id, every V-rule), E2E J-2 1–6 |
| Concurrency | Two simultaneous SAL-6 on one plot → one `201`, one `409 BOOKING_PLOT_UNAVAILABLE`; same `clientRequestId` → `200` replay; two simultaneous SAL-10 → one 200, one 409 |
| Open Questions | Any judgment call logged; API-Q2/API-Q3 are already resolved and must not be re-opened |
| Logging | No CNIC, phone or address in logs or audit summaries (`ARCHITECTURE.md` §13.2) |
| Diff hygiene | Split: buyers, booking confirm, booking reads, booking edits/cancel, notes |

---

## 5. Phase 5 — Ledger and Cashbook

### 5.1 Modules

`cashbook` first, then `ledger` — because `ARCHITECTURE.md` §4.3 draws `Ledger ──► Cashbook`: a payment posts a linked cash entry inside the Ledger transaction via `cashbook.postLinkedIn(tx, …)`. Building Ledger first would force a reverse dependency.

### 5.2 Endpoints (11)

| Group | IDs | Source |
|---|---|---|
| Cashbook | CSH-1, CSH-2, CSH-3, CSH-4, CSH-5, CSH-6 | `API.md` §3.6 |
| Ledger | LED-1, LED-2, LED-3, LED-4, LED-5 | `API.md` §3.5 |

**Build order inside the phase:** categories (CSH-4…CSH-6) → cash entries (CSH-1…CSH-3) → ledger reads (LED-1, LED-2, LED-4) → record payment (LED-3) → void (LED-5). Recording a payment is last because it needs both modules in one transaction.

### 5.3 Tables that become active (4)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `cash_category` | CSH-4…CSH-6; the eight seeded rows are first read here | §3.6 |
| `cash_entry` | CSH-1…CSH-3 and the auto-post from LED-3 | §3.6 |
| `payment` | LED-3, LED-4, LED-5 | §3.5 |
| `payment_allocation` | LED-3 writes; LED-5 reverses; LED-1/LED-2 read | §3.5 |

### 5.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 10 | **Record Payment** | Complete: allocation, methods, advance credit display (`PRD.md` §11 #10) |
| 11 | **Roznamcha** | Complete: daily diary, running totals, manual entries, void (`PRD.md` §11 #11) |
| 8 | **Booking Detail** | Gains the ledger panel and payment/void actions |
| 9 | **Buyers List / Buyer Detail** | Gains the combined ledger |
| 14 | **Settings** | Expense categories become editable (`CSH-4…CSH-6`) |
| 2 | **Dashboard** | Gains "today's cash" |

### 5.5 Deferred to later phases

- Cash-flow and income-statement reports (Phase 6, REP-1/REP-2).
- Recovery and overdue views (Phase 6, REC-1…REC-3).
- Audit Log screen (Phase 7).

The Roznamcha is complete here: CSH-1 returns its own daily and period totals, and `ARCHITECTURE.md` §11.1 keeps one source for cash totals. Reports is a separate surface with its own endpoints in Phase 6.

### 5.6 Seed data (AG-Q5)

| Seeded entity | First needed here | Why |
|---|---|---|
| 8 cash categories | Yes — this phase | CSH-4 lists them; CSH-2 requires a category; "Booking Receipt" is the target of the auto-post (`DATABASE.md` §9.1, DQ-13) |
| Payments for the seeded booking | No | Phase 5 tests create their own; the demo dataset stays at "confirmed, unpaid" so Phase 6's recovery numbers are predictable |

### 5.7 Integration/E2E checkpoint

**PRD §7 J-3, complete; J-4 steps 1–2.**

1. Open the seeded booking → ledger shows price, paid (zero), balance and due items.
2. Record a payment; allocation fills the oldest due items first; the linked `cash_entry` appears in the Roznamcha with no second action.
3. Overpay → the excess shows as advance credit; it is **never** applied automatically (`API.md` §7, API-Q3).
4. Void the payment with a reason → due items recompute, the cash entry is voided, both stay visible.
5. Add a manual Roznamcha expense and void it (`CSH-2`, `CSH-3`).

### 5.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | `PRD.md` §7 J-3/J-4, US-5.x, D-10; `ARCHITECTURE.md` §5.5, §5.6, §12.2; `API.md` §3.5, §3.6 |
| No invented entities | Exactly LED-1…LED-5 and CSH-1…CSH-6; no "apply credit" command |
| Capability check | `payment.record/void`, `ledger.read`, `cashbook.record` (also guards reads), `cashbook.categories` |
| Validation rules | V-15, V-16, V-17, V-20, V-21, V-24 (CSH-1), V-25, V-27 pass + fail |
| Error contract | `ALLOCATION_*`, `PAYMENT_*`, `CASH_*`, `CONFLICT_STALE_WRITE`, `CONFLICT_RETRY`, `RATE_LIMITED` |
| Wire format | `Payment`, `Ledger`, `CashEntry` DTOs; money strings; timestamps ISO-8601 UTC |
| CAS | `version` on `payment`/`cash_entry` void commands as documented; no silent second void |
| Idempotency | LED-3 looks up `(recorded_by, client_request_id)` before locking; replay `200` + header |
| Transaction | Ledger owns it; Sales due items and Cashbook's linked entry join it; lock order `plot → booking → due items → cash entry`; no provider/PDF calls inside |
| Schema safety | `uq_cash_entry_linked_payment`, `ck_payment_void_fields`, `ck_cash_entry_void_fields`, `trg_payment_immutable`, `trg_cash_entry_immutable`; `verify_grants.sql` 0 rows; `spm_app` has no `DELETE` on either table |
| Money and dates | every amount through `core/money`; allocation arithmetic exact; business date is PKT |
| Files and secrets | payment reference is text, not a file; nothing secret is logged |
| i18n | Record Payment, Roznamcha, ledger strings in both catalogs |
| UI states | Overpayment → advance-credit notice; void → reason dialog; empty Roznamcha day |
| Tests | Unit (allocation, rounding), integration (every LED/CSH id, triggers, grants), E2E J-3 |
| Concurrency | Two simultaneous payments on one booking respect the lock and never over-allocate; double LED-3 with the same key → one payment, `200` replay |
| Open Questions | Any judgment call logged; API-Q3/API-Q6 are settled and not re-opened |
| Logging | Cheque numbers and references are not secrets but stay out of audit summaries beyond the id; no PII |
| Diff hygiene | Split: categories, cashbook entries, ledger reads, payment record, payment void |

---

## 6. Phase 6 — Recovery, Reminders, Documents, Reporting

### 6.1 Modules

`recovery`, `reminders`, `documents`, `reporting` — `ARCHITECTURE.md` §4.2, §5.7–§5.10. All four are leaves: Recovery and Reporting are read-only; Documents is stateless; Reminders writes only its own tables. This phase also introduces the **worker process** (`ARCHITECTURE.md` §10.4), which is why it is the first phase with any scheduled work.

### 6.2 Endpoints (14)

| Group | IDs | Source |
|---|---|---|
| Recovery | REC-1, REC-2, REC-3 | `API.md` §3.7 |
| Reminders | REM-1, REM-2, REM-3, REM-4, REM-5, REM-6, REM-7 | `API.md` §3.8 |
| Documents | DOC-1, DOC-2 | `API.md` §3.9 |
| Reporting | REP-1, REP-2 | `API.md` §3.10 |

**Build order inside the phase:** Recovery (REC-1…REC-3) → Reminders (REM-1…REM-7, worker and scheduler) → Documents (DOC-1, DOC-2) → Reporting (REP-1, REP-2). Recovery first because it consumes Sales' open-balance query; Reporting last because it must be checked against a Roznamcha that already exists.

### 6.3 Tables that become active (4)

| Table | First use | `DATABASE.md` |
|---|---|---|
| `reminder_template` | REM-1…REM-3; the four seeded SMS rows are first read here | §3.7 |
| `provider_config` | REM-4/REM-5; the seeded dry-run row is first read here | §3.7 |
| `reminder_claim` | scheduler tick; unique claim per milestone | §3.7 |
| `reminder_log` | REM-7; scheduler writes `SENT`/`FAILED`/`SKIPPED` | §3.7 |

`job_run` begins receiving rows here, when the worker records each tick (`ARCHITECTURE.md` §10.4). Recovery, Documents and Reporting add no tables (`DATABASE.md` §3.8, §3.9).

### 6.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 12 | **Recovery** | Complete: outstanding, overdue, upcoming, filters, CSV (`PRD.md` §11 #12) |
| 13 | **Reports** | Complete: cash flow and income statement, date range, print (`PRD.md` §11 #13) |
| 17 | **Reminder Log** | Complete: every attempt, status, milestone, channel (`PRD.md` §11 #17) |
| 8 | **Booking Detail** | Complete: PDF downloads added (DOC-1, DOC-2) |
| 14 | **Settings** | Complete: reminder templates and channel configuration (REM-1…REM-5) |
| 2 | **Dashboard** | Complete: overdue tile and the failed-sends banner (`API.md` REM-7 notes) |

### 6.5 Deferred to later phases

- Audit Log screen and `AUD-1…AUD-3` (Phase 7).
- Nightly integrity checks, session cleanup, orphan-file cleanup, stale-claim recovery and log pruning — the worker exists here, but these 02:00 PKT jobs are part of Phase 7 hardening (`ARCHITECTURE.md` §10.4, §12.9).
- Live provider credentials: the phase ships with `dry-run` enabled and `is_live = false` (`AGENTS.md` AG-Q8, `ARCHITECTURE.md` §10.9).

### 6.6 Seed data (AG-Q5)

| Seeded entity | First needed here | Why |
|---|---|---|
| 4 SMS templates | Yes — this phase | REM-1 lists them; the scheduler renders one per milestone (`DATABASE.md` §9.2) |
| 1 provider row, `dry-run`, `is_live = false` | Yes — this phase | REM-4 renders the dry-run banner; no claim and no provider call (`ARCHITECTURE.md` §10.9) |
| Any reminder history | No | Produced by the scheduler during the checkpoint, not seeded |

### 6.7 Integration/E2E checkpoint

**PRD §7 J-4, complete; J-5, complete; J-2 step 7.**

1. Recovery totals equal the sum of the underlying open due items (`ARCHITECTURE.md` §12.9 check 8) and reconcile to the buyer ledgers (PRD S-4); CSV export matches the on-screen list (REC-3).
2. A tick in dry-run writes `SKIPPED`/`dry_run` rows with the real rendered body and creates **no** claim (`ARCHITECTURE.md` §10.6, §10.9); REM-7 shows them.
3. In a test environment, switch the channel to `local-sms-gateway` (`AGENTS.md` AG-Q8), send a test message (REM-6), then run a tick against a due item inside the 09:00–20:00 window and observe exactly one `SENT` row and one claim.
4. Download both PDFs for the seeded booking; assert English-only, A4, letterhead, and identical bytes on re-download for unchanged data (`PRD.md` BR-6, `ARCHITECTURE.md` §8.5).
5. Cash-flow and income-statement totals reconcile with the Roznamcha for the same range (PRD S-6, `ARCHITECTURE.md` §11.1).

### 6.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | `PRD.md` §7 J-4/J-5, US-4.1–US-4.2, US-6.x, US-7.x, BR-6; `ARCHITECTURE.md` §5.7–§5.10, §8, §10, §11; `API.md` §3.7–§3.10 |
| No invented entities | Exactly REC-1…REC-3, REM-1…REM-7, DOC-1…DOC-2, REP-1…REP-2; no resend, no second live channel, no stored PDF |
| Capability check | `recovery.read`, `reminder.read/configure`, `document.download`, `report.read` |
| Validation rules | V-22, V-23, V-24, V-25, V-27, V-28 (REC-3) pass + fail |
| Error contract | `REMINDER_*`, `PROVIDER_*`, `CHANNEL_CONFLICT`, `INVALID_PHONE`, `RATE_LIMITED`, `DATE_RANGE_INVALID` |
| Wire format | `ReminderLogRow`, `ProviderConfig` (secret never present), report rows with money strings |
| CAS | No `version`-ed aggregate is edited here; template edits are CAS-free by contract (`API.md` REM-3) |
| Idempotency | Not the keyed commands; duplicate prevention is the claim (`ARCHITECTURE.md` §10.6) |
| Transaction | Reminders writes claims + log only, never financial rows; report queries are one statement (`ARCHITECTURE.md` §4.4) |
| Schema safety | `uq_reminder_claim_due_item_milestone`, `ck_provider_config_live` exercised; `verify_grants.sql` 0 rows |
| Money and dates | report arithmetic through `core/money`; PKT boundaries, 09:00–20:00 window, calendar milestones through `core/datetime` |
| Files and secrets | provider secret AES-256-GCM, write-only, never returned or logged (`ARCHITECTURE.md` §10.10) |
| i18n | Reports/Reminder Log strings in both catalogs; PDFs and CSV headers English-only (`DESIGN.md` §12) |
| UI states | Dry-run banner, no-template state, empty report range, PDF failure state |
| Tests | Unit (window, milestone, claim), integration (REM/REC/REP parity), PDF snapshots incl. 120 installments, E2E J-4/J-5 |
| Concurrency | Two concurrent ticks → advisory lock makes the second a no-op; two processes cannot both claim one milestone |
| Open Questions | AG-Q8 (provider) and AG-Q11 (letter wording) become binding here: apply the recorded default or escalate before shipping |
| Logging | rendered bodies contain the buyer's name and phone — never log them; no number in any line; `requestId` present |
| Diff hygiene | Split: recovery, templates/config, worker+scheduler, PDFs, reports |

---

## 7. Phase 7 — Audit and hardening

### 7.1 Modules

`audit` (read surface) plus cross-cutting hardening. The write path has existed since Phase 1; this phase adds `search`, the screen, and the operational guarantees the earlier phases deferred.

### 7.2 Endpoints (3)

| Group | IDs | Source |
|---|---|---|
| Audit trail | AUD-1, AUD-2, AUD-3 | `API.md` §3.11 |

### 7.3 Tables that become active (0 new)

| Table | Status | `DATABASE.md` |
|---|---|---|
| `audit_log` | Written since Phase 1; **read** surface (filtered list, CSV, booking timeline) is added here | §3.10 |

No other table changes state. All 26 are active or deliberately inactive by this point; `app_setting` remains read-only with no endpoint (`API.md` §3.2).

### 7.4 Screens

| # | Screen | State at phase close |
|---|---|---|
| 16 | **Audit Log** | Complete: filters, CSV export, entity timeline link from Booking Detail (`PRD.md` §11 #16) |
| 1–17 | All others | Complete; this phase runs the full regression rather than adding screens |

### 7.5 Deferred to later phases

Nothing. This is the last phase; anything not done here is not in the MVP (`PRD.md` §4, `ARCHITECTURE.md` §1.4).

### 7.6 Seed data (AG-Q5)

No new entity. The audit rows used by this phase's tests are produced by earlier phases' actions and by the test suite; nothing is seeded into `audit_log`: the table is append-only (`DATABASE.md` §6.4) and seeding it would fabricate history.

### 7.7 Integration/E2E checkpoint

**Full regression of PRD §7 J-1…J-5 in both languages, plus the audit trail.**

1. J-1 → J-5 run end-to-end on a fresh `db:reset`, EN then UR, with the language toggle preserving form state.
2. Every sensitive action appears once in the Audit Log with the right `action_code`, actor and entity; a booking's timeline shows its own events only (AUD-3).
3. CSV export of the audit log respects the same filters as the list (AUD-2, V-28).
4. Nightly integrity checks return zero rows on the healthy dataset and detect a deliberately corrupted fixture (all eight, `ARCHITECTURE.md` §12.9).
5. Restore drill: a `pg_dump` + file backup restored into a clean environment reproduces the same reports (`ARCHITECTURE.md` §14.7).

### 7.8 Phase done — `AGENTS.md` §9 scoped

| §9 line | Proof at this phase |
|---|---|
| Trace complete | `PRD.md` §11 #16, §10 role matrix, FR-9; `ARCHITECTURE.md` §13, §14; `API.md` §3.11 |
| No invented entities | Exactly AUD-1…AUD-3; no delete/update path on the log |
| Capability check | `audit.read` on all three; Admin-only per `ARCHITECTURE.md` §6.2 |
| Validation rules | V-25, V-27, V-28 pass + fail |
| Error contract | `VALIDATION_FAILED`, `AUTH_FORBIDDEN`, `RATE_LIMITED` only |
| Wire format | `AuditLogRow` with ISO timestamps; no PII in `summary` |
| CAS | Not applicable |
| Idempotency | Not applicable |
| Transaction | read-only queries; append-only trigger still enforced |
| Schema safety | `trg_audit_log_append_only` verified again; `verify_grants.sql` 0 rows; no migration edited |
| Money and dates | report money unchanged; audit timestamps UTC, displayed in PKT |
| Files and secrets | no secret or storage key in any audit row or CSV |
| i18n | Audit Log strings in both catalogs; CSV headers English-only |
| UI states | empty log, filtered-empty, CSV error |
| Tests | unit + integration + full E2E suite + all eight nightly checks + restore drill |
| Concurrency | append-only trigger holds under concurrent writers; `job_run` overlap guard proven |
| Open Questions | every remaining `AG-Q` is either closed or explicitly deferred with a date-free owner |
| Logging | log pruning job runs; redaction re-verified against a live request |
| Diff hygiene | Split: audit read surface, nightly checks, ops/deploy |

---

## 8. Traceability — all 81 endpoints

Every endpoint in `API.md` appears exactly once. Counts per phase: **17 + 11 + 12 + 13 + 11 + 14 + 3 = 81**.

| ID | Method and path | Module | Phase |
|---|---|---|---|
| **AUTH-1** | `POST /api/auth/login` | Identity | 1 |
| **AUTH-2** | `POST /api/auth/logout` | Identity | 1 |
| **AUTH-3** | `GET /api/auth/session` | Identity | 1 |
| **AUTH-4** | `POST /api/auth/refresh` | Identity | 1 |
| **AUTH-5** | `POST /api/auth/password` | Identity | 1 |
| **IDN-1** | `GET /api/me` | Identity | 1 |
| **IDN-2** | `PATCH /api/me/language` | Identity | 1 |
| **IDN-3** | `GET /api/users` | Identity | 1 |
| **IDN-4** | `POST /api/users` | Identity | 1 |
| **IDN-5** | `GET /api/users/{id}` | Identity | 1 |
| **IDN-6** | `PATCH /api/users/{id}` | Identity | 1 |
| **IDN-7** | `POST /api/users/{id}/password-reset` | Identity | 1 |
| **IDN-8** | `POST /api/users/{id}/unlock` | Identity | 1 |
| **COR-1** | `POST /api/files` | Core | 1 |
| **COR-2** | `GET /api/files/{id}` | Core | 1 |
| **COR-3** | `GET /api/health` | Core | 1 |
| **COR-4** | `GET /api/health/details` | Core | 1 |
| **SET-1** | `GET /api/company` | Setup | 2 |
| **SET-2** | `PUT /api/company` | Setup | 2 |
| **SET-3** | `GET /api/projects` | Setup | 2 |
| **SET-4** | `POST /api/projects` | Setup | 2 |
| **SET-5** | `GET /api/projects/{id}` | Setup | 2 |
| **SET-6** | `PATCH /api/projects/{id}` | Setup | 2 |
| **SET-7** | `PUT /api/projects/{id}/master-plan` | Setup | 2 |
| **SET-8** | `GET /api/projects/{id}/blocks` | Setup | 2 |
| **SET-9** | `POST /api/projects/{id}/blocks` | Setup | 2 |
| **SET-10** | `PATCH /api/blocks/{id}` | Setup | 2 |
| **SET-11** | `DELETE /api/blocks/{id}` | Setup | 2 |
| **INV-1** | `GET /api/projects/{id}/map` | Inventory | 3 |
| **INV-2** | `GET /api/plots` | Inventory | 3 |
| **INV-3** | `POST /api/plots` | Inventory | 3 |
| **INV-4** | `GET /api/plots/{id}` | Inventory | 3 |
| **INV-5** | `PATCH /api/plots/{id}` | Inventory | 3 |
| **INV-6** | `DELETE /api/plots/{id}` | Inventory | 3 |
| **INV-7** | `PUT /api/plots/{id}/polygon` | Inventory | 3 |
| **INV-8** | `DELETE /api/plots/{id}/polygon` | Inventory | 3 |
| **INV-9** | `GET /api/plots/{id}/history` | Inventory | 3 |
| **INV-10** | `POST /api/plots/{id}/reserve` | Inventory | 3 |
| **INV-11** | `POST /api/plots/{id}/release` | Inventory | 3 |
| **INV-12** | `POST /api/plots/{id}/mark-sold` | Inventory | 3 |
| **SAL-1** | `GET /api/buyers` | Sales | 4 |
| **SAL-2** | `POST /api/buyers` | Sales | 4 |
| **SAL-3** | `GET /api/buyers/{id}` | Sales | 4 |
| **SAL-4** | `PATCH /api/buyers/{id}` | Sales | 4 |
| **SAL-5** | `PATCH /api/buyers/{id}/consent` | Sales | 4 |
| **SAL-6** | `POST /api/bookings` | Sales | 4 |
| **SAL-7** | `GET /api/bookings` | Sales | 4 |
| **SAL-8** | `GET /api/bookings/{ref}` | Sales | 4 |
| **SAL-9** | `PATCH /api/bookings/{ref}` | Sales | 4 |
| **SAL-10** | `PUT /api/bookings/{ref}/buyers` | Sales | 4 |
| **SAL-11** | `POST /api/bookings/{ref}/cancel` | Sales | 4 |
| **SAL-12** | `GET /api/bookings/{ref}/notes` | Sales | 4 |
| **SAL-13** | `POST /api/bookings/{ref}/notes` | Sales | 4 |
| **CSH-1** | `GET /api/cash-entries` | Cashbook | 5 |
| **CSH-2** | `POST /api/cash-entries` | Cashbook | 5 |
| **CSH-3** | `POST /api/cash-entries/{id}/void` | Cashbook | 5 |
| **CSH-4** | `GET /api/cash-categories` | Cashbook | 5 |
| **CSH-5** | `POST /api/cash-categories` | Cashbook | 5 |
| **CSH-6** | `PATCH /api/cash-categories/{id}` | Cashbook | 5 |
| **LED-1** | `GET /api/bookings/{ref}/ledger` | Ledger | 5 |
| **LED-2** | `GET /api/buyers/{id}/ledger` | Ledger | 5 |
| **LED-3** | `POST /api/bookings/{ref}/payments` | Ledger | 5 |
| **LED-4** | `GET /api/payments/{id}` | Ledger | 5 |
| **LED-5** | `POST /api/payments/{id}/void` | Ledger | 5 |
| **REC-1** | `GET /api/recovery/summary` | Recovery | 6 |
| **REC-2** | `GET /api/recovery/dues` | Recovery | 6 |
| **REC-3** | `GET /api/recovery/dues.csv` | Recovery | 6 |
| **REM-1** | `GET /api/reminder-templates` | Reminders | 6 |
| **REM-2** | `POST /api/reminder-templates` | Reminders | 6 |
| **REM-3** | `PATCH /api/reminder-templates/{id}` | Reminders | 6 |
| **REM-4** | `GET /api/reminders/config` | Reminders | 6 |
| **REM-5** | `PATCH /api/reminders/config/{channel}` | Reminders | 6 |
| **REM-6** | `POST /api/reminders/test` | Reminders | 6 |
| **REM-7** | `GET /api/reminders/log` | Reminders | 6 |
| **DOC-1** | `GET /api/bookings/{ref}/documents/allotment-letter.pdf` | Documents | 6 |
| **DOC-2** | `GET /api/bookings/{ref}/documents/payment-schedule.pdf` | Documents | 6 |
| **REP-1** | `GET /api/reports/cash-flow` | Reporting | 6 |
| **REP-2** | `GET /api/reports/income-statement` | Reporting | 6 |
| **AUD-1** | `GET /api/audit-logs` | Audit | 7 |
| **AUD-2** | `GET /api/audit-logs.csv` | Audit | 7 |
| **AUD-3** | `GET /api/bookings/{ref}/timeline` | Audit | 7 |

---

## 9. Coverage checks

### 9.1 Tables — 26, all assigned

| Phase | Tables | Count |
|---|---|---|
| 1 | `app_user`, `session`, `login_throttle`, `audit_log`, `file_object`, `job_run`, `app_setting` | 7 |
| 2 | `company`, `project`, `block` | 3 |
| 3 | `plot`, `plot_status_history` | 2 |
| 4 | `buyer`, `booking`, `payment_plan`, `booking_buyer`, `booking_note`, `due_item` | 6 |
| 5 | `cash_category`, `cash_entry`, `payment`, `payment_allocation` | 4 |
| 6 | `reminder_template`, `provider_config`, `reminder_claim`, `reminder_log` | 4 |
| 7 | — (audit_log read surface only) | 0 |
| **Total** | | **26** |

### 9.2 Screens — 17, all assigned

| Phase | `PRD.md` §11 screens |
|---|---|
| 1 | #1 Login · #15 Users · #2 Dashboard (shell) |
| 2 | #14 Settings (company, projects, blocks) |
| 3 | #3 Plot Map · #4 Plot List · #5 Plot Details |
| 4 | #6 Booking Wizard · #7 Bookings List · #8 Booking Detail · #9 Buyers |
| 5 | #10 Record Payment · #11 Roznamcha |
| 6 | #12 Recovery · #13 Reports · #17 Reminder Log · **#14 and #2 complete** |
| 7 | #16 Audit Log · **all others complete** |

### 9.3 Journeys — 5, all reachable by Phase 6

| Journey | First end-to-end reachable |
|---|---|
| J-1 Digitize a society | Phase 2 (steps 1–2), **Phase 3 complete** |
| J-2 Book a plot | Phase 4 (steps 1–6), **Phase 6 complete incl. PDFs** |
| J-3 Pay an installment | **Phase 5** |
| J-4 Daily Roznamcha and recovery | Phase 5 (steps 1–2), **Phase 6 complete** |
| J-5 Month-end reporting | **Phase 6** |

---

## 10. Sequencing decisions recorded by this plan

These are ordering choices inside the sources, not product decisions. None adds scope. All but SEQ-5 could be reversed by editing this file without touching a locked document; SEQ-5 restates a constraint the schema document already fixes.

| # | Decision | Why | Reversible? |
|---|---|---|---|
| SEQ-1 | COR-1…COR-4 ship in Phase 1 rather than in hardening | They are the Core module's whole HTTP surface (`API.md` §3.12), and health is needed to deploy the very first build | Yes — move to Phase 7; no dependency changes |
| SEQ-2 | The Dashboard is a shell in Phase 1 and gains one tile per phase | `PRD.md` §11 #2 defines its tiles from four different modules; a login landing page with no navigation would block every later E2E | Yes — but a late build blocks the J-1…J-5 E2E runs until it lands |
| SEQ-3 | `app_setting` is counted active in Phase 1 | `core/config` reads it and it has no endpoint by design (`API.md` §3.2, `DATABASE.md` §3.2) | Yes — cosmetic bookkeeping only |
| SEQ-4 | INV-12's positive path is integration-tested with a fixture in Phase 3 | `BOOKED_TOKEN` cannot exist until SAL-6; `AGENTS.md` §7.4 lets tests create their own data | Yes — but its E2E necessarily waits for Phase 4 |
| SEQ-5 | The eight migrations are applied once in Phase 1; demo data is added to `prisma/seed.ts` per phase | `DATABASE.md` §10.1 fixes the migration set; splitting it would contradict the locked schema document | No — this is a source constraint, not a choice |

**Open questions raised by this plan:** none that touch behavior, schema or contract. The plan deliberately does **not** map phases to workflow step numbers: the sources do not define Steps 8–20 as a phase-per-step schedule, and inventing one would be a citation-free claim. Each step executes whatever work closes the next gate in §1–§7.

---

## 11. Self-verification of this document

| Check | Expected | Actual |
|---|---|---|
| Phases | 7, in `ARCHITECTURE.md` §4.3 order | 7 |
| Endpoints in `API.md` | 81 | 81 |
| Endpoints in §8 | 81, each exactly once | 81, each exactly once |
| Endpoints per phase | 17 / 11 / 12 / 13 / 11 / 14 / 3 | 17 / 11 / 12 / 13 / 11 / 14 / 3 = 81 |
| Tables in `DATABASE.md` | 26 | 26 |
| Tables assigned in §9.1 | 26 | 26 |
| Screens in `PRD.md` §11 | 17 | 17 |
| Screens assigned in §9.2 | 17 | 17 |
| Journeys in `PRD.md` §7 | 5 | 5 |

Every phase states the six required elements: modules (§x.1), endpoint IDs with section citations (§x.2), tables (§x.3), screens (§x.4), deferrals (§x.5), and a scoped `AGENTS.md` §9 gate (§x.8). The seed note (§x.6) and the journey checkpoint (§x.7) complete the eight-part shape used in §§1–7.

---

*End of IMPLEMENTATION-PLAN.md.*
