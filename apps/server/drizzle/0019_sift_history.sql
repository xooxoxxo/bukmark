CREATE TABLE "sift_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"reference" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sift_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"field" text DEFAULT 'bin' NOT NULL,
	"hub_id" uuid NOT NULL,
	"bin" text NOT NULL,
	"membership_created_at" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sift_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"input" jsonb NOT NULL,
	"rules_digest" text NOT NULL,
	"computed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sift_run_items" (
	"run_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"guard" jsonb NOT NULL,
	"guard_digest" text NOT NULL,
	CONSTRAINT "sift_run_items_run_id_link_id_pk" PRIMARY KEY("run_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "sift_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"scope_key" text NOT NULL,
	"source_ids" jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"digest" text NOT NULL,
	"previous_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sift_decisions" ADD CONSTRAINT "sift_decisions_baseline_id_sift_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."sift_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sift_run_items" ADD CONSTRAINT "sift_run_items_run_id_sift_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sift_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sift_run_items" ADD CONSTRAINT "sift_run_items_result_id_sift_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."sift_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sift_baselines_key_uq" ON "sift_baselines" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sift_decisions_source_field_uq" ON "sift_decisions" USING btree ("link_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "sift_results_key_uq" ON "sift_results" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sift_runs_key_uq" ON "sift_runs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sift_runs_history_idx" ON "sift_runs" USING btree ("created_at","id");