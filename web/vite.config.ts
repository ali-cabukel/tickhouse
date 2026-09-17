import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /graphql (HTTP + WebSocket) to the API, so the browser never hits CORS.
const target = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/graphql": { target, ws: true, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { "/graphql": { target, ws: true, changeOrigin: true } },
  },
});
