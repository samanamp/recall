export type Theme = "dark" | "light" | "system";
export type ColorTheme = "sky" | "terminal" | "amber" | "violet" | "rose";

export const COLOR_THEMES: ReadonlyArray<{
  id: ColorTheme;
  label: string;
  description: string;
  swatch: string;
}> = [
  { id: "sky", label: "Sky", description: "Current", swatch: "#0ea5e9" },
  { id: "terminal", label: "Matrix", description: "Terminal", swatch: "#00e676" },
  { id: "amber", label: "Amber", description: "Warm", swatch: "#f59e0b" },
  { id: "violet", label: "Violet", description: "Modern", swatch: "#8b5cf6" },
  { id: "rose", label: "Rose", description: "Bold", swatch: "#f43f5e" },
];

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
  applyColorTheme();
}

export function watchSystemTheme(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}
