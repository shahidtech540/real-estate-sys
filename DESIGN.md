# DESIGN.md — Visual Design & UX Source of Truth

| | |
|---|---|
| **Document status** | v1.0 — baseline for implementation |
| **Date** | 2026-10-19 |
| **Product** | Society Plot Manager (SPM) — internal B2B operations tool |
| **Source of truth (behavior & scope)** | `PRD.md` v1.0 (Approved) |
| **Source of truth (presentation & interaction)** | This document |
| **Audience** | Coding agent, product owner, implementation team |

**Precedence rule:** if this document and the PRD disagree on **behavior or scope**, the PRD wins; if they disagree on **visual presentation or interaction mechanics**, this document wins. Update both when a decision affects both. Key traceability: PRD FR-2.4 & A-3 (bilingual UI) → §12; PRD §12 (UI states) → §8; PRD §11 (17 screens) → §13; PRD A-10 (desktop-first) → §10; PRD §10 (roles) governs which navigation items appear.

---

## 1. Purpose and How to Use This Document

This is an **internal financial/operations tool**, used daily by non-technical staff (Admin, Sales Agent, Accountant) handling money, legal records, and plot inventory. The design must optimize for: fast data entry, unambiguous numbers and statuses, error prevention, and long-session comfort. It must not look like a consumer product or a marketing site.

This document defines **reusable rules and tokens**, not per-screen art direction. When a new screen or component is needed, compose it from the patterns in §5–§8. Only invent a new component when nothing here fits — and then document it here first.

---

## 2. Design Principles

1. **Data is the decoration.** Tables, numbers, statuses, and the map are the visual content. No illustrations, gradients, mascots, or hero imagery. The only rich image in the product is the master plan itself.
2. **Money and status are never ambiguous.** Every currency figure has a defined format; every plot status renders as **color + icon + text label** (never color alone). When in doubt, add a label.
3. **One screen, one job.** Each page has a single primary action. Secondary actions are quiet but never hidden behind undiscoverable icons without tooltips.
4. **Boring is a feature.** Same table on every list page; same form rules on every form; same status chip everywhere. Staff learn the system once.
5. **Prevent errors over reporting them.** Validated input masks (CNIC, phone, amounts), allocation previews before saving payments, confirmation dialogs only for destructive/irreversible actions.
6. **Every state is designed.** Loading, empty, no-results, and error states are specified components (§8), not afterthoughts. There is no blank screen in this product.
7. **Clarity over cleverness.** No hover-only information, no drag interactions where a button exists, no motion without purpose. A first-day clerk must complete a payment without training beyond a walkthrough.

**Visual red lines (never do):** gradient backgrounds; colorful marketing illustrations; emoji in UI chrome (content strings may quote PRD copy verbatim); animated number count-ups; glassmorphism; pill-shaped everything; RTL page mirroring; color-only status; card grids where a table is the right container.

---

## 3. Voice & Tone (UI Copy Rules)

- Plain English, sentence case ("Record payment", not "Submit"/"RECORD PAYMENT").
- Buttons state the action and object: **Book plot**, **Save payment**, **Download allotment letter**. Banned: "Submit", "OK", "Process".
- Errors state **what happened + what to do next**. Never show stack traces, codes, or "Something went wrong".
- Empty states are factual ("No outstanding dues"), per PRD §12. No jokes or celebration emoji.
- All strings come from translation catalogs (§12) — write copy in the catalog, never inline.

---

## 4. Foundations

### 4.1 Color

**Surface neutrals** (all text/background pairing below meets WCAG AA):

| Token | Hex | Use |
|---|---|---|
| `ink-900` | `#111827` | Primary text, headings |
| `ink-700` | `#374151` | Body text, table cells |
| `ink-500` | `#6B7280` | Secondary text, labels, helper text |
| `ink-400` | `#9CA3AF` | Placeholder text, disabled text |
| `line` | `#E5E7EB` | Hairline borders (tables, cards, inputs) |
| `surface-sunken` | `#F9FAFB` | App background, table header background |
| `surface` | `#FFFFFF` | Cards, forms, tables, dialogs |
| `surface-hover` | `#F3F4F6` | Row hover, quiet button hover |

**Brand primary — deep navy** (actions, links, focus; deliberately **not** a status color):

| Token | Hex | Use |
|---|---|---|
| `primary-50` | `#EEF4FA` | Selected row tint, active nav tint |
| `primary-100` | `#D6E4F2` | Hover fill on secondary buttons |
| `primary-600` | `#1F4E8C` | Primary button fill, links, focus ring, active nav text |
| `primary-700` | `#173D70` | Primary button hover |
| `primary-900` | `#0B213B` | Nav sidebar background |

White text on `primary-600` is ≥ 4.5:1. Links inside body text: `primary-600`, underlined on hover/focus only (always underlined in print).

**Semantic colors:**

| Token | Hex | Use |
|---|---|---|
| `danger-600` | `#B91C1C` | Errors, destructive buttons, cash **Out** amounts |
| `danger-50` | `#FEE2E2` | Error banner background |
| `success-700` | `#15803D` | Payment **In** amounts, "Paid" chip, success text |
| `success-50` | `#DCFCE7` | Success banner background |
| `warning-700` | `#B45309` | Overdue emphasis text, failed-send warnings |
| `warning-50` | `#FEF3C7` | Warning banner background |

**Money color rule:** direction is encoded as **sign + label + color** — cash In = `success-700` with a leading `+` and the word "In"; cash Out = `danger-600` with `−` and "Out". Color never carries the meaning alone.

