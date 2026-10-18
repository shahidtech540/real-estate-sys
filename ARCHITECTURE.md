# ARCHITECTURE.md — Society Plot Manager (SPM)

**Technical architecture — single source of truth**

| | |
|---|---|
| **Document status** | v1.0 — implementation baseline. Everything is decided except the items in §19, which need product/client sign-off. |
| **Date** | 2026-10-18 |
| **Product** | Society Plot Manager (SPM) — a single-tenant, internal web application for one real estate company in Pakistan. |
| **Sources of truth** | `PRD.md` v1.0 (scope, behavior, data) and `DESIGN.md` v1.0 (presentation, interaction). If this document conflicts with either, the PRD/DESIGN win; fix this document. |
| **Audience** | Implementation team, product owner, future maintainers. |
| **Companion documents** | `DATABASE.md` (schema — next), `RUNBOOK.md` (operations), ADRs in `docs/adr/`. |
| **Scope** | MVP only. Post-MVP ideas appear only where they affect a current decision. |

**Reading guide:** §0 is the summary. §1–§3 explain *why* the architecture looks like this. §4–§5 define the module boundaries. §6–§13 define the mechanisms that carry risk (auth, files, PDFs, i18n, reminders, reports, concurrency, audit). §14–§15 cover deployment and non-functional requirements. §16–§19 contain the risk register, traceability matrix, ADR summary, and open questions.

**Conventions:** **MUST** = binding rule. **SHOULD** = default, deviate only with a recorded reason. Code-level column/table detail is deliberately left to `DATABASE.md`; this document names aggregates, module ownership, and the constraints that carry architectural weight.

---

## 0. Architecture at a glance

**Style:** a **modular monolith**. One TypeScript codebase, one PostgreSQL database, one Docker image, and two processes started from that image — `web` (Next.js HTTP) and `worker` (scheduled jobs). There are no microservices, no message broker, no Redis, no event bus, and no Kubernetes.

**Stack:** Next.js (App Router) + React + TypeScript · PostgreSQL + Prisma · react-konva for the plot map · `@react-pdf/renderer` for documents · i18next for EN/UR · sharp for image processing · Nginx + Docker Compose on one VPS.

**The ten decisions that matter most:**

| Concern | Mechanism | Section |
|---|---|---|
| A plot can never be booked twice | `SELECT … FOR UPDATE` on the plot inside one transaction **and** a partial unique index on active bookings | §12.1 |
| Role permissions are real | Capability checks in domain services, not just hidden UI; matrix-driven tests | §6 |
| Bilingual UI switches instantly | Both catalogs shipped to the browser; all translatable text rendered in Client Components | §9 |
| No duplicate reminders | A unique **claim row** per `(due item, milestone)` claimed before any provider call | §10.6 |
| Money is exact | PostgreSQL `numeric(12,2)` + decimal strings end-to-end + shared plan-math function + property tests | §12.6 |
| Reports match the Roznamcha | One source table, one posted/void filter, one SQL statement per report | §11 |
| Files are private and durable | Content-addressed private store, served only through an authenticated route; included in nightly backups | §7 |
| Sensitive actions are attributable | Append-only audit row written in the *same* transaction as the change | §13 |
| It can be operated by a small team | One VPS, Docker Compose, nightly `pg_dump` + restic, external uptime and cron heartbeats | §14 |
| It fits the actual scale | One database, no cache tier, no queue, no horizontal scaling; <5 concurrent users by assumption | §15 |

**Runtime topology**

```text
                        ┌──────────────────────────────────────────────┐
                        │ Browser (Chrome/Edge/Firefox; tablet-capable)│
                        │ one origin · session cookie · EN/UR toggle   │
                        └───────────────────────┬──────────────────────┘
                                                │ HTTPS
                        ┌───────────────────────▼──────────────────────┐
                        │ Nginx — TLS, security headers, rate limits,   │
                        │ 26 MB upload cap, static asset caching        │
                        └───────────────────────┬──────────────────────┘
                                                │
┌───────────────────────────────────────────────▼───────────────────────────────────────────────┐
│ Container "web": Next.js (Node runtime)                                                       │
│                                                                                               │
│  Route handlers / server components  ──►  Modular monolith (shared domain layer)              │
│                                            Identity · Setup · Inventory · Sales · Ledger      │
│                                            Cashbook · Recovery · Reminders · Documents         │
│                                            Reporting · Audit · Core                             │
└──────────────┬────────────────────────────────────────────────────────────┬───────────────────┘
               │                                                            │
      ┌────────▼─────────┐                                       ┌──────────▼──────────────┐
      │ PostgreSQL       │                                       │ Local volume             │
      │ one instance     │                                       │ /srv/spm/files       │
      │ one schema       │                                       │ originals + derivatives  │
      └────────▲─────────┘                                       └──────────┬──────────────┘
               │                                                            │
┌──────────────┴────────────────────────────┐                     ┌─────────▼──────────────┐
│ Container "worker": same image, no HTTP   │                     │ restic → off-site       │
│ cron ticks · reminder claims · sends      │                     │ S3-compatible, encrypted│
│ nightly integrity jobs · session cleanup  │                     └────────────────────────┘
└──────────────┬────────────────────────────┘
               │ HTTPS
      ┌────────▼─────────────────────────────┐
      │ SMS gateway / WhatsApp Cloud API     │
      │ (dry-run by default)                 │
      └──────────────────────────────────────┘
```

**What this architecture deliberately does not do:** microservices, Kubernetes, event-driven messaging, CQRS/event sourcing, multi-region, multi-tenancy, row-level security, Redis, WebSockets, GraphQL, offline/PWA, mobile apps, a public API, or a client portal. Each is either out of scope per PRD §4 or would add operational cost with no benefit at ≤5 concurrent users.

---

## 1. Context, constraints, and scope

### 1.1 The product in one paragraph

One company sells plots in a housing society. Staff digitize the master plan into clickable polygons, book plots to individual or joint buyers, generate an allotment letter and payment schedule, record payments against installment due items, keep a daily Roznamcha, chase overdue installments with automated reminders, and view cash-basis reports. There are three roles, no external users, no online payments, and one active project in the MVP.

### 1.2 Constraints that drive the design

These are the actual constraints. Every major recommendation in this document traces to one or more of them.

| ID | Constraint | Architectural consequence |
|---|---|---|
| **C-1** | Single tenant; one company; one active project; ≤3,000 plots (PRD A-2). | No tenant column, no tenant isolation layer, no sharding. A `project_id` is a business dimension, not a tenancy boundary. |
| **C-2** | ≤25 staff, ≤5 concurrent users; ~10k bookings and ~200k due items/payments over the system's lifetime (PRD A-1, §13). | A single PostgreSQL instance is over-provisioned. No cache tier, queue, read replica, or search engine is justified. |
| **C-3** | Small team building and maintaining it for years. | One language, one repository, one deploy pipeline, one database, one debugging story. Boring, well-documented libraries. |
| **C-4** | Internal, desktop-first operations tool for staff; large tablets can view and operate most screens, but polygon drawing is a desktop task; phones are out of scope (PRD A-10, A-5). | Server-side rendering is optional; interactivity and correctness matter more. A desktop-width layout, with the plot table as the fallback for any map interaction. |
| **C-5** | Pakistan hosting realities: VPS with PKR billing, local SMS gateways, PKT (UTC+5, no DST), possible friction paying international cloud bills. | Single VPS in Pakistan or a nearby region; no cloud-native dependencies; SMS provider behind an adapter; timezone handled explicitly. |
| **C-6** | Bilingual UI (EN/UR), instant toggle, **LTR layout only**, English-only PDFs (PRD A-3, FR-2.4, DESIGN §12). | Client-side catalogs so switching needs no server round-trip; Naskh font strategy; PDF pipeline kept separate from UI i18n. |
| **C-7** | Financial records: exact money, void-only, audit trail, cash-basis reports (PRD §13, §16, FR-9). | `numeric` + decimal strings, no hard deletes, audit in the same transaction, one source table for cash reporting. |
| **C-8** | A plot can never be double-booked; concurrent attempts must fail cleanly (PRD S-3, US-3.1, §12). | Database-enforced uniqueness plus pessimistic row locking, not just an application check. |
| **C-9** | Reminders at T-10/T-7/T-3/T-0 must be attempted automatically, logged, and never duplicated (PRD S-5, US-6.2). | A crash-safe scheduler with a unique claim row per milestone; dry-run by default. |
| **C-10** | Interactive master plan: one raster image up to 25 MB, up to 3,000 polygons, draw/edit tools (PRD US-2.1/2.2, A-4). | Canvas rendering (Konva), normalized coordinates, server-side image normalization and derivative sizes. |
| **C-11** | Single-server deployment with daily backups (PRD A-11, §15). | Docker Compose, host Nginx, local file volume, nightly database + file backups to off-site storage, documented restore. |
| **C-12** | No online payments, no client portal, no third-party accounting integration, no email integration (PRD §4, §14). | No payment gateway, no public auth surface, no email service; password reset is Admin-driven. |

### 1.3 Scale and shape of the data

| Dimension | MVP expectation | Consequence |
|---|---|---|
| Plots | ≤3,000 per project | All polygons can be sent to the browser once and cached; no vector tiles. |
| Bookings | ≤10,000 lifetime | Ordinary indexed tables; offset pagination is fine. |
| Due items + payments | ≤200,000 lifetime | Reports are plain SQL aggregates; no data warehouse, no materialized views at launch. |
| Files | ~3,000 buyer photos (≤5 MB) + a few master plans (≤25 MB) + derivatives | Tens of GB at most; local disk plus off-site backup is sufficient. |
| Concurrent users | ≤5 typical | One web process, a small connection pool, no load balancer. |
| Availability | Office hours, best effort, 99% target | Single server is acceptable; recovery from backup is the availability strategy (RTO ≈ 4h, §14.7). |

### 1.4 Explicit non-goals

The following are out of scope and **MUST NOT** creep into the implementation without a PRD revision: utility billing, land costing/COGS, transfers/NOC/resale, HR/payroll, client portal, online payments, payment receipts (D-11), late-payment markup (D-9), Urdu PDFs, RTL page mirroring, multi-currency, branded PDF designer, mobile apps, offline mode, email notifications, accrual accounting, refund accounting engine, and multi-tenancy.

---

## 2. Architecture style

### 2.1 Decision: modular monolith, two processes, one database

| Aspect | Decision |
|---|---|
| Deployable unit | One Docker image. Two processes from it: `web` and `worker`. |
| Domain organization | Eleven modules with explicit public interfaces (§4–§5). |
| Data store | One PostgreSQL database, one schema. Each table has exactly one owning module. |
| Communication between modules | In-process function calls through public module interfaces. No HTTP, no message bus, no events. |
| Transaction boundary | One ACID transaction per command, spanning the modules involved. |
| Frontend/backend split | One Next.js application: server components and route handlers share the domain layer. No separate API service. |
| Scaling | Vertical only, if ever needed. |
| Deployment | One VPS, Docker Compose, host Nginx (§14). |

### 2.2 Why this is right for *this* project

1. **A booking is a single transaction across several domains.** Confirming a booking touches the plot status (Inventory), the booking and buyers (Sales), the installment schedule (Sales), and the audit log (Audit). In a monolith this is one `BEGIN … COMMIT`; in a service-per-domain design it becomes a saga or an outbox with compensating actions. The PRD's central promise (S-3, no double booking) is a data-integrity problem. Distributed transactions would make the hardest requirement *harder*, not easier.
2. **Five concurrent users generate no scaling pressure.** Service boundaries pay for themselves when teams or load must scale independently. Here, one Postgres instance will sit below 1% utilization. Splitting it adds network calls, serialization, retries, and partial-failure modes with zero benefit.
3. **A small team cannot operate a distributed system.** Five deployables mean five pipelines, five sets of logs, versioned contracts between them, distributed tracing, and coordinated releases. The team's maintenance budget is better spent on the booking wizard, reporting correctness, and the Urdu UI.
4. **One language eliminates duplicated domain rules.** The most complex UI work — the polygon editor, the booking wizard, live payment-plan preview — is TypeScript regardless of backend choice. Keeping the server in TypeScript lets the *same* Zod schemas, CNIC/phone validators, and installment-calculation function run on both sides (§12.6). With a PHP or Python backend, those rules exist twice and drift.
5. **Single tenant means no isolation machinery.** No tenant column, no per-tenant migrations, no noisy-neighbor controls. Project is a business dimension handled with ordinary foreign keys.
6. **Failure modes stay legible.** One server, one process, one database. When something breaks, there is one place to look. For a system holding a company's cash records, operational simplicity is a reliability feature.

**When this choice would be wrong:** multiple companies sharing the system, separate teams owning separate release cadences, an independently scaled workload (e.g., mass document rendering), or a regulatory requirement to isolate data stores. None apply to the MVP.

### 2.3 Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| Microservices per domain (Inventory, Sales, Payments…) | Turns every cross-domain operation into a distributed transaction; multiplies operational surface; no scaling or team-autonomy benefit at this size. |
| Event-driven architecture / message broker | The only asynchronous work is scheduled reminders. A broker adds a stateful service, delivery semantics, and debugging complexity for one job. |
| Serverless functions + managed database | Cold starts, connection limits, a scheduler workaround, per-request cost opacity, and awkward long-running PDF/image work. Less predictable than a VPS in Pakistan. |
| Kubernetes | Solves orchestration at a scale this system will never reach; adds a control plane the team must operate. |
| CQRS / event sourcing | Financial correctness here comes from immutable posted records plus an audit log, not from replaying events. Massive complexity for no gain. |
| Separate SPA + API service | Two build artifacts, two deploy targets, duplicated auth and routing. Next.js already separates server and client code without that cost. |

### 2.4 Module boundary rules (enforced, not aspirational)

These rules keep the monolith modular as it grows. They are enforced in CI with `dependency-cruiser` and ESLint, not by convention alone.

1. Each module has one public entry point: `src/modules/<module>/index.ts`. Nothing outside the module imports its internal files.
2. A module **MUST NOT** import another module's repository, Prisma model access, or UI components. Cross-module work goes through the other module's public functions.
3. Cross-module **writes** happen through public functions that accept a transaction client (`Tx`). The initiating module owns the transaction; collaborators never open their own.
4. Only `src/core/db` and `src/modules/*/repository.ts` may import `@prisma/client`. Pages, route handlers, and components never query the database directly.
5. The **domain layer** of a module (`index.ts`, `commands.ts`, `queries.ts`, `repository.ts`, `policies.ts`) **MUST NOT** import `next/*`, `react`, or `react-dom`. Module UI lives under `modules/<module>/ui/` and may import React, but the domain layer never imports `ui/`. This keeps commands callable from the `worker` and from tests without an HTTP request.
6. Only the read-model modules (`reporting`, `recovery`) may write cross-domain SQL joins (a documented read-only exception, §4.5). Every other module reads other domains through their public query functions.
7. UI components live with their module (`modules/<module>/ui`) or in the shared design system (`src/components`); a module's UI may call its own endpoints, never another module's internals.
8. A table has exactly one owning module. If two modules need to write the same table, the boundary is wrong.

### 2.5 Why a separate `worker` process is still a monolith

The reminder scheduler and nightly jobs run in a second process built from the **same image and codebase**, connected to the **same database**, calling the **same domain services**. There is no API between `web` and `worker`; they are two entry points into one application. This is not a service boundary.

The worker exists because:
- Request-scoped web processes are restarted on every deploy; a scheduled job must survive that.
- Running cron inside the web process leads to duplicate executions if a second web instance is ever added.
- A crash in reminder sending should not affect the web UI, and vice versa.

The worker runs exactly **one** instance in the MVP and uses PostgreSQL advisory locks to make that assumption safe (§10.4).

### 2.6 Request and job lifecycle

**Read path (page):**

```text
Browser → Nginx → Next server component
  → requireSession()                         (auth)
  → module query function                    (authorization + data)
  → serialized data props
  → Client Component renders text from the EN/UR catalog
```

**Write path (command):**

```text
Browser → Nginx → route handler (/api/…)
  → Zod parse (shared schema)                → 422 with field codes
  → requireSession()                         → 401
  → requireCapability(actor, capability)     → 403
  → module command (owns the transaction)
      → business validation / invariants     → 409/422 with stable codes
      → writes via repositories (Prisma or parameterized SQL)
      → audit.record(tx, …)                  (same transaction)
  → COMMIT
  → localized client toast/banner via error code
```

**Job path:**

```text
worker cron tick → pg_try_advisory_lock → module job function
  → claim rows in Postgres → provider adapter → log rows → release lock
```

---

## 3. Technology stack

### 3.1 Baseline

Versions are the baseline at the time of writing. Pin exact versions in `package.json`/lockfile and in the Docker base image; do not float majors.

