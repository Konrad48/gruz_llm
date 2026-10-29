import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useGarage } from "./store";
import "./style.css";

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const { theme } = useGarage.getState();
  const dark = theme === "dark" || (theme === "system" && systemTheme.matches);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#171e19" : "#fafbf8");
}
applyTheme();
systemTheme.addEventListener("change", applyTheme);
useGarage.subscribe((state, previous) => {
  if (state.theme !== previous.theme) applyTheme();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
