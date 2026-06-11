-- Version counter for manifest_cache: every write bumps it, and background
-- refreshes only land if the version they read is still current (CAS).
-- Prevents a slow GitHub tree fetch from clobbering patches made meanwhile.
ALTER TABLE manifest_cache ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
