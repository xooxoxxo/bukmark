CREATE TABLE IF NOT EXISTS "deleted_hashes" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "og_fetched_at" timestamp with time zone;