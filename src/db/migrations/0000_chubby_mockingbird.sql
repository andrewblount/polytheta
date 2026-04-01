CREATE TYPE "public"."basket_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."performance_confidence" AS ENUM('Actual', 'Estimated', 'Expiry-Resolved');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('call', 'put');--> statement-breakpoint
CREATE TYPE "public"."position_state" AS ENUM('safe', 'approaching-strike', 'breached', 'expired-otm', 'expired-itm', 'manually-closed');--> statement-breakpoint
CREATE TYPE "public"."rule_category" AS ENUM('hard-stop', 'profit-target', 'protocol', 'note');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"message" text,
	"status" varchar(24) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_identity_user_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basket_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"total_names" integer NOT NULL,
	"call_count" integer NOT NULL,
	"put_count" integer NOT NULL,
	"total_margin" integer NOT NULL,
	"cash_needed" integer NOT NULL,
	"total_estimated_credit" integer NOT NULL,
	"daily_theta" integer NOT NULL,
	"concentration_note" text NOT NULL,
	"gsrs_constraint_note" text NOT NULL,
	"other_metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basket_metrics_basket_id_unique" UNIQUE("basket_id")
);
--> statement-breakpoint
CREATE TABLE "basket_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"category" "rule_category" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" varchar(180) NOT NULL,
	"week_of" date NOT NULL,
	"publication_date" timestamp with time zone,
	"status" "basket_status" DEFAULT 'draft' NOT NULL,
	"gsrs" numeric(5, 2) NOT NULL,
	"radar_status" text NOT NULL,
	"cash_needed" integer NOT NULL,
	"disclaimer" text NOT NULL,
	"quick_summary" jsonb,
	"commentary" text,
	"admin_notes" text,
	"created_by_identity_user_id" text,
	"published_by_identity_user_id" text,
	"last_refresh_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_order_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"broker" varchar(32) NOT NULL,
	"side" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"order_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"override_type" varchar(40) NOT NULL,
	"actual_fill_credit" numeric(10, 2),
	"actual_close_value" numeric(10, 2),
	"actual_exit_credit" numeric(10, 2),
	"actual_close_date" date,
	"note" text,
	"created_by_identity_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"gsrs_note" text NOT NULL,
	"vix" numeric(8, 2) NOT NULL,
	"skew" numeric(8, 2) NOT NULL,
	"hy_oas" numeric(8, 2) NOT NULL,
	"move" numeric(8, 2) NOT NULL,
	"put_call_ratio" numeric(8, 2) NOT NULL,
	"acquisition_radar_status" text NOT NULL,
	"downside_gap_radar_status" text NOT NULL,
	"narrative" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_conditions_basket_id_unique" UNIQUE("basket_id")
);
--> statement-breakpoint
CREATE TABLE "performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"underlying_price" numeric(10, 2) NOT NULL,
	"option_mark" numeric(10, 2),
	"estimated_option_value" numeric(10, 2),
	"implied_volatility" numeric(10, 4),
	"confidence" "performance_confidence" NOT NULL,
	"state" "position_state" NOT NULL,
	"underlying_move_pct" numeric(10, 4) NOT NULL,
	"distance_to_strike" numeric(10, 4) NOT NULL,
	"safety_buffer_pct" numeric(10, 4) NOT NULL,
	"days_to_expiry" integer NOT NULL,
	"credit_capture_pct" numeric(10, 4) NOT NULL,
	"pnl_amount" numeric(14, 2) NOT NULL,
	"pnl_percent" numeric(10, 4) NOT NULL,
	"source_label" text NOT NULL,
	"source_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"position_id" uuid,
	"ticker" varchar(16) NOT NULL,
	"side" "position_side" NOT NULL,
	"label" text NOT NULL,
	"threshold_value" numeric(10, 2) NOT NULL,
	"protocol_note" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"side" "position_side" NOT NULL,
	"ticker" varchar(16) NOT NULL,
	"company_name" text,
	"sector" text,
	"entry_underlying_price" numeric(10, 2) NOT NULL,
	"iv_rank" numeric(8, 2) NOT NULL,
	"short_interest_pct_float" numeric(8, 2) NOT NULL,
	"fan_score" numeric(8, 2) NOT NULL,
	"glassdoor_score" numeric(8, 2) NOT NULL,
	"buyback_score" integer NOT NULL,
	"strike" numeric(10, 2) NOT NULL,
	"option_type" "position_side" NOT NULL,
	"expiry" date NOT NULL,
	"delta" numeric(8, 4) NOT NULL,
	"estimated_entry_credit" numeric(10, 2) NOT NULL,
	"contracts" integer NOT NULL,
	"margin" integer NOT NULL,
	"break_alert_1" numeric(10, 2),
	"break_alert_2" numeric(10, 2),
	"atr_14d" numeric(10, 2),
	"buffer" text,
	"probability_of_touch" numeric(8, 2),
	"thesis_summary" text NOT NULL,
	"thesis_bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caution_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entry_timestamp" timestamp with time zone NOT NULL,
	"notes" text,
	"manual_close_price" numeric(10, 2),
	"manual_close_date" date,
	"actual_exit_credit" numeric(10, 2),
	"source_metadata" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"triggered_by" text,
	"positions_processed" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"level" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"position_id" uuid,
	"ticker" varchar(16) NOT NULL,
	"side" "position_side" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"weight" numeric(6, 2),
	"is_passing" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"acknowledged_risk_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_identity_user_id_unique" UNIQUE("identity_user_id")
);
--> statement-breakpoint
ALTER TABLE "basket_metrics" ADD CONSTRAINT "basket_metrics_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_rules" ADD CONSTRAINT "basket_rules_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_order_blocks" ADD CONSTRAINT "broker_order_blocks_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_conditions" ADD CONSTRAINT "market_conditions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_alerts" ADD CONSTRAINT "position_alerts_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_alerts" ADD CONSTRAINT "position_alerts_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_job_id_sync_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_signals" ADD CONSTRAINT "thesis_signals_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_signals" ADD CONSTRAINT "thesis_signals_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baskets_slug_idx" ON "baskets" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "position_observed_idx" ON "performance_snapshots" USING btree ("position_id","observed_at");