**Plot status system (critical — color-blind safe):** each status maps to a hue **and** a lightness **and** an icon **and** a mandatory text label. The four hues are separated by hue family (green-teal / yellow-amber / dark red / neutral grey) and by lightness so they remain distinct under deuteranopia, protanopia, and tritanopia. Reserved is intentionally **neutral grey** — a non-hue — so it can never collide with the three chromatic statuses.

| Status (exact PRD label) | Chip text color | Chip background | Icon (20px) | Map polygon fill / stroke |
|---|---|---|---|---|
| **Available** | `#0F524B` | `#EAF4F3` | check-circle | fill `#166B62` @ 18% opacity / 2px solid `#166B62` |
| **Booked / Token** | `#92400E` | `#FFFBEB` | clock | fill `#B45309` @ 18% / 2px **dashed** `#B45309` (6px 3px) |
| **Sold / Constructed** | `#7F1D1D` | `#FEE2E2` | lock | fill `#7F1D1D` @ 22% / 3px solid `#7F1D1D` |
| **Reserved** | `#334155` | `#F1F5F9` | bookmark | fill `#475569` @ 15% / 2px **dotted** `#475569` (2px 3px) |

**Status rendering rules (non-negotiable):**
1. Every status appears as the `StatusChip` component (§5.2): tinted background + icon + exact PRD label text.
2. On the map, stroke style (solid / dashed / dotted / thicker) is the third encoding channel, and the legend shows **swatch + icon + label** rows.
3. Status colors are **reserved for statuses only**. Never use teal/amber/maroon/grey chips for generic tags.
4. Never reduce a status to a bare colored dot. The only dot allowed is inside a legend row next to its label.

### 4.2 Typography

**Typeface pairing (supports Latin + Urdu):**

| Script | Typeface | Why |
|---|---|---|
| Latin (default) | **Inter** (variable; weights 400/500/600/700) | Built for dense UI; excellent numerals (tabular); universally legible |
| Urdu | **Noto Sans Arabic** (Naskh-style; weights 400/700) | Designed for UI legibility at small sizes; clean Naskh forms; best-in-class Urdu/Arabic glyph coverage |
| Urdu display (optional) | **Noto Nastaliq Urdu** | Aesthetic Nastaliq, but its tall strokes and deep descenders require ≥ 20px and ≥ 2.0 line-height. **Off by default in MVP**; may be enabled for page titles only via a Settings flag |

**Decision (recorded):** the UI Urdu face is **Naskh (Noto Sans Arabic)**, not Nastaliq. Rationale: this is a data-dense tool; Nastaliq's calligraphic forms degrade at 12–14px table/label sizes and force wide line-heights that halve information density. This decision will be carried forward into ARCHITECTURE.md's future i18n section (ARCHITECTURE.md has not been written yet); this document picks Naskh for MVP.

**Latin type scale** (base body 14px; `tnum` = `font-variant-numeric: tabular-nums`):

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-title` | 24 / 32 | 600 | Login title, major page titles |
| `text-h1` | 20 / 28 | 600 | Page headers (every screen) |
| `text-h2` | 16 / 24 | 600 | Section headers (form sections, card titles) |
| `text-body` | 14 / 20 | 400 | Body, form labels, buttons |
| `text-sm` | 13 / 18 | 400 | Table cells, helper text, chip labels |
| `text-xs` | 12 / 16 | 400 | Timestamps, column meta, footnotes |
| `text-kpi` | 28 / 36 | 600, `tnum` | Dashboard KPI numbers |

**Numerals & money rules:**
- All amounts, counts, dates-in-tables use **tabular numerals** (`tnum`) so columns align.
- Tables carrying money: column header states the currency once — `Amount (PKR)` — and cells show bare numbers right-aligned (`1,250,000.00`). Standalone amounts (KPI tiles, summaries, forms) show the prefix: `PKR 1,250,000.00`.
- Dates always render `DD-MMM-YYYY` (e.g., `05-Oct-2026`) in **both** languages. Never localize date format.
- **Digits stay Latin (0–9) even in Urdu mode** — financial scanning speed and column alignment beat script purity (§12.4).

### 4.3 Iconography

- One family only: Lucide-style, 20×20px rendered size, 1.75px stroke, round joins. No emoji, no multi-color icons.
- Icon-only buttons require a tooltip and `aria-label`. Familiar icons may carry no visible label in dense toolbars (map toolbar) but never in primary flows.
- Fixed status icons (§4.1) are part of the design language and must match the table exactly.

### 4.4 Borders, Radius, Elevation

- **Hairlines over shadows.** Structure is drawn with 1px `line` borders. Shadows exist only for overlays.
- Radius: `radius-sm 4px` (inputs, buttons, chips), `radius-md 6px` (cards, dialogs, drawers), `radius-full 999px` (avatars only).
- Elevation: `elev-0` = border only (cards/tables); `elev-1` = `0 2px 6px rgba(17,24,39,.12)` (dropdown menus, popovers); `elev-2` = `0 8px 24px rgba(17,24,39,.18)` (dialogs, drawers).

### 4.5 Spacing & Grid

- Base unit **4px**. Scale: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`.
- Standard paddings: page content `24px` (tablet `16px`); card `20px`; table cell `12px 16px`; form field gap `16px`; section gap `32px`.
- Never use fractional values. Component internals use the scale; layout uses the scale.

### 4.6 Application Shell

```
┌──────────────────────────────────────────────────────────┐
│ Top bar (56px): product mark · project switcher ·    EN|اردو · user menu │
├─────────────┬────────────────────────────────────────────┤
│ Sidebar     │ Page header: H1 + supporting text · actions (right)  │
│ (240px,     ├────────────────────────────────────────────┤
│  navy-900)  │ Content (24px padding, full-bleed for tables/map)    │
└─────────────┴────────────────────────────────────────────┘
```

