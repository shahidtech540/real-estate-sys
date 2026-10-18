# PRD — Housing Society & Plot Management System

| | |
|---|---|
| **Document status** | **Approved — v1.0** (supersedes Draft v0.1) |
| **Approved on** | 2026-10-18 — Decisions (§6) and Assumptions (§5) resolved; A-3 revised (bilingual UI toggle) |
| **Date** | 2026-10-18 |
| **Audience** | Coding agent (source of truth), product owner, implementation team |
| **Working product name** | Society Plot Manager (SPM) — final naming TBD |
| **Deliverable** | MVP web application; this document defines scope, behavior and data |

---

## 1. Overview

### 1.1 Problem

A real estate development company in Pakistan sells plots in housing society projects. Today, the sales and recovery process is run on paper registers and spreadsheets:

- The society master plan is a static image or printed map; plot availability is tracked by hand.
- Plots get double-booked or misquoted because nobody has a live view of inventory.
- Booking a plot (buyer details, token, down payment, installments) takes hours of manual paperwork; allotment letters and payment schedules are typed by hand in Word.
- The accounts team keeps a Roznamcha (daily cash diary) and buyer ledgers in registers. Outstanding dues must be reconstructed by hand every month.
- Recovery is reactive: staff manually scan due dates and phone or SMS each buyer. Reminders are late, skipped, or duplicated.
- Management cannot see cash position, outstanding recovery, or inventory status without asking three people.

### 1.2 Value proposition

One internal system where **the master plan is the live inventory**:

- Click a plot polygon on the society map to see size, block, dimensions, price and status.
- Book a plot to individual or joint buyers in a guided flow; the system generates the payment plan, allotment letter and payment schedule PDFs automatically.
- Accounts record payments against buyer ledgers and keep the Roznamcha in one place.
- A recovery dashboard shows exactly who owes what and what is overdue; WhatsApp/SMS reminders go out automatically at T-10, T-7, T-3 and T-0 days before each due date.
- Basic financial reports (cash flow, income statement) are available on demand.

Net effect: faster bookings, zero double-bookings, faster collections, and one source of truth replacing the map + registers + spreadsheets.

### 1.3 Product type and tenancy

- **Single-tenant, internal web application** for one real estate development company. It is **not** a multi-tenant SaaS.
- The company may run more than one society project over time; the system is designed for multiple projects but is validated against one live project in the MVP.

### 1.4 Target users

| User | Who they are | What they do in the system |
|---|---|---|
| **Admin** | Company owner / GM / project head | Setup, master plan, plot inventory, user management, price/cancellation overrides, reports |
| **Sales Agent** | Booking staff / sales team | Search plots, book plots to buyers, generate allotment letters and schedules |
| **Accountant** | Accounts & recovery staff | Record payments, Roznamcha, outstanding dues, reminders oversight, financial reports |

End customers (buyers) do **not** log in. A client self-service portal is explicitly a future phase.

### 1.5 Goals

1. Digitize the society master plan into clickable, status-aware plot inventory.
2. Turn "booking to allotment letter" from hours of paperwork into a guided, under-10-minute flow.
3. Track every installment against every buyer with an accurate, always-current ledger.
4. Automate payment-reminder WhatsApp/SMS at the four milestones before each due date.
5. Give management on-demand cash flow, income statement and recovery views.

### 1.6 Non-goals

See §4 (Out of Scope). In short: no utility billing, no land/costing module, no resale/transfer/NOC engine, no HR/payroll/attendance, no client portal, no online payments.

---

## 2. Success Criteria (MVP)

| # | Criterion | Measure |
|---|---|---|
| S-1 | Digitize a society | Admin can upload a master plan and record all plots (polygons + metadata) for a ~1,000-plot society within 2 working days |
| S-2 | Book fast | Sales completes a booking (buyers + plan + PDFs) in ≤ 10 minutes, without leaving the system |
| S-3 | No double-booking | A plot can never be booked twice; every status change is attributed to a user |
| S-4 | Accurate recovery | Recovery dashboard totals equal the sum of buyer ledgers to the paisa; overdue list is reliable enough for the recovery team to call from |
| S-5 | Automated reminders | For every unpaid due item, the four reminder milestones are attempted automatically and logged; no duplicate sends per milestone |
| S-6 | Reporting | Cash flow and income statement for any date range match Roznamcha/payment totals for that range |
| S-7 | Access control | Role boundaries hold: a Sales Agent cannot record payments; an Accountant cannot edit plot prices; verified by test cases |

---

## 3. MVP Scope Summary

In scope (details in §9):

1. **Setup**: company profile, projects, blocks, users & roles.
2. **Map & inventory**: master plan upload, polygon drawing/editing, plot metadata and status management, list view.
3. **Sales**: booking flow (individual / joint ownership), buyer capture with photo, payment plan generation.
4. **Documents**: auto-generated PDF allotment letter and payment schedule.
5. **Accounts**: payment recording and allocation, buyer ledger, Roznamcha (cash in/out).
6. **Recovery**: outstanding dues dashboard, upcoming dues, overdue list.
7. **Reminders**: scheduled WhatsApp/SMS at T-10, T-7, T-3, T-0, with a send log.
8. **Reports**: cash flow and income statement (cash basis).
9. **Platform**: login, role-based access, audit trail on money and status changes, daily backups (ops).

---

## 4. Out of Scope (MVP)

