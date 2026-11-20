CREATE TABLE "azuk_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"connection" text NOT NULL,
	"list_id" uuid NOT NULL,
	"list_name" text NOT NULL,
	"listing_url" text NOT NULL,
	"product_name" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"item_id" uuid,
	"watch_id" uuid,
	"watch" jsonb,
	"error" text,
	"pending_step" text,
	"claim" uuid,
	"claim_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "azuk_deliveries_destination_uq" ON "azuk_deliveries" USING btree ("connection","list_id","listing_url");--> statement-breakpoint
CREATE INDEX "azuk_deliveries_queue_idx" ON "azuk_deliveries" USING btree ("connection","status","updated_at");