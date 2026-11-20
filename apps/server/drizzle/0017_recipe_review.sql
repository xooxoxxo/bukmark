CREATE TABLE "recipe_draft_sources" (
	"draft_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	CONSTRAINT "recipe_draft_sources_draft_id_link_id_pk" PRIMARY KEY("draft_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"selected_variations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_unassigned" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"request_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_draft_sources" ADD CONSTRAINT "recipe_draft_sources_draft_id_recipe_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."recipe_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_draft_sources" ADD CONSTRAINT "recipe_draft_sources_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_draft_sources_link_idx" ON "recipe_draft_sources" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_drafts_key_uq" ON "recipe_drafts" USING btree ("key");--> statement-breakpoint
CREATE INDEX "recipe_drafts_queue_idx" ON "recipe_drafts" USING btree ("updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_exports_revision_uq" ON "recipe_exports" USING btree ("draft_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_exports_request_key_uq" ON "recipe_exports" USING btree ("request_key");