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
  sections: Object.create(null),
  assetVersions: Object.create(null),
};

const installedErrorTargets = new WeakSet();

function normalize(detail) {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack };
  }
  return detail;
}

function clonePlain(value) {
  // 诊断导出绝不能因某条 detail 含循环引用而整体抛错（window.exportLangerfaceDiagnostics
  // 是对外入口）：用 replacer 兜住循环引用并归一化嵌套 Error，再以 try/catch 兜底。
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value ?? null, (_key, val) => {
        if (val instanceof Error) {
          return { name: val.name, message: val.message, stack: val.stack };
        }
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[circular]";
          seen.add(val);
        }
        return val;
      }),
    );
  } catch {
    return { unserializable: true };
  }
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

export function setDiagnosticSection(name, value) {
  if (!name || typeof name !== "string") return false;
  if (value == null) {
    delete diagnostics.sections[name];
  } else {
    diagnostics.sections[name] = clonePlain(value);
  }
  return true;
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
    sections: clonePlain(diagnostics.sections),
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
  diagnostics.sections = Object.create(null);
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

function errorEventDetail(event) {
  return {
    message: event?.message || event?.error?.message || "runtime error",
    filename: event?.filename || "",
    lineno: event?.lineno ?? null,
    colno: event?.colno ?? null,
    error: normalize(event?.error),
  };
}

function rejectionEventDetail(event) {
  const reason = event?.reason;
  return {
    message: reason?.message || String(reason || "unhandled rejection"),
    reason: normalize(reason),
  };
}

export function installGlobalErrorHandlers(target = globalThis) {
  if (!target || typeof target.addEventListener !== "function") return false;
  if (installedErrorTargets.has(target)) return false;
  installedErrorTargets.add(target);
  target.addEventListener("error", (event) => {
    countMetric("runtime.error");
    record("error", "runtime.error", errorEventDetail(event));
  });
  target.addEventListener("unhandledrejection", (event) => {
    countMetric("runtime.unhandledrejection");
    record("error", "runtime.unhandledrejection", rejectionEventDetail(event));
  });
  return true;
}

globalThis.langerfaceDiagnostics = diagnostics;
globalThis.exportLangerfaceDiagnostics = exportDiagnostics;
installGlobalErrorHandlers();
