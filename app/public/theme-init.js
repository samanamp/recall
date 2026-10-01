// Pre-paint theme guard: runs before the app bundle so dark-mode cold loads
// never flash white. External (not inline) so the CSP can keep script-src 'self'.
try {
  var t = localStorage.getItem("theme");
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark");
  root.dataset.accentTheme = localStorage.getItem("colorTheme") || "sky";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#101318" : "#f2f4f7");
} catch (e) {}