- **Top bar (56px, `surface`, bottom hairline):** product mark left; project switcher (when >1 project) next to it; right cluster = language toggle (§5.13) + user menu (name, role chip, "Sign out").
- **Sidebar (240px, `primary-900` background, white text):** navigation per PRD §10 — items the role cannot access are **not rendered**. Active item: `primary-50` tint fill, 3px left indicator bar in `surface` white, `text-body` weight 600. Group labels (e.g., "Sales", "Accounts", "Administration") in `text-xs` uppercase, `ink-400`-equivalent white at 60% opacity.
- **Page header:** `text-h1` + supporting line (`text-sm`, `ink-500`) left; primary actions right. Optional breadcrumb above title (`text-xs`: `Plot Map › Block A › Plot 12`).
- **Content:** no max-width on data screens; forms and wizards cap at **720px** for readability.

---

## 5. Reusable Components

Component states required everywhere unless noted: **default, hover, focus-visible, active/pressed, disabled, loading**.

### 5.1 Buttons

| Variant | Spec | Use |
|---|---|---|
| **Primary** | 36px h, `primary-600` fill, white text, `radius-sm`, padding `0 16px`, hover `primary-700` | The single main action of a view/form |
| **Secondary** | 36px h, white fill, 1px `line` border, `ink-700` text; hover `surface-hover` | Supporting actions (Cancel, Export, Download) |
| **Ghost** | 32px h, transparent, `ink-700`; hover `surface-hover` | In-table actions, toolbar toggles |
| **Danger** | 36px h, `danger-600` fill, white text | Destructive confirmations only (Delete polygon, Cancel booking, Void payment) |
| **Icon button** | 32×32 (table) or 36×36 (toolbars), ghost styling, mandatory tooltip + `aria-label` | Map tools, row actions |

- Default button height 36px; dense contexts (table rows, stepper footers in tablet) may use 32px. Touch (tablet) minimum 40px.
- Loading state: keep width stable, replace label with `Saving…` and a 16px spinner; `disabled` while saving.
- Button labels are verbs (§3). Max 3 words.

### 5.2 StatusChip (plot status, payment status, send status)

- Height 24px, `radius-sm`, padding `0 8px`, gap 6px: **icon 14px + `text-sm` label**.
- Colors/icons exactly per §4.1 (plot) or §4.1 semantic (payment: Paid = success, Partially Paid = warning + label, Pending = ink-500; reminder: Sent = success, Failed = danger, Skipped = ink-500).
- Chip text is the full label — abbreviations ("Bkd") are forbidden.

### 5.3 Form controls (see §7 for form rules)

- **Text input / select / textarea:** 36px h (textarea min 80px), 1px `line` border, `radius-sm`, padding `0 12px`, `text-body`. Focus: 2px `primary-600` ring, offset 2px. Error: 1px `danger-600` border + `text-sm` `danger-600` message below with `role="alert"`.
- **CNIC input:** mask `12345-1234567-1` (auto-insert dashes, 13 digits max), `dir="ltr"`, `tnum`. Invalid state message: "Enter a valid CNIC (e.g., 12345-1234567-1)".
- **Phone input:** mask `03XX-XXXXXXX`; accepts `+92` and normalizes on save; `dir="ltr"`, `tnum`.
- **PKR amount input:** `dir="ltr"`, `tnum`, thousand separators applied on blur, `PKR` prefix adornment, 2 decimals allowed. Rejects negatives and >2 decimals on input.
- **Date picker:** input shows `DD-MMM-YYYY` (`05-Oct-2026`); calendar popover (`elev-1`) with month jump; keyboard typable; no time component anywhere in MVP.
- **File upload (master plan, buyer photo):** dropzone with dashed 2px `line` border, accepted types and max size shown as helper text; after upload show thumbnail + Replace/Remove. Buyer photo preview circle 96px (booking form) / 32px (rows).
- **Toggle / checkbox / radio:** standard 16px controls; checkbox lists for payment allocation (§5.7).

### 5.4 Data Table with Filters (the default list pattern)

- **Header row:** 36px, `surface-sunken`, `text-sm` weight 600, bottom 1px `line`. Sticky on scroll.
- **Body rows:** 40px, bottom hairline, hover `surface-hover`, selected row `primary-50`. No zebra striping.
- **Cells:** `text-sm`; text columns left-aligned; **numeric columns right-aligned `tnum`**; status columns render `StatusChip`; date columns `DD-MMM-YYYY` `tnum`.
- **Columns:** every column sortable where meaningful (click header, caret icon); default sort documented per screen (§13).
- **Row actions:** rightmost column, ghost icon buttons or a "⋯" menu with `elev-1` popover (Edit, Open, Download…). Row click opens the record; nested buttons must not trigger row click.
- **Filter bar** (above table, 48px): search input (240px) + 2–4 faceted selects + optional date range + **Clear filters** ghost button that appears only when filters are active. Active filters also render as removable chips below the bar.
- **Pagination:** footer 40px; `Rows per page: 25 · 50 · 100`; page info "1–25 of 312" `text-xs`; Prev/Next icon buttons. No infinite scroll — staff need stable rows.
- **Empty / no-results / load-error:** §8 patterns.
- **Wide tables on narrow screens:** horizontal scroll with **sticky first column** (identity column) — tables are never transformed into cards.

### 5.5 Interactive Map & Polygon Canvas (Plot Map)