| Layer | Choice | Baseline | Why this project |
|---|---|---|---|
| Runtime | Node.js LTS | 24 LTS | One runtime for web, worker, PDF and image processing; long support window. |
| Language | TypeScript, `strict` | 5.x | Shared domain rules between client and server; catches the class of bugs that hurt financial software. |
| Web framework | Next.js, App Router | 16.x | One deployable for UI + HTTP API; server components for data loading; route handlers for explicit commands; huge documentation base. |
| UI | React | 19.x | Required by Next; mature ecosystem for the map, tables, and forms. |
| Styling | Tailwind CSS + CSS variables | 4.x | DESIGN tokens map directly to CSS variables/utilities; no component kit fighting the design. |
| UI primitives | Radix UI | current | Accessible dialogs, drawers, popovers, tabs, toggles — matches DESIGN §11 accessibility requirements. |
| Icons | Lucide | current | Mandated icon family in DESIGN §4.3. |
| Tables | TanStack Table | 8.x | Headless, sortable/filterable tables with sticky columns per DESIGN §5.4. |
| Data fetching | TanStack Query | 5.x | Client cache, background refetch, invalidation after mutations; no WebSockets needed. |
| Forms | React Hook Form + Zod | current / 3.x | Fast forms with the *same* Zod schema used on the server. |
| Database | PostgreSQL | 17.x (18 acceptable on the host image) | Exact decimals, partial unique indexes, row locks, advisory locks, strong CTE/report SQL. |
| ORM / migrations | Prisma | 6.x | Type-safe schema and migrations for CRUD; raw parameterized SQL for the few paths that need locks or report queries. |
| Map canvas | Konva via react-konva | current | Canvas-rendered polygons; 3,000 shapes with hit detection and draggable vertex handles. |
| PDF | `@react-pdf/renderer` | 4.x | In-process PDF generation without a browser; deterministic English-only documents. |
| Images | sharp | current | EXIF stripping, resizing, format validation, decompression-bomb limits. |
| i18n | i18next + react-i18next | current | JSON catalogs, instant runtime language switch, typed keys, plural support. |
| Auth | Custom session module + `@node-rs/argon2` | — | Credentials-only, database sessions, revocable, ~200 lines to audit; no OAuth requirement. |
| Validation | Zod | 3.x | Shared client/server schemas; errors mapped to stable codes. |
| Scheduling | node-cron + PostgreSQL advisory locks + claim tables | current | No Redis, no broker; the scheduler's state is in Postgres. |
| Logging | pino | current | Structured JSON logs with redaction; works in Docker. |
| Tests | Vitest, React Testing Library, Playwright | current | Unit, component, and end-to-end coverage, including the concurrency and RBAC matrices. |
| Container | Docker + Docker Compose | current | Reproducible Node/Postgres versions; one-command local setup. |
| Reverse proxy | Nginx + Certbot | current | TLS, headers, body limits, rate limits; familiar to local ops. |
| CI/CD | GitHub Actions + GHCR | — | Lint, typecheck, tests, build, image publish, SSH deploy. |
| Backups | `pg_dump` + restic → S3-compatible object storage | current | Encrypted, deduplicated, off-site; simple restore. |

### 3.2 Backend: Next.js route handlers + a domain layer (not a separate API framework)

- **Route handlers under `/api/*` are the only mutation surface.** Server Actions are deliberately not used. An explicit HTTP surface is easier to test, rate-limit, version, and protect uniformly, and it avoids Server Action serialization subtleties.
- **Server components** load data for initial page renders by calling module query functions directly. They never query Prisma and never render translatable literals (§9.4).
- **A NestJS/Express API was rejected** because it adds a second build/deploy and DI ceremony without a second consumer. The module structure supplies the separation that matters.
- **All route handlers that touch the database, files, or PDFs run on the Node runtime.** Edge runtime is not used.
- **Every `route.ts` handler is a thin adapter**: parse → authorize → call module → map result/errors. Business logic lives in `modules/*`.

### 3.3 Frontend: React + a design system built to DESIGN.md

- Tailwind + CSS variables implement the DESIGN tokens. Radix primitives supply accessible behavior; the visual layer is ours. A component kit (MUI, Ant, Chakra) was rejected because DESIGN §4–§5 is specific and a kit would be fought at every screen.
- **TanStack Query** owns client-side server state. After a mutation, affected queries are invalidated; lists and the map poll every 60 seconds while visible, and refetch on window focus. No WebSockets: with ≤5 users, polling plus a server-side conflict guard is sufficient and far simpler.
- **The map is client-only** and code-split. It loads the project geometry once, keeps status filters in memory, and updates a polygon locally after a booking or status change.
- **No global state library.** Language and session are React contexts; everything else is server state or local form state.
- **No charts library.** Reports are tables per DESIGN §13.13.

### 3.4 Database: PostgreSQL, with Prisma for the ordinary 95%

**Why PostgreSQL** (specifically for this project):

1. **Exact money.** `numeric(12,2)` with Prisma `Decimal`; no floating-point cash. SQLite's type affinity and Prisma's mapping make exact decimals fragile, which is disqualifying for a ledger.
2. **Partial unique indexes.** `CREATE UNIQUE INDEX … WHERE status = 'CONFIRMED'` enforces "one active booking per plot" in the database itself. MySQL has no partial indexes; the workaround is a generated-column hack.
3. **Row locks and advisory locks.** `SELECT … FOR UPDATE` for the booking race; `pg_try_advisory_lock` for a single scheduler. Both are built in.
4. **Report SQL without a warehouse.** CTEs and conditional aggregates produce cash flow and income statements from one table in one statement at this volume.
5. **JSONB where it fits.** Polygon vertices `[[x,y],…]`, plan snapshots, and audit metadata are naturally documents; they are validated in TypeScript and never used as a substitute for relational structure.
6. **Operational simplicity.** One container, `pg_dump`/`pg_restore`, a mature ecosystem, and a straightforward move to a managed instance later if the client prefers.

**Why Prisma:** a declarative schema, reviewable SQL migrations, and type-safe CRUD for a small team. The 5% that needs control — booking locks, the one-active-booking index, report queries — uses hand-written parameterized SQL inside `$transaction`. One ORM, two documented escape hatches, no query-builder polyglot.

**Rejected:** SQLite (single-writer bottlenecks, weak decimal handling, no advisory locks, awkward live backups), MySQL (no partial unique indexes; less comfortable report SQL), MongoDB (financial relations and reporting need joins and multi-document transactions), and an ORM-free query builder (more code for ordinary CRUD with no benefit here).

### 3.5 Alternatives considered at the stack level

| Option | Verdict |
|---|---|
| **Laravel + Inertia + React/Vue** | A genuinely good fit for CRUD and cheap to staff in Pakistan. Rejected because the map, wizard, and instant i18n need deep TypeScript anyway, and a PHP backend splits validation/domain rules across two languages. If the client's team is PHP-only, this is the fallback stack; the module boundaries, database, deployment, and operational model in this document apply unchanged. |
| **Django + HTMX or React** | Strong auth/admin/i18n story. Rejected for the same two-language issue; Celery/Redis for reminders adds a service; HTMX makes the instant language swap and the canvas editor harder. Viable fallback. |
| **Vite SPA + Fastify/Hono API** | The simplest mental model and a very boring runtime. Rejected because it is two build/deploy artifacts and adds a client-side routing/auth layer that Next already provides. |
| **Auth.js / NextAuth** | Fast start, but credentials-only with database sessions is a small, fully auditable module. Avoids a fast-moving dependency in the security boundary. |
| **JWT sessions** | No server-side revocation; deactivating a user or resetting a password must take effect immediately (PRD US-1.3). Rejected. |
| **BullMQ + Redis** | A second stateful service for one scheduled job. Rejected. |
| **Playwright HTML→PDF** | Superior typography and the right answer if Urdu PDFs arrive. Rejected for MVP because it adds a ~300 MB browser, memory pressure, and slower generation for two English-only documents. The template boundary isolates a future switch (§8.7). |
| **Leaflet `CRS.Simple`** | Workable, but a geographic map model, plugin-driven editing, and an extra abstraction for what is really "polygons on an image." Konva is more direct and faster for 3,000 shapes. |

### 3.6 Version and upgrade policy

- Pin exact versions; commit the lockfile; use `npm ci` in CI and Docker.
- Node.js LTS and PostgreSQL major are pinned; no automatic major upgrades.
- Security patches: within 7 days. Minor updates: monthly. Framework majors: annually, on a branch, with a full regression run and a staging deploy.
- **No experimental framework features** (PPR, dynamic IO, unstable caching APIs). The App Router's stable surface is sufficient.
- New runtime dependencies require a short note in the PR: what it replaces, maintenance status, license, bundle/runtime cost. Prefer a small amount of code over a dependency for one-off needs.

### 3.7 Stack assumption (state it, don't hide it)

This stack assumes the implementation team is comfortable with TypeScript and React. If that is false, the fallback is Laravel + Inertia (PHP) or Django + React. The architecture — modular monolith, single Postgres, server-enforced RBAC, claim-based reminders, one VPS — is independent of that choice and should be preserved.

---

## 4. Codebase structure and module catalog

### 4.1 Repository layout

```text
real-estate-sys/
├─ prisma/
│  ├─ schema.prisma              # one schema, organized by owning module
│  ├─ migrations/                # reviewable SQL; partial indexes live here
│  └─ seed.ts                    # roles, categories, demo data (never real PII)
├─ src/
│  ├─ app/                       # Next.js App Router — thin adapters only
│  │  ├─ (auth)/login/
│  │  ├─ (app)/dashboard/
│  │  ├─ (app)/map/
│  │  ├─ (app)/plots/
│  │  ├─ (app)/bookings/
│  │  ├─ (app)/buyers/
│  │  ├─ (app)/payments/
│  │  ├─ (app)/roznamcha/
│  │  ├─ (app)/recovery/
│  │  ├─ (app)/reports/
│  │  ├─ (app)/reminders/
│  │  ├─ (app)/settings/
│  │  ├─ (app)/users/
│  │  ├─ (app)/audit/
│  │  └─ api/                    # route handlers: auth, plots, bookings, …
│  ├─ modules/
│  │  ├─ identity/               # users, sessions, password handling
│  │  ├─ setup/                  # company, projects, blocks, settings
│  │  ├─ inventory/              # master plan, plots, polygons, status
│  │  ├─ sales/                  # buyers, bookings, payment plans, due items
│  │  ├─ ledger/                 # payments, allocations, balances
│  │  ├─ cashbook/               # Roznamcha entries and categories
│  │  ├─ recovery/               # outstanding/overdue read model, CSV
│  │  ├─ reminders/              # templates, providers, scheduler, log
│  │  ├─ documents/              # PDF templates and generation
│  │  ├─ reporting/              # cash flow, income statement
│  │  └─ audit/                  # append-only audit trail
│  ├─ core/                      # db, authz, errors, money, datetime, files,
│  │                             # ids, logging, jobs, config
│  ├─ i18n/                      # catalogs, provider, key checks
│  ├─ components/                # design-system components (DESIGN §5)
│  ├─ styles/                    # tokens, fonts, print CSS
│  └─ worker/                    # scheduler entrypoint; bundled to dist/worker/main.js
├─ tests/
│  ├─ unit/                      # money, plan math, dates, policies
│  ├─ integration/               # Postgres: commands, RBAC, concurrency
│  └─ e2e/                       # Playwright: booking, payment, language
├─ infra/
│  ├─ docker-compose.yml
│  ├─ db/init/                    # roles, extensions (first boot only)
│  ├─ nginx/
│  ├─ backup/
│  └─ deploy/
├─ docs/adr/                     # architecture decision records
└─ ARCHITECTURE.md · DATABASE.md · RUNBOOK.md
```

**Module anatomy** (consistent across modules):

```text
modules/sales/
├─ index.ts              # the only public surface
├─ schemas.ts            # Zod input/output, shared with the client
├─ commands.ts          # writes; own the transaction; check capabilities
├─ queries.ts           # reads; check read capabilities
├─ repository.ts        # Prisma access for this module only
├─ policies.ts          # business invariants that are not just permissions
├─ errors.ts            # module error codes
└─ ui/                  # module-specific components (wizard steps, etc.)
```

### 4.2 Module catalog

| Module | Responsibility | Owns (aggregates/tables) | Exposes to others | Depends on |
|---|---|---|---|---|
| **Identity** | Staff accounts, roles, sessions, password resets, login/logout | `user`, `session`, `login_throttle` | `getActor`, `authenticate`, `createUser`, `resetPassword`, `requireSession` | Core, Audit |
| **Setup** | Company profile, logo, PDF terms text, projects, blocks, marla conversion | `company`, `project`, `block`, `app_setting` | Project/block/company queries and commands | Core, Audit |
| **Inventory** | Master plan, plot records, polygons, status transitions, reservation | `plot`, `plot_status_history`, master-plan file refs | Plot queries, `changePlotStatus(tx)`, map geometry query | Core, Setup, Audit |
| **Sales** | Buyers, bookings, joint ownership, payment-plan generation, due items, booking cancellation, notes | `buyer`, `booking`, `booking_buyer`, `booking_note`, `due_item`, `payment_plan` | Booking/buyer queries, `createBooking`, `cancelBooking`, `openBalances`, `applyDueItemPayment(tx)` | Core, Inventory, Audit |
| **Ledger** | Payments, allocations, advance credit, voiding, buyer/booking ledger | `payment`, `payment_allocation` | `recordPayment`, `voidPayment`, ledger queries, `collectedBetween` | Core, Sales, Cashbook, Audit |
| **Cashbook** | Roznamcha entries, categories, auto-posting from payments, daily/period totals | `cash_entry`, `cash_category` | `postLinkedIn(tx)`, `voidLinked(tx)`, entry queries and totals | Core, Audit |
| **Recovery** | Read-only outstanding/overdue/upcoming dashboard, CSV export | — (read model) | Recovery queries, CSV stream | Sales, Ledger, Setup |
| **Reminders** | Templates, provider configuration, scheduler ticks, claims, reminder log | `reminder_template`, `provider_config`, `reminder_claim`, `reminder_log` | `tick`, `sendTest`, log queries, settings commands | Core, Sales, Inventory, Setup, Audit |
| **Documents** | Allotment letter and payment schedule PDFs | — (stateless) | `renderAllotmentLetter`, `renderPaymentSchedule` | Core, Setup, Sales |
| **Reporting** | Cash flow and income statement (read-only) | — (read model) | Report queries | Cashbook, Setup |
| **Audit** | Append-only audit trail and its queries | `audit_log` | `record(tx, …)`, `search` | Core |
| **Core** | Cross-cutting primitives: DB, config, authz policy, errors, money, dates, ids, file store, logging, job runner | `file_object`, `job_run` | Everything | — |

**Table ownership is exclusive.** For example, only Sales writes `due_item`; Ledger calls `sales.applyDueItemPayment(tx, …)` inside its own payment transaction. Only Cashbook writes `cash_entry`; Ledger calls `cashbook.postLinkedIn(tx, …)`. This keeps each invariant in one place and makes the transaction boundary explicit.

### 4.3 Dependency graph

**Legend:** `A ──► B` means *A depends on B* (A calls B's public functions or reads B's data).

```text
Inventory ──► Setup
Sales     ──► Inventory, Audit
Ledger    ──► Sales, Cashbook, Audit
Cashbook  ──► Audit
Reminders ──► Sales, Inventory, Setup, Audit
Documents ──► Setup, Sales
Recovery  ──► Sales, Ledger, Setup            (read-only)
Reporting ──► Cashbook, Setup                 (read-only)
Identity  ──► Audit
Audit     ──► Core only
```

**No cycles.** Notably:

- Ledger depends on Sales for booking and due-item data; **Sales never depends on Ledger**. A payment updates due items through `sales.applyDueItemPayment(tx, …)`, called by Ledger inside Ledger's transaction.
- Ledger depends on Cashbook to post and void the linked entry; **Cashbook never reads payments** for its own logic. Reporting may join `payment` for the "sale collections" grouping, which is a documented read-model exception (§4.5).
- Reminders depends on Sales and Inventory for recipient, plot, and due-item data; it never writes financial tables.
- Documents depends on Setup and Sales; it is stateless and is not depended on by anyone.
- Recovery and Reporting are read-only leaves. Reporting does not depend on Recovery or vice versa.
- Audit is a leaf that every module calls; it depends only on Core.

Where a write must cross a boundary, it goes through a public function that accepts the caller's transaction (§4.4), never through a reverse dependency.

### 4.4 Transaction boundaries

| Command | Transaction owner | Participants (same transaction) |
|---|---|---|
| Confirm booking | Sales | Inventory (lock + status), Sales (booking, buyers, due items), Audit |
| Cancel booking | Sales | Sales (booking), Inventory (lock + status), Audit |
| Mark Allotted/Sold | Inventory | Inventory (status, history), Audit |
| Record payment | Ledger | Ledger (payment, allocations), Sales (lock + due-item paid amounts), Cashbook (linked In entry), Audit |
| Void payment | Ledger | Ledger (status, reverse allocations), Sales (recompute due items), Cashbook (void linked entry), Audit |
| Manual cash entry | Cashbook | Cashbook, Audit |
| Reserve/release plot | Inventory | Inventory, Audit |
| Change settings / templates / channels | Setup / Reminders | Owning module, Audit |
| Create/deactivate user | Identity | Identity, Audit |
| Reminder send | Reminders | Claims and log only; **no** financial writes |
| Report query | — | One SQL statement (implicit snapshot); no transaction needed |

Rules:
- Transactions are **short**: validate first, then write. No network calls, PDF rendering, image processing, or provider calls inside a transaction.
- Lock order is fixed: **plot → booking → due items → cash entry**. This prevents deadlocks (§12).
- The audit row is written inside the same transaction; a rollback removes both the change and its audit row, which is correct (no phantom audits).
- After `COMMIT`, side effects that can fail independently (PDF generation, provider sends) run outside the transaction and have their own error handling.

### 4.5 Read models and the reporting exception

Two screens need data from more than one domain:

- **Recovery** (open due items + buyer + plot + booking status).
- **Reporting** (cash entries + categories + payment links).

These are implemented as **read-only query modules** with hand-written SQL. This is the single documented exception to "no cross-module SQL". It is justified because:
- The queries are pure reads; there is no invariant to protect.
- At ≤200k rows, a single SQL statement is faster and simpler than composing three module calls in application code.
- S-4 and S-6 are consistency requirements; one query against one set of tables makes them structurally true rather than coincidentally true.

Reporting **MUST NOT** write. Its SQL is reviewed like any other, parameterized, and covered by parity tests against the source tables.

### 4.6 Cross-cutting concerns

