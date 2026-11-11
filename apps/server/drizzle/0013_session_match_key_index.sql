DROP INDEX "links_match_key_idx";--> statement-breakpoint
CREATE INDEX "links_match_key_idx" ON "links" USING hash ("match_key");
