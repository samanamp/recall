/**
 * Stable colour per deck — same name, same slot, on every device.
 *
 * The slot picks one of eight CSS custom properties (`--deck-0` … `--deck-7`,
 * defined in index.css): eight evenly spaced hues starting at the active
 * accent's, at one lightness and chroma, so decks are easy to tell apart and
 * the set still follows the chosen theme and light/dark mode.
 * Returns a CSS value usable in inline styles.
 */
export const DECK_SLOTS = 8;

export function deckSlot(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // Mix the high bits down: with a power-of-two slot count, the plain hash
  // would pick the slot from little more than the name's last characters.
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) % DECK_SLOTS; // >>> 0: the xors above leave a signed int
}

export function deckColor(name: string): string {
  return `var(--deck-${deckSlot(name)})`;
}
