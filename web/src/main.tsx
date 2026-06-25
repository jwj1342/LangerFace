import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("React root element #root was not found");

createRoot(root).render(
  <BrowserRouter basename="/app">
    <App />
  </BrowserRouter>,
);
