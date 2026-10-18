# DATABASE.md — Society Plot Manager (SPM)

**Physical schema — single source of truth**

| | |
|---|---|
| **Document status** | v1.0 — implementation baseline. Defines every table, column, constraint and index. §11 records the few schema-level questions not settled by `PRD.md` or `ARCHITECTURE.md`. |
| **Date** | 2026-10-19 |
| **Target engine** | PostgreSQL 17 (`ARCHITECTURE.md` §3.1, ADR-03) |
| **Expressed as** | Prisma 6 schema for the 95% Prisma can model; hand-written SQL for partial indexes, `CHECK` constraints, trigger functions and the polygon function (§6) — per `ARCHITECTURE.md` §3.4 and §14.2 |
| **Sources of truth** | `PRD.md` v1.0 (behavior, data requirements §13) and `ARCHITECTURE.md` v1.0 (ownership in its §4.2, mechanisms in §10–§13, invariants in §12.8). If this document conflicts with either, they win; fix this document. |
| **Companion documents** | `ARCHITECTURE.md` (written), `RUNBOOK.md` (operations — next) |

**Reading guide:** §1 conventions; §2 which module owns what; §3 the tables, one subsection per module; §4 enums; §5 relationships; §6 the SQL Prisma cannot express; §7 indexes by access pattern; §8 roles/grants; §9 seed data; §10 migration sequencing; §11 open questions.

**Citations.** A bare `§n` refers to this document. Sections of other documents are always named: `PRD §13`, `ARCHITECTURE.md §10.6`.

**How to read a table spec.** Column tables give name, PostgreSQL type, nullability, default and notes. A trailing bullet list gives PK/FK/UQ/CK/IX. Anything marked **[SQL]** is created in the supplementary migration (§6), not by Prisma. Everything in §3.12 that is not in PRD §13 or `ARCHITECTURE.md` is called out and justified there.

**Out of scope for this document:** demo data, migration contents for future features, query code, and any behavior not already decided. Nothing here introduces a product decision.

---

## 0. At a glance

