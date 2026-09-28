-- Full-text search reaches the page's own text. Title, URL and note weigh
-- most (A); the page text (D) finds what the title never said.
DROP INDEX IF EXISTS links_search_idx;--> statement-breakpoint
ALTER TABLE links DROP COLUMN search_tsv;--> statement-breakpoint
ALTER TABLE links ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', title || ' ' || url || ' ' || note), 'A') ||
    setweight(to_tsvector('simple', coalesce(content_text, '')), 'D')
  ) STORED;--> statement-breakpoint
CREATE INDEX links_search_idx ON links USING GIN (search_tsv);