Explicitly excluded (possible future phases):

- Utility billing (electricity, water, gas, maintenance charges).
- Land acquisition and inventory costing / COGS module.
- Plot transfer, NOC, resale, and transfer-fee engine.
- HR, payroll, biometric attendance.
- Client-facing self-service portal.
- Online payment gateway integration (all payments are recorded manually).
- Also deferred: accrual/percentage-of-completion accounting, late-payment markup/profit computation (confirmed out of scope — D-9), payment receipt PDFs (deferred — D-11), Urdu PDF generation, RTL layout mirroring (the UI English/Urdu toggle **is** in scope — see A-3), multi-currency, branded PDF template designer, mobile apps, offline mode, email notifications.

---

## 5. Assumptions (Approved — 2026-10-18)

> All assumptions below were approved on 2026-10-18 and are binding for the MVP. A-3 was revised at approval and supersedes the original English-only assumption.

| ID | Assumption |
|---|---|
| A-1 | Internal staff of ≤ 25 users; ≤ 5 concurrent users typical. |
| A-2 | One active society project in MVP; up to ~3,000 plots on a single master plan. |
| A-3 | **(Revised 2026-10-18 — supersedes original.)** UI is switchable between **English and Urdu** via a language toggle (FR-2.4). Layout stays left-to-right — **no RTL mirroring** in MVP. Generated PDFs (allotment letter, payment schedule, reports) are **English-only**; Urdu PDF generation is a future phase. Currency is PKR (Rs). Timezone is Asia/Karachi (PKT). Dates displayed as `DD-MMM-YYYY` (e.g., 05-Oct-2026). |
| A-4 | Master plan is one raster image per project (JPG/PNG/WebP). |
| A-5 | Buyer photo upload is a **placeholder for future biometric verification** — plain file storage, no verification logic. |
| A-6 | No online payments; the accountant records payments manually from bank/cash/cheque. |
| A-7 | Reminder sending window 09:00–20:00 PKT; messages outside the window wait until it opens. |
| A-8 | Installments are equal amounts with no interest/profit component; the final installment absorbs rounding remainder. |
| A-9 | Financial reports are **cash basis** (confirmed 2026-10-18). Accrual accounting is out of scope. |
| A-10 | Desktop-first (current Chrome/Edge/Firefox). Polygon drawing is a desktop task; map and dashboards remain usable on large tablets. |
| A-11 | Single-server deployment (VPS) with daily backups. File storage: local volume or S3-compatible bucket (chosen at implementation). |
| A-12 | Same buyer (CNIC) may own multiple plots over time; one Buyer record per CNIC is reused across bookings. |

---

## 6. Decisions (Resolved & Approved — 2026-10-18)

> All decisions below were approved on 2026-10-18 exactly as recommended. They are binding for the MVP; changing any of them requires a new PRD revision.

| ID | Decision | Resolution (approved) |
|---|---|---|
| D-1 | **Marla conversion** | **Approved:** 1 Marla = 225 sq ft; configurable per project if needed later |
| D-2 | **Plot status model** | **Approved:** exactly the four stated statuses, including the combined `Sold/Constructed`; splitting into separate statuses may be revisited post-MVP |
| D-3 | **`Sold/Constructed` trigger and allotment letter timing** | **Approved:** status flips only when Admin manually marks "Allotted/Sold" (typically after down payment). Allotment letter is printable as soon as a booking is confirmed |
| D-4 | **Buyer fields for the allotment letter** | **Approved:** include optional `father_or_husband_name` and `address`; printed documents show them when present |
| D-5 | **Joint-booking reminder recipients** | **Approved:** primary (first-listed) buyer only |
| D-6 | **WhatsApp/SMS provider and budget** | **Approved:** provider-agnostic send interface with dry-run mode; go live with one SMS provider first; WhatsApp added when budget/API account is approved |
| D-7 | **Price edit rights** | **Approved:** Sales Agent may set the negotiated sale price at booking; only Admin may change price after confirmation |
| D-8 | **Booking cancellation and refunds** | **Approved:** Admin-only "Cancel booking" with reason; payments remain recorded and flagged refundable, handled offline; no refund-accounting engine |
| D-9 | **Late-payment markup** | **Approved (explicitly confirmed 2026-10-18):** no auto penalty/profit on overdue amounts in MVP |
| D-10 | **Roznamcha auto-posting** | **Approved:** all recorded payments auto-post as linked Roznamcha In-entries; other cash movements entered manually |
| D-11 | **Payment receipt PDF** | **Approved:** deferred — not in MVP; allotment letter and payment schedule are the only buyer documents |
| D-12 | **CSV export of the outstanding-dues list** | **Approved:** included in MVP |

---

## 7. Core User Journeys

### J-1 · Digitize a society (Admin)

1. Log in → create/confirm Company profile (name, logo, contact details shown on PDFs).
2. Create a Project (e.g., "Green City Phase 1") → upload master plan image.
3. Draw plot polygons on the map (click-to-add-vertices tool; close polygon).
4. For each polygon: assign block, plot number, type (Residential/Commercial), size (Marla), dimensions (width × depth ft), price, and confirm status (default `Available`).
5. Save; the map now shows color-coded, clickable plots. Repeat until the plan is complete.
6. Ongoing: reserve/release plots, adjust prices, replace the master plan image if needed.

### J-2 · Book a plot (Sales Agent)

