// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/geometryOccluders.ts.
export {
  buildHandMasks,
  buildOccluderHulls,
  convexHull,
  expandHull,
  pointInConvex,
  pointInHandMasks,
  pointInHulls,
} from "../src/services/geometryOccluders.ts";
