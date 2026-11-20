CREATE TABLE "review_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"reason" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_version" text NOT NULL,
	"input_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_proposals" ADD CONSTRAINT "review_proposals_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_proposals_link_uq" ON "review_proposals" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "review_proposals_queue_idx" ON "review_proposals" USING btree ("status","updated_at","id");