| Concern | Where it lives | Rule |
|---|---|---|
| Authentication | `core/auth` + Identity | Every page and route resolves the session server-side. |
| Authorization | `core/authz` policy + each module's `commands.ts`/`queries.ts` | Every public command/query declares and checks a capability. |
| Audit | `modules/audit` | Called inside the business transaction for sensitive actions. |
| Money | `core/money` | The only place that rounds, formats, or does arithmetic on money. |
| Dates | `core/datetime` | The only place that parses/formats dates and computes PKT boundaries. |
| Errors | `core/errors` | Typed `AppError` with a stable code; adapters map to HTTP. |
| Files | `core/files` + Inventory/Sales | Storage is content-addressed and private; modules own only the reference. |
| i18n | `src/i18n` | UI text only; PDFs and print output are English by design. |
| Logging | `core/logging` | Structured, redacted, request-scoped. |
| Jobs | `core/jobs` + `src/worker` | Cron, advisory lock, run record; module job functions. |
| Config | `core/config` | Zod-validated environment, fail-fast at boot. |

---

## 5. Domain modules

Each subsection states the module's job, its key operations, the invariants it protects, and how it interacts with other modules. **Table and column detail belongs to `DATABASE.md`.**

### 5.1 Identity

**Job:** authenticate staff, manage accounts and roles, hold sessions.

**Key operations:** login, logout, session resolution and revocation, user CRUD, role assignment, password reset (Admin-generated temporary password with a forced change), deactivate/reactivate, unlock after throttling.

**Invariants:**
- Exactly one role per user (PRD US-1.3); role is an enum, not a free-text field.
- Email is unique and stored lowercase; it is the login identifier.
- A user is never deleted; `is_active = false` preserves attribution on past transactions.
- At least one active Admin must always remain; an Admin cannot deactivate themselves.
- Deactivating a user or resetting a password revokes all their sessions immediately.
- Passwords are never logged, returned, or stored recoverably.

**Interactions:** every module receives an `Actor` (user id, role, display name) from the route/page adapter. The domain layer never reads cookies.

