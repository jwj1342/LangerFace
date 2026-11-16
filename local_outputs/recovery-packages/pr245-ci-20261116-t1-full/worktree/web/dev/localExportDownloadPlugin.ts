import { randomUUID } from "node:crypto";

import type { Plugin } from "vite";

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const EXPORT_TTL_MS = 5 * 60 * 1000;

function safeFilename(value: string | null): string {
  const decoded = value ? decodeURIComponent(value) : "langer-export.bin";
  return decoded.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "langer-export.bin";
}

export function localExportDownloadPlugin(): Plugin {
  const exports = new Map<string, { body: Buffer; type: string; filename: string; expiresAt: number }>();
  const prune = () => {
    const now = Date.now();
    for (const [token, value] of exports) if (value.expiresAt <= now) exports.delete(token);
  };
  return {
    name: "local-export-download",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname === "/__local-export" && req.method === "POST") {
          prune();
          const declared = Number(req.headers["content-length"] || 0);
          if (declared > MAX_EXPORT_BYTES) {
            res.statusCode = 413;
            res.end("export too large");
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          req.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total <= MAX_EXPORT_BYTES) chunks.push(chunk);
          });
          req.on("end", () => {
            if (!total || total > MAX_EXPORT_BYTES) {
              res.statusCode = total ? 413 : 400;
              res.end(total ? "export too large" : "empty export");
              return;
            }
            const token = randomUUID();
            exports.set(token, {
              body: Buffer.concat(chunks),
              type: String(req.headers["content-type"] || "application/octet-stream"),
              filename: safeFilename(url.searchParams.get("filename")),
              expiresAt: Date.now() + EXPORT_TTL_MS,
            });
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ download_url: `/__local-export/${token}` }));
          });
          return;
        }
        const match = /^\/__local-export\/([0-9a-f-]+)$/.exec(url.pathname);
        if (!match || req.method !== "GET") return next();
        prune();
        const value = exports.get(match[1]);
        if (!value) {
          res.statusCode = 404;
          res.end("export expired");
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        // PNG is normally displayable inline. A generic attachment gives the
        // browser download manager the decision while preserving video MIME.
        const responseType = value.type.startsWith("image/") ? "application/octet-stream" : value.type;
        res.setHeader("Content-Type", responseType);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Length", String(value.body.length));
        res.setHeader("Content-Disposition", `attachment; filename="${value.filename}"`);
        res.end(value.body);
      });
    },
  };
}