1. On the Map (or Plot List), find the plot (filter by block/size/status, or search plot number) → click it.
2. Review details panel → click **Book** (only enabled when status is `Available`, or `Reserved` with Admin rights).
3. Enter sale price (defaults to listed price; may be negotiated).
4. Add one or more buyers: name, CNIC, phone, father/husband name (opt.), address (opt.), photo upload; for joint ownership add buyers and ownership share % (must total 100%).
5. Configure payment plan: token amount, down payment, number of installments, frequency (monthly / quarterly), first installment date. System previews the generated schedule (amounts + due dates).
6. Review & confirm → plot status becomes `Booked/Token`; booking is stamped with the agent and timestamp.
7. Download **Allotment Letter PDF** and **Payment Schedule PDF**; hand over / file as per company practice.

### J-3 · Pay an installment (Accountant)

1. Open the booking/buyer from Bookings or Buyers list → see ledger: price, paid, balance, and due items with status.
2. Click **Record Payment**: amount, date, method (Cash / Cheque / Bank Transfer), reference (cheque no. / trx id), notes.
3. System allocates the payment to due items (oldest unpaid first, or accountant picks specific installment(s); excess becomes an advance credit on the ledger).
4. Save → ledger and recovery dashboard update immediately; the payment auto-posts as a linked Roznamcha "In" entry (D-10).

### J-4 · Daily Roznamcha & recovery (Accountant)

1. Open Roznamcha for today: payments auto-posted as In-entries.
2. Add non-booking entries (petty cash expense, other income) with category and description.
3. Open **Recovery**: see total outstanding, overdue list, and dues coming up in the next 30 days.
4. Work the overdue list (call/WhatsApp follow-up); system meanwhile auto-sends scheduled reminders at T-10/7/3/0 (and they show in the reminder log).

### J-5 · Month-end / management reporting (Admin & Accountant)

1. Open **Reports** → select date range.
2. **Cash Flow**: opening cash, cash in by category, cash out by category, closing cash.
3. **Income Statement (cash basis)**: collections and other income vs expenses by category, net position.
4. Verify against Roznamcha totals for the same range; export/print as needed.

---

## 8. User Stories & Acceptance Criteria

> Stories are MVP scope. AC = acceptance criteria (testable).

### Epic 1 — Setup & Administration

**US-1.1 — Company profile**
As an Admin, I want to enter the company's name, logo, address, phone and email so that these appear on allotment letters and schedules.
AC:
- Admin can create/update company profile fields and upload a logo image.
- PDFs render the current profile values.

**US-1.2 — Manage projects and blocks**
As an Admin, I want to create society projects and their blocks so that plots are organized.
AC:
- Admin can create/edit a project (name, location, marla conversion note) and blocks within it (code/name, e.g., "Block A").
- A block cannot be deleted while it still contains plots.

**US-1.3 — Manage users and roles**
As an Admin, I want to create staff accounts and assign roles (Admin / Sales Agent / Accountant) so that access is controlled.
AC:
- Admin can create, edit, deactivate users and set/reset passwords.
- Deactivated users cannot log in; their past transactions remain attributed to them.
- A user has exactly one role.

**US-1.4 — Switch UI language (English / Urdu)**
As any user, I want to switch the interface between English and Urdu so that staff can work in their preferred language.
AC:
- A language toggle (EN / UR) is visible on every screen; switching changes all UI labels immediately without losing page or form state.
- The choice persists per user across sessions and defaults to English.
- Layout stays left-to-right in both languages; Urdu text renders correctly (RTL within text elements only — no page mirroring).
- Generated PDFs remain English regardless of the selected UI language.

### Epic 2 — Map & Plot Inventory

**US-2.1 — Upload master plan**
As an Admin, I want to upload the society master plan image so that plots can be drawn on it.
AC:
- Accepts JPG/PNG/WebP up to 25 MB; rejects others with a clear message.
- Replacing the image warns that existing plot polygons are preserved (coordinates are stored relative to the image, see §13).
- The image is visible only to authenticated users.

**US-2.2 — Draw and edit plot polygons**
As an Admin, I want to draw, edit and delete plot polygons on the master plan so that each plot is a clickable region.
AC:
- Draw tool: click to add vertices, close polygon (min 3 vertices); Escape cancels in-progress drawing.
- Existing polygons can be selected, vertex-edited, moved as a whole, and deleted (with confirmation).
- Each polygon is linked to exactly one plot record; unsaved changes are confirmable before leaving.

**US-2.3 — Maintain plot records**
As an Admin, I want each plot to carry block, plot number, type, size (Marla), dimensions, price and status so that the map and lists show complete inventory.
AC:
- Plot number is unique within a project (and shown with its block).
- Size is stored in Marla with sq ft shown alongside using the project's marla conversion (D-1).
- Price in PKR; status defaults to `Available`.
- Invalid inputs (negative price, missing plot number) are blocked with inline errors.

**US-2.4 — View and filter inventory**
As a Sales Agent or Accountant, I want to view plots on a map and in a table with filters so that I can find plots fast and work without the map.
AC:
- Map: status color legend, zoom/pan, click → details panel (size, block, dimensions, price, status, and booking info if any).
- Table: sortable columns (block, plot no., size, price, status) with filters (block, status, size range) and text search on plot number.
- Status changes reflect on both views without a full page reload after any action.

