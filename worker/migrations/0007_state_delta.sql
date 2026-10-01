-- Delta sync: clients ask for card_state changed since a watermark instead of
-- the whole table. Deleted rows (a card's only review undone) leave a
-- tombstone so a delta can still say "this card is new again".
CREATE INDEX IF NOT EXISTS idx_card_state_updated ON card_state(updated_at);
CREATE TABLE IF NOT EXISTS card_state_tombstones (
  card_id    TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_state_tombstones_deleted ON card_state_tombstones(deleted_at);
