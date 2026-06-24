// Browser-side diagnostics stay in memory and never include image pixels.
const MAX_EVENTS = 120;
const MAX_SAMPLES = 120;

export const DIAGNOSTIC_SCHEMA_VERSION = "0.1";

export const diagnostics = {
  schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
  startedAt: new Date().toISOString(),
  events: [],
  counters: Object.create(null),
  metrics: Object.create(null),
  assetVersions: Object.create(null),
};

function normalize(detail) {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack };
  }
  return detail;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function boundedPush(items, item, maxItems) {
  items.push(item);
  if (items.length > maxItems) items.splice(0, items.length - maxItems);
}

function record(level, event, detail) {
  boundedPush(diagnostics.events, {
    t: new Date().toISOString(),
    level,
    event,
    message: event,
    detail: normalize(detail),
  }, MAX_EVENTS);
}

export function countMetric(name, by = 1) {
  diagnostics.counters[name] = (diagnostics.counters[name] || 0) + by;
}

export function recordEvent(event, detail = {}, level = "info") {
  record(level, event, detail);
}

export function recordMetricSample(name, value, detail = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const bucket = diagnostics.metrics[name] || {
    count: 0,
    latest: null,
    min: n,
    max: n,
    sum: 0,
    samples: [],
  };
  bucket.count += 1;
  bucket.latest = n;
  bucket.min = Math.min(bucket.min, n);
  bucket.max = Math.max(bucket.max, n);
  bucket.sum += n;
  boundedPush(bucket.samples, {
    t: new Date().toISOString(),
    value: n,
    detail: clonePlain(detail),
  }, MAX_SAMPLES);
  diagnostics.metrics[name] = bucket;
}

export function setAssetVersions(versions) {
  Object.assign(diagnostics.assetVersions, clonePlain(versions));
}

export function snapshotDiagnostics() {
  const metrics = {};
  for (const [name, metric] of Object.entries(diagnostics.metrics)) {
    metrics[name] = {
      count: metric.count,
      latest: metric.latest,
      min: metric.min,
      max: metric.max,
      mean: metric.count ? metric.sum / metric.count : null,
      samples: metric.samples.map(clonePlain),
    };
  }
  return {
    schemaVersion: diagnostics.schemaVersion,
    startedAt: diagnostics.startedAt,
    exportedAt: new Date().toISOString(),
    assetVersions: clonePlain(diagnostics.assetVersions),
    counters: clonePlain(diagnostics.counters),
    metrics,
    events: diagnostics.events.map(clonePlain),
  };
}

export function exportDiagnostics() {
  return JSON.stringify(snapshotDiagnostics(), null, 2);
}

export function resetDiagnostics() {
  diagnostics.events.length = 0;
  diagnostics.counters = Object.create(null);
  diagnostics.metrics = Object.create(null);
  diagnostics.assetVersions = Object.create(null);
}

export function logInfo(message, detail) {
  record("info", message, detail);
  console.info(message, detail ?? "");
}

export function logWarn(message, detail) {
  record("warn", message, detail);
  console.warn(message, detail ?? "");
}

export function logError(message, detail) {
  record("error", message, detail);
  console.error(message, detail ?? "");
}

globalThis.langerfaceDiagnostics = diagnostics;
globalThis.exportLangerfaceDiagnostics = exportDiagnostics;
