import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Bryntum TaskBoard: structural CSS, one theme, FontAwesome (icons in menus and headers).
import "@bryntum/taskboard/taskboard.css";
import "@bryntum/taskboard/stockholm-light.css";
import "@bryntum/taskboard/fontawesome/css/fontawesome.css";
import "@bryntum/taskboard/fontawesome/css/solid.css";
import "./styles.css";
import "./chrome/chrome.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