- **Canvas:** fills content area below the top bar (full-bleed); `surface-sunken` background; master plan image centered; zoom 25%–400% (buttons + mouse wheel + touch pinch); pan by drag on empty space.
- **Floating toolbar** (top-left, `elev-1`, radius-md): Select (default), Draw plot (Admin), Edit vertices (Admin), Delete (Admin, danger icon), separator, Zoom in, Zoom out, Fit. Active tool = `primary-600` fill. Draw/Edit/Delete disabled with tooltip for non-Admins ("Admin only").
- **Legend** (top-right, `elev-1`, collapsed to a chip on tablet): four rows — status swatch (24×12 stroke-style sample) + StatusChip icon + label. Clicking a row filters/highlights that status.
- **Search** in toolbar area: plot number typeahead; on select, pan/zoom to polygon and open details.
- **Polygons:** per §4.1 fill/stack. Hover: stroke 3px + pointer cursor. Selected: 2px `primary-600` outline **outside** the status stroke + 8px square vertex handles (white fill, navy border).
- **Drawing interaction (PRD US-2.2 exact):** click to add vertices (live rubber-band preview), close by clicking the first vertex or double-click; `Esc` cancels in-progress drawing (discard); `Enter` confirms. Invalid polygons (< 3 vertices) cannot close.
- **Details panel:** right drawer (400px, `elev-2`) on polygon click — Plot Details content (§13.5) with primary **Book** button when status is `Available` (and role permits) or `Reserved` (Admin only, with confirm).
- **Concurrent-booking guard:** Book action revalidates on submit; conflict shows blocking dialog "This plot is no longer available" (PRD §12) with "Back to plot" action.
- **Keyboard accessibility:** the canvas is a pointer enhancement, not the only path — **Plot List + Plot Details provide the full keyboard path** (see §11).

### 5.6 Booking Wizard Stepper

- **Stepper:** 4 steps, horizontal: `1 Plot & price · 2 Buyers · 3 Payment plan · 4 Review`. Circles 28px with connectors; current = `primary-600` fill + white number; completed = check icon + tappable (return to edit); upcoming = `line` border, `ink-400` number. Labels `text-sm` below.
- **Step content:** single 720px column card; each step has `text-h2` title + `text-sm` guidance line.
- **Footer (sticky at content bottom):** Back (Secondary, hidden on step 1) left; **Continue** (Primary) right; final step shows **Confirm booking** (Primary) + Edit-step links.
- **Validation:** Continue disabled until step valid; on attempt with errors, first invalid field focused and error summary pinned above the form ("Fix 2 fields to continue").
- **Step 4 Review:** definition-list rows (`text-sm` label left `ink-500`, value right `ink-900` weight 600): plot identity, price, buyer(s) with share %, plan parameters, generated schedule table (label, due date, amount, `tnum`).
- **Success:** replaces form content — success banner ("Booking confirmed — Plot B-12 is now Booked / Token"), summary line, and two PDF buttons (Allotment letter, Payment schedule) + "Back to booking" link.

### 5.7 Ledger & Payment Allocation

- **Ledger table** (Booking Detail / Buyer Detail): columns `Date · Ref · Description · Debit (PKR) · Credit (PKR) · Balance (PKR)`; amounts right-aligned `tnum`; row type as small icon + text (Due item / Payment / Advance); voided rows `ink-400` strikethrough on the amount only, with a "Voided" chip.
- **Summary strip** (above ledger, 4 tiles): Sale price · Total paid · Balance · Advance credit. Balance tile uses warning color only when > 0 **and** overdue exists; label text always present.
- **Payment allocation UI** (Record Payment): after amount/date/method fields, an "Allocate to installments" table of open due items with checkboxes and editable per-row amounts; default = oldest unpaid first. Sticky footer summary: `Allocating 25,000 of 25,000 · Remaining 0`. If total payment > allocation, footer shows `Extra 5,000 will be recorded as advance credit` (success banner style). If allocation < amount without assigning advance, block save with a clear message.
- **Allocation preview before save is mandatory** (PRD §12): the resulting due-item states (Pending → Partially Paid / Paid) are shown as chips in the table before the Save button becomes enabled.

### 5.8 KPI Tile (dashboards, Recovery strip, Roznamcha totals)

- White card (`elev-0`, 1px `line`, radius-md, 20px padding): `text-sm` `ink-500` label · `text-kpi` `ink-900` number (`tnum`) · optional third line `text-xs` supporting fact ("Overdue · 6 bookings").
- Grid: 4-up desktop, 2-up tablet. Tile click filters the related table below.
- **Numbers never animate** (no count-ups) — accuracy and trust first.

### 5.9 Dialogs, Drawers, Toasts, Banners

- **Dialog (400px or 520px wide, `elev-2`):** destructive/irreversible actions only. Title `text-h2`, body `text-body`, footer right-aligned: Cancel (Secondary) + action (Danger or Primary). Void-payment dialog includes a required reason textarea.
- **Drawer (400px right side, `elev-2`, overlay `rgba(17,24,39,.35)`):** Plot Details, Record Payment (drawer variant), quick edit. `Esc` closes; unsaved-changes confirm on close.
- **Toast (bottom-right, `elev-2`, 4000ms; errors persist):** success (check icon) / error (alert icon) / info. Toasts are for background results only — **never the sole feedback for a validation or money action**.
- **Banner (in-page, 48px min, radius-md):** error (`danger-50`), warning (`warning-50`), success (`success-50`), info (`primary-50`); icon + message + optional action button. Used for page-level failures, "N sends failed in last 24h", unconfigured SMS provider.

### 5.10 Skeleton, Empty State, Error Block (see §8)

