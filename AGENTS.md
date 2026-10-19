# AGENTS.md — Operating Instructions for the Coding Agent

| | |
|---|---|
| **Document status** | **v1.0 — operative** |
| **Date** | 2026-10-20 |
| **Workflow step** | 6 of 20 (governs steps 7–20) |
| **Audience** | The coding agent (an LLM) implementing Society Plot Manager across many separate sessions. **Not** a human reviewer, and not a product document |
| **Source commitment** | `main` @ `6bba345` — `PRD.md` v1.0, `ARCHITECTURE.md` v1.0, `DATABASE.md` v1.0, `API.md` v1.0 |
| **What this file is not** | Not a fifth source of product truth. It never widens scope, never re-decides a product question, and never overrides a source document |

---

## 0. How to use this file

### 0.1 Read order at the start of every session

1. This file, in full. It is the only process document and it is binding.
2. The **specific sections** of the four source documents that the current task touches (use the map in §2.7). Re-open them on disk — never work from memory of a previous session, and never from a summary of one.
3. `git log --oneline -10`, `git status`, and the current branch. Confirm the working tree is clean before you start; if it is not, stop and report what is uncommitted.
4. `docs/OPEN-QUESTIONS.md` (created on first use, §8.4) — the running log of every judgment call already made. A later session must not silently reverse an earlier entry.

### 0.2 Session protocol

**Before writing code**, restate the task as a trace table. If you cannot fill every row, you do not yet understand the task:

| Field | Content |
|---|---|
| PRD | The `US-…` / `FR-…` / `BR-…` that requires this |
| ARCHITECTURE | Module (§5.x), cross-cutting rule (§6, §12, §14), ADR (§18) |
| DATABASE | Tables and constraints (§3.x, §6.x) |
| API | Endpoint IDs (`SAL-6`, `LED-3`, …) and the §4 rules that apply |
| Out of scope | What you are deliberately **not** building in this PR |

**While coding**: smallest vertical slice that satisfies the trace; no drive-by edits; every non-obvious line that enforces a document rule carries a comment naming it (`// API.md §1.6 — CAS on version`).

**Before declaring done**: the checklist in §9, the gates in §7.3, and an updated Open Questions log if you made any judgment call.

### 0.3 What "done" means

A feature is done when it is **traceable, guarded, tested, and reviewable** — not when it "works on my machine". Evidence in the PR beats claims in the PR.

---

## 1. Purpose and authority

This file governs **how the agent works**: which documents win, where code goes, what conventions are mandatory, what is forbidden, what must be tested, and how work is delivered.

It does **not** govern **what the product does**. Product scope, behavior, data model and HTTP contract are fixed — entirely — by:

1. `PRD.md`
2. `ARCHITECTURE.md`
3. `DATABASE.md`
4. `API.md`

Authority rules:

- Where this file and a source document disagree, the **source document wins** and this file is wrong; record the defect (§2.3) and follow the document.
- Where this file is silent, the source documents decide.
- Where the source documents are silent, you do **not** get to decide: §2.3 applies.
- `DESIGN.md` is a **supporting UX specification** (tokens §4, components §5, states §8, accessibility §11, bilingual behavior §12, screens §13, print §14). It refines presentation only. It is not a fifth source of product truth, and a conflict between it and `PRD.md` follows §2.3.
- `README.md` is currently empty and is not a source. `docs/adr/` and `RUNBOOK.md` are **outputs** of this workflow, not inputs.

This file is versioned like the others: changes to it arrive by PR, with a reason, never by silent edit mid-task.

---

## 2. Source-of-truth precedence and conflict protocol

### 2.1 Precedence

| Rank | Document | Owns |
|---|---|---|
| 1 | `PRD.md` | What the product must do: user stories, acceptance criteria, business rules, roles, screens, NFRs, volume assumptions |
| 2 | `ARCHITECTURE.md` | How it is structured: modules, boundaries, transactions, security model, operational model, ADRs |
| 3 | `DATABASE.md` | The schema: tables, columns, types, enums, constraints, indexes, grants, seeds, migrations |
| 4 | `API.md` | The wire contract: endpoints, payloads, status codes, error codes, validation rules, rate limits |

Interpretation, in order:

