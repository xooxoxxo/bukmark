CREATE TABLE IF NOT EXISTS "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid,
	"text" text NOT NULL,
	"text_key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_url" text NOT NULL,
	"source_title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotes" ADD CONSTRAINT "quotes_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_link_idx" ON "quotes" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_link_text_key_uq" ON "quotes" USING btree ("link_id","text_key") WHERE "quotes"."link_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_created_at_idx" ON "quotes" USING btree ("created_at" DESC,"id");--> statement-breakpoint
-- Not expressible in schema.ts (same as links.search_tsv in 0001/0007).
ALTER TABLE "quotes" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "text" || ' ' || "note")) STORED;--> statement-breakpoint
CREATE INDEX "quotes_search_tsv_idx" ON "quotes" USING GIN ("search_tsv");
