CREATE TABLE IF NOT EXISTS "link_deletions" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "link_deletions_deleted_at_idx" ON "link_deletions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "links_updated_at_idx" ON "links" USING btree ("updated_at","id");--> statement-breakpoint
-- Bookmark sync pulls every link whose updated_at is at or after its cursor,
-- so updated_at has to move whenever what a browser shows for a link changes:
-- its url, title, note or status, which hubs it is in, and those hubs' names
-- and status (an archived hub is not a folder). It must not move for page
-- checks and og:image lookups (image_url, og_fetched_at, http_status,
-- check_error, checked_at, content_text): the browser shows none of them, and
-- moving it would make every client re-pull each link after each check.
-- now() is the transaction's start, the value the app writes too, so a request
-- that changes a link in several ways leaves one timestamp.
CREATE OR REPLACE FUNCTION links_touch_on_visible_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER links_touch_on_visible_change BEFORE UPDATE ON links
  FOR EACH ROW
  WHEN ((OLD.url, OLD.title, OLD.note, OLD.status) IS DISTINCT FROM (NEW.url, NEW.title, NEW.note, NEW.status))
  EXECUTE FUNCTION links_touch_on_visible_change();--> statement-breakpoint
-- Membership: one UPDATE per statement, over the rows the statement changed.
CREATE OR REPLACE FUNCTION links_touch_in_changed_hub_links() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE links SET updated_at = now()
  WHERE id IN (SELECT link_id FROM changed) AND updated_at IS DISTINCT FROM now();
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER hub_links_touch_on_insert AFTER INSERT ON hub_links
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION links_touch_in_changed_hub_links();--> statement-breakpoint
-- Also runs when a hub is deleted: the cascade deletes its hub_links rows.
CREATE TRIGGER hub_links_touch_on_delete AFTER DELETE ON hub_links
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION links_touch_in_changed_hub_links();--> statement-breakpoint
-- An upsert that only rewrites relevance or assigned_by (POST /api/links/assign)
-- keeps every (hub, link) pair, so it touches nothing; a pair that really moved does.
CREATE OR REPLACE FUNCTION links_touch_in_moved_hub_links() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE links SET updated_at = now()
  WHERE id IN (
    SELECT link_id FROM (
      (SELECT hub_id, link_id FROM old_rows EXCEPT SELECT hub_id, link_id FROM new_rows)
      UNION
      (SELECT hub_id, link_id FROM new_rows EXCEPT SELECT hub_id, link_id FROM old_rows)
    ) moved
  ) AND updated_at IS DISTINCT FROM now();
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER hub_links_touch_on_update AFTER UPDATE ON hub_links
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION links_touch_in_moved_hub_links();--> statement-breakpoint
-- A renamed hub is a renamed folder; an archived one stops being a folder.
CREATE OR REPLACE FUNCTION links_touch_in_changed_hub() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE links SET updated_at = now()
  WHERE id IN (SELECT link_id FROM hub_links WHERE hub_id = NEW.id) AND updated_at IS DISTINCT FROM now();
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER hubs_touch_links AFTER UPDATE OF name, status ON hubs
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION links_touch_in_changed_hub();--> statement-breakpoint
-- A deleted link leaves its id behind, so a client that pulled before the
-- delete learns to drop the bookmark.
CREATE OR REPLACE FUNCTION links_log_deletions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO link_deletions (link_id) SELECT id FROM gone
  ON CONFLICT (link_id) DO UPDATE SET deleted_at = excluded.deleted_at;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER links_log_deletions AFTER DELETE ON links
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT EXECUTE FUNCTION links_log_deletions();
