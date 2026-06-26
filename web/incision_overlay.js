// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/incisionOverlay.ts.
export {
  __incisionOverlayForTests,
  clearIncisionOverlay,
  compileIncisionOverlay,
  loadIncisionOverlay,
  mapSurfaceRefs,
  measureIncisionOverlayJitter,
  measureIncisionOverlayRegistration,
  pointToSurfaceRef,
  stageIncisionOverlay,
  validateIncisionOverlay,
} from "./src/services/incisionOverlay.ts";
