/**
 * Stable accent color per deck — same name, same hue, on every device.
 * Curated palette (not raw hue rotation) so neighbors stay distinguishable
 * and everything works on both themes.
 */
const PALETTE = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#d946ef", // fuchsia
  "#f97316", // orange
  "#14b8a6", // teal
];

export function deckColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
