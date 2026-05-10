import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Local dev: proxy /api to the locally-running Worker at :8787 so the
      // frontend can call relative URLs both in dev and in prod (Pages
      // routes /api/* to the Worker).
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
