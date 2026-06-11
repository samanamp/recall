export type Theme = "dark" | "light" | "system";

/** Theme lives in localStorage (not IndexedDB) so it applies before any async work. */
export function getTheme(): Theme {
  return (localStorage.getItem("theme") as Theme) || "system";
}

export function setTheme(theme: Theme): void {
  localStorage.setItem("theme", theme);
  applyTheme();
}

export function applyTheme(): void {
  const theme = getTheme();
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function watchSystemTheme(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}
