const MAX_EVENTS = 120;
const MAX_SAMPLES = 120;

export const DIAGNOSTIC_SCHEMA_VERSION = "0.1";

export type DiagnosticLevel = "info" | "warn" | "error" | string;

export interface DiagnosticEvent {
  t: string;
  level: DiagnosticLevel;
  event: string;
  message: string;
  detail: unknown;
}

export interface DiagnosticMetricSample {
  t: string;
  value: number;
  detail: unknown;
}

export interface DiagnosticMetricBucket {
  count: number;
  latest: number | null;
  min: number;
  max: number;
  sum: number;
  samples: DiagnosticMetricSample[];
}

export interface DiagnosticsState {
  schemaVersion: string;
  startedAt: string;
  events: DiagnosticEvent[];
  counters: Record<string, number>;
  metrics: Record<string, DiagnosticMetricBucket>;
  sections: Record<string, unknown>;
  assetVersions: Record<string, unknown>;
}

export interface DiagnosticSnapshotMetric {
  count: number;
  latest: number | null;
  min: number;
  max: number;
  mean: number | null;
  samples: unknown[];
}

export interface DiagnosticSnapshot {
  schemaVersion: string;
  startedAt: string;
  exportedAt: string;
  assetVersions: unknown;
  counters: unknown;
  metrics: Record<string, DiagnosticSnapshotMetric>;
  sections: unknown;
  events: unknown[];
}

interface ErrorEventLike {
  message?: string;
  filename?: string;
  lineno?: number | null;
  colno?: number | null;
  error?: unknown;
}

interface RejectionEventLike {
  reason?: unknown;
}

interface EventTargetLike {
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
}

type DiagnosticsGlobal = typeof globalThis & {
  langerfaceDiagnostics?: DiagnosticsState;
  exportLangerfaceDiagnostics?: () => string;
};

export const diagnostics: DiagnosticsState = {
  schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
  startedAt: new Date().toISOString(),
  events: [],
  counters: Object.create(null) as Record<string, number>,
  metrics: Object.create(null) as Record<string, DiagnosticMetricBucket>,
  sections: Object.create(null) as Record<string, unknown>,
  assetVersions: Object.create(null) as Record<string, unknown>,
};

const installedErrorTargets = new WeakSet<object>();

function normalize(detail: unknown): unknown {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack };
  }
  return detail;
}

function clonePlain(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(value ?? null, (_key, val: unknown) => {
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

function boundedPush<T>(items: T[], item: T, maxItems: number): void {
  items.push(item);
  if (items.length > maxItems) items.splice(0, items.length - maxItems);
}

function record(level: DiagnosticLevel, event: string, detail: unknown): void {
  boundedPush(diagnostics.events, {
    t: new Date().toISOString(),
    level,
    event,
    message: event,
    detail: normalize(detail),
  }, MAX_EVENTS);
}

export function countMetric(name: string, by = 1): void {
  diagnostics.counters[name] = (diagnostics.counters[name] || 0) + by;
}

export function recordEvent(event: string, detail: unknown = {}, level: DiagnosticLevel = "info"): void {
  record(level, event, detail);
}

export function recordMetricSample(name: string, value: unknown, detail: unknown = {}): void {
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

export function setAssetVersions(versions: unknown): void {
  Object.assign(diagnostics.assetVersions, clonePlain(versions));
}

export function setDiagnosticSection(name: string, value: unknown): boolean {
  if (!name || typeof name !== "string") return false;
  if (value == null) {
    delete diagnostics.sections[name];
  } else {
    diagnostics.sections[name] = clonePlain(value);
  }
  return true;
}

export function snapshotDiagnostics(): DiagnosticSnapshot {
  const metrics: Record<string, DiagnosticSnapshotMetric> = {};
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

export function exportDiagnostics(): string {
  return JSON.stringify(snapshotDiagnostics(), null, 2);
}

export function resetDiagnostics(): void {
  diagnostics.events.length = 0;
  diagnostics.counters = Object.create(null) as Record<string, number>;
  diagnostics.metrics = Object.create(null) as Record<string, DiagnosticMetricBucket>;
  diagnostics.sections = Object.create(null) as Record<string, unknown>;
  diagnostics.assetVersions = Object.create(null) as Record<string, unknown>;
}

export function logInfo(message: string, detail?: unknown): void {
  record("info", message, detail);
  console.info(message, detail ?? "");
}

export function logWarn(message: string, detail?: unknown): void {
  record("warn", message, detail);
  console.warn(message, detail ?? "");
}

export function logError(message: string, detail?: unknown): void {
  record("error", message, detail);
  console.error(message, detail ?? "");
}

function errorEventDetail(event: ErrorEventLike): Record<string, unknown> {
  return {
    message: event?.message || (event?.error instanceof Error ? event.error.message : undefined) || "runtime error",
    filename: event?.filename || "",
    lineno: event?.lineno ?? null,
    colno: event?.colno ?? null,
    error: normalize(event?.error),
  };
}

function rejectionEventDetail(event: RejectionEventLike): Record<string, unknown> {
  const reason = event?.reason;
  return {
    message: reason instanceof Error ? reason.message : String(reason || "unhandled rejection"),
    reason: normalize(reason),
  };
}

export function installGlobalErrorHandlers(target: EventTargetLike | typeof globalThis = globalThis): boolean {
  if (!target || typeof target.addEventListener !== "function") return false;
  if (installedErrorTargets.has(target)) return false;
  installedErrorTargets.add(target);
  target.addEventListener("error", (event) => {
    countMetric("runtime.error");
    record("error", "runtime.error", errorEventDetail(event as ErrorEventLike));
  });
  target.addEventListener("unhandledrejection", (event) => {
    countMetric("runtime.unhandledrejection");
    record("error", "runtime.unhandledrejection", rejectionEventDetail(event as RejectionEventLike));
  });
  return true;
}

const diagnosticsGlobal = globalThis as DiagnosticsGlobal;
diagnosticsGlobal.langerfaceDiagnostics = diagnostics;
diagnosticsGlobal.exportLangerfaceDiagnostics = exportDiagnostics;
installGlobalErrorHandlers();
