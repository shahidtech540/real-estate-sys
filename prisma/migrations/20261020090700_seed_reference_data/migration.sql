-- 0008_seed_reference_data — cash categories, SMS templates, dry-run provider (DATABASE.md §9.1–§9.3)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

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

INSERT INTO provider_config (id, channel, provider_name, is_enabled, is_live, updated_by)
VALUES (gen_random_uuid(), 'SMS', 'dry-run', true, false, NULL)
ON CONFLICT (channel) DO NOTHING;
