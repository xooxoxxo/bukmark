CREATE TABLE "sift_application_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest" text NOT NULL,
	"run_id" uuid NOT NULL,
	"run_digest" text NOT NULL,
	"target" jsonb,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sift_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preview_id" uuid NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sift_decisions" ALTER COLUMN "baseline_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sift_decisions" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "sift_application_previews" ADD CONSTRAINT "sift_application_previews_run_id_sift_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sift_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sift_applications" ADD CONSTRAINT "sift_applications_preview_id_sift_application_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."sift_application_previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sift_application_previews_digest_uq" ON "sift_application_previews" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "sift_applications_preview_uq" ON "sift_applications" USING btree ("preview_id");--> statement-breakpoint
ALTER TABLE "sift_decisions" ADD CONSTRAINT "sift_decisions_application_id_sift_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."sift_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sift_decisions" ADD CONSTRAINT "sift_decisions_one_approval" CHECK (num_nonnulls("sift_decisions"."baseline_id", "sift_decisions"."application_id") = 1);