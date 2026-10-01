/**
 * Stable colour per deck — same name, same slot, on every device.
 *
 * The slot picks one of six CSS custom properties (`--deck-0` … `--deck-5`,
 * defined in index.css) that rotate around the active accent's hue, so deck
 * colours always harmonise with the chosen theme and follow light/dark mode.
 * Returns a CSS value usable in inline styles.
 */
export const DECK_SLOTS = 6;

export function deckSlot(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % DECK_SLOTS;
}

export function deckColor(name: string): string {
  return `var(--deck-${deckSlot(name)})`;
}