- **Skeleton:** `surface-hover` blocks matching the real layout (row shapes for tables, tile shapes for KPIs, canvas rect for map); subtle 1.5s opacity pulse; **no layout shift** when real data arrives.
- **Empty state (centered, 320px max):** 24px icon in `ink-400`, one `text-body` sentence, at most one primary action button. No illustrations.
- **Error block (in place of data):** alert icon in `danger-600`, `text-body` message ("We couldn't load the bookings list. Check your connection and try again."), **Retry** Secondary button.

### 5.11 PDF Action Buttons

- Always the pair of Secondary buttons with download icon: **Download allotment letter**, **Download payment schedule** (nouns per PRD). In Reports: **Print report** (Secondary).
- Generating: button enters loading state ≤ 5s, then browser download. Failure: inline banner with Retry (PRD §12).
- In Urdu mode, add `text-xs` helper under the pair: "PDF is in English" (§12.5).

### 5.12 Avatar / Buyer Photo

- Circle: 32px (tables), 64px (detail header), 96px (forms). Missing photo = `ink-100` circle with initials (`text-sm` weight 600). Photo is never decorative elsewhere.

### 5.13 Language Toggle (EN / اردو) — see §12 for full behavior

- **Form:** segmented control, 32px height, `radius-sm`, 1px `line` container. Two segments: `EN` (Latin) and `اردو` (rendered in Urdu script). Active segment: `primary-600` fill, white text. Inactive: transparent, `ink-700`.
- **Placement:** top bar right cluster, immediately left of the user menu. Also present on **Login** (top-right of the page) so users can work in their language before signing in.
- **A11y:** `role="radiogroup"` with labels "English" and "Urdu"; current selection announced ("Language: English"). Keyboard: arrow keys switch, `Enter` applies.
- No flags (languages are not countries). No globe icon substitute.

---

## 6. Navigation

- **Sidebar** (per PRD §10 role visibility — never render disabled items):
  - *All roles:* Dashboard, Plot Map, Plots, Bookings, Buyers
  - *Accountant & Admin:* Record Payment, Roznamcha, Recovery, Reports, Reminder Log
  - *Admin only:* Settings, Users, Audit Log
  - Sales Agents additionally see Recovery as **View only** (per PRD §10) — item rendered normally; write actions absent inside.
- **Order** is fixed as above; grouping labels: "Inventory", "Sales", "Accounts", "Administration".
- **Project switcher** (top bar, when multiple projects): `text-body` select showing project name; switching reloads all project-scoped data; never mixed-project data on one screen.
- **Breadcrumbs** on drill-downs only (Plot → Booking → Buyer). Top-level screens have no breadcrumbs.
- **URLs are stable and deep-linkable** (`/bookings/BK-1042`, `/map?plot=B-12`). Unauthorized deep links render the "Not available for your role" empty state, not a redirect loop.
- **User menu:** name + role chip (ink-500 tinted chip, not a status chip), "Sign out".

---

## 7. Forms

- **Layout:** single column, label **above** field, helper text below (`text-xs`, `ink-500`). Never placeholder-as-label. Two fields may share a row only for short paired inputs (e.g., First/Last is not used — full name is one field).
- **Widths:** standard fields 400px within the 720px form column; amount/date fields 200px; full-width for textareas and tables.
- **Required fields:** asterisk after label + `aria-required`; required is the exception (token, down payment, name, CNIC…), not the rule.
- **Validation timing:** on blur and on submit, never on keystroke; fix-first-field error summary on failed submit.
- **Section headers** (`text-h2` + hairline) group long forms (Booking Wizard step 2: "Buyers"; step 3: "Payment plan").
- **Sticky footer:** Cancel (Secondary) + primary submit; disabled during save; if the user scrolls, footer stays visible.
- **Unsaved changes:** navigating away from a dirty form opens a confirm dialog ("Discard unsaved changes?").
- **Enter** submits single-field-safe forms; **Esc** cancels dialogs/drawers only.

---

## 8. States — PRD §12 Mapped to Component Patterns

| PRD §12 case | Pattern to use | Copy (English catalog key suggestion) |
|---|---|---|
| List/dashboard/map loading | **Skeleton** matching final layout | — |
| Action in progress | Button **loading** state (`Saving…`) | `common.saving` |
| Background failure | **Toast** error (persistent) + log | `common.backgroundError` |
| Form field invalid | **Inline field error** (`role="alert"`) | per-field |
| Destructive action | **Dialog** confirm (Danger button) | per-action |
| Session expiry | Blocking dialog → Login with intended page remembered | `auth.sessionExpired` |
| Any user error | States what happened + next step; no codes | — |
| Map: no master plan | Empty state + **Upload master plan** (Admin) / read-only note | `map.emptyPlan` (per PRD copy) |
| Map: no polygons | Overlay hint callout (Admin draw tool hint) | `map.emptyPlots` |
| Map: upload failed (type/size/network) | Inline error in upload control + Retry | `map.uploadFailed` |
| Map: polygon save failed | Toast error + Retry; **keep drawing state** | `map.polygonSaveFailed` |
| Map: image very large | Warning banner before processing (size shown) | `map.largeImage` |
| List: empty | **Empty state** + one action (per PRD copy) | `*.empty` |
| List: no filter matches | Empty variant + **Clear filters** | `common.noResults` |
| List: load failed | **Error block** + Retry | `common.loadFailed` |
| Wizard: invalid step | Error summary + focus first invalid field | `wizard.fixFields` |
| Wizard: plot taken concurrently | Blocking dialog "This plot is no longer available" → back to plot | `booking.plotTaken` |
| Payment: before save | **Allocation preview table** with resulting chips | — |
| Payment: overpayment | Inline success banner: extra amount → advance credit | `payment.advanceCredit` |
| Payment: void | Dialog with required reason | `payment.voidTitle` |
| Recovery: none outstanding | Empty state, factual | `recovery.noOutstanding` |
| Reports: computing | Skeleton table + disabled controls | — |
| Reports: invalid range | Inline errors (end before start) | `reports.invalidRange` |
| PDF failed | Inline banner + Retry (failure logged) | `pdf.generationFailed` |
| Reminders: failures | Row `Failed` chip + reason; banner "N sends failed in last 24h" | `reminders.failedCount` |
| Reminders: no provider | `Skipped (not configured)` chips + Settings setup prompt | `reminders.notConfigured` |

