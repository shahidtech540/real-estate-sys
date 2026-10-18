# API — Society Plot Manager (SPM)

| | |
|---|---|
| **Document status** | **Draft for review — v1.0** |
| **Date** | 2026-10-19 |
| **Workflow step** | 5 of 20 |
| **Sources of truth** | `PRD.md` v1.0 · `ARCHITECTURE.md` v1.0 · `DATABASE.md` v1.0 (all merged to `main`) |
| **Scope** | The complete HTTP contract for the first-party web client. Every endpoint, role, payload, status code and database interaction the frontend needs for US-1.1 – US-7.2 and FR-1 – FR-9 |
| **Out of scope** | Public API, buyer portal, webhooks, GraphQL, offline sync, bulk import API, online payments (PRD §4) |

This document adds **no** product behavior, tables or columns. Every field below is a column in `DATABASE.md` §3 or a value derived from one; every state transition is one `ARCHITECTURE.md` §4/§5 already defines; every permission is a capability from `ARCHITECTURE.md` §6.2. Derived values are marked and listed in §8.2. Where the three source documents genuinely leave an API-level choice open, it is recorded in §7 rather than invented silently.

---

## 0. At a glance

| Concern | Decision |
|---|---|
| **Endpoints** | **81**: 5 auth (Identity's surface, §2) + 76 across the 12 modules of `ARCHITECTURE.md` §4.2 (§3), all listed with an ID (`AUTH-1` … `COR-4`) |
| **Base URL** | `/api` on the application origin (e.g. `https://spm.example.pk/api`); no separate API host |
| **Auth model** | Email + password → opaque 32-byte token in the `__Host-spm_session` cookie; **SHA-256 hash** stored in `session`; 30-minute idle / 12-hour absolute expiry; server-side revocation (`ARCHITECTURE.md` §6.1) |
| **Authorization** | Exactly three roles (`ADMIN`, `SALES_AGENT`, `ACCOUNTANT`) mapped to **23 capabilities** in one table (`ARCHITECTURE.md` §6.2). Every endpoint names its capability, with one documented exception (consent, API-Q1); the role never comes from the request |
| **Versioning** | **No URL version in the MVP.** One consumer, deployed from the same image (`ARCHITECTURE.md` §0, §3.2); additive changes only. A breaking change gets `/api/v2` and a coordinated frontend release — there is no third party to keep compatible |
| **Format** | JSON, UTF-8. Money, areas and percentages are **decimal strings**; dates are `YYYY-MM-DD`; timestamps are ISO-8601 UTC (`ARCHITECTURE.md` §12.6, §12.7, Appendix C) |
| **Errors** | One envelope for every failure: `{ "error": { "code", "message", "requestId", "fields" } }` (`ARCHITECTURE.md` Appendix A) |
| **Pagination** | **Offset** (`page`, `pageSize`, `total`) — §1.5 justifies it against `DATABASE.md` §7.2's actual query shapes |
| **Idempotency** | `clientRequestId` (UUID) in the body of the two money-moving creates: confirm booking and record payment (`ARCHITECTURE.md` §12.5). Replay → `200` + `Idempotent-Replay: true` |
| **Optimistic locking** | `version` in the body of every edit to `plot`, `buyer`, `booking`, `project`; `409 CONFLICT_STALE_WRITE` (`DATABASE.md` §1.7) |
| **Localization** | The API is **language-neutral**: stable enum values and error codes, never translated sentences. The EN/UR toggle is a client concern (`ARCHITECTURE.md` §9). PDFs are English-only (PRD A-3) |
| **Rate limits** | Login per IP (Nginx) and per account (Postgres); the four heavy endpoints are limited per user (§6) |
| **Not in this API** | Public registration, OAuth, API keys, CORS, bulk import, stored PDFs, manual reminder resend, overdue reminders, applying advance credit (§7, API-Q3) |

### 0.1 Endpoint count by module

| Module (`ARCHITECTURE.md` §4.2) | IDs | Endpoints |
|---|---|---|
| Auth (Identity surface) | AUTH-1 … AUTH-5 | 5 |
| Identity | IDN-1 … IDN-8 | 8 |
| Setup | SET-1 … SET-11 | 11 |
| Inventory | INV-1 … INV-12 | 12 |
| Sales | SAL-1 … SAL-13 | 13 |
| Ledger | LED-1 … LED-5 | 5 |
| Cashbook | CSH-1 … CSH-6 | 6 |
| Recovery | REC-1 … REC-3 | 3 |
| Reminders | REM-1 … REM-7 | 7 |
| Documents | DOC-1 … DOC-2 | 2 |
| Reporting | REP-1 … REP-2 | 2 |
| Audit | AUD-1 … AUD-3 | 3 |
| Core | COR-1 … COR-4 | 4 |
| **Total** | | **81** |

### 0.2 What the client should never do

- Never send a user id, role, project scope, actor name, timestamp or computed total that the server can derive. The session supplies the actor; the server computes money; timestamps are server-side.
- Never let client input be the server's record of a price, a plan calculation or an allocation. The wizard **may** preview a schedule with the shared `core/money` function (`ARCHITECTURE.md` §12.6), but the server recomputes and persists its own result.
- Never treat a hidden button as authorization. The capability check is server-side; `403 AUTH_FORBIDDEN` is the contract.

---

## 1. Conventions

### 1.1 Base URL, transport and versioning

- **Base:** `/api` on the same origin as the UI. No `api.` subdomain, no CORS, no credentials in URLs.
- **TLS only** (`ARCHITECTURE.md` §6.4). HTTP is redirected before it reaches the app.
- **No version segment.** The only consumer is the React client shipped from the same image (`ARCHITECTURE.md` §3.2); there is no public API (`ARCHITECTURE.md` §0). Adding fields, endpoints, enum values or optional request properties is non-breaking and ships in the same release. Removing or renaming anything, changing a meaning, or making an optional field required is breaking: it gets `/api/v2` and both prefixes run for one release. Documented here so the first breaking change is a decision, not a surprise.
- **Content type:** `application/json; charset=utf-8` for everything except uploads (`multipart/form-data`), PDFs (`application/pdf`) and CSV (`text/csv; charset=utf-8`).
- **No content negotiation.** The API never returns localized strings, so `Accept-Language` is ignored.
- **Request id:** every request gets an `X-Request-Id` response header (from the incoming header when present, otherwise generated, `ARCHITECTURE.md` §14.8). The same value appears in error bodies and server logs.

### 1.2 Resource naming and verbs

| Rule | Detail |
|---|---|
| Plural, kebab-case collections | `/api/plots`, `/api/cash-entries`, `/api/reminder-templates`, `/api/audit-logs` |
| One resource | `/api/plots/{id}` — ids are UUIDs except `booking_ref` |
| Booking references in paths | Any `{ref}` accepts the human key (`BK-1042`) **or** the UUID. The canonical URL uses the key (`ARCHITECTURE.md` Appendix C) |
| Sub-resources | `/api/bookings/{ref}/notes`, `/api/bookings/{ref}/documents/…`, `/api/bookings/{ref}/payments`, `/api/projects/{id}/blocks`, `/api/projects/{id}/map` |
| `GET` | Read only. **No GET has a side effect** — including session refresh, which is a `POST` |
| `POST` | Create (`201`) **or** a state transition on an existing resource (`200`) |
| `PATCH` | Partial update of mutable columns; requires `version` where the table has one (`DATABASE.md` §1.7) |
| `PUT` | Full replacement of a **sub-resource** whose identity is the parent + kind: company profile (singleton), a plot's polygon, a booking's buyer set, a project's master-plan binding |
| `DELETE` | Only where `DATABASE.md` §1.6 permits hard deletion: `block`, an unreferenced `plot`, a polygon (column clear). Financial and history rows have no DELETE endpoint by design |
| State-transition paths | `POST …/cancel`, `…/void`, `…/reserve`, `…/release`, `…/mark-sold`, `…/test`. REST has no noun for "cancel", and inventing `/cancellations` would obscure the one command; `ARCHITECTURE.md` §6.3 only requires that mutations are `POST`/`PATCH`/`DELETE`, which they are |

**No endpoint accepts a role, actor id or `created_by`.** Those come from the session. `company_id` is derived from the singleton company.

### 1.3 Status code policy

| Status | When | Body |
|---|---|---|
| `200 OK` | Read; successful state transition; **idempotent replay** of a create | Resource or command result |
| `201 Created` | A new row was created (`POST`, or the first `PUT` of a singleton) | The created resource, with `Location` |
| `204 No Content` | Successful mutation with nothing useful to return (logout, password change, delete, unlock) | Empty |
| `304 Not Modified` | `GET /api/files/{id}` with a matching `If-None-Match` | Empty |
| `400 Bad Request` | Malformed JSON, wrong type, missing required property, unknown property, invalid pagination values | `VALIDATION_FAILED` (+ `fields`) |
| `401 Unauthorized` | No cookie, unknown/expired/revoked session, bad credentials | `AUTH_*` |
| `403 Forbidden` | Authenticated but the capability is absent, the CSRF origin check failed, or a password change is pending | `AUTH_FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED` / `CSRF_ORIGIN_REJECTED` |
| `404 Not Found` | The addressed row does not exist (or is outside the singleton tenant scope, which does not exist here) | `<RESOURCE>_NOT_FOUND` |
| `405 Method Not Allowed` | A path exists but not for that verb | `METHOD_NOT_ALLOWED` |
| `409 Conflict` | State conflict, uniqueness conflict, optimistic-lock conflict, double void/cancel, linked-record refusal | Specific code |
| `413 Content Too Large` | Upload exceeds the Nginx 26 MB cap or the per-kind cap | `FILE_TOO_LARGE` |
| `415 Unsupported Media Type` | Magic bytes are not on the kind's allowlist | `FILE_TYPE_UNSUPPORTED` |
| `422 Unprocessable Entity` | The request is syntactically valid but violates a domain rule (shares ≠ 100, plan math, allocation, template placeholder, a non-positive amount) | Specific code + `fields` |
| `429 Too Many Requests` | Per-IP or per-account throttle, or a per-user heavy-endpoint limit; `Retry-After` is always set | `AUTH_ACCOUNT_THROTTLED` / `RATE_LIMITED` |
| `500 Internal Server Error` | Unexpected failure; no SQL/stack/provider text leaves the server | `INTERNAL` / `DOCUMENT_GENERATION_FAILED` |
| `503 Service Unavailable` | PDF semaphore queue is full, or the database is unavailable | `SERVER_BUSY` |

`400` vs `422` is the line between **shape** and **meaning**: `"sharePct": "abc"` is `400`; three buyers whose shares total 90 is `422 SHARE_TOTAL_INVALID`.

### 1.4 Error envelope

One shape for every failure (`ARCHITECTURE.md` Appendix A):

```json
{
  "error": {
    "code": "SHARE_TOTAL_INVALID",
    "message": "Buyer shares must total 100.00% (received 90.00%).",
    "requestId": "01JBF3Q8K9V2Z6T4R7M1X5C0AB",
    "fields": { "buyers": "SHARE_TOTAL_NOT_100" }
  }
}
```

| Property | Type | Rules |
|---|---|---|
| `code` | string | Stable `UPPER_SNAKE` identifier. The UI maps it to `errors.<code>` in the EN/UR catalogs — the **only** thing the UI is allowed to translate. Never changes meaning |
| `message` | string | English fallback for logs and developers. **Never shown verbatim** in the Urdu UI; the catalog wins |
| `requestId` | string | Correlates with `X-Request-Id` and the pino request context |
| `fields` | object \| absent | Field path → code. `"buyers[2].cnic": "FORMAT"`; nested paths use dots and bracket indices. Only for `400`/`422`, and only for errors a form can attach to a control |
| `fields.*` values | string | Short codes (`REQUIRED`, `FORMAT`, `TOO_LONG`, `EXISTS`, `STALE`, `NOT_100`, …), not sentences |

- `401` never reveals whether the email exists (`ARCHITECTURE.md` §6.1); the same `AUTH_INVALID_CREDENTIALS` is returned for an unknown email and a wrong password.
- `403` is returned **before** any row lookup when the capability is absent, so it cannot leak whether a plot/booking exists (`ARCHITECTURE.md` §6.3). The one kind-dependent read (COR-2) must load the row to learn its kind; the three roles hold all three read capabilities, so it has no denial path in the MVP.
- No stack traces, SQL, provider payloads or secrets in `message`. Those go to the structured log with the same `requestId` (`ARCHITECTURE.md` §14.8).

### 1.5 Pagination

**Offset pagination is the single convention**, with one shape everywhere:

```json
{ "data": [], "page": 1, "pageSize": 50, "total": 0 }
```

| Parameter | Default | Rules |
|---|---|---|
| `page` | `1` | ≥ 1; `page * pageSize` beyond `total` returns an empty page, not a `404` |
| `pageSize` | `50` | 1 … `100`; `400 VALIDATION_FAILED` outside the range |
| `sort` | Endpoint-specific | Whitelisted columns only; unknown → `400 VALIDATION_FAILED` (`fields.sort`) |
| `order` | `desc` for date-sorted lists, `asc` otherwise | `asc` \| `desc` |
| `total` | — | Exact count under the same filters |

**Why offset, against `DATABASE.md` §7.** The §7.2 query shapes are already written as `LIMIT … OFFSET …` for the plot list, and §7.1 justifies the indexes by page-sized screens: the ordered plot list is served by `uq_plot_project_number`, so the sort stays trivial at this volume. Every list the UI paginates is bounded by PRD §13's ceiling — ≤3,000 plots, ≤10,000 bookings, ≤25 staff (PRD A-1) — and the design uses numbered pages with a total (DESIGN tables). Keyset pagination would remove `total` and page numbers for no measurable gain; `ARCHITECTURE.md` Appendix D reserves the switch to keyset reads for 10× scale. The append-only streams (`audit_log`, `reminder_log`) keep a stable `(occurred_at DESC, id DESC)` order through their covering indexes (`ix_audit_log_time`, `ix_reminder_log_status_time`), so OFFSET is stable enough at this volume.

CSV and PDF responses are **never paginated**; they stream the full filtered result (`ARCHITECTURE.md` §11.5, §15.1).

### 1.6 Optimistic locking (`version`)

- `plot`, `booking`, `buyer` and `project` carry `version integer` (`DATABASE.md` §1.7). Every `PATCH`/`PUT` on them requires `version` in the body — the value the client loaded.
- The command is a compare-and-swap: `UPDATE … WHERE id = $1 AND version = $2`. Zero rows → `409 CONFLICT_STALE_WRITE`, `fields: { "version": "STALE" }`.
- The successful response returns the **new** `version`; the client replaces its copy rather than guessing.
- `company`, `cash_category`, `reminder_template` and `provider_config` have no `version` column. They are Admin-only, low-concurrency settings; the last write wins and is audited. Adding a version to them would be a `DATABASE.md` change, not an API-only decision.
- State transitions (`cancel`, `void`, `reserve`, `release`, `mark-sold`) are guarded by their current status, not by `version`; a double cancel/void is `409`, not a lost update (`ARCHITECTURE.md` §12.5).
- A Postgres deadlock would mean a bug in the fixed lock order (`plot → booking → due items → cash entry`, `ARCHITECTURE.md` §12.3). It is mapped to a retryable `409` `CONFLICT_RETRY` and logged as an anomaly; it is not a lost update and the client may simply resubmit.

### 1.7 Idempotency (`clientRequestId`)

| Command | Field | Unique key (`DATABASE.md` §6.2) | Replay result |
|---|---|---|---|
| `POST /api/bookings` | `clientRequestId` (UUID, required) | `uq_booking_idempotency (created_by, client_request_id)` | `200`, same booking, `Idempotent-Replay: true` |
| `POST /api/bookings/{ref}/payments` | `clientRequestId` (UUID, required) | `uq_payment_idempotency (recorded_by, client_request_id)` | `200`, same payment, `Idempotent-Replay: true` |

- The id is generated **when the form opens**, not on submit (`ARCHITECTURE.md` §12.5), so a retry after a timeout reuses it. The server never invents one for these two endpoints; a missing/invalid UUID is `400 VALIDATION_FAILED`.
- The key is unique **per actor**, matching the database. Two agents submitting the same UUID create two bookings; that is correct, because it is not the same request.
- A replay returns the original resource regardless of the body. The client contract is: reuse the key **only** for a retry of the identical payload. A different payload under the same key is a client bug and will return the old resource, not an error — the schema stores no request fingerprint, and inventing one would need a column.
- If the original attempt failed, no row exists; the key is free and the retry executes normally.
- Every other mutation is naturally guarded: void/cancel/reserve/release are status preconditions, and deactivation/unlock are idempotent by nature. Manual cash entries have **no** key (§7, API-Q6).

### 1.8 Serialization

| Value | Wire form | Example | Notes |
|---|---|---|---|
| Money (`numeric(12,2)`) | **string**, exactly 2 decimals | `"1250000.00"` | Never a JSON number (`ARCHITECTURE.md` §12.6). Parsed with `decimal.js` in `core/money` |
| Area/dimensions (`numeric(10,2)`) | string, 2 decimals | `"10.00"` | Marla, feet |
| Percentage (`numeric(5,2)`) | string, 2 decimals | `"33.34"` | Sum must be exactly `"100.00"` |
| Counts, sequence, milestone, attempts, `version`, `byteSize` | number | `3`, `10`, `0` | Integers; no decimals |
| Business date (`date`) | string `YYYY-MM-DD` | `"2026-10-19"` | No timezone, no time. "Today" is computed in `Asia/Karachi` (`ARCHITECTURE.md` §12.7) |
| Event timestamp (`timestamptz`) | string ISO-8601 UTC | `"2026-10-19T09:15:00.000Z"` | Milliseconds; clients render `DD-MMM-YYYY` in PKT |
| Enum | string, `UPPER_SNAKE` | `"BOOKED_TOKEN"` | Exactly the `DATABASE.md` §4 values |
| Null | `null` | — | Never `""` for an absent optional value |
| Text | UTF-8 string | Urdu names/addresses as stored | `dir="auto"` on the client (`ARCHITECTURE.md` §9.7) |
| Computed money | string, 2 decimals | `"475000.00"` | Listed in §8.2 with its formula |

**No localized strings cross the API.** Dates, money and enum labels are formatted by the client with `core/money`/`core/datetime` (`ARCHITECTURE.md` §9.6); error messages are codes translated by the catalogs. The API returns `preferredLanguage` and accepts a change at `PATCH /api/me/language`, but that is persistence, not translation. PDFs and CSV headers are **English**, regardless of the caller's language (PRD A-3).

### 1.9 Wire representations

The named shapes referenced by §3. Every property below is a `DATABASE.md` column unless marked **(derived)**. A `UserRef` is an FK column (e.g. `booking.created_by`) expanded to `{id, name}`; `CashEntry.category` and `Booking.plot` are the same idea — the FK value plus the joined label, never a second copy of the row.

```ts
type UUID = string;
type DecimalString = string;   // "1250000.00"
type DateOnly = string;        // "2026-10-19"
type Instant = string;         // "2026-10-19T09:15:00.000Z"

interface Page<T> { data: T[]; page: number; pageSize: number; total: number; }

interface UserRef { id: UUID; name: string; }

interface SessionUser {
  id: UUID; name: string; email: string;
  role: 'ADMIN' | 'SALES_AGENT' | 'ACCOUNTANT';
  preferredLanguage: 'EN' | 'UR';
  mustChangePassword: boolean;
}

interface SessionInfo {
  user: SessionUser;
  capabilities: string[];        // (derived) ARCHITECTURE §6.2 rows for the role
  idleExpiresAt: Instant;
  absoluteExpiresAt: Instant;
}

interface User {
  id: UUID; name: string; email: string; phone: string | null;
  role: 'ADMIN' | 'SALES_AGENT' | 'ACCOUNTANT';
  isActive: boolean; mustChangePassword: boolean;
  preferredLanguage: 'EN' | 'UR';
  lastLoginAt: Instant | null; createdAt: Instant; updatedAt: Instant;
}

interface FileRef { id: UUID; url: string; }   // url = /api/files/{id}

interface Company {
  id: UUID; name: string;
  address: string | null; phone: string | null; email: string | null;
  pdfTermsText: string | null;
  marlaSqft: DecimalString;
  logo: FileRef | null;
  updatedAt: Instant;
}

interface MasterPlanRef {
  fileId: UUID; url: string;
  widthPx: number; heightPx: number;
  uploadedAt: Instant | null;
}

interface Project {
  id: UUID; name: string; location: string | null;
  marlaSqft: DecimalString | null;
  isActive: boolean; version: number;
  masterPlan: MasterPlanRef | null;      // (derived) from project.master_plan_* columns
  createdAt: Instant; updatedAt: Instant;
}

interface Block {
  id: UUID; projectId: UUID; code: string; name: string;
  createdAt: Instant; updatedAt: Instant;
}

interface Plot {
  id: UUID; projectId: UUID; blockId: UUID; blockCode: string;  // blockCode (derived) join
  plotNumber: string; plotType: 'RESIDENTIAL' | 'COMMERCIAL';
  sizeMarla: DecimalString; sizeSqFt: DecimalString;             // sizeSqFt (derived)
  widthFt: DecimalString | null; depthFt: DecimalString | null;
  dimensionsText: string | null; pricePkr: DecimalString;
  status: 'AVAILABLE' | 'RESERVED' | 'BOOKED_TOKEN' | 'SOLD_CONSTRUCTED';
  polygon: [number, number][] | null; notes: string | null;
  isActive: boolean; version: number;
  createdAt: Instant; updatedAt: Instant;
}

interface PlotMap {
  projectId: UUID;
  masterPlan: MasterPlanRef | null;
  plots: Array<{
    id: UUID; plotNumber: string; blockId: UUID; blockCode: string;
    plotType: 'RESIDENTIAL' | 'COMMERCIAL';
    sizeMarla: DecimalString; pricePkr: DecimalString;
    status: Plot['status']; polygon: [number, number][] | null;
  }>;
}

interface PlotHistoryRow {
  id: UUID;
  fromStatus: Plot['status'] | null; toStatus: Plot['status'];
  reason: string | null;
  actor: UserRef | null;
  occurredAt: Instant;
}

interface Buyer {
  id: UUID; fullName: string; fatherOrHusbandName: string | null;
  cnic: string; phone: string; address: string | null;
  photo: FileRef | null;
  consentSms: boolean; consentRecordedAt: Instant | null;
  version: number; createdBy: UserRef;
  createdAt: Instant; updatedAt: Instant;
}

interface BookingBuyer {
  buyerId: UUID; fullName: string; cnic: string; phone: string;
  sharePct: DecimalString; isPrimary: boolean;
}

interface PaymentPlan {
  tokenAmount: DecimalString; downPaymentAmount: DecimalString;
  downPaymentDueDate: DateOnly;
  balanceAmount: DecimalString; installmentCount: number;
  installmentBaseAmount: DecimalString;
  frequency: 'MONTHLY' | 'QUARTERLY'; firstDueDate: DateOnly;
}

interface DueItem {
  id: UUID; sequence: number;
  kind: 'TOKEN' | 'DOWN_PAYMENT' | 'INSTALLMENT'; label: string;
  dueDate: DateOnly; amount: DecimalString; amountPaid: DecimalString;
  remaining: DecimalString;                       // (derived) amount - amount_paid
  status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID';
}

interface Booking {
  id: UUID; bookingRef: string;
  plot: { id: UUID; plotNumber: string; blockCode: string; projectId: UUID };
  bookingDate: DateOnly;
  status: 'CONFIRMED' | 'CANCELLED';
  salePricePkr: DecimalString;
  primaryBuyerId: UUID;
  createdBy: UserRef; clientRequestId: UUID;
  cancelReason: string | null; cancelledAt: Instant | null;
  cancelledBy: UserRef | null; version: number;
  createdAt: Instant; updatedAt: Instant;
}

interface LedgerTotals {
  totalPayable: DecimalString;   // (derived) sum of due_item.amount
  totalPaid: DecimalString;      // (derived) sum of non-voided allocations
  balance: DecimalString;        // (derived) payable - paid
  advanceCredit: DecimalString;  // (derived) sum(amount - allocations) over posted payments
  overdueAmount: DecimalString;  // (derived) open items with due_date < today (PKT)
}

interface BookingDetail extends Booking {
  buyers: BookingBuyer[];
  plan: PaymentPlan | null;
  dueItems: DueItem[];
  totals: LedgerTotals;
}

interface Allocation { id: UUID; dueItemId: UUID; amount: DecimalString; }

interface Payment {
  id: UUID; bookingId: UUID; paidOn: DateOnly;
  amount: DecimalString;
  method: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER';
  reference: string | null; notes: string | null;
  status: 'POSTED' | 'VOIDED';
  recordedBy: UserRef;
  allocations: Allocation[];
  voidReason: string | null; voidedAt: Instant | null; voidedBy: UserRef | null;
  createdAt: Instant;
}

interface CashCategory {
  id: UUID; name: string;
  nature: 'INCOME' | 'EXPENSE' | 'OPENING';
  isActive: boolean; createdAt: Instant; updatedAt: Instant;
}

interface CashEntry {
  id: UUID; entryDate: DateOnly;
  direction: 'IN' | 'OUT';
  category: { id: UUID; name: string; nature: CashCategory['nature'] };
  amount: DecimalString; description: string;
  linkedPaymentId: UUID | null; recordedBy: UserRef;
  status: 'POSTED' | 'VOIDED';
  voidReason: string | null; voidedAt: Instant | null; voidedBy: UserRef | null;
  createdAt: Instant;
}

interface CashDayTotal {
  entryDate: DateOnly; cashIn: DecimalString; cashOut: DecimalString; net: DecimalString;
}

interface ReminderTemplate {
  id: UUID; channel: 'SMS' | 'WHATSAPP'; milestone: 10 | 7 | 3 | 0;
  body: string; isActive: boolean;
  updatedBy: UserRef | null; createdAt: Instant; updatedAt: Instant;
}

interface ProviderConfig {
  channel: 'SMS' | 'WHATSAPP';
  providerName: 'dry-run' | 'local-sms-gateway' | 'meta-cloud';
  isEnabled: boolean; isLive: boolean;
  apiBaseUrl: string | null; senderId: string | null;
  secretConfigured: boolean;                      // (derived) secret_ciphertext IS NOT NULL
  waTemplate: { name: string; language: string; variables: unknown } | null;
  updatedBy: UserRef | null; updatedAt: Instant;
}

interface ReminderLogRow {
  id: UUID; dueItemId: UUID; claimId: UUID | null;
  bookingRef: string; plotNumber: string; buyerName: string;   // (derived) joins
  channel: 'SMS' | 'WHATSAPP'; milestone: 10 | 7 | 3 | 0; attempt: number;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  reason: string | null; recipientPhone: string | null;
  renderedBody: string | null; providerRef: string | null; errorMessage: string | null;
  attemptedAt: Instant;
}

interface RecoverySummary {
  outstanding: DecimalString; overdue: DecimalString;
  upcoming7: DecimalString; upcoming30: DecimalString;
  collectedThisMonth: DecimalString;
  asOf: DateOnly;
}

interface RecoveryRow {
  dueItemId: UUID; bookingRef: string; buyerId: UUID; buyerName: string; buyerPhone: string;
  plot: { id: UUID; plotNumber: string; blockCode: string };
  label: string; dueDate: DateOnly;
  amount: DecimalString; amountPaid: DecimalString; remaining: DecimalString;
  overdueDays: number;                            // (derived) calendar-day difference
  status: DueItem['status'];
}

interface AuditRow {
  id: string;                                     // bigserial as a string
  occurredAt: Instant;
  actor: UserRef | null; actorLabel: string;
  actionCode: string; entityType: string; entityId: UUID | null;
  bookingId: UUID | null; summary: Record<string, unknown>;
  requestId: string | null; ip: string | null;
}

interface FileObject {
  id: UUID; kind: 'MASTER_PLAN' | 'BUYER_PHOTO' | 'COMPANY_LOGO';
  url: string; mimeType: string; byteSize: number; sha256: string;
  widthPx: number | null; heightPx: number | null; createdAt: Instant;
}
```

### 1.10 Session cookie, CSRF and headers

- **Cookie:** `__Host-spm_session`; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` (`ARCHITECTURE.md` §6.1). The raw token is 32 random bytes, base64url-encoded; only its SHA-256 hex is stored in `session.token_hash`.
- **CSRF:** `SameSite=Lax` plus an `Origin`/`Host` check on **every** non-GET request (`ARCHITECTURE.md` §6.4). A mismatch is `403 CSRF_ORIGIN_REJECTED`. No CSRF token and no CORS.
- **Headers on API responses:** `Cache-Control: no-store` (except file responses, §3.12), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Request-Id`.
- **PII:** CNIC, phone, address and photos are returned only to roles with `buyer.read` (`ARCHITECTURE.md` §15.2). They are never put in logs, audit `summary`, or the `X-Request-Id` trace.

---

## 2. Auth

The session model is fixed by `ARCHITECTURE.md` §6.1 and the `session` table (`DATABASE.md` §3.1). This section defines the five endpoints and the behavior the client must implement around them.

### 2.1 Session lifecycle

```text
POST /api/auth/login
  → verify Argon2id → INSERT session(token_hash, idle_expires_at = now+30m,
                                       absolute_expires_at = now+12h)
  → Set-Cookie: __Host-spm_session=<32-byte token>; Secure; HttpOnly; SameSite=Lax; Path=/
  → audit auth.login

every authenticated request
  → SHA-256(cookie token) → session by uq_session_token_hash
  → reject if revoked_at IS NOT NULL, idle_expires_at <= now(), or absolute_expires_at <= now()
  → resolve user; reject if is_active = false

POST /api/auth/refresh        (client calls on activity / every 15 min)
  → last_seen_at = now(); idle_expires_at = LEAST(now()+30m, absolute_expires_at)
  → absolute_expires_at is NEVER extended

POST /api/auth/logout
  → DELETE the session row (DATABASE.md §1.6: sessions are hard-deleted)
```

- The token is **opaque** and never appears in a response body or a log. The session row stores only `token_hash`; a database dump cannot be replayed as a cookie.
- **Rotation happens only at login** (`ARCHITECTURE.md` §6.1). Refreshing slides the idle window; it does not mint a new token, so parallel tabs do not fight over the cookie.
- **Absolute expiry is a hard stop** at 12 hours from `created_at`; the client shows the login page with `returnTo` (PRD §12).
- Password reset, password change, deactivation and role change **revoke sessions immediately** by deleting the affected rows (`ARCHITECTURE.md` §6.1). The user sees `401 AUTH_SESSION_EXPIRED` on the next request.
- A session for a deactivated user is deleted at deactivation; if one survives a race, the per-request `is_active` check rejects it.

### 2.2 Login throttling

Two layers (`ARCHITECTURE.md` §6.1, §6.4):

| Layer | Limit | State |
|---|---|---|
| Nginx, per IP, `POST /api/auth/login` | 5 requests/minute, burst 5 | Nginx `limit_req` |
| Application, per account | 10 consecutive failures inside 15 minutes → lock | `login_throttle` row keyed by lowercased email |

- The **same behavior applies to unknown emails**: a `login_throttle` row is upserted for any attempted address, so an attacker cannot distinguish "locked because it exists" from "locked because it does not" (`DATABASE.md` §3.1).
- While locked: `429 AUTH_ACCOUNT_THROTTLED`, `Retry-After: <seconds>`, body message *"Too many attempts. Try again in N minutes."* The account lock is checked **before** password verification, so a correct password during lockout still returns `429` — this is deliberate; otherwise the response becomes an oracle.
- Lock durations: 15 minutes after 10 failures, doubling to 30 and 60 for repeated lockouts inside 24 hours; a successful login clears the row. These numbers are an API-level default because the sources do not fix them (§7, API-Q4).
- A login failure writes `audit_log` (`action_code = 'auth.login_failed'`, `actor_user_id = null`, `entity_id = null`, no email in `summary`) and increments the counter. The audit failure path never changes the response (`ARCHITECTURE.md` §13.6).
- Nginx-level `429` uses the same envelope and `Retry-After`.

### 2.3 `must_change_password` gate

When `app_user.must_change_password = true` (set only by an Admin reset, `ARCHITECTURE.md` §6.1), every authenticated endpoint returns `403 PASSWORD_CHANGE_REQUIRED` **except**:

- `GET /api/auth/session`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/password`
- `GET /api/health` (public, no session)

The UI routes straight to the change-password screen. This is a capability-independent gate: it applies to Admins too.

### 2.4 Endpoints

#### AUTH-1 · `POST /api/auth/login`

**Roles:** public (no session, no CSRF origin check; Nginx + account throttle apply).
**Body**

```json
{ "email": "admin@example.pk", "password": "…" }
```

**200** — `SessionInfo`; `Set-Cookie: __Host-spm_session=…`.
**401 `AUTH_INVALID_CREDENTIALS`** — unknown email, wrong password, or inactive user; one message, no field detail.
**400 `VALIDATION_FAILED`** — missing/malformed email or password.
**429 `AUTH_ACCOUNT_THROTTLED`** — locked; `Retry-After` in seconds.
**DB:** `app_user` by `uq_app_user_email`; `session` insert (`uq_session_token_hash`); `login_throttle` upsert; `audit_log` insert `auth.login`/`auth.login_failed`. The throttle row is updated in place and has no `updated_at` column.
**Notes:** `last_login_at` is updated on success. The dummy Argon2id hash is verified for unknown emails so timing is uniform (`ARCHITECTURE.md` §6.1). The response includes `mustChangePassword` so the client can route before the first business call.

#### AUTH-2 · `POST /api/auth/logout`

**Roles:** any session (idempotent — a missing/expired session still returns `204`).
**Body:** none.
**204** — session row deleted, cookie cleared (`Max-Age=0`).
**DB:** `session` hard delete (`DATABASE.md` §1.6); `audit_log` `auth.logout` written **before** the delete in the same transaction where possible.
**Notes:** no GET logout (`ARCHITECTURE.md` §6.1). Logout does not revoke other devices.

#### AUTH-3 · `GET /api/auth/session`

**Roles:** any session.
**200** — `SessionInfo`: user, capabilities, `idleExpiresAt`, `absoluteExpiresAt`.
**401 `AUTH_REQUIRED`** — no cookie.
**401 `AUTH_SESSION_EXPIRED`** — unknown, revoked or expired token; the client clears local state and routes to login.
**DB:** `session` by `uq_session_token_hash`, join `app_user`. **Read-only** — this endpoint does not touch `last_seen_at` (that is AUTH-4).

#### AUTH-4 · `POST /api/auth/refresh`

**Roles:** any session.
**Body:** none.
**200** — `SessionInfo` after sliding the idle window.
**401 `AUTH_SESSION_EXPIRED`** — expired/revoked; no new token.
**DB:** `UPDATE session SET last_seen_at = now(), idle_expires_at = LEAST(now() + interval '30 minutes', absolute_expires_at)`; `ck_session_expiry_order` still holds because `absolute_expires_at` never changes.
**Notes:** the client calls this on user activity at most once every 15 minutes; calling it in a tight loop is rate-limited as a normal request but has no business effect.

#### AUTH-5 · `POST /api/auth/password`

**Roles:** any session (this is the only endpoint that works while `must_change_password = true` besides session/refresh/logout).
**Body**

```json
{ "currentPassword": "…", "newPassword": "…" }
```

**204** — changed; all **other** sessions deleted; this session stays valid.
**422 `PASSWORD_CURRENT_INVALID`** — `fields: { "currentPassword": "INVALID" }`.
**422 `PASSWORD_POLICY_VIOLATION`** — `fields: { "newPassword": "TOO_SHORT" | "TOO_LONG" | "SAME_AS_CURRENT" }`.
**401 `AUTH_REQUIRED`** / **403 `PASSWORD_CHANGE_REQUIRED`** — not applicable (the gate exempts this endpoint).
**DB:** `app_user.password_hash`, `must_change_password = false`, `updated_at`; `session` rows for other devices deleted; `audit_log` `auth.password_changed`. Argon2id rehash uses the parameters in `ARCHITECTURE.md` §6.1.
**Notes:** policy is an API default (12–128 characters, no composition rules) because the sources do not define one — §7, API-Q5. The current password is always required, including on the forced-change screen.

---

## 3. Endpoints by module

Each endpoint states its **role(s) and capability**, **request**, **response**, **statuses**, and the **`DATABASE.md` objects it touches**. Shapes are defined in §1.9. A `—` request means no body.

> **A note on roles.** The three role names are the only accepted identity. The capability in backticks is the exact row from `ARCHITECTURE.md` §6.2 that the domain command checks; the role column is derived from it, never trusted from the client.

### 3.1 Identity

Owns `app_user`, `session`, `login_throttle` (`DATABASE.md` §3.1). Auth endpoints are in §2; this section covers the profile and user administration.

#### IDN-1 · `GET /api/me`

**Roles:** Admin, Sales Agent, Accountant · any authenticated session.
**200** — `{ user: User, capabilities: string[] }`.
**401** — standard.
**DB:** `app_user` by PK. `capabilities` is derived from `ARCHITECTURE.md` §6.2, not stored.

#### IDN-2 · `PATCH /api/me/language`

**Roles:** all · authenticated.
**Body:** `{ "preferredLanguage": "EN" | "UR" }`.
**200** — `{ "preferredLanguage": "UR" }`.
**400 `VALIDATION_FAILED`** — value outside the enum.
**DB:** `app_user.preferred_language` (`preferred_language` enum, default `EN`). No audit row: a UI preference is not a sensitive action (`ARCHITECTURE.md` §13.1). The toggle applies instantly client-side; this call persists it (`ARCHITECTURE.md` §9.3).

#### IDN-3 · `GET /api/users`

**Roles:** Admin · `user.manage`.
**Query:** `q` (name/email contains), `role`, `isActive`, `page`, `pageSize`, `sort=name|createdAt`, `order`.
**200** — `Page<User>`.
**DB:** `app_user`; `ix_app_user_role_active` for the role/active filter.

#### IDN-4 · `POST /api/users`

**Roles:** Admin · `user.manage`.
**Body**

```json
{ "name": "Ayesha Khan", "email": "ayesha@example.pk", "phone": "+923001234567",
  "role": "SALES_AGENT", "password": "temporary-password" }
```

**201** — `User` (never `password_hash`).
**409 `USER_EMAIL_EXISTS`** — `fields: { "email": "EXISTS" }` (`uq_app_user_email`).
**422 `PASSWORD_POLICY_VIOLATION`** — §7, API-Q5.
**400 `VALIDATION_FAILED`** — missing name, email or role.
**DB:** `app_user` insert; `email` lowercased by the service and enforced by `ck_app_user_email_lower`; `audit_log` `user.created`. Email is the login identifier (`ARCHITECTURE.md` §5.1).
**Notes:** the created password is set by the Admin and is **not** forced to change; the recommended flow is create → `password-reset` so the Admin never knows the user's password. Both are supported.

#### IDN-5 · `GET /api/users/{id}`

**Roles:** Admin · `user.manage`.
**200** — `User`.
**404 `USER_NOT_FOUND`**.
**DB:** `app_user` by PK.

#### IDN-6 · `PATCH /api/users/{id}`

**Roles:** Admin · `user.manage`.
**Body:** `{ "name"?, "phone"?, "role"?, "isActive"? }` (no `version` — the table has none).
**200** — `User`.
**409 `USER_SELF_DEACTIVATION`** — an Admin cannot deactivate themselves (`ARCHITECTURE.md` §5.1).
**409 `USER_LAST_ADMIN`** — the change would leave zero active Admins.
**404 `USER_NOT_FOUND`**.
**DB:** `app_user`; role or `isActive` change deletes that user's `session` rows; `audit_log` `user.updated` / `user.role_changed` / `user.deactivated`. Last-admin check reads `ix_app_user_role_active` inside the transaction.
**Notes:** users are never deleted (`DATABASE.md` §1.6); `isActive: false` is the only removal. Deactivation preserves attribution on past `booking.created_by`, `payment.recorded_by` and `audit_log.actor_user_id`.

#### IDN-7 · `POST /api/users/{id}/password-reset`

**Roles:** Admin · `user.manage`.
**Body:** none.
**200** — `{ "temporaryPassword": "…", "mustChangePassword": true }`; shown **once**.
**404 `USER_NOT_FOUND`**.
**DB:** `app_user.password_hash` replaced with an Argon2id hash of a generated 16-character password, `must_change_password = true`; all `session` rows for the user deleted; `audit_log` `user.password_reset` (no password in `summary`).
**Notes:** no email is sent (PRD §4 excludes email); the Admin reads the password to the user. `must_change_password` forces AUTH-5 on next login.

#### IDN-8 · `POST /api/users/{id}/unlock`

**Roles:** Admin · `user.manage`.
**Body:** none.
**204** — throttle cleared.
**404 `USER_NOT_FOUND`** — a user row must exist; unknown emails have throttle rows but no user id, and cannot be unlocked by this endpoint.
**DB:** `DELETE FROM login_throttle WHERE email = <user.email>`; `audit_log` `user.unlocked`.
**Notes:** unlocking does not affect sessions or the password.

---

### 3.2 Setup

Owns `company`, `project`, `block`, `app_setting` (`DATABASE.md` §3.2). `app_setting` deliberately has **no endpoint**: it holds operational scalars read by `core/config`, not user-editable domain data (`DATABASE.md` §2).

#### SET-1 · `GET /api/company`

**Roles:** all · authenticated (company data appears on every screen header and every PDF).
**200** — `Company`.
**404 `COMPANY_NOT_CONFIGURED`** — first run; the UI shows the setup empty state (PRD §12).
**DB:** `company` singleton (`uq_company_singleton`), left join `file_object` for the logo.

#### SET-2 · `PUT /api/company`

**Roles:** Admin · `setup.manage`.
**Body**

```json
{ "name": "Green City Developers", "address": "…", "phone": "+92…", "email": "info@…",
  "pdfTermsText": "…", "marlaSqft": "225.00", "logoFileId": "uuid-or-null" }
```

**201** — created (first run). **200** — updated.
**422 `FILE_KIND_MISMATCH`** — `logoFileId` is not a `COMPANY_LOGO` object.
**404 `FILE_NOT_FOUND`** — unknown/deleted file id.
**400 `VALIDATION_FAILED`** — `name` empty or email malformed.
**422 `VALIDATION_FAILED`** — `marlaSqft` ≤ 0 (`ck_company_marla`).
**DB:** `company` insert/update (`ck_company_marla`); `logo_file_id → file_object.id`; the previous logo object is soft-deleted when nothing else references it (`ARCHITECTURE.md` §7.5); `audit_log` `company.created` / `company.updated`.
**Notes:** `PUT` is a full replace; omitted optional text becomes `null`. The singleton is enforced by `uq_company_singleton`, so a second create is impossible even under a race.

#### SET-3 · `GET /api/projects`

**Roles:** all · `inventory.read`.
**Query:** `isActive`, `page`, `pageSize`, `sort=name|createdAt`.
**200** — `Page<Project>`.
**DB:** `project`; `ix_project_company_active`.

#### SET-4 · `POST /api/projects`

**Roles:** Admin · `setup.manage`.
**Body:** `{ "name": "Green City Phase 1", "location": "…", "marlaSqft": "225.00" | null }`.
**201** — `Project`.
**404 `COMPANY_NOT_CONFIGURED`** — the singleton company must exist before the first project.
**409 `PROJECT_NAME_EXISTS`** — `uq_project_company_name`.
**422 `VALIDATION_FAILED`** — `marlaSqft` ≤ 0.
**DB:** `project` insert; `company_id` is the singleton company (derived, never sent); `audit_log` `project.created`.
**Notes:** `marlaSqft` null inherits `company.marla_sqft` (PRD D-1). Plot sizes are stored in Marla and never rewritten by a conversion change (`ARCHITECTURE.md` §5.2).

#### SET-5 · `GET /api/projects/{id}`

**Roles:** all · `inventory.read`.
**200** — `Project`.
**404 `PROJECT_NOT_FOUND`**.
**DB:** `project` by PK + logo/file join for `masterPlan`.

#### SET-6 · `PATCH /api/projects/{id}`

**Roles:** Admin · `setup.manage`.
**Body:** `{ "version": 3, "name"?, "location"?, "marlaSqft"?, "isActive"? }`.
**200** — `Project` with the new `version`.
**409 `CONFLICT_STALE_WRITE`** — `fields: { "version": "STALE" }`.
**409 `PROJECT_NAME_EXISTS`**.
**422 `VALIDATION_FAILED`** — `marlaSqft` ≤ 0 (`ck_project_marla`).
**404 `PROJECT_NOT_FOUND`**.
**DB:** compare-and-swap on `project.version` (`DATABASE.md` §1.7); `ck_project_marla`; `audit_log` `project.updated`.
**Notes:** deactivation preserves history and blocks new bookings in the UI; it does not cascade to plots.

#### SET-7 · `PUT /api/projects/{id}/master-plan`

**Roles:** Admin · `inventory.manage`.
**Body**

```json
{ "fileId": "uuid", "version": 4, "confirmAspectRatioChange": false }
```

**200** — `Project` with the new plan ref and dimensions.
**422 `FILE_KIND_MISMATCH`** — the object is not `MASTER_PLAN`.
**422 `MASTER_PLAN_ASPECT_CHANGED`** — the new aspect ratio differs from the stored one by more than 0.5% and `confirmAspectRatioChange` is false; the UI warns that polygons will distort (PRD US-2.1, `ARCHITECTURE.md` §7.3, Q-12).
**409 `CONFLICT_STALE_WRITE`**.
**404 `FILE_NOT_FOUND`** / **`PROJECT_NOT_FOUND`**.
**DB:** `project.master_plan_file_id`, `master_plan_width_px`, `master_plan_height_px`, `master_plan_uploaded_at`, `version + 1`; `ck_project_plan_dims`; `audit_log` `project.master_plan_replaced`. Old plans are retained (`ARCHITECTURE.md` §7.5); no file row is deleted.
**Notes:** polygon coordinates are normalized `[0,1]` (`DATABASE.md` §3.3), so they survive a resize; only an aspect change needs the warning. The file is uploaded first via COR-1.

#### SET-8 · `GET /api/projects/{id}/blocks`

**Roles:** all · `inventory.read`.
**Query:** `page`, `pageSize`, `sort=code|name`.
**200** — `Page<Block>`.
**404 `PROJECT_NOT_FOUND`**.
**DB:** `block` by `ix_block_project_id`.

#### SET-9 · `POST /api/projects/{id}/blocks`

**Roles:** Admin · `setup.manage`.
**Body:** `{ "code": "A", "name": "Block A" }`.
**201** — `Block`.
**409 `BLOCK_CODE_EXISTS`** — `uq_block_project_code` (case-sensitive code, trimmed by the service).
**404 `PROJECT_NOT_FOUND`**.
**DB:** `block` insert; `audit_log` `block.created`.

#### SET-10 · `PATCH /api/blocks/{id}`

**Roles:** Admin · `setup.manage`.
**Body:** `{ "code"?, "name"? }`.
**200** — `Block`.
**409 `BLOCK_CODE_EXISTS`**.
**404 `BLOCK_NOT_FOUND`**.
**DB:** `block`; `audit_log` `block.updated`.

#### SET-11 · `DELETE /api/blocks/{id}`

**Roles:** Admin · `setup.manage`.
**204** — deleted.
**409 `BLOCK_HAS_PLOTS`** — the block still contains plots (PRD US-1.2). The `plot.block_id` FK is `ON DELETE RESTRICT`, so the database refuses even if the service check is bypassed.
**404 `BLOCK_NOT_FOUND`**.
**DB:** `block` hard delete (`DATABASE.md` §1.6); `audit_log` `block.deleted`.

---

### 3.3 Inventory

Owns `plot` and `plot_status_history` (`DATABASE.md` §3.3). Status is a stored state machine, never a computed field (`ARCHITECTURE.md` §5.3). Booking/cancel transitions are performed by Sales inside its transaction; the endpoints here are the Admin-only independent transitions.

#### INV-1 · `GET /api/projects/{id}/map`

**Roles:** all · `inventory.read`.
**200** — `PlotMap`: the master-plan reference and every active plot's normalized polygon.
**404 `PROJECT_NOT_FOUND`**.
**DB:** `project` (plan ref + dimensions), `plot` by `ix_plot_project_active`. `plot.polygon` is selected as JSONB and sent as `[[x,y], …]`.
**Notes:** this is the one payload that ships every polygon (~<500 KB gzipped at 3,000 plots, `ARCHITECTURE.md` §15.1). If no master plan exists, `masterPlan` is `null` and the UI shows the upload empty state (PRD §12). Status filters run client-side on this payload; no per-polygon endpoint exists.

#### INV-2 · `GET /api/plots`

**Roles:** all · `inventory.read`.
**Query:** `projectId` (**required**), `blockId`, `status`, `plotType`, `minSizeMarla`, `maxSizeMarla`, `q` (plot number prefix/contains), `sort=plotNumber|sizeMarla|pricePkr|status|blockCode`, `order`, `page`, `pageSize`.
**200** — `Page<Plot>`.
**400 `VALIDATION_FAILED`** — missing `projectId`, unknown `sort`, bad page.
**DB:** `plot` by `ix_plot_project_status` or `ix_plot_project_active`; ordering by `plotNumber` uses `uq_plot_project_number`; `blockCode` requires the `block` join and is whitelisted for sort. `sizeSqFt` is derived from `size_marla × COALESCE(project.marla_sqft, company.marla_sqft)`.

#### INV-3 · `POST /api/plots`

**Roles:** Admin · `inventory.manage`.
**Body**

```json
{ "blockId": "uuid", "plotNumber": "A-101", "plotType": "RESIDENTIAL",
  "sizeMarla": "10.00", "widthFt": "25.00", "depthFt": "90.00",
  "dimensionsText": "25 × 90 ft", "pricePkr": "1250000.00",
  "polygon": [[0.10, 0.20], [0.14, 0.20], [0.14, 0.26]], "notes": null }
```

**201** — `Plot`.
**409 `PLOT_NUMBER_EXISTS`** — `uq_plot_project_number`; the number is unique **per project**, independent of block (PRD US-2.3).
**422 `POLYGON_INVALID`** — fewer than 3 points, a coordinate outside `[0,1]`, or zero area (`ck_plot_polygon`, `spm_polygon_ok`).
**404 `BLOCK_NOT_FOUND`**.
**400 `VALIDATION_FAILED`** — malformed number or missing `plotNumber`; `422` for a non-positive size or negative price (V-19).
**DB:** `plot` insert; `project_id` is **derived from `blockId`**, never accepted from the client (this prevents a plot whose project and block disagree); `ck_plot_size`, `ck_plot_price`, `ck_plot_dims`, `ck_plot_polygon`; `audit_log` `plot.created`.
**Notes:** `plotNumber` is trimmed and upper-cased by the service before the uniqueness check.

#### INV-4 · `GET /api/plots/{id}`

**Roles:** all · `inventory.read`.
**200** — `Plot`.
**404 `PLOT_NOT_FOUND`**.
**DB:** `plot` by PK + `block` for `blockCode`; booking info is deliberately **not** embedded — the Plot Details panel fetches `GET /api/bookings?plotId=…` so the booking contract stays in Sales.

#### INV-5 · `PATCH /api/plots/{id}`

**Roles:** Admin · `inventory.manage`.
**Body:** `{ "version": 7, "blockId"?, "plotNumber"?, "plotType"?, "sizeMarla"?, "widthFt"?, "depthFt"?, "dimensionsText"?, "pricePkr"?, "notes"?, "isActive"? }`.
**200** — `Plot` with the new `version`.
**409 `CONFLICT_STALE_WRITE`** — `fields: { "version": "STALE" }`.
**409 `PLOT_NUMBER_EXISTS`**.
**400 `VALIDATION_FAILED`** — `polygon` is not accepted here (the polygon has its own endpoint); `fields.polygon: "UNKNOWN_PROPERTY"`.
**422 `BLOCK_PROJECT_MISMATCH`** — moving a plot to a block in another project.
**404 `PLOT_NOT_FOUND`** / **`BLOCK_NOT_FOUND`**.
**DB:** compare-and-swap on `version`; `ck_plot_size`, `ck_plot_dims`, `ck_plot_price`, `ck_plot_polygon`; a price change writes `audit_log` `plot.price_changed` with `{from, to}` (numbers only, no PII); any edit writes `plot.updated`.
**Notes:** `status` is **not** editable here. Reserve/release/mark-sold are commands below; booking/cancel are Sales. This is the "status is not a free-form edit" rule of `ARCHITECTURE.md` §12.4.

#### INV-6 · `DELETE /api/plots/{id}`

**Roles:** Admin · `inventory.manage`.
**204** — deleted.
**409 `PLOT_IN_USE`** — a booking or status-history row references it. `DATABASE.md` §1.6 permits hard deletion only for an unreferenced plot; in practice a plot that was ever status-changed has history and cannot be deleted (deactivate instead).
**404 `PLOT_NOT_FOUND`**.
**DB:** `plot` hard delete; `booking.plot_id` and `plot_status_history.plot_id` are `ON DELETE RESTRICT`; `audit_log` `plot.deleted`.
**Notes:** `isActive: false` is the normal retirement path (`DATABASE.md` §1.6).

#### INV-7 · `PUT /api/plots/{id}/polygon`

**Roles:** Admin · `inventory.manage`.
**Body:** `{ "version": 7, "polygon": [[0.10, 0.20], [0.14, 0.20], [0.14, 0.26]] }`.
**200** — `Plot` (the save path used by the drawing tool's autosave).
**422 `POLYGON_INVALID`** — <3 vertices, coordinate outside `[0,1]`, non-numeric, or zero area.
**409 `CONFLICT_STALE_WRITE`**.
**404 `PLOT_NOT_FOUND`**.
**DB:** `plot.polygon`, `version + 1`; `ck_plot_polygon` calls `spm_polygon_ok` (`DATABASE.md` §6.6); `audit_log` `plot.polygon_updated`.
**Notes:** a full replace, not a patch — the canvas owns the vertex list. The polygon is nullable; a plot may be created before it is drawn (PRD US-2.2's "unsaved changes" are client state and never hit the API until saved).

#### INV-8 · `DELETE /api/plots/{id}/polygon`

**Roles:** Admin · `inventory.manage`.
**Query:** `version` (**required** — DELETE has no body by convention here).
**204** — polygon cleared.
**409 `CONFLICT_STALE_WRITE`** when `?version=` does not match.
**404 `PLOT_NOT_FOUND`**.
**DB:** `plot.polygon = NULL`, `version + 1`; `audit_log` `plot.polygon_cleared`. The plot row remains, still listed in tables and bookable — an undrawn plot is legal (`DATABASE.md` §3.3).

#### INV-9 · `GET /api/plots/{id}/history`

**Roles:** all · `inventory.read` (PRD FR-3.4: history is visible to all roles; the Admin-only audit trail is separate).
**Query:** `page`, `pageSize`, `sort=occurredAt` (desc default).
**200** — `Page<PlotHistoryRow>`.
**404 `PLOT_NOT_FOUND`**.
**DB:** `plot_status_history` by `ix_plot_status_history_plot`; actor name joined from `app_user`.

#### INV-10 · `POST /api/plots/{id}/reserve`

**Roles:** Admin · `inventory.status`.
**Body:** `{ "reason": "Held for management allocation" }` (required, 3–500 chars — PRD US-2.5 asks for a short note).
**200** — `Plot` (status `RESERVED`, `version + 1`).
**409 `PLOT_STATUS_INVALID`** — only `AVAILABLE → RESERVED` is legal.
**400 `VALIDATION_FAILED`** — missing reason.
**404 `PLOT_NOT_FOUND`**.
**DB:** `SELECT … FOR UPDATE` on the plot; update `status` + `version`; insert `plot_status_history` (`ck_plot_history_transition`); `audit_log` `plot.status_changed` with `{from: "AVAILABLE", to: "RESERVED", reason}`.
**Notes:** reserved plots can still be booked by an Admin with explicit confirmation (SAL-6); Sales Agents cannot.

#### INV-11 · `POST /api/plots/{id}/release`

**Roles:** Admin · `inventory.status`.
**Body:** `{ "reason": "Hold released" }` (required).
**200** — `Plot` (status `AVAILABLE`).
**409 `PLOT_STATUS_INVALID`** — only `RESERVED → AVAILABLE` is legal.
**400 `VALIDATION_FAILED`** — missing reason.
**404 `PLOT_NOT_FOUND`**.
**DB:** same lock/history/audit pattern as INV-10; `plot_status_history.from_status = 'RESERVED'`.

#### INV-12 · `POST /api/plots/{id}/mark-sold`

**Roles:** Admin · `inventory.status`.
**Body:** `{ "reason": null }` (optional).
**200** — `Plot` (status `SOLD_CONSTRUCTED`).
**409 `PLOT_STATUS_INVALID`** — only `BOOKED_TOKEN → SOLD_CONSTRUCTED` is legal; `SOLD_CONSTRUCTED` is terminal (`ARCHITECTURE.md` §5.3).
**404 `PLOT_NOT_FOUND`**.
**DB:** lock; `status`, `version`; `plot_status_history`; `audit_log` `plot.status_changed`.
**Notes:** this is the manual "Allotted/Sold" action of PRD D-3. It does **not** create a document or change the booking; the allotment letter is already printable from confirmation.

---

### 3.4 Sales

Owns `buyer`, `booking`, `payment_plan`, `booking_buyer`, `booking_note`, `due_item` (`DATABASE.md` §3.4). The booking confirm is the single most constrained command in the system (`ARCHITECTURE.md` §12.1).

#### 3.4.1 The booking wizard is one confirm endpoint

The six visual steps — plot select → price → buyers → plan → review → confirm — are **client-side wizard state**, not server resources:

- `DATABASE.md` has no draft/booking-session table, and this document may not add one.
- A booking is **one transaction** (`ARCHITECTURE.md` §4.4): lock plot → upsert buyers → booking → shares → plan → due items → plot status → history → audit. Splitting it into server-side steps would create partial bookings, which PRD US-3.1 and §12 explicitly forbid (*"no partial booking persisted"*).
- The live schedule preview is computed in the browser by the **same** `core/money` plan function the server uses (`ARCHITECTURE.md` §12.6), so no preview round-trip is needed. The server recomputes; it never trusts the preview.
- The wizard generates `clientRequestId` when it opens, so a double-click or a retry after a network timeout returns the first booking (SAL-6, §1.7).
- Navigating away loses the draft. That is intentional: a stale half-booking that someone else's plot status invalidates is worse than re-entering four fields, and PRD §12 already specifies the "no longer available" recovery path.

#### SAL-1 · `GET /api/buyers`

**Roles:** all · `buyer.read`.
**Query:** `q` (name contains), `cnic` (exact, normalized), `phone` (exact E.164), `page`, `pageSize`, `sort=fullName|createdAt`.
**200** — `Page<Buyer>`.
**DB:** `buyer`; `uq_buyer_cnic` for the exact CNIC lookup (the wizard's dedupe step), `ix_buyer_phone` for the phone lookup.
**Notes:** the wizard calls `?cnic=…` to decide between "use existing" and "create new" before submitting SAL-6.

#### SAL-2 · `POST /api/buyers`

**Roles:** Admin, Sales Agent · `buyer.edit`.
**Body**

```json
{ "fullName": "Muhammad Imran", "fatherOrHusbandName": "Muhammad Akram",
  "cnic": "35202-1234567-1", "phone": "+923001234567",
  "address": "House 12, Lahore", "photoFileId": "uuid-or-null",
  "consentSms": true }
```

**201** — `Buyer`.
**409 `BUYER_CNIC_EXISTS`** — `uq_buyer_cnic`; `fields: { "cnic": "EXISTS" }`. The wizard then re-queries SAL-1 and uses the existing id.
**422 `FILE_KIND_MISMATCH`** — a photo file that is not `BUYER_PHOTO`.
**400 `VALIDATION_FAILED`** — CNIC/phone format, empty name, missing `consentSms`.
**DB:** `buyer` insert (`ck_buyer_cnic_format`, `ck_buyer_phone_e164`, `ck_buyer_consent_pair`); `created_by` from the session; `consent_recorded_at = now()` because the form captured a yes/no decision (a `false` with a timestamp means "asked and declined", `DATABASE.md` DQ-2); `audit_log` `buyer.created`.
**Notes:** consent is **required** on creation because PRD US-3.2 says it is captured at registration. The timestamp is server-side; the client cannot backdate it. A photo reference is bound here but the file is uploaded first (COR-1), and a failed bind leaves an orphan that GC removes (`ARCHITECTURE.md` §7.5).

#### SAL-3 · `GET /api/buyers/{id}`

**Roles:** all · `buyer.read`.
**200** — `Buyer`.
**404 `BUYER_NOT_FOUND`**.
**DB:** `buyer` by PK + `file_object` for the photo URL.

#### SAL-4 · `PATCH /api/buyers/{id}`

**Roles:** Admin, Sales Agent · `buyer.edit`.
**Body:** `{ "version": 4, "fullName"?, "fatherOrHusbandName"?, "phone"?, "address"?, "photoFileId"?, "cnic"?, "cnicChangeReason"? }`.
**200** — `Buyer`.
**409 `CONFLICT_STALE_WRITE`**.
**409 `CNIC_IN_USE`** — the corrected CNIC belongs to another buyer.
**422 `CNIC_REASON_REQUIRED`** — `cnic` supplied without `cnicChangeReason` (`ARCHITECTURE.md` §13.1 audits CNIC corrections with a reason).
**422 `FILE_KIND_MISMATCH`**.
**404 `BUYER_NOT_FOUND`**.
**DB:** compare-and-swap on `buyer.version`; old photo object soft-deleted when unreferenced (`ARCHITECTURE.md` §7.5); `audit_log` `buyer.updated` with **field names only** — never the CNIC, phone or address values (`ARCHITECTURE.md` §13.2).
**Notes:** this endpoint does **not** change consent. Replacing a buyer's photo does not change `consent_sms`.

#### SAL-5 · `PATCH /api/buyers/{id}/consent`

**Roles:** Admin, Accountant · `buyer.consent` — **not in the §6.2 matrix; see §7, API-Q1**. PRD FR-4.2 and `ARCHITECTURE.md` §5.4 both assign consent changes to Admin/Accountant; the matrix omits the row. The endpoint follows the behavior documents and the gap is flagged, not hidden.
**Body:** `{ "consentSms": false, "version": 4 }`.
**200** — `Buyer` with the new `consentRecordedAt`.
**409 `CONFLICT_STALE_WRITE`**.
**404 `BUYER_NOT_FOUND`**.
**DB:** `buyer.consent_sms`, `consent_recorded_at = now()`, `version + 1`; `ck_buyer_consent_pair` (a `true` flag always carries a timestamp); `audit_log` `buyer.consent_changed` with `{from, to}` only.
**Notes:** Reminders reads this field at claim time and never writes it (`ARCHITECTURE.md` §12.8, §10.5). A change takes effect on the next scheduler tick; a claim already created is unaffected (the claim is per milestone, `DATABASE.md` §3.7).

#### SAL-6 · `POST /api/bookings`

**Roles:** Admin, Sales Agent · `booking.create`.
**Body**

```json
{
  "clientRequestId": "8c3b2f0e-5f6a-4b7c-9d10-2e3f4a5b6c7d",
  "plotId": "uuid",
  "salePricePkr": "1250000.00",
  "bookingDate": "2026-10-19",
  "confirmReserved": false,
  "buyers": [
    { "buyerId": "uuid", "sharePct": "100.00", "isPrimary": true }
  ],
  "plan": {
    "tokenAmount": "100000.00",
    "downPaymentAmount": "200000.00",
    "downPaymentDueDate": "2026-10-19",
    "installmentCount": 24,
    "frequency": "MONTHLY",
    "firstDueDate": "2026-11-19"
  }
}
```

Each `buyers[]` entry is **either** `buyerId` (an existing buyer) **or** `buyer` (the full SAL-2 body, for a new CNIC). Sending both is `400`; sending neither is `400`.

**201** — `BookingDetail`: booking, buyers with shares, plan, generated due items, and totals with zero paid and the full balance outstanding.
**200 `Idempotent-Replay: true`** — this `clientRequestId` already produced a booking for this actor; the existing booking is returned with its **current** detail (due items and totals as they are now) and nothing is written.
**409 `BOOKING_PLOT_UNAVAILABLE`** — the plot is not `AVAILABLE`, or is `RESERVED` without Admin + `confirmReserved`, or another transaction won the partial unique index. The UI closes the wizard and shows *"This plot is no longer available."* (`ARCHITECTURE.md` §12.1).
**422 `BOOKING_RESERVED_CONFIRMATION_REQUIRED`** — Admin booking a `RESERVED` plot without `confirmReserved: true`.
**422 `SHARE_TOTAL_INVALID`** — shares do not sum to exactly `100.00`.
**422 `SHARE_PRIMARY_INVALID`** — zero or more than one `isPrimary`.
**422 `BUYER_REQUIRED`** — empty `buyers`.
**422 `DUPLICATE_BUYER`** — the same buyer id/CNIC appears twice.
**422 `PLAN_INVALID`** — any plan assertion below fails; `fields` names the offending input.
**409 `BUYER_CNIC_EXISTS`** — an inline `buyer` whose CNIC already exists; re-query SAL-1 and submit `buyerId`.
**404 `PLOT_NOT_FOUND`** / **`BUYER_NOT_FOUND`**.
**403 `AUTH_FORBIDDEN`** — Accountant has no `booking.create`.
**DB:** one transaction, in this order (`ARCHITECTURE.md` §4.4, §12.1, §12.3):
0. Look up `booking` by `(created_by, client_request_id)` **first**. If it exists, return the original `BookingDetail` with `200` — before any plot lock or status check. A double-click after the plot became `BOOKED_TOKEN` must not be answered with `409`.
1. `SELECT … FROM plot WHERE id = $1 FOR UPDATE`; check `status IN ('AVAILABLE','RESERVED')` and the role rule.
2. Insert `booking` (`status = CONFIRMED`, `created_by`, `client_request_id`, `booking_ref` default from `booking_ref_seq`); a unique violation on `uq_booking_idempotency` from a concurrent duplicate is caught and mapped to the same `200` replay path.
3. Insert/lookup `buyer` rows; insert `booking_buyer` rows (`ck_booking_buyer_share`, PK `(booking_id, buyer_id)`, `one_primary_buyer_per_booking`); set `booking.primary_buyer_id`.
4. Insert `payment_plan` (`uq_payment_plan_booking`, `ck_plan_amounts`, `ck_plan_installments`).
5. Insert `due_item` rows (`sequence` 0 = token, 1 = down payment, 2… = installments; `uq_due_item_booking_sequence`, `ck_due_item_amount`, `ck_due_item_status`).
6. Update `plot` (`BOOKED_TOKEN`, `version + 1`); insert `plot_status_history`.
7. Insert `audit_log` `booking.created` (ids and amounts only).
**The final guard** is `one_active_booking_per_plot` (`DATABASE.md` §6.1): even if a future code path skipped step 1, the unique violation is mapped to the same `409 BOOKING_PLOT_UNAVAILABLE`. No partial booking survives a failure — the transaction rolls back to nothing.

**Plan assertions** (server recomputes; all must hold, `ARCHITECTURE.md` §12.6):
`token ≥ 0`, `downPayment ≥ 0`, `token + downPayment < salePrice`, `balance > 0`, `1 ≤ installmentCount ≤ 120`, `base = round2(balance / count) > 0`, every installment > 0, `sum(installments) + token + downPayment = salePrice`, `firstDueDate` a valid date, `frequency ∈ {MONTHLY, QUARTERLY}`. `bookingDate` defaults to today in PKT when omitted. The token is due on `bookingDate`; the down payment on `downPaymentDueDate` (default `bookingDate`, Q-3); installments monthly/quarterly from `firstDueDate` with end-of-month clamping.

#### SAL-7 · `GET /api/bookings`

**Roles:** all · `sales.read`.
**Query:** `status`, `plotId`, `buyerId`, `agentId` (= `created_by`), `blockId`, `dateFrom`, `dateTo` (on `booking_date`), `q` (booking ref), `sort=bookingDate|createdAt`, `order`, `page`, `pageSize`.
**200** — `Page<Booking>`.
**DB:** `booking` via `ix_booking_status_date`, `ix_booking_plot`, `ix_booking_created_by`, `ix_booking_primary_buyer`; `buyerId` and `blockId` filters join `booking_buyer`/`plot`.
**Notes:** this is also how the Plot Details panel finds "the booking for this plot" (`?plotId=…`).

#### SAL-8 · `GET /api/bookings/{ref}`

**Roles:** all · `sales.read`.
**200** — `BookingDetail` (buyers, plan, due items, totals).
**404 `BOOKING_NOT_FOUND`** — unknown ref or UUID.
**DB:** `booking` by `booking_ref`/PK; `booking_buyer`; `payment_plan`; `due_item` by `uq_due_item_booking_sequence`; totals from the same open-balance query used by Recovery (`ARCHITECTURE.md` §11.5). Read-only.
**Notes:** `{ref}` accepts `BK-1042` or the UUID. A cancelled booking still returns its plan, due items and payments — history is never hidden.

#### SAL-9 · `PATCH /api/bookings/{ref}`

**Roles:** Admin · `booking.manage`.
**Body:** `{ "version": 2, "bookingDate": "2026-10-20" }`.
**200** — `Booking`.
**409 `CONFLICT_STALE_WRITE`**.
**404 `BOOKING_NOT_FOUND`**.
**DB:** compare-and-swap on `booking.version`; `audit_log` `booking.updated`.
**Notes:** only the business date is editable post-confirm. **Price and plan revision is deliberately not exposed** — `DATABASE.md` §1.6 makes `due_item.amount` immutable and `payment_plan` a snapshot, so Q-1's zero-payment revision has no legal write path. The supported correction is cancel-and-rebook (Q-1's own fallback). Flagged in §7, API-Q2.

#### SAL-10 · `PUT /api/bookings/{ref}/buyers`

**Roles:** Admin · `booking.manage`.
**Body:** `{ "version": 2, "buyers": [ { "buyerId": "uuid" | "buyer": {…}, "sharePct": "60.00", "isPrimary": true }, … ] }`.
**200** — `BookingDetail`.
**409 `BOOKING_HAS_PAYMENTS`** — at least one `POSTED` payment exists; ownership cannot change once money is recorded.
**422 `SHARE_TOTAL_INVALID`**, **`SHARE_PRIMARY_INVALID`**, **`BUYER_REQUIRED`**, **`DUPLICATE_BUYER`**.
**409 `CONFLICT_STALE_WRITE`** / **`BOOKING_ALREADY_CANCELLED`**.
**404 `BOOKING_NOT_FOUND`** / **`BUYER_NOT_FOUND`**.
**DB:** inside one transaction: `DELETE FROM booking_buyer WHERE booking_id = …` then insert the new set (the **only** delete path on that table, permitted by `DATABASE.md` §8.3); update `booking.primary_buyer_id`, `version + 1`; insert any new buyers; `audit_log` `booking.buyers_changed` with buyer ids and shares.
**Notes:** this is the non-financial Q-1 edit that the schema does support. The zero-payment guard is the API's addition because changing owners after receipts would make the ledger's counterparty ambiguous; it is recorded in §7, API-Q2.

#### SAL-11 · `POST /api/bookings/{ref}/cancel`

**Roles:** Admin · `booking.cancel`.
**Body:** `{ "reason": "Buyer withdrew; token to be refunded offline" }` (required, 3–500 chars).
**200** — `Booking` (`status: CANCELLED`).
**409 `BOOKING_ALREADY_CANCELLED`** — a second cancel is a state conflict, not a silent success (`ARCHITECTURE.md` §12.5).
**409 `BOOKING_NOT_CANCELLABLE`** — the plot is already `SOLD_CONSTRUCTED` (`ARCHITECTURE.md` §5.3).
**400 `VALIDATION_FAILED`** — missing reason.
**404 `BOOKING_NOT_FOUND`**.
**DB:** one transaction — lock plot, then booking (`ARCHITECTURE.md` §12.3); set `booking.status = CANCELLED`, `cancel_reason`, `cancelled_at`, `cancelled_by`, `version + 1` (`ck_booking_cancel_fields`); set `plot.status = AVAILABLE`, `version + 1`; insert `plot_status_history`; `audit_log` `booking.cancelled` with the reason.
**Never:** delete the booking, its due items or its payments (`DATABASE.md` §1.6); refunds are offline (PRD D-8). Payments remain `POSTED` and are excluded from recovery because the booking is no longer `CONFIRMED` (`ARCHITECTURE.md` §5.4).

#### SAL-12 · `GET /api/bookings/{ref}/notes`

**Roles:** all · `sales.read`.
**Query:** `page`, `pageSize`.
**200** — `Page<{ id, body, author: UserRef, createdAt }>`.
**404 `BOOKING_NOT_FOUND`**.
**DB:** `booking_note` by `ix_booking_note_booking`.

#### SAL-13 · `POST /api/bookings/{ref}/notes`

**Roles:** Admin, Sales Agent · `booking.note`.
**Body:** `{ "body": "Buyer will visit on Friday." }`.
**201** — `{ id, body, author, createdAt }`.
**400 `VALIDATION_FAILED`** — blank body (`ck_booking_note_body`).
**404 `BOOKING_NOT_FOUND`**.
**DB:** `booking_note` insert; `audit_log` `booking.note_added`. **No edit or delete endpoint**: notes are append-only (DQ-7), and the grant denies `UPDATE`/`DELETE` on the table (`DATABASE.md` §8.3).

---

### 3.5 Ledger

Owns `payment` and `payment_allocation` (`DATABASE.md` §3.5). A payment is posted, never edited; the only mutation is void-with-reason (`ARCHITECTURE.md` §5.5). Every write here runs in one transaction that also updates Sales' due items and Cashbook's linked entry — the caller sees one command, not three.

#### LED-1 · `GET /api/bookings/{ref}/ledger`

**Roles:** all · `ledger.read`.
**200**

```ts
{
  booking: Booking;
  buyers: BookingBuyer[];
  plan: PaymentPlan | null;
  dueItems: DueItem[];        // oldest sequence first
  payments: Payment[];        // newest paid_on first, with allocations
  totals: LedgerTotals;
}
```

**404 `BOOKING_NOT_FOUND`**.
**DB:** read-only: `booking`, `booking_buyer`, `payment_plan`, `due_item` by `uq_due_item_booking_sequence`, `payment` by `ix_payment_booking`, `payment_allocation` by `ix_allocation_due_item`. `totals` are computed from non-voided allocations and open due items — the same query shape as Recovery (`ARCHITECTURE.md` §11.5), so the ledger and the dashboard cannot disagree (S-4).
**Notes:** `advanceCredit` is derived per booking as `Σ(payment.amount) − Σ(posted allocations)` (`ARCHITECTURE.md` §5.5). It is displayed, not stored, and cannot be applied by any endpoint — §7, API-Q3.

#### LED-2 · `GET /api/buyers/{id}/ledger`

**Roles:** all · `ledger.read`.
**200**

```ts
{
  buyer: Buyer;
  bookings: Array<{
    bookingRef: string; plot: { plotNumber: string; blockCode: string };
    salePricePkr: DecimalString; totalPaid: DecimalString; balance: DecimalString;
    status: 'CONFIRMED' | 'CANCELLED';
  }>;
  payments: Payment[];        // across all bookings
  totals: LedgerTotals;       // summed across the buyer's bookings
}
```

**404 `BUYER_NOT_FOUND`**.
**DB:** `booking_buyer` by `ix_booking_buyer_buyer` → `booking` → `payment`/`due_item`. Read-only.
**Notes:** a buyer's cancelled bookings are included with their payments (history), but their due items are excluded from `totals.balance` by the same `CONFIRMED` filter Recovery uses.

#### LED-3 · `POST /api/bookings/{ref}/payments`

**Roles:** Admin, Accountant · `payment.record`.
**Body**

```json
{
  "clientRequestId": "6b1e7c2a-3d4f-4a5b-8c9d-0e1f2a3b4c5d",
  "amount": "500000.00",
  "paidOn": "2026-10-19",
  "method": "BANK_TRANSFER",
  "reference": "TRX-88213",
  "notes": "Part payment against installments 3–4",
  "allocations": [
    { "dueItemId": "uuid", "amount": "300000.00" },
    { "dueItemId": "uuid", "amount": "200000.00" }
  ]
}
```

`allocations` is **optional**. Omitted or `null` means *oldest-unpaid-first*: the server allocates to open due items in `due_date, sequence` order until the amount is exhausted (PRD US-5.1); anything left is advance credit. When supplied, it is a manual override and must obey the allocation rules.

**201** — `{ payment: Payment, dueItems: DueItem[], totals: LedgerTotals, cashEntryId: UUID }`.
**200 `Idempotent-Replay: true`** — same `clientRequestId` for this actor; the original payment and its current due-item state are returned, nothing is written.
**409 `BOOKING_NOT_PAYABLE`** — the booking is `CANCELLED`. Cancel-then-pay is not a thing; the money would have no ledger.
**422 `PAYMENT_AMOUNT_INVALID`** — amount ≤ 0 or more than 2 decimals.
**422 `ALLOCATION_EXCEEDS_DUE`** — an explicit allocation is larger than that due item's remaining balance.
**422 `ALLOCATION_SUM_EXCEEDS_PAYMENT`** — allocations total more than the payment.
**422 `DUE_ITEM_NOT_IN_BOOKING`** / **`DUPLICATE_ALLOCATION`**.
**404 `BOOKING_NOT_FOUND`** / **`DUE_ITEM_NOT_FOUND`**.
**DB:** one transaction (`ARCHITECTURE.md` §12.2):
0. Look up `payment` by `(recorded_by, client_request_id)` **first**; if found, return it with `200` before touching the booking (a retry must not fail because the booking was cancelled in between).
1. `SELECT booking … FOR UPDATE` (payments for one booking serialize; different bookings run in parallel).
2. Re-read open due items under the lock and compute/validate allocations.
3. Insert `payment` (`ck_payment_amount`, `uq_payment_idempotency`; a concurrent duplicate's unique violation maps to the same `200` replay path).
4. Insert `payment_allocation` rows (`uq_allocation_pair`, `ck_allocation_amount`).
5. `UPDATE due_item SET amount_paid, status, updated_at` — the only mutable columns (`DATABASE.md` §1.6), kept in step by `ck_due_item_amount_paid` and `ck_due_item_status`.
6. Insert the linked Roznamcha `cash_entry` with `direction = 'IN'`, `linked_payment_id = payment.id`, category **Booking Receipt** (DQ-13), `recorded_by` copied from the payment (there is no system user, `DATABASE.md` §9.4). `uq_cash_entry_linked_payment` and `ck_cash_entry_linked` enforce exactly one In-entry per payment.
7. `audit_log` `payment.recorded` with ids/amounts only.
**Invariants enforced in code and proved by tests:** `Σ allocations + advance = amount`; no allocation exceeds a due item's remaining; a voided payment contributes nothing (`ARCHITECTURE.md` §12.2, §12.9 check 1).
**Notes:** overpayment is legal and becomes advance credit (`ARCHITECTURE.md` §5.5); it is not an error. `paid_on` defaults to today in PKT if omitted; the API does not reject a date outside the current month — the UI warns (`ARCHITECTURE.md` §5.5).

#### LED-4 · `GET /api/payments/{id}`

**Roles:** all · `ledger.read`.
**200** — `Payment` with allocations.
**404 `PAYMENT_NOT_FOUND`**.
**DB:** `payment` by PK, `payment_allocation` by `ix_allocation_due_item`/`uq_allocation_pair`.

#### LED-5 · `POST /api/payments/{id}/void`

**Roles:** Admin, Accountant · `payment.void`.
**Body:** `{ "reason": "Cheque returned unpaid" }` (required, 3–500 chars).
**200** — `Payment` (`status: VOIDED`) with allocations retained.
**409 `PAYMENT_ALREADY_VOIDED`** — a second void is a state conflict (`ARCHITECTURE.md` §12.5).
**400 `VALIDATION_FAILED`** — missing reason.
**404 `PAYMENT_NOT_FOUND`**.
**DB:** one transaction — lock the booking; set `payment.status = VOIDED`, `void_reason`, `voided_at`, `voided_by` (`ck_payment_void_fields`; the column-scoped `trg_payment_immutable` permits only these four columns, `DATABASE.md` §6.4); recompute every affected `due_item.amount_paid` and `status` from the remaining **posted** allocations; set the linked `cash_entry` to `VOIDED` with the same reason/voided_by (`ck_cash_entry_void_fields`); `audit_log` `payment.voided` and `cash_entry.voided`.
**Never:** delete the payment or its allocations. The allocations stay as history and are excluded by joining `payment.status` (`DATABASE.md` §1.6, §3.5). A void is the *only* mutation the grant and trigger allow.

---

### 3.6 Cashbook

Owns `cash_category` and `cash_entry` (`DATABASE.md` §3.6). The Roznamcha is company-wide (Q-5). Reads and writes are limited to the two roles that use the screen (PRD §11 #11): `ARCHITECTURE.md` §6.2 has a single `cashbook.record` capability and no separate read row, so this module's **read endpoints also require `cashbook.record`**. Sales Agents have no cashbook access, by design.

#### CSH-1 · `GET /api/cash-entries`

**Roles:** Admin, Accountant · `cashbook.record`.
**Query:** `from`, `to` (inclusive, PKT calendar dates; default today), `direction`, `categoryId`, `status` (`POSTED` default; `ALL` accepted), `page`, `pageSize`, `sort=entryDate|amount`, `order`.
**200**

```ts
{
  data: CashEntry[]; page: number; pageSize: number; total: number;
  dayTotals: CashDayTotal[];                       // one row per day in range
  periodTotals: { cashIn: DecimalString; cashOut: DecimalString; net: DecimalString };
}
```

**422 `REPORT_RANGE_INVALID`** — `from > to`.
**DB:** `cash_entry` by `ix_cash_entry_date` (day view/order) or `ix_cash_entry_status` (range + status); `ix_cash_entry_category` for a category filter. Totals aggregate the same rows, so the day running totals and the period totals cannot disagree (`ARCHITECTURE.md` §11.1). Voided rows are included only when explicitly requested, and never in totals.
**Notes:** linked entries expose `linkedPaymentId`; the UI links back to the payment (PRD US-5.3). The system never derives a cash `direction` from a category name — only `nature` drives the rule.

#### CSH-2 · `POST /api/cash-entries`

**Roles:** Admin, Accountant · `cashbook.record`.
**Body**

```json
{ "entryDate": "2026-10-19", "direction": "OUT", "categoryId": "uuid",
  "amount": "15000.00", "description": "Office electricity bill — October" }
```

**201** — `CashEntry`.
**422 `CASH_NATURE_MISMATCH`** — an `INCOME`/`OPENING` category with `OUT`, or an `EXPENSE` category with `IN`. The rule is fixed by `DATABASE.md` §3.6: income/opening post IN, expense (including Refund) posts OUT (Q-9).
**409 `CATEGORY_INACTIVE`** — the category is deactivated and cannot be chosen for new entries.
**404 `CATEGORY_NOT_FOUND`**.
**400 `VALIDATION_FAILED`** — empty description or malformed date.
**422 `VALIDATION_FAILED`** — `amount` ≤ 0: well-formed, violates `ck_cash_entry_amount`.
**DB:** `cash_entry` insert (`ck_cash_entry_amount`, `ck_cash_entry_void_fields`, `ck_cash_entry_linked`), `entry_date` defaulted to today in PKT when omitted, `recorded_by` from the session, `created_at` server-side; `audit_log` `cash_entry.posted`.
**No idempotency key:** `cash_entry` has no `client_request_id` column and this document may not add one (§7, API-Q6). The UI disables submit while saving; a duplicate is corrected by voiding one entry with a reason.

#### CSH-3 · `POST /api/cash-entries/{id}/void`

**Roles:** Admin, Accountant · `cashbook.record`.
**Body:** `{ "reason": "Wrong category selected" }` (required, 3–500 chars).
**200** — `CashEntry` (`status: VOIDED`).
**409 `CASH_ENTRY_ALREADY_VOIDED`**.
**409 `CASH_ENTRY_LINKED_PAYMENT`** — this entry was auto-posted by a payment; it can only be voided by voiding the payment (LED-5). Allowing a direct void would fork the ledger from the Roznamcha (`ARCHITECTURE.md` §5.6).
**400 `VALIDATION_FAILED`** — missing reason.
**404 `CASH_ENTRY_NOT_FOUND`**.
**DB:** set `status`, `void_reason`, `voided_at`, `voided_by` (`ck_cash_entry_void_fields`; `trg_cash_entry_immutable` allows only those columns); `audit_log` `cash_entry.voided`. No delete — correction is void + repost (Q-2).

#### CSH-4 · `GET /api/cash-categories`

**Roles:** Admin, Accountant · `cashbook.record`.
**Query:** `includeInactive` (default `false`).
**200** — `CashCategory[]` (a handful of rows; not paginated).
**DB:** `cash_category` by `ix_cash_category_active`. Seeded with eight categories (`DATABASE.md` §9.1).

#### CSH-5 · `POST /api/cash-categories`

**Roles:** Admin · `cashbook.categories`.
**Body:** `{ "name": "Bank Profit", "nature": "INCOME" }`.
**201** — `CashCategory`.
**409 `CATEGORY_NAME_EXISTS`** — `uq_cash_category_name` on `lower(name)`; "Office Expense" and "office expense" collide.
**400 `VALIDATION_FAILED`** — blank name.
**DB:** `cash_category` insert (`ck_cash_category_name`); `audit_log` `cash_category.created`.

#### CSH-6 · `PATCH /api/cash-categories/{id}`

**Roles:** Admin · `cashbook.categories`.
**Body:** `{ "name"?, "nature"?, "isActive"? }` (no `version` — the table has none).
**200** — `CashCategory`.
**409 `CATEGORY_NAME_EXISTS`**.
**409 `CATEGORY_IN_USE`** — changing `nature` when entries reference the category; reclassifying history would silently change past reports. Name and `isActive` remain changeable.
**404 `CATEGORY_NOT_FOUND`**.
**DB:** `cash_category`; `audit_log` `cash_category.updated`. No DELETE — a category in use is deactivated, never removed (`DATABASE.md` §1.6).

---

### 3.7 Recovery

A read-only module with no tables (`ARCHITECTURE.md` §5.7, §4.5). Every number comes from the same open-balance query the ledger uses, so the dashboard and the ledger cannot disagree (PRD S-4).

#### REC-1 · `GET /api/recovery/summary`

**Roles:** all · `recovery.read` (Sales Agent is read-only, PRD §10 note).
**Query:** `projectId` (optional).
**200** — `RecoverySummary`: `outstanding`, `overdue`, `upcoming7`, `upcoming30`, `collectedThisMonth`, `asOf` (today in PKT).
**DB:** `due_item` joined to `booking` (`status = 'CONFIRMED'`) by `ix_due_item_open`; `collectedThisMonth` from `payment` where `status = 'POSTED'` and `paid_on` in the current PKT month (`ix_payment_status_date`) — cash basis (`ARCHITECTURE.md` §11.5).
**Notes:** "overdue" is `due_date < today (PKT)`, an integer calendar-day comparison, never hours (`ARCHITECTURE.md` §5.7). Cancelled bookings and `PAID` items never contribute.

#### REC-2 · `GET /api/recovery/dues`

**Roles:** all · `recovery.read`.
**Query:** `filter=all|overdue|upcoming` (default `all`), `upcomingDays=7|30` (default `7`), `projectId`, `blockId`, `q` (buyer/plot/ref), `sort=dueDate|overdueDays|remaining`, `order`, `page`, `pageSize`.
**200** — `Page<RecoveryRow>`.
**400 `VALIDATION_FAILED`** — bad filter/sort/page.
**DB:** the `ARCHITECTURE.md` §11.5 read model: `due_item` (`status <> 'PAID'`) → `booking` (`CONFIRMED`) → `buyer` / `plot` / `block`. `ix_due_item_open` returns the range in `due_date` order; `ix_booking_status_date` supports the join/filter.
**Notes:** `upcoming` means `due_date` between today and today + N; `overdue` means `due_date < today`; both exclude paid and cancelled. `overdueDays = today − due_date` in calendar days.

#### REC-3 · `GET /api/recovery/dues.csv`

**Roles:** all · `recovery.read` (the CSV is a read of data the role may already see; PRD D-12).
**Query:** identical to REC-2. Pagination parameters are ignored — the **filtered set is streamed in full**.
**200** — `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="Outstanding-Dues-2026-10-19.csv"`, `Cache-Control: no-store`.
**DB:** the same open-balance query, streamed (`ARCHITECTURE.md` §15.1); no temporary table and no stored export.
**CSV rules** (`ARCHITECTURE.md` §11.5): UTF-8 **BOM** (Excel opens Urdu names), RFC 4180 quoting, CRLF, and a leading apostrophe on any cell beginning `=`, `+`, `-` or `@` (formula-injection guard). Phone and CNIC are quoted text, not numbers. Columns: `Booking Ref, Buyer, Phone, CNIC, Project, Block, Plot, Due Item, Due Date, Amount, Paid, Remaining, Overdue Days, Status`.
**Audit:** `audit_log` `recovery.exported` with the filter set and row count (`ARCHITECTURE.md` §13.1). The export is limited per user (§6).

---

### 3.8 Reminders

Owns `reminder_template`, `provider_config`, `reminder_claim`, `reminder_log` (`DATABASE.md` §3.7). There is **no send endpoint**: the scheduler in the worker is the only sender (`ARCHITECTURE.md` §10.4), and there is no manual resend in the MVP (`ARCHITECTURE.md` §10.13). The API configures and observes.

#### REM-1 · `GET /api/reminder-templates`

**Roles:** Admin, Accountant · `reminder.read`.
**Query:** `channel`, `includeInactive` (default `true` for the settings screen).
**200** — `ReminderTemplate[]` (at most eight rows: two channels × four milestones; not paginated).
**DB:** `reminder_template` by `uq_reminder_template_channel_milestone`.

#### REM-2 · `POST /api/reminder-templates`

**Roles:** Admin · `reminder.configure`.
**Body:** `{ "channel": "WHATSAPP", "milestone": 3, "body": "Dear {{buyer_name}}, …", "isActive": true }`.
**201** — `ReminderTemplate`.
**409 `TEMPLATE_EXISTS`** — one template per `(channel, milestone)` (`uq_reminder_template_channel_milestone`).
**422 `TEMPLATE_PLACEHOLDER_INVALID`** — a `{{…}}` outside the allowlist `buyer_name, plot, project, amount, due_date, company`, or malformed braces (`ARCHITECTURE.md` §10.8). `fields: { "body": "UNKNOWN_PLACEHOLDER" }`.
**400 `VALIDATION_FAILED`** — milestone not 10/7/3/0 (`ck_reminder_template_milestone`) or blank body. Both are shape errors, so `400`, not `422`.
**DB:** `reminder_template` insert (`ck_reminder_template_body`); `audit_log` `reminder_template.created`.

#### REM-3 · `PATCH /api/reminder-templates/{id}`

**Roles:** Admin · `reminder.configure`.
**Body:** `{ "body"?, "isActive"? }` (channel and milestone are immutable — changing them would silently re-point a claim key).
**200** — `ReminderTemplate`.
**422 `TEMPLATE_PLACEHOLDER_INVALID`** / **`VALIDATION_FAILED`**.
**404 `TEMPLATE_NOT_FOUND`**.
**DB:** `reminder_template`; `updated_by` from the session; `audit_log` `reminder_template.updated` with field names only. No `version` — Admin-only, low concurrency, audited.
**Notes:** a saved template affects **future** renders only; `reminder_log.rendered_body` preserves what was actually sent (`DATABASE.md` §3.7).

#### REM-4 · `GET /api/reminders/config`

**Roles:** Admin, Accountant · `reminder.read`.
**200** — `ProviderConfig[]` (one row per channel; the secret is never present).
**DB:** `provider_config`; `secret_ciphertext` is omitted at the Prisma layer on every read (`DATABASE.md` §3.7, Q-7). `secretConfigured` is derived from `secret_ciphertext IS NOT NULL`.
**Notes:** the Settings banner *"Dry run — messages are logged, not sent"* is driven by `isLive === false` (`ARCHITECTURE.md` §10.9).

#### REM-5 · `PATCH /api/reminders/config/{channel}`

**Roles:** Admin · `reminder.configure`.
**Path:** `channel` = `SMS` | `WHATSAPP`.
**Body**

```json
{
  "providerName": "local-sms-gateway",
  "isEnabled": true,
  "isLive": true,
  "apiBaseUrl": "https://sms.example.pk/api",
  "senderId": "GREENCITY",
  "secret": "write-only-value",
  "waTemplateName": null,
  "waTemplateLanguage": null,
  "waTemplateVariables": null
}
```

All properties optional; omitted = unchanged. `"secret": null` clears it (rejected with `422 PROVIDER_SECRET_REQUIRED` if the row is live). The secret is **write-only**: it is encrypted with AES-256-GCM using `APP_SECRETS_KEY` and never returned, logged, or placed in an error (`ARCHITECTURE.md` §10.10).

**200** — `ProviderConfig`.
**422 `PROVIDER_CONFIG_INVALID`** — `isLive = true` while `providerName = "dry-run"` or `isEnabled = false` (`ck_provider_config_live`).
**422 `PROVIDER_SECRET_REQUIRED`** — going live with no stored secret. This is a service rule, not a column constraint: the database cannot know whether the ciphertext decrypts.
**409 `CHANNEL_CONFLICT`** — enabling a channel while another channel is already enabled. The MVP runs one active channel (PRD D-6); switching is disable-one-then-enable-the-other, not two live channels.
**400 `VALIDATION_FAILED`** — bad URL or unknown provider name (a closed vocabulary, checked as shape).
**404 `PROVIDER_CONFIG_NOT_FOUND`** — the channel has no row.
**DB:** `provider_config` non-secret columns + `secret_ciphertext`; `updated_by`; `audit_log` `provider_config.updated` with changed field names only (never the secret).
**Notes:** an env-provided credential overrides the DB row; the UI shows "Configured via environment" and this endpoint refuses a secret edit in that case with `409` `CONFIGURED_BY_ENV`.

#### REM-6 · `POST /api/reminders/test`

**Roles:** Admin · `reminder.configure`.
**Body:** `{ "phone": "+923001234567", "channel": "SMS" }`.
**200** — `{ "mode": "dry_run" | "live", "renderedBody": "Dear …", "logId": null }`.
**409 `REMINDER_NOT_CONFIGURED`** — channel disabled or provider not configured.
**422 `INVALID_PHONE`** — not E.164.
**429 `RATE_LIMITED`** — more than 5 test messages per minute per user.
**DB:** reads `provider_config`; **writes no `reminder_log` row** — `reminder_log.due_item_id` is `NOT NULL` and a test has no due item (`DATABASE.md` §3.7). The outcome goes to the application log; the response body is the rendered preview. In dry-run no provider call is made (`ARCHITECTURE.md` §10.9).
**Notes:** the Admin must confirm the phone in the UI. This is the only way to see a rendered message before a real due item exists.

#### REM-7 · `GET /api/reminders/log`

**Roles:** Admin, Accountant · `reminder.read`.
**Query:** `dueItemId`, `bookingRef`, `buyerId`, `status` (`SENT|FAILED|SKIPPED`), `channel`, `milestone`, `from`, `to`, `page`, `pageSize`.
**200** — `Page<ReminderLogRow>` (newest `attempted_at` first).
**400 `VALIDATION_FAILED`** — unknown status/milestone.
**DB:** `reminder_log` by `ix_reminder_log_due_item` / `ix_reminder_log_status_time`; joins `due_item → booking → plot` and `buyer` for the display columns; `claim_id` is exposed but `reminder_claim` has no endpoint.
**Dry-run visibility:** every scheduler dry-run attempt is a `SKIPPED` row with `reason = "dry_run"` and the real `rendered_body`; no `reminder_claim` row is created (`ARCHITECTURE.md` §10.9). The Admin therefore sees exactly what would have been sent, to which number, for which milestone — and flips live later without losing those milestones.
**Failure banner:** the Admin/Accountant dashboard calls this endpoint with `status=FAILED&from=<24h ago>` and uses `total` for *"N sends failed in the last 24 hours"* (`ARCHITECTURE.md` §10.11).

---

### 3.9 Documents

Stateless (`ARCHITECTURE.md` §5.9, §8.1). PDFs are generated **per request** and never stored, because a stored document would be stale the moment a buyer or due item changed (PRD BR-6, ADR-13). Both endpoints are `GET` and have no side effects; a download is deliberately not audited (`ARCHITECTURE.md` §13.1).

#### DOC-1 · `GET /api/bookings/{ref}/documents/allotment-letter.pdf`

**Roles:** all · `document.download` (PRD §10 collapses generate and download into one capability).
**200** — `application/pdf`; `Content-Disposition: attachment; filename="Allotment-Letter-BK-1042.pdf"`; `Cache-Control: no-store`.
**429 `RATE_LIMITED`** — more than 10 PDF renders per minute for this user.
**409 `DOCUMENT_BOOKING_CANCELLED`** — the document is only valid for a confirmed booking.
**404 `BOOKING_NOT_FOUND`**.
**500 `DOCUMENT_GENERATION_FAILED`** — render failed; the UI shows Retry (PRD §12).
**503 `SERVER_BUSY`** — the in-process render semaphore (2) is saturated; `Retry-After: 2` (`ARCHITECTURE.md` §8.3).
**DB:** read-only: `company` (+ logo `file_object`), `project`, `plot`, `booking`, `booking_buyer`/`buyer`, `payment_plan`, `due_item`. No transaction, no write, no audit.
**Notes:** available immediately after confirmation (PRD D-3). Content: letterhead, date, buyers with CNIC and share %, plot identity, size in Marla and sq ft, dimensions, sale price, booking date, payment summary, and `company.pdf_terms_text`. English only (A-3). Concurrency is capped in-process; a burst queues briefly rather than spiking memory.

#### DOC-2 · `GET /api/bookings/{ref}/documents/payment-schedule.pdf`

**Roles:** all · `document.download`.
**200** — `application/pdf`; `filename="Payment-Schedule-BK-1042.pdf"`; `Cache-Control: no-store`.
**429 `RATE_LIMITED`** — more than 10 PDF renders per minute for this user.
**409 `DOCUMENT_BOOKING_CANCELLED`**.
**404 `BOOKING_NOT_FOUND`**.
**500 `DOCUMENT_GENERATION_FAILED`**; **503 `SERVER_BUSY`**.
**DB:** read-only: `booking`, `booking_buyer`/`buyer`, `plot`, `project`, `company`, `payment_plan`, `due_item` (ordered by `sequence`). No write.
**Notes:** lists every due item with label, due date (`DD-MMM-YYYY`), amount (`PKR` format) and totals; it reflects the stored due items at generation time (PRD US-4.2). A 120-installment schedule is ~4–6 pages (`ARCHITECTURE.md` §8.6).

---

### 3.10 Reporting

Read-only (`ARCHITECTURE.md` §5.10). Both reports read **only** posted `cash_entry` rows; the same rows feed the Roznamcha, so PRD S-6 holds structurally (`ARCHITECTURE.md` §11.1). There is no report PDF endpoint: reports are printed by the browser's print view (`ARCHITECTURE.md` §11.6) and are English-only.

#### REP-1 · `GET /api/reports/cash-flow`

**Roles:** all · `report.read`.
**Query:** `from`, `to` (**required**, inclusive PKT dates).
**200**

```ts
{
  from: DateOnly; to: DateOnly;
  openingCash: DecimalString;
  cashIn: Array<{ categoryId: UUID; name: string; amount: DecimalString }>;
  cashOut: Array<{ categoryId: UUID; name: string; amount: DecimalString }>;
  closingCash: DecimalString;
  totals: { cashIn: DecimalString; cashOut: DecimalString; net: DecimalString };
}
```

**422 `REPORT_RANGE_INVALID`** — missing or reversed range, or a non-date value.
**DB:** one SQL statement over `cash_entry` filtered `status = 'POSTED'` and `entry_date <= to`, joined to `cash_category`; `ix_cash_entry_status` / `ix_cash_entry_date`. Opening cash is the net of posted entries before `from`, **plus** `OPENING`-nature entries dated on/after `from` (`ARCHITECTURE.md` §11.2); opening entries are excluded from the period breakdown so a go-live injection does not look like income.
**Notes:** "Sale collections" is the `booking_receipt` category group; linked entries are included once, by their own amount. Voided entries are excluded everywhere.

#### REP-2 · `GET /api/reports/income-statement`

**Roles:** all · `report.read`.
**Query:** `from`, `to` (**required**).
**200**

```ts
{
  from: DateOnly; to: DateOnly;
  basis: "CASH";                                  // literal label (PRD A-9)
  saleCollections: DecimalString;                 // posted entries with linked_payment_id
  otherIncome: DecimalString;                     // posted IN, nature INCOME, unlinked
  totalIncome: DecimalString;
  expenses: Array<{ categoryId: UUID; name: string; amount: DecimalString }>;
  totalExpenses: DecimalString;
  net: DecimalString;
}
```

**422 `REPORT_RANGE_INVALID`**.
**DB:** one SQL statement over `cash_entry` + `cash_category`; `nature = 'OPENING'` is excluded from both sides (`ARCHITECTURE.md` §11.3).
**Notes:** the UI renders the literal "Cash basis" badge from `basis`; no translation of the report itself. Print is a client route, not an API.

---

### 3.11 Audit

Owns `audit_log` (`DATABASE.md` §3.10). Append-only, Admin-only, written by every mutating command in the same transaction (`ARCHITECTURE.md` §13). Reads are **not** audited (that would recurse, §13.4) — except the CSV export, which is an access event the sources explicitly name.

#### AUD-1 · `GET /api/audit-logs`

**Roles:** Admin · `audit.read`.
**Query:** `from`, `to`, `actorUserId`, `entityType`, `entityId`, `actionCode`, `bookingRef`, `page`, `pageSize`. Sorting is fixed `occurredAt DESC, id DESC` (`ARCHITECTURE.md` §13.4) — no `sort` parameter.
**200** — `Page<AuditRow>`.
**400 `VALIDATION_FAILED`** — unknown `entityType`/`actionCode` format or bad page.
**DB:** `audit_log` by `ix_audit_log_time`, `ix_audit_log_actor`, `ix_audit_log_entity`, `ix_audit_log_action`, `ix_audit_log_booking`; `actor` is joined from `app_user` on `actor_user_id`, but `actorLabel` always comes from the row itself (a deactivated user still shows the historical name).
**Notes:** `summary` is returned as JSON; the UI renders a sentence from `actionCode` + `summary` (`ARCHITECTURE.md` §13.2). No CNIC, phone, address or file path is ever in it.

#### AUD-2 · `GET /api/audit-logs.csv`

**Roles:** Admin · `audit.read`.
**Query:** identical to AUD-1; pagination ignored, the filtered set streams in full.
**200** — `text/csv; charset=utf-8`, BOM, RFC 4180, CRLF, formula-injection guard; `filename="Audit-Log-2026-10-19.csv"`.
**429 `RATE_LIMITED`** — 5 exports per minute per user.
**DB:** streamed `audit_log` read; inserts one `audit_log` row `audit.exported` with the filters and row count (`ARCHITECTURE.md` §13.4) — an INSERT, never an update.
**Notes:** the export contains `actorLabel`, `actionCode`, `entityType`, `entityId`, `occurredAt` and `summary`, not PII beyond a staff actor label.

#### AUD-3 · `GET /api/bookings/{ref}/timeline`

**Roles:** Admin · `audit.read`.
**Query:** `page`, `pageSize`.
**200** — `Page<AuditRow>` filtered by `booking_id`.
**404 `BOOKING_NOT_FOUND`**.
**DB:** `audit_log` by `ix_audit_log_booking`; `booking_id` is the denormalized column (`DATABASE.md` §3.10), so this is one index scan, not a join.
**Notes:** this is the Admin-only booking timeline. All roles see the **plot** status history (INV-9), notes (SAL-12) and the ledger; they do not see the audit trail. The separation is deliberate (`ARCHITECTURE.md` §13.4).

---

### 3.12 Core

Platform services: files and job health (`DATABASE.md` §3.11). Files are private and content-addressed (`ARCHITECTURE.md` §7.2); the API exposes opaque `file_object.id`s, never storage keys or paths.

#### COR-1 · `POST /api/files`

**Roles:** by `kind` — `MASTER_PLAN` → Admin (`inventory.manage`); `COMPANY_LOGO` → Admin (`setup.manage`); `BUYER_PHOTO` → Admin, Sales Agent (`buyer.edit`).
**Body:** `multipart/form-data` with `file` and `kind`.
**201** — `FileObject` (new object). **200** — identical bytes already stored for this kind (`uq_file_object_storage_key`); the existing object is returned and no duplicate row is created. If that object was soft-deleted, it is restored (`deleted_at = NULL`) rather than duplicated, because the unique key would reject a second row.
**413 `FILE_TOO_LARGE`** — over 25 MB (plan), 5 MB (photo) or 2 MB (logo); Nginx also caps the body at 26 MB.
**415 `FILE_TYPE_UNSUPPORTED`** — magic bytes outside the kind's allowlist (JPG/PNG/WebP for plan/logo; JPG/PNG for photo). SVG, GIF, HEIC, PDF and archives are rejected (`ARCHITECTURE.md` §7.3).
**422 `FILE_UNREADABLE`** — decode failure or decompression bomb.
**400 `VALIDATION_FAILED`** — missing `kind`/`file`.
**429 `RATE_LIMITED`** — more than 10 uploads per minute for this user.
**DB:** `file_object` insert only after all bytes and derivatives succeed (`ARCHITECTURE.md` §7.3 step 7): `storage_key` = `<kind>/<x2>/<y2>/<sha256>.<ext>`, `sha256`, `mime_type`, `byte_size`, `width_px`/`height_px`; `ck_file_object_size`, `ck_file_object_sha256`, `ck_file_object_dims`, `ck_file_object_key`; `uploaded_by` from the session.
**Notes:** upload does **not** bind the object to a project/buyer/company. The owner reference is set by SET-7 (master plan), SET-2 (logo) or SAL-2/SAL-4 (photo) after the client has the id. An unbound object is an orphan and is cleaned up after the grace period (`ARCHITECTURE.md` §7.5). This two-step flow is what makes the master-plan aspect-ratio warning possible before the project is changed.

#### COR-2 · `GET /api/files/{id}`

**Roles:** by kind — `MASTER_PLAN` → `inventory.read`; `BUYER_PHOTO` → `buyer.read`; `COMPANY_LOGO` → any authenticated user.
**Query:** `variant=original|display|thumb|avatar` (default `original`; `avatar` is valid only for photos). Any other value is `400 VALIDATION_FAILED`.
**200** — the binary; `Content-Type` from `file_object.mime_type` (derivatives use their own type), `Content-Length`, `ETag: "<sha256>"`, `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`.
**304 Not Modified** — `If-None-Match` matches the SHA-256 ETag.
**404 `FILE_NOT_FOUND`** — unknown or GC'd object.
**403 `AUTH_FORBIDDEN`** — the caller lacks the read capability for this kind. In the MVP all three roles hold all three read capabilities, so this is unreachable in normal use; the check exists so a future role without `buyer.read` cannot fetch a photo.
**DB:** `file_object` by PK; `deleted_at IS NULL`. The object is streamed from the store by `storage_key`; the key never appears in the response or the URL (`ARCHITECTURE.md` §7.4).
**Notes:** derivatives are files under distinct keys generated by the upload pipeline, not columns. `variant` is a legitimate derived selector, not a database value.

#### COR-3 · `GET /api/health`

**Roles:** public (no session, no CSRF check; the external monitor uses it).
**200** — `{ "status": "ok", "version": "1.4.2" }`.
**503** — only if the process is up but the database ping fails.
**DB:** optional `SELECT 1`; no tables.
**Notes:** minimal on purpose — no schema, counts or secrets (`ARCHITECTURE.md` §10.11).

#### COR-4 · `GET /api/health/details`

**Roles:** machine token — `Authorization: Bearer <HEALTH_DETAILS_TOKEN>`; **not** a session cookie, and not usable by staff.
**200**

```ts
{
  status: "ok" | "degraded";
  lastReminderTick: { startedAt: Instant; status: "RUNNING" | "SUCCEEDED" | "FAILED" } | null;
  lastBackupHeartbeat: Instant | null;
  runningJobs: Array<{ jobName: string; startedAt: Instant }>;
  database: "ok";
}
```

**401 `AUTH_REQUIRED`** — missing/wrong token.
**DB:** `job_run` by `ix_job_run_name_time` and `ix_job_run_running`; the backup heartbeat is the timestamp written by the backup script's marker, not a database row. Read-only.
**Notes:** the external monitor alerts if the reminder tick is stale during 09:00–20:00 PKT (`ARCHITECTURE.md` §14.8).

---

## 4. Validation rules the schema cannot express alone

`DATABASE.md` already enforces what a row can know: formats, signs, enums, uniqueness, one active booking per plot, one primary buyer, the paid/status pairing, void-field pairing. The rules below are **cross-row, cross-aggregate or policy** rules; the API must enforce them because a column constraint cannot, and the nightly checks only prove them after the fact.

| # | Endpoint(s) | Rule | Failure |
|---|---|---|---|
| V-1 | SAL-6, SAL-10 | Buyer shares total **exactly 100.00** across all buyers of one booking (`numeric(5,2)`, no tolerance). | `422 SHARE_TOTAL_INVALID` |
| V-2 | SAL-6, SAL-10 | Exactly one `isPrimary: true`; the first-listed buyer is not implicitly primary. | `422 SHARE_PRIMARY_INVALID` |
| V-3 | SAL-6, SAL-10 | At least one buyer; no duplicate `buyerId` and no duplicate CNIC in the same request. | `422 BUYER_REQUIRED` / `DUPLICATE_BUYER` |
| V-4 | SAL-6 | Plan math: `tokenAmount ≥ 0`, `downPaymentAmount ≥ 0`, `tokenAmount + downPaymentAmount < salePricePkr`, `balance > 0`, `1 ≤ installmentCount ≤ 120`, `base = round2(balance / installmentCount) > 0`, every installment positive, and `sum(installments) + tokenAmount + downPaymentAmount = salePricePkr` exactly. The server recomputes from the price, never from a client-supplied schedule. | `422 PLAN_INVALID` + `fields` |
| V-5 | SAL-6 | Booking is allowed from `AVAILABLE`; from `RESERVED` only when the actor is Admin **and** `confirmReserved: true`. | `409 BOOKING_PLOT_UNAVAILABLE` / `422 BOOKING_RESERVED_CONFIRMATION_REQUIRED` |
| V-6 | SAL-6 | An inline `buyer` may only create a **new** CNIC. If the CNIC exists, return `409` with `fields.cnic = EXISTS`; the client re-queries SAL-1 and sends `buyerId`. This prevents a booking from silently rewriting the canonical buyer record used by other bookings (PRD A-12). | `409 BUYER_CNIC_EXISTS` |
| V-7 | SAL-6, SAL-10 | A cancelled booking cannot receive a new buyer set; a sold plot cannot be cancelled. | `409 BOOKING_ALREADY_CANCELLED` / `BOOKING_NOT_CANCELLABLE` |
| V-8 | SAL-2, SAL-4 | CNIC is normalized to `NNNNN-NNNNNNN-N` (digits, dashes inserted) before validation and uniqueness; phone is E.164 (`^\+[1-9]\d{7,14}$`, DQ-14). A CNIC correction requires `cnicChangeReason` and is audited with field names only. | `400 VALIDATION_FAILED` / `422 CNIC_REASON_REQUIRED` / `409 CNIC_IN_USE` |
| V-9 | SAL-2, SAL-6, SAL-10 | `consentSms` is required at buyer registration and may be changed only through SAL-5. `consent_recorded_at` is **always** set by the server to `now()`; the client can neither supply nor backdate it. | `400 VALIDATION_FAILED` |
| V-10 | INV-3, INV-5, INV-7 | Plot number trimmed and upper-cased; unique **per project**, independent of block. A plot's `blockId` must belong to the project that owns it; `projectId` is derived from the block, never accepted. | `409 PLOT_NUMBER_EXISTS` / `422 BLOCK_PROJECT_MISMATCH` |
| V-11 | INV-3, INV-7 | Polygon: array of ≥3 `[x,y]` pairs, every coordinate a number in `[0,1]`, non-zero area. Same rule as `spm_polygon_ok` so the API error arrives before the constraint. | `422 POLYGON_INVALID` |
| V-12 | SET-7 | A replacement master plan whose aspect ratio differs from the stored one by more than **0.5%** requires `confirmAspectRatioChange: true`; the UI warns that existing normalized polygons will distort (`ARCHITECTURE.md` §7.3, Q-12). | `422 MASTER_PLAN_ASPECT_CHANGED` |
| V-13 | COR-1 | Size and magic-byte allowlist **per kind**: plan 25 MB JPG/PNG/WebP; logo 2 MB PNG/JPG/WebP; photo 5 MB JPG/PNG. Client filename/extension/MIME are advisory. Decode with a pixel cap to stop bombs. | `413 FILE_TOO_LARGE` / `415 FILE_TYPE_UNSUPPORTED` / `422 FILE_UNREADABLE` |
| V-14 | SET-2, SET-7, SAL-2, SAL-4 | A referenced file must exist, not be soft-deleted, and have the **kind** the binding expects (logo/plan/photo). | `422 FILE_KIND_MISMATCH` / `404 FILE_NOT_FOUND` |
| V-15 | LED-3 | Explicit allocations: each `> 0`, each `≤ dueItem.remaining`, one row per due item, sum `≤ payment.amount`. Omitted allocations are chosen oldest-unpaid-first under the booking lock. Overpayment beyond all allocations is legal advance credit. | `422 ALLOCATION_*` / `DUPLICATE_ALLOCATION` |
| V-16 | LED-3 | A payment can only be recorded on a `CONFIRMED` booking; a cancelled booking has no payable ledger. | `409 BOOKING_NOT_PAYABLE` |
| V-17 | SAL-11, LED-5, CSH-3 | A void/cancel reason is required, trimmed, 3–500 characters, plain text (rendered as text, never HTML). A second void/cancel is `409`, never a silent success. | `422 VALIDATION_FAILED` / `409 *_ALREADY_*` |
| V-18 | INV-5, SAL-4, SAL-9, SET-6, SAL-5 | `version` is required on every edit to `plot`/`buyer`/`booking`/`project`; it must equal the stored value. | `409 CONFLICT_STALE_WRITE` |
| V-19 | SET-2, SET-4, SET-6, INV-3, INV-5 | `marlaSqft > 0` when present; `sizeMarla > 0`; `pricePkr ≥ 0` on a plot and `> 0` on a booking; `widthFt`/`depthFt` either both absent or both positive. A malformed number is `400`; a well-formed zero/negative is `422`. | `400` / `422 VALIDATION_FAILED` |
| V-20 | CSH-2, CSH-6 | Direction must match category nature (`INCOME`/`OPENING` → `IN`, `EXPENSE` → `OUT`); an inactive category cannot be used for a new entry; `nature` cannot change while entries reference the category. | `422 CASH_NATURE_MISMATCH` / `409 CATEGORY_INACTIVE` / `409 CATEGORY_IN_USE` |
| V-21 | CSH-3 | A payment-linked cash entry cannot be voided directly; void the payment (which voids the entry in the same transaction). | `409 CASH_ENTRY_LINKED_PAYMENT` |
| V-22 | REM-2, REM-3 | Placeholders are a strict allowlist (`buyer_name`, `plot`, `project`, `amount`, `due_date`, `company`); unknown/malformed braces are rejected at save time. No expressions, no HTML. | `422 TEMPLATE_PLACEHOLDER_INVALID` |
| V-23 | REM-5 | `isLive ⇒ providerName ≠ "dry-run" ∧ isEnabled ∧ a secret is configured`; only one channel enabled at a time; a secret write is never echoed. | `422 PROVIDER_CONFIG_INVALID` / `PROVIDER_SECRET_REQUIRED` / `409 CHANNEL_CONFLICT` |
| V-24 | REP-1, REP-2, CSH-1 | `from` and `to` are required, valid `YYYY-MM-DD`, and `from ≤ to`. Reporting never accepts an open-ended range. | `422 REPORT_RANGE_INVALID` |
| V-25 | all list endpoints | `page ≥ 1`, `1 ≤ pageSize ≤ 100`, `sort` on the endpoint's whitelist, `order ∈ {asc, desc}`. Unknown query parameters are rejected rather than ignored (typos otherwise become silent whole-table scans). | `400 VALIDATION_FAILED` |
| V-26 | AUTH-5, IDN-4 | Password 12–128 characters, not equal to the current password; the current password is always required for a self-change. | `422 PASSWORD_POLICY_VIOLATION` / `PASSWORD_CURRENT_INVALID` |
| V-27 | every request | Unknown JSON properties are rejected (`400`). A request may reference related ids (`plotId`, `buyerId`, `dueItemId`) but may not carry the target row's own `id`, `createdBy`, `recordedBy`, `createdAt`, `role`, status totals or a client timestamp for a server-stamped field. | `400 VALIDATION_FAILED` |
| V-28 | REC-3, AUD-2 | CSV cells beginning `=`, `+`, `-`, `@` are prefixed with `'`; phone/CNIC are quoted text; UTF-8 BOM + CRLF. | n/a (output rule) |
| V-29 | AUTH-* | While `must_change_password = true`, every endpoint except the five listed in §2.3 is blocked. | `403 PASSWORD_CHANGE_REQUIRED` |
| V-30 | SAL-6, SAL-10 | A booking has at least one due item and at least one installment; a 100% cash purchase (token + down = price) is out of MVP scope (`ARCHITECTURE.md` §12.6). | `422 PLAN_INVALID` |

**Rules deliberately *not* imposed by the API**, because the sources do not define them and inventing one would be a product decision: a maximum number of joint buyers; a maximum booking look-back; a minimum token percentage; a maximum payment amount; a restriction on `paid_on` in the future; duplicate buyer phone numbers; Urdu/English content rules for buyer names. If any becomes a requirement, it belongs in `PRD.md` first.

---

## 5. Error catalog

Every code the API can return, the status it carries, and the condition that produces it. `fields` is present when the UI can attach the error to a control.

### 5.1 Authentication and access

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Unknown email, wrong password, or inactive user — one generic message | AUTH-1 |
| `AUTH_ACCOUNT_THROTTLED` | 429 | Account lock active, or the per-IP Nginx limit was hit; `Retry-After` = seconds remaining | AUTH-1 |
| `AUTH_REQUIRED` | 401 | No session cookie, or a missing/invalid machine token | any protected; COR-4 |
| `AUTH_SESSION_EXPIRED` | 401 | Token unknown, revoked, idle-expired or past the 12-hour absolute cap | any protected; AUTH-3/4 |
| `AUTH_FORBIDDEN` | 403 | Capability absent; checked before the row lookup | any capability-guarded |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `must_change_password = true` and the endpoint is not one of the five exemptions | all but §2.3 list |
| `CSRF_ORIGIN_REJECTED` | 403 | `Origin`/`Host` mismatch on a non-GET request | all mutations |
| `PASSWORD_CURRENT_INVALID` | 422 | Self-change with a wrong current password | AUTH-5 |
| `PASSWORD_POLICY_VIOLATION` | 422 | Length/equality policy; `fields.newPassword` | AUTH-5, IDN-4 |

### 5.2 Request shape

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 / 422 | `400` for malformed JSON, wrong type, missing/blank/unknown property, bad enum value, bad pagination/sort, missing reason or bad format. `422` when the shape is valid but a stated positivity rule fails (a `0.00` amount, a `0` Marla value, a negative price) — `fields` names the input | all; `422` at SET-2, SET-4, CSH-2 |
| `CONFLICT_RETRY` | 409 | Postgres reported a deadlock; a lock-order bug, not a user conflict. Retryable and logged as an anomaly | any write (`ARCHITECTURE.md` §12.3) |
| `METHOD_NOT_ALLOWED` | 405 | Known path, wrong verb | all |
| `INTERNAL` | 500 | Unexpected server failure (no details leak) | all |

### 5.3 Identity and optimistic locking

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `CONFLICT_STALE_WRITE` | 409 | `version` did not match the stored row; `fields.version = STALE` | INV-5, INV-7, SAL-4, SAL-5, SAL-9, SAL-10, SET-6, SET-7 |
| `USER_NOT_FOUND` | 404 | Unknown user id | IDN-5 … IDN-8 |
| `USER_EMAIL_EXISTS` | 409 | `uq_app_user_email` | IDN-4 |
| `USER_SELF_DEACTIVATION` | 409 | An Admin attempted to deactivate their own account | IDN-6 |
| `USER_LAST_ADMIN` | 409 | The change would leave zero active Admins | IDN-6 |

### 5.4 Setup and inventory

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `COMPANY_NOT_CONFIGURED` | 404 | No singleton company row yet | SET-1, SET-4 |
| `PROJECT_NOT_FOUND` | 404 | Unknown project id | SET-5…SET-9, INV-1, INV-2 |
| `PROJECT_NAME_EXISTS` | 409 | `uq_project_company_name` | SET-4, SET-6 |
| `BLOCK_NOT_FOUND` | 404 | Unknown block id | SET-10/11, INV-3/5 |
| `BLOCK_CODE_EXISTS` | 409 | `uq_block_project_code` | SET-9, SET-10 |
| `BLOCK_HAS_PLOTS` | 409 | Block still contains plots; FK `RESTRICT` | SET-11 |
| `BLOCK_PROJECT_MISMATCH` | 422 | Moving a plot to a block in another project | INV-5 |
| `PLOT_NOT_FOUND` | 404 | Unknown plot id | INV-4…INV-12, SAL-6 |
| `PLOT_NUMBER_EXISTS` | 409 | `uq_plot_project_number` | INV-3, INV-5 |
| `PLOT_IN_USE` | 409 | Booking or status history references the plot | INV-6 |
| `PLOT_STATUS_INVALID` | 409 | Transition not in the state machine | INV-10, INV-11, INV-12 |
| `POLYGON_INVALID` | 422 | <3 points, out-of-range coordinate, zero area | INV-3, INV-7 |
| `FILE_NOT_FOUND` | 404 | Unknown/soft-deleted object or missing blob | COR-2, SET-2/7, SAL-2/4 |
| `FILE_KIND_MISMATCH` | 422 | Object kind differs from the binding's expected kind | SET-2, SET-7, SAL-2, SAL-4 |
| `MASTER_PLAN_ASPECT_CHANGED` | 422 | Aspect ratio changed >0.5% without confirmation | SET-7 |

### 5.5 Sales

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `BUYER_NOT_FOUND` | 404 | Unknown buyer id | SAL-3…SAL-6, SAL-10, LED-2 |
| `BUYER_CNIC_EXISTS` | 409 | `uq_buyer_cnic`; `fields.cnic = EXISTS` | SAL-2, SAL-6 |
| `CNIC_IN_USE` | 409 | CNIC correction collides with another buyer | SAL-4 |
| `CNIC_REASON_REQUIRED` | 422 | CNIC supplied without `cnicChangeReason` | SAL-4 |
| `BUYER_REQUIRED` | 422 | Empty buyer list | SAL-6, SAL-10 |
| `DUPLICATE_BUYER` | 422 | Same buyer/CNIC twice in one request | SAL-6, SAL-10 |
| `SHARE_TOTAL_INVALID` | 422 | Shares do not sum to 100.00 | SAL-6, SAL-10 |
| `SHARE_PRIMARY_INVALID` | 422 | Zero or multiple primary buyers | SAL-6, SAL-10 |
| `PLAN_INVALID` | 422 | Any V-4 plan assertion fails; `fields` names the input | SAL-6 |
| `BOOKING_NOT_FOUND` | 404 | Unknown `BK-…`/UUID | SAL-8…SAL-13, LED-1, DOC-1/2, AUD-3 |
| `BOOKING_PLOT_UNAVAILABLE` | 409 | Plot not bookable, or the partial unique index rejected the insert | SAL-6 |
| `BOOKING_RESERVED_CONFIRMATION_REQUIRED` | 422 | Admin booking a reserved plot without `confirmReserved` | SAL-6 |
| `BOOKING_ALREADY_CANCELLED` | 409 | Second cancel, or a buyer-set edit on a cancelled booking | SAL-10, SAL-11 |
| `BOOKING_NOT_CANCELLABLE` | 409 | Plot is `SOLD_CONSTRUCTED` | SAL-11 |
| `BOOKING_HAS_PAYMENTS` | 409 | Buyer-set edit after a posted payment | SAL-10 |
| `BOOKING_NOT_PAYABLE` | 409 | Payment on a cancelled booking | LED-3 |

### 5.6 Ledger and cashbook

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `PAYMENT_NOT_FOUND` | 404 | Unknown payment id | LED-4, LED-5 |
| `PAYMENT_AMOUNT_INVALID` | 422 | Amount ≤ 0 or >2 decimals | LED-3 |
| `PAYMENT_ALREADY_VOIDED` | 409 | Second void | LED-5 |
| `DUE_ITEM_NOT_FOUND` | 404 | Allocation names an unknown due item | LED-3 |
| `DUE_ITEM_NOT_IN_BOOKING` | 422 | Due item belongs to another booking | LED-3 |
| `DUPLICATE_ALLOCATION` | 422 | Same due item twice in one payment | LED-3 |
| `ALLOCATION_EXCEEDS_DUE` | 422 | Allocation > remaining on that due item | LED-3 |
| `ALLOCATION_SUM_EXCEEDS_PAYMENT` | 422 | Allocations total > payment amount | LED-3 |
| `CASH_ENTRY_NOT_FOUND` | 404 | Unknown cash entry | CSH-3 |
| `CASH_ENTRY_ALREADY_VOIDED` | 409 | Second void | CSH-3 |
| `CASH_ENTRY_LINKED_PAYMENT` | 409 | Direct void of a payment-linked entry | CSH-3 |
| `CASH_NATURE_MISMATCH` | 422 | Direction contradicts category nature | CSH-2 |
| `CATEGORY_NOT_FOUND` | 404 | Unknown category | CSH-2, CSH-6 |
| `CATEGORY_INACTIVE` | 409 | Inactive category chosen for a new entry | CSH-2 |
| `CATEGORY_NAME_EXISTS` | 409 | `uq_cash_category_name` on `lower(name)` | CSH-5, CSH-6 |
| `CATEGORY_IN_USE` | 409 | Nature change while entries reference the category | CSH-6 |

### 5.7 Reporting, reminders, documents, files

| Code | HTTP | Condition | Endpoints |
|---|---|---|---|
| `REPORT_RANGE_INVALID` | 422 | Missing/reversed/non-date range | REP-1/2, CSH-1 |
| `TEMPLATE_NOT_FOUND` | 404 | Unknown template id | REM-3 |
| `TEMPLATE_EXISTS` | 409 | `(channel, milestone)` already has a template | REM-2 |
| `TEMPLATE_PLACEHOLDER_INVALID` | 422 | Placeholder outside the allowlist or malformed | REM-2, REM-3 |
| `PROVIDER_CONFIG_NOT_FOUND` | 404 | Channel has no config row | REM-5 |
| `PROVIDER_CONFIG_INVALID` | 422 | Live + dry-run/disabled combination | REM-5 |
| `PROVIDER_SECRET_REQUIRED` | 422 | Going live with no stored secret | REM-5 |
| `CHANNEL_CONFLICT` | 409 | Enabling a second channel | REM-5 |
| `CONFIGURED_BY_ENV` | 409 | Secret edit while the environment supplies credentials | REM-5 |
| `REMINDER_NOT_CONFIGURED` | 409 | Test send on a disabled/unconfigured channel | REM-6 |
| `INVALID_PHONE` | 422 | Test recipient not E.164 | REM-6 |
| `RATE_LIMITED` | 429 | Heavy-endpoint per-user limit; `Retry-After` | COR-1, DOC-1/2, REC-3, AUD-2, REM-6 |
| `DOCUMENT_BOOKING_CANCELLED` | 409 | PDF requested for a cancelled booking | DOC-1, DOC-2 |
| `DOCUMENT_GENERATION_FAILED` | 500 | Render failed; logged with `requestId` | DOC-1, DOC-2 |
| `SERVER_BUSY` | 503 | PDF semaphore saturated; `Retry-After: 2` | DOC-1, DOC-2 |
| `FILE_TOO_LARGE` | 413 | Per-kind or 26 MB Nginx cap exceeded | COR-1 |
| `FILE_TYPE_UNSUPPORTED` | 415 | Magic bytes outside the kind allowlist | COR-1 |
| `FILE_UNREADABLE` | 422 | Decode failure / decompression bomb | COR-1 |

### 5.8 Two names the client should know

- **`IDEMPOTENCY_REPLAY` is not an error.** A replayed `POST /api/bookings` or `POST …/payments` is a **success**: `200`, the original resource, and the header `Idempotent-Replay: true`. It is listed here because clients often model it as an error; they should not.
- **`CONSENT_REQUIRED` is deliberately absent.** Consent is a captured boolean, not a precondition. A buyer may decline and still be booked; reminders for that buyer are logged `SKIPPED / no_consent` (`ARCHITECTURE.md` §10.5). Turning consent on is an explicit Admin/Accountant action with a server timestamp (SAL-5), not an acknowledgment checkbox. `PLOT_ALREADY_BOOKED` from the prompt maps to **`BOOKING_PLOT_UNAVAILABLE`**, the code `ARCHITECTURE.md` §12.1 fixes.

---

## 6. Rate limiting and abuse controls

The application is internal, single-tenant and sized for ≤25 users and ≤5 concurrent (`PRD A-1`). Beyond login there is **no general API rate limit**; adding one would be noise. The controls `ARCHITECTURE.md` §6.4 names are:

| Control | Scope | Limit | Response |
|---|---|---|---|
| Login, per IP | Nginx `limit_req` on `/api/auth/login` | 5 r/min, burst 5 | `429 AUTH_ACCOUNT_THROTTLED`, `Retry-After` |
| Login, per account | `login_throttle` in Postgres | 10 failures / 15 min → 15-min lock, doubling (API-Q4) | `429`, `Retry-After` |
| File upload | per user, `POST /api/files` | 10/min | `429 RATE_LIMITED` |
| PDF generation | per user, DOC-1/DOC-2 | 10/min (in addition to the render semaphore of 2) | `429` / `503 SERVER_BUSY` |
| CSV export | per user, REC-3/AUD-2 | 5/min | `429 RATE_LIMITED` |
| Test message | per user, REM-6 | 5/min | `429 RATE_LIMITED` |
| Request body | Nginx | 26 MB hard cap | `413 FILE_TOO_LARGE` |

- Limits are **per authenticated user** (from the session), not per IP, for the four heavy endpoints; a shared office NAT would otherwise throttle the whole team.
- `429` always carries `Retry-After` in seconds and the standard envelope; the UI shows a non-blocking toast and keeps the user's form state.
- There is **no** IP allowlist, no CAPTCHA, no WAF and no per-project quota (`ARCHITECTURE.md` §6.5, §15.2). The threat model is an insider with valid credentials, not a public API.
- CSRF (`SameSite=Lax` + Origin check) is not rate limiting; it is covered in §1.10.

---

## 7. Open questions

API-level judgment calls the source documents do not settle. Each has a proposed default that this contract follows; none is a new product behavior, and each is recorded so it can be reversed in one place.

| # | Question | Proposed default | Impact if changed |
|---|---|---|---|
| **API-Q1** | `ARCHITECTURE.md` §6.2's capability matrix has no consent capability, but PRD FR-4.2 and `ARCHITECTURE.md` §5.4 say Admin/Accountant update buyer consent. Which wins? | A dedicated `buyer.consent` capability granted to **Admin + Accountant**, used only by SAL-5. This follows the behavior documents; the matrix omission looks like an editing gap, not a decision | If the matrix is authoritative instead, consent becomes Admin-only (or moves into `buyer.edit` = Admin/Sales), contradicting FR-4.2. The fix is a one-line ARCH errata; no schema change |
| **API-Q2** | Q-1 permits a price/plan revision "only when no payment is posted", but `DATABASE.md` §1.6 makes `due_item.amount` and the plan snapshot immutable, so there is no legal way to regenerate due items. What does the API expose? | **No price/plan edit endpoint.** SAL-9 edits only `booking_date`; SAL-10 replaces the buyer set at zero payments (the one path `DATABASE.md` §8.3 explicitly allows). A wrong price/plan after confirmation is corrected by **cancel + rebook** | If a real revision is required, `DATABASE.md` needs a decided mutation path for an unallocated plan (e.g. "regenerate due items at zero payments"), then SAL-9 can accept `salePricePkr`/`plan`. Until then, exposing it would violate the schema document |
| **API-Q3** | PRD BR-2 says advance credit is "used before the next due item", but `payment_allocation` rows are written only when a payment is recorded and are immutable; no table can apply old credit to a later due item. | **Display only.** The ledger shows `advanceCredit`; the API has no "apply credit" command. In the MVP, due items are all created at confirmation, so credit arises only when the booking is over-collected | Applying credit needs a command and a stored link (or a mutable allocation policy) — a `DATABASE.md` change and an ADR. The UI already shows the credit so staff can handle it commercially |
| **API-Q4** | The sources require per-account lockout/backoff but set no thresholds | 10 failures in 15 minutes → 15-minute lock; 30 and 60 on repeat within 24 h; success clears. Nginx 5/min per IP | Pure configuration; one constant table in Identity. Shorter locks weaken brute-force resistance; longer locks increase support calls |
| **API-Q5** | No password policy is stated | 12–128 characters, no composition rules, must differ from the current password; Argon2id parameters unchanged | A stricter policy (symbols/rotation) would be a product/security decision; it changes only validation, not schema |
| **API-Q6** | Manual `cash_entry` has no `client_request_id`, unlike booking/payment, so a double-submit can duplicate a Roznamcha line | Accept it: the UI disables submit while saving; a duplicate is corrected by void + repost with a reason. Adding a key would need a `DATABASE.md` column | If duplicate entries appear in practice, add `cash_entry.client_request_id` and a **new** unique index `uq_cash_entry_idempotency` (nullable for system rows) and accept the field in CSH-2. Small migration, no behavior change |
| **API-Q7** | `booking_ref` is accepted in paths as `BK-1042`; should internal UUIDs be accepted too? | Yes — both, because the UI's wizard success state and PDF `Location` use the ref while some deep links carry the UUID. Uniqueness makes the mapping unambiguous | Restricting to one identifier is a client change only; no schema impact |

**Not open, and deliberately not asked again:** one confirm endpoint instead of a server-side draft; offset pagination; no PDF storage; no manual reminder resend; no overdue reminders; English-only PDFs; no `Accept-Language`; no CORS; no public registration; no `CONSENT_REQUIRED` error. Each is decided above or in the source documents.

---

## 8. Validation of this document

### 8.1 Every endpoint traces to a PRD user story or functional requirement

| Endpoints | PRD source | Notes |
|---|---|---|
| AUTH-1 … AUTH-5 | FR-2.1, US-1.3, §12 (session expiry) | Login, logout, session, refresh, password change |
| IDN-1, IDN-2 | FR-2.4, US-1.4 | Profile and persisted EN/UR preference |
| IDN-3 … IDN-8 | FR-2.1 – FR-2.3, US-1.3 | User CRUD, roles, reset, unlock |
| SET-1, SET-2 | FR-1.1, US-1.1 | Company profile, logo, terms text |
| SET-3 … SET-6 | FR-1.2, US-1.2 | Projects |
| SET-7 | FR-3.1, US-2.1 | Master-plan upload/binding |
| SET-8 … SET-11 | FR-1.3, US-1.2 | Blocks and the delete guard |
| INV-1, INV-2, INV-4 | FR-3.5, US-2.4 | Map, list, detail |
| INV-3, INV-5, INV-6 | FR-3.3, US-2.3 | Plot record CRUD |
| INV-7, INV-8 | FR-3.2, US-2.2 | Polygon draw/edit/delete |
| INV-9 | FR-3.4 | Status history |
| INV-10, INV-11 | US-2.5, FR-3.4 | Reserve/release |
| INV-12 | D-3, FR-3.4 | Manual Allotted/Sold |
| SAL-1 … SAL-4 | FR-4.2, US-3.2 | Buyer records and dedupe |
| SAL-5 | FR-4.2 (Admin/Accountant consent update) | See API-Q1 |
| SAL-6 | FR-4.1, US-3.1/3.3, S-3, §12 | The one-transaction booking confirm |
| SAL-7, SAL-8 | FR-4.3, US-5.2 | Booking list/detail |
| SAL-9, SAL-10 | Q-1, `ARCHITECTURE.md` §5.4 | Post-confirm non-financial edits; see API-Q2 |
| SAL-11 | FR-4.4, US-3.4, D-8 | Cancellation |
| SAL-12, SAL-13 | `ARCHITECTURE.md` §5.4 ("add booking notes") | Architecture-mandated; not a separate PRD story |
| LED-1, LED-2, LED-4 | FR-6.2, US-5.2 | Booking/buyer ledger |
| LED-3 | FR-6.1, US-5.1, BR-2 | Payment with default/manual allocation |
| LED-5 | FR-6.1, BR-2 | Void with reason |
| CSH-1 … CSH-3 | FR-6.3, US-5.3 | Roznamcha, manual entries, void |
| CSH-4 … CSH-6 | FR-6.3, PRD §13 (ExpenseCategory) | Category management |
| REC-1, REC-2 | FR-7.1, US-6.1, S-4 | Dashboard and drill-down |
| REC-3 | D-12, FR-7.1 | CSV export |
| REM-1 … REM-5 | FR-7.2, `ARCHITECTURE.md` §10.10 | Templates and channel config |
| REM-6 | `ARCHITECTURE.md` §10.9 ("send test message") | Architecture-mandated |
| REM-7 | US-6.2, FR-7.2 | Send log, including dry-run rows |
| DOC-1 | US-4.1, FR-5.2 | Allotment letter |
| DOC-2 | US-4.2, FR-5.2 | Payment schedule |
| REP-1 | US-7.1, FR-8.1 | Cash flow |
| REP-2 | US-7.2, FR-8.2 | Income statement, cash basis |
| AUD-1, AUD-2 | FR-9.1, `ARCHITECTURE.md` §13.4 | Audit search and Admin export |
| AUD-3 | `ARCHITECTURE.md` §13.4 (booking timeline) | Admin-only |
| COR-1, COR-2 | US-2.1, FR-3.1, FR-4.2, FR-1.1 | Upload and authenticated serving; `ARCHITECTURE.md` §7 |
| COR-3, COR-4 | `ARCHITECTURE.md` §10.11, §14.8 (PRD §15 reliability) | Ops surface, not user-facing |

**Result:** 81/81 endpoints are accounted for. **75** map directly to a PRD US/FR; **6** are explicitly required by `ARCHITECTURE.md` (SAL-12, SAL-13, REM-6, AUD-3, COR-3, COR-4) and implement no new product behavior.

### 8.2 Every request/response field maps to a column or a stated derived value

**Request fields.** All are columns in `DATABASE.md` §3 (`plotId`, `buyerId`, `cnic`, `phone`, `salePricePkr`, `tokenAmount`, `sharePct`, `paidOn`, …), **except** these request-only controls, each of which selects an existing rule rather than storing data:

| Field | Why it is not a column |
|---|---|
| `confirmReserved` | Confirms an Admin override already implied by PRD BR-1; no column stores a confirmation flag |
| `confirmAspectRatioChange` | Confirms the Q-12 warning before `project.master_plan_*` is updated |
| `allocations[]` | Rows in `payment_allocation`, not a column |
| `buyers[]` | Rows in `booking_buyer` (+ `buyer` inserts) |
| `cnicChangeReason` | The reason belongs in `audit_log.summary` (`{fields, reason}`), not on the buyer row |
| `version` | Column, but only an input to the CAS predicate |
| `secret` | Write-only input to `provider_config.secret_ciphertext`; never returned |
| `currentPassword`, `newPassword` (requests), `temporaryPassword` (IDN-7 response) | Transient credentials; only the Argon2id hash is stored in `app_user.password_hash` |
| `fileId` | Names the FK value written by the binding endpoint (`master_plan_file_id`, `logo_file_id`, `photo_file_id`) |
| `phone` (REM-6) | A test recipient; no row is written, because `reminder_log.due_item_id` is `NOT NULL` |

**Response fields.** Every scalar is a column, **except** the derived values below (also defined in §1.9).

| Derived field | Formula / source |
|---|---|
| `sizeSqFt` | `size_marla × COALESCE(project.marla_sqft, company.marla_sqft)` |
| `blockCode` | join `plot.block_id → block.code` |
| `masterPlan` | composition of `project.master_plan_file_id`, `_width_px`, `_height_px`, `_uploaded_at` |
| `remaining` | `due_item.amount − due_item.amount_paid` |
| `totals.totalPayable` / `totalPaid` / `balance` | `Σ due_item.amount`; `Σ posted allocations`; difference |
| `totals.advanceCredit` | `Σ(posted payment.amount) − Σ(posted allocations)` |
| `totals.overdueAmount` | open items with `due_date < today (PKT)` |
| `overdueDays` | `differenceInCalendarDays(todayPKT, due_date)` |
| `capabilities` | `ARCHITECTURE.md` §6.2 rows for the role |
| `secretConfigured` | `secret_ciphertext IS NOT NULL` |
| `url` (files) | `/api/files/{id}` (never the storage key) |
| `dayTotals`, `periodTotals`, report sections | aggregates over posted `cash_entry` rows |
| `cashFlow.openingCash` | net of posted entries before `from` + `OPENING` entries on/after `from` (`ARCHITECTURE.md` §11.2) |
| `asOf` | server's today in `Asia/Karachi` |
| `uploadedAt` | `project.master_plan_uploaded_at` |
| `buyerName`, `buyerPhone`, `buyerId`, `bookingRef`, `plotNumber` in `RecoveryRow`/`ReminderLogRow` | joins through `due_item → booking → buyer/plot` |
| `collectedThisMonth` | `Σ payment.amount` where `status = POSTED` and `paid_on` is in the current PKT month |
| `dueItems`, `payments`, `data` | arrays of rows from `due_item`, `payment`, and the endpoint's primary table |
| `cashEntryId` (LED-3) | `cash_entry.id` where `linked_payment_id = payment.id` |
| `closingCash` (REP-1) | `openingCash + totals.net` |
| `basis` (REP-2) | the literal `"CASH"` — a label, not a column (PRD A-9) |
| `lastReminderTick`, `runningJobs`, `database` (COR-4) | latest `job_run` by `job_name`; `job_run` rows with `status = 'RUNNING'`; a `SELECT 1` |
| `lastBackupHeartbeat` (COR-4) | timestamp written by the backup script's marker file — outside the database |
| CSV columns | the same `RecoveryRow` fields, formatted once, English headers |

- **Query parameters are filters, not fields:** `agentId` → `booking.created_by`, `dateFrom`/`dateTo` → `booking_date`, `minSizeMarla`/`maxSizeMarla` → `size_marla`, `upcomingDays` → the open-due window, `includeInactive` → `is_active`, `variant` → a storage derivative. None is persisted.
- **No field maps to a table or column that does not exist.** The API exposes no `draft`, no `document`, no `advance_amount`, no `project_id` on `cash_entry`, and no `reminder_log` row for a test message — those omissions are deliberate in `DATABASE.md` §3.12 and are respected here.

### 8.3 RBAC verification against `ARCHITECTURE.md` §6.2

- **23 capabilities** are used exactly as named in §6.2, and **one more**, `buyer.consent`, is the documented exception below. No endpoint invents a role rule.
- **Guard distribution:** **71** endpoints are capability-guarded — **70** by one of the 23 matrix capabilities and **1** (SAL-5) by the exception; **7** require only a valid session (AUTH-2/3/4/5, IDN-1, IDN-2, SET-1); **2** are public (AUTH-1, COR-3); **1** uses the machine token (COR-4).
- **One documented exception:** SAL-5 (consent) uses `buyer.consent`, which §6.2 does not list, because PRD FR-4.2 and `ARCHITECTURE.md` §5.4 assign the action to Admin/Accountant while `buyer.edit` is Admin/Sales. It is flagged as API-Q1, not silently resolved.
- **No endpoint is guarded by a capability that excludes a role the PRD screen allows**, and no endpoint grants a write the PRD §10 matrix denies. In particular:
  - Sales Agent is read-only everywhere in Recovery (REC-1/2/3) and has no `payment.record`, `payment.void`, `cashbook.record`, `reminder.configure`, `user.manage` or `audit.read`.
  - Accountant has no `booking.create`, `booking.manage`, `booking.cancel`, `setup.manage`, `inventory.manage`, `inventory.status`, `reminder.configure` or `audit.read`.
  - Admin has every capability, but the endpoints still enforce invariants (Admin cannot book an unavailable plot, cannot delete a payment, cannot edit an audit row).

### 8.4 Structural and consistency checks performed

| Check | Result |
|---|---|
| Endpoint inventory | 81 headings, each with method, path, roles, request, response, statuses and a `DB:` line |
| Method coverage | `GET` reads, `POST` creates/commands, `PATCH` edits, `PUT` sub-resource replaces; `DELETE` exists only for block, unreferenced plot and polygon — the only hard deletes `DATABASE.md` §1.6 permits |
| Error codes | Every code cited in §2–§3 appears in §5; no catalog code is unused outside §5. The two names explained in §5.8 are notes, not catalog rows |
| Tables and columns | 22 of the 26 tables are written somewhere by the API; `reminder_claim`, `reminder_log`, `job_run` and `app_setting` are worker/config-owned and have no write endpoint (read-only log at REM-7). No table or column is introduced |
| Enums | 17 of the 18 enums appear on the wire; `reminder_claim_status` is intentionally not exposed because `reminder_claim` has no endpoint (claims are the worker's idempotency guard, not a UI resource) |
| DB constraints referenced | The commands name the object they respect: `one_active_booking_per_plot`, `one_primary_buyer_per_booking`, `uq_booking_idempotency`, `uq_payment_idempotency`, `uq_cash_entry_linked_payment`, `uq_reminder_claim_due_item_milestone`, `ck_due_item_status`, `ck_plan_amounts`, `ck_plan_installments`, `ck_payment_void_fields`, `ck_cash_entry_void_fields`, `ck_provider_config_live`, `trg_audit_log_append_only`, `trg_payment_immutable`, `trg_cash_entry_immutable` |
| Status-code policy | Every endpoint uses only the codes in §1.3; `400` vs `422` follows the shape-vs-meaning rule; every `409` is a real state, uniqueness or lock conflict (or the retryable `CONFLICT_RETRY` deadlock guard) |
| Date/money format | Every money/area/percentage field is a string; every business date is `YYYY-MM-DD`; every event is UTC ISO-8601 — no numeric money, no localized date |
| Pagination | Every list endpoint uses the same `page`/`pageSize`/`total` envelope; CSV/PDF are the only unpaginated streams |
| Idempotency | Exactly two creates accept `clientRequestId`, matching the two unique indexes; replay always returns `200` + `Idempotent-Replay: true` |
| Versioning | Every edit to a `version`-bearing table requires it; the settings tables without one (`company`, `cash_category`, `reminder_template`, `provider_config`) are documented as last-write-wins |
| No new product behavior | No endpoint adds a state, a status value, a table, a column, a report metric, a message channel or a permission beyond the three source documents; the seven judgment calls are in §7 |

### 8.5 Additions, and where they came from

This document introduces **no table, column, status value, enum or report metric**. `DATABASE.md` §3.12 is the complete list of objects that go beyond PRD §13 and `ARCHITECTURE.md` §4.2; every one is used here as-is. What the API layer adds is transport and policy, and each item is visible in one place:

| Addition | Why it exists | Where it is decided |
|---|---|---|
| `buyer.consent` capability | FR-4.2 and `ARCHITECTURE.md` §5.4 give consent to Admin/Accountant; §6.2's matrix has no row for it | §7, API-Q1 |
| SAL-12, SAL-13, REM-6, AUD-3, COR-3, COR-4 | `ARCHITECTURE.md` mandates the feature (notes, test message, booking timeline, liveness, health details) but the PRD lists no story for it | §8.1 |
| `Idempotent-Replay: true` + `200` on replay | `ARCHITECTURE.md` §12.5 defines duplicate behavior but not the wire signal; clients need an unambiguous one | §1.7 |
| Password length (12–128), lockout steps (15/30/60 min), `pageSize ≤ 100` | The sources require the control but fix no number | API-Q4, API-Q5, V-25 |
| CSV encoding (BOM, CRLF, RFC 4180, formula guard) | PRD D-12 and `ARCHITECTURE.md` §11.5 require CSV export and name the guard, not the byte-level format | V-28 |
| Error codes and their HTTP mapping | Appendix A fixes the envelope, not the vocabulary; the catalog is this document's contribution | §5 |

None changes what a user can do, what is stored, or who may do it. If any of these should become product behavior, the change belongs in `PRD.md` first, then here.

**Conclusion.** The contract is implementable against `DATABASE.md` as written. The only item that needs a source-document decision rather than code is **API-Q2** (post-confirm plan revision), because Q-1 and `DATABASE.md` §1.6 currently contradict each other at the schema level. **API-Q1** needs a one-line capability-matrix correction. Neither blocks the MVP: the default in this document is the behavior that the schema can actually enforce.

---

*End of API.md.*
