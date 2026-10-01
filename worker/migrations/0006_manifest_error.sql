-- Background manifest refreshes run in waitUntil, where a thrown error used to
-- vanish. Keep the most recent failure here (NULL once a refresh succeeds) so
-- "my GitHub edits stopped syncing" is diagnosable with one D1 query.
ALTER TABLE manifest_cache ADD COLUMN last_error TEXT;
