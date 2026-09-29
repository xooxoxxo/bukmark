ALTER TABLE "links" ADD COLUMN "match_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "links_match_key_idx" ON "links" USING btree ("match_key");