-- Cached repo manifest: served instantly, revalidated against GitHub in the
-- background (stale-while-revalidate) and patched in place on every write
-- this worker makes. Single row.
CREATE TABLE manifest_cache (
  k          INTEGER PRIMARY KEY CHECK (k = 1),
  json       TEXT NOT NULL,       -- [{path, sha}, ...]
  fetched_at INTEGER NOT NULL     -- epoch ms of last GitHub fetch
);
