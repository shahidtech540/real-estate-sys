-- 0007_sql_updated_at — updated_at trigger and its 14 tables (DATABASE.md §6.5)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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
