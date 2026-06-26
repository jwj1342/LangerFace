// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/assetLoader.ts.
export {
  assetBaseUrl,
  assetNames,
  assetUrl,
  assetUrls,
  loadArrayBufferAsset,
  loadJsonAsset,
  normalizeAssetBaseUrl,
} from "./src/services/assetLoader.ts";
