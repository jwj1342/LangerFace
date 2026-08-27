// The worker sends lossless RGBA pixels; 1280x1280 requires over 6 MiB.
const MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024;
const HEALTH_TIMEOUT_MS = 5_000;
const DETECTION_TIMEOUT_MS = 50_000;

export const config = { maxDuration: 60 };

function configuration() {
  const baseUrl = String(process.env.WRINKLE_V10_SERVICE_URL || "").replace(/\/$/, "");
  const token = String(process.env.WRINKLE_V10_SERVICE_TOKEN || "");
  if (!baseUrl || !token) throw new Error("V10 远程服务尚未配置");
  return { baseUrl, token };
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAXIMUM_REQUEST_BYTES) throw Object.assign(new Error("V10 请求超过 32 MB"), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function proxyFetch(url, init, timeoutMs, requestSignal) {
  const controller = new AbortController();
  const cancelForClient = () => controller.abort();
  requestSignal?.addEventListener("abort", cancelForClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("V10 远程服务响应超时"), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", cancelForClient);
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const requestController = new AbortController();
  request.once?.("aborted", () => requestController.abort());
  try {
    const { baseUrl, token } = configuration();
    if (request.method === "GET") {
      const upstream = await proxyFetch(`${baseUrl}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      }, HEALTH_TIMEOUT_MS, requestController.signal);
      const payload = Buffer.from(await upstream.arrayBuffer());
      response.status(upstream.status).setHeader("Content-Type", "application/json; charset=utf-8");
      response.send(payload);
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      response.status(405).json({ error: "Method Not Allowed" });
      return;
    }
    const body = await requestBody(request);
    const upstream = await proxyFetch(`${baseUrl}/v1/detect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        Accept: "application/json",
      },
      body,
    }, DETECTION_TIMEOUT_MS, requestController.signal);
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.status(upstream.status).setHeader("Content-Type", "application/json; charset=utf-8");
    response.send(payload);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    response.status(statusCode).json({
      error: error instanceof Error ? error.message : "V10 远程服务不可用",
    });
  }
}
