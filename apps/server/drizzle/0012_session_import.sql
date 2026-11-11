ALTER TABLE "captures" ADD COLUMN "session_occurrence_key" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "session_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "captures_session_occurrence_uq" ON "captures" USING btree ("session_occurrence_key");