-- 0005_sql_checks — all 48 CHECK constraints (DATABASE.md §6.3)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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