| | |
|---|---|
| Tables | **26** (25 domain tables + `app_setting`); `_prisma_migrations` is Prisma-managed and not part of the domain model |
| Enumerated types | **18** (§4) |
| Read-model modules with no tables | Recovery, Documents, Reporting (0 tables — they read other modules' tables; `ARCHITECTURE.md` §4.2) |
| SQL-only objects | 8 unique indexes (3 of them partial), 4 partial scan indexes, 48 `CHECK` constraints, 4 trigger functions driving 17 triggers, 1 validation function, 1 sequence (§6) |
| UUID primary keys | Every entity table; exceptions documented in §1.2 |
| Money columns | Always `numeric(12,2)`; never `float`, `real`, `double precision` or `money` |
| Write-once tables | `audit_log` (append-only trigger + grants), `cash_entry` and `payment` (column-scoped immutability trigger), `payment_allocation`, `plot_status_history`, `booking_note` (grants only) |

**The five constraints that carry the most weight** (each explained where it is defined):

| Constraint | Where | Protects |
|---|---|---|
| `one_active_booking_per_plot` (partial unique) | §6.1 | PRD S-3, `ARCHITECTURE.md` §12.1 |
| `reminder_claim (due_item_id, milestone)` unique | §3.7 | PRD S-5, `ARCHITECTURE.md` §10.6 |
| `ck_due_item_amount_paid` | §6.3 | Ledger integrity (`ARCHITECTURE.md` §12.8) |
| `trg_audit_log_append_only` | §6.4 | `ARCHITECTURE.md` §13.3 |
| `spm_app` has no `DELETE` on financial tables | §8 | `ARCHITECTURE.md` §12.8, §14.6 |

---

## 1. Conventions

### 1.1 Naming

| Rule | Example |
|---|---|
| Tables and columns are `snake_case`, **singular** | `plot`, `due_item`, `booking_buyer` |
| Prisma models are `PascalCase` with explicit `@@map` | `model Plot { … @@map("plot") }` |
| Foreign keys are `<entity>_id` | `plot_id`, `primary_buyer_id`, `linked_payment_id` |
| Boolean columns read as assertions | `is_active`, `is_live`, `is_primary`, `consent_sms` |
| Constraint/index prefixes | `pk_` `fk_` `uq_` `ck_` `ix_` `trg_`; SQL-only objects use the same scheme |
| Functions that exist only for constraints | `spm_` prefix, e.g. `spm_polygon_ok()` |
| Enum type names | `<entity>_<concept>` — `plot_status`, `booking_status`, `payment_method` |
| Enum values | UPPER_SNAKE — `BOOKED_TOKEN`, `PARTIALLY_PAID`, `BANK_TRANSFER` |

`user` is a reserved word in PostgreSQL; the table is `app_user` (Prisma model `User`). This is the only departure from the PRD's entity name.

### 1.2 Identifier strategy

- **Every entity table has a `uuid` primary key**, default `gen_random_uuid()` (built into PostgreSQL 13+; no `pgcrypto` extension needed). IDs are opaque, generated server-side, never derived from business data, never reused.
- UUIDv4 is the baseline. UUIDv7 — better index locality — arrives as a native `uuidv7()` in PostgreSQL 18; swapping the default is a one-line migration and does not change any column type (`ARCHITECTURE.md` §3.1 allows PG 18 on the host image).
- **Three documented exceptions**, all keyed/lookup tables rather than entities:

| Table | Key | Why |
|---|---|---|
| `audit_log` | `bigserial` | Fixed by `ARCHITECTURE.md` §13.2; append-only, high-volume, and `(occurred_at DESC, id DESC)` pagination wants a monotonic tiebreaker (DQ-9) |
| `app_setting` | `key text` | A settings dictionary; the key *is* the identity |
| `login_throttle` | `email text` | One counter per account; a surrogate key would add nothing |

- **No composite primary keys** except the join table `booking_buyer (booking_id, buyer_id)`, where the pair is the natural identity.
- **Every foreign key used for filtering, joining or a parent-side delete has an index.** PostgreSQL does not create one automatically. The deliberate exceptions are columns that only identify an actor or a file on a detail view — `*.voided_by`, `booking.cancelled_by`, `*.updated_by`, `file_object.uploaded_by`, `company.logo_file_id`, `project.master_plan_file_id`, `buyer.photo_file_id`, `booking_note.author_user_id`, `plot_status_history.actor_user_id`, `reminder_log.claim_id`. None is ever a predicate, and indexing them would add write cost for no read (§7.3).
- `booking_ref` (`BK-1042`) is a **business key**, not a primary key (`ARCHITECTURE.md` Appendix C). It is unique, human-facing and appears in URLs and PDF filenames.

### 1.3 Timestamps and dates

`ARCHITECTURE.md` §12.7 is the rule; this is its physical form.

| Kind | Type | Notes |
|---|---|---|
| Row lifecycle | `timestamptz not null default now()` | `created_at`, `updated_at` |
| Events (login, send attempt, status change, audit) | `timestamptz` | Stored UTC, rendered PKT by `core/datetime` |
| Business dates (due date, cash entry date, booking date, report range) | `date` | No time, no timezone. "Today" is computed in `Asia/Karachi` by the application |

- **`timestamp` without time zone is never used.**
- **No `DEFAULT CURRENT_DATE` on business-date columns.** Containers run UTC (`ARCHITECTURE.md` §12.7); a server-side default would silently be a day behind between 00:00 and 05:00 PKT. The application supplies the PKT date explicitly, which also makes the value testable.
- `updated_at` is maintained two ways, deliberately: Prisma's `@updatedAt` and a `BEFORE UPDATE` trigger `trg_set_updated_at` (§6.5). The trigger is what makes hand-written SQL paths honest.

### 1.4 Money and quantities

| Concept | Type | Rule |
|---|---|---|
| Money | `numeric(12,2)` | PKR only. Prisma `Decimal @db.Decimal(12,2)`; JSON carries decimal strings (`ARCHITECTURE.md` §12.6) |
| Areas and dimensions | `numeric(10,2)` | Marla, feet |
| Percentages | `numeric(5,2)` | `0 < share_pct <= 100` |
| **Forbidden** | `float4`, `float8`, `real`, `double precision`, `money` | No floating-point money ever reaches a column |

Arithmetic, rounding and formatting live in `core/money` (`ARCHITECTURE.md` §12.6); the database stores exact decimals and enforces sign constraints.

**Suffix rule.** A money column that could be misread carries `_pkr` (`price_pkr`, `sale_price_pkr`); a column whose table and context make the currency unambiguous does not (`amount`, `amount_paid`, `balance_amount`). PKR is the only currency in the schema either way (§1.4's type is the second guard).

### 1.5 Enumerated types: enum vs `text` + `CHECK`

**Rule:** use a native PostgreSQL enum (declared as a Prisma `enum`) when the value set is a **closed business vocabulary** that the UI, the state machine, and the reports all branch on — roles, statuses, directions, channels, kinds, natures, frequencies. Use **`text` + `CHECK (col IN (…))`** when the value is a **machine code expected to grow** without a domain-model change — currently `reminder_log.reason`, `audit_log.action_code`, `audit_log.entity_type` and `job_run.job_name`.

Consequences, accepted:

- Adding an enum value is `ALTER TYPE … ADD VALUE`, which is additive, fast, and allowed inside a transaction in PostgreSQL 12+ **provided the new value is not used in that same transaction**.
- **Enum values are never removed or renamed.** That requires a new type, a column rewrite and a backfill; it is not worth it at this scale. Deprecated values stay in the type and are rejected by the service layer.
- Prisma diffs enums cleanly, so the migration history stays readable.

### 1.6 Deletion and retention policy

`ARCHITECTURE.md` §12.8 forbids hard deletes of financial rows; PRD §13 allows logical deletes only for catalog data. Per entity:

| Module | Table | Policy | Mechanism |
|---|---|---|---|
| Identity | `app_user` | **Deactivate only** — attribution on past transactions survives | `is_active = false` |
| Identity | `session` | Hard delete once expired or revoked | Nightly job |
| Identity | `login_throttle` | Hard delete when the counter is clear or the lock expires | Service |
| Setup | `company` | Singleton; never deleted | — |
| Setup | `project` | **Deactivate only**; history and FK targets survive | `is_active = false` |
| Setup | `block` | Hard delete allowed **only when it contains no plots** | Service check + `ON DELETE RESTRICT` |
| Setup | `app_setting` | Obsolete keys may be deleted | — |
| Inventory | `plot` | **Deactivate once referenced by any booking or status history**; an unreferenced plot may be hard-deleted | `is_active = false` |
| Inventory | `plot_status_history` | Append-only | — |
| Sales | `buyer` | Never deleted (referenced by `booking_buyer`) | — |
| Sales | `booking` | Never deleted; cancellation is a status | `status = 'CANCELLED'` |
| Sales | `payment_plan` | Never deleted; revised in place only while Q-1 permits | — |
| Sales | `booking_buyer` | Replaceable **only** inside the booking-edit command permitted by Q-1; audited | Service |
| Sales | `booking_note` | Append-only (see DQ-7) | — |
| Sales | `due_item` | Never deleted; `amount_paid` and `status` are the only mutable columns | — |
| Ledger | `payment` | **Void only** | `status = 'VOIDED'` |
| Ledger | `payment_allocation` | Never deleted, not even on void — a voided payment's allocations stay as history and are excluded by payment status (`ARCHITECTURE.md` §12.9 check 1) | — |
| Cashbook | `cash_entry` | **Void only** (PRD US-5.3) | `status = 'VOIDED'` |
| Cashbook | `cash_category` | **Deactivate only**; a category in use is never removed | `is_active = false` |
| Reminders | `reminder_template`, `provider_config` | Upserted in place; the audit log holds the history | — |
| Reminders | `reminder_claim` | Never deleted | — |
| Reminders | `reminder_log` | Retained (retention is DQ-5) | — |
| Audit | `audit_log` | **Append-only**, life of the system | Trigger + grants |
| Core | `file_object` | Soft delete via `deleted_at`; the GC job hard-deletes the row and the object only when no live reference remains | `deleted_at` |
| Core | `job_run` | Pruned by retention (DQ-6) | Nightly job |

### 1.7 Optimistic locking

`ARCHITECTURE.md` §12.4.

- Exactly four tables carry `version integer not null default 0`: **`plot`, `booking`, `buyer`, `project`**.
- The update is a compare-and-swap: `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2`. Zero rows affected → `409 CONFLICT_STALE_WRITE`.
- **No trigger increments `version`.** A trigger would run after the `WHERE` clause and silently defeat the check.
- Every other table uses an explicit state machine (`VOIDED`, `CANCELLED`, claim status) instead of a version. Those transitions are guarded by preconditions and audited.

### 1.8 What Prisma owns, and what it does not

| Prisma owns (declared in `schema.prisma`) | Hand-written SQL owns (§6) |
|---|---|
| Tables, columns, types, nullability, defaults | Partial unique indexes (`… WHERE …`) |
| Primary keys, foreign keys, `ON DELETE` behavior | `CHECK` constraints (Prisma has no syntax for them) |
| Single-column and composite `UNIQUE` | Immutability and append-only triggers |
| Simple btree indexes, enum types | The `updated_at` trigger and its function |
| `@updatedAt`, `@default(now())`, `@default(uuid())` | `spm_polygon_ok()` validation function |
| | The `booking_ref` sequence and column default |
| | The `company` singleton index |

**Rule:** any object that Prisma cannot express lives in its **own migration** and is never edited once applied. If `prisma migrate dev` proposes dropping a hand-written object, the generated migration is edited to remove that statement — it is a Prisma limitation, not a schema change (§10.3).

### 1.9 Types Prisma cannot express

One column type needs a concession:

| PostgreSQL | Prisma | Concession |
|---|---|---|
| `inet` | `varchar(45)` | `audit_log.ip` and `session.ip` store the textual address (`ARCHITECTURE.md` §13.2 says `inet`). Prisma cannot write `inet` through its typed client, so the column is `varchar(45)` with `ck_*_ip_format` checking it parses as IPv4/IPv6. Semantics preserved; no application change (DQ-10). |

Everything else maps one-to-one: `uuid` → `String @db.Uuid`, `timestamptz` → `DateTime @db.Timestamptz(3)`, `date` → `DateTime @db.Date`, `numeric` → `Decimal`, `jsonb` → `Json`, `bytea` → `Bytes`, `smallint` → `Int @db.SmallInt`, `bigserial` → `BigInt @default(autoincrement())`, `char(n)` → `String @db.Char(n)`.

---

## 2. Module → table ownership

Mirrors `ARCHITECTURE.md` §4.2 exactly. **One table has exactly one owning module** (§2.4 rule 8). Other modules may read it through the owner's public query functions, and the database's foreign keys connect them freely — but only the owner writes.

| Module | Tables | Count |
|---|---|---|
| **Identity** | `app_user`, `session`, `login_throttle` | 3 |
| **Setup** | `company`, `project`, `block`, `app_setting` | 4 |
| **Inventory** | `plot`, `plot_status_history` | 2 |
| **Sales** | `buyer`, `booking`, `payment_plan`, `booking_buyer`, `booking_note`, `due_item` | 6 |
| **Ledger** | `payment`, `payment_allocation` | 2 |
| **Cashbook** | `cash_category`, `cash_entry` | 2 |
| **Recovery** | — (read model) | 0 |
| **Reminders** | `reminder_template`, `provider_config`, `reminder_claim`, `reminder_log` | 4 |
| **Documents** | — (stateless) | 0 |
| **Reporting** | — (read model) | 0 |
| **Audit** | `audit_log` | 1 |
| **Core** | `file_object`, `job_run` | 2 |
| **Total** | | **26** |

**Notes that matter for schema review:**

- **Cross-module foreign keys are normal and correct.** `booking.plot_id → plot.id` (Sales → Inventory) is a data relationship, not a code dependency. Sales may read plot rows; it may only *write* them through `inventory.changePlotStatus(tx, …)` (`ARCHITECTURE.md` §4.4). The dependency graph in `ARCHITECTURE.md` §4.3 constrains **code imports**, not referential integrity.
- **Recovery, Documents and Reporting create no tables.** Recovery reads `due_item`/`booking`/`buyer`/`plot`; Reporting reads `cash_entry`/`cash_category`/`payment`; Documents reads at request time and stores nothing (`ARCHITECTURE.md` §8.1, ADR-13). Their SQL lives in `modules/*/sql/` and is read-only (§4.5).
- **`file_object` is Core-owned**, not Inventory- or Sales-owned. Inventory and Sales hold a reference column; the storage metadata is Core's (`ARCHITECTURE.md` §7.2, §4.2).
- **`app_setting` was named in `ARCHITECTURE.md` §4.2** but is absent from the table list in the brief. It is included because Setup owns it; it holds only cross-cutting scalars, never domain data that belongs in a typed column.

---

## 3. Tables by module

Every table below states its purpose, its columns, its keys/constraints, and the invariant it enforces. `ARCHITECTURE.md` section numbers are referenced rather than re-explained.

### 3.1 Identity

Owns staff accounts, sessions and the login throttle (`ARCHITECTURE.md` §5.1, §6.1). Never contains buyer or customer records.

#### `app_user`

**Purpose:** a staff account. The login identity and the audit actor.
**Enforces:** one role per user; unique email; users are never deleted (`ARCHITECTURE.md` §5.1).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | Display name, shown in the audit log and headers |
| `email` | `text` | no | — | Login identifier, **stored lowercase** (CHECK enforces) |
| `phone` | `text` | yes | — | Optional staff contact; not the buyer phone format rule |
| `role` | `user_role` | no | — | `ADMIN` / `SALES_AGENT` / `ACCOUNTANT`; exactly one |
| `password_hash` | `text` | no | — | Argon2id PHC string. Never logged, never returned |
| `is_active` | `boolean` | no | `true` | Deactivation replaces deletion |
| `must_change_password` | `boolean` | no | `false` | Set by the Admin password reset (`ARCHITECTURE.md` §6.1) |
| `preferred_language` | `preferred_language` | no | `'EN'` | Persisted by the language toggle (PRD FR-2.4) |
| `last_login_at` | `timestamptz` | yes | — | Informational |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger-maintained (§6.5) |

- **PK:** `id`
- **UQ:** `uq_app_user_email` on `email` (stored lowercase, so a plain unique index suffices)
- **CK [SQL]:** `ck_app_user_email_lower` — `email = lower(email)`
- **IX:** `ix_app_user_role_active` on `(role, is_active)` — user list and the "at least one active Admin" check
- **Never deleted.** `booking.created_by`, `payment.recorded_by`, `audit_log.actor_user_id` all point here.

#### `session`

**Purpose:** a live login session. Server-side, revocable (`ARCHITECTURE.md` §6.1).
**Enforces:** immediate revocation on logout, password reset, deactivation and role change.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `app_user.id` |
| `token_hash` | `char(64)` | no | — | SHA-256 hex of the opaque cookie token; the raw token is never stored |
| `created_at` | `timestamptz` | no | `now()` | |
| `last_seen_at` | `timestamptz` | no | `now()` | Slides the idle window |
| `idle_expires_at` | `timestamptz` | no | — | `last_seen_at + 30 min` |
| `absolute_expires_at` | `timestamptz` | no | — | `created_at + 12 h`; never extended |
| `revoked_at` | `timestamptz` | yes | — | Set on logout, password reset, deactivation, role change |
| `ip` | `varchar(45)` | yes | — | Textual address (§1.9); 45 chars fits IPv6 |
| `user_agent` | `text` | yes | — | Truncated to 512 chars by the service |

- **PK:** `id`
- **FK:** `user_id → app_user.id ON DELETE RESTRICT`
- **UQ:** `uq_session_token_hash` on `token_hash` (the lookup key on every request)
- **CK [SQL]:** `ck_session_expiry_order` — `absolute_expires_at > created_at`; `ck_session_ip_format`
- **IX:** `ix_session_user_id` on `(user_id)`; `ix_session_expiry` on `(idle_expires_at, absolute_expires_at)` for the nightly cleanup
- **Hard-deleted** when expired or revoked (§1.6); the audit row records the revocation, not the session row.

#### `login_throttle`

**Purpose:** per-account failed-login counter and lockout, surviving restarts (`ARCHITECTURE.md` §6.1, §6.4). Per-IP limiting happens at Nginx and is not modelled here.
**Enforces:** credential-stuffing resistance without leaking account existence.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `email` | `text` | no | — | PK; lowercased. An unknown email still gets a row, so timing/behavior is uniform |
| `failed_count` | `smallint` | no | `0` | Reset on success and on expiry |
| `first_failed_at` | `timestamptz` | yes | — | Start of the current window |
| `last_failed_at` | `timestamptz` | yes | — | Drives the backoff |
| `locked_until` | `timestamptz` | yes | — | Non-null and in the future blocks login |

- **PK:** `email` (natural key, §1.2)
- **CK [SQL]:** `ck_login_throttle_count` — `failed_count >= 0`
- **IX:** `ix_login_throttle_locked_until` on `(locked_until)` for cleanup
- **Hard-deleted** when clear (§1.6). Contains no password material.

### 3.2 Setup

Company profile, projects, blocks and cross-cutting settings (`ARCHITECTURE.md` §5.2).

#### `company`

**Purpose:** the single company whose letterhead appears on PDFs. **Singleton** (PRD §1.3, single tenant).
**Enforces:** exactly one company row.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | Printed on the allotment letter |
| `logo_file_id` | `uuid` | yes | — | FK → `file_object.id`, kind `COMPANY_LOGO` |
| `address` | `text` | yes | — | Free text, printed as-is |
| `phone` | `text` | yes | — | Display only |
| `email` | `text` | yes | — | Display only; the system never sends email (`ARCHITECTURE.md` §1.4) |
| `pdf_terms_text` | `text` | yes | — | Plain text with paragraph breaks; rendered as text nodes (`ARCHITECTURE.md` §8.4) |
| `marla_sqft` | `numeric(10,2)` | no | `225.00` | D-1 default; a project may override |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** `logo_file_id → file_object.id ON DELETE SET NULL`
- **CK [SQL]:** `ck_company_marla` — `marla_sqft > 0`
- **UQ [SQL]:** `uq_company_singleton` — `CREATE UNIQUE INDEX uq_company_singleton ON company ((true))` (§6.2). One row, enforced by the database, not by hope.
- **Never deleted.** No `project_id`: the company is the tenant.

#### `project`

**Purpose:** a society project and its master plan. MVP validates one active project but the schema allows many (PRD §1.3, A-2).
**Enforces:** optimistic concurrency; master-plan dimensions stored with the image (R-8).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `company_id` | `uuid` | no | — | FK → `company.id` |
| `name` | `text` | no | — | e.g. "Green City Phase 1" |
| `location` | `text` | yes | — | Display only |
| `marla_sqft` | `numeric(10,2)` | yes | — | Overrides `company.marla_sqft` when present (PRD D-1) |
| `master_plan_file_id` | `uuid` | yes | — | FK → `file_object.id`, kind `MASTER_PLAN`; the display variant is resolved by the service |
| `master_plan_width_px` | `integer` | yes | — | Stored with the image so normalized polygons can be rendered and the aspect ratio compared (R-8, Q-12) |
| `master_plan_height_px` | `integer` | yes | — | As above |
| `master_plan_uploaded_at` | `timestamptz` | yes | — | Replaced master plans are audited |
| `is_active` | `boolean` | no | `true` | Deactivation preserves history |
| `version` | `integer` | no | `0` | Optimistic lock (§1.7) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `company_id → company.id ON DELETE RESTRICT`, `master_plan_file_id → file_object.id ON DELETE SET NULL`
- **UQ:** `uq_project_company_name` on `(company_id, name)`
- **CK [SQL]:** `ck_project_marla` — `marla_sqft IS NULL OR marla_sqft > 0`; `ck_project_plan_dims` — both dimensions null or both positive
- **IX:** `ix_project_company_active` on `(company_id, is_active)`
- **Never hard-deleted** (§1.6).

#### `block`

**Purpose:** a named subdivision inside a project ("Block A").
**Enforces:** a block cannot be deleted while it contains plots (PRD US-1.2).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `project_id` | `uuid` | no | — | FK → `project.id` |
| `code` | `text` | no | — | Short code, e.g. `A`; unique within the project |
| `name` | `text` | no | — | Display name, e.g. "Block A" |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `project_id → project.id ON DELETE RESTRICT`
- **UQ:** `uq_block_project_code` on `(project_id, code)`
- **IX:** `ix_block_project_id` on `(project_id)`
- **Deletion:** allowed only when no `plot` references it. The FK from `plot.block_id` is `ON DELETE RESTRICT`, so the database refuses even if the service check is bypassed. This is the "restricting foreign key" of `ARCHITECTURE.md` §5.2.

#### `app_setting`

**Purpose:** cross-cutting operational scalars that are not owned by a domain row and must change without a deploy.
**Enforces:** nothing domain-specific; deliberately narrow.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `key` | `text` | no | — | PK, e.g. `reminders.batch_size` |
| `value` | `jsonb` | no | — | Typed and validated by `core/config` at read time |
| `description` | `text` | yes | — | For operators |
| `updated_at` | `timestamptz` | no | `now()` | Trigger-maintained |
| `updated_by` | `uuid` | yes | — | FK → `app_user.id`; null for system writes |

- **PK:** `key`
- **FK:** `updated_by → app_user.id ON DELETE SET NULL`
- **Rule:** **no domain data here.** Marla conversion lives on `company`/`project`; reminder templates and channels live in the Reminders tables; categories live in `cash_category`. This table is for operational scalars only. Writing a business rule into it would bypass the typed schema.

### 3.3 Inventory

Master plan reference, plot records, polygons and status history (`ARCHITECTURE.md` §5.3).

#### `plot`

**Purpose:** one sellable plot: identity, metadata, price, status and its polygon.
**Enforces:** unique plot number per project; valid polygon; status is a stored state machine; optimistic concurrency.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `project_id` | `uuid` | no | — | FK → `project.id`; redundant with `block.project_id` but required by the unique rule and the map query |
| `block_id` | `uuid` | no | — | FK → `block.id` |
| `plot_number` | `text` | no | — | Normalized (trimmed, upper-case); unique per project, independent of block (PRD US-2.3) |
| `plot_type` | `plot_type` | no | `'RESIDENTIAL'` | `RESIDENTIAL` / `COMMERCIAL` |
| `size_marla` | `numeric(10,2)` | no | — | Stored in Marla; sq ft is derived at render time |
| `width_ft` | `numeric(10,2)` | yes | — | Printable dimension |
| `depth_ft` | `numeric(10,2)` | yes | — | Printable dimension |
| `dimensions_text` | `text` | yes | — | Display override (DQ-1) |
| `price_pkr` | `numeric(12,2)` | no | — | Listed price; the negotiated price is captured on the booking |
| `status` | `plot_status` | no | `'AVAILABLE'` | State machine of PRD §16 / `ARCHITECTURE.md` §5.3 |
| `polygon` | `jsonb` | yes | — | `[[x,y], …]` normalized to `[0,1]` (`ARCHITECTURE.md` §3.4, ADR-17). Nullable: a plot can exist before it is drawn |
| `notes` | `text` | yes | — | Free text |
| `is_active` | `boolean` | no | `true` | Retire without deleting (§1.6) |
| `version` | `integer` | no | `0` | Optimistic lock (§1.7) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** `project_id → project.id ON DELETE RESTRICT`; `block_id → block.id ON DELETE RESTRICT`
- **UQ:** `uq_plot_project_number` on `(project_id, plot_number)` — also the lookup for "plot number must be unique within a project"
- **CK [SQL]:** `ck_plot_size` — `size_marla > 0`; `ck_plot_dims` — width/depth null or positive; `ck_plot_price` — `price_pkr >= 0`; `ck_plot_polygon` — `polygon IS NULL OR spm_polygon_ok(polygon)` (§6.6)
- **IX:** `ix_plot_project_status` on `(project_id, status)` — plot list and map filtering; `ix_plot_block` on `(block_id)`; `ix_plot_project_active` on `(project_id, is_active)`
- **Called by:** Sales locks this row on booking (`SELECT … FOR UPDATE`, `ARCHITECTURE.md` §12.1) and updates it through `inventory.changePlotStatus(tx, …)`.

#### `plot_status_history`

**Purpose:** every status transition, visible to all roles (PRD FR-3.4).
**Enforces:** no silent status change; the audit log is the Admin-only parallel record.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `plot_id` | `uuid` | no | — | FK → `plot.id` |
| `from_status` | `plot_status` | yes | — | Null on the initial creation row |
| `to_status` | `plot_status` | no | — | |
| `reason` | `text` | yes | — | Required by the service for Reserve, Release and cancel |
| `actor_user_id` | `uuid` | yes | — | FK → `app_user.id`; null for system actions |
| `occurred_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `plot_id → plot.id ON DELETE RESTRICT`, `actor_user_id → app_user.id ON DELETE RESTRICT`
- **CK [SQL]:** `ck_plot_history_transition` — `from_status IS DISTINCT FROM to_status` (a no-op transition is a bug)
- **IX:** `ix_plot_status_history_plot` on `(plot_id, occurred_at DESC)` — the Plot Details timeline
- **Append-only.** No update or delete path; a correction is a new row.

### 3.4 Sales

Buyers, bookings, joint ownership, the plan snapshot, notes and due items (`ARCHITECTURE.md` §5.4). This is the module that owns consent (§12.8).

#### `buyer`

**Purpose:** a person who can own one or many plots. One row per CNIC, reused across bookings (PRD A-12).
**Enforces:** unique normalized CNIC; consent is Sales-owned and audited (`ARCHITECTURE.md` §12.8); optimistic concurrency.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `full_name` | `text` | no | — | As printed on documents |
| `father_or_husband_name` | `text` | yes | — | Optional (PRD D-4); printed when present |
| `cnic` | `char(15)` | no | — | **Normalized** `NNNNN-NNNNNNN-N`, unique. Format CHECK in §6.3 |
| `phone` | `varchar(16)` | no | — | **E.164**, e.g. `+923001234567` (`ARCHITECTURE.md` §5.4). Displayed in local format by `core/datetime` |
| `address` | `text` | yes | — | Optional (PRD D-4) |
| `photo_file_id` | `uuid` | yes | — | FK → `file_object.id`. One current photo (Q-13) |
| `consent_sms` | `boolean` | no | `false` | **SMS/WhatsApp reminder consent** (PRD US-3.2, FR-4.2; ARCHITECTURE §10.5, §12.8, Q-11). Defaults to false: no consent, no message |
| `consent_recorded_at` | `timestamptz` | yes | — | When the consent decision was recorded (DQ-2). Null until first captured |
| `version` | `integer` | no | `0` | Optimistic lock (§1.7) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |
| `created_by` | `uuid` | no | — | FK → `app_user.id`; every buyer is created by a staff user |

- **PK:** `id`
- **FK:** `photo_file_id → file_object.id ON DELETE SET NULL`; `created_by → app_user.id ON DELETE RESTRICT`
- **UQ:** `uq_buyer_cnic` on `(cnic)` — "unique index on normalized CNIC" (`ARCHITECTURE.md` §12.8)
- **CK [SQL]:** `ck_buyer_cnic_format` — `cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'`; `ck_buyer_phone_e164` — `phone ~ '^\+[1-9][0-9]{7,14}$'` (general E.164, DQ-14); `ck_buyer_consent_pair` — `consent_sms = false OR consent_recorded_at IS NOT NULL` (a `true` flag must carry a timestamp; a recorded *refusal* is `false` **with** a timestamp, which is different from "not yet asked")
- **Phone format is global E.164, not Pakistani-only** (DQ-14); SMS deliverability to a non-Pakistani number is a provider/reminders-layer concern recorded in the free-text `reminder_log.reason`, never a schema-level rejection of the buyer.
- **IX:** `ix_buyer_phone` on `(phone)` — the recovery list and the reminder recipient lookup
- **The Sales module owns consent writes.** Admin or Accountant may invoke the command (PRD FR-4.2); Reminders only reads `consent_sms` at claim time and never updates it (`ARCHITECTURE.md` §12.8). Each change writes an `audit_log` row in the same transaction.

#### `booking`

**Purpose:** the commercial event: one plot, one price, one plan, one status.
**Enforces:** one `CONFIRMED` booking per plot (partial unique, §6.1); idempotent submission; optimistic concurrency.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `booking_ref` | `text` | no | `'BK-' \|\| nextval` | Human-facing business key (`BK-1001`). Sequence and default in §6.6 |
| `plot_id` | `uuid` | no | — | FK → `plot.id` |
| `booking_date` | `date` | no | — | PKT calendar date supplied by the service (§1.3) |
| `status` | `booking_status` | no | `'CONFIRMED'` | `CONFIRMED` / `CANCELLED` |
| `sale_price_pkr` | `numeric(12,2)` | no | — | Negotiated price captured at booking (PRD D-7) |
| `primary_buyer_id` | `uuid` | no | — | FK → `buyer.id`. Denormalized per PRD §13; must agree with `booking_buyer.is_primary` (the service writes both; nightly check 4 proves there is exactly one primary) |
| `created_by` | `uuid` | no | — | FK → `app_user.id`, the agent |
| `client_request_id` | `uuid` | no | — | Idempotency key generated when the wizard opens (`ARCHITECTURE.md` §12.5). Service generates one if the client omits it |
| `cancel_reason` | `text` | yes | — | Required when `status = 'CANCELLED'` |
| `cancelled_at` | `timestamptz` | yes | — | |
| `cancelled_by` | `uuid` | yes | — | FK → `app_user.id` (Admin only) |
| `version` | `integer` | no | `0` | Optimistic lock (§1.7) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** `plot_id → plot.id ON DELETE RESTRICT`; `primary_buyer_id → buyer.id ON DELETE RESTRICT`; `created_by`, `cancelled_by → app_user.id ON DELETE RESTRICT`
- **UQ:** `uq_booking_ref` on `(booking_ref)`; `uq_booking_idempotency` on `(created_by, client_request_id)` **[SQL]** (§6.2)
- **UQ [SQL]:** `one_active_booking_per_plot` — `UNIQUE (plot_id) WHERE status = 'CONFIRMED'` (§6.1). **The core guarantee of PRD S-3.**
- **CK [SQL]:** `ck_booking_price` — `sale_price_pkr > 0`; `ck_booking_cancel_fields` — `(status = 'CANCELLED') = (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)`
- **IX:** `ix_booking_plot` on `(plot_id)`; `ix_booking_status_date` on `(status, booking_date DESC)`; `ix_booking_created_by` on `(created_by, created_at DESC)`; `ix_booking_primary_buyer` on `(primary_buyer_id)`
- **Why `primary_buyer_id` exists as well as `booking_buyer.is_primary`:** PRD §13 lists both. Both are written in the same transaction; nightly check 4 verifies they agree. Removing either would contradict the PRD.

#### `payment_plan`

**Purpose:** the snapshot of the plan parameters agreed at booking (`ARCHITECTURE.md` §5.4 "the plan is a snapshot"). One per booking; rewritten in place only in the zero-payment edit window Q-1 allows.
**Enforces:** plan arithmetic bounds (`ARCHITECTURE.md` §12.6, Q-4).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `booking_id` | `uuid` | no | — | FK → `booking.id`; **unique** (1:1) |
| `token_amount` | `numeric(12,2)` | no | — | ≥ 0 |
| `down_payment_amount` | `numeric(12,2)` | no | — | ≥ 0 |
| `down_payment_due_date` | `date` | no | — | Resolved at creation; defaults to the booking date (Q-3) |
| `balance_amount` | `numeric(12,2)` | no | — | Snapshot of `sale_price − token − down payment`; > 0 |
| `installment_count` | `smallint` | no | — | **1 … 120** (Q-4) |
| `installment_base_amount` | `numeric(12,2)` | no | — | `round2(balance / count)`; the final installment absorbs the remainder (PRD A-8) |
| `frequency` | `installment_frequency` | no | — | `MONTHLY` / `QUARTERLY` |
| `first_due_date` | `date` | no | — | First installment date |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger-maintained (§6.5); Q-1 rewrites update it |

- **PK:** `id`; **FK:** `booking_id → booking.id ON DELETE RESTRICT`
- **UQ:** `uq_payment_plan_booking` on `(booking_id)`
- **CK [SQL]:** `ck_plan_amounts` — `token_amount >= 0 AND down_payment_amount >= 0 AND balance_amount > 0 AND installment_base_amount > 0`; `ck_plan_installments` — `installment_count BETWEEN 1 AND 120`
- **No `sum(due items) = sale_price` check here:** that is a cross-row invariant, enforced by the service and property tests (`ARCHITECTURE.md` §12.6), not by a column constraint.
- **Mapping note:** PRD §13 places the plan snapshot fields on Booking; `ARCHITECTURE.md` §4.2 names a `payment_plan` table. Both are satisfied: `booking.sale_price_pkr` stays on the booking, the plan parameters live here 1:1. No field is lost and no product behavior changes.

#### `booking_buyer`

**Purpose:** joint ownership — which buyers own what share of a booking (PRD BR-5).
**Enforces:** exactly one primary buyer per booking (partial unique, §6.1).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | `uuid` | no | — | FK → `booking.id` |
| `buyer_id` | `uuid` | no | — | FK → `buyer.id` |
| `share_pct` | `numeric(5,2)` | no | — | `0 < share_pct <= 100`; the total must be exactly 100 |
| `is_primary` | `boolean` | no | `false` | The reminder recipient (PRD D-5) |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `(booking_id, buyer_id)` — the natural identity of the link
- **FK:** both columns `ON DELETE RESTRICT`
- **UQ [SQL]:** `one_primary_buyer_per_booking` — `UNIQUE (booking_id) WHERE is_primary` (§6.1)
- **CK [SQL]:** `ck_booking_buyer_share` — `share_pct > 0 AND share_pct <= 100`
- **IX:** `ix_booking_buyer_buyer` on `(buyer_id)` — the buyer detail page lists all bookings for a buyer
- **The 100% total is not a column CHECK.** It is cross-row: enforced in the booking command and verified by nightly check 4 (`ARCHITECTURE.md` §12.8, §12.9). A trigger would make legitimate multi-row edits fragile for no gain at this scale.

#### `booking_note`

**Purpose:** free-text staff notes on a booking (PRD US-3.2, ARCHITECTURE §5.4 "Add booking notes").
**Enforces:** attribution; append-only (DQ-7).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `booking_id` | `uuid` | no | — | FK → `booking.id` |
| `author_user_id` | `uuid` | no | — | FK → `app_user.id` |
| `body` | `text` | no | — | Plain text, rendered as text (never HTML) with automatic direction (`ARCHITECTURE.md` §9.7) |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `booking_id → booking.id ON DELETE RESTRICT`, `author_user_id → app_user.id ON DELETE RESTRICT`
- **CK [SQL]:** `ck_booking_note_body` — `length(btrim(body)) > 0`
- **IX:** `ix_booking_note_booking` on `(booking_id, created_at DESC)`
- **No edit or delete path** in the MVP (see DQ-7). Notes are not financial records, but an editable note is an unaudited change; append-only is the smaller surface.

#### `due_item`

**Purpose:** one payable line — the token, the down payment, or an installment. Drives the ledger and the reminders.
**Enforces:** positive amounts; the paid/status agreement; the claim key that reminders depend on.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `booking_id` | `uuid` | no | — | FK → `booking.id` |
| `kind` | `due_item_kind` | no | — | `TOKEN` / `DOWN_PAYMENT` / `INSTALLMENT` |
| `sequence` | `smallint` | no | — | 0 = token, 1 = down payment, 2+ = installments. Unique per booking |
| `label` | `text` | no | — | Display/PDF label: "Token", "Down Payment", "Installment 3" (PRD §13) |
| `due_date` | `date` | no | — | PKT calendar date |
| `amount` | `numeric(12,2)` | no | — | > 0 |
| `amount_paid` | `numeric(12,2)` | no | `0` | Cached sum of non-voided allocations (PRD §13 "derived, cached") |
| `status` | `due_item_status` | no | `'PENDING'` | Derived from `amount_paid`; the CHECK keeps them in step |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `booking_id → booking.id ON DELETE RESTRICT`
- **UQ:** `uq_due_item_booking_sequence` on `(booking_id, sequence)`. No separate `(booking_id, kind)` unique is needed: `sequence` already orders the lines, and kind is derivable from the position
- **CK [SQL]:** `ck_due_item_amount` — `amount > 0`; `ck_due_item_amount_paid` — `amount_paid >= 0 AND amount_paid <= amount`; `ck_due_item_status` — `(status = 'PENDING' AND amount_paid = 0) OR (status = 'PARTIALLY_PAID' AND amount_paid > 0 AND amount_paid < amount) OR (status = 'PAID' AND amount_paid = amount)` (§6.3). **This is the strongest money invariant in the schema.**
- **IX:** `ix_due_item_open` **[SQL partial]** on `(due_date) WHERE status <> 'PAID'` — the recovery and reminder-eligibility query (§7). The unique `(booking_id, sequence)` already serves the per-booking list
- **Never deleted**, including on cancellation. Cancelled bookings' due items remain as history and are excluded by joining the booking status (`ARCHITECTURE.md` §5.4).

---

### 3.5 Ledger

Money received and how it is applied (`ARCHITECTURE.md` §5.5). Append-only by intent: a payment is posted, never edited, and voided with a reason.

#### `payment`

**Purpose:** a receipt of money against a booking, on a business date, recorded by a named user.
**Enforces:** positive amount; idempotent submission; void-only mutation.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `booking_id` | `uuid` | no | — | FK → `booking.id` |
| `paid_on` | `date` | no | — | PKT business date, supplied by the app (`ARCHITECTURE.md` §5.5, §12.7) |
| `amount` | `numeric(12,2)` | no | — | > 0. The full receipt; allocations may total less (advance credit) |
| `method` | `payment_method` | no | — | `CASH` / `CHEQUE` / `BANK_TRANSFER` (PRD §13) |
| `reference` | `text` | yes | — | Cheque number or bank transaction reference |
| `notes` | `text` | yes | — | Free text |
| `status` | `payment_status` | no | `'POSTED'` | `POSTED` / `VOIDED` |
| `recorded_by` | `uuid` | no | — | FK → `app_user.id` |
| `client_request_id` | `uuid` | no | — | Idempotency key from the Record Payment form (`ARCHITECTURE.md` §12.5) |
| `void_reason` | `text` | yes | — | |
| `voided_at` | `timestamptz` | yes | — | |
| `voided_by` | `uuid` | yes | — | FK → `app_user.id` |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** `booking_id → booking.id ON DELETE RESTRICT`; `recorded_by`, `voided_by → app_user.id ON DELETE RESTRICT`
- **UQ [SQL]:** `uq_payment_idempotency` on `(recorded_by, client_request_id)` (§6.2)
- **CK [SQL]:** `ck_payment_amount` — `amount > 0`; `ck_payment_void_fields` — `(status = 'VOIDED') = (void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by IS NOT NULL)`
- **IX:** `ix_payment_booking` on `(booking_id, paid_on DESC, id DESC)` — the booking ledger; `ix_payment_status_date` on `(status, paid_on)` for collections; `ix_payment_recorded_by` on `(recorded_by, created_at DESC)`
- **No `updated_at`.** The only permitted change is the void transition, timestamped by `voided_at`; a modified-timestamp would imply editable rows. A column-scoped trigger (§6.4) permits exactly those four columns to change and refuses everything else.
- **Advance credit is derived**, never stored: `amount − sum(non-void allocations)`. A stored column would be a second source of truth (`ARCHITECTURE.md` §5.5).

#### `payment_allocation`

**Purpose:** the many-to-many application of one payment to one or more due items.
**Enforces:** no over-allocation; each pair allocated once.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK (surrogate — see DQ-8) |
| `payment_id` | `uuid` | no | — | FK → `payment.id` |
| `due_item_id` | `uuid` | no | — | FK → `due_item.id` |
| `amount` | `numeric(12,2)` | no | — | > 0 |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** both `ON DELETE RESTRICT`
- **UQ:** `uq_allocation_pair` on `(payment_id, due_item_id)` — one allocation per pair; a correction to an allocation is a void-and-repost of the payment, not an edit
- **CK [SQL]:** `ck_allocation_amount` — `amount > 0`
- **IX:** `ix_allocation_due_item` on `(due_item_id)` — the nightly sum check and the due-item ledger. `uq_allocation_pair` already covers `payment_id` as its leading column
- **Immutability:** rows are never updated or deleted; a voided payment's allocations remain and are excluded by joining `payment.status` (`ARCHITECTURE.md` §12.9 check 1).
- **"No allocation exceeds a due item's remaining balance" is not a column CHECK** — it is a cross-row sum, enforced under the booking lock in the command (`ARCHITECTURE.md` §12.2) and re-proved nightly.

### 3.6 Cashbook

The company-wide Roznamcha (`ARCHITECTURE.md` §5.6, Q-5). Not per project.

#### `cash_category`

**Purpose:** the managed list that drives report grouping (PRD §13 ExpenseCategory).
**Enforces:** a category in use cannot disappear; name uniqueness.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | Unique, case-insensitively (§6.2) |
| `nature` | `cash_nature` | no | — | `INCOME` / `EXPENSE` / `OPENING`. **Three natures** (Q-6, `ARCHITECTURE.md` §11.7) |
| `is_active` | `boolean` | no | `true` | Inactive categories cannot be chosen for new entries; existing entries keep their label |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **UQ [SQL]:** `uq_cash_category_name` on `(lower(name))` — "Office Expense" and "office expense" are the same category
- **CK [SQL]:** `ck_cash_category_name` — `length(btrim(name)) > 0`
- **IX:** `ix_cash_category_active` on `(is_active, nature)`
- **`nature` is never derived from the name.** A category called "Refund" is `EXPENSE`; a category called "Opening Balance" is `OPENING`. Reports group by `nature`, never by text (`ARCHITECTURE.md` §5.6).

#### `cash_entry`

**Purpose:** one posted cash movement — manual, or auto-posted by a payment (`ARCHITECTURE.md` §5.6, §5.5).
**Enforces:** positive amount; exactly one linked entry per payment; void-only mutation; **no project dimension** (Q-5).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `entry_date` | `date` | no | — | PKT business date |
| `direction` | `cash_direction` | no | — | `IN` / `OUT` |
| `cash_category_id` | `uuid` | no | — | FK → `cash_category.id` |
| `amount` | `numeric(12,2)` | no | — | > 0; direction carries the sign |
| `description` | `text` | no | — | Human text; never used in report math |
| `linked_payment_id` | `uuid` | yes | — | FK → `payment.id`; non-null only for auto-posted receipts |
| `recorded_by` | `uuid` | no | — | FK → `app_user.id`. An auto-posted entry copies the payment's `recorded_by`; there is no system user (§9.4) |
| `status` | `cash_entry_status` | no | `'POSTED'` | `POSTED` / `VOIDED` |
| `void_reason` | `text` | yes | — | |
| `voided_at` | `timestamptz` | yes | — | |
| `voided_by` | `uuid` | yes | — | FK → `app_user.id` |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **FK:** `cash_category_id → cash_category.id ON DELETE RESTRICT`; `linked_payment_id → payment.id ON DELETE RESTRICT`; `recorded_by`/`voided_by → app_user.id ON DELETE RESTRICT`
- **UQ [SQL]:** `uq_cash_entry_linked_payment` on `(linked_payment_id) WHERE linked_payment_id IS NOT NULL` (§6.2) — the "exactly one linked In entry per payment" rule, proved by nightly check 5
- **CK [SQL]:** `ck_cash_entry_amount` — `amount > 0`; `ck_cash_entry_void_fields` — `(status = 'VOIDED') = (void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by IS NOT NULL)`; `ck_cash_entry_linked` — `linked_payment_id IS NULL OR direction = 'IN'` (a payment receipt is always money in)
- **IX:** `ix_cash_entry_date` on `(entry_date, id)` — the date-range report and the day ledger; `ix_cash_entry_category` on `(cash_category_id, entry_date)`; `ix_cash_entry_status` on `(status, entry_date)`
- **No `updated_at`** and a column-scoped immutability trigger (§6.4): only the void columns may change.
- **No `project_id`.** The cash book is company-wide (Q-5) and every PRD report is company-wide. Adding a nullable project would invite per-project totals that the product does not define (DQ-4).
- **Manual entry, refund, opening balance** are all rows here; "opening" is not a separate table (Q-6, `ARCHITECTURE.md` §11.7). The command validates direction against nature: `INCOME` and `OPENING` post `IN`, `EXPENSE` posts `OUT` (Q-9's refund is an Out).

### 3.7 Reminders

Templates, provider settings, the idempotency claim and the attempt log (`ARCHITECTURE.md` §10.2–§10.7).

#### `reminder_template`

**Purpose:** the Admin-editable message body per channel and milestone.
**Enforces:** one template per `(channel, milestone)`; placeholders validated by the service against the allowlist (`ARCHITECTURE.md` §10.8).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `channel` | `reminder_channel` | no | — | `SMS` / `WHATSAPP` |
| `milestone` | `smallint` | no | — | Days before due date: **10, 7, 3 or 0** (PRD US-6.2). `smallint` because it is arithmetic, not a label (DQ-12) |
| `body` | `text` | no | — | Plain text with allowlisted placeholders; `{{buyer_name}} {{plot}} {{project}} {{amount}} {{due_date}} {{company}}` |
| `is_active` | `boolean` | no | `true` | |
| `updated_by` | `uuid` | yes | — | FK → `app_user.id` |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `updated_by → app_user.id ON DELETE SET NULL`
- **UQ:** `uq_reminder_template_channel_milestone` on `(channel, milestone)`
- **CK [SQL]:** `ck_reminder_template_milestone` — `milestone IN (10, 7, 3, 0)`; `ck_reminder_template_body` — `length(btrim(body)) > 0`
- **IX:** none beyond the unique — the tick reads all active templates once and caches them per run
- **Edits are audited** (`ARCHITECTURE.md` §13.1 "reminder template changed").

#### `provider_config`

**Purpose:** one row per channel: the adapter, its enabled/live flags, the WhatsApp template mapping and the encrypted secret (`ARCHITECTURE.md` §10.10).
**Enforces:** one configuration per channel; secrets are write-only; a live configuration is enabled.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `channel` | `reminder_channel` | no | — | Unique — one row per channel |
| `provider_name` | `text` | no | `'dry-run'` | `dry-run`, `local-sms-gateway`, `meta-cloud` (`ARCHITECTURE.md` §10.3) |
| `is_enabled` | `boolean` | no | `true` | Admin toggle. Disabled ⇒ the tick logs `SKIPPED / not_configured` and makes no call |
| `is_live` | `boolean` | no | `false` | `false` = dry-run: log only, no provider call, no claim (`ARCHITECTURE.md` §10.9). The default is deliberate |
| `api_base_url` | `text` | yes | — | Adapter endpoint |
| `sender_id` | `text` | yes | — | Provider sender/mask |
| `secret_ciphertext` | `text` | yes | — | AES-256-GCM ciphertext; the key is `APP_SECRETS_KEY` in the environment, never in the database. **Write-only**: no read path returns this column and the Prisma model uses `omit` on every read (Q-7) |
| `wa_template_name` | `text` | yes | — | Approved WhatsApp template name (`ARCHITECTURE.md` §10.8); null for SMS |
| `wa_template_language` | `text` | yes | — | e.g. `en` |
| `wa_template_variables` | `jsonb` | yes | — | Ordered placeholder → variable map required by the provider |
| `updated_by` | `uuid` | yes | — | FK → `app_user.id` |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `updated_by → app_user.id ON DELETE SET NULL`
- **UQ:** `uq_provider_config_channel` on `(channel)`
- **CK [SQL]:** `ck_provider_config_live` — `is_live = false OR (provider_name <> 'dry-run' AND is_enabled)` (a dry-run provider cannot be live, and a live channel cannot be disabled)
- **Only one channel is enabled in the MVP** (PRD D-6; `ARCHITECTURE.md` §10.6). Switching channels is a configuration action — disable one row, enable the other — not a schema change; a second enabled row would not create duplicate sends because the tick selects one channel, but it is a product decision, not a default.

#### `reminder_claim`

**Purpose:** the idempotency guard. One row per `(due_item_id, milestone)`, inserted **and committed** before any provider call (`ARCHITECTURE.md` §10.6).
**Enforces:** no duplicate milestone send, ever — the database, not an `if exists` check.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `due_item_id` | `uuid` | no | — | FK → `due_item.id` |
| `milestone` | `smallint` | no | — | 10 / 7 / 3 / 0 |
| `channel` | `reminder_channel` | no | — | Channel at claim time; the MVP has one active channel |
| `status` | `reminder_claim_status` | no | `'SENDING'` | `SENDING` / `SENT` / `FAILED` / `ABANDONED` |
| `attempts` | `smallint` | no | `0` | Incremented before each provider call; max 3 (`ARCHITECTURE.md` §10.7) |
| `last_attempt_at` | `timestamptz` | yes | — | |
| `next_attempt_at` | `timestamptz` | yes | — | `last_attempt_at + 30 min`; null when terminal |
| `claimed_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `due_item_id → due_item.id ON DELETE RESTRICT`
- **UQ [SQL]:** `uq_reminder_claim_due_item_milestone` on `(due_item_id, milestone)` — **the constraint that makes PRD S-5 true** (§6.2)
- **CK [SQL]:** `ck_reminder_claim_milestone` — `milestone IN (10, 7, 3, 0)`; `ck_reminder_claim_attempts` — `attempts BETWEEN 0 AND 3`; `ck_reminder_claim_terminal` — `status <> 'SENT' OR attempts >= 1` (a send implies an attempt)
- **IX:** `ix_reminder_claim_retry` on `(status, next_attempt_at) WHERE status IN ('SENDING','FAILED')` — the retry/stale sweep (§7)
- **Never deleted.** Stale `SENDING` rows older than 30 minutes are moved to `ABANDONED` by the tick (`ARCHITECTURE.md` §10.6, nightly check 7).
- **The claim is per milestone, not per channel.** Switching channel mid-life reuses the same claim; that is why a second active channel is a product decision.

#### `reminder_log`

**Purpose:** the attempt history shown on the Reminder Log screen. One row per attempt, plus one row per skip.
**Enforces:** every attempt is explainable; no silent drop (PRD US-6.2).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `due_item_id` | `uuid` | no | — | FK → `due_item.id` |
| `claim_id` | `uuid` | yes | — | FK → `reminder_claim.id`; **null for `SKIPPED`** (no claim by design) |
| `channel` | `reminder_channel` | no | — | |
| `milestone` | `smallint` | no | — | 10 / 7 / 3 / 0 |
| `attempt` | `smallint` | no | `1` | 1-based; meaningful for `SENT`/`FAILED` |
| `status` | `reminder_log_status` | no | — | `SENT` / `FAILED` / `SKIPPED` |
| `reason` | `text` | yes | — | For `SKIPPED`: `dry_run`, `not_configured`, `no_phone`, `no_consent`, `superseded` (`ARCHITECTURE.md` §10.6). For `FAILED`: provider reason, `unknown` (outcome unknown) or `window_expired` |
| `recipient_phone` | `varchar(16)` | yes | — | E.164 at send time; null when skipped before a recipient was resolved |
| `rendered_body` | `text` | yes | — | The exact text handed to the adapter — used for dry-run review and disputes |
| `provider_ref` | `text` | yes | — | Provider message id |
| `error_message` | `text` | yes | — | Human-readable provider/network error |
| `attempted_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`; **FK:** `due_item_id → due_item.id ON DELETE RESTRICT`, `claim_id → reminder_claim.id ON DELETE RESTRICT`
- **CK [SQL]:** `ck_reminder_log_milestone` — `milestone IN (10, 7, 3, 0)`; `ck_reminder_log_attempt` — `attempt >= 1`; `ck_reminder_log_claim` — `(status = 'SKIPPED') = (claim_id IS NULL)`
- **IX:** `ix_reminder_log_due_item` on `(due_item_id, attempted_at DESC)`; `ix_reminder_log_status_time` on `(status, attempted_at DESC)` — the "N sends failed in last 24h" banner
- **Retention is DQ-5** (proposed: indefinite; volume is trivial).
- **The rendered body is stored, not the template reference.** A later template edit must not rewrite history (`ARCHITECTURE.md` §10.8).

---

### 3.8 Documents — no tables

Documents renders the allotment letter and payment schedule **on demand** from current data and streams the PDF; nothing is stored or versioned (`ARCHITECTURE.md` §5.9, §8.1, ADR-13). There is no `document` table and no "generated PDF" row: a stored PDF would immediately be stale (PRD BR-6 requires current data), and the documents are cheap to regenerate.

Its only schema touchpoints are reads: `company`, `project`, `plot`, `booking`, `buyer`, `booking_buyer`, `payment_plan`, `due_item`, `payment`, and the company-logo `file_object`. Failures are logged to the application log, not to a table.

---

### 3.9 Recovery and Reporting — no tables

Both are read models (`ARCHITECTURE.md` §11.1, §5.7, §5.10). They own no tables and no writes.

**Recovery** computes outstanding and overdue from `due_item` joined to `booking` (`status = 'CONFIRMED'`) and `buyer`; the index it leans on is `ix_due_item_open` (§7). The outstanding-dues CSV (PRD D-12) is streamed from the same query and is not stored. It never caches a balance in a table: the single-source rule (`ARCHITECTURE.md` §11.1) means a cached recovery table would be one more number to keep true.

**Reporting** reads `cash_entry` joined to `cash_category`, filtered `status = 'POSTED'` and `entry_date` in range; its only schema dependency is that index (§7) and the `nature` enum. Print views and CSV exports are generated per request and never persisted.

---

### 3.10 Audit

#### `audit_log`

**Purpose:** the append-only accountability record (`ARCHITECTURE.md` §13.2). Admin-only in the UI; written by every mutating command in the same transaction (§13.1).
**Enforces:** nothing is ever changed or removed — trigger **and** grants.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigserial` | no | — | PK. Monotonic tiebreaker for `(occurred_at DESC, id DESC)` pagination (`ARCHITECTURE.md` §13.4) |
| `occurred_at` | `timestamptz` | no | `now()` | Server time |
| `actor_user_id` | `uuid` | yes | — | FK → `app_user.id`; **null for system/worker actions** |
| `actor_label` | `text` | no | — | Denormalized name/email at event time; `'system'`/`'worker'` when null actor |
| `action_code` | `text` | no | — | Stable code, e.g. `booking.cancelled` — never a sentence (`ARCHITECTURE.md` §13.2) |
| `entity_type` | `text` | no | — | e.g. `booking`, `payment`, `buyer` |
| `entity_id` | `uuid` | yes | — | Null for non-entity events (login failure for an unknown email) |
| `booking_id` | `uuid` | yes | — | Denormalized so the booking timeline is one indexed filter, not a join (`ARCHITECTURE.md` §13.4) |
| `summary` | `jsonb` | no | `'{}'::jsonb` | Structured and small; **never CNIC, phone, address or a file path** (`ARCHITECTURE.md` §13.2) |
| `request_id` | `text` | yes | — | Correlates with the pino request context |
| `ip` | `varchar(45)` | yes | — | Textual address (§1.9); checked by `ck_audit_log_ip_format` |

- **PK:** `id`
- **FK:** `actor_user_id → app_user.id ON DELETE RESTRICT` (no user is ever deleted; login-failure rows use null); `booking_id → booking.id ON DELETE RESTRICT`
- **CK [SQL]:** `ck_audit_log_action_code` — `action_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'` (stable dotted code, catches a pasted sentence); `ck_audit_log_ip_format`
- **IX:** `ix_audit_log_time` on `(occurred_at DESC, id DESC)`; `ix_audit_log_booking` on `(booking_id, occurred_at DESC)`; `ix_audit_log_actor` on `(actor_user_id, occurred_at DESC)`; `ix_audit_log_entity` on `(entity_type, entity_id, occurred_at DESC)`; `ix_audit_log_action` on `(action_code, occurred_at DESC)`
- **Append-only:** `trg_audit_log_append_only` raises on `UPDATE` or `DELETE` (§6.4); `spm_app` has `INSERT`/`SELECT` only (§8).
- **No `updated_at`, no `deleted_at`, no version.** Those columns would contradict the guarantee.
- **`booking_id` has no `ON DELETE` alternative:** bookings are never deleted either, so `RESTRICT` is honest.

### 3.11 Core (shared)

Platform metadata: uploaded-file records and job-run records (`ARCHITECTURE.md` §4.2, §5.12, §7.2).

#### `file_object`

**Purpose:** metadata for one stored blob. The blob lives on disk/S3; this row is the index.
**Enforces:** content-addressed keys, hash integrity, soft deletion, type/size limits.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK. The opaque id exposed in URLs, never the storage key (`ARCHITECTURE.md` §7.2) |
| `kind` | `file_kind` | no | — | `MASTER_PLAN` / `BUYER_PHOTO` / `COMPANY_LOGO` (PRD §13; `ARCHITECTURE.md` §7.1) |
| `storage_key` | `text` | no | — | **Content-addressed** `<kind>/<x2>/<y2>/<sha256>.<ext>` (`ARCHITECTURE.md` §7.2). No user-controlled segment |
| `original_filename` | `text` | no | — | Display only; never used to build a path |
| `mime_type` | `text` | no | — | Allowlisted per kind by the upload pipeline (`ARCHITECTURE.md` §7.3) |
| `byte_size` | `bigint` | no | — | > 0; per-kind max enforced by the service (25 MB plan images) |
| `sha256` | `char(64)` | no | — | Lowercase hex; the dedupe and integrity key |
| `width_px` | `integer` | yes | — | Images only; written by the pipeline after normalization |
| `height_px` | `integer` | yes | — | As above; together they yield the aspect ratio for R-8 / Q-12 |
| `uploaded_by` | `uuid` | yes | — | FK → `app_user.id`; null for system writes |
| `created_at` | `timestamptz` | no | `now()` | |
| `deleted_at` | `timestamptz` | yes | — | Soft-delete marker; the GC job removes the row and blob only when no live reference remains (`ARCHITECTURE.md` §7.5, §1.6) |

- **PK:** `id`; **FK:** `uploaded_by → app_user.id ON DELETE SET NULL`
- **UQ:** `uq_file_object_storage_key` on `(storage_key)` — identical uploads dedupe to one blob and one row. **No unique on `sha256` alone**: the same bytes uploaded as different kinds (a logo reused as a photo) are different objects with different keys.
- **CK [SQL]:** `ck_file_object_size` — `byte_size > 0`; `ck_file_object_sha256` — `sha256 ~ '^[0-9a-f]{64}$'`; `ck_file_object_dims` — `(width_px IS NULL) = (height_px IS NULL) AND (width_px IS NULL OR (width_px > 0 AND height_px > 0))`; `ck_file_object_key` — `storage_key ~ '^(MASTER_PLAN|BUYER_PHOTO|COMPANY_LOGO)/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\.[a-z0-9]+$'`
- **IX:** `ix_file_object_kind` on `(kind, created_at DESC)`; `ix_file_object_deleted` on `(deleted_at) WHERE deleted_at IS NOT NULL` — the GC scan
- **Dedupe + soft delete:** deleting a buyer photo marks **the reference** cleared (`buyer.photo_file_id = NULL`, audited) and soft-deletes the object only if no other row references it. Because `file_object` is referenced by three modules, the GC check is a union of the three reference columns, not a single FK (`ARCHITECTURE.md` §7.5).
- **Application must never serve by `storage_key`.** The download route resolves `file_object.id` → key after an authz check (`ARCHITECTURE.md` §7.4).

#### `job_run`

**Purpose:** one record per scheduled job execution: reminder tick, nightly integrity checks, session cleanup, orphan-file GC, stale-claim recovery (`ARCHITECTURE.md` §10.4, §12.9).
**Enforces:** a failed job is visible, not silent.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `job_name` | `text` | no | — | `reminders.tick`, `integrity.nightly`, `sessions.cleanup`, `files.gc` |
| `started_at` | `timestamptz` | no | `now()` | |
| `finished_at` | `timestamptz` | yes | — | Null while running |
| `status` | `job_status` | no | `'RUNNING'` | `RUNNING` / `SUCCEEDED` / `FAILED` |
| `triggered_by` | `text` | no | `'cron'` | `cron` / `startup` / `manual` |
| `summary` | `jsonb` | yes | — | Counts and outcomes: `{"claims": 12, "sent": 11, "failed": 1}`; for integrity checks, the list of failed check numbers |
| `error_message` | `text` | yes | — | Truncated message on `FAILED` |
| `created_at` | `timestamptz` | no | `now()` | |

- **PK:** `id`
- **CK [SQL]:** `ck_job_run_finish` — `(status = 'RUNNING') = (finished_at IS NULL)`; `ck_job_run_error` — `status <> 'FAILED' OR error_message IS NOT NULL`
- **IX:** `ix_job_run_name_time` on `(job_name, started_at DESC)`; `ix_job_run_running` on `(started_at) WHERE status = 'RUNNING'` — an operator's "what is stuck" query
- **Retention is DQ-6** (proposed: prune successful runs after 90 days; keep failures for one year).
- **Not the audit log.** A job that changes business data also writes `audit_log` rows for the changes; `job_run` records the execution itself (`ARCHITECTURE.md` §13.5 distinction).

### 3.12 Additions beyond the source documents

PRD §13 and `ARCHITECTURE.md` §4.2 do not name every object a correct schema needs. Each addition is called out here; nothing in this table changes behavior.

**Tables**

| Table | Status in sources | Why it exists |
|---|---|---|
| `session` | `ARCHITECTURE.md` §4.2, §6.1 — not in PRD §13 | Server-side revocable sessions; PRD only implies "login" |
| `login_throttle` | `ARCHITECTURE.md` §4.2, §6.4 — not in PRD | Failed-login lockout surviving restarts (`ARCHITECTURE.md` §6.1) |
| `app_setting` | `ARCHITECTURE.md` §4.2 | Operational scalars that must change without a deploy |
| `payment_plan` | `ARCHITECTURE.md` §4.2 — PRD §13 lists the same fields on Booking | 1:1 snapshot table; see DQ-3 |
| `booking_note` | `ARCHITECTURE.md` §5.4 ("add notes") — not in PRD §13 | Notes need authorship and a timestamp; a text column on `booking` would lose both |
| `reminder_template`, `provider_config` | `ARCHITECTURE.md` §10.2, §10.8 — not in PRD §13 | Templates and channel configuration are edited by an Admin, so they are data, not constants |
| `file_object` | `ARCHITECTURE.md` §7.2 — not in PRD §13 | PRD stores files; ARCH defines metadata in PostgreSQL |
| `job_run` | `ARCHITECTURE.md` §10.4, §12.9 — not in PRD | Scheduler runs and nightly checks must leave a record |

**Columns** (only those with a decision behind them; mechanical `created_at`/`updated_at`/`id` columns follow §1)

| Column | Why |
|---|---|
| `booking.client_request_id`, `payment.client_request_id` | The mechanism is `ARCHITECTURE.md` §12.5; the columns are new. Unique per actor (§6.2) |
| `booking.cancelled_by`, `cancelled_at` | "Who cancelled and when" is audited, but the booking itself must answer it without a join to `audit_log` |
| `booking.primary_buyer_id` | Named by PRD §13; kept alongside `booking_buyer.is_primary` for the common query and the contract's field list |
| `payment.status`, `void_reason` and the three void columns | PRD §13 names status and void_reason; `voided_at`/`voided_by` make the transition auditable without a join |
| `cash_entry.linked_payment_id` | PRD §13 names it; the unique partial index is the new part (§6.2) |
| `cash_category.nature` | `ARCHITECTURE.md` §11.7 and Q-6; PRD's "expense category" does not cover income/openings |
| `due_item.kind`, `updated_at` | `sequence` and `label` are PRD §13 fields; `kind` distinguishes token/down payment/installment in SQL. `updated_at` tracks the only Sales row mutated by ordinary day-to-day processing (`amount_paid`/`status` per payment), as opposed to the exceptional, version-gated edits on `booking` and `buyer` |
| `plot_status_history.id`, `actor_user_id`, `reason` | PRD FR-3.4 requires a history; the columns make each row attributable and explain reserve/release/cancel |
| `project.master_plan_width_px`, `height_px`, `uploaded_at` | R-8 and Q-12 require the aspect ratio; storing dimensions with the image avoids re-reading the blob |
| `reminder_claim.channel` | The claim is per milestone; recording the channel makes an in-flight claim explainable if configuration changes mid-send |
| `reminder_log.attempt` | `ARCHITECTURE.md` §10.7 allows three attempts; the log must distinguish them |
| `provider_config.is_enabled`, `wa_template_*` | `ARCHITECTURE.md` §10.10 names the enabled flag and the WhatsApp template mapping |
| `file_object.width_px`, `height_px`, `deleted_at` | `ARCHITECTURE.md` §7.2 names dimensions and a soft-delete marker |
| `job_run.triggered_by` | A startup catch-up run and a cron run fail differently; the operator needs to tell them apart |

**Deliberate omissions**, so a reviewer does not read them as oversights:

- No `recovery_balance` or `outstanding` column — a cached total would be a second source of truth (`ARCHITECTURE.md` §11.1).
- No `cash_entry.project_id` — the cash book is company-wide (Q-5, DQ-4).
- No `payment.advance_amount` — advance credit is `amount − sum(allocations)` (`ARCHITECTURE.md` §5.5).
- No `document` table — PDFs are generated on demand (`ARCHITECTURE.md` §5.9).
- No `notification_queue` table — the claim row is the queue (`ARCHITECTURE.md` §10.4).
- No `buyer.consent_source` or consent-history table — one structured boolean plus timestamp, audited (Q-11, DQ-2).
- No per-project or per-block running totals — Reporting recomputes from `cash_entry`.

---

## 4. Enumerated types

Eighteen native PostgreSQL enums, declared as Prisma `enum` types and applied by the initial migration. The rule for enum vs `text` + `CHECK` is §1.5: **enum when the UI, state machine and reports branch on a closed vocabulary**; `text` when it is a machine code expected to grow (`reminder_log.reason`, `job_run.job_name`, `audit_log.action_code`, `audit_log.entity_type`).

| # | Enum | Values (in logical order) | Used by | Notes |
|---|---|---|---|---|
| 1 | `user_role` | `ADMIN`, `SALES_AGENT`, `ACCOUNTANT` | `app_user.role` | One role per user; capabilities are derived in `core/authz` (`ARCHITECTURE.md` §6.2) |
| 2 | `preferred_language` | `EN`, `UR` | `app_user.preferred_language` | Persisted UI language (PRD FR-2.4); PDFs stay English (A-3) |
| 3 | `plot_status` | `AVAILABLE`, `RESERVED`, `BOOKED_TOKEN`, `SOLD_CONSTRUCTED` | `plot.status`, `plot_status_history.from_status`, `.to_status` | PRD §16 / `ARCHITECTURE.md` §5.3. `SOLD_CONSTRUCTED` is terminal in the MVP |
| 4 | `plot_type` | `RESIDENTIAL`, `COMMERCIAL` | `plot.plot_type` | PRD §13 |
| 5 | `booking_status` | `CONFIRMED`, `CANCELLED` | `booking.status` | The partial unique index keys on `CONFIRMED` (§6.1) |
| 6 | `due_item_kind` | `TOKEN`, `DOWN_PAYMENT`, `INSTALLMENT` | `due_item.kind` | Display labels are stored separately (`due_item.label`) |
| 7 | `due_item_status` | `PENDING`, `PARTIALLY_PAID`, `PAID` | `due_item.status` | Derived from `amount_paid`; the CHECK makes the pair inseparable (§6.3) |
| 8 | `payment_method` | `CASH`, `CHEQUE`, `BANK_TRANSFER` | `payment.method` | Exactly PRD §13's three |
| 9 | `payment_status` | `POSTED`, `VOIDED` | `payment.status` | Void-only (§1.6) |
| 10 | `cash_direction` | `IN`, `OUT` | `cash_entry.direction` | The sign; amounts are always positive |
| 11 | `cash_nature` | `INCOME`, `EXPENSE`, `OPENING` | `cash_category.nature` | **Exactly three** (Q-6, `ARCHITECTURE.md` §11.7). Refunds are `EXPENSE` (Q-9) |
| 12 | `cash_entry_status` | `POSTED`, `VOIDED` | `cash_entry.status` | Void-only (PRD US-5.3, Q-2) |
| 13 | `reminder_channel` | `SMS`, `WHATSAPP` | `reminder_template.channel`, `provider_config.channel`, `reminder_claim.channel`, `reminder_log.channel` | One active channel in the MVP (PRD D-6); values exist for the later switch |
| 14 | `reminder_claim_status` | `SENDING`, `SENT`, `FAILED`, `ABANDONED` | `reminder_claim.status` | `ABANDONED` is terminal and never retried (`ARCHITECTURE.md` §10.6) |
| 15 | `reminder_log_status` | `SENT`, `FAILED`, `SKIPPED` | `reminder_log.status` | `SKIPPED` rows have no claim |
| 16 | `file_kind` | `MASTER_PLAN`, `BUYER_PHOTO`, `COMPANY_LOGO` | `file_object.kind` | The three upload kinds of `ARCHITECTURE.md` §7.1. No PDF kind: PDFs are never stored |
| 17 | `job_status` | `RUNNING`, `SUCCEEDED`, `FAILED` | `job_run.status` | |
| 18 | `installment_frequency` | `MONTHLY`, `QUARTERLY` | `payment_plan.frequency` | PRD US-2.2 and §13: monthly or quarterly; the two the plan math supports (`ARCHITECTURE.md` §12.6) |

**Rules that apply to every enum**

- **Values are never removed or renamed** (§1.5). Deprecating a value means leaving it in the type and rejecting it in the service.
- **Ordinal order is never used.** The enum order above is for readability only; comparisons are by value, and any ordering (e.g. plot status filters) is defined explicitly in SQL or the UI.
- **A new value is its own migration** (`ALTER TYPE … ADD VALUE`), which cannot be used in the same transaction that adds it (PostgreSQL 12+ rule of thumb, §1.5).
- **Labels are not stored.** Every enum value maps to a translation key in `core/i18n`; the database holds the stable code (`ARCHITECTURE.md` §9).
- **Not an enum:** `reminder_template.milestone`, `reminder_claim.milestone`, `reminder_log.milestone` are `smallint` with `CHECK (milestone IN (10, 7, 3, 0))`, because the value is arithmetic (days before `due_date`) rather than a vocabulary (DQ-12).

---

## 5. Relationships

### 5.1 Referential map

Grouped by owning module. Each line reads parent → child, naming the child's foreign-key column and its delete action. All foreign keys are `ON DELETE RESTRICT` unless stated otherwise.

```text
Setup
  file_object  1 ──0..1─►  company                 via company.logo_file_id            ON DELETE SET NULL
  company      1 ──0..*─►  project                 via project.company_id              ON DELETE RESTRICT
  file_object  1 ──0..1─►  project                 via project.master_plan_file_id     ON DELETE SET NULL
  project      1 ──0..*─►  block                   via block.project_id                ON DELETE RESTRICT
  project      1 ──0..*─►  plot                    via plot.project_id                 ON DELETE RESTRICT
  block        1 ──0..*─►  plot                    via plot.block_id                   ON DELETE RESTRICT

Inventory
  plot         1 ──0..*─►  plot_status_history     via plot_status_history.plot_id     ON DELETE RESTRICT
  plot         1 ──0..*─►  booking                 via booking.plot_id                 ON DELETE RESTRICT

Identity
  app_user     1 ──0..*─►  session                 via session.user_id                 ON DELETE RESTRICT
  app_user     1 ──0..*─►  booking                 via booking.created_by              ON DELETE RESTRICT
  app_user     1 ──0..*─►  booking                 via booking.cancelled_by            ON DELETE RESTRICT
  app_user     1 ──0..*─►  buyer                   via buyer.created_by                ON DELETE RESTRICT
  app_user     1 ──0..*─►  plot_status_history     via plot_status_history.actor_user_id ON DELETE RESTRICT
  app_user     1 ──0..*─►  audit_log               via audit_log.actor_user_id         ON DELETE RESTRICT

Sales
  file_object  1 ──0..1─►  buyer                   via buyer.photo_file_id             ON DELETE SET NULL
  buyer        1 ──0..*─►  booking                 via booking.primary_buyer_id        ON DELETE RESTRICT
  booking      1 ──1────►  payment_plan            via payment_plan.booking_id         ON DELETE RESTRICT
  booking      1 ──0..*─►  booking_buyer           via booking_buyer.booking_id        ON DELETE RESTRICT
  buyer        1 ──0..*─►  booking_buyer           via booking_buyer.buyer_id          ON DELETE RESTRICT
  booking      1 ──0..*─►  booking_note            via booking_note.booking_id         ON DELETE RESTRICT
  app_user     1 ──0..*─►  booking_note            via booking_note.author_user_id     ON DELETE RESTRICT
  booking      1 ──0..*─►  due_item                via due_item.booking_id             ON DELETE RESTRICT

Ledger
  booking      1 ──0..*─►  payment                 via payment.booking_id              ON DELETE RESTRICT
  app_user     1 ──0..*─►  payment                 via payment.recorded_by             ON DELETE RESTRICT
  payment      1 ──0..*─►  payment_allocation      via payment_allocation.payment_id   ON DELETE RESTRICT
  due_item     1 ──0..*─►  payment_allocation      via payment_allocation.due_item_id  ON DELETE RESTRICT

Cashbook
  cash_category 1 ──0..*─► cash_entry              via cash_entry.cash_category_id     ON DELETE RESTRICT
  payment       1 ──0..1─► cash_entry              via cash_entry.linked_payment_id    ON DELETE RESTRICT
  app_user      1 ──0..*─► cash_entry              via cash_entry.recorded_by          ON DELETE RESTRICT

Reminders
  due_item     1 ──0..4─►  reminder_claim          via reminder_claim.due_item_id      ON DELETE RESTRICT
  due_item     1 ──0..*─►  reminder_log            via reminder_log.due_item_id        ON DELETE RESTRICT
  reminder_claim 1 ─0..*─► reminder_log            via reminder_log.claim_id           ON DELETE RESTRICT

Audit / Core
  booking      1 ──0..*─►  audit_log               via audit_log.booking_id            ON DELETE RESTRICT
  app_user     1 ──0..*─►  provider_config         via provider_config.updated_by      ON DELETE SET NULL
  app_user     1 ──0..*─►  reminder_template       via reminder_template.updated_by    ON DELETE SET NULL
  app_user     1 ──0..*─►  app_setting             via app_setting.updated_by          ON DELETE SET NULL
  app_user     1 ──0..*─►  file_object             via file_object.uploaded_by         ON DELETE SET NULL
```

`login_throttle` and `job_run` have no foreign keys at all; `session`, `app_setting`, `reminder_template`, `provider_config` and `file_object` have only the `app_user` references shown. `audit_log` and `cash_entry` are the two widest dependents.

### 5.2 Module dependency graph

The import-level graph is `ARCHITECTURE.md` §4.3 and is **not** the same thing as the FK graph:

```text
Identity ──► Audit ──► Core
Setup    ──► Audit
Inventory ─► Audit
Sales    ──► Inventory, Audit
Ledger   ──► Sales, Cashbook, Audit
Cashbook ──► Audit
Reminders ──► Sales, Inventory, Setup, Audit
Documents ──► Setup, Sales
Recovery ──► Sales, Ledger, Setup
Reporting ──► Cashbook, Setup
```

| Relationship | Direction | Why it is allowed |
|---|---|---|
| `booking.plot_id → plot.id` | Sales → Inventory (FK) | Sales reads plots and changes status only through Inventory's command (`ARCHITECTURE.md` §4.4) |
| `payment.booking_id → booking.id` | Ledger → Sales (FK) | Ledger locks the booking and updates due items through Sales' command, not by writing the table directly |
| `cash_entry.linked_payment_id → payment.id` | Cashbook → Ledger (FK) | Cashbook is *called by* Ledger to post/void the linked entry (`ARCHITECTURE.md` §5.6); the FK does not create an import |
| `audit_log.booking_id → booking.id` | Audit → Sales (FK) | A denormalized timeline key, written by the caller's audit helper |
| `reporting` and `recovery` | no FKs | Read-only modules own no tables |

**Cardinalities that matter** (the ones a reviewer should check in the DDL):

- `booking.plot_id` is many-to-one; at most one row per plot may have `status = 'CONFIRMED'` (§6.1). Cancelled bookings accumulate as history.
- `booking ↔ buyer` is many-to-many through `booking_buyer`, with exactly one `is_primary` and shares totalling 100 (`ARCHITECTURE.md` §12.8, nightly check 4).
- `booking ↔ payment_plan` is strictly 1:1 (`uq_payment_plan_booking`).
- A posted `payment` has exactly one linked `cash_entry`; a cash entry references at most one payment (manual entries reference none) (`ARCHITECTURE.md` §12.9 check 5).
- `due_item ↔ reminder_claim` is 1:0..4 (one per milestone); `due_item ↔ reminder_log` is 1:0..N (attempts and skips).

---

## 6. Hand-written SQL

Everything Prisma can express lives in `schema.prisma`; this section is the remainder. Each block below is **its own migration** (§1.8, §10), applied by `prisma migrate deploy`. The SQL is PostgreSQL 17.

**Naming:** index and constraint names match the names used in §3, so a `\d+` output can be read against this document directly. `spm_` is reserved for functions that exist only for constraints (§1.1).

### 6.1 Partial indexes

```sql
-- PRD S-3 / ARCHITECTURE §12.1: a plot can carry at most one live booking.
-- Cancelling a booking removes its row from the index, so history accumulates freely.
CREATE UNIQUE INDEX one_active_booking_per_plot
  ON booking (plot_id)
  WHERE status = 'CONFIRMED';

-- ARCHITECTURE §12.8: exactly one primary buyer per booking. This is what makes
-- "the reminder recipient" (PRD D-5) a single, unambiguous row.
CREATE UNIQUE INDEX one_primary_buyer_per_booking
  ON booking_buyer (booking_id)
  WHERE is_primary;
```

Both predicates are immutable (`status` is an enum, `is_primary` a boolean), so the indexes are ordinary and need no special maintenance. Neither prevents an inconsistency the application could also create — a `CONFIRMED` booking whose plot is still `AVAILABLE` is caught by nightly check 2 (`ARCHITECTURE.md` §12.9), because the two writes live in different tables.

**Partial non-unique indexes.** The same mechanism serves the hot scans; the predicates keep the indexes small and let the planner ignore paid items, settled claims and live files.

```sql
-- Recovery dashboard and reminder eligibility: only unpaid due items matter.
CREATE INDEX ix_due_item_open
  ON due_item (due_date)
  WHERE status <> 'PAID';

-- Retry sweep, stale-claim recovery (ARCHITECTURE §10.6) and the failure banner.
CREATE INDEX ix_reminder_claim_retry
  ON reminder_claim (status, next_attempt_at)
  WHERE status IN ('SENDING', 'FAILED');

-- Orphan-file GC scan (ARCHITECTURE §7.5); live files stay out of the index.
CREATE INDEX ix_file_object_deleted
  ON file_object (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- "What is stuck?" operator query; one partial index instead of a scan.
CREATE INDEX ix_job_run_running
  ON job_run (started_at)
  WHERE status = 'RUNNING';

```

### 6.2 Unique indexes

```sql
-- Idempotent command submission (ARCHITECTURE §12.5). A retried request with the
-- same client_request_id collides and the service returns the original row.
CREATE UNIQUE INDEX uq_booking_idempotency
  ON booking (created_by, client_request_id);

CREATE UNIQUE INDEX uq_payment_idempotency
  ON payment (recorded_by, client_request_id);

-- One company row (PRD §1.3, single tenant). The expression is constant, so the
-- second insert fails regardless of the values supplied.
CREATE UNIQUE INDEX uq_company_singleton
  ON company ((true));

-- Exactly one linked cash entry per payment (ARCHITECTURE §12.8, §12.9 check 5).
-- Partial because manual entries have no payment.
CREATE UNIQUE INDEX uq_cash_entry_linked_payment
  ON cash_entry (linked_payment_id)
  WHERE linked_payment_id IS NOT NULL;

-- The reminder idempotency guard (ARCHITECTURE §10.6). One claim per milestone.
CREATE UNIQUE INDEX uq_reminder_claim_due_item_milestone
  ON reminder_claim (due_item_id, milestone);

-- Category names are unique case-insensitively; otherwise "Utilities" and
-- "utilities" become two report buckets.
CREATE UNIQUE INDEX uq_cash_category_name
  ON cash_category (lower(name));
```

The two uniqueness rules the brief names as SQL are Prisma `@unique`s. Their generated DDL is shown here **as a comment only** — executing it would create a duplicate index:

```sql
-- Generated by Prisma's initial migration; NOT executed by this migration.
-- CREATE UNIQUE INDEX uq_buyer_cnic ON buyer (cnic);
-- CREATE UNIQUE INDEX uq_plot_project_number ON plot (project_id, plot_number);
```

**Uniques declared by Prisma, listed for review** (the `map:` argument fixes the conventional name so the `\d` output matches this document):

| Constraint | Columns | Prisma declaration | Purpose |
|---|---|---|---|
| `uq_buyer_cnic` | `buyer (cnic)` | `@unique(map: "uq_buyer_cnic")` | **Unique normalized CNIC** (PRD §13, `ARCHITECTURE.md` §12.8). Meaningful only together with `ck_buyer_cnic_format` (§6.3) |
| `uq_plot_project_number` | `plot (project_id, plot_number)` | `@@unique([project_id, plot_number], map: "uq_plot_project_number")` | **Unique plot number within a project** (PRD US-2.3), independent of block |
| `uq_booking_ref` | `booking (booking_ref)` | `@unique(map: "uq_booking_ref")` | Human-facing business key; never reused |
| `uq_app_user_email` | `app_user (email)` | `@unique(map: "uq_app_user_email")` | Login lookup; stored lowercase (`ck_app_user_email_lower`) |
| `uq_session_token_hash` | `session (token_hash)` | `@unique(map: "uq_session_token_hash")` | Session lookup; one row per token |
| `uq_project_company_name` | `project (company_id, name)` | `@@unique([company_id, name], map: "uq_project_company_name")` | Two projects cannot share a name |
| `uq_block_project_code` | `block (project_id, code)` | `@@unique([project_id, code], map: "uq_block_project_code")` | Block codes are unique inside a project |
| `uq_due_item_booking_sequence` | `due_item (booking_id, sequence)` | `@@unique([booking_id, sequence], map: "uq_due_item_booking_sequence")` | One payable line per position in the plan |
| `uq_allocation_pair` | `payment_allocation (payment_id, due_item_id)` | `@@unique([payment_id, due_item_id], map: "uq_allocation_pair")` | A payment touches a due item at most once |
| `uq_payment_plan_booking` | `payment_plan (booking_id)` | `@unique(map: "uq_payment_plan_booking")` | Plan is 1:1 with booking |
| `uq_reminder_template_channel_milestone` | `reminder_template (channel, milestone)` | `@@unique([channel, milestone], map: "…")` | One template per channel and milestone |
| `uq_provider_config_channel` | `provider_config (channel)` | `@unique(map: "uq_provider_config_channel")` | One configuration per channel |
| `uq_file_object_storage_key` | `file_object (storage_key)` | `@unique(map: "uq_file_object_storage_key")` | Content-addressed key is the dedupe key |

### 6.3 CHECK constraints

Prisma has no syntax for `CHECK`, so all of these are hand-written. They are grouped by module and named as in §3. Amounts are checked for sign here; cross-row sums are deliberately absent (§6.7).

```sql
-- ---------- Identity ----------
ALTER TABLE app_user ADD CONSTRAINT ck_app_user_email_lower
  CHECK (email = lower(email));
ALTER TABLE session ADD CONSTRAINT ck_session_expiry_order
  CHECK (absolute_expires_at > created_at AND idle_expires_at > created_at);
ALTER TABLE session ADD CONSTRAINT ck_session_ip_format
  CHECK (ip IS NULL OR family(ip::inet) IN (4, 6));
ALTER TABLE login_throttle ADD CONSTRAINT ck_login_throttle_count
  CHECK (failed_count >= 0);

-- ---------- Setup ----------
ALTER TABLE company ADD CONSTRAINT ck_company_marla
  CHECK (marla_sqft > 0);
ALTER TABLE project ADD CONSTRAINT ck_project_marla
  CHECK (marla_sqft IS NULL OR marla_sqft > 0);
ALTER TABLE project ADD CONSTRAINT ck_project_plan_dims
  CHECK ((master_plan_width_px IS NULL) = (master_plan_height_px IS NULL)
         AND (master_plan_width_px IS NULL OR (master_plan_width_px > 0 AND master_plan_height_px > 0)));

-- ---------- Inventory ----------
ALTER TABLE plot ADD CONSTRAINT ck_plot_size
  CHECK (size_marla > 0);
ALTER TABLE plot ADD CONSTRAINT ck_plot_dims
  CHECK ((width_ft IS NULL OR width_ft > 0) AND (depth_ft IS NULL OR depth_ft > 0));
ALTER TABLE plot ADD CONSTRAINT ck_plot_price
  CHECK (price_pkr >= 0);
ALTER TABLE plot ADD CONSTRAINT ck_plot_polygon
  CHECK (polygon IS NULL OR spm_polygon_ok(polygon));
ALTER TABLE plot_status_history ADD CONSTRAINT ck_plot_history_transition
  CHECK (from_status IS DISTINCT FROM to_status);

-- ---------- Sales ----------
ALTER TABLE buyer ADD CONSTRAINT ck_buyer_cnic_format
  CHECK (cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$');
ALTER TABLE buyer ADD CONSTRAINT ck_buyer_phone_e164
  CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE buyer ADD CONSTRAINT ck_buyer_consent_pair
  CHECK (consent_sms = false OR consent_recorded_at IS NOT NULL);
ALTER TABLE booking ADD CONSTRAINT ck_booking_price
  CHECK (sale_price_pkr > 0);
ALTER TABLE booking ADD CONSTRAINT ck_booking_cancel_fields
  CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL
                                   AND cancelled_at IS NOT NULL
                                   AND cancelled_by IS NOT NULL));
ALTER TABLE payment_plan ADD CONSTRAINT ck_plan_amounts
  CHECK (token_amount >= 0 AND down_payment_amount >= 0
         AND balance_amount > 0 AND installment_base_amount > 0);
ALTER TABLE payment_plan ADD CONSTRAINT ck_plan_installments
  CHECK (installment_count BETWEEN 1 AND 120);
ALTER TABLE booking_buyer ADD CONSTRAINT ck_booking_buyer_share
  CHECK (share_pct > 0 AND share_pct <= 100);
ALTER TABLE booking_note ADD CONSTRAINT ck_booking_note_body
  CHECK (length(btrim(body)) > 0);
ALTER TABLE due_item ADD CONSTRAINT ck_due_item_amount
  CHECK (amount > 0);
ALTER TABLE due_item ADD CONSTRAINT ck_due_item_amount_paid
  CHECK (amount_paid >= 0 AND amount_paid <= amount);
ALTER TABLE due_item ADD CONSTRAINT ck_due_item_status
  CHECK ((status = 'PENDING'         AND amount_paid = 0)
      OR (status = 'PARTIALLY_PAID'  AND amount_paid > 0 AND amount_paid < amount)
      OR (status = 'PAID'            AND amount_paid = amount));

-- ---------- Ledger ----------
ALTER TABLE payment ADD CONSTRAINT ck_payment_amount
  CHECK (amount > 0);
ALTER TABLE payment ADD CONSTRAINT ck_payment_void_fields
  CHECK ((status = 'VOIDED') = (void_reason IS NOT NULL
                                AND voided_at IS NOT NULL
                                AND voided_by IS NOT NULL));
ALTER TABLE payment_allocation ADD CONSTRAINT ck_allocation_amount
  CHECK (amount > 0);

-- ---------- Cashbook ----------
ALTER TABLE cash_category ADD CONSTRAINT ck_cash_category_name
  CHECK (length(btrim(name)) > 0);
ALTER TABLE cash_entry ADD CONSTRAINT ck_cash_entry_amount
  CHECK (amount > 0);
ALTER TABLE cash_entry ADD CONSTRAINT ck_cash_entry_void_fields
  CHECK ((status = 'VOIDED') = (void_reason IS NOT NULL
                                AND voided_at IS NOT NULL
                                AND voided_by IS NOT NULL));
ALTER TABLE cash_entry ADD CONSTRAINT ck_cash_entry_linked
  CHECK (linked_payment_id IS NULL OR direction = 'IN');

-- ---------- Reminders ----------
ALTER TABLE reminder_template ADD CONSTRAINT ck_reminder_template_milestone
  CHECK (milestone IN (10, 7, 3, 0));
ALTER TABLE reminder_template ADD CONSTRAINT ck_reminder_template_body
  CHECK (length(btrim(body)) > 0);
ALTER TABLE provider_config ADD CONSTRAINT ck_provider_config_live
  CHECK (is_live = false OR (provider_name <> 'dry-run' AND is_enabled));
ALTER TABLE reminder_claim ADD CONSTRAINT ck_reminder_claim_milestone
  CHECK (milestone IN (10, 7, 3, 0));
ALTER TABLE reminder_claim ADD CONSTRAINT ck_reminder_claim_attempts
  CHECK (attempts BETWEEN 0 AND 3);
ALTER TABLE reminder_claim ADD CONSTRAINT ck_reminder_claim_terminal
  CHECK (status <> 'SENT' OR attempts >= 1);
ALTER TABLE reminder_log ADD CONSTRAINT ck_reminder_log_milestone
  CHECK (milestone IN (10, 7, 3, 0));
ALTER TABLE reminder_log ADD CONSTRAINT ck_reminder_log_attempt
  CHECK (attempt >= 1);
ALTER TABLE reminder_log ADD CONSTRAINT ck_reminder_log_claim
  CHECK ((status = 'SKIPPED') = (claim_id IS NULL));

-- ---------- Audit ----------
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_log_action_code
  CHECK (action_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_log_ip_format
  CHECK (ip IS NULL OR family(ip::inet) IN (4, 6));

-- ---------- Core ----------
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_size
  CHECK (byte_size > 0);
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_sha256
  CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_dims
  CHECK ((width_px IS NULL) = (height_px IS NULL)
         AND (width_px IS NULL OR (width_px > 0 AND height_px > 0)));
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_key
  CHECK (storage_key ~ '^(MASTER_PLAN|BUYER_PHOTO|COMPANY_LOGO)/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\.[a-z0-9]{1,5}$');
ALTER TABLE job_run ADD CONSTRAINT ck_job_run_finish
  CHECK ((status = 'RUNNING') = (finished_at IS NULL));
ALTER TABLE job_run ADD CONSTRAINT ck_job_run_error
  CHECK (status <> 'FAILED' OR error_message IS NOT NULL);
```

Two details a reviewer should not "simplify":

- `family(ip::inet)` intentionally uses a cast in a CHECK. Invalid text raises `22P02` and aborts the write — exactly the desired outcome, and the only way to validate both IPv4 and IPv6 correctly without a hand-rolled regex.
- The `due_item` status check is an equivalence, not a hint: a row where `amount_paid = amount` but `status = 'PENDING'` is rejected. The service may update the two columns in either order inside one `UPDATE`, so they are always written together.


### 6.4 Append-only and immutability triggers

Three guard triggers. They run for every role, including the table owner, so they are the guarantee that survives a psql mistake; the grants in §8 are the second line of defence.

```sql
-- ARCHITECTURE §13.3: audit rows are written once and never touched again.
CREATE FUNCTION spm_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION spm_audit_log_append_only();

-- ARCHITECTURE §5.5: a payment is never edited after posting. Only the void
-- transition may change anything, and a voided payment is frozen.
CREATE FUNCTION spm_payment_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VOIDED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'payment % is already voided and cannot change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'payment % is append-only: only the void columns may change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_payment_immutable
  BEFORE UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION spm_payment_immutable();

-- ARCHITECTURE §5.6 / Q-2: a cash entry is never edited; correction is void + repost.
CREATE FUNCTION spm_cash_entry_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VOIDED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'cash_entry % is already voided and cannot change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.cash_category_id IS DISTINCT FROM OLD.cash_category_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.linked_payment_id IS DISTINCT FROM OLD.linked_payment_id
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'cash_entry % is append-only: only the void columns may change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_cash_entry_immutable
  BEFORE UPDATE ON cash_entry
  FOR EACH ROW EXECUTE FUNCTION spm_cash_entry_immutable();
```

**Why there is no DELETE trigger on `payment` / `cash_entry`:** DELETE is removed at the role level (§8), and `spm_app` does not own the tables, so grants apply to it. A row trigger would add nothing for the only role that can reach the table; `TRUNCATE` likewise requires ownership, which `spm_app` does not have. The audit trigger exists as well as the grant because audit rows are the accountability record itself — defence in depth there is worth the three lines.

**Trigger caveat, stated honestly:** a superuser can `ALTER TABLE … DISABLE TRIGGER`, and `session_replication_role = replica` skips triggers. Both require privileges the application role does not have; neither is reachable through the app (`ARCHITECTURE.md` §14.6).

### 6.5 The `updated_at` trigger

Prisma's `@updatedAt` sets the column on every Prisma write. The trigger makes the same guarantee for any hand-written SQL that touches the same rows — a data fix, a backfill, or a migration.

```sql
CREATE FUNCTION spm_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'company', 'project', 'block', 'plot', 'buyer', 'booking',
    'payment_plan', 'due_item', 'cash_category', 'reminder_template',
    'provider_config', 'reminder_claim', 'app_setting'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION spm_set_updated_at()', t);
  END LOOP;
END $$;
```

Fourteen tables now carry the trigger, including `payment_plan`, which Q-1 allows to be rewritten before the first payment is recorded. The remaining twelve deliberately do not: the four append-only/void-only tables (`payment`, `payment_allocation`, `cash_entry`, `audit_log`), the event/history tables (`session`, `login_throttle`, `plot_status_history`, `booking_note`, `file_object`, `job_run`), and `booking_buyer` (edits replace rows via delete+insert, never `UPDATE`) with `reminder_log` (insert-only, one row per attempt or skip). That accounts for all 26 tables.

### 6.6 Functions and sequence

#### Polygon validation

```sql
CREATE FUNCTION spm_polygon_ok(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  n integer;
  i integer;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric;
  twice_area numeric := 0;
BEGIN
  IF jsonb_typeof(p) <> 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(p);
  IF n < 3 THEN
    RETURN false;
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    IF jsonb_typeof(p -> i) <> 'array' OR jsonb_array_length(p -> i) <> 2 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof((p -> i) -> 0) <> 'number' OR jsonb_typeof((p -> i) -> 1) <> 'number' THEN
      RETURN false;
    END IF;
    x1 := ((p -> i) ->> 0)::numeric;
    y1 := ((p -> i) ->> 1)::numeric;
    IF x1 < 0 OR x1 > 1 OR y1 < 0 OR y1 > 1 THEN
      RETURN false;
    END IF;
    x2 := ((p -> ((i + 1) % n)) ->> 0)::numeric;
    y2 := ((p -> ((i + 1) % n)) ->> 1)::numeric;
    twice_area := twice_area + (x1 * y2 - x2 * y1);
  END LOOP;
  RETURN abs(twice_area) > 1e-9;
END $$;
```

- Coordinates are **normalized** to `[0,1]` (PRD §13, `ARCHITECTURE.md` §3.4 / ADR-17), so no image dimensions are needed here.
- The shoelace sum is twice the signed area; `abs(…) > 1e-9` rejects degenerate, collinear and duplicate-point polygons without floating-point noise (the values are `numeric`).
- `STRICT` means `NULL` in → `NULL` out; the CHECK passes on `NULL` polygon, which is intended (a plot may exist before it is drawn).
- The function is `IMMUTABLE`, so it can be used in the CHECK and in queries. A future expression index on `polygon` would be legal.

#### Booking reference sequence

```sql
CREATE SEQUENCE booking_ref_seq AS bigint START WITH 1001 INCREMENT BY 1 NO CYCLE;

ALTER TABLE booking
  ALTER COLUMN booking_ref
  SET DEFAULT ('BK-' || nextval('booking_ref_seq'));
```

- `BK-1001`, `BK-1002`, … Human-facing and unique forever (`uq_booking_ref`).
- Sequences are **not transactional**: a rolled-back booking consumes a number and leaves a gap. That is correct — the reference is an identifier, not a count, and gapless numbering would require a lock (DQ-11).
- The column is `NOT NULL`. If a future data import supplies explicit references, it may pass them and the sequence is advanced with `setval` afterwards.

### 6.7 Cross-row invariants that are deliberately not constraints

A CHECK cannot see other rows; a trigger that did so would run inside the booking/payment transaction and turn a data invariant into a lock-contention and deadlock source. These are enforced where `ARCHITECTURE.md` says they are enforced.

| Invariant | Enforcement | Nightly proof |
|---|---|---|
| Sum of due items = `sale_price_pkr`, with the final installment absorbing rounding | Plan command + property tests (`ARCHITECTURE.md` §12.6) | — (checked in tests, not nightly) |
| Buyer shares total exactly 100 and exactly one primary | Booking command under lock | Check 4 |
| Allocation ≤ due item's remaining amount; Σ allocations ≤ payment amount | Ledger command, booking lock (`ARCHITECTURE.md` §12.2) | Checks 1 and 8 |
| Due-item `amount_paid` = sum of non-voided allocations | Ledger command; `due_item` update in the same transaction | Check 1 |
| Every payment has exactly one linked cash entry, and vice versa | Ledger/Cashbook command, same transaction | Check 5 |
| Plot status agrees with the active booking | Sales + Inventory in one transaction | Check 2 |
| At most one `CONFIRMED` booking per plot | **Partial unique index** (§6.1) | Check 3 (proves the index) |
| Recovery outstanding = sum of open due items | Computed on read, no cache (`ARCHITECTURE.md` §11.1) | Check 8 |
| No duplicate reminder milestone | **Unique index** (§6.2) | — |
| Files referenced by rows exist and match a sampled hash | Upload pipeline + GC `exists()` check | Check 6 |

---

## 7. Indexes by access pattern

The rule is simple: **one index per real query, none for a query that does not exist.** At the projected volume (≤ 3,000 plots, ≤ 10,000 bookings, ≤ 200,000 due items and payments over the system's life) the danger is not a missing index but a write path slowed by decorative ones. Every index below is justified by a screen or a job named in `ARCHITECTURE.md` §15.1.

### 7.1 Targets

| Target (`ARCHITECTURE.md` §15.1) | Access path | Index used |
|---|---|---|
| Login < 500 ms | `app_user` by lower-case email | `uq_app_user_email` |
| Every authenticated request | `session` by token hash, unexpired | `uq_session_token_hash` |
| Plot list < 2 s | `plot` by project (+ status), ordered by plot number | `ix_plot_project_status`, then `uq_plot_project_number` for order |
| Map, 3,000 polygons | all active plots of one project | `ix_plot_project_active` (filter), heap for `polygon` |
| Booking list < 2 s | `booking` by status, newest first | `ix_booking_status_date` |
| Booking detail | `booking` by plot; `due_item` by booking | `ix_booking_plot`, `uq_due_item_booking_sequence` |
| Buyer detail | bookings by primary buyer; phone lookup | `ix_booking_primary_buyer`, `ix_buyer_phone` |
| Recovery < 2 s | open `due_item` rows joined to `CONFIRMED` bookings | `ix_due_item_open`, `ix_booking_status_date` |
| Record payment < 1 s | booking by PK, due items by `(booking_id, sequence)`, allocations insert | PK, `uq_due_item_booking_sequence`, `uq_allocation_pair` |
| Reports < 2 s at 200k entries | `cash_entry` by status and date range | `ix_cash_entry_status` |
| Roznamcha day view | `cash_entry` by date, running order | `ix_cash_entry_date` |
| Reminder tick < 60 s / 50 items | unpaid due items in the milestone window, minus existing claims | `ix_due_item_open`, `uq_reminder_claim_due_item_milestone` (anti-join) |
| Retry sweep / stale claims | claims by status and next attempt | `ix_reminder_claim_retry` |
| Audit Log pagination | `audit_log` newest first | `ix_audit_log_time` |
| Booking timeline | `audit_log` by booking | `ix_audit_log_booking` |
| Reminder Log | `reminder_log` by due item / status | `ix_reminder_log_due_item`, `ix_reminder_log_status_time` |

### 7.2 The five paths that decide whether the schema is indexed correctly

**Plot list** — filter, then order, then page:

```sql
SELECT id, plot_number, block_id, size_marla, price_pkr, status
FROM plot
WHERE project_id = $1 AND is_active
ORDER BY plot_number
LIMIT 50 OFFSET $2;
```

`ix_plot_project_status (project_id, status)` serves the filtered variant (`AND status = $3`); the unfiltered variant uses `ix_plot_project_active (project_id, is_active)`. Ordering is satisfied by `uq_plot_project_number (project_id, plot_number)`. Twenty-five pages of 50 at 3,000 rows: the sort is trivial even if the planner chooses it.

**Booking list** — status filter plus a date sort:

```sql
SELECT b.id, b.booking_ref, b.booking_date, b.status, p.plot_number
FROM booking b
JOIN plot p ON p.id = b.plot_id
WHERE b.status = $1
ORDER BY b.booking_date DESC, b.id DESC
LIMIT 50;
```

`ix_booking_status_date (status, booking_date DESC)` returns rows in display order; the `id` tiebreaker is appended from the heap. The join is a PK lookup.

**Recovery — open balances** (the query behind PRD US-6.1):

```sql
SELECT d.id, d.due_date, d.amount, d.amount_paid, b.booking_ref
FROM due_item d
JOIN booking b ON b.id = d.booking_id
WHERE b.status = 'CONFIRMED'
  AND d.status <> 'PAID'
  AND d.due_date <= $1
ORDER BY d.due_date
LIMIT 50;
```

`ix_due_item_open (due_date) WHERE status <> 'PAID'` gives the range in order without touching paid rows; the join to `booking` is by PK and the `status` filter is a cheap recheck on 10,000 rows. A composite `(due_date, booking_id)` would not help: the join is already indexed on the other side.

**Cash flow — date range** (PRD US-7.1, `ARCHITECTURE.md` §11.2):

```sql
SELECT entry_date, direction, cash_category_id, amount
FROM cash_entry
WHERE status = 'POSTED' AND entry_date BETWEEN $1 AND $2
ORDER BY entry_date, id;
```

`ix_cash_entry_status (status, entry_date)` performs the range scan; the `ORDER BY` also needs `id`, which the index does not carry, so the planner sorts the (small) result or walks `ix_cash_entry_date (entry_date, id)` and filters `status`. At 200k rows both plans are milliseconds; explain-analyze is part of the perf test. Categories are resolved by PK from `cash_category` (a handful of rows, cached by the service).

**Reminder eligibility** (`ARCHITECTURE.md` §10.5):

```sql
SELECT d.id, d.due_date, d.amount - d.amount_paid AS remaining, b.id AS booking_id
FROM due_item d
JOIN booking b ON b.id = d.booking_id
WHERE b.status = 'CONFIRMED'
  AND d.status <> 'PAID'
  AND d.due_date <= $1 + 10
  AND d.due_date >= $1
  AND NOT EXISTS (
    SELECT 1 FROM reminder_claim c
    WHERE c.due_item_id = d.id AND c.milestone = $2
  )
ORDER BY d.due_date
LIMIT 50;
```

The partial index returns candidates; the anti-join is an index-only probe on `uq_reminder_claim_due_item_milestone`. This is why the claim uniqueness constraint is also the scheduler's performance mechanism — it does two jobs with one index.

### 7.3 Foreign keys without an index

Thirteen columns reference another table but are never predicates, so they carry no index: `payment.voided_by`, `cash_entry.voided_by`, `booking.cancelled_by`, `reminder_template.updated_by`, `provider_config.updated_by`, `app_setting.updated_by`, `file_object.uploaded_by`, `company.logo_file_id`, `project.master_plan_file_id`, `buyer.photo_file_id`, `booking_note.author_user_id`, `plot_status_history.actor_user_id`, `reminder_log.claim_id`.

The cost of leaving them unindexed is real but bounded: a parent `DELETE` would scan the child table for each of these. None of those parents is ever deleted (`ARCHITECTURE.md` §12.8; grants in §8 deny it), and every one of these columns is displayed, not filtered. Adding indexes would slow the insert path — including `audit_log`-adjacent writes — for queries that do not exist. If a screen later needs "everything user X voided", add the index with that screen, not now.

### 7.4 What is not indexed, deliberately

- **`plot.polygon`.** The map endpoint selects all polygons of one project and streams them; an index on a JSONB geometry would not make the payload smaller. `ix_plot_project_active` picks the rows.
- **`due_item.label`, `description`, `notes`, `body` and other free text.** No full-text search in the MVP.
- **`audit_log.summary`.** Read only for rows already found by time/actor/entity.
- **`reminder_log.rendered_body`.** Same.
- **`company`.** One row; every query is a sequential scan of one page.
- **`app_setting`.** Keyed by PK; a handful of rows, cached at startup.

---

## 8. Roles and grants

Two roles, exactly as `ARCHITECTURE.md` §14.6. `spm_migrator` owns every object and is used only by the migrate container; `spm_app` is the only role the web and worker processes use, and it owns nothing. Ownership matters: a table owner bypasses its own grants, so the application must never own a table.

### 8.1 Cluster and database (run once, as superuser)

```sql
CREATE ROLE spm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE spm_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';

CREATE DATABASE spm OWNER spm_migrator;
```

Passwords are supplied by `psql -v` from the deployment secret store; they never appear in a migration, the repository, or this document. `pg_hba.conf` allows both roles only from the Compose network (`ARCHITECTURE.md` §14.1: no database port is exposed).

`spm_migrator` is `NOCREATEDB` on purpose: production runs only `prisma migrate deploy`, which needs no shadow database. Local `prisma migrate dev` needs one, so developers run it against their own superuser role (or a separate `spm_dev` with `CREATEDB`); the production role is never used for that.

### 8.2 Schema and default privileges (run as `spm_migrator`, after every deploy)

```sql
-- The app role may use the schema but not create in it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO spm_app;

-- Future objects created by migrations inherit these.
ALTER DEFAULT PRIVILEGES FOR ROLE spm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE spm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO spm_app;

-- Existing objects (the migration has already run).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spm_app;

-- The migration bookkeeping table is not application data.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON _prisma_migrations FROM spm_app';
  END IF;
END $$;
```

The `DO` block is a guard, not decoration: Prisma creates `_prisma_migrations` during the first `migrate deploy`, and the grants script runs **after** migrations (§10), so the table exists on every normal run; the guard keeps a bootstrap run on a fresh cluster from failing. Wrapped in a transaction, the whole script is idempotent.

### 8.3 Removing the dangerous privileges

```sql
-- ARCHITECTURE §14.6 and §12.8: no DELETE on financial rows. The additional
-- tables are the ones §1.6 declares never-deleted or append-only.
REVOKE DELETE ON
  payment, payment_allocation, cash_entry, due_item, audit_log,   -- `ARCHITECTURE.md` §14.6 list
  booking, buyer, project, company, app_user, payment_plan,       -- never deleted
  plot_status_history, booking_note, reminder_claim               -- append-only
FROM spm_app;

-- Write-once tables: no UPDATE at all.
REVOKE UPDATE ON
  audit_log, payment_allocation, plot_status_history, booking_note, reminder_log
FROM spm_app;

-- No bulk destruction and no schema changes.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM spm_app;
REVOKE CREATE  ON SCHEMA public FROM spm_app;
```

Notes on what remains deliberately allowed:

- **`payment` and `cash_entry` keep `UPDATE`** because the void transition is an update. The column-scoped triggers (§6.4) make only the void columns writable, so the grant plus the trigger is the whole rule.
- **`due_item` keeps `UPDATE`** for `amount_paid` and `status` (the only mutable columns, §1.6).
- **`booking` keeps `UPDATE`** for cancellation and Q-1 edits; it loses `DELETE`.
- **`reminder_claim` keeps `UPDATE`** for status/attempt bookkeeping; it loses `DELETE`.
- **`booking_buyer` keeps `DELETE`** because the Q-1 edit path replaces the buyer set; the command is audited.
- **`file_object`, `session`, `login_throttle`, `job_run` keep `DELETE`** for the GC/cleanup jobs (§1.6).
- **`provider_config.secret_ciphertext`** has no column-level revoke. Prisma's `UPDATE … RETURNING` needs `SELECT` on the column, so a grant-level "write-only" would break legitimate writes; the guarantee is enforced in the service by omitting the column from every read and every serialized response (Q-7). Without the environment key the ciphertext is useless, and the database is loopback-only.

### 8.4 Verification query

Run after every deploy; it must return zero rows.

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'spm_app'
  AND (
    (privilege_type = 'DELETE' AND table_name IN
      ('payment','payment_allocation','cash_entry','due_item','audit_log',
       'booking','buyer','project','company','app_user','payment_plan','plot_status_history','booking_note','reminder_claim'))
    OR
    (privilege_type = 'UPDATE' AND table_name IN
      ('audit_log','payment_allocation','plot_status_history','booking_note','reminder_log'))
  );
```

A second check belongs in the same script: `SELECT has_schema_privilege('spm_app','public','CREATE')` must be false.

---

## 9. Reference and seed data

Seeds are **data the system cannot start without**, applied as an idempotent migration (§10) and therefore identical in every environment. They are not demo data; there is no demo data in this repository.

### 9.1 Cash categories

```sql
INSERT INTO cash_category (id, name, nature, is_active) VALUES
  (gen_random_uuid(), 'Opening Balance', 'OPENING', true),   -- Q-6, ARCHITECTURE §11.7
  (gen_random_uuid(), 'Booking Receipt', 'INCOME', true),    -- target of auto-posted receipts
  (gen_random_uuid(), 'Refund',          'EXPENSE', true),   -- Q-9, manual Out entry
  (gen_random_uuid(), 'Office Expense',  'EXPENSE', true),   -- PRD §13 seed list
  (gen_random_uuid(), 'Utilities',       'EXPENSE', true),
  (gen_random_uuid(), 'Travel',          'EXPENSE', true),
  (gen_random_uuid(), 'Marketing',       'EXPENSE', true),
  (gen_random_uuid(), 'Other',           'EXPENSE', true)
ON CONFLICT ((lower(name))) DO NOTHING;
```

- **Opening Balance** is the one category with nature `OPENING`; reporting adds its entries to the opening position and excludes them from in/out and income (`ARCHITECTURE.md` §11.7). The category is seeded here; the single entry is posted by the Accountant on the day before go-live.
- **Booking Receipt** is required because `cash_entry.cash_category_id` is `NOT NULL` and every payment auto-posts an In entry (`ARCHITECTURE.md` §5.6). It is the one seed entry **not named in the PRD**; see DQ-13.
- **Refund** is `EXPENSE`, not a fourth nature (Q-9). A refund is a manual Out entry with no payment link.
- All eight are `is_active = true`. Categories in use are deactivated, never deleted (§1.6).
- Income entries not tied to a payment (e.g. a bank profit credit) would need another `INCOME` category; that is a two-minute Settings task, not a schema change.

### 9.2 Reminder templates

```sql
INSERT INTO reminder_template (id, channel, milestone, body, is_active) VALUES
  (gen_random_uuid(), 'SMS', 10,
   'Dear {{buyer_name}}, this is a reminder from {{company}} that the installment for plot {{plot}} in {{project}} is due on {{due_date}}. Amount due: {{amount}}. Please ignore this message if you have already paid.', true),
  (gen_random_uuid(), 'SMS', 7,
   'Dear {{buyer_name}}, a reminder from {{company}}: {{amount}} for plot {{plot}} ({{project}}) is due on {{due_date}}. Please contact our office if you have already paid.', true),
  (gen_random_uuid(), 'SMS', 3,
   'Dear {{buyer_name}}, your installment of {{amount}} for plot {{plot}} ({{project}}) is due in 3 days, on {{due_date}}. — {{company}}', true),
  (gen_random_uuid(), 'SMS', 0,
   'Dear {{buyer_name}}, your installment of {{amount}} for plot {{plot}} ({{project}}) is due today, {{due_date}}. — {{company}}', true)
ON CONFLICT (channel, milestone) DO NOTHING;
```

- **Starter copy**, deliberately plain and English-only (PRD D-6, Q-8). It is editable in Settings, and **the wording is not a product decision** — it exists so that a fresh install can pass a dry run without an Admin writing four templates first.
- Every placeholder used is on the allowlist of `ARCHITECTURE.md` §10.8. No CNIC, address or photo reference appears.
- Only `SMS` rows are seeded. WhatsApp templates need provider approval (`ARCHITECTURE.md` §10.8, R-4) and are entered when that channel is switched on; seeding an unapproved WhatsApp body would invite a failing send.

### 9.3 Provider configuration

```sql
INSERT INTO provider_config (id, channel, provider_name, is_enabled, is_live, updated_by)
VALUES (gen_random_uuid(), 'SMS', 'dry-run', true, false, NULL)
ON CONFLICT (channel) DO NOTHING;
```

The default is **dry run** (`ARCHITECTURE.md` §10.9): the row exists so Settings can render, and `is_live = false` means no provider call and no claim. Flipping it to live is an explicit Admin action after the provider account and consent capture exist (PRD D-6, `ARCHITECTURE.md` §16 R-4).

### 9.4 The system actor

No `app_user` row is seeded for the system, and none should be.

- Audit rows for worker actions use `actor_user_id = NULL` and `actor_label = 'system'` (or `'worker'`), exactly as `ARCHITECTURE.md` §13.6 specifies. A fake user row would appear in the Users screen, would need a password no one should know, and would blur "who did this".
- Auto-posted cash entries copy the payment's `recorded_by`, because the human who recorded the payment is the accountable actor. The cash entry is never posted by "the system" alone.
- `job_run` has no actor column; the job name and `triggered_by` identify the execution.

### 9.5 What is deliberately not seeded

| Not seeded | Reason |
|---|---|
| `company` | First-run setup collects the real name, logo and terms; a placeholder would print on a buyer's PDF if setup were skipped |
| `project`, `block`, `plot` | Inventory is the client's data |
| `app_user` | The first Admin is created by the go-live runbook with a real password and forced change (`ARCHITECTURE.md` §14.10); no default credentials exist |
| `app_setting` | Operational defaults live in environment configuration (`core/config`), validated at boot; duplicating them in two places invites drift |
| Any buyer, booking, payment | Never seed financial data |

---

## 10. Migration sequencing

Prisma Migrate is the only migration runner (`ARCHITECTURE.md` §3.4, §14.2). Hand-written SQL is placed in ordinary Prisma migrations, so there is one history, one lock and one `migrate deploy`. Nothing is applied by hand to a deployed database.

### 10.1 The migration set

| Migration | Contents | Author |
|---|---|---|
| `0001_init` | Enums (§4), all 26 tables, PKs, FKs, Prisma-declared uniques, plain btree indexes | Generated by `prisma migrate dev` |
| `0002_sql_functions_sequence` | `spm_polygon_ok()`; `booking_ref_seq` and the `booking_ref` default (§6.6) | Hand-written |
| `0003_sql_partial_indexes` | `one_active_booking_per_plot`, `one_primary_buyer_per_booking`, the four partial scan indexes (§6.1) | Hand-written |
| `0004_sql_unique_indexes` | Idempotency, singleton, linked-payment, claim and category-name uniques (§6.2) | Hand-written |
| `0005_sql_checks` | All 48 `CHECK` constraints (§6.3) | Hand-written |
| `0006_sql_guard_triggers` | Append-only and immutability triggers and functions (§6.4) | Hand-written |
| `0007_sql_updated_at` | `spm_set_updated_at()` and its 14 triggers (§6.5) | Hand-written |
| `0008_seed_reference_data` | Cash categories, reminder templates, provider config (§9) | Hand-written, idempotent |

Folder names carry Prisma's timestamp prefix (`20261019120000_sql_checks`); the table uses the logical suffix for readability. Migration **files are never edited after they have been applied anywhere** — not in production, not in staging. A correction is a new migration.

### 10.2 Why this order

1. **Functions before the checks that call them.** `ck_plot_polygon` references `spm_polygon_ok`, so the function must exist first. PostgreSQL does not resolve function bodies at creation time, but it *does* resolve the function name when the CHECK is created.
2. **Sequence before the column default.** The default expression references the sequence by name.
3. **Indexes before triggers and seeds.** The unique indexes are part of the table's contract; they must exist before the application (or a seed) writes a row.
4. **Checks before triggers.** A check failure during the trigger migration would otherwise look like a trigger bug.
5. **Seeds last.** They depend only on tables and enums, and they are written with `ON CONFLICT DO NOTHING` so a retry after a partial failure is safe. (Prisma wraps each migration in a transaction, so a partial failure should not occur — but the seed is defensive because it may also be re-run manually in a fresh dev database.)

Every hand-written migration is written to be **backward-compatible for one release** (`ARCHITECTURE.md` §14.3): it adds objects, never removes or renames them. That is what makes an image rollback safe without a down-migration.

### 10.3 The Prisma drift rule

`prisma migrate dev` compares the Prisma schema with the migration history. Objects that exist only in hand-written SQL are invisible to `schema.prisma`, so a later generated migration will contain statements such as:

```sql
DROP INDEX "one_active_booking_per_plot";
ALTER TABLE "payment" DROP CONSTRAINT "ck_payment_amount";
DROP TRIGGER "trg_audit_log_append_only" ON "audit_log";
```

**Those statements are deleted from the generated migration before it is committed.** They are a Prisma limitation, not a schema change (§1.8). Three consequences:

- **`prisma db push` is forbidden** in every environment, including local. It would drop every object in §6.
- **`prisma db pull` is not used** to regenerate the schema; it cannot represent checks or partial indexes and would produce a misleading model.
- The developer checklist for any schema change ends with: `prisma migrate dev --create-only`, inspect the SQL, delete any drop of a §6 object, add the new SQL in a **separate** migration, run `migrate deploy` on a clean database, then run the integration suite.

CI must apply the whole history to an empty PostgreSQL 17 service container on every pull request (`ARCHITECTURE.md` §14.3). That is the check that catches a missing or misordered hand-written migration.

### 10.4 Deploy sequence

```text
docker compose run --rm migrate
  1. prisma migrate deploy                 -- schema + hand-written SQL + seeds
  2. psql -f prisma/sql/grants.sql          -- §8.2–§8.3, idempotent, as spm_migrator
  3. psql -f prisma/sql/verify_grants.sql   -- §8.4, must return zero rows
docker compose up -d web worker
```

- The migrate container runs **once**, before web and worker start (`ARCHITECTURE.md` §14.2, §14.3).
- The grants script is re-run on every deploy because `ALTER DEFAULT PRIVILEGES` grants `DELETE` to `spm_app` on **new** tables; the revokes must be re-applied after any migration that creates one.
- A failed verification query fails the deploy and the previous image keeps serving.
- No application code creates roles, grants or extensions. `gen_random_uuid()` is built into PostgreSQL 13+ (the `pgcrypto` function of the same name is obsolete), so the migrations create **no extension**. If a future feature needs one, it gets its own migration and a line in §8.2 so `spm_app` can execute it.

### 10.5 Rollback

- **Application rollback:** set `TAG` to the previous SHA and `docker compose up -d web worker`. The schema is untouched because every migration is additive for one release.
- **A failed migration:** Prisma marks it failed and refuses to continue. Because each migration runs in a transaction, the database is unchanged; fix the SQL forward, or, if it was applied outside a transaction, revert manually and use `prisma migrate resolve --rolled-back <name>`.
- **A bad seed:** correct the row by a new migration, never by editing the applied one. Seeds are idempotent, so re-running is safe.
- **A dropped object:** does not happen in a rollback window. Removing a column or table requires a two-release cycle: stop writing it, deploy, then drop in the next release.

### 10.6 What does not belong in a migration

- Business data fixes (a wrong price, a mis-posted payment): those are audited application commands, not schema history.
- Credentials, provider keys, passwords: the cluster roles are created outside migrations (§8.1); secrets come from the environment.
- Demo or test fixtures: integration tests create their own data and roll back.
- `CREATE INDEX CONCURRENTLY`: it cannot run inside Prisma's migration transaction. At this scale a plain `CREATE INDEX` takes milliseconds on an empty or small table, and deploys happen outside business hours (`ARCHITECTURE.md` §14.3).

---

## 11. Open questions

These are **schema-level** questions that `PRD.md` and `ARCHITECTURE.md` leave genuinely open. Each has a proposed default that this document follows; none changes product behavior, and none blocks implementation. The format matches `ARCHITECTURE.md` §19.

| # | Question | Proposed default | Impact if changed |
|---|---|---|---|
| DQ-1 | When `plot.width_ft × depth_ft` and `plot.dimensions_text` disagree, which is printed? | `dimensions_text` wins when non-null; otherwise the computed product is formatted. Both are stored | PDF copy, Plot Details label; no schema change |
| DQ-2 | Does `buyer.consent_recorded_at` mean the first capture or the latest change? | **Latest** decision. `NULL` means "never asked"; `false` with a timestamp means "asked and declined" (the CHECK permits both) | Consent audit semantics; reminder eligibility is unaffected (it reads `consent_sms`) |
| DQ-3 | The plan snapshot is a table (`payment_plan`) in ARCHITECTURE but a set of booking fields in PRD §13. Which is canonical? | The 1:1 `payment_plan` table is canonical; `booking.sale_price_pkr` stays on the booking. No field is duplicated | Merging them into `booking` would be a migration plus service change; behavior identical |
| DQ-4 | Should a cash entry optionally carry a `project_id`? | **No.** The cash book is company-wide (Q-5) and every PRD report is company-wide | Adding it later is a nullable column and a report filter; no data loss |
| DQ-5 | How long is `reminder_log` retained? | Indefinitely (PRD has no retention requirement; volume is trivial — typically ≤4 rows per due item, more only on retries) | A prune job and a retention policy; audit-adjacent history would be lost |
| DQ-6 | How long is `job_run` retained? | Prune `SUCCEEDED` rows after 90 days; keep `FAILED` rows for one year | Storage only; no behavior |
| DQ-7 | Are `booking_note` rows editable? | **No** — append-only, no edit or delete path in the MVP. A correction is a new note | Editing UI and an audit event per edit; the grant in §8.3 would be relaxed |
| DQ-8 | Surrogate or composite primary key for `payment_allocation`? | Surrogate `uuid` PK plus `UNIQUE (payment_id, due_item_id)`; composite only for `booking_buyer` (§1.2) | Pure DDL; no behavior |
| DQ-9 | Why `bigserial` for `audit_log.id` when every other PK is a UUID? | Monotonic, compact, and the natural `(occurred_at DESC, id DESC)` tiebreaker (`ARCHITECTURE.md` §13.2). It is never exposed in a URL | Switching to UUID would cost index size and pagination stability |
| DQ-10 | `ARCHITECTURE.md` §13.2 sketches `ip inet`; this schema uses `varchar(45)` | `varchar(45)` with a `family(…::inet)` CHECK. Prisma cannot read/write `inet` through its typed client (§1.9) | Changing to `inet` is a column type migration; no application change if Prisma ever supports it |
| DQ-11 | Can `booking_ref` have gaps? | **Yes.** `BK-1001` upward; a rolled-back booking consumes its number. The reference is an identifier, not a count | Gapless numbering would need a lock or a counter table; reports that count bookings must count rows |
| DQ-12 | Should reminder milestones be an enum? | **No** — `smallint` 10/7/3/0 with a CHECK. The value is used as `due_date - N days`, i.e. arithmetic (`ARCHITECTURE.md` §10.5) | An enum would add casts around every date calculation; the CHECK gives the same safety |
| DQ-13 | Which `cash_category` do auto-posted payment receipts use? | A single seeded `INCOME` category, **Booking Receipt**. PRD §13 seeds only expense categories and does not name it | If the client wants per-project or per-method income categories, auto-posting needs a mapping rule (one category per project/method) — a product decision, not a schema one |
| DQ-14 | Should buyer.phone accept only Pakistani (+92) numbers? | No — general E.164 (`ck_buyer_phone_e164`, §6.3). Overseas Pakistani (NRP) buyers often carry foreign numbers; SMS deliverability is a reminders-layer concern, not a reason to reject the buyer record | None — broadens who can be registered; no provider behavior changes until Reminders is live |

**Not open, and deliberately not asked again:** one confirmed booking per plot, void-only payments and cash entries, buyer consent as a structured boolean plus timestamp, company-wide cash book, price/plan edits only at zero payments, English-only reminders, ≤120 installments, dry-run by default. Those are decided in `ARCHITECTURE.md` §19 (Q-1–Q-13) and are implemented as written.

---

*End of DATABASE.md.*
