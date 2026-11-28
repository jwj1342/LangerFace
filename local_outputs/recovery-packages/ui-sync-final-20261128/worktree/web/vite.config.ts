import { resolve } from "node:path";
import { cpSync, readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

import { localWrinkleV10Plugin } from "./dev/localWrinkleV10Plugin.ts";
import { localExportDownloadPlugin } from "./dev/localExportDownloadPlugin.ts";
import {
  markerRuntimeIdentityBuildPlugin,
  markerRuntimeIdentityPlugin,
} from "./dev/markerRuntimeIdentityPlugin.ts";

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

// The public HF host redirects large LFS modules to a CDN. Their JS imports
// must still resolve against the original app origin after that redirect.
function staticOpenCvImports(): Plugin {
  const configuredOrigin = process.env.LANGERFACE_STATIC_ORIGIN;
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : null;
  return {
    name: "static-opencv-imports",
    apply: "build",
    renderChunk: {
      order: "post",
      handler(code, chunk) {
        if (!origin || !chunk.moduleIds.some((id) =>
          id.replaceAll("\\", "/").endsWith("/@techstark/opencv-js/dist/opencv.js")
        )) return null;
        return code.replace(
          /(\bfrom\s*["'])(\.\/[^"']+)(["'])/g,
          (_match, start: string, path: string, end: string) =>
            start + origin + "/" + chunk.fileName.slice(0, chunk.fileName.lastIndexOf("/") + 1) + path.slice(2) + end,
        );
      },
    },
  };
}

export default defineConfig({
  base: "/",
  assetsInclude: ["**/*.task"],
  // Keep the worker entry small enough to be served from the app origin.
  worker: { format: "es", plugins: () => [staticOpenCvImports()] },
  plugins: [
    staticOpenCvImports(),
    tailwindcss(),
    localExportDownloadPlugin(),
    localWrinkleV10Plugin(),
    markerRuntimeIdentityPlugin(),
    markerRuntimeIdentityBuildPlugin(),
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
    fs: {
      allow: [resolve(import.meta.dirname, "..")],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
  },
});
