import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Local dev: vite serves the app, `wrangler dev` serves the API on :8787.
  server: { proxy: { "/api": "http://localhost:8787" } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // The .apkg importer's SQLite wasm is 660 kB and used at most once per
      // user — fetch it on demand instead of precaching it on every device.
      // Fonts are precached too, so card typography (Literata) and KaTeX
      // render the same offline.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
        globIgnores: ["**/sql-wasm-*.wasm"],
      },
      manifest: {
        name: "recall",
        short_name: "recall",
        description: "Markdown flashcards with FSRS spaced repetition",
        theme_color: "#101318",
        background_color: "#101318",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
});
