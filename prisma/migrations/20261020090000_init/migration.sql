-- 0001_init — enums, 26 tables, primary keys, foreign keys,
-- Prisma-declared unique constraints and btree indexes.
-- Object set: DATABASE.md §3, §4 and §6.2. Hand-written SQL (partial indexes,
-- extra uniques, CHECKs, triggers, functions, seeds) follows in 0002–0008.

CREATE TYPE "booking_status" AS ENUM ('CONFIRMED', 'CANCELLED');
CREATE TYPE "cash_direction" AS ENUM ('IN', 'OUT');
CREATE TYPE "cash_entry_status" AS ENUM ('POSTED', 'VOIDED');
CREATE TYPE "cash_nature" AS ENUM ('INCOME', 'EXPENSE', 'OPENING');
CREATE TYPE "due_item_kind" AS ENUM ('TOKEN', 'DOWN_PAYMENT', 'INSTALLMENT');
CREATE TYPE "due_item_status" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID');
CREATE TYPE "file_kind" AS ENUM ('MASTER_PLAN', 'BUYER_PHOTO', 'COMPANY_LOGO');
CREATE TYPE "installment_frequency" AS ENUM ('MONTHLY', 'QUARTERLY');
CREATE TYPE "job_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER');
CREATE TYPE "payment_status" AS ENUM ('POSTED', 'VOIDED');
CREATE TYPE "plot_status" AS ENUM ('AVAILABLE', 'RESERVED', 'BOOKED_TOKEN', 'SOLD_CONSTRUCTED');
CREATE TYPE "plot_type" AS ENUM ('RESIDENTIAL', 'COMMERCIAL');
CREATE TYPE "preferred_language" AS ENUM ('EN', 'UR');
CREATE TYPE "reminder_channel" AS ENUM ('SMS', 'WHATSAPP');
CREATE TYPE "reminder_claim_status" AS ENUM ('SENDING', 'SENT', 'FAILED', 'ABANDONED');
CREATE TYPE "reminder_log_status" AS ENUM ('SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'SALES_AGENT', 'ACCOUNTANT');

CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "user_role" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "preferred_language" "preferred_language" NOT NULL DEFAULT 'EN',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "login_throttle" (
    "email" TEXT NOT NULL,
    "failed_count" SMALLINT NOT NULL DEFAULT 0,
    "first_failed_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),
    CONSTRAINT "login_throttle_pkey" PRIMARY KEY ("email")
);

CREATE TABLE "company" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "logo_file_id" UUID,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "pdf_terms_text" TEXT,
    "marla_sqft" DECIMAL(10,2) NOT NULL DEFAULT 225.00,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "marla_sqft" DECIMAL(10,2),
    "master_plan_file_id" UUID,
    "master_plan_width_px" INTEGER,
    "master_plan_height_px" INTEGER,
    "master_plan_uploaded_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "block" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "block_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "plot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "block_id" UUID NOT NULL,
    "plot_number" TEXT NOT NULL,
    "plot_type" "plot_type" NOT NULL DEFAULT 'RESIDENTIAL',
    "size_marla" DECIMAL(10,2) NOT NULL,
    "width_ft" DECIMAL(10,2),
    "depth_ft" DECIMAL(10,2),
    "dimensions_text" TEXT,
    "price_pkr" DECIMAL(12,2) NOT NULL,
    "status" "plot_status" NOT NULL DEFAULT 'AVAILABLE',
    "polygon" JSONB,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plot_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plot_id" UUID NOT NULL,
    "from_status" "plot_status",
    "to_status" "plot_status" NOT NULL,
    "reason" TEXT,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plot_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buyer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "father_or_husband_name" TEXT,
    "cnic" CHAR(15) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "address" TEXT,
    "photo_file_id" UUID,
    "consent_sms" BOOLEAN NOT NULL DEFAULT false,
    "consent_recorded_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    CONSTRAINT "buyer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_ref" TEXT NOT NULL,
    "plot_id" UUID NOT NULL,
    "booking_date" DATE NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'CONFIRMED',
    "sale_price_pkr" DECIMAL(12,2) NOT NULL,
    "primary_buyer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "client_request_id" UUID NOT NULL,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "token_amount" DECIMAL(12,2) NOT NULL,
    "down_payment_amount" DECIMAL(12,2) NOT NULL,
    "down_payment_due_date" DATE NOT NULL,
    "balance_amount" DECIMAL(12,2) NOT NULL,
    "installment_count" SMALLINT NOT NULL,
    "installment_base_amount" DECIMAL(12,2) NOT NULL,
    "frequency" "installment_frequency" NOT NULL,
    "first_due_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_buyer" (
    "booking_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "share_pct" DECIMAL(5,2) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_buyer_pkey" PRIMARY KEY ("booking_id", "buyer_id")
);

CREATE TABLE "booking_note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "due_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "kind" "due_item_kind" NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "label" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "due_item_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "due_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'POSTED',
    "recorded_by" UUID NOT NULL,
    "client_request_id" UUID NOT NULL,
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "due_item_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "nature" "cash_nature" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_date" DATE NOT NULL,
    "direction" "cash_direction" NOT NULL,
    "cash_category_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "linked_payment_id" UUID,
    "recorded_by" UUID NOT NULL,
    "status" "cash_entry_status" NOT NULL DEFAULT 'POSTED',
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_entry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reminder_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel" "reminder_channel" NOT NULL,
    "milestone" SMALLINT NOT NULL,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_template_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel" "reminder_channel" NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'dry-run',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "api_base_url" TEXT,
    "sender_id" TEXT,
    "secret_ciphertext" TEXT,
    "wa_template_name" TEXT,
    "wa_template_language" TEXT,
    "wa_template_variables" JSONB,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reminder_claim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "due_item_id" UUID NOT NULL,
    "milestone" SMALLINT NOT NULL,
    "channel" "reminder_channel" NOT NULL,
    "status" "reminder_claim_status" NOT NULL DEFAULT 'SENDING',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_claim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reminder_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "due_item_id" UUID NOT NULL,
    "claim_id" UUID,
    "channel" "reminder_channel" NOT NULL,
    "milestone" SMALLINT NOT NULL,
    "attempt" SMALLINT NOT NULL DEFAULT 1,
    "status" "reminder_log_status" NOT NULL,
    "reason" TEXT,
    "recipient_phone" VARCHAR(16),
    "rendered_body" TEXT,
    "provider_ref" TEXT,
    "error_message" TEXT,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_label" TEXT NOT NULL,
    "action_code" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "booking_id" UUID,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "ip" VARCHAR(45),
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "file_object" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "file_kind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "file_object_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" "job_status" NOT NULL DEFAULT 'RUNNING',
    "triggered_by" TEXT NOT NULL DEFAULT 'cron',
    "summary" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_app_user_email" ON "app_user"("email");
CREATE INDEX "ix_app_user_role_active" ON "app_user"("role", "is_active");
CREATE UNIQUE INDEX "uq_session_token_hash" ON "session"("token_hash");
CREATE INDEX "ix_session_user_id" ON "session"("user_id");
CREATE INDEX "ix_session_expiry" ON "session"("idle_expires_at", "absolute_expires_at");
CREATE INDEX "ix_login_throttle_locked_until" ON "login_throttle"("locked_until");
CREATE UNIQUE INDEX "uq_project_company_name" ON "project"("company_id", "name");
CREATE INDEX "ix_project_company_active" ON "project"("company_id", "is_active");
CREATE UNIQUE INDEX "uq_block_project_code" ON "block"("project_id", "code");
CREATE INDEX "ix_block_project_id" ON "block"("project_id");
CREATE UNIQUE INDEX "uq_plot_project_number" ON "plot"("project_id", "plot_number");
CREATE INDEX "ix_plot_project_status" ON "plot"("project_id", "status");
CREATE INDEX "ix_plot_block" ON "plot"("block_id");
CREATE INDEX "ix_plot_project_active" ON "plot"("project_id", "is_active");
CREATE INDEX "ix_plot_status_history_plot" ON "plot_status_history"("plot_id", "occurred_at" DESC);
CREATE UNIQUE INDEX "uq_buyer_cnic" ON "buyer"("cnic");
CREATE INDEX "ix_buyer_phone" ON "buyer"("phone");
CREATE UNIQUE INDEX "uq_booking_ref" ON "booking"("booking_ref");
CREATE INDEX "ix_booking_plot" ON "booking"("plot_id");
CREATE INDEX "ix_booking_status_date" ON "booking"("status", "booking_date" DESC);
CREATE INDEX "ix_booking_created_by" ON "booking"("created_by", "created_at" DESC);
CREATE INDEX "ix_booking_primary_buyer" ON "booking"("primary_buyer_id");
CREATE UNIQUE INDEX "uq_payment_plan_booking" ON "payment_plan"("booking_id");
CREATE INDEX "ix_booking_buyer_buyer" ON "booking_buyer"("buyer_id");
CREATE INDEX "ix_booking_note_booking" ON "booking_note"("booking_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_due_item_booking_sequence" ON "due_item"("booking_id", "sequence");
CREATE INDEX "ix_payment_booking" ON "payment"("booking_id", "paid_on" DESC, "id" DESC);
CREATE INDEX "ix_payment_status_date" ON "payment"("status", "paid_on");
CREATE INDEX "ix_payment_recorded_by" ON "payment"("recorded_by", "created_at" DESC);
CREATE UNIQUE INDEX "uq_allocation_pair" ON "payment_allocation"("payment_id", "due_item_id");
CREATE INDEX "ix_allocation_due_item" ON "payment_allocation"("due_item_id");
CREATE INDEX "ix_cash_category_active" ON "cash_category"("is_active", "nature");
CREATE INDEX "ix_cash_entry_date" ON "cash_entry"("entry_date", "id");
CREATE INDEX "ix_cash_entry_category" ON "cash_entry"("cash_category_id", "entry_date");
CREATE INDEX "ix_cash_entry_status" ON "cash_entry"("status", "entry_date");
CREATE UNIQUE INDEX "uq_reminder_template_channel_milestone" ON "reminder_template"("channel", "milestone");
CREATE UNIQUE INDEX "uq_provider_config_channel" ON "provider_config"("channel");
CREATE INDEX "ix_reminder_log_due_item" ON "reminder_log"("due_item_id", "attempted_at" DESC);
CREATE INDEX "ix_reminder_log_status_time" ON "reminder_log"("status", "attempted_at" DESC);
CREATE INDEX "ix_audit_log_time" ON "audit_log"("occurred_at" DESC, "id" DESC);
CREATE INDEX "ix_audit_log_booking" ON "audit_log"("booking_id", "occurred_at" DESC);
CREATE INDEX "ix_audit_log_actor" ON "audit_log"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "ix_audit_log_entity" ON "audit_log"("entity_type", "entity_id", "occurred_at" DESC);
CREATE INDEX "ix_audit_log_action" ON "audit_log"("action_code", "occurred_at" DESC);
CREATE UNIQUE INDEX "uq_file_object_storage_key" ON "file_object"("storage_key");
CREATE INDEX "ix_file_object_kind" ON "file_object"("kind", "created_at" DESC);
CREATE INDEX "ix_job_run_name_time" ON "job_run"("job_name", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company" ADD CONSTRAINT "company_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "file_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_master_plan_file_id_fkey" FOREIGN KEY ("master_plan_file_id") REFERENCES "file_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "block" ADD CONSTRAINT "block_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plot" ADD CONSTRAINT "plot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plot" ADD CONSTRAINT "plot_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plot_status_history" ADD CONSTRAINT "plot_status_history_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plot_status_history" ADD CONSTRAINT "plot_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "file_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_primary_buyer_id_fkey" FOREIGN KEY ("primary_buyer_id") REFERENCES "buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_buyer" ADD CONSTRAINT "booking_buyer_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_buyer" ADD CONSTRAINT "booking_buyer_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_note" ADD CONSTRAINT "booking_note_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_note" ADD CONSTRAINT "booking_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "due_item" ADD CONSTRAINT "due_item_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_due_item_id_fkey" FOREIGN KEY ("due_item_id") REFERENCES "due_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_entry" ADD CONSTRAINT "cash_entry_cash_category_id_fkey" FOREIGN KEY ("cash_category_id") REFERENCES "cash_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_entry" ADD CONSTRAINT "cash_entry_linked_payment_id_fkey" FOREIGN KEY ("linked_payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_entry" ADD CONSTRAINT "cash_entry_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_entry" ADD CONSTRAINT "cash_entry_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reminder_template" ADD CONSTRAINT "reminder_template_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_config" ADD CONSTRAINT "provider_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reminder_claim" ADD CONSTRAINT "reminder_claim_due_item_id_fkey" FOREIGN KEY ("due_item_id") REFERENCES "due_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_due_item_id_fkey" FOREIGN KEY ("due_item_id") REFERENCES "due_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "reminder_claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
