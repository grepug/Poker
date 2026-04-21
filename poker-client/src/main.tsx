import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { getPwaDisplayModeState } from "./utils/pwa-display-mode";

const pwaDisplayModeState = getPwaDisplayModeState(window);

document.documentElement.dataset.iosStandalone = pwaDisplayModeState.isIosStandalone
  ? "true"
  : "false";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
