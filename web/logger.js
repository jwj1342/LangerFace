// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/logger.ts.
export {
  DIAGNOSTIC_SCHEMA_VERSION,
  countMetric,
  diagnostics,
  exportDiagnostics,
  installGlobalErrorHandlers,
  logError,
  logInfo,
  logWarn,
  recordEvent,
  recordMetricSample,
  resetDiagnostics,
  setAssetVersions,
  setDiagnosticSection,
  snapshotDiagnostics,
} from "./src/services/logger.ts";
