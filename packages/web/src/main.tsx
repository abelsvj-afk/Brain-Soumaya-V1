import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./index.css";

// Note: no StrictMode — the 3D scene does one-time imperative setup (bloom,
// starfield, render loop) that double-invocation would duplicate.
createRoot(document.getElementById("root")!).render(<App />);
