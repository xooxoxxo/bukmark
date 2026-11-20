CREATE TABLE "builder_draft_sources" (
	"draft_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	CONSTRAINT "builder_draft_sources_draft_id_link_id_pk" PRIMARY KEY("draft_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "builder_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"record" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"revisions" jsonb NOT NULL,
	"records" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builder_draft_sources" ADD CONSTRAINT "builder_draft_sources_draft_id_builder_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."builder_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_draft_sources" ADD CONSTRAINT "builder_draft_sources_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builder_draft_sources_link_idx" ON "builder_draft_sources" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_drafts_key_uq" ON "builder_drafts" USING btree ("key");--> statement-breakpoint
CREATE INDEX "builder_drafts_queue_idx" ON "builder_drafts" USING btree ("updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_exports_key_uq" ON "builder_exports" USING btree ("key");