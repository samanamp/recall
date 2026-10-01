export type Theme = "dark" | "light" | "system";
export type ColorTheme = "sky" | "terminal" | "amber" | "violet" | "rose";

export const COLOR_THEMES: ReadonlyArray<{
  id: ColorTheme;
  label: string;
  description: string;
  /** The theme's header-rule colour (light, dark) — for previews in Settings. */
  swatch: string;
  swatchDark: string;
}> = [
  { id: "sky", label: "Sky", description: "Default", swatch: "#0ea5e9", swatchDark: "#38bdf8" },
  { id: "terminal", label: "Matrix", description: "Terminal", swatch: "#00b85c", swatchDark: "#00e676" },
  { id: "amber", label: "Amber", description: "Warm", swatch: "#f59e0b", swatchDark: "#fbbf24" },
  { id: "violet", label: "Violet", description: "Modern", swatch: "#8b5cf6", swatchDark: "#a78bfa" },
  { id: "rose", label: "Rose", description: "Bold", swatch: "#f43f5e", swatchDark: "#fb7185" },
];

/** Desk colours (index.css --desk), mirrored into <meta name="theme-color">. */
const DESK = { light: "#f2f4f7", dark: "#101318" } as const;

/** Theme lives in localStorage (not IndexedDB) so it applies before any async work. */
export function getTheme(): Theme {
  return (localStorage.getItem("theme") as Theme) || "system";
}

export function setTheme(theme: Theme): void {
  localStorage.setItem("theme", theme);
  applyTheme();
}

export function getColorTheme(): ColorTheme {
  const saved = localStorage.getItem("colorTheme");
  return COLOR_THEMES.some(({ id }) => id === saved) ? (saved as ColorTheme) : "sky";
}

export function setColorTheme(theme: ColorTheme): void {
  localStorage.setItem("colorTheme", theme);
  applyColorTheme();
}

export function applyColorTheme(): void {
  document.documentElement.dataset.accentTheme = getColorTheme();
}

export function applyTheme(): void {
  const theme = getTheme();
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? DESK.dark : DESK.light);
  applyColorTheme();
}

export function watchSystemTheme(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}
