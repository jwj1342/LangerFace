import { resolve } from "node:path";
import { cpSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.task"],
  plugins: [
    tailwindcss(),
    {
      name: "copy-runtime-assets",
      writeBundle(options) {
        cpSync(
          resolve(import.meta.dirname, "assets"),
          resolve(options.dir || "dist", "assets"),
          { recursive: true },
        );
      },
    },
    {
      name: "copy-compat-entrypoints",
      writeBundle(options) {
        const outDir = options.dir || "dist";
        for (const page of ["index.html", "annotate.html", "surgery.html", "incision_agent.html"]) {
          cpSync(resolve(import.meta.dirname, page), resolve(outDir, page));
        }
      },
    },
  ],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "app/index.html"),
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
