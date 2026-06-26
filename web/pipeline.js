// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/pipeline.ts.
export {
  detectHands,
  ensureReady,
  handleFile,
  loop,
  requestFrame,
  restoreOfficialAtlas,
  setActiveAtlas,
  setSource,
  showCameraPlaceholder,
  startCamera,
  stopSource,
} from "./src/services/pipeline.ts";
