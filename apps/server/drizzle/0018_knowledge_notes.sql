CREATE TABLE "knowledge_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"draft_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid,
	"saved_url" text NOT NULL,
	"fields" jsonb NOT NULL,
	"evidence" jsonb,
	"mismatch" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_revision" integer DEFAULT 0 NOT NULL,
	"latest_export_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_notes" ADD CONSTRAINT "knowledge_notes_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_exports_revision_uq" ON "knowledge_exports" USING btree ("note_id","draft_revision");--> statement-breakpoint
CREATE INDEX "knowledge_notes_link_idx" ON "knowledge_notes" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "knowledge_notes_queue_idx" ON "knowledge_notes" USING btree ("updated_at","id");