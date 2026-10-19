-- 0004_sql_unique_indexes — idempotency, singleton, linked-payment, claim and category uniques (DATABASE.md §6.2)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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
