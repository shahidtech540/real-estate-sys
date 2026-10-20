-- 0003_sql_partial_indexes — booking guards and partial scan indexes (DATABASE.md §6.1)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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
