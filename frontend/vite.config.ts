import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the Django API runs separately; in production Django
    // serves the built app and the API from one origin.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // MapLibre is one ~1 MB module; it is split out and only loaded by the planner route.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/maplibre-gl") ? "maplibre" : undefined),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