---

## 9. Interactions & Animation

- **Budget: functional micro-motion only.** Duration ≤ 200ms; standard easing `ease-out`.
- Allowed: drawer slide-in (200ms, translateX 24px + fade), dialog fade (150ms), toast slide-up (150ms), dropdown fade (100ms), hover/focus transitions (100ms), stepper connector progress (150ms), skeleton opacity pulse (1.5s loop).
- Map: no animated pans except **Fit** (200ms). Zoom is immediate. Polygon hover/select feedback is instantaneous.
- **Forbidden:** number count-ups, celebratory animations, parallax, auto-playing tours, animated gradients, spring/bounce easing.
- `prefers-reduced-motion: reduce` → all of the above collapse to instant state changes (keep color/border feedback).
- Focus management: opening dialog/drawer moves focus in and restores it on close; toasts are `aria-live="polite"`; money-save confirmations are announced (`aria-live="assertive"` region).

---

## 10. Responsive Behavior (desktop-first per PRD A-10)

| Viewport | Behavior |
|---|---|
| **≥ 1280px** (primary target, design canvas 1440px) | Full shell: sidebar 240px; all screens fully functional |
| **1024–1279px** | Sidebar collapses to **64px icon rail** (icons + tooltips; click opens flyout labels); drawers 360px; KPIs 2-up; tables scroll horizontally with sticky first column |
| **768–1023px (tablet)** | Sidebar becomes an overlay drawer (hamburger in top bar); padding 16px; map full-bleed with toolbar collapsed into a "Tools" popover; **polygon draw/edit disabled** with note "Drawing plots needs a desktop computer" (A-10); booking wizard, payments, and lists remain fully usable with 40px touch targets; on-screen keyboard aware sticky footers |
| **< 768px (phone)** | **Not supported for this MVP.** A simple `surface` screen: product mark, line "Society Plot Manager is built for tablets and computers.", language toggle retained. No partial UI |

- Tables never become card lists at any width. Forms stay single-column below 1280px. The map never hides the status legend entirely (collapses to a chip that expands).

---

## 11. Accessibility Requirements

- **Target: WCAG 2.1 AA.**
- **Contrast:** body text ≥ 4.5:1; large text (KPI, titles ≥ 20px) ≥ 3:1; UI borders and focus rings ≥ 3:1; disabled text ≥ 3:1 (avoid disabling when possible — prefer explaining why an action is unavailable).
- **Keyboard:** every action reachable by keyboard; logical tab order (top bar → sidebar → page header → content); visible 2px `primary-600` focus ring with 2px offset on every interactive element — never `outline: none` without a replacement.
- **Map:** canvas is a **progressive enhancement**; the canonical accessible path is Plot List (table) → Plot Details (page/panel) → Booking Wizard. The map's own controls (toolbar buttons, legend rows, search) are keyboard-operable; polygons are additionally listed in the legend filter and search.
- **Semantics:** real `<table>` markup with header scopes; headings hierarchy (one `h1` per page); landmarks (banner/nav/main/contentinfo); skip-to-content link.
- **Forms:** labels programmatically associated; errors linked via `aria-describedby` and announced (`role="alert"`); required fields `aria-required`; do not rely on color/red borders alone for errors — always include the error icon + text.
- **Status:** color is always accompanied by icon + text (§4.1) — this satisfies color-blind users by construction.
- **Targets:** ≥ 32×32px on desktop, ≥ 40×40px on tablet.
- **Zoom:** 200% browser zoom without loss of content or horizontal scrolling of the page (tables may scroll internally).
- **Language:** `document.documentElement.lang` switches `en` ↔ `ur` with the toggle; Urdu strings use `lang="ur"` where isolated; screen readers get correct pronunciation.
- **Time-based content:** toasts ≥ 4s; no essential info exists in a toast alone.

---

## 12. Bilingual UX Behavior (EN / UR — PRD FR-2.4, A-3)

### 12.1 The toggle

- Segmented control (§5.13), always in the top bar (and Login). Two segments: `EN`, `اردو`.
- Switching is **instant** (no reload): catalog swaps in place; scroll position, open drawer, and in-progress form state are **preserved**; user input already typed stays untouched.
- Selection persists per user (`preferred_language`), default `en`. Login page selection persists in the session and applies after sign-in.
- On switch, an `aria-live` announcement confirms: "Language changed to Urdu" / "زبان انگریزی کر دی گئی ہے" (in the target language).

### 12.2 Layout: fixed LTR (no RTL mirroring)

- The **layout direction stays left-to-right in both languages** — sidebar stays left; back/continue buttons keep their sides; table columns keep their order; icons never mirror.
- Only **text runs** are bidi-correct: Urdu strings render RTL *within their element* (`unicode-bidi: isolate` on labels, buttons, chips, cells).
- User-generated content (buyer names, addresses, notes) uses `dir="auto"` so Urdu data renders correctly even in English mode.
- Numeric/identity fields (CNIC, phone, amounts, plot numbers, dates) stay `dir="ltr"` with Latin digits in **both** modes.

