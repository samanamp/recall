-- Review log: source of truth for all scheduling state.
CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,   -- ULID, generated on device
  card_id     TEXT NOT NULL,
  rating      INTEGER NOT NULL,   -- 1 Again | 2 Hard | 3 Good | 4 Easy
  reviewed_at INTEGER NOT NULL,   -- epoch ms
  device_id   TEXT NOT NULL
);
CREATE INDEX idx_reviews_card ON reviews(card_id, reviewed_at);
CREATE INDEX idx_reviews_time ON reviews(reviewed_at);

-- Derived FSRS state per card; rebuildable by replaying reviews.
CREATE TABLE card_state (
  card_id    TEXT PRIMARY KEY,
  due        INTEGER NOT NULL,
  stability  REAL,
  difficulty REAL,
  state      INTEGER,             -- 0 new | 1 learning | 2 review | 3 relearning
  reps       INTEGER,
  lapses     INTEGER,
  fsrs_json  TEXT,                -- full ts-fsrs Card, so clients adopt state losslessly
  updated_at INTEGER NOT NULL
);