**US-2.5 — Reserve and release plots**
As an Admin, I want to hold plots (e.g., for management allocation) and release them so that they are not sold in the meantime.
AC:
- Admin can set `Available → Reserved` and `Reserved → Available` with a short note.
- Reserved plots cannot be booked by Sales Agents (Admin override only).

### Epic 3 — Sales & Booking

**US-3.1 — Book a plot**
As a Sales Agent, I want to book an available plot through a guided flow so that the sale is recorded completely and quickly.
AC:
- Booking is possible only on `Available` (or `Reserved` with Admin rights); the form is blocked otherwise with the reason shown.
- Flow captures sale price, buyers, and payment plan; a review step shows everything before confirm.
- On confirm: plot → `Booked/Token`; booking stores the agent, timestamp, and the payment plan snapshot.
- Attempting to book a plot that was just booked fails gracefully ("plot is no longer available") without corrupting data.

**US-3.2 — Capture buyers (individual or joint)**
As a Sales Agent, I want to register one or more buyers per booking with their CNIC and photo so that ownership is on record.
AC:
- Fields: full name, CNIC (format `12345-1234567-1`), phone (PK mobile format), father/husband name (opt.), address (opt.), photo upload (JPG/PNG ≤ 5 MB).
- **SMS/WhatsApp reminder consent:** a yes/no flag captured at the time the buyer is registered, recorded with a timestamp. Reminders (FR-7) are only sent to buyers who have given consent. Consent can be updated later by Admin or Accountant, with the change recorded in the audit log.
- Joint ownership: 2+ buyers each with a share %; shares must total exactly 100%.
- The first-listed buyer is the primary buyer (used for reminders — D-5).
- Buyers are deduplicated by CNIC: an existing CNIC loads the stored buyer record (editable), keeping one record per person.

**US-3.3 — Generate payment plan**
As a Sales Agent, I want the system to generate the installment schedule from plan parameters so that amounts and dates are consistent.
AC:
- Inputs: token amount, down payment amount, installment count (≥ 1), frequency (Monthly/Quarterly), first installment due date.
- Remaining balance = sale price − token − down payment; equal installments; rounding remainder lands in the final installment (A-8).
- Live preview of the schedule (label, due date, amount) before confirmation; validation errors (token + down payment ≥ price, non-positive amounts, missing date) block confirm.
- After confirmation, due items are persisted and drive ledgers and reminders.

**US-3.4 — Cancel a booking (Admin)**
As an Admin, I want to cancel a mistaken or abandoned booking so that the plot can be sold again (D-8).
AC:
- Admin-only, requires a reason; confirmation dialog warns about payments already received.
- Plot returns to `Available`; booking is marked `Cancelled` (never deleted).
- Payments remain on the buyer ledger flagged for manual refund handling outside the system.

### Epic 4 — Documents (PDF)

**US-4.1 — Allotment letter**
As a Sales Agent, I want to generate the allotment letter PDF for a confirmed booking so that it can be issued to the buyer.
AC:
- One click generates a PDF containing: company letterhead (name, logo, address), date, buyer(s) with CNIC and share %, project/block/plot, size in Marla (and sq ft), dimensions, sale price, booking date, payment summary (token, down payment, installments), and standard terms text configured by Admin.
- Generation typically takes < 5 seconds; failures show a retry option and are logged.

**US-4.2 — Payment schedule**
As a Sales Agent, I want to generate the payment schedule PDF so that the buyer has a printed due-date sheet.
AC:
- PDF lists every due item (label, due date, amount) with totals, buyer name(s), and plot identity.
- Schedule always reflects the stored due items at generation time.

### Epic 5 — Payments, Ledger & Roznamcha

**US-5.1 — Record a payment**
As an Accountant, I want to record money received against a booking so that balances stay accurate.
AC:
- Fields: booking, amount, date, method (Cash / Cheque / Bank Transfer), reference (opt.), notes (opt.), recorded-by (implicit).
- Allocation: default oldest-unpaid-first; accountant may allocate to specific due item(s); overpayment becomes an advance credit on the ledger.
- Due item statuses update (`Pending → Partially Paid → Paid`); total paid and balance update immediately.

**US-5.2 — View buyer/booking ledger**
As an Accountant or Sales Agent, I want a chronological ledger per booking (and per buyer) so that any dispute can be settled from the screen.
AC:
- Ledger shows: sale price, all payments (date, method, reference, allocation), due items with paid-to-date, running balance, and any advance credit.
- Buyer view aggregates all of that buyer's bookings.

**US-5.3 — Roznamcha (daily cash book)**
As an Accountant, I want to keep a daily cash-in/cash-out diary so that the firm's daily cash position is on record.
AC:
- Recorded payments auto-post as linked In-entries (D-10); manual entries allowed for other income and expenses (category, description, amount, direction, date).
- Filterable by date/period; shows running daily and period totals for In, Out, and net.
- Linked entries show a path back to the payment.
- Cash entries (Roznamcha) are never edited or deleted after posting. A correction is made by voiding the original entry (with a required reason) and posting a new entry. This preserves the audit trail and guarantees that reports always match the Roznamcha exactly.

### Epic 6 — Recovery & Reminders

**US-6.1 — Outstanding dues dashboard**
As an Accountant or Admin, I want a recovery dashboard so that I know exactly who owes what.
AC:
- Shows: total outstanding across the project, overdue amount (past due date, unpaid), upcoming dues (next 7/30 days), and collections in the current month.
- Drill-down table: buyer, phone, plot, due item, due date, amount due, overdue-by-days; sortable and filterable (all / overdue / upcoming).
- Totals equal the sum of open ledger balances (S-4).

