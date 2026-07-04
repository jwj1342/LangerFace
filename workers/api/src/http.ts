import type { Env, JsonObject } from "./types";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function configuredOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  const allowed = configuredOrigins(env);
  if (allowed.has("*") || allowed.has(origin)) return true;
  if (env.ALLOW_VERCEL_PREVIEW_ORIGINS === "true") {
    try {
      const host = new URL(origin).hostname;
      return host.endsWith(".vercel.app");
    } catch {
      return false;
    }
  }
  return false;
}

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-request-id",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin, env)) headers["access-control-allow-origin"] = origin;
  return headers;
}

export function jsonResponse(request: Request, env: Env, body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
      ...init.headers,
    },
  });
}

export function errorResponse(request: Request, env: Env, status: number, code: string, message: string) {
  return jsonResponse(request, env, { error: { code, message } }, { status });
}

export async function readJsonBody(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as JsonObject;
}

export function optionsResponse(request: Request, env: Env) {
  if (!isAllowedOrigin(request.headers.get("origin"), env)) {
    return errorResponse(request, env, 403, "origin_not_allowed", "Origin is not allowed for this API.");
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
