export const assetNames = {
  atlasLanger: "atlas_langer.json",
  atlasRstl: "atlas_rstl.json",
  canonicalVertices: "canonical_vertices.json",
  flameBasis: "flame_basis.bin",
  faceLandmarkerTask: "face_landmarker.task",
  handLandmarkerTask: "hand_landmarker.task",
  reconDemo: "recon_demo.json",
  topology: "topology_mediapipe_468.json",
  triangles: "triangles.json",
};

const ASSET_BASE_STORAGE_KEY = "langerface.assetBaseUrl";
const assetCache = new Map();

function documentBase() {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  return import.meta.url;
}

export function normalizeAssetBaseUrl(baseUrl = "") {
  const clean = String(baseUrl || "").trim();
  if (!clean) return "";
  const firstSegment = clean.split(/[/?#]/)[0];
  const hostLike = firstSegment.includes(".") || firstSegment.includes(":");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean)
    || clean.startsWith("/")
    || clean.startsWith("./")
    || clean.startsWith("../")
    || !hostLike
    ? clean
    : `https://${clean}`;
  const url = new URL(withProtocol, documentBase());
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function configuredAssetBaseUrl() {
  const query = typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("assetBase")
    : "";
  if (query) {
    const normalized = normalizeAssetBaseUrl(query);
    try { localStorage.setItem(ASSET_BASE_STORAGE_KEY, normalized); } catch {
      // Local storage may be unavailable in private or locked-down browser contexts.
    }
    return normalized;
  }
  try {
    const stored = localStorage.getItem(ASSET_BASE_STORAGE_KEY);
    if (stored) return normalizeAssetBaseUrl(stored);
  } catch {
    // Ignore storage failures and fall back to env/default.
  }
  const envBase = import.meta.env?.VITE_LANGERFACE_ASSET_BASE_URL || "";
  if (envBase) return normalizeAssetBaseUrl(envBase);
  return normalizeAssetBaseUrl("assets/");
}

export function assetBaseUrl() {
  return configuredAssetBaseUrl();
}

export function assetUrl(key) {
  const name = assetNames[key] || key;
  return new URL(name, assetBaseUrl()).href;
}

export const assetUrls = new Proxy({}, {
  get(_target, key) {
    if (typeof key !== "string") return undefined;
    return assetUrl(key);
  },
  ownKeys() {
    return Reflect.ownKeys(assetNames);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

async function readTextWithProgress(resp, onProgress) {
  const total = Number(resp.headers.get("content-length") || 0) || null;
  if (!resp.body?.getReader) {
    const text = await resp.text();
    onProgress?.({ loaded: text.length, total, ratio: total ? text.length / total : null });
    return text;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let loaded = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onProgress?.({ loaded, total, ratio: total ? loaded / total : null });
  }
  text += decoder.decode();
  return text;
}

async function readBufferWithProgress(resp, onProgress) {
  const total = Number(resp.headers.get("content-length") || 0) || null;
  if (!resp.body?.getReader) {
    const buf = await resp.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total, ratio: total ? buf.byteLength / total : null });
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, ratio: total ? loaded / total : null });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function fetchAsset(key, { kind, label = key, onProgress = null } = {}) {
  const url = assetUrl(key);
  const cacheKey = `${kind}:${url}`;
  if (assetCache.has(cacheKey)) return assetCache.get(cacheKey);
  const promise = (async () => {
    onProgress?.({ key, label, url, phase: "start", loaded: 0, total: null, ratio: null });
    const resp = await fetch(url, { cache: "force-cache" });
    if (!resp.ok) throw new Error(`资产加载失败：${label} HTTP ${resp.status}`);
    if (kind === "arrayBuffer") {
      const buf = await readBufferWithProgress(resp, (evt) => onProgress?.({ key, label, url, phase: "progress", ...evt }));
      onProgress?.({ key, label, url, phase: "done", loaded: buf.byteLength, total: buf.byteLength, ratio: 1 });
      return buf;
    }
    const text = await readTextWithProgress(resp, (evt) => onProgress?.({ key, label, url, phase: "progress", ...evt }));
    const data = JSON.parse(text);
    onProgress?.({ key, label, url, phase: "done", loaded: text.length, total: text.length, ratio: 1 });
    return data;
  })();
  assetCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (err) {
    assetCache.delete(cacheKey);
    throw err;
  }
}

export function loadJsonAsset(key, options = {}) {
  return fetchAsset(key, { ...options, kind: "json" });
}

export function loadArrayBufferAsset(key, options = {}) {
  return fetchAsset(key, { ...options, kind: "arrayBuffer" });
}