**US-6.2 — Automated payment reminders**
As the system, I want to send WhatsApp/SMS reminders before each installment due date so that recovery staff don't chase manually.
AC:
- For each unpaid due item, one attempt per milestone: T-10, T-7, T-3, T-0 (due date), PKT dates, sending window per A-7.
- Message includes buyer name, plot identity, amount due, and due date (template text configurable by Admin).
- Skips due items already fully paid; never sends twice for the same due item + milestone (idempotent), even across restarts.
- Every attempt is logged (due item, channel, milestone, time, status, provider id or error); failures are retried next run and visible on screen.

### Epic 7 — Reports

**US-7.1 — Cash flow report**
As an Admin or Accountant, I want a cash flow report for a date range so that I see the firm's cash movement.
AC:
- Sections: opening cash, cash in (by category: sale collections, other income), cash out (by expense category), closing cash; period totals.
- Built from Roznamcha entries for the period; matches Roznamcha totals exactly (S-6).

**US-7.2 — Income statement (cash basis)**
As an Admin, I want a simple income statement for a date range so that I see the net position.
AC:
- Income (collections + other income) − Expenses (by category) = Net; clearly labelled "Cash basis" (A-9).
- Date-range selectable; printable output.

---

## 9. Functional Requirements (summary for the coding agent)

**FR-1 Company & project setup**
- 1.1 Company profile CRUD (name, logo, address, phone, email, standard PDF terms text).
- 1.2 Project CRUD; project holds master plan image and marla conversion setting (D-1).
- 1.3 Block CRUD within a project; block deletion blocked while plots exist.

**FR-2 Users & roles**
- 2.1 Email/username + password login; password hashing; logout; password reset by Admin.
- 2.2 User CRUD with single role (Admin / Sales Agent / Accountant) and active flag.
- 2.3 Server-side permission enforcement on every action (§10).
- 2.4 **Language toggle (English / Urdu).** A global EN ↔ UR switch is available to every logged-in user on every screen (US-1.4). All user-facing UI strings come from translation catalogs — no hardcoded text; the selection persists per user (`preferred_language`, default `en`) and applies immediately without a reload. Layout remains **left-to-right** in both languages (no RTL page mirroring); Urdu strings render RTL within their own text elements. Generated PDFs remain **English-only** regardless of the selected UI language; Urdu PDF generation is a future phase (A-3).

> **Implication for ARCHITECTURE.md (i18n) — must be specified there:** (1) translation catalogs (e.g., JSON resource files) covering **all** UI strings in `en` and `ur`, with a guard (lint/test) against missing or orphaned keys; (2) locale state management with per-user persistence (`preferred_language`, default `en`); (3) an Urdu-capable UI font stack (e.g., Noto Nastaliq Urdu / Noto Sans Arabic) with bidi handling limited to text nodes; (4) an **LTR-only layout constraint** — no RTL stylesheet mirroring in MVP; (5) the PDF pipeline is architecturally separate from the UI i18n layer and stays English-only; (6) shared date/number/currency formatting helpers that keep `DD-MMM-YYYY` dates and PKR formatting consistent in both languages.

**FR-3 Master plan & plot inventory**
- 3.1 Master plan upload/replace per project (image constraints per US-2.1).
- 3.2 Polygon draw / edit / delete over the image; normalized coordinates (§13).
- 3.3 Plot record CRUD: block, plot number, type (Residential/Commercial), size (Marla), width/depth ft, price (PKR), status, notes.
- 3.4 Status transitions per §16; every change logged (who, when, from → to, reason if any).
- 3.5 Map view (zoom/pan, legend, search, click-details) and table view (filter/sort/search).

**FR-4 Booking & buyers**
- 4.1 Guided booking flow per US-3.1–3.3, including joint ownership shares.
- 4.2 Buyer CRUD with CNIC validation/dedup, phone validation, photo upload (placeholder for biometric — A-5), and SMS/WhatsApp reminder consent (yes/no, timestamped; updatable by Admin/Accountant and audited — see US-3.2).
- 4.3 Booking list with filters (date, agent, status, block) and link to plot + buyers + ledger.
- 4.4 Booking cancellation per US-3.4 (Admin only).

**FR-5 Payment plans & documents**
- 5.1 Payment plan generation per US-3.3; due items stored and versioned by the booking snapshot.
- 5.2 Allotment letter PDF and payment schedule PDF per US-4.1/4.2 (templates rendered from company profile + booking data).

**FR-6 Payments, ledger & Roznamcha**
- 6.1 Payment recording with allocation per US-5.1; payment records are immutable except void-with-reason (Admin/Accountant).
- 6.2 Ledger views per booking and per buyer (US-5.2).
- 6.3 Roznamcha per US-5.3 with auto-posted linked In-entries and manual In/Out entries with categories (Admin-managed category list).

**FR-7 Recovery & reminders**
- 7.1 Recovery dashboard per US-6.1, including CSV export of the current filtered list (D-12).
- 7.2 Reminder scheduler per US-6.2; channel config (provider credentials, enable/disable per channel), template editing (simple placeholders), reminder log screen.
- 7.3 Reminders are not sent to a buyer who has not given SMS/WhatsApp consent, regardless of due date or milestone.

