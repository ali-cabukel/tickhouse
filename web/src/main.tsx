import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "urql";
import { client } from "./client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider value={client}>
      <App />
    </Provider>
  </StrictMode>,
);
