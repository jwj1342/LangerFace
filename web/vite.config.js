import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.task"],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        annotate: resolve(import.meta.dirname, "annotate.html"),
        surgery: resolve(import.meta.dirname, "surgery.html"),
        incisionAgent: resolve(import.meta.dirname, "incision_agent.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
  },
});
