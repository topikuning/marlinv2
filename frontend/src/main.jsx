import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "@/App";
import "@/index.css";
import "leaflet/dist/leaflet.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontSize: "13px",
            fontFamily: "Inter, system-ui, sans-serif",
            padding: "10px 14px",
            borderRadius: "10px",
            background: "#1f2630",
            color: "#fff",
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
