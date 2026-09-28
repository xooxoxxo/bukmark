ALTER TABLE "links" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "http_status" integer;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "check_error" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "links_checked_at_idx" ON "links" USING btree ("checked_at");