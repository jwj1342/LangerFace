// 浏览器端轻量诊断：统一记录关键事件，便于在控制台排查运行问题。
const MAX_EVENTS = 80;

export const diagnostics = {
  events: [],
  counters: Object.create(null),
};

function normalize(detail) {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack };
  }
  return detail;
}

function record(level, message, detail) {
  diagnostics.events.push({
    t: new Date().toISOString(),
    level,
    message,
    detail: normalize(detail),
  });
  if (diagnostics.events.length > MAX_EVENTS) diagnostics.events.shift();
}

export function countMetric(name, by = 1) {
  diagnostics.counters[name] = (diagnostics.counters[name] || 0) + by;
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
