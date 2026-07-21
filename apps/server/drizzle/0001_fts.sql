-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE links ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || url || ' ' || note)) STORED;
CREATE INDEX links_search_idx ON links USING GIN (search_tsv);