**FR-8 Reports**
- 8.1 Cash flow report (US-7.1); 8.2 Income statement, cash basis (US-7.2); both date-range driven and print-friendly.

**FR-9 Audit**
- 9.1 Audit log (user, action, entity, timestamp, summary) for: bookings, cancellations, status changes, payments, payment voids, price changes, user management. Readable by Admin.

---

## 10. Roles & Permissions

Legend: **Full** = create/edit/delete within module · **Edit** = create/edit · **View** = read-only · **—** = no access.

| Capability | Admin | Sales Agent | Accountant |
|---|---|---|---|
| Company/project/blocks setup | Full | — | — |
| Master plan upload, polygon draw/edit | Full | — | — |
| Plot metadata & price edits | Full | View | View |
| Plot status: reserve/release | Full | — | — |
| Book a plot | Full | Edit (listed/negotiated price at booking — D-7) | — |
| Edit booking after confirm / cancel booking | Full | — (may add notes) | — |
| Buyer records | Full | Edit | View |
| Generate allotment letter / schedule PDFs | Full | Full | View (download) |
| Record / void payments | Full | — | Full |
| Roznamcha manual entries | Full | — | Full |
| Buyer ledger | Full | View | Full |
| Recovery dashboard | Full | View (read-only — see note below) | Full |
| Reminder config & logs | Full | — | View |
| Reports | Full | View | Full |
| Users & roles, audit log | Full | — | — |

Rules:
- Permissions are enforced **server-side**; UI hides unavailable actions but is not the security boundary.
- All actions are attributed to the logged-in user and server time (PKT).
- **Recovery is read-only for Sales Agents:** they can view the Recovery dashboard (outstanding totals, overdue/upcoming lists) but cannot record payments or perform any write action from it — payment recording and all other Recovery write actions remain restricted to Accountant and Admin.

---

## 11. Pages / Screens

| # | Screen | Primary role | Purpose |
|---|---|---|---|
| 1 | **Login** | All | Email/username + password |
| 2 | **Dashboard** | All | Role-aware: Admin = inventory snapshot + collections; Sales = available plots count + recent bookings; Accountant = today's cash, overdue totals |
| 3 | **Plot Map** | All (draw: Admin) | Master plan with polygons, legend, search, click-details panel, Book action |
| 4 | **Plot List** | All | Table view of inventory with filters (map alternative) |
| 5 | **Plot Details** (panel/page) | All | Full plot record, status history, linked booking, actions (book/edit/reserve per role) |
| 6 | **Booking Wizard** | Sales, Admin | Multi-step: price → buyers → payment plan → review → confirm |
| 7 | **Bookings List** | All | Filterable list; opens booking detail |
| 8 | **Booking Detail** | All | Buyers, plan, due items, ledger actions, PDF downloads, cancel (Admin) |
| 9 | **Buyers List / Buyer Detail** | All | Buyer records; buyer detail shows photo, contacts, all bookings + combined ledger |
| 10 | **Record Payment** (form) | Accountant, Admin | Payment entry with allocation |
| 11 | **Roznamcha** | Accountant, Admin | Daily cash diary with running totals |
| 12 | **Recovery** | All (see §10) | Outstanding dues, overdue/upcoming, filters, CSV export |
| 13 | **Reports** | All (see §10) | Cash flow + income statement with date range, print output |
| 14 | **Settings** | Admin | Company profile, PDF terms text, expense categories, reminder templates & channel config, marla conversion |
| 15 | **Users** | Admin | Staff accounts and roles |
| 16 | **Audit Log** | Admin | Filterable trail of sensitive actions |
| 17 | **Reminder Log** | Accountant, Admin | Every send attempt with status |

Layout conventions: persistent left navigation; global EN/UR language toggle in the top bar (all roles, FR-2.4); map screen uses full width; drawers/modals for plot details and payment entry to preserve context.

---

## 12. UI States — Loading, Empty, Error

**Global**
- Loading: skeletons (not spinners-only) for lists, dashboards, and the map canvas; actions disabled while saving with button-level "Saving…" state.
- Errors: inline field errors for forms; non-blocking toasts for background failures; blocking dialogs only for destructive actions (delete polygon, cancel booking).
- Session expiry: redirect to Login with the intended page remembered.
- All user-facing errors state what happened and what to do next (plain English, no stack traces).

**Plot Map**
- Loading: image + polygons render progressively; placeholder skeleton for the canvas.
- Empty (no master plan): "No master plan uploaded yet — upload the society master plan to start plotting" + upload action (Admin).
- Empty (no polygons): overlay hint "Draw your first plot polygon" + tool hint (Admin); read-only hint for others.
- Errors: image upload failed (type/size/network) → retry; polygon save failed → keep drawing state, offer retry; very large image warning before processing.

**Plot List / Bookings / Buyers**
- Empty: one-line explanation + primary action ("No plots yet", "No bookings yet — book one from the map", "No buyers yet").
- Load error: inline error block with Retry.
- No filter matches: "No results for these filters" + Clear filters.

**Booking Wizard**
- Validation errors on each step (CNIC format, phone format, shares ≠ 100%, plan math invalid) block Continue until fixed.
- Save/confirm failure (e.g., plot got booked concurrently): clear message "This plot is no longer available" and return to the plot — no partial booking persisted.