**Screens:** Login (PRD #1), Users (#15).

### 5.2 Setup & Configuration

**Job:** the company and project skeleton, plus settings that change behavior without code.

**Key operations:** company profile and logo, PDF terms text, project CRUD, block CRUD, marla conversion, expense categories (delegated to Cashbook), reminder templates and channels (delegated to Reminders).

**Invariants:**
- A block cannot be deleted while it contains plots (PRD US-1.2) — enforced by a service check and a restricting foreign key.
- Plot numbers are unique within a project (PRD US-2.3), independent of block.
- Changing the marla conversion affects display only; stored sizes are in Marla and never rewritten.
- Projects are never hard-deleted; deactivation preserves history.

**Interactions:** Inventory reads project/block data; Documents reads the company profile and terms; Reminders reads the company name for message rendering.

**Screens:** Settings (#14), plus project/block management within it.

### 5.3 Inventory

**Job:** turn the master plan into live, status-aware inventory.

**Key operations:**
- Upload/replace the master plan; store the original and generate a display derivative and thumbnail (§7).
- Create/edit plot records: block, plot number, type, size (Marla), width/depth, price, status, notes.
- Draw/edit/delete polygons with normalized vertices.
- Status transitions: reserve, release, book (called by Sales), cancel (called by Sales), mark Allotted/Sold.
- Map geometry query and table/list queries with filters.

**Invariants:**
- A polygon has ≥3 vertices, all coordinates in `[0,1]`, and a non-zero area.
- Every polygon belongs to exactly one plot in the same project.
- Status is a stored field with a guarded transition table, kept in lockstep with booking state (PRD §13, §16). It is not computed at read time, because Admin actions such as Reserve and Sold are independent of booking state. Booking and cancellation update it inside the Sales transaction; a nightly check verifies it still agrees with the active booking.
- `Sold/Constructed` is terminal in the MVP.
- Every status transition writes `plot_status_history` (visible to all roles) **and** an audit row (Admin-only log).
- Plot metadata edits use optimistic concurrency (`version`) and audit price changes with old/new values.

**Status machine** (labels are catalog strings; codes are stable):

```text
Available ──book──► Booked/Token ──admin mark──► Sold/Constructed (terminal)
    ▲                    │
    └──cancel booking────┘
Available ◄──release── Reserved
Available ──reserve──► Reserved
```

Booking from `Reserved` is allowed only for an Admin with explicit confirmation (PRD BR-1). Cancel from `Sold/Constructed` is not allowed; cancel-and-rebook is required.

**Interactions:** Sales locks the plot row and changes status on booking/cancel; Reminders reads plot identity; Recovery reads plot identity; Documents reads plot details.

**Screens:** Plot Map (#3), Plot List (#4), Plot Details (#5).

### 5.4 Sales

**Job:** own the commercial heart — buyers, bookings, joint ownership, and the payment plan.

**Key operations:**
- Upsert a buyer by normalized CNIC (one record per person, reused across bookings — PRD A-12).
- Create a booking in one transaction: lock plot → validate → upsert buyers → insert booking and ownership shares → generate and persist due items → update plot status → status history → audit.
- Generate the payment plan from sale price, token, down payment, installment count, frequency, and first due date. The **same pure function** runs client-side for preview and server-side for persistence (§12.6).
- Cancel a booking (Admin only, reason required): booking → Cancelled, plot → Available, payments untouched. Due items are left as historical records and excluded from recovery and reminders because the booking is no longer `CONFIRMED`; they are never deleted or rewritten. "Refundable" is derived (`booking = CANCELLED` + `payment = POSTED`), not a new accounting state.
- Add booking notes (Sales/Admin).
- Post-confirm booking management (Admin) — see Q-1 in §19 for the financial-edit rule.
- Provide open-balance queries used by Ledger, Recovery, and the dashboard.

**Due items:** token, down payment, and installments. They are created at booking confirmation and drive the ledger and reminders. Due dates are calendar dates in PKT. The plan is a snapshot; later changes to company settings do not mutate it.

**Invariants:**
- A booking has ≥1 buyer, exactly one primary buyer, and shares that total exactly 100% (PRD BR-5).
- Token and down payment are non-negative; token + down payment is strictly less than the sale price when installments exist; every installment is positive.
- `sum(due items) == sale price` exactly, with the final installment absorbing rounding (PRD A-8).
- At most one `CONFIRMED` booking per plot, enforced by the database (§12.1).
- A cancelled booking is never deleted and never re-activated; the buyer must rebook.
- Buyer CNIC is unique and normalized; phone is stored in E.164 but displayed in local format.
- Editing a buyer's details updates the canonical record (and therefore future PDFs) across all their bookings; this is inherent in A-12 and is audit-logged.

**Interactions:** calls Inventory to transition the plot (same transaction); exposes booking and open-balance queries to Ledger, Recovery, Reminders, and Documents. Calls Audit.

**Screens:** Booking Wizard (#6), Bookings List (#7), Booking Detail (#8), Buyers (#9), and the Book action on Plot Details.

### 5.5 Ledger

**Job:** record money received, allocate it to due items, and tell the truth about balances.

**Key operations:**
- Record a payment against a booking: lock the booking, validate, insert the payment, allocate to due items (oldest-unpaid-first by default or explicit allocations), leave any excess as advance credit, update due-item paid amounts and statuses, and auto-post the linked Roznamcha In entry.
- Void a payment with a reason: mark it `VOIDED`, reverse allocations, recompute due-item statuses, void the linked cash entry, audit. Never delete.
- Ledger queries per booking and per buyer: due items, payments, allocations, running balance, advance credit.
- Collection totals for dashboards and reports (by business date).

**Invariants:**
- `sum(allocations) + advance == payment amount`; no allocation exceeds a due item's remaining amount.
- A payment is never deleted and never edited after posting; void-with-reason is the only mutation.
- Due-item status is derived from its paid amount: `PAID` when paid == amount, `PARTIALLY_PAID` when 0 < paid < amount, otherwise `PENDING`.
- A voided payment contributes nothing to balances, reports, or recovery.
- Advance credit is the unallocated remainder of a payment (PRD §13). It may coexist with open due items when the user allocates explicitly; it is shown on the ledger as a booking-level credit until it is applied to a due item or refunded manually (Q-9).
- Payment dates are PKT calendar dates (`paid_on`), defaulting to today; the UI warns when a date is outside the current period but does not silently change it.

**Interactions:** calls Sales to lock and update due items, Cashbook to post/void the linked entry, and Audit. Exposes ledger and collection queries.

**Screens:** Record Payment (#10), Booking Detail, Buyer Detail.

### 5.6 Cashbook (Roznamcha)

**Job:** the company's daily cash diary — every rupee in and out, in one place.

**Key operations:**
- List entries for a day/period with running and period totals (In, Out, Net).
- Add manual entries (direction, category, amount, description, date).
- Void a manual entry with a reason; linked entries can only be voided by voiding the payment.
- Manage cash categories (Admin): name, nature (income, expense, opening), active flag.

**Invariants:**
- Entries are posted records; no hard deletes. Corrections are void + repost (see Q-2 in §19 for the PRD wording conflict).
- A payment produces exactly one linked In entry; voiding the payment voids it in the same transaction.
- Manual entries carry a business date (`entry_date`) in PKT and a recorded-by user.
- Categories in use cannot be deleted; they are deactivated.
- The category "nature" determines report grouping; free-text descriptions never drive report math.

**Interactions:** called by Ledger (auto-post/void in the payment transaction); read by Reporting and the dashboard; audit on all mutations.

**Screens:** Roznamcha (#11), Settings → Expense categories.

### 5.7 Recovery

**Job:** answer "who owes what, and what is late" reliably enough to call from (PRD S-4).

**Key operations:**
- Dashboard totals: total outstanding, overdue, upcoming 7/30 days, collected this month.
- Drill-down: buyer, phone, plot, due item, due date, amount due, overdue-by-days; filters and sorting.
- CSV export of the current filtered list (PRD D-12).

**Invariants:**
- Totals are computed from the **same open-balance query** used by the booking/buyer ledger, so the dashboard cannot disagree with the ledger (S-4).
- Only `CONFIRMED` bookings with open due items count. Cancelled bookings and closed due items never appear.
- Overdue is `due_date < today (PKT)`, an integer day difference, not an hours calculation.
- The module is read-only. Sales Agents can view it; they cannot record payments from it (PRD §10 note).

**Screens:** Recovery (#12), dashboard tiles.

### 5.8 Reminders

**Job:** attempt the four pre-due reminders for every unpaid due item, exactly once per milestone, and log every attempt.

**Key operations:** scheduler tick, message rendering from Admin templates, provider selection (dry-run default), claim/send/log, retry, failure surfacing, Reminder Log queries, settings for templates and channels, test send.

**Invariants:** detailed in §10. The short version:
- One claim per `(due_item_id, milestone)`, inserted before any provider call.
- No send for paid due items, cancelled bookings, or invalid phone numbers.
- Sends only between 09:00 and 20:00 PKT (PRD A-7).
- Every attempt is logged with status, channel, milestone, time, provider reference, and error.
- Dry-run never contacts a provider and never consumes a claim.

**Screens:** Reminder Log (#17), Settings → Reminder templates and channels.

### 5.9 Documents

**Job:** produce the two English-only buyer documents on demand.

**Key operations:** render the allotment letter and payment schedule from current company, booking, buyer, and due-item data; stream the PDF; log failures.

**Invariants:**
- The PDF pipeline is stateless and separate from UI i18n; it imports no translation catalog (§9.9).
- Documents reflect current data at generation time (PRD BR-6); they are not stored or versioned.
- Only users with document permission can download; the route checks the booking and role server-side.

**Screens:** Booking Detail, Booking Wizard success state.

### 5.10 Reporting

**Job:** cash-basis cash flow and income statement for any date range.

**Key operations:** run a report for a range in PKT; render a print view.

**Invariants:**
- Reports read **only** posted Roznamcha entries; voided entries are excluded.
- Cash flow and the Roznamcha period totals use the same table and filter, so S-6 holds structurally.
- The income statement is explicitly labeled "Cash basis" (PRD A-9).
- Print output is English-only (PRD A-3).

**Screens:** Reports (#13), print view.

### 5.11 Audit

**Job:** an append-only record of who did what, when, to what, and with what before/after values.

See §13 for the event list, schema intent, localization approach, and immutability.

**Screens:** Audit Log (#16).

### 5.12 Core (platform services)

Not a domain module; a small shared kernel:

- `core/db` — Prisma client singleton, transaction helper, pool sizing.
- `core/config` — Zod-validated environment; fail fast on missing/malformed values.
- `core/authz` — capability definitions and the role→capability policy (§6.3).
- `core/errors` — `AppError` with stable codes and HTTP mapping.
- `core/money` — decimal arithmetic, rounding, formatting, plan math.
- `core/datetime` — PKT boundaries, `DD-MMM-YYYY` formatting, month arithmetic.
- `core/files` — `FileStore` interface, local and S3 implementations, image pipeline.
- `core/jobs` — advisory lock helper, run-record helper.
- `core/logging` — pino instance, request context, redaction rules.
- `core/ids` — booking references, opaque public IDs.

---

## 6. Authentication and authorization

### 6.1 Login and sessions

| Aspect | Decision | Why |
|---|---|---|
| Identifier | Email (case-insensitive) + password | PRD allows email/username; email is simpler and unique. |
| Password hashing | Argon2id (`@node-rs/argon2`), per-user salt, 64 MiB / t=3 / p=1 baseline, benchmarked to <250 ms | PRD §15 requires bcrypt/argon2; Argon2id is the current recommendation. |
| Session type | Opaque 32-byte random token in an HttpOnly cookie; SHA-256 hash stored in `session` | Revocable server-side; no JWT revocation problem. |
| Cookie | `__Host-spm_session`; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` | Strongest cookie scoping; CSRF-resistant default. |
| Lifetime | 30 minutes idle, 12 hours absolute | Short idle timeout limits exposure on shared office machines; the absolute cap forces a daily re-login. |
| Rotation | New session row on login; no pre-auth session is ever reused | Prevents session fixation. |
| Revocation | On logout, password reset, deactivation, role change | PRD US-1.3 requires immediate effect. |
| Cleanup | Nightly job deletes expired sessions | Keeps the table tiny. |
| Login errors | One generic message; dummy hash verified for unknown emails | No account enumeration. |
| Throttling | Nginx per-IP limit on `/api/auth/login` + per-account failure counter with lockout/backoff in Postgres | Survives restarts; protects against credential stuffing. |
| Password reset | Admin generates a one-time temporary password, shown once; `must_change_password = true`; all sessions revoked | PRD FR-2.1; no email integration in scope. |
| Logout | `POST /api/auth/logout`; deletes the session row | No CSRF-able GET logout. |

**Middleware is not the security boundary.** Next.js middleware may redirect unauthenticated requests for UX, but every server component, route handler, and domain command re-resolves the session. This is deliberate: edge/middleware matchers are easy to misconfigure, and a single bypass would expose financial data.

### 6.2 Roles and capabilities

There are exactly three roles (PRD §10): **Admin**, **Sales Agent**, **Accountant**. Permissions are modeled as **capabilities** (verbs on resources), and the role→capability mapping is a single immutable table in `core/authz/policy.ts`.

| Capability | Admin | Sales Agent | Accountant |
|---|---|---|---|
| `setup.manage` (company, projects, blocks) | ✅ | — | — |
| `inventory.manage` (master plan, polygons, plot metadata/price) | ✅ | — | — |
| `inventory.read` | ✅ | ✅ | ✅ |
| `inventory.status` (reserve/release) | ✅ | — | — |
| `booking.create` | ✅ | ✅ | — |
| `booking.manage` (post-confirm edit) | ✅ | — | — |
| `booking.cancel` | ✅ | — | — |
| `booking.note` | ✅ | ✅ | — |
| `buyer.read` | ✅ | ✅ | ✅ |
| `buyer.edit` | ✅ | ✅ | — |
| `sales.read` (bookings) | ✅ | ✅ | ✅ |
| `ledger.read` | ✅ | ✅ | ✅ |
| `payment.record` | ✅ | — | ✅ |
| `payment.void` | ✅ | — | ✅ |
| `cashbook.record` | ✅ | — | ✅ |
| `cashbook.categories` (manage the category list) | ✅ | — | — |
| `recovery.read` | ✅ | ✅ (read-only) | ✅ |
| `reminder.read` | ✅ | — | ✅ |
| `reminder.configure` | ✅ | — | — |
| `report.read` | ✅ | ✅ | ✅ |
| `document.download` | ✅ | ✅ | ✅ |
| `user.manage` | ✅ | — | — |
| `audit.read` | ✅ | — | — |

Notes:
- "Full" vs "View" in PRD §10 collapses to capability presence for documents, because both generate and download use the same on-demand route.
- Sales Agents can view Recovery and Reports but have **no** write capabilities there (PRD §10 note).
- The table above is the only source of truth for permissions. UI navigation and button state are derived from it so they cannot drift.

### 6.3 Server-side enforcement: four layers

1. **UI (cosmetic).** Navigation items and actions are hidden or disabled based on the same capability table (DESIGN §6). This is usability, not security.
2. **Page/route adapter.** Every page calls `requireSession()` and, where relevant, `requireCapability()`. Unauthorized deep links render the DESIGN §6 "Not available for your role" empty state; APIs return `403` with code `AUTH_FORBIDDEN`.
3. **Domain command/query (the real boundary).** Every exported command and query declares its capability and checks it before doing anything. A route handler cannot forget the check because the function itself performs it. The worker uses a `SYSTEM` actor with no human capabilities and can only call the job functions it needs.
4. **Database invariants.** Constraints (unique CNIC, one active booking per plot, non-negative amounts, status enums) hold regardless of role or code path. Permissions do not replace invariants.

**Enforcement rules:**
- Never trust a role, user id, project id, or price sent by the client. The actor comes from the session; entity ownership and project scope are derived server-side.
- Every mutation is a `POST`/`PATCH`/`DELETE`; reads are `GET`. No state changes on `GET`.
- A missing capability returns `403`; a missing/invalid session returns `401`. Do not leak whether an entity exists to an unauthorized caller.
- UI hiding is **never** cited as the reason a role cannot do something; the service check is.

**How this is verified (PRD S-7):**
- A parameterized integration test iterates the full capability matrix (role × command) and asserts allow/deny. Adding a command without adding it to the test fails CI.
- A static check asserts that every public function in `commands.ts` calls `assertCapability`; the few system-only functions are explicitly tagged.
- Deep-link tests per role assert the empty state, not a redirect loop and not a leaked page.

### 6.4 CSRF, rate limiting, and transport

- **CSRF:** `SameSite=Lax` cookies plus an `Origin`/`Host` check on every non-GET request. No CSRF token is required, and no cross-origin CORS is enabled.
- **Rate limits:** login per IP (Nginx) and per account (DB); file upload, PDF generation, CSV export, and test-message endpoints are limited per user.
- **Transport:** HTTPS only; HTTP redirects to HTTPS; HSTS enabled after the first successful deploy.
- **Headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` minimal, `Content-Security-Policy` with `frame-ancestors 'none'` and `object-src 'none'`. Scripts use a nonce where the framework permits; styles allow inline only because the design system relies on style attributes. These are set at Nginx and in the app.
- **No public registration, no OAuth, no social login, no API keys for external clients.**

### 6.5 Not in scope

Two-factor authentication, SSO, IP allowlisting, audit of read access, and per-project membership. The first two are reasonable future additions for Admin accounts; the architecture does not block them.

---

## 7. File storage

### 7.1 What is stored

| Kind | Source | Size limit | Derivative |
|---|---|---|---|
| Master plan | Admin upload | 25 MB (JPG/PNG/WebP) | Display image (longest edge ≤5,000 px, ~2–4 MB) + 1,024 px thumbnail; original retained |
| Company logo | Admin upload | 2 MB (PNG/JPG/WebP) | Normalized PNG, ≤1,200 px wide |
| Buyer photo | Sales/Admin upload | 5 MB (JPG/PNG) | 800 px max, EXIF stripped, JPEG q80; 96 px avatar derivative |
| Generated PDFs | On demand | — | **Not stored** (regenerated per PRD BR-6) |

### 7.2 Storage abstraction

```ts
interface FileStore {
  put(input: Readable, meta: FileMeta): Promise<StoredFile>; // returns content hash + key
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

- **Default implementation: local disk** at `/srv/spm/files` (a host bind mount), outside the repository and outside any web root. PRD A-11 allows local or S3.
- **S3-compatible implementation** behind the same interface, selected by `FILE_STORE=s3`. It is configuration, not a rewrite, if the client later wants object storage.
- **Metadata lives in PostgreSQL** (`file_object`): opaque public id, storage key, original filename (for display only), MIME type, byte size, SHA-256, kind, dimensions, uploaded by, created at, and a soft-delete marker.
- **Storage keys are content-addressed**: `<kind>/<first2>/<next2>/<sha256>.<ext>` with no user-controlled path segments. This deduplicates identical uploads and makes path traversal impossible.
- **Why local:** tens of GB at most, no network hop for 25 MB plan images, no third-party dependency, and the backup pipeline already covers the volume. S3 adds durability but also egress cost and a credential to manage; it is not required at this scale.

### 7.3 Upload pipeline

1. Nginx caps the request body at **26 MB** (master plan 25 MB + multipart overhead) and times out slow uploads.
2. The route handler `POST /api/files` (authenticated, capability-checked per kind) streams the upload to a temporary file with a hard byte cap; it never trusts `Content-Length` alone.
3. **Magic-byte validation** with `file-type`, then an allowlist by kind. Extensions and client MIME types are advisory only. SVG, GIF, HEIC, PDF, and archives are rejected.
4. **sharp** decodes with `limitInputPixels` (100 MP) to stop decompression bombs, auto-rotates, strips EXIF/GPS/ICC metadata, and re-encodes. Re-encoding neutralizes embedded active content.
5. Dimensions and type are checked again after decode. A master plan with an extreme aspect ratio or an unreadable image is rejected with a clear error code.
6. Derivatives are generated (display, thumbnail, avatar) and stored alongside the original under distinct keys.
7. The `file_object` rows and the owning record's reference are written **after** all bytes and derivatives succeed. A failed upload leaves no dangling DB reference; the temp file is removed.
8. The response returns an opaque `publicId`, never a filesystem path or original filename.

**Master plan replacement:** the new image is uploaded as a new object; the project's reference is updated in a transaction and audited. Because polygon coordinates are normalized `[0,1]`, they survive resizing. If the new image's aspect ratio differs from the old by more than ~0.5%, the UI warns before saving that polygons will be geometrically distorted; the Admin can cancel or proceed. There is no automatic realignment in the MVP (Q-12).

### 7.4 Access control and serving

- Files are **private**. There is no public bucket, no directory listing, and no static mount of the storage directory.
- `GET /api/files/:publicId` requires a valid session and a capability check appropriate to the file kind (master plans: any authenticated user with inventory read; buyer photos: any role that can read buyers).
- The handler streams from the store (no full-file buffering), sets the correct `Content-Type`, `Content-Length`, `ETag` (the SHA-256), `Cache-Control: private, max-age=3600`, and `X-Content-Type-Options: nosniff`. Images are `inline`; PDFs and exports are `attachment`.
- Filenames in `Content-Disposition` are generated from entity references, never from PII (e.g., `Allotment-Letter-BK-1042.pdf`).
- PDF and CSV responses set `Cache-Control: no-store`.
- The browser loads images from the same origin, so cookies apply; no signed URLs are exposed in the page source.

### 7.5 Lifecycle and backup implications

- **Buyer photos:** one current photo per buyer. Replacing a photo creates a new object and soft-deletes the old one; a weekly job removes unreferenced objects older than 30 days.
- **Master plans:** all versions are retained (a handful per project). This supports rollback and explains historical maps; storage cost is negligible.
- **Orphans:** a weekly integrity job finds `file_object` rows with no owning reference and files on disk with no row, logs them, and cleans up after a grace period.
- **Backups:** the file volume is included in the nightly restic snapshot. Because objects are content-addressed and immutable, restic deduplicates them effectively.
- **Consistency:** the nightly sequence is **database dump first, then file snapshot**. The DB dump references only files that existed at or before that moment, so the snapshot (taken later) is a superset and no DB reference can be missing. Extra files are harmless.
- **Verification:** a nightly check samples DB file references, confirms the object exists, and compares its SHA-256. Failures alert the operator.

### 7.6 Failure modes

| Failure | Behavior |
|---|---|
| Upload exceeds size/type | `413`/`422` with a code mapped to a clear UI message (DESIGN §8). Temp file removed. |
| Image decode fails / bomb | `422 FILE_UNREADABLE`; nothing persisted. |
| Disk full | Upload rejected with `507`/`503`; alert on disk >80%. Existing files unaffected. |
| Missing file on read | `404 FILE_NOT_FOUND`; logged with the file id; the UI shows a retry/contact-admin message. |
| Storage write succeeds, DB write fails | Orphaned object; weekly GC removes it. No broken reference. |

---

## 8. PDF documents

### 8.1 Scope

Exactly two documents in the MVP (PRD D-11): the **Allotment Letter** and the **Payment Schedule**. Both are **English-only**, A4, with the company letterhead. No Urdu PDFs, no receipt PDFs, no template designer.

**Stored or ephemeral?** PRD §13 lists generated PDFs among stored files, but also says they are generated on demand and must reflect current data (BR-6). This design treats them as **ephemeral output**: nothing is stored, so a document can never be stale. If the client wants an immutable archive of issued letters, that is an additive `generated_document` table plus file storage — not a change to this architecture.

### 8.2 Library decision

**`@react-pdf/renderer`**, rendering in the Node process with embedded fonts.

| Criterion | Why it wins here |
|---|---|
| No browser | No Chromium download, no 300 MB image layer, no per-render browser memory. |
| Deterministic | Same data + same template → same document content; easy snapshot tests. |
| Fast | Typically well under 1 s for a one-page letter or a multi-page schedule; meets the 5 s requirement with margin. |
| Typographic control | Flexbox layout, absolute positioning, page headers/footers, page numbers, repeating table headers. |
| English-only | Its weaker Arabic shaping is irrelevant in the MVP (see §8.7). |

**Rejected:** Playwright/Chromium HTML→PDF (better typography and the right future answer for Urdu, but heavier and slower than needed now), PDFKit (too low-level for a letterhead and tables), and client-side PDF generation (cannot protect the template or enforce permissions).

### 8.3 Generation flow

```text
GET /api/bookings/:ref/documents/allotment-letter.pdf
  → requireSession + document.download (role checked)
  → load company, project, booking, buyers, due items (current data)
  → validate booking state (confirmed; not cancelled)
  → renderAllotmentLetter(data) → Buffer/Stream
  → Content-Type: application/pdf
    Content-Disposition: attachment; filename="Allotment-Letter-BK-1042.pdf"
    Cache-Control: no-store
```

- Generation happens **in the request**, outside any database transaction. No queue, no worker.
- Fonts and templates are loaded once at process start; the first render does not pay a font-file penalty.
- Concurrency is capped by a small in-process semaphore (2). A burst of downloads queues briefly rather than spiking memory.
- A generation failure is logged with the request id and returns `500 DOCUMENT_GENERATION_FAILED`; the UI shows the DESIGN §8 inline banner with Retry.

### 8.4 Templates and content

- Templates are TSX modules under `src/modules/documents/templates/`, with a shared `DocumentShell` providing margins, letterhead, footer, and page numbers.
- The allotment letter includes: company name/logo/address/contact, date, buyer(s) with CNIC and share %, project/block/plot, size in Marla and sq ft, dimensions, sale price, booking date, payment summary (token, down payment, installments), and the Admin-configured terms text (PRD US-4.1).
- The payment schedule lists every due item: label, due date (`DD-MMM-YYYY`), amount with `PKR` formatting, totals, buyer name(s), and plot identity (PRD US-4.2).
- Terms text is **plain text with paragraph breaks**, rendered as text nodes. No HTML is accepted or rendered, so there is no injection path into the PDF.
- Money and date formatting come from `core/money` and `core/datetime`, the same helpers the UI uses. The PDF does not import `i18n`.
- Fonts are static Inter TTF weights 400/600/700, embedded from the repository (OFL license included). No network font fetch.

### 8.5 Determinism and re-downloads

PRD BR-6 says re-downloads are identical for unchanged data. The implementation guarantees **content identity**: same company, booking, buyers, and due items produce the same layout and text. PDF metadata timestamps are pinned where the library allows; otherwise, "identical" means content-identical, not byte-identical. This is documented for the client and tested with a text-extraction snapshot.

### 8.6 Performance and failure handling

| Target | Approach |
|---|---|
| ≤5 s per document | In-process render, embedded fonts, ≤2 concurrent renders, 10 s hard timeout. |
| Large schedules | Automatic page breaks with repeated table headers; a 120-installment schedule is ~4–6 pages and still renders in ~1 s. |
| Failure visibility | Structured log (`document`, `bookingRef`, `error`, `requestId`) + user-facing retry. Failures are not written to the business audit log (no state changed). |
| Missing data | A cancelled booking or missing company profile returns a clear domain error, not a half-rendered PDF. |

### 8.7 Separation from UI i18n, and the Urdu caveat

- The documents module **MUST NOT** import `src/i18n` or any catalog. A lint rule enforces this. English copy lives in `documents/copy.ts` as typed constants.
- The allotment letter and schedule are legal/business documents; their language is a product decision (PRD A-3: English only in MVP), not a user preference. An Accountant viewing the UI in Urdu still downloads English PDFs; DESIGN §5.11 shows a "PDF is in English" helper.
- **If Urdu PDFs become in scope**, `@react-pdf/renderer` is not the right renderer for Nastaliq/Naskh shaping and bidi. The template boundary isolates the change: replace the renderer with headless Chromium (HTML/CSS → PDF) and reuse the same data assembly and copy structure. This is recorded as ADR-14 so the future decision is not a surprise.

---

## 9. Internationalization (English / Urdu)

### 9.1 Scope and rules

- The **UI** is switchable between English and Urdu at any time, on every screen, including Login (PRD FR-2.4, DESIGN §12).
- The **layout stays LTR** in both languages. Sidebar, table column order, button placement, and icons do not mirror. Only text runs are bidi-correct.
- **PDFs and printed reports are English-only** (PRD A-3). The print route forces `lang="en"` even when the UI is in Urdu.
- All user-facing UI strings come from catalogs. No literals in components (DESIGN §12.6).
- Latin digits (`0–9`) are used in **both** languages for money, dates, counts, CNIC, and phone numbers (DESIGN §12.4).

### 9.2 Catalog structure

```text
src/i18n/
├─ config.ts              # i18next init; both locales registered
├─ types.d.ts             # typed keys derived from en.json
├─ locales/
│  ├─ en.json             # reference catalog; source of truth for keys
│  └─ ur.json             # same shape, complete
└─ format.ts              # re-exports core/money and core/datetime helpers
```

- Catalogs are nested by domain: `common`, `nav`, `auth`, `inventory`, `booking`, `payment`, `cashbook`, `recovery`, `reminders`, `reports`, `settings`, `audit`, `errors`.
- Keys are semantic and stable: `booking.wizard.stepBuyers`, `booking.errors.plotTaken`, `payment.allocate.advanceHint`. Keys never contain English words that double as copy, and they never change just because the English wording changed.
- Interpolation uses `{{name}}` placeholders. Plurals use i18next's `_one` / `_other` suffixes (Urdu's plural categories are supported). Numbers are formatted **before** interpolation and passed as strings, so Urdu grammar never has to handle digit conversion.
- `en.json` defines the type; `ur.json` is type-checked against the same shape.

### 9.3 Loading, switching, and persistence

- **Both catalogs ship in the client bundle** (roughly 30–60 KB gzipped total). There is no network request when toggling, so switching is genuinely instant and works if the network hiccups.
- The root layout resolves the initial language server-side: `user.preferred_language` → language cookie (for the login page / pre-auth) → `en`.
- The toggle calls `i18n.changeLanguage('ur'|'en')`. React re-renders through context **without unmounting the route**, so open drawers, typed form values, scroll position, and wizard step are preserved (DESIGN §12.1).
- The provider **MUST NOT** key the tree by language or remount the router. This is a review checklist item.
- On switch: update `document.documentElement.lang`, persist via `PATCH /api/me/language` (`preferred_language`), update `document.title`, and announce via an `aria-live` region in the target language (DESIGN §12.1).
- If persistence fails, the UI keeps the chosen language for the session and shows a non-blocking toast; it does not silently revert.
- The login page uses a lightweight cookie so a user can choose Urdu before signing in. The stored per-user preference wins after authentication.

### 9.4 The server/client rendering constraint (important)

Next.js Server Components render on the server. A client-side language toggle cannot re-render server-rendered text without a network round-trip (`router.refresh()`), which would violate "immediately without a reload."

**Therefore:** all translatable text is rendered in **Client Components**. Server Components are used for authentication, data loading, and layout composition; they pass **data**, never display strings, to client views.

- A page server component fetches data and renders `<BookingsView initialData={…} />`.
- `BookingsView` is a client component that uses `useTranslation()` and renders every label, header, empty state, and error from the catalog.
- The map fetches its geometry client-side (large payload, cacheable) and renders controls/text on the client.
- Lists server-fetch their first page (small payload) for a fast first paint; client-side pagination/filtering fetches subsequent pages from `/api`.

This is the one structural concession Next.js requires to satisfy PRD FR-2.4. It is enforced by:
- ESLint `react/jsx-no-literals` on `src/app/**` and `src/components/**` (with an allowlist for punctuation and non-text symbols).
- A rule forbidding server components from importing catalog/`t()` helpers.
- A Playwright test that toggles language on each screen and asserts the text changed without navigation and without losing typed form state.

### 9.5 Key hygiene (build-time failure, not runtime blanks)

`npm run i18n:check` runs in CI and fails the build when:
1. A key used in code (`t('…')`, `<Trans i18nKey="…">`) is missing from `en.json` or `ur.json`.
2. A catalog contains a key that no code uses (orphan).
3. A value is empty or identical to the key.
4. `ur.json` and `en.json` shapes differ.
5. A catalog value contains a hardcoded digit sequence where a placeholder is expected (warning, not failure).

Runtime adds a `missingKeyHandler` that logs the key and falls back to English; in development and test it throws, so a missing key can never merge. A render test mounts every route in `ur` with the handler armed.

**Keys MUST be literal strings at call sites.** Dynamic key construction (`t('booking.status.' + status)`) is forbidden except through a small typed, exhaustive map (for example, status code → catalog key), which the checker also parses. This keeps the static analysis honest.

### 9.6 Formatting: money, dates, numbers

One shared module (`core/money`, `core/datetime`) is used by the UI, CSV, reports, and PDFs.

| Concern | Rule | Implementation |
|---|---|---|
| Money | `PKR` prefix for standalone values, bare right-aligned numbers under an `Amount (PKR)` header; 2 decimals; thousand separators | `Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`, always Latin digits; decimal strings on the wire |
| Dates | `DD-MMM-YYYY`, never localized (`05-Oct-2026`) | `Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Karachi' })`, joined with hyphens from `formatToParts` |
| Numbers | Tabular numerals; Latin digits in both languages | `font-variant-numeric: tabular-nums`; do **not** use `ur-PK` number formatting (it can emit Arabic-Indic digits) |
| Currency label | `PKR` / `Rs` in tables and forms; never a symbol that bidi can reorder | Amounts are wrapped in `<bdi dir="ltr">` |
| Overdue days | Integer days, computed from PKT calendar dates | `differenceInCalendarDays(todayPKT, dueDate)` |

**Do not** use `toLocaleString()` without an explicit locale and time zone. The server and the browser must produce the same string; tests assert this.

### 9.7 Bidi and layout rules

- `<html lang="…" dir="ltr">` always. No RTL stylesheet, no `direction: rtl` on containers.
- Translated text elements get `unicode-bidi: isolate`. User-generated content (buyer names, addresses, notes) gets `dir="auto"` so Urdu data renders correctly inside the English UI (DESIGN §12.2).
- Numbers, dates, CNIC, phone, plot numbers, and reference IDs are `dir="ltr"` and `tnum`, even inside Urdu sentences; wrap them in `<bdi>` to stop bidi reordering of adjacent punctuation.
- Icons never mirror. Sidebars, steppers, and table columns keep their positions.
- Urdu strings wrap rather than truncate where possible; chips allow two lines with a tooltip for the full text (DESIGN §12.5).

### 9.8 Fonts: Naskh, self-hosted, implemented technically

**Decision (from DESIGN §4.2):** the UI Urdu face is **Noto Sans Arabic (Naskh)**, not Nastaliq. Nastaliq is not enabled in the MVP; the optional title-only flag described in DESIGN remains a settings-level experiment for later, not part of this build.

Implementation:

1. **Self-hosted font files** in `/public/fonts/` (no Google Fonts CDN — privacy, reliability, and offline builds):
   - `Inter` variable/static WOFF2 for Latin (400/500/600/700).
   - `NotoSansArabic` WOFF2 for 400 and 700, subset to Arabic + Arabic Supplement + Arabic Extended-A + Arabic Presentation Forms.
   - License files (OFL) committed alongside.
2. **CSS `@font-face`** declarations with `font-display: swap` and a `unicode-range` covering the Arabic blocks. The font stack is:
   ```css
   font-family: Inter, "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif;
   ```
   Because Inter is first and lacks Arabic glyphs, Latin letters and digits render in Inter and Arabic script falls through to Noto **per glyph**, in both languages. This is also what keeps buyer names in Urdu readable while the UI is English.
3. **Loading:** preload Inter always. Preload Noto only when the server-rendered initial language is `ur`; otherwise it is fetched on first Arabic glyph. `font-display: swap` keeps the ≤200 ms fallback flash acceptable (DESIGN §12.5).
4. **Urdu typography overrides** under `html[lang="ur"]`:
   - +1 step sizes (13→15, 14→16, 20→22; `text-xs` minimum 13px).
   - Line-height 1.6 for body/labels, 1.8 for `text-h1` and above.
   - Weight mapping: 500 → 400, 600 → 700 (only 400/700 exist reliably).
   - `letter-spacing: 0`; never uppercase or small-caps.
5. **Nastaliq fallback:** if the optional flag is ever enabled, it applies only to `text-h1` and larger, with line-height ≥2.0, and never in tables, chips, buttons, or inputs. The architecture supports this by swapping one CSS variable under a `data-heading-font` attribute; no component changes.

**Why Naskh at these sizes:** at 12–14 px, Nastaliq's calligraphic forms and deep descenders reduce legibility and halve table density. This is a data-dense operations tool; Naskh is the correct engineering choice (DESIGN §4.2 records the same decision).

### 9.9 PDF and print separation

- `src/modules/documents/**` and the print-report layout **MUST NOT** import `src/i18n/**`. Enforced by `dependency-cruiser`.
- PDF copy is English constants; print reports render with `lang="en"` and English labels even when the UI is Urdu.
- The UI displays a small "PDF is in English" note near the PDF pair (DESIGN §5.11), and a similar note on the print action in Urdu mode.
- This separation is deliberate: it prevents a future catalog change from silently changing a legal document, and it keeps the PDF renderer independent of the React i18n runtime.

### 9.10 Translation workflow

- Catalogs live in Git. A native Urdu reviewer must approve any PR touching `ur.json`; machine translation alone is not acceptable for financial/legal UI.
- A shared glossary keeps terms consistent (e.g., installment, down payment, token, ledger, overdue). The glossary lives in `docs/i18n-glossary.md`.
- Urdu copy is written for the UI, not translated word-for-word; sentence length is checked against the DESIGN typography scale to avoid overflow in 36 px buttons and 40 px table rows.
- Adding a UI string is part of the definition of done: key in both catalogs, checked by CI, reviewed for length in both languages.

### 9.11 Tests

| Test | What it proves |
|---|---|
| Key parity test | Every key exists in both catalogs; no orphans; shapes match. |
| Route render test in `ur` | No missing-key fallback on any screen, including empty/error states. |
| Toggle E2E | Language changes without navigation; form state and drawer state survive. |
| Bidi snapshot | Amounts/dates inside Urdu strings render in the correct order (Playwright screenshot + DOM assertions). |
| Font smoke test | Noto loads and renders the Urdu-specific letters (ٹ ڈ ڑ ں ھ ے) in Chromium/Firefox. |
| Print/PDF test | PDFs and printed reports contain English text only, regardless of UI locale. |

---

## 10. Reminders and messaging

### 10.1 What the PRD requires

| Requirement | Source | Architectural consequence |
|---|---|---|
| Four milestones per unpaid due item: T-10, T-7, T-3, T-0 | PRD US-6.2, BR-4 | Milestone dates are pure calendar arithmetic on `due_date`, not polling intervals. |
| One attempt per due item per milestone; never duplicate, even across restarts | PRD S-5, US-6.2 | A database claim row keyed on `(due_item_id, milestone)` inserted **before** the provider call. |
| Skip fully paid items | PRD US-6.2 | Eligibility filters on the open balance at claim time. |
| Send window 09:00–20:00 PKT | PRD A-7 | Cron runs only inside the window; claims stop at 19:30. |
| Failures retried next run and visible on screen | PRD US-6.2, §12 | Failed claims retry with backoff; every attempt is a log row; a 24-hour failure banner. |
| Provider-agnostic interface, dry-run by default | PRD D-6 | One `ReminderProvider` interface; `REMINDER_MODE=dry_run` default; adapters for SMS/WhatsApp. |
| Primary buyer only | PRD D-5 | Recipient = first-listed buyer's normalized phone. |
| Template editable in Settings | PRD FR-7.2 | Templates stored in DB with validated placeholders; rendered body stored in the log. |

### 10.2 Components

| Component | Location | Responsibility |
|---|---|---|
| Scheduler tick | `src/worker/reminders.ts` | Cron entrypoint, advisory lock, batch orchestration. |
| Eligibility + claim logic | `src/modules/reminders/tick.ts` | Select due items, choose milestone, claim, retry, log. |
| Provider adapters | `src/modules/reminders/providers/*` | Map `OutboundMessage` to a concrete HTTP API. |
| Template renderer | `src/modules/reminders/render.ts` | Validate placeholders, render text and WhatsApp variables. |
| Claim + log tables | PostgreSQL | Idempotency and audit trail. |
| Settings UI | `/settings` → reminders | Templates, channel, sender id, dry-run/live, test send. |

### 10.3 Provider interface

```ts
export type Channel = 'SMS' | 'WHATSAPP';

export interface OutboundMessage {
  to: string;                       // E.164, e.g. +923001234567
  body: string;                     // rendered text; used for SMS, dry-run and logs
  template?: {                      // required by WhatsApp business-initiated messages
    name: string;
    language: string;               // e.g. "en"
    variables: Record<string, string>;
  };
}

export interface SendResult {
  providerRef: string;              // provider message id
}

export interface ReminderProvider {
  readonly channel: Channel;
  readonly name: string;            // "dry-run", "local-sms-gateway", "meta-cloud"
  send(message: OutboundMessage): Promise<SendResult>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly ambiguous: boolean,    // timeout / connection reset after write
    message: string,
  ) { super(message); }
}
```

- The adapter is selected at runtime from configuration. Only **one channel is active** in the MVP (PRD D-6: SMS first; WhatsApp added when approved). Adding a second requires a product decision because the claim key is per milestone, not per channel (§10.6).
- Adapters contain no business logic: no eligibility, no retries, no idempotency. They translate and send.
- A `DryRunProvider` is always available and is the default. It records what *would* have been sent.

### 10.4 Scheduler location and lifecycle

The scheduler lives in the **worker process** (`src/worker/main.ts`), not in the Next.js request path.

```text
09:00–19:30 PKT, every 30 minutes, plus once on worker startup
  → pg_try_advisory_lock(hashtext('spm.reminders.tick'))
  → if not acquired: exit (another run is active)
  → recover stale claims from a previous crash
  → retry retryable failed claims
  → claim and send new eligible milestones (batch ≤50)
  → write a job_run row
  → release lock
```

- **Why a worker:** web processes restart on deploys; scheduled work must not be recreated or duplicated. A dedicated process is also easier to observe and to kill if a provider misbehaves.
- **Why an advisory lock:** even with one worker container, a deploy can briefly run two processes. The lock makes overlapping ticks harmless.
- **Why not Redis/BullMQ/pg-boss:** the state to protect is a single unique claim per milestone. A queue adds a service and delivery semantics without solving the actual problem better. If background jobs multiply beyond reminders and nightly maintenance, this decision should be revisited.
- **Startup catch-up:** a tick runs once at worker start, so a server reboot at 09:05 does not delay the day's first sends until 09:30. The window check still applies.
- The worker also runs non-messaging jobs at 02:00 PKT: integrity checks, session cleanup, orphan-file cleanup, stale-claim recovery, and log pruning.

### 10.5 Eligibility and milestone selection

A due item is **eligible** when all of the following hold:

1. Its booking is `CONFIRMED` (cancelled bookings never send).
2. Its status is not `PAID` and its remaining amount is > 0.
3. Its due date is today or later (no overdue follow-up in the MVP — PRD BR-4).
4. The primary buyer has a valid normalized phone.

For each eligible due item, the scheduler considers milestones `10, 7, 3, 0`. A milestone is **in range** if `today >= due_date - milestone` (PKT calendar dates).

```text
for each eligible due item:
  in_range   = milestones (10,7,3,0) whose target date <= today
  retryable  = in-range claims with status FAILED and attempts < max
  claimable  = in-range milestones with no claim
  chosen     = latest target date among claimable            # most urgent

  if retryable:
      newest_failed = retryable with the latest target date
      if chosen is null or newest_failed.target >= chosen.target:
          retry newest_failed; continue
      abandon older failed claims, log "superseded by newer milestone"

  if chosen is null: continue
  for each claimable milestone older than chosen: log SKIPPED / "superseded"
  if dry_run:        log SKIPPED / "dry_run";        continue
  if not configured: log SKIPPED / "not_configured"; continue
  if no valid phone: log SKIPPED / "no_phone";       continue

  claim = INSERT (due_item, milestone) ON CONFLICT DO NOTHING RETURNING id
  if claim is null: continue                                  # someone else won
  send via adapter; update claim to SENT or FAILED/ABANDONED; append log row
```

**Why "most urgent" on catch-up:** if the worker was down for four days and the item is now at T-3, sending T-10, T-7 and T-3 back-to-back would be multiple messages in one day. The item gets the single most relevant message (T-3); the missed milestones are logged as `SKIPPED` with reason `superseded`, so the log explains the gap. A **failed** milestone is retried on the next tick, but if a newer milestone becomes eligible first, the older failure is abandoned and logged as superseded. The buyer never receives two milestone messages for the same due item on the same day.

### 10.6 Idempotency: how duplicate sends are prevented

**Two tables:**

- `reminder_claim` — the idempotency guard. One row per `(due_item_id, milestone)` with a **unique constraint**. Stores status (`SENDING`, `SENT`, `FAILED`, `ABANDONED`), attempt count, last attempt time, and next attempt time.
- `reminder_log` — the attempt history shown to staff. One row **per attempt**, status `SENT` / `FAILED` / `SKIPPED`, plus channel, recipient, rendered message, provider reference, error, and timestamp.

**The rule:** a provider call happens **only after** the claim insert commits. The unique constraint means that even if two ticks run concurrently, only one gets `RETURNING id`; the other gets no row and does nothing. A retry reuses the same claim and increments its attempt count; it does not create a second claim.

**What each situation leaves behind:**

| Situation | Claim | Log | Retry? |
|---|---|---|---|
| Provider accepts | `SENT` | `SENT` + provider ref | No |
| Provider rejects explicitly (4xx, invalid number, template error) | `ABANDONED` | `FAILED` + reason | No (except 429, which retries) |
| Provider 5xx / network error before write | `FAILED` | `FAILED` | Yes, until max 3 or due date |
| Timeout / connection reset after write (outcome unknown) | `ABANDONED` | `FAILED` + "outcome unknown" | **No** — see below |
| Worker crashes between claim and provider call | `SENDING` → `ABANDONED` | `FAILED` + "unknown" created by recovery | No |
| Worker crashes after send, before claim update | `SENDING` → `ABANDONED` | `FAILED` + "unknown" created by recovery | No |
| Dry run | No claim | `SKIPPED` + `dry_run` | N/A |
| Not configured | No claim | `SKIPPED` + `not_configured` | N/A |
| No phone | No claim | `SKIPPED` + `no_phone` | N/A |
| Paid / cancelled | No claim, no log | — | — |

**The honest residual risk:** an SMS provider does not offer an idempotency key. If the process dies *after* the provider accepted the message but *before* the claim is updated, the system cannot know whether it was delivered. The architecture chooses **at-most-once** in that window: the claim is abandoned and not retried, and the row is surfaced in the Reminder Log as "outcome unknown." A rare missing reminder is preferable to a duplicate, which is the explicit PRD requirement (S-5). This is documented, tested, and accepted.

**Why a unique index and not an application check:** an application `if (exists) return` has a race between the check and the insert. The database constraint has no such race.

### 10.7 Retries, window, and rate

| Concern | Rule |
|---|---|
| Sending window | 09:00–20:00 PKT. Ticks are scheduled 09:00–19:30; no new claim is made after 19:30 so in-flight work finishes before 20:00. |
| Retry backoff | +30 minutes from the failure, within the same window and before the due date. |
| Max attempts | 3 per milestone. After that, `ABANDONED`; the failure is visible and counts toward the banner. |
| Due-date cutoff | No attempts after `due_date`; remaining failures become `FAILED` with reason `window_expired`. |
| Batch size | ≤50 due items per tick, provider calls at concurrency 2, 10 s HTTP timeout. At realistic volume (tens to low hundreds per day) one morning tick handles almost everything. |
| Ordering | Oldest due date first; retries before new claims. |
| Provider rate limits | Respect 429 with a backoff; the next tick retries. A daily cap can be set in config if the provider requires it. |

### 10.8 Templates and message content

- Admin edits a template for the active channel. Placeholders are a strict allowlist: `{{buyer_name}}`, `{{plot}}`, `{{project}}`, `{{amount}}`, `{{due_date}}`, `{{company}}`.
- Unknown or malformed placeholders are rejected at save time with a field error. Rendering is a pure string substitution; no expressions, no HTML.
- The rendered body is stored on the log row for traceability and for dry-run review.
- **Data minimization:** the message contains the buyer's name, plot identity, amount remaining, and due date. No CNIC, address, photo, or other PII.
- Amounts and dates use the same formatters as the UI (`PKR 1,250,000.00`, `05-Oct-2026`), but message copy is **English** in the MVP (PRD D-6 leaves Urdu messaging out of scope; Q-8).
- WhatsApp requires an **approved template** for business-initiated messages. The adapter accepts the template name, language, and ordered variables. The Admin maps the approved template in Settings; the plain-text `body` is used for SMS, dry-run, and the log. Template approval is a client/ops dependency, not an architecture blocker (§16, R-4).

### 10.9 Dry-run is the default

- `REMINDER_MODE=dry_run` in `.env.example` and in every environment until the client explicitly flips it to `live` after credentials and consent are in place.
- Dry-run renders the real message, evaluates the real schedule, writes `SKIPPED` log rows, and makes **no** network call and **no** claim. This means flipping to live later still sends the milestones that were only simulated.
- The Settings screen shows a persistent banner: "Dry run — messages are logged, not sent." The Reminder Log shows `Skipped (dry run)` rows.
- A **Send test message** action (Admin only) uses the configured provider if live, or logs the message if dry-run. It requires an explicit phone number and shows a confirmation.

### 10.10 Configuration and secrets

| Item | Stored where | Editable in UI? |
|---|---|---|
| Active channel, enabled flag, sender ID | `provider_config` (non-secret columns) | Yes, Admin |
| Dry-run vs live | `provider_config` + env default | Yes, Admin, with a confirmation |
| Provider API key / token / password | `provider_config.secret_ciphertext`, AES-256-GCM with a key from `APP_SECRETS_KEY` (env) | Write-only: masked after save, never returned by the API |
| Template text | `reminder_template` | Yes, Admin |
| WhatsApp template name/language/variable map | `provider_config` | Yes, Admin |

- Credentials are **never** logged, returned in an API response, or included in error messages.
- Environment variables may override DB credentials for ops; the UI shows "Configured via environment" and does not allow editing in that case.
- Changes to credentials, channel, or live mode are audit-logged (without the secret value).
- `APP_SECRETS_KEY` is backed up in the team's password manager. If it is lost, encrypted credentials must be re-entered; this is documented in the runbook.

### 10.11 Observability and failure surfacing

- Every attempt produces a `reminder_log` row. The Reminder Log screen (DESIGN §13.17) shows sent/failed/skipped, channel, milestone, recipient, and error.
- A dashboard/recovery banner shows **"N sends failed in the last 24 hours"** for Admin and Accountant (DESIGN §8).
- If no provider is configured, reminders remain `Skipped (not configured)` and Settings shows a setup prompt — they are never silently dropped (PRD §12).
- The worker writes a `job_run` row each tick. `/api/health` is public and minimal (process up, version); `/api/health/details` is token-protected and exposes the last successful reminder tick and the last backup heartbeat. The external monitor uses `/api/health`; the token-protected detail check alerts if the tick is stale during business hours.
- Logs include due item id, booking reference, channel, milestone, attempt number, and provider code — never the phone number in full (mask to last 3 digits) and never the message body in operational logs (the DB row holds it).

### 10.12 Tests

| Test | Assertion |
|---|---|
| Double tick | Two concurrent ticks produce exactly one provider call and one claim. |
| Replay after restart | Re-running the tick does not send again for a `SENT` claim. |
| Crash recovery | A stale `SENDING` claim becomes `ABANDONED` with a log row and is not retried. |
| Paid item | No claim, no send, no log, even if the milestone is in range. |
| Cancelled booking | No send. |
| Catch-up | With T-10 and T-7 both missed, only the more urgent milestone is sent; the other is logged `superseded`. |
| Window | A tick at 19:45 claims nothing; a tick at 09:00 sends. |
| Provider failure | 5xx retries with backoff; 4xx abandons; timeout abandons as unknown. |
| Dry-run | No HTTP call, no claim, `SKIPPED` log row with the rendered body. |
| Template validation | Unknown placeholder rejected; saved template renders exactly. |

### 10.13 What this design does not do

No overdue follow-up messages, no two-way WhatsApp chat, no delivery receipts/webhooks, no per-channel duplicate sends, no scheduled campaign blasts, no retry after the due date, and no manual resend button. Each would require a product decision and, in some cases, a change to the claim key.

---

## 11. Reporting and recovery

### 11.1 The single-source rule

**All cash reporting reads `cash_entry` (the Roznamcha).** There is no parallel "reporting totals" table and no nightly aggregation. The Cash Flow report and the Roznamcha screen use the same rows and the same posted/void filter, which is why PRD S-6 ("reports match Roznamcha totals") is structurally true rather than a coincidence maintained by tests.

Payments post a linked In entry in the same transaction; voiding a payment voids that entry in the same transaction. Manual entries are posted or voided with a reason. Reports exclude `VOIDED` rows everywhere.

### 11.2 Cash Flow (PRD US-7.1)

For a date range `[from, to]` in PKT:

| Section | Definition |
|---|---|
| Opening cash | Net of all posted entries before `from` (In − Out), **plus** any `opening`-nature entry dated on/after `from` (so a go-live balance is never lost when the range starts before it). Opening entries are excluded from the period In/Out breakdown (§11.7). |
| Cash in | Posted In entries in range, grouped by category; payment-linked entries grouped as "Sale collections" |
| Cash out | Posted Out entries in range, grouped by expense category |
| Closing cash | Opening + Cash in − Cash out |
| Totals | Period In, period Out, net movement |

### 11.3 Income Statement, cash basis (PRD US-7.2)

| Line | Definition |
|---|---|
| Sale collections | Posted In entries linked to a payment, by business date |
| Other income | Posted manual In entries whose category nature is `income` |
| Total income | Sum of the above |
| Expenses | Posted Out entries grouped by category, by business date |
| Net | Total income − Expenses |
| Label | "Cash basis" badge next to the title (PRD A-9), in print too |

Opening-balance entries (nature `opening`) are excluded from both income and expense, and from the in/out breakdown, so a go-live cash injection does not inflate profit. Transfers between cash accounts (if ever added) would use a `transfer` nature and be excluded; not in MVP.

### 11.4 Implementation

- **One SQL statement per report**, built from CTEs, executed with parameters (`from`, `to`). A single statement gives a consistent snapshot across all sections without explicit isolation levels.
- Raw SQL in `modules/reporting/sql/`, typed with a Zod schema for the result. No Prisma query builder for aggregates.
- Indexes that matter: `cash_entry(entry_date)`, `cash_entry(entry_date, direction, category_id)`, `cash_entry(linked_payment_id)`. All are small at this volume.
- Date boundaries are inclusive and computed as PKT calendar dates. `entry_date` is a `DATE` chosen by the user (or inherited from the payment's `paid_on`), not a UTC timestamp. This removes timezone ambiguity from cash reports.
- The response is a typed structure per section, not a flat row list, so the UI and print view cannot reorder or mis-subtotal sections.

### 11.5 Recovery read model (PRD US-6.1, D-12)

- A single `openBalances` query (owned by Sales) returns, per open due item: booking reference, buyer name, phone, plot identity, due item label, due date, amount, paid, remaining, overdue days.
- The KPI totals (outstanding, overdue, upcoming 7/30, collected this month) are aggregates of the **same** query, so tiles and table cannot disagree (S-4).
- "Collected this month" comes from posted payments by `paid_on` (cash basis), not from creation timestamps.
- CSV export streams the current filtered result: UTF-8 with BOM (so Excel opens Urdu names correctly), RFC 4180 quoting, CRLF, and a guard that prefixes cells starting with `=`, `+`, `-`, or `@` to prevent formula injection. Phone/CNIC columns are exported as text.
- The module is read-only and exposes no commands. Sales Agents have `recovery.read` only.

### 11.6 Print output

- Reports have a dedicated print route (`/reports/print`) with `lang="en"`, the company header block, no application shell, black-on-white styling, repeated `<thead>`, page numbers, and 10 pt minimum text (DESIGN §14).
- Print output is **English-only** in both UI languages, satisfying PRD A-3's treatment of report PDFs.
- "Print report" opens the print route in a new tab; the user prints to PDF via the browser. No server-side report PDF is generated in the MVP.

### 11.7 The go-live opening balance (dependency)

Cash Flow's opening balance is only meaningful if the company's cash position at go-live is recorded. The system starts empty, so the opening balance would otherwise be zero while the company actually holds cash.

**Proposal (Q-6):** the Accountant enters one opening-balance entry (the cash book is company-wide, Q-5) on the day before go-live, using a system category with nature `opening`. The reporting SQL adds all `opening` entries to the opening position and excludes them from in/out and income. This is a one-time setup step, documented in the go-live runbook. It does not require a new module.

### 11.8 Performance and tests

| Concern | Target / approach |
|---|---|
| Report render | < 2 s for 200k cash entries; realistically < 100 ms at MVP volume. |
| Recovery table | < 2 s; filters on due date/status are indexed. |
| CSV | Streaming, no full materialization for large results; a few thousand rows in practice. |
| Tests | Parity tests compare each report section to direct sums of the source rows; void-exclusion tests; date-boundary tests at 00:00 PKT; opening-balance tests; CSV escaping/injection tests. |

---

## 12. Concurrency, money, and data integrity

This section addresses the highest-risk requirements: double booking, double payment allocation, exact arithmetic, and time.

### 12.1 The "plot booked by two people at once" case (PRD §12, S-3)

**Two layers, both required:**

1. **Pessimistic row lock** inside the booking transaction.
2. **Partial unique index** ensuring at most one active booking per plot, regardless of application code.

```sql
-- Prisma cannot express this; it lives in a hand-written migration.
CREATE UNIQUE INDEX one_active_booking_per_plot
  ON booking (plot_id)
  WHERE status = 'CONFIRMED';
```

```text
BEGIN
  SELECT id, status, price, version
    FROM plot
   WHERE id = $plotId
     FOR UPDATE;                          -- second request waits here

  -- zero rows → 404
  -- status not AVAILABLE (or RESERVED + actor is Admin) → 409 BOOKING_PLOT_UNAVAILABLE

  INSERT INTO booking (..., status = 'CONFIRMED', client_request_id = $uuid);
  INSERT INTO booking_buyer (...);         -- shares sum to 100, one primary
  INSERT INTO due_item (...);              -- generateSchedule() output

  UPDATE plot
     SET status = 'BOOKED_TOKEN', version = version + 1
   WHERE id = $plotId;

  INSERT INTO plot_status_history (...);
  INSERT INTO audit_log (...);
COMMIT;
```

**What happens to the second request:**

- It blocks on `FOR UPDATE` until the first commits.
- It then re-reads the plot, sees `BOOKED_TOKEN`, and returns `409 BOOKING_PLOT_UNAVAILABLE` with the DESIGN §8 message "This plot is no longer available."
- If a future code path ever bypassed the status check, the partial unique index would reject the insert with a unique violation. The service maps that to the same 409.
- No partial booking is persisted: the entire command is one transaction.

**Client behavior:** the Book button is disabled while submitting; on 409 the UI closes the wizard, shows the blocking dialog, and returns to the plot with fresh status. The form is not left in a half-saved state.

**Double-submit protection:** each wizard session generates a `client_request_id` (UUID). A unique index on `(created_by, client_request_id)` means a double-click or network retry returns the original booking instead of creating a second one.

### 12.2 Payment recording and allocation concurrency

Two accountants recording payments against the same booking at the same time could otherwise over-allocate a due item.

- The payment command locks the **booking row** (`SELECT … FOR UPDATE`) before reading due items. All payments for a booking serialize; payments for different bookings run in parallel.
- Allocation is computed inside the lock: remaining amounts are re-read, the requested allocations are validated against them, and due-item paid amounts are updated in the same transaction.
- The invariant `sum(allocations) + advance == payment amount` and "no allocation exceeds remaining" are checked before write and re-checked by tests.
- A unique `(created_by, client_request_id)` on payments prevents duplicate posting from a double-click.
- Voiding also locks the booking, so a void cannot interleave with a new payment.

**Why lock the booking rather than every due item:** it is a single, predictable lock, it matches the business unit of work ("one ledger"), and it avoids lock-order issues across multiple due rows.

### 12.3 Lock order and deadlock avoidance

Fixed order everywhere:

```text
plot → booking → due items → cash entry
```

- **Booking:** locks plot, then inserts booking.
- **Cancellation:** reads the booking to learn its plot (no lock), locks the plot, then locks the booking, then re-validates. This preserves plot-before-booking.
- **Payment/void:** locks the booking; never touches plot locks.
- **Status changes from Inventory:** lock the plot only.
- Transactions are short and never contain network calls, PDF rendering, or image processing.

If Postgres nevertheless reports a deadlock (a bug in lock ordering), the adapter maps it to a retryable `409 CONFLICT_RETRY`; the UI asks the user to retry. This should be unreachable in normal operation and is logged as an anomaly.

### 12.4 Concurrent edits (lost update prevention)

- `plot`, `booking`, `buyer`, and `project` carry a `version` integer.
- Edits send the version they loaded; the `UPDATE … WHERE id = $id AND version = $version` affects zero rows if someone else changed the record. The API returns `409 CONFLICT_STALE_WRITE` with a "This record changed — reload" message.
- Status transitions are not free-form edits; they are commands with explicit preconditions and their own audit entries.
- Booking cancellation locks and re-validates, so a cancel racing with a payment cannot produce a cancelled booking with a posted-but-unlinked payment.

### 12.5 Idempotent command submissions

| Command | Idempotency key | Duplicate behavior |
|---|---|---|
| Create booking | `client_request_id` per wizard session, unique per user | Returns the existing booking (200) with the same reference |
| Record payment | `client_request_id` per form session, unique per user | Returns the existing payment (200) |
| Void payment | Target status check | Second void returns `409 PAYMENT_ALREADY_VOIDED` |
| Cancel booking | Target status check | Second cancel returns `409 BOOKING_ALREADY_CANCELLED` |
| Reminder send | Unique claim `(due_item, milestone)` | Second attempt does nothing |

The request id is generated when the form is opened, not on submit, so a retry after a timeout reuses it.

### 12.6 Money and payment-plan arithmetic

**Storage and transport**

- PostgreSQL `numeric(12,2)`; Prisma `Decimal`; JSON carries money as **strings** (`"1250000.00"`), never numbers.
- `core/money` wraps `decimal.js` and is the only place that adds, subtracts, divides, rounds, or formats money. No `Number` arithmetic on amounts anywhere.
- Rounding is half-up to 2 decimals at the point a value is created; intermediate calculations use higher precision.

**Plan generation (shared by client preview and server persistence)**

```text
balance = salePrice - token - downPayment
base    = round2(balance / installmentCount)
for i in 1..n-1: installment[i] = base
installment[n] = balance - base * (n - 1)      // absorbs rounding remainder

assert installmentCount >= 1 and installmentCount <= 120   // Q-4
assert balance > 0
assert base > 0                    // never generate zero-amount installments
assert installment[n] > 0
assert token >= 0, downPayment >= 0
assert token + downPayment < salePrice
assert sum(installments) + token + downPayment == salePrice
```

- Monthly installments add calendar months to the first due date, clamped to the last valid day of the month (31 Jan → 28/29 Feb). Quarterly adds 3 months with the same rule.
- The same function is imported by the booking wizard for live preview and by the Sales command for persistence. The server **recomputes** the schedule; it never trusts a client-supplied schedule.
- A booking must leave a positive balance and at least one installment. A 100% cash purchase (token + down payment equal to the sale price) is out of MVP scope; supporting it later means allowing zero installments and a single due item, not weakening these assertions.
- Property-based tests generate random prices, token/down amounts, counts, and frequencies, and assert exact sums, ordering, positivity, and date monotonicity.
- Allocation remains exact: a payment of 100,000 allocated to due items 60,000 and 40,000 leaves zero advance; 100,000 against a 60,000 item leaves 40,000 advance.

**Why decimal strings and not integer paisa:** the PRD specifies `decimal(12,2)` and PKR amounts; `numeric` maps directly, keeps SQL readable, and avoids a second unit that front-end/back-end code can confuse. The string wire format prevents JavaScript from coercing to a float.

### 12.7 Dates and time

| Concern | Rule |
|---|---|
| Business dates (due dates, cash entry dates, report ranges) | PostgreSQL `DATE`; no time, no timezone. PKT calendar semantics. |
| Event timestamps (created at, sent at, audit) | `timestamptz`, stored UTC, displayed PKT. |
| "Today" | Computed in `Asia/Karachi`, never from the browser clock. |
| Cron | Explicit `timezone: 'Asia/Karachi'` (PKT is UTC+5 with no DST, which removes an entire class of bugs). |
| Monthly/quarterly arithmetic | Calendar months with end-of-month clamping, not "30 days". |
| Reminder milestone | `due_date - N days` as a date difference, not a timestamp offset. |
| Overdue days | `differenceInCalendarDays(todayPKT, due_date)`, never hours/24. |
| Server timezone | Host and containers run UTC; all conversions are explicit in `core/datetime`. Tests run with `TZ=UTC` and assert PKT output. |

### 12.8 Database-enforced invariants

Architecturally significant constraints (full DDL belongs to `DATABASE.md`):

| Invariant | Enforcement |
|---|---|
| One active booking per plot | Partial unique index |
| One primary buyer per booking | Partial unique index `(booking_id) WHERE is_primary` |
| Unique CNIC across buyers | Unique index on normalized CNIC |
| Unique plot number within a project | Unique `(project_id, plot_number)` |
| Positive money amounts | `CHECK (amount > 0)` on payments, due items, cash entries |
| Valid status values | Enums / check constraints |
| No duplicate reminder milestone | Unique `(due_item_id, milestone)` |
| One linked cash entry per payment | Unique `(linked_payment_id)` where not null |
| Valid share percentages | `CHECK (share_pct > 0 AND share_pct <= 100)`; total 100 enforced in the service and checked nightly |
| Immutable audit trail | Trigger blocking `UPDATE`/`DELETE` on `audit_log` |
| No hard deletes of financial rows | App role is not granted `DELETE` on financial tables (hardening) |

### 12.9 Nightly integrity checks

A small set of SQL checks runs at 02:00 PKT and writes a `job_run` result. Failures are logged and alerted; nothing is auto-corrected.

1. Due-item paid amount equals the sum of its non-voided allocations.
2. Every `CONFIRMED` booking's plot is `BOOKED_TOKEN` or `SOLD_CONSTRUCTED`.
3. No plot has more than one `CONFIRMED` booking (should be impossible; proves the index).
4. Every booking's buyer shares total 100 and has exactly one primary.
5. Every payment has exactly one linked cash entry, and every linked cash entry points to a payment.
6. Every `file_object` reference resolves and a sample hash matches.
7. Reminder claims stuck in `SENDING` older than 30 minutes are abandoned and logged.
8. Sum of open due items on `CONFIRMED` bookings equals the recovery outstanding total (both computed independently).

---

## 13. Audit logging

DESIGN §13.16 defines an Audit Log screen. This section defines what backs it.

### 13.1 What is audited

Every state-changing command in every module writes exactly one audit row **in the same transaction** as the change. If the change rolls back, so does the log entry; there is no such thing as a successful change without a record.

| Area | Events |
|---|---|
| Auth | Login success, login failure (with IP and user agent), logout, session revoked, password changed, user created/deactivated, role changed |
| Booking | Created, cancelled (reason), price plan revised, terms changed |
| Buyers | Created, contact/address/photo changed, CNIC corrected (with reason) |
| Plot | Created, edited, status changed (from → to, actor, reason) |
| Payments | Recorded, voided (reason), allocations changed at creation |
| Cashbook | Entry posted, entry voided (reason) |
| Settings | Company profile changed, reminder template changed, provider/channel changed, dry-run toggled |
| Imports/exports | Master plan replaced, CSV export requested (user, filters, row count) |

Deliberately **not** audited: page views, reads of lists, filter changes, report opens, and download of PDFs (a read of data the user is already permitted to see). Audit is for accountability of change and access-sensitive events, not analytics.

### 13.2 The table

```text
audit_log
  id              bigserial
  occurred_at     timestamptz not null default now()
  actor_user_id   uuid null            -- null for system actions, e.g. worker
  actor_label     text not null        -- denormalized name/email at event time
  action_code     text not null        -- stable code, e.g. booking.cancelled
  entity_type     text not null
  entity_id       uuid null
  booking_id      uuid null            -- denormalized for the booking timeline
  summary         jsonb not null       -- small, structured, no secrets/PII
  request_id      text null
  ip              inet null
```

- `action_code` is a **stable identifier**, not a sentence. The UI maps it to a localized sentence (`audit.action.bookingCancelled`), so the log reads correctly in English and Urdu and old rows never "change language."
- `summary` holds ids, numeric values, status pairs, and field names. It never holds CNIC, phone, address, or a photo path. Human-readable text is rendered from the code plus summary.
- For "what changed" events, `summary` may hold `{"from": …, "to": …}` for **non-sensitive** fields only. Sensitive field changes are recorded as `{"fields": ["cnic"], "reason": "…"}`.
- `actor_label` is denormalized so a deactivated user's history still shows who acted.

### 13.3 Append-only enforcement

- No `UPDATE` or `DELETE` path exists in the application; the repository has no `deleteAudit` method and the code review checklist forbids adding one.
- A `BEFORE UPDATE OR DELETE` trigger raises an exception, so even a console mistake fails.
- The application DB role has `INSERT` and `SELECT` on `audit_log`, not `UPDATE`/`DELETE`.
- Retention: rows are kept for the life of the system (PRD has no retention requirement). Growth is trivial — even 100 events/day for 10 years is ~365k rows.

### 13.4 Reading it

- `audit.read` is Admin-only (PRD §10). There is no "my activity" view for other roles.
- The Audit Log screen filters by date range, actor, entity, and action code, with pagination (DESIGN §13.16). Sorting is `occurred_at DESC, id DESC`.
- The booking detail screen shows the booking's timeline by filtering `booking_id`; it is not a separate table.
- Export to CSV is allowed for Admin and is itself audited (`audit.exported`).
- Reads of `audit_log` are **not** written back into `audit_log` (that would recurse and add noise).

### 13.5 Relationship to operational logs

Two different tools for two different jobs:

| | `audit_log` (Postgres) | Application logs (stdout → files) |
|---|---|---|
| Purpose | Accountability: who changed what | Diagnosis: errors, timings, traces |
| Content | Business events, localized later | Stack traces, request ids, SQL errors |
| Audience | Admin in the UI | Operators with server access |
| Retention | Life of system | Bounded by Docker rotation (5 × 20 MB) |
| Language | Codes + JSON | English |

Neither substitutes for the other. Operational logs never carry CNIC or full phone numbers; audit rows never carry stack traces.

### 13.6 Failure behavior

- Because the audit insert is in the business transaction, an audit failure fails the command. There is no "best effort" audit.
- The one exception is **login failure** audit rows, which are written when there is no transaction and no authenticated user; a failure to write there is logged to stderr and still returns a generic auth error (never revealing whether the audit failed).
- Audit rows for system actions use `actor_user_id = null` and `actor_label = 'system'` or `'worker'`.

---

## 14. Deployment and operations

### 14.1 Target environment

One Ubuntu 24.04 LTS VPS (PRD A-11): 4 vCPU, 8 GB RAM, 160 GB SSD, in a Pakistani or nearby region. That is deliberately more than the workload needs (peak concurrency ≤5 users), leaving room for the OS, Postgres, backups, and image builds.

```text
Internet
   │  :443 (Nginx + Certbot, TLS)
   ▼
┌──────────────────────────────────────────────┐
│ VPS (Ubuntu 24.04)                           │
│                                              │
│  Nginx ──► web (Next.js, 127.0.0.1:3000)     │
│  worker (same image, no HTTP, cron ticks)    │
│                                              │
│  postgres:17 (compose network only, volume)  │
│  /srv/spm/files (uploaded files, volume)     │
│  /srv/spm/backups (local dump staging)       │
└──────────────────────────────────────────────┘
        │ nightly restic push
        ▼
   S3-compatible bucket (off-site, versioned)
```

- Only Nginx listens publicly (Nginx and Certbot run on the host, outside Compose, and proxy to `127.0.0.1:3000`). Postgres and the app bind to loopback (or a private Docker network), never to `0.0.0.0`. **No database port is exposed to the internet.**
- No Kubernetes, no managed container platform, no multi-AZ. Rejected in §2.3.

### 14.2 Docker Compose

```yaml
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: spm
      POSTGRES_USER: spm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      APP_DB_PASSWORD: ${APP_DB_PASSWORD}          # consumed by db/init/01-roles.sql
      MIGRATOR_PASSWORD: ${MIGRATOR_PASSWORD}      # consumed by db/init/01-roles.sql
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro   # creates spm_migrator + spm_app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U spm -d spm"]
      interval: 10s
      timeout: 5s
      retries: 5
    # no ports: reachable only on the compose network

  web:
    image: ghcr.io/<org>/spm:${TAG}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://spm_app:${APP_DB_PASSWORD}@db:5432/spm
      APP_SECRETS_KEY: ${APP_SECRETS_KEY}
      REMINDER_MODE: ${REMINDER_MODE}
    volumes:
      - /srv/spm/files:/srv/spm/files
    ports:
      - "127.0.0.1:3000:3000"        # loopback only; host Nginx proxies to it
    command: ["node", ".next/standalone/server.js"]

  worker:
    image: ghcr.io/<org>/spm:${TAG}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://spm_app:${APP_DB_PASSWORD}@db:5432/spm
      APP_SECRETS_KEY: ${APP_SECRETS_KEY}
      REMINDER_MODE: ${REMINDER_MODE}
    volumes:
      - /srv/spm/files:/srv/spm/files
    command: ["node", "dist/worker/main.js"]

  migrate:
    image: ghcr.io/<org>/spm:${TAG}
    profiles: ["tools"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://spm_migrator:${MIGRATOR_PASSWORD}@db:5432/spm
    command: ["npx", "prisma", "migrate", "deploy"]

volumes:
  pgdata:
```

- `migrate` is a one-off (`docker compose run --rm migrate`), never part of `up`. It runs **before** the new image starts. The image keeps the Prisma CLI as a production dependency so the same image can migrate; it is not a separate tooling image to drift.
- **Build outputs:** Next.js runs with `output: 'standalone'` (`.next/standalone/server.js`); the worker is bundled to `dist/worker/main.js`. Both live in the same image and are started with different commands.
- `web` and `worker` are the **same image** with different entrypoints. One build, one version, no drift.
- `db/init/01-roles.sql` runs **only on an empty data volume**. It creates `spm_migrator` (schema owner) and `spm_app` (runtime, no `DELETE` on financial tables). Rotating either password afterwards is a documented manual step; the script is idempotent for fresh installs.
- Compose is the whole orchestration story. No swarm, no k8s manifests.

### 14.3 CI/CD

```text
push / PR
  → lint + typecheck
  → unit tests (Vitest)
  → integration tests (Postgres service container)
  → build
  → Playwright E2E (key journeys)
  → i18n key check + dependency-cruiser boundaries
  → build image, tag with commit SHA
  → push to GHCR

deploy (manual approval, tag)
  → ssh to VPS
  → docker compose pull
  → docker compose run --rm migrate
  → docker compose up -d web worker
  → smoke check /api/health
  → keep the previous image tag for one-command rollback
```

- Deploys are **manual** and outside business hours (PRD has no requirement for zero-downtime). A restart takes seconds; users retry.
- Rollback = set `TAG` to the previous SHA and `up -d`; migrations are written to be backward-compatible for one release (add nullable columns, backfill, then tighten) so a rollback does not need a down-migration.
- Migrations run once, not per replica; with one web and one worker there is no race, and Prisma's migrate lock covers accidental overlap.

### 14.4 Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Development | Seeded synthetic data; never client data |
| Staging (optional, on the same VPS or a small second one) | Pre-release check, especially PDFs and Urdu | Anonymized or synthetic copy |
| Production | Client use | Real data, restricted access |

Given one client and a small team, staging may be skipped in the first month; the deploy checklist then includes a manual smoke test of booking, payment, and a PDF. This is a conscious scope decision, not an oversight.

### 14.5 Configuration and secrets

- All configuration via environment (`.env` on the server, `0600`, owned by the deploy user). `.env.example` documents every key with safe defaults; no real secret is ever committed.
- Secrets: `POSTGRES_PASSWORD` (superuser, init only), `APP_DB_PASSWORD` (runtime role), `MIGRATOR_PASSWORD` (DDL role), `APP_SECRETS_KEY`, provider credentials (encrypted in DB, see §10.10), `BACKUP_S3_*`.
- Rotation: DB password rotation requires a restart (documented); `APP_SECRETS_KEY` rotation is not supported in MVP (re-enter provider credentials instead).
- No secrets in the image, in Git, in CI logs, or in error responses. CI uses ephemeral credentials.

### 14.6 Database roles and privileges

| Role | Used by | Privileges |
|---|---|---|
| `spm_migrator` | `migrate` only | Owner; DDL |
| `spm_app` | `web`, `worker` | DML on app tables; **no** `DELETE` on financial tables; no DDL |

This is defence in depth: a bug that tries to hard-delete a payment or alter a table fails at the database, not just in code review.

### 14.7 Backup and restore

| Item | Approach |
|---|---|
| Database | Nightly `pg_dump -Fc` at 02:30 PKT to `/srv/spm/backups`, then `restic backup` to an off-site S3-compatible bucket. |
| Uploaded files | The `/srv/spm/files` directory is included in the same restic snapshot (master plans, buyer photos). |
| Frequency | Daily (RPO ≈24 h), plus the provider's versioning on the bucket. |
| Retention | 30 daily (PRD §15 minimum), plus 12 weekly and 12 monthly for safety (restic forget policy). |
| Encryption | restic repository password held in the password manager; bucket access is write-only for the server key where possible. |
| Verification | A **weekly automated restore test** into a scratch database, comparing row counts for key tables and one file hash. A backup that has never been restored is not a backup. |
| RTO | ≈4 hours: provision VPS, restore dump and files, point DNS, start stack. Documented step by step in `RUNBOOK.md`. |
| Monitoring | Backup script writes a heartbeat; an external monitor alerts if no successful backup in 26 hours. |

**Not backed up:** application logs, Docker images (rebuildable from Git), and PDFs (regenerated on demand, §8.1).

### 14.8 Monitoring and alerting

Deliberately minimal — no Prometheus/Grafana stack for one VPS.

| Signal | Mechanism | Alert |
|---|---|---|
| App up | External HTTP check on `/api/health` every minute | Email/Telegram after 2 failures |
| Error rate | Structured logs; a daily count of 5xx in a log summary | Daily digest; threshold alert |
| Reminder worker alive | Last `job_run` timestamp exposed on the health endpoint | Stale > 2 h during 09:00–20:00 |
| Backup | Backup script pings an external heartbeat URL (and writes a local marker). | Missing > 26 h |
| Disk | Host cron checks `df`; warns at 80% | Email |
| DB size/replication | None (single node); `pg_database_size` logged weekly | Informational |
| Certificate | Certbot renews automatically; expiry check in the external monitor | 14 days before expiry |

- Logs are JSON lines to stdout, collected by Docker's json-file driver with rotation (`max-size: 20m`, `max-file: 5`). No ELK, no Loki.
- Every request has a `request_id` (from a header or generated) included in error responses so a user can quote it.

### 14.9 Hardening checklist

- SSH keys only; password auth and root login disabled; non-root deploy user with `sudo` for Docker.
- UFW: allow 22 (restricted to known IPs where practical), 80, 443 only.
- Fail2ban on SSH.
- Automatic unattended security upgrades.
- Nginx with HSTS, TLS 1.2+, and security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors).
- Containers run as non-root; read-only root filesystem where practical; the files volume is the only writable mount.
- `limit_req` at Nginx for `/api/auth/*` (login brute force).
- No phpMyAdmin/pgAdmin exposed; DB access via SSH tunnel only.

### 14.10 Go-live and routine operations

- Go-live runbook: restore/initialize DB, run migrations, create the Admin user, set company profile and terms text, import the master plan and either enter plot data manually or run the agreed one-off import script, enter the opening cash balance (Q-6), configure the provider in dry-run, then flip to live after consent.
- Routine: daily backup check (automated), weekly restore test (automated), monthly dependency updates (reviewed), quarterly secret rotation review.
- `RUNBOOK.md` (next doc after `DATABASE.md`) holds the exact commands for deploy, rollback, restore, and incident triage.

### 14.11 Cost sketch

| Item | Approx. monthly |
|---|---|
| VPS (4 vCPU/8 GB, PK region) | USD 20–40 |
| Off-site object storage (< 50 GB) | USD 1–3 |
| Domain + TLS | ~USD 1 |
| SMS (dry-run initially) | Variable; budgeted per message |
| Total infra | **< USD 50/month** |

SMS is the only cost that scales with usage, and it is the client's provider account.

---

## 15. Non-functional requirements

PRD §15 gives the numbers; this section says how each is met and how it is verified.

### 15.1 Performance

| Scenario | Target | How | Verified by |
|---|---|---|---|
| Login | < 500 ms p95 | Argon2id is the cost; one indexed user lookup; session insert. Argon2id parameters tuned to ~150–250 ms on the VPS. | Load test with 20 sequential logins; server timing logs |
| List screens (plots, bookings, recovery) | < 2 s for a full page | Server-side pagination (50/page), covering indexes, no N+1 (Prisma `include` chosen deliberately), no client-side whole-table loads | Integration timing test with 3,000 plots and 10,000 bookings |
| Map with 3,000 polygons | First paint < 3 s; pan/zoom 60 fps | Geometry endpoint returns normalized `[x,y]` arrays (~< 500 KB gzipped, §7.4); Konva `Shape` with cached scene; labels hidden below a zoom threshold; no per-polygon React nodes | Lighthouse-ish manual test; payload size asserted in CI |
| Record a payment | < 1 s | One transaction, ≤ a few dozen due items, no network calls | Integration timing |
| PDF generation | ≤ 5 s hard; target < 1 s | In-process render, embedded fonts, semaphore 2 | Timing test per template |
| Reports | < 2 s at 200k entries | Single CTE query, date index | Seed 200k rows in a perf test (nightly, not per PR) |
| CSV export | Streams, no timeout | Keyset/streamed read, not `findMany()` | 10k-row export test |
| Reminder tick | < 60 s for 50 items | Concurrency 2, 10 s timeout each → worst case 250 s if all time out; batch shrinks to stay under the window | Worker test with a stub provider |

**The real constraint is not CPU but round trips and payloads.** The architecture avoids client-side joins and per-row queries; that is why these targets are comfortably met at 3,000 plots.

### 15.2 Security

| Concern | Control |
|---|---|
| Authentication | Email + Argon2id password; DB-backed sessions; `HttpOnly`, `Secure`, `SameSite=Lax` cookie; 30-minute idle / 12-hour absolute expiry; rotation on login (prevents session fixation); session table revocable |
| Authorization | Server-side capability checks in the service layer (§6.3); every route and every service entry point; no reliance on hidden UI |
| Object-level access | Single-tenant internal app, so "can this user see this plot/booking?" is "does the role have the read capability?" — there is no per-record tenancy. Buyer/plot data is company-wide by design. |
| CSRF | SameSite=Lax plus an origin check on state-changing requests; `POST`/`PATCH`/`DELETE` only |
| SQL injection | Prisma parameterization; raw SQL only with `$queryRaw` tagged templates and typed parameters; no string concatenation |
| XSS | React escaping by default; no `dangerouslySetInnerHTML`; terms text and notes are rendered as text; CSP blocks inline script |
| Password storage | Argon2id (`memoryCost` 64 MiB, `timeCost` 3, `parallelism` 1 — above the OWASP baseline, still <250 ms on the target VPS); rehash on login when parameters change |
| Brute force | Per-IP and per-account rate limit on login; failed attempts audited; generic error message (no user enumeration) |
| Transport | TLS 1.2+ via Nginx; HSTS; no mixed content |
| Secrets | Env + encrypted provider credentials (§10.10); never in logs or API responses |
| PII at rest | CNIC, phone, address, and buyer photos are the sensitive set. Disk encryption is the hosting provider's responsibility (documented); DB access is loopback-only; backups are encrypted by restic. **Application-level field encryption is not used for CNIC** — it would break search and uniqueness for marginal gain in a single-tenant DB. This is a conscious decision (Q-10). |
| PII in logs | Phone masked, CNIC never logged, message bodies only in `reminder_log` |
| File uploads | Type+magic-byte validation, size caps, extension allowlist, never executed, served with `Content-Disposition` and a strict `Content-Type`; stored outside the web root |
| Dependency risk | `npm audit` in CI (warn), Dependabot monthly, lockfile committed |
| Audit | Append-only, Admin-read, same-transaction writes (§13) |

**Threat model in one line:** the attacker is most likely an insider with valid credentials, a stolen session, or someone who guesses a weak password — not a nation-state. Controls focus on least privilege, session hygiene, server-side checks, and an audit trail, which is what the PRD's role matrix implies.

### 15.3 Reliability and availability

- No HA requirement (PRD A-11). Target: available during office hours; a restart is acceptable.
- `restart: unless-stopped` on all containers; health checks; Nginx upstream retries.
- DB is the single point of failure; the backup/restore plan (§14.7) is the mitigation, with RPO ≤24 h and RTO ≤4 h.
- Graceful shutdown: `web` stops accepting, finishes in-flight requests (10 s); `worker` finishes the current tick and releases the advisory lock.
- Idempotent commands (§12.5) make retries safe after a crash.

### 15.4 Accessibility and usability

- WCAG 2.1 AA target for the shell: keyboard navigation, visible focus, 4.5:1 contrast, labels tied to inputs, `aria-live` for errors and language changes (DESIGN §11).
- Desktop-first (PRD A-10). Large tablets can view lists, ledgers, and dashboards; polygon drawing requires a desktop pointer and is disabled below 1024 px. Phones are out of scope and show a "use a desktop or large tablet" message rather than a broken layout.
- Both languages meet the same contrast and focus requirements; Urdu type sizes are one step larger (§9.8).
- Reduced motion respected; no animation required to understand state.

### 15.5 Maintainability

- One language (TypeScript) end to end; one package manager; one test runner per layer.
- Module boundaries enforced by `dependency-cruiser`; a new cross-module import fails CI.
- Every architectural rule in this document is either a lint rule, a DB constraint, a test, or is marked as review-only. Rules that cannot be enforced are kept few and explicit (§2.4).
- Schema is owned by `DATABASE.md`; this document owns boundaries and behaviors. When they disagree, the PRD wins on behavior, this document on structure.

### 15.6 Browser and device support

- Evergreen Chromium and Firefox on desktop/tablet (last two versions); Safari is best-effort (the client uses Windows/Android per PRD assumptions — verify at kickoff).
- Minimum viewport 1024×768 for full functionality; 768 px width shows a read-only view of lists.
- No IE, no legacy Edge.

---

## 16. Risk register

The PRD requirements that create meaningful technical risk, with the architectural response. Severity is *residual* after the mitigation.

| ID | Risk (source) | Why it is hard | Mitigation | Residual |
|---|---|---|---|---|
| R-1 | Two users book the same plot (PRD §12, S-3) | Race between read and write; UI optimism | Plot row lock + partial unique index + 409 handling; client disables submit (§12.1) | **Low.** One request wins, the other gets a clear error. |
| R-2 | Duplicate reminder for one milestone (PRD S-5, US-6.2) | Provider calls are not idempotent; crashes mid-send | Claim row inserted and committed **before** the call; unique `(due_item, milestone)`; at-most-once in the unknown window (§10.6) | **Low.** Duplicates are impossible by design; a rare missing send is possible and visible as "outcome unknown". |
| R-3 | Money arithmetic drift (PRD S-6) | Floating point; rounding; client/server disagreement | `numeric(12,2)`, decimal strings, one shared schedule function, server recompute, property tests (§12.6) | **Low.** |
| R-4 | WhatsApp template approval delays launch (PRD D-6) | Meta review is external and slow | SMS is the MVP channel; WhatsApp is an adapter; dry-run until configured | **Medium** (business), **low** (technical). |
| R-5 | Bilingual UI: layout breakage in Urdu (PRD FR-2.4, A-3) | Longer strings, script shaping, mixed directions | Naskh at larger sizes, `dir=auto` for data, `<bdi>` for numbers, LTR layout, per-screen Urdu render tests (§9) | **Low–medium.** Needs a native reviewer, not just tests. |
| R-6 | Server-rendered text cannot switch instantly (Next.js) | Server Components do not re-render on a client toggle | All display text in client components; data fetched server-side (§9.4) | **Low**, at the cost of a client-heavy shell. |
| R-7 | PDF layout changes with data length | Long names, 120 installments, many buyers | Flexbox/wrap, page breaks, repeated headers, snapshot tests with edge-case fixtures (§8) | **Low.** |
| R-8 | Master plan raster and polygons drift apart (PRD §13) | Coordinates are normalized to a specific image | Store image dimensions with the project; reject a replacement with a different aspect ratio without confirmation (Q-12); normalized coords, never pixels (§7.4) | **Low.** |
| R-9 | Payment allocation over-allocates | Concurrent payments on one booking | Booking-level lock, re-read inside the lock, invariant tests (§12.2) | **Low.** |
| R-10 | Reminder catch-up floods a buyer | Worker down for days, then several milestones eligible | One message per item per day: most urgent wins, others logged `superseded` (§10.5) | **Low.** |
| R-11 | Editing a confirmed booking's price after payments exist | Ledger would no longer reconcile to the plan | Price-plan change is allowed only at zero payments (Q-1); otherwise cancel-and-rebook; server invariant | **Medium** (product), **low** (technical). Needs client sign-off. |
| R-12 | Manual Roznamcha edits break report parity | Humans make mistakes; edits rewrite history | Void-only for cash entries (Q-2); correction = void + repost; both audited; reports read only posted rows | **Low.** |
| R-13 | SMS consent / PTA compliance (Pakistan) | Unsolicited marketing rules; sender ID registration | Consent captured manually before live; dry-run default; client's provider account holds registrations (Q-11) | **Medium** (external), **low** (technical). |
| R-14 | Backup exists but is unusable | Untested restores are common | Weekly automated restore test, checksum and row-count comparison, external heartbeat (§14.7) | **Low.** |
| R-15 | Single VPS dies | No HA | 24 h RPO, 4 h RTO, documented restore; client accepts (A-11) | **Accepted.** |
| R-16 | Urdu PDFs requested later | Renderer cannot shape Nastaliq/Naskh well | Scope excludes them (A-3); template boundary isolates a renderer swap (ADR-14) | **Low** now; a known future cost. |
| R-17 | Seeding existing plots/buyers is messy | Real data has duplicates, bad CNICs, missing phones | One-off import script run by the team (not an MVP feature): dry-run report, per-row errors, all-or-nothing commit; CNIC/phone normalization; duplicates flagged (§5.2) | **Medium** (delivery effort), not architectural. |
| R-18 | Client expects reminders to continue after the due date | PRD BR-4 says T-0 only; real-world expectation differs | Explicit in this document and in the UI copy; adding overdue reminders is a small extension (milestone −N) if decided | **Medium** (expectation). Needs sign-off. |
| R-19 | Provider outage at the send window | Messages fail, retries exhaust | Retries with backoff inside the window, failure banner, "outcome unknown" surfaced; next-day catch-up sends the most urgent | **Low.** |
| R-20 | Key-person dependency (one small team) | Bus factor | Boring stack, written runbook, ADRs, no bespoke infrastructure, standard Docker/Postgres | **Medium**, mitigated by documentation, not code. |

**Not on this list, deliberately:** "scaling to millions of plots", "multi-tenant isolation", "real-time collaborative editing", "event sourcing", "offline-first". The PRD excludes them, and designing for them would violate the simplicity constraint.

---

## 17. Traceability

### 17.1 PRD functional area → module → screen → proof

| PRD area | Module(s) | PRD §11 screen | Verification |
|---|---|---|---|
| Company, projects, blocks (FR-1) | Setup | Settings (#14, project/block sections) | CRUD tests; block-delete guard; company profile in PDF |
| Users, roles, login (FR-2) | Identity | Login, Users | Capability matrix tests; session expiry; server-side denial per capability |
| Master plan, plots, map (FR-3) | Inventory | Plot Map (#3), Plot List (#4), Plot Details (#5) | Geometry payload test; polygon validation; map E2E |
| Buyers, booking, cancellation (FR-4) | Sales | Buyers, Booking wizard, Booking detail | CNIC uniqueness; concurrent booking test (R-1); plan math property tests |
| Documents (FR-5) | Documents, Sales | Booking detail (downloads) | PDF snapshot; English-only assertion; re-download content identity |
| Payments, ledger, Roznamcha (FR-6) | Ledger, Cashbook | Record Payment, Buyer ledger, Roznamcha | Allocation invariants; void linkage; report parity |
| Recovery (FR-7) | Recovery | Recovery | Read-only enforcement; totals match open items (S-4) |
| Reminders (FR-7) | Reminders | Reminder log, Settings | Double-tick test; dry-run test; window test (R-2) |
| Reports (FR-8) | Reporting | Reports | Cash-basis parity; void exclusion; print English-only |
| Audit (FR-9) | Audit, Identity | Audit Log | Append-only trigger test; Admin-only access test |

### 17.2 Success criteria → mechanism

| PRD S- | Criterion | Mechanism that makes it true |
|---|---|---|
| S-1 | Digitize a society in ~2 working days | Fast plot entry (create-and-next, duplicate a plot's metadata), polygons on a cached Konva canvas with keyboard shortcuts and autosave; a one-off import script may seed the initial list (not an MVP screen) |
| S-2 | Book in ≤10 minutes, without leaving the system | One wizard (buyers → plan → confirm), live plan preview from the shared function, PDFs available immediately on the booking page, no page reloads |
| S-3 | No plot is ever double-booked | Row lock + partial unique index + 409; §12.1 |
| S-4 | Recovery totals match the detail | Both from one query; KPI tiles are aggregates of the same result set; nightly check #8 |
| S-5 | No duplicate reminder is sent | Claim before send; unique constraint; §10.6 |
| S-6 | Reports match the Roznamcha | Reports read `cash_entry` only; no parallel totals; parity tests |
| S-7 | Role boundaries hold (no privilege leakage) | Capability table in one place; service-layer check on every command/query; parameterized role × command test; deep-link tests (§6.3) |

### 17.3 NFR traceability

| PRD §15 item | Where addressed |
|---|---|
| Performance targets | §15.1 |
| Security / role enforcement | §6, §15.2 |
| Auditability | §13 |
| Backup / recovery | §14.7 |
| Accessibility | §15.4, DESIGN §11 |
| Bilingual | §9 |
| Browser/device support | §15.6 |
| Availability expectation | §15.3 |
| Data retention | §13.3 (audit), §7.5 (files); Q-10 for business records |

---

## 18. Architecture decision records

Short form here; each becomes a file in `docs/adr/` with context, options, and consequences.

| ADR | Decision | Rationale (this project) | Rejected alternative |
|---|---|---|---|
| ADR-01 | Modular monolith, one deployable | ≤25 users, one team, one DB; modules give boundaries without distributed-systems cost | Microservices, event-driven, serverless |
| ADR-02 | TypeScript, Next.js (App Router), React | One language front and back, the largest hiring pool in Pakistan, built-in routing and server rendering, easy VPS deploy | Django (two languages), Laravel (PHP hosting is common but type safety weaker), separate SPA + API |
| ADR-03 | PostgreSQL 17 | Correct money type, partial unique indexes for the booking guard, `FOR UPDATE`, mature backup tooling, free | MySQL (weaker partial indexes), SQLite (single-writer, no row locks across processes) |
| ADR-04 | Prisma + hand-written SQL migrations | Type-safe CRUD for the 90% case; raw SQL where constraints/indexes need it; one migration history | Drizzle (younger), TypeORM (decorator churn), raw SQL everywhere |
| ADR-05 | DB-backed sessions | Revocable server-side, survives deploys, no extra service; 25 users is a trivial session table | JWT-only (cannot revoke), Redis sessions (extra service) |
| ADR-06 | Capability checks in the service layer | Every command and query passes one `requireCapability`; hiding UI is never the control | Route middleware only (misses service reuse), client-side role checks |
| ADR-07 | Partial unique index on plot bookings | Makes double-booking impossible at the storage layer, not just the service | Application `exists` check (racy), advisory locks only |
| ADR-08 | One shared payment-plan function | Client preview and server persistence cannot disagree; property tests cover rounding | Duplicated client/server math |
| ADR-09 | Money as `numeric(12,2)` + decimal strings | Matches PRD §13; no float coercion on the wire; readable SQL | Integer paisa, floats |
| ADR-10 | Claim table for reminder idempotency | The unique key is the guarantee; no queue infrastructure | Redis/BullMQ, pg-boss, "check then send" |
| ADR-11 | Dry-run default, provider adapter | PRD D-6; prevents accidental WhatsApp/SMS spend; allows launch without provider approval | Live-by-default, provider SDK coupled into the module |
| ADR-12 | `@react-pdf/renderer` for English PDFs | In-process, fast, no Chromium, good tables and page breaks for English | Playwright/Chromium (heavy), PDFKit (too low-level), client-side PDF |
| ADR-13 | PDFs generated on demand, never stored | Current data, no file lifecycle, no stale documents; §8.1 | Store every PDF, regenerate-on-download hybrid |
| ADR-14 | Renderer boundary kept swappable for a future Urdu PDF | Nastaliq/Naskh shaping is the one thing this renderer does poorly; isolate the risk without building for it | Build Chromium now (premature), ignore the risk |
| ADR-15 | All display text in client components | Language toggles instantly without a server round trip (PRD FR-2.4) | Server-render text + `router.refresh()` on toggle |
| ADR-16 | Noto Sans Arabic (Naskh), LTR layout, self-hosted | Legibility at 12–14 px, table density, no CDN dependency, correct bidi with `dir=auto` data | Nastaliq UI, RTL mirroring, Google Fonts |
| ADR-17 | Normalized polygon coordinates | Resolution-independent, survives image replacement, matches PRD §13 | Pixel coordinates |
| ADR-18 | One VPS + Compose | PRD A-11; simplest thing that works; no orchestration to maintain | Kubernetes, managed multi-service, multi-region |
| ADR-19 | Void-only financial corrections | Preserves history and report parity; matches the Roznamcha concept | In-place edits, hard deletes |
| ADR-20 | Polling, not WebSockets | Data changes rarely; polling is simpler and survives proxies; no real-time requirement | WebSockets/SSE |

---

## 19. Open questions

These need a client decision. Each has a proposed default so work is not blocked; the default is what the code will do until told otherwise.

| # | Question | Proposed default | Impact if changed |
|---|---|---|---|
| Q-1 | Can a confirmed booking's price or plan be edited? | Non-financial fields only; price/plan revision allowed only when no payment is posted, otherwise cancel and rebook | Ledger design, audit events, UI |
| Q-2 | Can a cash entry be edited, or only voided? | Void only; correction = void + repost with a reason | Report parity, audit trail |
| Q-3 | Is the down payment due on the booking date or a chosen date? | Optional due date; default booking date | Plan generation, reminders |
| Q-4 | Maximum installment count? | 120 | PDF page limits, edit performance |
| Q-5 | One cash book for the company, or one per project? | Company-wide | Cash entry schema, reports |
| Q-6 | How is the pre-go-live cash position entered? | One opening-balance entry, category nature `opening` | Cash Flow opening balance |
| Q-7 | Where are provider credentials stored? | Encrypted in DB, write-only in the UI (env override allowed) | Settings UX, ops |
| Q-8 | Are reminder messages English-only? | Yes (matches PRD D-6 scope) | Template catalogs |
| Q-9 | How is an offline refund recorded? | Manual Out entry with a "Refund" category, no payment link | Ledger semantics |
| Q-10 | Data retention and residency requirements? | Keep business records indefinitely; data stays on the PK VPS; no field-level encryption | Compliance, storage |
| Q-11 | How is SMS consent captured? | Manually by staff before go-live; recorded in buyer notes | Compliance, UI |
| Q-12 | What if a replacement master plan has a different aspect ratio? | Warn and require confirmation; existing polygons keep normalized coords and may shift | Map accuracy |
| Q-13 | Multiple photos per buyer? | One current photo; replacing overwrites the reference, the old file is cleaned up | Storage, UI |

**Decisions already taken without asking** (because the PRD answers them): LTR-only bilingual UI, English-only PDFs, at-most-once reminders in the unknown window, no overdue reminders, company-wide audit, single VPS, dry-run default.

---

## 20. Appendices

### Appendix A — Error and API conventions

- Errors are `{ "error": { "code": "BOOKING_PLOT_UNAVAILABLE", "message": "…", "requestId": "…", "fields": {…} } }`.
- `code` is stable and used by the UI to pick the localized message; `message` is an English fallback for logs, never shown verbatim in the Urdu UI.
- HTTP status: `400` validation, `401` unauthenticated, `403` capability denied, `404` not found, `409` conflict (stale write, plot taken, already voided), `422` domain rule, `429` rate limit, `500` unexpected.
- `fields` maps field name → error code for form display; the UI translates them via `errors.*` keys.
- Success responses return the resource plus its `version`. Commands return the affected ids so the client can refresh precisely.
- No stack traces, SQL, or provider errors in responses. They go to logs with the same `requestId`.

### Appendix B — Definition of done for a module

A module is complete when:

1. It owns its tables (or documents that another module owns them) and its schema is in `DATABASE.md`.
2. Its public surface is `index.ts` exposing `commands.ts`/`queries.ts` with Zod-validated input.
3. Every command checks a capability server-side, writes an audit row in the same transaction, and is covered by an integration test.
4. It has no import from another module's internals (`dependency-cruiser` clean).
5. Its user-facing text is in both catalogs and passes `i18n:check`.
6. Its list/empty/error/loading states match DESIGN §8 and §13.
7. It has at least one E2E path if it has a screen.
8. It appears in the traceability table (§17.1).
9. Its failure modes return the documented error codes.
10. The README section for developers explains any non-obvious invariant.

### Appendix C — Document conventions

- Money: `numeric(12,2)`, strings on the wire, `PKR` in copy. Examples use `1,250,000.00`.
- Dates: `DD-MMM-YYYY` in UI and examples; `DATE` for business dates, `timestamptz` for events.
- Identifiers: `booking_ref` is human-facing (`BK-1042`); internal ids are UUIDs and never shown.
- Section cross-references use `§N.M`; PRD and DESIGN references are explicit.
- "MUST"/"MUST NOT" mark rules that are enforced by a test, a constraint, or a lint rule; "should" marks review guidance.

### Appendix D — What would change at 10× scale

Recorded so future readers know the design was chosen, not accidental:

| At 10× (30k plots, 100k bookings, 2M due items, 50 users) | Change |
|---|---|
| Reads | Add read replicas or a materialized recovery view; keep the same write model |
| Reminders | Move to a real queue (pg-boss) and multiple workers; the claim table stays as the guard |
| Map | Tile or cluster polygons server-side; do not ship 30k shapes to the browser |
| Reports | Pre-aggregate nightly into a summary table, keeping `cash_entry` as the source of truth |
| Deploy | Managed Postgres with PITR; two app instances behind a load balancer; sessions already DB-backed |
| Not needed even then | Microservices, Kafka, multi-region, Kubernetes for 50 users |

---

*End of ARCHITECTURE.md.*
