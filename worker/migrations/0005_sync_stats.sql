-- Heartbeat syncs used to run SELECT COUNT(*) over the whole reviews table
-- (D1 bills that as a full scan) just to build the change cursor. Keep a tiny
-- stats row instead: `seq` bumps on every insert/delete (cursor ingredient),
-- `review_count` replaces the COUNT(*).
CREATE TABLE sync_stats (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  seq INTEGER NOT NULL,
  review_count INTEGER NOT NULL
);
INSERT INTO sync_stats (k, seq, review_count)
SELECT 1, COALESCE(MAX(rowid), 0), COUNT(*) FROM reviews;