**Payments & Roznamcha**
- Allocation preview must show the resulting due-item states before save; overpayment prompts "extra amount will be recorded as advance credit".
- Void-payment requires reason + confirmation.

**Recovery / Reports**
- Empty: "No outstanding dues — all installments collected 🎉" style, factual tone preferred ("No outstanding dues").
- Computing state for date-range reports; range errors (end before start) blocked inline.
- PDF generation failure: "Could not generate the document — Retry" with the failure logged.

**Reminders**
- Provider failure: log entry shows `Failed` + reason; dashboard surfaces "N sends failed in last 24h" for Admin/Accountant.
- No provider configured: reminders stay in `Skipped (not configured)` and Settings shows a setup prompt — never silently dropped.

---

## 13. Data Requirements

> Entity/field outline for implementation; exact schema is the coding agent's to design within these constraints.

**Entities and key fields**

| Entity | Key fields (beyond id, created/updated, created_by) |
|---|---|
| Company | name, logo (file), address, phone, email, pdf_terms_text, marla_sqft (default per D-1) |
| Project | name, location, marla_sqft (overrides default), master_plan_image (file), active flag |
| Block | project_id, code/name |
| Plot | project_id, block_id, plot_number, plot_type (Residential/Commercial), size_marla, width_ft, depth_ft, dimensions_text (display), price_pkr, status, polygon (points, normalized), notes |
| User | name, email/username, phone, role, password_hash, is_active, preferred_language (en/ur, default en) |
| Buyer | full_name, father_or_husband_name (opt.), cnic (unique, normalized), phone, address (opt.), photo (file), reminder_consent (bool), reminder_consent_at (timestamp) |
| Booking | plot_id, booking_date, status (Confirmed / Cancelled), sale_price_pkr, primary_buyer_id, created_by (agent), cancel_reason (opt.), plan snapshot fields (token, down_payment, installment_count, frequency, first_due_date) |
| BookingBuyer | booking_id, buyer_id, share_pct, is_primary |
| DueItem | booking_id, sequence, label (Token / Down Payment / Installment #n), due_date, amount_pkr, amount_paid_pkr (derived, cached), status (Pending / Partially Paid / Paid) |
| Payment | booking_id, amount_pkr, paid_on, method (Cash / Cheque / Bank Transfer), reference, notes, recorded_by, status (Posted / Voided), void_reason |
| PaymentAllocation | payment_id, due_item_id, amount_pkr (payments allocate to ≥ 1 due item; remainder = advance credit on booking) |
| RoznamchaEntry | date, direction (In / Out), amount_pkr, category, description, linked_payment_id (nullable), recorded_by, status (Posted / Voided) |
| ExpenseCategory | name, active flag (Admin-managed; seed: Office Expense, Utilities, Travel, Marketing, Other) |
| ReminderLog | due_item_id, channel (SMS / WhatsApp), milestone (T-10/T-7/T-3/T-0), recipient_phone, sent_at, status (Sent / Failed / Skipped), provider_ref, error_message |
| AuditLog | user_id, action, entity, entity_id, summary, created_at |

**Relationships (text diagram)**

- Project 1—* Block 1—* Plot 1—0..1 active Booking (history of bookings 1—* per plot).
- Booking *—* Buyer (via BookingBuyer, with share_pct; exactly one primary).
- Booking 1—* DueItem 1—* PaymentAllocation *—1 Payment; Payment 1—0..1 RoznamchaEntry (linked).
- Booking 1—* ReminderLog (via DueItem).

**Integrity & business-data rules**
- **Polygon storage**: ordered vertices in **normalized image coordinates** (x/y as fraction of image width/height, 0–1) so polygons stay correct if the master plan is re-rendered/resized.
- CNIC stored normalized (`NNNNN-NNNNNNN-N`), unique across buyers; phone normalized to PK mobile format.
- Money: `decimal(12,2)`, PKR; never floats. Dates: calendar dates in Asia/Karachi.
- Due-item status derived from allocations; plot status derived from booking state per §16.
- Payments and Roznamcha entries are financial records: no hard deletes — void with reason only.
- Files (master plans, photos, generated PDFs) live in object/file storage with access limited to authenticated users; PDFs are generated on demand and may be re-generated at any time.
- Logical deletes only for catalog data (blocks, categories, users); transactions are never deleted.

**Volume expectations**: ≤ 3,000 plots/project; ≤ 10,000 bookings; ≤ 200,000 due items/payments over the system lifetime — comfortably single-database scale.

---

## 14. Integrations

| Integration | Direction | Purpose | Status |
|---|---|---|---|
| **SMS gateway** (Pakistani provider via HTTP API) | Outbound | Payment reminders (T-10/7/3/0) | MVP (D-6 approved) — provider account is a client deliverable (§18); dry-run mode until configured |
| **WhatsApp Business API** (e.g., Meta Cloud API or BSP) | Outbound | Same reminders via WhatsApp | Optional at go-live (D-6 approved) — interface ready, not required for MVP acceptance |
| **File storage** | Internal | Master plans, buyer photos, generated PDFs | MVP (local volume or S3-compatible — A-11) |
| **PDF generation** | Internal | Allotment letter, payment schedule, reports print output | MVP (server-side rendering library) |

Explicitly not integrated: payment gateways, email, WhatsApp for two-way chat, biometric devices, accounting software (QuickBooks etc.), Google Maps/Mapbox (the master plan is an image, not a geospatial map).

Messaging design requirements:
- Provider-agnostic send interface + **dry-run mode** (log-only) so development and demos work without a live provider account.
- Template strings configurable in Settings (placeholders: buyer name, plot, amount, due date); English default.
- Idempotent sends keyed on (due item, milestone); daily reconciliation job flags failed attempts.

---

## 15. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Map with 3,000 polygons: interactive (pan/zoom/select) without noticeable lag; initial map load ≤ 3 s on typical office broadband; list/report screens render ≤ 2 s; PDF generation ≤ 5 s |
| **Security** | HTTPS only; password hashing (bcrypt/argon2); server-side RBAC on every endpoint; PII (CNIC, photos) visible only to authenticated users; no public registration; generic login-failure messages; audit trail on sensitive actions |
| **Data safety** | Automated daily database backup with 30-day retention; file backup with the same cadence; documented restore procedure |
| **Reliability** | Reminder scheduler is idempotent and crash-safe (no duplicate sends); financial records void-only; concurrent booking attempts resolve safely (first success wins, second gets a clean error) |
| **Usability** | Key flows (booking, payment) completable by staff with basic computer skills; every list has empty/loading/error states (§12); status colors accompanied by labels (color-blind safe); desktop-first (A-10) |
| **Localization** | PKR, Asia/Karachi, `DD-MMM-YYYY`; bilingual UI with EN/UR toggle (A-3, revised); LTR layout only — no RTL mirroring; generated PDFs English-only. Full RTL layout and Urdu PDFs are future phases |
| **Maintainability** | Conventional layered architecture (API + web UI + job scheduler); reminder sending behind an interface; settings (templates, categories, marla conversion) configurable without code changes; **all UI strings externalized** for EN/UR (see FR-2.4 architecture note) |
| **Capacity** | Sized for A-1/A-2 volumes; no horizontal scaling required for MVP |

---

## 16. Business Rules

**BR-1 Plot status lifecycle** (labels exactly per D-2):

```
Available ──book──▶ Booked/Token ──admin marks "Allotted/Sold"──▶ Sold/Constructed (terminal)
   ▲                  │
   │                  └──admin cancels booking──▶ Available
   └──admin releases── Reserved ──admin reserves──▶ (from Available only)
```

- Booking allowed only from `Available`; from `Reserved` only by Admin with confirmation.
- `Sold/Constructed` is terminal in MVP (no resale/transfer — out of scope).
- Every transition is audited (who/when/from/to/reason).

**BR-2 Payments & allocation**
- Payments post against a booking only. Allocation: oldest unpaid due item first by default; manual allocation allowed.
- Overpayment = advance credit on that booking (used before next due item). Negative/zero amounts are invalid.
- Payments and Roznamcha entries: void-with-reason only (no deletes). Voiding a payment reverses its allocations and its linked Roznamcha entry.

**BR-3 Payment plan math**
- `installment base = (sale price − token − down payment) / installment count`, rounded to 2 decimals; final installment absorbs the remainder (A-8).
- Token and down payment are themselves due items (due at booking date and, if different, the date entered at booking).
- Frequency: Monthly (same day-of-month as first due date) or Quarterly (+3 months), calendar arithmetic.

**BR-4 Reminders**
- Milestones: exactly T-10, T-7, T-3, T-0 days before due date (PKT). One attempt per due item per milestone; skip if paid; window 09:00–20:00 (A-7); recipient = primary buyer (D-5).
- Overdue follow-up messaging is **not** in MVP (only the four pre-due milestones).

**BR-5 Ownership**
- Joint ownership share % must total 100% (integer or 2-decimal); exactly one primary buyer per booking.

**BR-6 Money & documents**
- All amounts PKR, 2 decimals, displayed with thousand separators and `PKR`/`Rs` prefix.
- PDFs are generated from current data at download time; re-downloads always work and are identical for unchanged data.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Marla** | Traditional plot area unit (conversion to sq ft per D-1; commonly 225 sq ft in modern societies) |
| **Kanal** | 20 Marla (display only; system stores Marla) |
| **CNIC** | Computerized National Identity Card number, format `12345-1234567-1` |
| **Token** | Initial booking amount confirming intent to purchase |
| **Down payment** | Lump sum paid after token, before installments begin |
| **Allotment letter** | Official letter confirming plot allotment to buyer(s) |
| **Roznamcha** | Daily cash book / diary of cash in and out |
| **Recovery** | Collection of outstanding installments from buyers |
| **Block / Plot number** | Society subdivision and the plot's identifier within it |
| **Joint ownership** | One plot booked to two or more buyers with defined share % |
| **T-10 / T-7 / T-3 / T-0** | Reminder milestones: days before an installment due date (T-0 = due date) |
| **PKT** | Pakistan Standard Time (UTC+5), Asia/Karachi |

---

## 18. Open Items — Client Deliverables

> Document status is **Approved — v1.0**. The unchecked items below are deliverables owed by the client; they do **not** block this document or the start of implementation.

- [x] Decisions D-1 … D-12 — **approved 2026-10-18** (§6).
- [x] Assumptions A-1 … A-12 — **approved 2026-10-18**; A-3 revised to the bilingual UI toggle (§5).
- [ ] Sample allotment letter wording / company terms text (input to the PDF template).
- [ ] One real master plan image + a small set of real plots for acceptance testing.
- [ ] SMS provider account (and WhatsApp go/no-go) before go-live.

*End of document.*
