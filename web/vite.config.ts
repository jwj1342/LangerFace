import { resolve } from "node:path";
import { cpSync, readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

function shouldServeSpaIndex(url = "") {
  const pathname = url.split("?")[0] || "";
  if (pathname === "/") return true;
  if (pathname.startsWith("/assets/")) return false;
  if (pathname === "/app") return true;
  if (pathname.startsWith("/app/assets/")) return false;
  if (pathname.startsWith("/app/")) return !/\.[^/]+$/.test(pathname);
  if (
    pathname === "/live"
    || pathname === "/incision"
    || pathname === "/annotate"
    || pathname === "/personalized"
    || pathname === "/surgery"
    || pathname === "/v6-review"
    || pathname === "/current"
    || pathname.startsWith("/current/")
    || pathname.startsWith("/settings/")
  ) {
    return true;
  }
  return false;
}

export default defineConfig({
  base: "/",
  assetsInclude: ["**/*.task"],
  plugins: [
    tailwindcss(),
    {
      name: "app-spa-history-fallback",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!shouldServeSpaIndex(req.url)) {
            next();
            return;
          }
          const html = readFileSync(resolve(import.meta.dirname, "index.html"), "utf8");
          const transformed = await server.transformIndexHtml(req.url || "/", html);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(transformed);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!shouldServeSpaIndex(req.url)) {
            next();
            return;
          }
          const html = readFileSync(resolve(import.meta.dirname, "dist/index.html"), "utf8");
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
        });
      },
    },
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
        for (const page of ["annotate.html", "surgery.html", "incision_workflow.html", "incision_agent.html"]) {
          cpSync(resolve(import.meta.dirname, page), resolve(outDir, page));
        }
      },
    },
  ],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        wrinkleRstlExperiment: resolve(
          import.meta.dirname, "compat/personalized/wrinkle_rstl_experiment.html",
        ),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    allowedHosts: ["desktop-dt8rar6.tail505a98.ts.net"],
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
  },
});