### 12.3 What translates

- All UI chrome: navigation, buttons, labels, helper text, empty/error copy, table headers, filter labels, dialog text, validation messages.
- **PDF documents stay English-only** (PRD A-3): PDF buttons keep their icons; in Urdu mode show the helper note "PDF is in English".
- Fixed data labels: status **labels** translate (e.g., Available → دستیاب); the exact PRD English labels remain the canonical catalog keys. Plot numbers, block codes, and reference IDs never translate.

### 12.4 Numerals policy

- **Latin digits everywhere, both languages** (dates, money, counts, CNIC, phone). Rationale: staff scan columns of money; mixed digit systems cause errors. Use `tnum` and consistent thousand separators (`1,250,000.00`).
- Urdu grammar around numbers must be written to fit Latin numerals in the catalog strings (placeholders, not numeral substitution).

### 12.5 Urdu typography rules

| Rule | Value |
|---|---|
| Font | **Noto Sans Arabic** (Naskh). Fallback: `"Segoe UI", Tahoma, sans-serif` |
| Size | +1 step vs Latin equivalent (13px → 15px, 14px → 16px, 20px → 22px); `text-xs` → 13px minimum |
| Line-height | 1.6 for body/labels (Latin 1.4–1.5); 1.8 for `text-h1` and above |
| Weight mapping | Only 400 and 700 exist reliably; map 500 → 400, 600 → 700 |
| Letter-spacing | 0 — never track/letterspace Urdu |
| Text transform | Never uppercase/small-caps Urdu |
| Truncation | Avoid ellipsis on Urdu; allow 2-line wrap (`line-clamp: 2`) for chips/labels; tooltips for full text |
| Mixed strings | Isolate Urdu runs inside English sentences and vice versa (`unicode-bidi: isolate`) |
| Nastaliq (if enabled) | Only `text-h1` and larger; line-height ≥ 2.0; never in tables, chips, buttons, or inputs |
| Font loading | Urdu webfont loads on first Urdu render; ≤ 200ms fallback flash acceptable (`font-display: swap`) |

### 12.6 Catalog discipline

