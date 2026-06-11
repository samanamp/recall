import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { syncAll } from "./lib/sync";
import { applyTheme, watchSystemTheme } from "./lib/theme";

applyTheme();
watchSystemTheme();
void syncAll(); // kick off before React mounts — don't wait for effects

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
