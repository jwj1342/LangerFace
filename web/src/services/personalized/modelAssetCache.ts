export interface ModelAssetCache {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

export interface ModelAssetCacheStorage {
  open(cacheName: string): Promise<ModelAssetCache>;
  keys?(): Promise<string[]>;
  delete?(cacheName: string): Promise<boolean>;
}

export interface CachedAssetResponse {
  response: Response;
  source: "persistent-cache" | "network";
}

interface FetchCachedAssetOptions {
  cacheName: string;
  cacheStorage?: ModelAssetCacheStorage | null;
  fetchImpl?: typeof fetch;
  requestCache?: RequestCache;
}

function browserCacheStorage(): ModelAssetCacheStorage | null {
  return (globalThis as typeof globalThis & { caches?: CacheStorage }).caches ?? null;
}

export async function fetchCachedModelAsset(
  url: string,
  options: FetchCachedAssetOptions,
): Promise<CachedAssetResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const cacheStorage = options.cacheStorage === undefined
    ? browserCacheStorage()
    : options.cacheStorage;
  let cache: ModelAssetCache | null = null;

  if (cacheStorage) {
    try {
      cache = await cacheStorage.open(options.cacheName);
      const cached = await cache.match(url);
      if (cached?.ok) return { response: cached, source: "persistent-cache" };
    } catch {
      cache = null;
    }
  }

  const response = await fetchImpl(url, { cache: options.requestCache ?? "no-cache" });
  if (response?.ok && cache && typeof response.clone === "function") {
    try {
      await cache.put(url, response.clone());
    } catch {
      // Quota, private-mode and browser policy failures must not block inference.
    }
  }
  return { response, source: "network" };
}

export async function pruneVersionedModelCaches(
  cachePrefix: string,
  activeCacheName: string,
  cacheStorage?: ModelAssetCacheStorage | null,
): Promise<void> {
  const storage = cacheStorage === undefined ? browserCacheStorage() : cacheStorage;
  if (!storage?.keys || !storage.delete) return;
  try {
    const cacheNames = await storage.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(cachePrefix) && name !== activeCacheName)
      .map((name) => storage.delete!(name)));
  } catch {
    // Cache cleanup is opportunistic and must never block the active model.
  }
}

export async function deleteModelAssetCache(
  cacheName: string,
  cacheStorage?: ModelAssetCacheStorage | null,
): Promise<void> {
  const storage = cacheStorage === undefined ? browserCacheStorage() : cacheStorage;
  if (!storage?.delete) return;
  try {
    await storage.delete(cacheName);
  } catch {
    // A failed cache eviction must not prevent a network retry.
  }
}