- No hardcoded user-facing strings in components (enforced per PRD's ARCHITECTURE.md note). Keys are semantic (`booking.stepBuyers`), stable across languages. Both catalogs ship complete; a missing key renders the English fallback and is a build-time failure, not a runtime blank.

---

## 13. Page-Level Layout Guidance (PRD §11 — 17 screens)

> Reused patterns: **Standard List Page** (page header + filter bar + data table + pagination — §5.4), **Standard Detail Page** (breadcrumb + header with identity + summary strip + tab-less stacked sections of hairline-separated blocks), **Form Page** (720px column, §7).

**13.1 Login** — centered 400px card on `surface-sunken`: logo (company), `text-title` "Sign in", email + password fields (full-width), full-width Primary "Sign in", error banner for bad credentials, `text-xs` support line ("Contact your administrator if you can't sign in"). Language toggle top-right of the page. No registration or marketing content.

**13.2 Dashboard** — role-aware composition of `KPI Tile`s + compact tables (reuse table styles, 5 rows max, "View all" ghost link).
- *Admin:* 4 KPIs (Plots available · Booked this month · Collected this month · Outstanding total) + recent bookings + failed-reminders banner when > 0.
- *Sales:* KPIs (Available plots · My bookings this month) + recent bookings table.
- *Accountant:* KPIs (Today's cash in · Today's cash out · Overdue total · Collected this month) + overdue-soon table.

**13.3 Plot Map** — §5.5 exactly: full-bleed canvas, floating toolbar + search, legend, details drawer with **Book** action. Page header is minimal (title + status filter chips row is optional here; legend carries status filtering).

**13.4 Plot List** — Standard List Page. Columns: `Block · Plot # · Type · Size (Marla) · Dimensions · Price (PKR) · Status · (row action: Open)`. Filters: search (plot #), block select, status select, size range, type select. Default sort: Block, then Plot #. Status column = StatusChip.

**13.5 Plot Details** — as drawer (from map) or page (from list): header "Block B · Plot 12" + StatusChip + price `text-kpi`-small (20px `tnum` PKR). Sections: **Plot** (type, size Marla + sq ft, dimensions, notes) · **Booking** (if any: booking ref, date, buyer names, balance — link "Open booking") · **Status history** (compact timeline table: date, from → to chips, by whom). Actions per role (PRD §10): Book (Sales/Admin), Edit plot / Reserve / Release (Admin).

**13.6 Booking Wizard** — §5.6 stepper; 720px column; Step 2 Buyers includes buyer photo upload (96px), CNIC/phone masked inputs, joint-ownership share % with live "Shares total: 100%" indicator; Step 3 Payment plan with **live schedule preview table** (recomputed on input change).

**13.7 Bookings List** — Standard List Page. Columns: `Booking # · Date · Plot · Buyers (primary + "+2") · Sale price (PKR) · Received (PKR) · Balance (PKR) · Status chip (Confirmed/Cancelled) · Agent`. Filters: date range, block, status, agent (Admin), search (booking # / plot / buyer name). Default sort: date desc.

**13.8 Booking Detail** — Standard Detail Page. Header: booking ref + plot identity + StatusChip + buyer name(s). Summary strip (Sale price · Paid · Balance · Advance). Sections: **Buyers** (avatar 64px, name, CNIC `tnum`, phone, share %, "Open buyer" link) · **Payment plan** (schedule table with per-row status chips) · **Ledger** (§5.7) · **Documents** (PDF button pair §5.11). Actions: **Record payment** (Primary), Download PDFs (Secondary), **Cancel booking** (Admin, Danger, dialog with reason).

**13.9 Buyers List / Buyer Detail** — *List:* Standard List Page; columns `Photo · Name · CNIC · Phone · Bookings count · Total outstanding (PKR)`. *Detail:* header with 64px photo + name + CNIC + phone (call icon ghost button); sections: **Bookings** (mini table) · **Combined ledger** (§5.7) with summary strip. One Buyer record per CNIC (PRD A-12) — "Open buyer" always lands on the canonical record.

**13.10 Record Payment** — Form Page (also embeddable as drawer from Booking Detail): Booking/Buyer picker (pre-filled when opened from a booking, with lock icon) · Amount, Date, Method (segmented: Cash / Cheque / Bank Transfer) · Reference · Notes · **Allocation table** (§5.7) with sticky footer summary · Primary **Save payment**. Success: banner with "Payment recorded" + link to ledger + "Record another".

**13.11 Roznamcha** — header with date picker ("Roznamcha — 05-Oct-2026") + period totals strip (In · Out · Net — signs + labels per §4.1). Quick-add row at top (Direction segmented In/Out · Category select · Amount · Description · Add ghost button). Main table: `Time · Direction (chip In/Out + sign) · Category · Description · Amount (PKR) · Reference (link to payment) · Recorded by`. Linked entries show link icon; voided entries per §5.7. Day navigation: ‹ prev · today · next › ghost buttons.

**13.12 Recovery** — KPI strip (4 tiles §5.8: Total outstanding · Overdue · Upcoming 7 days · Collected this month) + segmented filter `All | Overdue | Next 30 days` + Standard List Page: `Buyer · Phone · Plot · Due item · Due date · Amount (PKR) · Overdue by (days) · Actions (Record payment, reminder log link)`. Overdue-by column values in `warning-700` with the number in words not needed — label column header "Overdue by (days)". **Export CSV** (Secondary) in the header actions. Empty state per §8 ("No outstanding dues").

**13.13 Reports** — left control column (240px): report switcher (radio list: **Cash flow** / **Income statement**) + date range (preset chips: This month · Last month · This quarter · Custom range) + **Run report** (Primary) + **Print report** (Secondary). Right: report output as bordered table with section subtotal rows (weight 600, top hairline double-line), `tnum` columns, "Cash basis" badge (`text-xs`, ink-500 chip) next to the report title. Print stylesheet: hide shell, black on white, repeat table headers, show company header block.

**13.14 Settings** — left sub-nav (vertical tabs): Company profile · PDF terms text · Expense categories · Reminder templates · Reminder channels · Marla conversion. Right: Form Page content per tab. Reminder channels tab includes the unconfigured-provider banner (§8) and a **Send test message** secondary action with dry-run note.

**13.15 Users** — Standard List Page (Admin only): `Name · Email · Phone · Role chip (ink tinted, non-status) · Status (Active/Inactive chip) · Actions (Edit, Reset password, Deactivate)`. Form in dialog (480px) or detail page per density; role select = radio group with PRD role descriptions as helper text.

**13.16 Audit Log** — Standard List Page: `Timestamp · User · Action chip · Entity · Summary`. Filters: date range, user, entity type, action. Rows are read-only; summary text `text-sm` with entity ref links. Newest first; no pagination beyond the standard component.

**13.17 Reminder Log** — Standard List Page: `Sent at · Buyer · Phone · Plot / Due item · Milestone (T-10…) · Channel (SMS/WhatsApp chip) · Status chip (Sent/Failed/Skipped) · Error/reason`. Failed rows: `danger-600` reason text in the last column. Header includes the "N sends failed in last 24h" banner when applicable.

---

## 14. Print Styles (Reports, Payment Schedule context)

- Print output: white background, black text, no shell (nav/top bar hidden), company header block (name, logo, report title, date range, "Cash basis" where applicable), tables with full borders and repeated `<thead>`, page numbers in footer, `text-sm` (10pt) minimum.
- `DD-MMM-YYYY` dates and `PKR` money formats unchanged in print. Status chips print as text labels (no color dependence in grayscale — chips already carry text+icon per §4.1).

---

## 15. Design Token Summary (quick reference)

| Group | Tokens |
|---|---|
| Color | neutrals `ink-900/700/500/400 · line · surface-sunken · surface · surface-hover`; brand `primary-50/100/600/700/900`; semantic `danger-600/50 · success-700/50 · warning-700/50`; status set §4.1 |
| Type | `text-title 24 · text-h1 20 · text-h2 16 · text-body 14 · text-sm 13 · text-xs 12 · text-kpi 28`; Inter + Noto Sans Arabic; `tnum` on all figures |
| Space | `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`; page padding 24 (16 tablet) |
| Radius | `sm 4 · md 6 · full 999` |
| Elevation | `0` border-only · `1` menus · `2` dialogs/drawers |
| Shell | top bar 56 · sidebar 240 (rail 64) · page header 64+ · drawer 400 (tablet 360) · form column 720 |
| Table | header 36 · row 40 · cell padding `12px 16px` |
| Motion | ≤ 200ms `ease-out`; functional only; honor `prefers-reduced-motion` |
| Breakpoints | ≥1280 desktop · 1024–1279 rail · 768–1023 tablet · <768 unsupported |

---

## 16. Boundaries (explicitly not designed in this MVP)

Dark mode · print-complex booklets (allotment letter layout beyond the company-header/terms/text-block structure defined by PRD) · phone layouts · RTL mirroring · Nastaliq default · animations on numbers · custom themes/white-label · drag-and-drop plot editing beyond the polygon tools in §5.5.

*End of document.*
