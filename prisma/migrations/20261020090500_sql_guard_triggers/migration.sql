-- 0006_sql_guard_triggers — append-only and immutability triggers (DATABASE.md §6.4)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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
