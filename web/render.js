// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/render2d.ts.
export {
  adjustFocusZoom,
  buildZoomCards,
  clearZooms,
  draw,
  drawFocusedRegion,
  drawZooms,
  setFocusRegion,
  updateStats,
} from "./src/services/render2d.ts";
