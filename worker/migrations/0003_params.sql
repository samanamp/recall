-- FSRS scheduling parameters. Single row; authoritative for both the
-- worker's replay and (delivered via /sync) every device's scheduler.
CREATE TABLE params (
  k          INTEGER PRIMARY KEY CHECK (k = 1),
  retention  REAL NOT NULL DEFAULT 0.9,  -- desired retention (0.8-0.97)
  weights    TEXT,                        -- JSON number[] from the optimizer; NULL = FSRS defaults
  updated_at INTEGER NOT NULL
);
INSERT INTO params (k, retention, weights, updated_at) VALUES (1, 0.9, NULL, 0);
