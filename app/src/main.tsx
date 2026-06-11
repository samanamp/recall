import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { startAutoSync } from "./lib/sync";
import { applyTheme, watchSystemTheme } from "./lib/theme";

applyTheme();
watchSystemTheme();
startAutoSync(); // immediate sync + focus/online/visibility/heartbeat triggers

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
