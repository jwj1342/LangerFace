import { createHmac, randomUUID } from "node:crypto";

const HEALTH_TIMEOUT_MS = 5_000;
const TICKET_TTL_SECONDS = 90;
const MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024;
const TICKET_AUDIENCE = "langerface-wrinkle-v10";

export const config = { maxDuration: 10 };

function configuration() {
  const baseUrl = String(process.env.WRINKLE_V10_SERVICE_URL || "").replace(/\/$/, "");
  const ticketSecret = String(process.env.WRINKLE_V10_TICKET_SECRET || "");
  const allowedOrigins = String(process.env.WRINKLE_V10_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!baseUrl || !ticketSecret) throw new Error("V10 远程服务或短期授权尚未配置");
  return { baseUrl, ticketSecret, allowedOrigins };
}

function firstHeader(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function requestOrigin(request, allowedOrigins) {
  const protocol = firstHeader(request, "x-forwarded-proto") || "https";
  const host = firstHeader(request, "x-forwarded-host") || firstHeader(request, "host");
  const fallback = host ? `${protocol}://${host}` : "";
  const supplied = firstHeader(request, "origin").replace(/\/$/, "");
  const origin = supplied || fallback;
  if (!origin || (allowedOrigins.length && !allowedOrigins.includes(origin))) {
    throw Object.assign(new Error("当前网页来源没有 V10 使用权限"), { statusCode: 403 });
  }
  return origin;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function clientSubject(request, secret) {
  const address = firstHeader(request, "x-forwarded-for") || "unknown";
  const userAgent = firstHeader(request, "user-agent") || "unknown";
  return createHmac("sha256", secret).update(`${address}\n${userAgent}`).digest("base64url");
}

export function issueDetectionTicket(request, origin, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = nowSeconds + TICKET_TTL_SECONDS;
  const payload = {
    v: 1,
    aud: TICKET_AUDIENCE,
    scope: "detect",
    sub: clientSubject(request, secret),
    origin,
    iat: nowSeconds,
    exp: expiresAt,
    jti: randomUUID(),
    maxBytes: MAXIMUM_REQUEST_BYTES,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt };
}

async function healthCapability(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw Object.assign(new Error(payload?.error || `V10 服务健康检查返回 HTTP ${response.status}`), {
        statusCode: 503,
      });
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("V10 远程服务健康检查超时"), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.status(405).json({
        error: "V10 图像必须使用短期授权直接发送到检测服务",
      });
      return;
    }
    const { baseUrl, ticketSecret, allowedOrigins } = configuration();
    const origin = requestOrigin(request, allowedOrigins);
    const capability = await healthCapability(baseUrl);
    const ticket = issueDetectionTicket(request, origin, ticketSecret);
    response.status(200).json({
      ...capability,
      directDetectUrl: `${baseUrl}/v1/detect`,
      accessToken: ticket.token,
      expiresAt: ticket.expiresAt,
      maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
    });
  } catch (error) {
    response.status(Number(error?.statusCode) || 502).json({
      error: error instanceof Error ? error.message : "V10 远程服务不可用",
    });
  }
}
