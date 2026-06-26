// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/mode3d.ts.
export {
  enterRoute,
  loadDemoRecon,
  resetView3d,
  setMode3d,
  startScan,
  startTwin,
  stopTwin,
  toggleTwinHead,
  toggleTwinTexture,
} from "./src/services/mode3d.ts";