1. **Behavior** conflicts → `PRD.md` wins (this is also `ARCHITECTURE.md` §15.5's own rule).
2. **Structure** conflicts → `ARCHITECTURE.md` wins.
3. **Schema and SQL object names** → `DATABASE.md` wins.
4. **HTTP surface, payload shapes, status/error codes** → `API.md` wins.
5. Lower-ranked documents implement higher-ranked ones; they never contradict them silently.

### 2.2 What counts as a conflict

A conflict is any of:

- Two documents state different behavior for the same situation.
- A document requires something another document forbids.
- A required value (limit, threshold, code, name) is specified twice with different values.
- An implementation task cannot be completed without inventing something none of the four documents defines — a **gap**, which is treated exactly like a conflict.

### 2.3 The protocol — never resolve silently

When you hit a conflict or a gap:

1. **STOP.** Do not write code that depends on either side. Do not "pick the sensible one".
2. **CITE.** Quote the exact sentence from each document with its section: `PRD.md §16 BR-2`, `ARCHITECTURE.md §12.2`, `DATABASE.md §1.6`, `API.md §1.7`. Line numbers are useful; section numbers are mandatory.
3. **SCOPE IT.** State the blast radius: which endpoints, tables, tests, or screens change under each reading.
4. **PROPOSE ONE DEFAULT.** The smallest default that satisfies the highest-ranked document and is reversible. Say why it is the smallest.
5. **RECORD IT** in `docs/OPEN-QUESTIONS.md` using the exact 4-column format the four documents already use (§8.4), with a new `AG-Q<n>` id. Never reuse an id.
6. **ESCALATE IF BLOCKING.** If the task cannot proceed correctly without a human decision, stop and say so plainly: what is blocked, what you need, and what you would do if told "use your default". Do not open a PR that hides the question in code.
7. **IF NOT BLOCKING.** Implement the proposed default, mark it in code with `// OPEN-QUESTION: AG-Q<n>` at the decision point, and link the entry in the PR description. The entry stays `Open` until a human answers.

Forbidden on conflict: picking a side silently, averaging two values, inventing a third option, "temporarily" exceeding a documented limit, or leaving a `TODO` in place of a decision.

### 2.4 Conflict record template

Use exactly this shape (same as `ARCHITECTURE.md` §19, `DATABASE.md` §11, `API.md` §7):

```markdown
| # | Question | Proposed default | Impact if changed |
|---|---|---|---|
| AG-Q99 *(illustrative id)* | PRD §16 BR-4 says reminders stop at T-0; ARCHITECTURE §10.7 says no attempts after `due_date`. Do T-0 sends count as "after due date" on the due day? | T-0 sends are allowed **on** the due date until 20:00 PKT; the cutoff means `attempted_at::date > due_date`. | One scheduler predicate and two tests; no schema change. |
```

Also record, above the table row: **documents and sections in conflict**, **date**, **status** (`Open` / `Answered` / `Superseded`), and the **PR** that introduced it. Never delete answered rows.

### 2.5 Already-settled divergences (do not re-litigate)

These look like conflicts but are decided; follow the right-hand column:

| Apparent divergence | Follow |
|---|---|
| `ARCHITECTURE.md` writes `user`; `DATABASE.md` names the table `app_user` (SQL reserved word) | `app_user` in all SQL/Prisma code (`DATABASE.md` §3.1) |
| `ARCHITECTURE.md` §13.2 sketches `ip inet`; `DATABASE.md` uses `varchar(45)` + a `family(…::inet)` CHECK (DQ-10) | `varchar(45)` (`DATABASE.md` §3.10) |
| `ARCHITECTURE.md` §7.4 says `/api/files/:publicId`; `API.md` COR-2 says `/api/files/{id}` | `/api/files/{id}` (`API.md` §3.12) — the API owns the wire |
| `ARCHITECTURE.md` §4.2 says Identity owns `user`; `API.md` §3.1 uses `IDN-*` ids for that module | Table `app_user`, module `identity`, endpoints `IDN-*` |
| `PRD.md` §9 summarizes requirements; §8 carries the acceptance criteria | §8 wins when they differ; §9 is a summary |

If you find a divergence not on this list, apply §2.3.

### 2.6 The four documents are locked

- A feature PR **MUST NOT** modify `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md` or `API.md`.
- A genuine document defect is fixed by a **separate, explicitly approved errata PR** — as was done for the `buyer.consent` capability and the Q-1 annotation — with the change listed line by line, and with all downstream statements kept consistent (counts, cross-references, tables).
- Never "fix" a document to match your code.

### 2.7 Where to look (section map)

| Need | Look at |
|---|---|
| What to build, acceptance criteria | `PRD.md` §7 (journeys), §8 (stories + AC), §9 (FR summary), §16 (business rules) |
| Roles and screen permissions | `PRD.md` §10; `ARCHITECTURE.md` §6.2 (the only enforceable matrix) |
| Screens, states, design tokens | `PRD.md` §11–§12; `DESIGN.md` §4–§5, §8, §13 |
| NFRs, volumes, performance | `PRD.md` §15; `ARCHITECTURE.md` §15 |
| Module boundaries, transactions | `ARCHITECTURE.md` §2.4, §4.2–§4.4 |
| Domain behavior per module | `ARCHITECTURE.md` §5.1–§5.12 |
| Auth, sessions, tokens | `ARCHITECTURE.md` §6.1; `API.md` §2 |
| Files, uploads | `ARCHITECTURE.md` §7; `API.md` COR-1/2, V-13, V-14 |
| PDFs | `ARCHITECTURE.md` §8; `API.md` DOC-1/2 |
| i18n and formatting | `ARCHITECTURE.md` §9; `DESIGN.md` §12 |
| Reminders and scheduler | `ARCHITECTURE.md` §10; `API.md` §3.8 |
| Reporting and recovery | `ARCHITECTURE.md` §11; `API.md` §3.7, §3.10 |
| Money, dates, locking, races | `ARCHITECTURE.md` §12; `API.md` §1.6–§1.8, §4 |
| Audit | `ARCHITECTURE.md` §13; `API.md` §3.11 |
| Deployment, config, backup, monitoring | `ARCHITECTURE.md` §14 |
| Schema, constraints, grants, seeds, migrations | `DATABASE.md` §2–§10 |
| HTTP conventions, errors, validation | `API.md` §0–§1, §4–§6 |
| Decisions and their rationale | `ARCHITECTURE.md` §18, §19; `DATABASE.md` §11; `API.md` §7 |

---

## 3. Tech stack

### 3.1 The mandated stack

Restated plainly from `ARCHITECTURE.md` §3.1. Versions are the baseline; pin them exactly in `package.json` and the lockfile, and pin the Docker base images. Do not float majors.

| Layer | Mandated choice |
|---|---|
| Runtime | Node.js LTS 24 |
| Language | TypeScript 5.x, `strict` |
| Web framework | Next.js 16, App Router — route handlers for `/api/*`, server components for data loading |
| UI | React 19 |
| Styling | Tailwind CSS 4.x + CSS variables (DESIGN tokens) |
| UI primitives | Radix UI |
| Icons | Lucide |
| Tables | TanStack Table 8.x |
| Client data | TanStack Query 5.x |
| Forms / validation | React Hook Form + Zod 3.x, the **same** Zod schemas on the server |
| Database | PostgreSQL 17 (18 acceptable on the host image) |
| ORM / migrations | Prisma 6.x + hand-written SQL inside Prisma migrations |
| Map | Konva via react-konva |
| PDF | `@react-pdf/renderer` 4.x, in-process |
| Images | `sharp` |
| i18n | i18next + react-i18next, JSON catalogs |
| Auth | Custom session module + `@node-rs/argon2` |
| Scheduling | node-cron + PostgreSQL advisory locks + claim tables |
| Logging | pino (structured, redacted) |
| Tests | Vitest, React Testing Library, Playwright |
| Container | Docker + Docker Compose |
| Reverse proxy | Nginx + Certbot |
| CI/CD | GitHub Actions + GHCR |
| Backups | `pg_dump` + restic → S3-compatible storage |

### 3.2 No substitution, no additions

- Do **not** replace a named library or service, and do **not** add a runtime service (Redis, a queue, a search engine, a second database, an external auth provider, a component kit, a chart library, a global state library, WebSockets). `ARCHITECTURE.md` §3.5 and §18 record why each alternative was rejected — those reasons still apply.
- Do **not** use Server Actions (`ARCHITECTURE.md` §3.2) or the Edge runtime for anything touching the database, files or PDFs.
- A **new runtime dependency** requires, in the PR: what it replaces, maintenance status, license, bundle/runtime cost (`ARCHITECTURE.md` §3.6). If it is not justified against *this* project, do not add it. Prefer a small amount of code for a one-off need.
- A new **dev** dependency (lint plugin, test helper) is allowed when it serves a documented rule, and must be named in the PR.
- No experimental framework features (PPR, dynamic IO, unstable caching).

### 3.3 Stack-level fallback

The Laravel/Django fallback in `ARCHITECTURE.md` §3.5/§3.7 applies only if the client's team is not TypeScript-capable. That is a human decision, not yours. Until it is made explicitly, implement the mandated stack.

---

## 4. Repository and folder structure

### 4.1 Tree (from `ARCHITECTURE.md` §4.1)

```text
real-estate-sys/
├─ prisma/            schema.prisma · migrations/ · seed.ts
├─ src/
│  ├─ app/            App Router: (auth)/ · (app)/<screens>/ · api/
│  ├─ modules/        identity · setup · inventory · sales · ledger · cashbook
│  │                  recovery · reminders · documents · reporting · audit
│  ├─ core/           db · auth · authz · errors · money · datetime · files
│  │                  ids · logging · jobs · config
│  ├─ i18n/           catalogs · provider · key checks
│  ├─ components/     design-system components
│  ├─ styles/         tokens · fonts · print
│  └─ worker/         scheduler entrypoint
├─ tests/             unit/ · integration/ · e2e/
├─ infra/             docker-compose · db/init · nginx · backup · deploy
├─ docs/adr/          architecture decision records
└─ AGENTS.md · PRD.md · ARCHITECTURE.md · DATABASE.md · API.md · DESIGN.md
```

### 4.2 Module map

Twelve modules. The left column is the module; the API column is where its HTTP surface is defined; the tables column is **ownership**, not a schema restatement (`DATABASE.md` §3).

| Module (`src/modules/…`) | API section | Owned tables (`DATABASE.md` §3) | Capabilities it checks (`ARCHITECTURE.md` §6.2) |
|---|---|---|---|
| `identity` | §2 (AUTH-1…5), §3.1 (IDN-1…8) | `app_user`, `session`, `login_throttle` | `user.manage` for IDN-3…8; AUTH-1 is public, AUTH-2…5 are session-only |
| `setup` | §3.2 (SET-1…11) | `company`, `project`, `block`, `app_setting` | `setup.manage` (company, project, block writes); `inventory.read` (project/block reads); `inventory.manage` (SET-7 master plan); SET-1 is session-only |
| `inventory` | §3.3 (INV-1…12) | `plot`, `plot_status_history`, master-plan file refs | `inventory.manage`, `inventory.status`, `inventory.read` |
| `sales` | §3.4 (SAL-1…13) | `buyer`, `booking`, `booking_buyer`, `booking_note`, `payment_plan`, `due_item` | `booking.create`, `booking.manage`, `booking.cancel`, `booking.note`, `buyer.read`, `buyer.edit`, `buyer.consent`, `sales.read` |
| `ledger` | §3.5 (LED-1…5) | `payment`, `payment_allocation` | `payment.record`, `payment.void`, `ledger.read` |
| `cashbook` | §3.6 (CSH-1…6) | `cash_category`, `cash_entry` | `cashbook.record` (also guards reads), `cashbook.categories` |
| `recovery` | §3.7 (REC-1…3) | — (read model) | `recovery.read` |
| `reminders` | §3.8 (REM-1…7) | `reminder_template`, `provider_config`, `reminder_claim`, `reminder_log` | `reminder.read`, `reminder.configure` |
| `documents` | §3.9 (DOC-1…2) | — (stateless) | `document.download` |
| `reporting` | §3.10 (REP-1…2) | — (read model) | `report.read` |
| `audit` | §3.11 (AUD-1…3) | `audit_log` | `audit.read` |
| `core` | §3.12 (COR-1…4) | `file_object`, `job_run` | by file kind: `inventory.manage` / `setup.manage` / `buyer.edit`; health is public or token-gated |

Notes that the map above cannot show:

- `AUTH-1 … AUTH-5` live in `identity` but are exposed under `/api/auth/*` and are **not** capability-guarded. `API.md` §8.3 defines the guard distribution: 71 capability-guarded, 7 session-only (AUTH-2…5, IDN-1, IDN-2, SET-1), 2 public (AUTH-1, COR-3), 1 machine token (COR-4).
- `cashbook` reads require `cashbook.record` because `ARCHITECTURE.md` §6.2 has no separate cashbook read capability (`API.md` §3.6 states this).
- `Recovery` and `Reporting` are the **only** modules allowed cross-domain SQL reads (`ARCHITECTURE.md` §4.5). Every other cross-module read goes through the owning module's query function.

### 4.3 Module anatomy (mandatory shape)

```text
modules/<module>/
├─ index.ts        the only public surface
├─ schemas.ts      Zod input/output, shared with the client
├─ commands.ts     writes; own the transaction; check capabilities
├─ queries.ts      reads; check read capabilities
├─ repository.ts   Prisma access for this module only
├─ policies.ts     business invariants that are not permissions
├─ errors.ts       module error codes (must exist in API.md §5)
├─ ui/             module-specific components (may import React)
└─ jobs.ts         only for reminders/core: job entry points
```

### 4.4 Boundary rules (enforced in CI, `ARCHITECTURE.md` §2.4)

1. Only `modules/<m>/index.ts` is importable from outside the module.
2. Never import another module's `repository.ts`, `commands.ts`, `queries.ts` internals or `ui/`.
3. Cross-module **writes** go through a public function that accepts the caller's `Tx`. The initiator owns the transaction; collaborators never open one.
4. Only `src/core/db` and `modules/*/repository.ts` may import `@prisma/client`. Pages, route handlers and components never query the database.
5. The domain layer (`index`, `commands`, `queries`, `repository`, `policies`) must not import `next/*`, `react` or `react-dom`. `ui/` may, but nothing may import `ui/` from the domain layer.
6. Only `reporting` and `recovery` may write cross-domain SQL joins.
7. A table has exactly one owning module. Two writers means the boundary is wrong.
8. No cycles — the dependency graph in `ARCHITECTURE.md` §4.3 is the target, and `dependency-cruiser` must enforce it.

### 4.5 Route handlers

- One file per endpoint, mirroring `API.md` (`src/app/api/…/route.ts`).
- Every handler starts with a comment naming its endpoint id and section: `// API.md SAL-6 — POST /api/bookings`.
- The handler is a **thin adapter**: parse (Zod) → resolve session → call the module command/query → map result to the documented status → map errors to the envelope. No business logic, no Prisma, no second capability check.
- The set of route files must be exactly the 81 endpoints in `API.md` §2–§3. Adding a route file is adding an endpoint — forbidden (§6).

---

## 5. Coding conventions

### 5.1 TypeScript and input validation

- `strict: true` is mandatory. Never disable a strict flag per file or line; never use `any` in module code (use `unknown` + Zod, or a precise type).
- **Parse, don't cast.** Every external input — request body, query string, path param, env var, database JSON, provider response — passes through a Zod schema in `schemas.ts` before use.
- The client and server share the same schema object (`ARCHITECTURE.md` §3.1, §4.6).
- Types are derived from schemas (`z.infer<…>`), not hand-declared twice.
- Discriminated unions for status-dependent shapes; exhaustive `switch` with a `never` check.

### 5.2 Errors and status mapping

- Business failures are typed `AppError` with a **stable code from `API.md` §5** (`ARCHITECTURE.md` §4.6). No ad-hoc string codes; no code that is not in the catalog.
- The wire envelope is exactly `API.md` §1.4:

```json
{ "error": { "code": "SHARE_TOTAL_INVALID", "message": "…", "requestId": "…", "fields": { "buyers": "SHARE_TOTAL_NOT_100" } } }
```

- `fields` appears only for `400`/`422` and only with short codes (`REQUIRED`, `FORMAT`, `STALE`, …), never sentences.
- `X-Request-Id` on every response; on an error, `error.requestId` carries the same value.
- **Status policy** (`API.md` §1.3): `400` = shape; `422` = well-formed but violates a domain rule; `409` = state, uniqueness or lock conflict; `403` before `404` when the capability is absent; `401` never reveals whether an account exists.
- `401`/`403`/`404`/`409`/`429`/`5xx` messages never contain SQL, stack traces, provider payloads or secrets.

### 5.3 RBAC — server-side only

- Every exported command and query calls `requireCapability(actor, '<capability>')` **inside the function**, before any row lookup (`ARCHITECTURE.md` §6.3; `API.md` §0.2). A route handler may not be the only check.
- Capabilities come from the single table in `ARCHITECTURE.md` §6.2 (24 at v1.0). Never invent one; never map a role in a route.
- The actor is resolved from the session cookie. A role, user id, project id, `createdBy`, `recordedBy` or price in the request is never trusted (`API.md` §0.2, V-27).
- Hiding UI is usability, never authorization.
- Every new command/query is added to the parameterized role × command test in the same PR (`ARCHITECTURE.md` §6.3, §17.2 S-7).

### 5.4 Serialization (`API.md` §1.8)

| Kind | Wire form |
|---|---|
| Money, area, percentage | **string**, exactly 2 decimals (`"1250000.00"`); never a JSON number |
| Business date | `YYYY-MM-DD`; no time, no zone |
| Event timestamp | ISO-8601 UTC with milliseconds (`"2026-10-19T09:15:00.000Z"`) |
| Enum | `UPPER_SNAKE`, exactly the `DATABASE.md` §4 values |
| Absent optional | `null`, never `""` |
| Counts, `version`, `byteSize`, `sequence` | JSON number |

- A DTO mapper is the only place that converts Prisma `Decimal`/`Date` to the wire. Never `JSON.stringify` a Prisma row directly.
- No localized strings cross the API. Error codes are translated by the client catalog only.

### 5.5 Optimistic locking (`API.md` §1.6)

```text
UPDATE <table> SET …, version = version + 1
 WHERE id = $1 AND version = $2
RETURNING version
```

- Zero rows → `409 CONFLICT_STALE_WRITE` with `fields: { "version": "STALE" }`.
- Applies to `plot`, `buyer`, `booking`, `project`. `version` travels in the body except INV-8, which uses `?version=`.
- The response returns the **new** version.
- State transitions (`cancel`, `void`, `reserve`, `release`, `mark-sold`) are guarded by their **status**, not by `version`; a second call is a `409` with the documented code, never a silent success.

### 5.6 Idempotency (`API.md` §1.7)

- Exactly two commands accept `clientRequestId`: `POST /api/bookings` (SAL-6) and `POST /api/bookings/{ref}/payments` (LED-3). Both are **required** UUIDs.
- **Look up the existing row first**, before any lock or status check; a replay returns `200` with the original resource and `Idempotent-Replay: true`, and writes nothing.
- Uniqueness is per actor: `(created_by, client_request_id)`, `(recorded_by, client_request_id)`.
- Every other mutation is guarded by state, not by a key. Do not add a key to anything else (that needs a schema change — §6).

### 5.7 Transactions, locking and side effects

- Transaction ownership follows `ARCHITECTURE.md` §4.4. **Lock order is fixed: `plot → booking → due items → cash entry`** (§12.3). Never acquire them in another order.
- Short transactions: validate first, then write. **No network calls, PDF rendering, image processing or provider calls inside a transaction.**
- The audit row is written **inside the same transaction** as the change (`ARCHITECTURE.md` §13.1). A rollback removes both.
- Collaborator writes accept the caller's `Tx`; they never open their own.
- Post-commit side effects (PDF render, provider send) run outside the transaction with their own error handling.
- A deadlock maps to retryable `409 CONFLICT_RETRY` (`API.md` §1.6) and is logged as an anomaly — not retried silently inside the request.

### 5.8 Money and dates

- `core/money` is the **only** place that adds, subtracts, divides, rounds or formats money. `decimal.js` underneath; half-up to 2 decimals at creation; higher precision intermediate.
- **No `Number` arithmetic on money.** No floats. No `parseFloat` on amounts.
- `core/datetime` is the only place that parses/formats dates and computes PKT boundaries. "Today" is `Asia/Karachi`, never the browser or the server's local zone.
- Calendar arithmetic for installments (end-of-month clamping), never "30 days"; overdue days are calendar-day differences (`ARCHITECTURE.md` §12.7).
- Tests run with `TZ=UTC` and assert PKT output.

### 5.9 Database access and migrations

- Prisma for ordinary CRUD; **parameterized** raw SQL (`$queryRaw`/`$executeRaw` with tagged templates) for locks, partial-index-sensitive writes and report queries. Never string-concatenate SQL.
- `prisma db push` and `prisma db pull` are **forbidden** in every environment (`DATABASE.md` §1.8, §10.3).
- Hand-written objects (partial indexes, CHECKs, triggers, functions, grants) live in Prisma migrations, and a Prisma-generated `DROP` of any `DATABASE.md` §6 object is **deleted from the migration before commit** (`DATABASE.md` §10.3).
- Applied migrations are never edited; a correction is a new migration.
- Any migration that creates a table requires re-running `prisma/sql/grants.sql` and `verify_grants.sql`; the verification must return **zero rows** (`DATABASE.md` §8.4, §10.4).
- Seeds are idempotent (`ON CONFLICT DO NOTHING`) and contain **no real PII** (`DATABASE.md` §9, §10.6).
- Only `core/db` and `modules/*/repository.ts` touch Prisma (§4.4 rule 4).

### 5.10 Files, secrets, logging

- Uploads: magic-byte allowlist per kind, size caps, `sharp` with a pixel cap, EXIF stripped, content-addressed storage key `(kind)/(xx)/(yy)/(sha256).(ext)` (`ARCHITECTURE.md` §7.3; `API.md` V-13).
- Files are private: serve through COR-2 with an `ETag`, never a public URL or storage path.
- Provider secrets: AES-256-GCM with `APP_SECRETS_KEY`, write-only, never returned, never logged (`ARCHITECTURE.md` §10.10).
- pino with redaction: no CNIC, phone, address, password, token, cookie, provider payload or `secret_ciphertext` in logs; `requestId` on every line (`ARCHITECTURE.md` §14.8, §15.2).
- Audit `summary` holds ids, numbers, status pairs and **field names** — never CNIC, phone, address or file paths (`ARCHITECTURE.md` §13.2).
- Cookie: `__Host-spm_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
- CSRF: `Origin`/`Host` check on every non-GET (`API.md` §1.10). Rate limits exactly as `API.md` §6.

### 5.11 i18n, UI and design

- **Every** user-visible string comes from `en.json` / `ur.json`; no literals in components. Keys are literal at call sites; dynamic key construction only through a typed exhaustive map (`ARCHITECTURE.md` §9.5).
- Translatable text renders in **client** components; server components pass data, not strings (`ARCHITECTURE.md` §9.4).
- `npm run i18n:check` must pass: no missing keys, no orphans, no empty values, identical shapes.
- PDFs, CSV headers and print views are **English only**, regardless of UI language.
- Use Radix primitives and the DESIGN tokens; do not introduce a component kit. Meet `DESIGN.md` §11 (focus, contrast, keyboard, labels) and §8 (loading/empty/error states for every screen).
- Numbers/dates are formatted by `core/money` / `core/datetime` and the i18n formatters — not by ad-hoc template strings.

### 5.12 Audit action codes

- Use exactly the `action_code` strings already named in `API.md` §3 (e.g. `booking.created`, `payment.voided`, `cash_entry.posted`).
- For an event that `ARCHITECTURE.md` §13.1 requires but `API.md` does not name, extend the frozen registry in `src/modules/audit/action-codes.ts` as `entity.past_tense_verb`, and record the addition in `docs/OPEN-QUESTIONS.md` (see AG-Q12). Never invent a new *event*, only a name for one the documents already require.
- `action_code` is never shown raw in the UI; the client maps it to a catalog sentence.

---

## 6. Never do

**Scope and contract**

- Never invent an endpoint, table, column, enum value, capability, status code, error code, report metric, reminder channel, audit event or validation rule. If it is not in the four documents, it does not exist.
- Never expose an endpoint that is not one of the 81 in `API.md` §2–§3; never implement fewer than the ones your feature needs.
- Never add scope the documents exclude:
  - No public API, buyer portal, webhooks, GraphQL, offline sync, bulk import — `PRD.md` §4.
  - No online payments — `PRD.md` §4, `ARCHITECTURE.md` §1.2 (C-12).
  - No stored PDFs (generated on demand only, never persisted) — `ARCHITECTURE.md` §8.1.
  - No manual reminder resend, no overdue-reminder follow-up beyond T-0 — `ARCHITECTURE.md` §10.13.
  - No applying advance credit automatically to future dues — `API.md` §7 (API-Q3).
  - No two-factor authentication, no SSO — `ARCHITECTURE.md` §6.5.
  - No multi-tenancy — `ARCHITECTURE.md` §1.2 (C-1) and §1.4.
  - No real-time collaboration (no WebSockets) — `ARCHITECTURE.md` §0 and §3.3.
- Never invent a UI screen that is not in `PRD.md` §11 / `DESIGN.md` §13.

**Rules and guards**

- Never skip a cross-row rule in `API.md` §4 (V-1…V-30). Every one that applies to your endpoint is implemented and tested.
- Never bypass, weaken or duplicate a capability check; never trust a role, id or price from the request; never rely on hidden UI.
- Never relax a `DATABASE.md` §6 constraint, trigger, partial index or grant to make code simpler.
- Never compute money outside `core/money`; never use a float; never format money ad hoc on the wire.
- Never use the browser clock or server local time for "today".
- Never hard-delete or in-place-edit a financial row, an audit row, a note, or a payment allocation. Void with a reason, or append.
- Never write to a table owned by another module (call its public `Tx` function).
- Never return a Prisma row, `Decimal` or `Date` directly.

**Operations and data**

- Never store a generated PDF; generate on demand.
- Never message a buyer without `consent_sms = true`, outside 09:00–20:00 PKT, after the due date, or without a committed claim row (`ARCHITECTURE.md` §10.5–§10.7).
- Never send from the web process; only the worker's scheduler sends.
- Never add a second live reminder channel.
- Never commit secrets, `.env`, real PII, dumps or generated artifacts.
- Never edit an applied migration; never run `prisma db push` / `db pull`.
- Never edit `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md` or `API.md` in a feature PR.

**Process**

- Never resolve a document conflict silently (§2.3).
- Never open a PR with a failing gate, a skipped test, a `.only`, or an unanswered blocking question.
- Never mix unrelated features, formatting churn or dependency upgrades into a feature PR.

---

## 7. Testing expectations

A feature is not complete because the happy path works. The following are **required before the PR is opened**.

### 7.1 Test layers

| Layer | Lives in | Runs against | Must cover |
|---|---|---|---|
| Unit | `tests/unit/` | No I/O | Money, plan math, date math, policies, Zod schemas, mappers |
| Integration | `tests/integration/` | A real PostgreSQL 17 (service container / Compose) | Commands, constraints, triggers, RBAC matrix, concurrency, report parity |
| E2E | `tests/e2e/` | Playwright against a running app | Booking, payment, language toggle, PDF download |
| Snapshot | alongside unit/integration | Fixtures | PDF layout with edge-case data |

Integration tests use the **real** database — never SQLite, never a mocked Prisma. They create their own data and roll back or truncate (`DATABASE.md` §10.6).

### 7.2 Mandatory coverage per feature

1. **Every `API.md` §4 rule that applies** — at least one passing case and one failing case per rule, asserting the documented code and HTTP status. Example: V-1 needs a 100.00 pass and a 90.00 `422 SHARE_TOTAL_INVALID` fail.
2. **Every `DATABASE.md` §6 CHECK constraint your tables use** — a test that attempts the violation and asserts the database rejects it (48 CHECKs exist at v1.0; cover the ones your feature touches, and keep the suite's constraint inventory complete over time).
3. **Indexes and triggers** — partial unique indexes (`one_active_booking_per_plot`, `one_primary_buyer_per_booking`), idempotency uniques, `uq_cash_entry_linked_payment`, and the append-only/immutability triggers (`trg_audit_log_append_only`, `trg_payment_immutable`, `trg_cash_entry_immutable`).
4. **Grants** — `spm_app` cannot `DELETE` a financial row and cannot `UPDATE` `audit_log` (`DATABASE.md` §8.3).
5. **Nightly integrity checks** — implement the eight checks in `ARCHITECTURE.md` §12.9 as SQL; test that a healthy fixture returns zero rows, and test detection on a fixture where the constraint system permits the anomaly (or by asserting the query's logic directly).
6. **RBAC** — every new command/query appears in the role × capability matrix test, allow and deny (`ARCHITECTURE.md` §6.3).
7. **Concurrency** — for booking: two simultaneous confirms → exactly one `201`, one `409 BOOKING_PLOT_UNAVAILABLE`; a retry with the same `clientRequestId` → `200` replay. For payments: two simultaneous payments on one booking respect the lock and never over-allocate.
8. **Parity** — Recovery totals equal the sum of open due items (S-4); report totals equal the underlying `cash_entry` rows (S-6).
9. **PDFs** — snapshot for a normal booking and for a 120-installment/long-name booking; assert English-only content; assert re-download identity for unchanged data.
10. **i18n** — `i18n:check` passes; every route renders in `ur` with the throwing `missingKeyHandler` armed; the language toggle test asserts changed text without navigation and without losing form state.
11. **Validation of the wire** — money is a string with 2 decimals, dates are `YYYY-MM-DD`, timestamps end with `Z`, enums are `UPPER_SNAKE`, absent optionals are `null`.
12. **Error envelope** — shape, `requestId`, `fields` only where allowed.

### 7.3 Gates (all must be green before a PR)

```text
npm run lint          # ESLint, including react/jsx-no-literals
npm run typecheck     # tsc --noEmit, strict
npm run test:unit
npm run test:integration   # Postgres service container
npm run build
npm run test:e2e        # when UI or a user journey changed
npm run i18n:check
npm run deps:check      # dependency-cruiser module boundaries
```

CI runs the same list (`ARCHITECTURE.md` §14.3). A red gate is a stop, not a note.

### 7.4 Test data

- Synthetic only. Never real buyer PII, never a real CNIC or phone.
- Seeded reference rows (categories, templates, provider config) come from the migration seed; tests may rely on them but must not mutate them permanently.
- Time-dependent tests inject a clock; never `new Date()` inside domain code under test.

---

## 8. Git and PR conventions

### 8.1 Branches and commits

- One branch per feature, cut from an up-to-date `main`. Never commit directly to `main`.
- Branch name: `feat/<module>-<slug>`, `fix/<module>-<slug>`, `test/<slug>`, `docs/<slug>`.
- Commit messages: imperative mood, module-scoped, ≤72-character subject, body explaining **why** and citing the document sections:

```text
feat(sales): confirm booking in one transaction

Implements API.md SAL-6, ARCHITECTURE.md §12.1/§12.3, DATABASE.md §6.1.
Plot lock → booking → buyers → plan → due items → status → audit.
```

- Small commits that each build and pass tests. No "wip", no fixup chains left un-squashed, no unrelated reformatting.
- Never force-push a shared branch; never rewrite merged history.

### 8.2 One feature per PR

A PR delivers one traceable capability: one endpoint group, one screen flow, or one infrastructure step. If the diff needs more than ~600 changed lines of non-generated code, split it.

Never include: unrelated refactors, dependency upgrades, formatting-only commits, or doc edits (except the running Open Questions log).

### 8.3 Required PR description

````markdown
## What and why
<one paragraph; the user-visible outcome>

## Trace
| PRD | ARCHITECTURE | DATABASE | API |
|---|---|---|---|
| US-3.1, FR-4.1 | §5.4, §12.1, §12.3 | §3.4, §6.1, §6.4 | SAL-6, V-1…V-5 |

## Scope checklist
- [ ] Endpoints added: <exact IDs, subset of API.md §2–§3>
- [ ] Tables/columns touched: <subset of DATABASE.md §3>
- [ ] Enums/capabilities added: **none** (or cite the document line that defines them)

## Database changes
<migration files; objects added; `verify_grants.sql` output = 0 rows; backward-compatibility/rollback note>

## Tests
<commands run, pass counts, new test files, which V-rules/CHECKs/integrity checks are covered>

## RBAC and audit
<capabilities checked and where; audit action codes emitted>

## UI
<screens and DESIGN.md refs; EN and UR screenshots; states covered>

## Judgment calls
<AG-Q ids added or closed, or "none">

## Dependencies
<none, or the ARCHITECTURE.md §3.6 note>

## Checklist
- [ ] AGENTS.md §9 complete
````

### 8.4 The running Open Questions log

- File: `docs/OPEN-QUESTIONS.md`. Created on first use; committed in the PR that introduces the first entry.
- Same four-column format as `ARCHITECTURE.md` §19, `DATABASE.md` §11 and `API.md` §7, with `AG-` ids:

```markdown
| # | Question | Proposed default | Impact if changed |
|---|---|---|---|
| AG-Q3 | … | … | … |

<!-- status: Open | Answered | Superseded · opened: <date> · seen in: <PR> -->
```

- Rules: ids are never reused; answered rows are never deleted; a reversal of an earlier default gets a **new** row referencing the old id; every PR that adds an entry links it in the description.
- This log records **implementation-level** gaps only. A product question belongs in `PRD.md` §18 or a document errata, not here.

### 8.5 ADRs

A structural decision that the documents do not already record (a new cross-module boundary, a deviation in a transaction shape) needs an ADR in `docs/adr/` in the same PR, numbered `ADR-<n>` after `ARCHITECTURE.md` §18's ADR-20. If it changes behavior or schema, it is not an ADR — it is a conflict (§2.3).

### 8.6 Forbidden git operations

- `git push --force` on a shared branch; `git rebase` of merged history; `git commit --amend` after review started.
- Committing `node_modules`, build output, `.env*`, dumps, generated PDFs or large binaries.
- Merging your own PR without the human's approval, unless explicitly instructed.

---

## 9. Definition-of-done checklist

Copy this into the PR and tick every line. A single unticked box means the feature is not done.

- [ ] **Trace complete** — every change maps to cited `PRD.md` / `ARCHITECTURE.md` / `DATABASE.md` / `API.md` sections; nothing in the diff lacks a citation.
- [ ] **No invented entities** — no endpoint, table, column, enum, capability, status code, error code, metric or rule beyond the four documents.
- [ ] **Capability check** in every new command/query, inside the function, before any row lookup; role × command test updated.
- [ ] **Validation rules** — every applicable `API.md` §4 rule implemented, with pass and fail tests.
- [ ] **Error contract** — only catalogued codes; envelope shape; `fields` only for 400/422; `X-Request-Id` set.
- [ ] **Wire format** — decimal strings, `YYYY-MM-DD`, ISO-8601 UTC, `UPPER_SNAKE` enums, `null` not `""`.
- [ ] **CAS** — `version` sent and checked on every `plot`/`buyer`/`booking`/`project` edit; new version returned.
- [ ] **Idempotency** — SAL-6 and LED-3 look up the key before locking; replay returns `200` + `Idempotent-Replay: true`.
- [ ] **Transaction** — correct owner, fixed lock order, audit row in the same transaction, no I/O inside.
- [ ] **Schema safety** — migration reviewed (no drop of a §6 object), `verify_grants.sql` returns zero rows, seed idempotent.
- [ ] **Money** — all arithmetic in `core/money`; no floats; plan math property-tested.
- [ ] **Dates** — all through `core/datetime`; PKT boundaries; `TZ=UTC` tests assert PKT.
- [ ] **Files/secrets** — magic bytes, size caps, private serving, encrypted secrets, nothing secret in logs or responses.
- [ ] **i18n** — no literals; keys in both catalogs; `i18n:check` green; UR render test green; PDFs English-only.
- [ ] **UI states** — loading, empty, error implemented per `DESIGN.md` §8; accessibility per §11.
- [ ] **Tests** — new/updated unit, integration, and (if UI) E2E; no skips, no `.only`; full gate suite green.
- [ ] **Concurrency** — the race that this feature can lose is tested, not reasoned about.
- [ ] **Open Questions** — every judgment call recorded as an `AG-Q` entry and linked; no silent defaults.
- [ ] **Logging** — structured, redacted, request-scoped; no PII, no secrets, no SQL.
- [ ] **Diff hygiene** — one feature, minimal diff, no unrelated files, no doc edits, no new dependency without a note.
- [ ] **PR description** — every section in §8.3 filled with evidence, not adjectives.

---

## 10. Open questions

These are gaps in the **implementation process**, not in the product. None changes behavior, and none blocks the architecture. Each has a proposed default that this file adopts until a human says otherwise. Most are expected to be closed (or promoted to an explicit decision) at the next planning step of the workflow; the operational ones (AG-Q6, AG-Q8…AG-Q11) close at the step that first needs them. They are recorded here rather than buried in configuration, exactly as `ARCHITECTURE.md` §19, `DATABASE.md` §11 and `API.md` §7 do it. For clarity: the **test framework** (Vitest, React Testing Library, Playwright) and the **CI provider** (GitHub Actions + GHCR) are already decided — `ARCHITECTURE.md` §3.1 and §14.3 — and are therefore not questions here.

| # | Gap | Why the four documents don't settle it | Proposed default |
|---|---|---|---|
| **AG-Q1** | Exact ESLint/Prettier configuration beyond `react/jsx-no-literals` and the `dependency-cruiser` boundaries | `ARCHITECTURE.md` §2.4 and §9.4 name the *rules*, not the config files or the full rule set | ESLint flat config: `next/core-web-vitals` + `typescript-eslint` recommended-type-checked + `react/jsx-no-literals` scoped to `src/app/**`, `src/components/**` and `modules/*/ui/**`; Prettier defaults; import order enforced by ESLint. Committed as config, changed only by PR |
| **AG-Q2** | Test coverage thresholds | No document states a number; `ARCHITECTURE.md` §15.5 lists enforcement *types*, not percentages | No global percentage gate in the first pass. Hard requirement: 100% branch coverage of `core/money`, plan generation, and `modules/*/policies.ts`; every `API.md` §4 rule has both a passing and failing test. Revisit after the first feature-complete build |
| **AG-Q3** | Which journeys count as Playwright "key journeys" (`ARCHITECTURE.md` §14.3) | The phrase is used, never enumerated | The five journeys in `PRD.md` §7 (J-1…J-5), plus the EN/UR toggle and both PDF downloads. Anything beyond that is integration-level, not E2E |
| **AG-Q4** | Complete `.env.example` key list | `ARCHITECTURE.md` §14.5 and §10.10 name the secret families; `API.md` §6 and COR-4 imply others; no exhaustive list exists | Derive from `ARCHITECTURE.md` §14.5 (DB roles, `APP_SECRETS_KEY`, backup), §10.10 (provider mode), §14.1 (`HEALTH_DETAILS_TOKEN`), plus `DATABASE_URL`, `SESSION_*`, `PKT_TZ=Asia/Karachi`, `PORT`. Every key documented with a safe default; any new key needs an `AG-Q` entry |
| **AG-Q5** | Contents of the local/dev seed dataset (`prisma/seed.ts`) | `ARCHITECTURE.md` §4.1 says "demo data (never real PII)" without specifying shape or volume | Reference data from the migration seed only (8 cash categories, 4 SMS templates, 1 SMS provider row in dry-run) plus: 1 company, 1 project, 2 blocks, 12 plots (mixed statuses), 2 buyers, 1 confirmed booking with a 6-installment plan. Deterministic ids, no real PII, `npm run db:reset` recreates it |
| **AG-Q6** | Who writes `RUNBOOK.md`, and whether staging exists in month 1 | `ARCHITECTURE.md` §14.10 says RUNBOOK is "the next doc after `DATABASE.md`", but it is not part of Steps 1–6; §14.4 makes staging optional | `RUNBOOK.md` is authored by the agent in the **Deployment** step of the 20-step workflow, from §14.3/§14.7/§14.9/§14.10. Staging is deferred; the deploy checklist carries a manual smoke test (booking, payment, PDF) until one exists |
| **AG-Q7** | Automated accessibility tooling | `DESIGN.md` §11 states requirements; no tool is named | `@axe-core/playwright` on every E2E page, plus keyboard-only manual checks for the wizard, map and dialogs. No new visual-regression service |
| **AG-Q8** | Which SMS/WhatsApp provider account to configure | `ARCHITECTURE.md` §10.3 defines an adapter interface; PRD §18 lists the provider account as a client deliverable | Build against the adapter with the three provider names already in `DATABASE.md` §3.7 (`dry-run`, `local-sms-gateway`, `meta-cloud`); never hardcode an HTTP contract outside the adapter. Dry-run stays the default until the client supplies credentials |
| **AG-Q9** | How the first Admin user is created at go-live | `ARCHITECTURE.md` §14.10 says "create the Admin user"; no mechanism is specified | A one-shot `npm run create-admin` script: reads `ADMIN_EMAIL` and a password from a prompt/env, validates with the `API.md` §7 API-Q5 policy, refuses if any active Admin exists, writes `audit_log` `user.created` with `actor_label = 'system'` |
| **AG-Q10** | Scope of the one-off plot/buyer import script (`ARCHITECTURE.md` §5.2, §16 R-17) | It is described as "one-off… not an MVP feature" but not scheduled in Steps 7–20 | Not built until the client supplies data (PRD §18). When it is, it lives in `scripts/import/`, dry-run first, all-or-nothing commit, per-row errors, CNIC/phone normalization — and it uses the same commands as the UI, never raw inserts |
| **AG-Q11** | Source of the allotment-letter wording and terms text | `ARCHITECTURE.md` §8.4 fixes the field set; PRD §18 lists the copy as a pending client deliverable | Build the template against the documented field set and `company.pdf_terms_text`; ship with the terms field empty and a visible "not configured" state. Do not invent legal copy |
| **AG-Q12** | Exhaustive `audit_log.action_code` vocabulary | `DATABASE.md` §4 makes it `text` by design; `ARCHITECTURE.md` §13.1 lists event *areas*; `API.md` §3 names many but not all codes | Freeze a registry in `src/modules/audit/action-codes.ts`, seeded from every code named in `API.md` §3. A required event with no name gets `entity.past_tense_verb`, added in the same PR that emits it, and logged here. Codes are never renamed after release |

**Nothing above changes what a user can do, what is stored, or who may do it.** If any of these turns out to require a product decision, it leaves this table and becomes a document errata plus a `PRD.md` §18 item.

---

*End of AGENTS.md.*
