import { prepareImageSource } from "./imageSource.ts";
import { auditExportPayload } from "./exportPrivacy.ts";
import {
  CANVAS_EXPORT_DIAGNOSTIC_EVENT,
  type CanvasExportDiagnosticDetail,
} from "./canvasRecording.ts";

export const MARKER_DIAGNOSTIC_EVENT = "langerface:marker-run-diagnostic";
export const MARKER_DIAGNOSTIC_SCHEMA = "marker-run-diagnostic/1";
export const MARKER_DIAGNOSTIC_BUNDLE_SCHEMA = "marker-diagnostic-bundle/1";
export const MARKER_DIAGNOSTIC_SESSION_SCHEMA = "marker-diagnostic-session/2";
export const DIAGNOSTIC_LIMITS = {
  bytes: 8_000_000,
  runs: 1024,
  controllerEvents: 2048,
  workflowEvents: 4096,
  pageInstances: 128,
  sources: 256,
  clientModules: 32,
  exportEvents: 512,
  actionEvents: 8192,
} as const;
const MAX_DIAGNOSTIC_BYTES = DIAGNOSTIC_LIMITS.bytes;
const MAX_SESSION_EVENTS = DIAGNOSTIC_LIMITS.workflowEvents;
const DIAGNOSTIC_ACTION_TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const DIAGNOSTIC_DB = "langerface-diagnostics-v2";
const DIAGNOSTIC_STORE = "sessions";
type ControllerObservation = {
  reason: string; request_id: number; source_revision: number | null;
  action_id?: string | null; diagnostic_run_id?: number | null;
  seed: { x: number; y: number } | null; scan_diameter_mm: number;
  kind: string; marker_busy: boolean; boundary_points: number;
  boundary_mode?: "ellipse" | "freehand";
  boundary_closed?: boolean;
  freehand_drawing?: boolean;
  freehand_point_count?: number;
  candidate_display_blocked?: boolean | null;
  candidate_selection_reason?: string | null;
  candidate_guardrails_passed?: boolean | null;
  rejected_boundary_points?: number | null;
  rejected_reasons?: string[] | null;
};
type DiagnosticOperationType = "controlled_marker" | "freehand";
type RecordedControllerObservation = ControllerObservation & {
  operation_type: DiagnosticOperationType;
  observed_at_ms: number;
  event_seq: number;
  action_id: string;
  source_id: string | null;
  page_instance_id: string;
};
export type WorkflowDiagnosticSnapshot = {
  geometry_revision: number;
  workflow_request_id: number;
  source_revision: number | null;
  candidate: null | {
    type: string; center: number[] | null; length_mm: number | null; width_mm: number | null;
    angle_offset_deg: number; length_scale: number; width_scale: number;
    point_count: number; geometry_fingerprint: string;
  };
  display: null | {
    candidate_point_count: number;
    geometry_fingerprint: string;
    fit_mode: string | null;
    fit_scale: number | null;
    boundary_outside_count: number | null;
    minimum_boundary_distance_px: number | null;
  };
};
export type WorkflowDiagnosticEvent = {
  event_type: "candidate_generation" | "candidate_edit" | "source_state";
  stage: "started" | "preview" | "committed" | "completed" | "failed" | "discarded" | "changed";
  reason: string;
  control_id?: string | null;
  requested_value?: number | null;
  before?: WorkflowDiagnosticSnapshot | null;
  after?: WorkflowDiagnosticSnapshot | null;
};
type RecordedWorkflowEvent = WorkflowDiagnosticEvent & {
  event_seq: number; action_id: string; source_id: string | null;
  page_instance_id: string; observed_at_ms: number;
  preview_count?: number; first_requested_value?: number | null;
};
export type DiagnosticActionInput = {
  domain: string;
  action: string;
  stage: string;
  reason: string;
  request_id?: number | null;
  action_id?: string;
  details?: Json | null;
};
export type DiagnosticActionEvent = DiagnosticActionInput & {
  schema: "marker-diagnostic-action/1";
  event_seq: number;
  action_id: string;
  source_id: string | null;
  page_instance_id: string;
  observed_at_ms: number;
};
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type FrameIdentity = { kind: string | null; revision: number; width: number; height: number };
type SourceFile = { sha256: string; size: number; mime: string; width: number; height: number; rgba_sha256: string };
export type RunInput = {
  revision: number; width: number; height: number; seed: { x: number; y: number };
  options: { roiRadius: number; expectedDiameterPx?: number; scanDiameterMm: number };
  parameters: { kind: string; diameterMm: number; depthMm: number; marginMm: number; scanDiameterMm: number };
  repairs: Json; mirror: boolean; pixelsPerMm: number; profile: string; implementationVersion: string;
};
export type DiagnosticRun = {
  schema: typeof MARKER_DIAGNOSTIC_SCHEMA; run_id: number; request_id: number; started_at_ms: number;
  status: "pending" | "recorded" | "detection_error" | "evidence_error" | "discarded_request" | "discarded_source" | "discarded_parameters"; elapsed_ms: number | null;
  input: RunInput; channel: string; source_file: SourceFile | null; file_binding: "PASS" | "UNKNOWN";
  prepared_rgba_sha256: string | null; detector_rgba_sha256: string | null;
  service_identity: Record<string, Json> | null; service_snapshot_binding: "PASS" | "FAIL" | "UNKNOWN";
  client_declared_contract_binding: "PASS" | "FAIL" | "UNKNOWN"; client_source_binding: "UNKNOWN";
  raw_result: Json; raw_image_embedded: false; uploaded: false;
  replay_of: { run_id: number; started_at_ms: number } | null;
  comparison: { raw_result_equal: boolean; boundary_equal: boolean } | null;
  session_id?: string; page_instance_id?: string; source_id?: string | null; action_id?: string;
  event_seq?: number;
};
const forbidden = /^(?:name|basename|path|author|lastModified|password|token|secret|authorization|__proto__|constructor|prototype)$/i;

/** Reject, rather than silently accepting, private or executable import content. */
export function assertDiagnosticJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 24) throw new Error("诊断JSON层级过深");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 512 && !/(?:data:|blob:|https?:|[A-Z]:\\|Bearer\s)/i.test(value)) return;
  if (typeof value !== "object" || value === null || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw new Error("诊断JSON字段不合法");
  if (Array.isArray(value)) {
    if (value.length > 20000) throw new Error("诊断数组过大");
    value.forEach((v) => assertDiagnosticJson(v, depth + 1));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (forbidden.test(k) || k.length > 100) throw new Error("诊断JSON包含禁止字段");
    assertDiagnosticJson(v, depth + 1);
  }
}
export function stableDiagnosticJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDiagnosticJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableDiagnosticJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function assertDiagnosticDropCounts(value: Record<string, Json>) {
  for (const key of ["dropped_runs", "dropped_controller_events", "dropped_workflow_events", "dropped_sources", "dropped_page_instances", "dropped_export_events", "dropped_action_events"]) {
    const count = value[key];
    if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count) || count < 0)) {
      throw new Error(`诊断丢弃计数不合法：${key}`);
    }
  }
}
/** Typed digest metadata is not free text. Keep the shared privacy scanner unchanged. */
export function auditMarkerDiagnosticExport(value: unknown) {
  assertDiagnosticJson(value);
  if (value && !Array.isArray(value) && typeof value === "object" && value.schema === MARKER_DIAGNOSTIC_SESSION_SCHEMA) {
    assertDiagnosticDropCounts(value as Record<string, Json>);
    if (!Array.isArray(value.runs) || value.runs.length > DIAGNOSTIC_LIMITS.runs || !Array.isArray(value.controller_events)
      || value.controller_events.length > DIAGNOSTIC_LIMITS.controllerEvents || !Array.isArray(value.workflow_events)
      || value.workflow_events.length > MAX_SESSION_EVENTS || !Array.isArray(value.page_instances)
      || value.page_instances.length > DIAGNOSTIC_LIMITS.pageInstances || !Array.isArray(value.sources) || value.sources.length > DIAGNOSTIC_LIMITS.sources
      || !Array.isArray(value.client_modules) || value.client_modules.length > DIAGNOSTIC_LIMITS.clientModules
      || (value.action_events !== undefined && (!Array.isArray(value.action_events) || value.action_events.length > DIAGNOSTIC_LIMITS.actionEvents))
      || (value.export_events !== undefined && (!Array.isArray(value.export_events) || value.export_events.length > DIAGNOSTIC_LIMITS.exportEvents))
      || value.raw_image_embedded !== false || value.uploaded !== false) throw new Error("诊断会话结构不合法");
    for (const run of value.runs) {
      if (!auditMarkerDiagnosticExport(run).passed) throw new Error("诊断记录未通过隐私检查");
    }
    const auditCopy = structuredClone(value) as Record<string, Json>;
    auditCopy.runs = [];
    for (const key of ["session_id"]) if (typeof auditCopy[key] === "string") auditCopy[key] = "[redacted]";
    for (const listKey of ["page_instances", "workflow_events", "action_events"]) {
      const entries = auditCopy[listKey];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || Array.isArray(entry) || typeof entry !== "object") continue;
        for (const key of ["page_instance_id", "action_id", "source_id"])
          if (typeof entry[key] === "string") entry[key] = "[redacted]";
        for (const snapshotKey of ["before", "after"]) {
          const snapshot = entry[snapshotKey];
          if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") continue;
          for (const geometryKey of ["candidate", "display"]) {
            const geometry = snapshot[geometryKey];
            if (geometry && !Array.isArray(geometry) && typeof geometry === "object"
              && typeof geometry.geometry_fingerprint === "string") geometry.geometry_fingerprint = "[redacted]";
          }
        }
        const identity = entry.service_identity;
        if (identity && !Array.isArray(identity) && typeof identity === "object") {
          for (const key of ["head", "worktreeId", "sourceDigest", "assetDigest"])
            if (typeof identity[key] === "string") identity[key] = "[redacted]";
        }
      }
    }
    for (const event of auditCopy.controller_events as Json[]) {
      if (!event || Array.isArray(event) || typeof event !== "object") continue;
      for (const key of ["action_id", "source_id", "page_instance_id"])
        if (typeof event[key] === "string") event[key] = "[redacted]";
    }
    for (const source of auditCopy.sources as Json[]) {
      if (!source || Array.isArray(source) || typeof source !== "object") continue;
      for (const key of ["source_id", "page_instance_id"]) if (typeof source[key] === "string") source[key] = "[redacted]";
      const file = source.file;
      if (!file || Array.isArray(file) || typeof file !== "object") continue;
      for (const key of ["sha256", "rgba_sha256"]) if (typeof file[key] === "string") file[key] = "[redacted]";
    }
    for (const module of auditCopy.client_modules as Json[]) {
      if (module && !Array.isArray(module) && typeof module === "object" && typeof module.sha256 === "string") module.sha256 = "[redacted]";
    }
    return auditExportPayload(auditCopy);
  }
  if (value && !Array.isArray(value) && typeof value === "object" && value.schema === MARKER_DIAGNOSTIC_BUNDLE_SCHEMA) {
    assertDiagnosticDropCounts(value as Record<string, Json>);
    if (!Array.isArray(value.runs) || value.runs.length > DIAGNOSTIC_LIMITS.runs || !Array.isArray(value.controller_events)
      || value.controller_events.length > DIAGNOSTIC_LIMITS.controllerEvents
      || (value.workflow_events !== undefined && (!Array.isArray(value.workflow_events) || value.workflow_events.length > DIAGNOSTIC_LIMITS.workflowEvents))
      || (value.export_events !== undefined && (!Array.isArray(value.export_events) || value.export_events.length > DIAGNOSTIC_LIMITS.exportEvents))
      || (value.action_events !== undefined && (!Array.isArray(value.action_events) || value.action_events.length > DIAGNOSTIC_LIMITS.actionEvents))
      || value.raw_image_embedded !== false || value.uploaded !== false) throw new Error("诊断包结构不合法");
    for (const run of value.runs) {
      if (!auditMarkerDiagnosticExport(run).passed) throw new Error("诊断记录未通过隐私检查");
    }
    const auditCopy = structuredClone(value) as Record<string, Json>;
    auditCopy.runs = [];
    for (const event of auditCopy.controller_events as Json[]) {
      if (!event || Array.isArray(event) || typeof event !== "object") continue;
      for (const key of ["action_id", "source_id", "page_instance_id"])
        if (typeof event[key] === "string") event[key] = "[redacted]";
    }
    for (const listKey of ["workflow_events", "action_events"]) {
      const events = auditCopy[listKey];
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (!event || Array.isArray(event) || typeof event !== "object") continue;
        for (const key of ["action_id", "source_id", "page_instance_id"])
          if (typeof event[key] === "string") event[key] = "[redacted]";
      }
    }
    return auditExportPayload(auditCopy);
  }
  if (!value || Array.isArray(value) || typeof value !== "object" || value.schema !== MARKER_DIAGNOSTIC_SCHEMA) throw new Error("诊断版本不支持导出");
  const auditCopy = structuredClone(value) as Record<string, Json>;
  for (const key of ["session_id", "page_instance_id", "source_id", "action_id"])
    if (typeof auditCopy[key] === "string") auditCopy[key] = "[redacted]";
  const digest = (record: Record<string, Json>, key: string, length = 64) => {
    const field = record[key];
    if (field === null || field === undefined) return;
    if (typeof field !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`, "i").test(field)) throw new Error(`诊断指纹字段不合法：${key}`);
    // Only this scanner copy is redacted. The downloaded ticket retains the exact digest.
    record[key] = "[redacted]";
  };
  const object = (field: Json | undefined): Record<string, Json> | null => {
    if (field === null || field === undefined) return null;
    if (typeof field !== "object" || Array.isArray(field)) throw new Error("诊断身份结构不合法");
    return field;
  };
  digest(auditCopy, "prepared_rgba_sha256"); digest(auditCopy, "detector_rgba_sha256");
  const source = object(auditCopy.source_file);
  if (source) { digest(source, "sha256"); digest(source, "rgba_sha256"); }
  const identity = object(auditCopy.service_identity);
  if (identity) {
    digest(identity, "head", 40);
    for (const key of ["worktreeId", "sourceDigest", "assetDigest"]) digest(identity, key);
  }
  return auditExportPayload(auditCopy);
}
export async function diagnosticSha256(data: Uint8Array | Uint8ClampedArray): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function diagnosticPixelBinding(file: SourceFile | null, input: Pick<RunInput, "width" | "height">, rgba: string | null): boolean {
  return Boolean(file && rgba && file.width === input.width && file.height === input.height && file.rgba_sha256 === rgba);
}
const identityKeys = ["profile", "implementationVersion", "branch", "head", "worktreeId", "sourceDigest", "assetDigest", "mode"] as const;
async function serviceIdentity(): Promise<Record<string, Json> | null> {
  try {
    const response = await fetch("/__runtime-identity.json", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const raw = await response.json() as Record<string, unknown>;
    const safe: Record<string, Json> = {};
    for (const key of identityKeys) {
      if (typeof raw[key] !== "string" || !raw[key]) return null;
      safe[key] = raw[key];
    }
    assertDiagnosticJson(safe);
    return safe;
  } catch { return null; }
}
function notify(message: string, run?: DiagnosticRun) {
  window.dispatchEvent(new CustomEvent(MARKER_DIAGNOSTIC_EVENT, { detail: { message, run } }));
}
function rawDetection(value: unknown): Json {
  const raw = value as Record<string, unknown>;
  const result: Record<string, Json> = {};
  // Only detector-owned geometric output, never form metadata or image bytes.
  for (const key of ["ok", "failure_code", "center", "boundary", "rejected_boundary", "rejected_geometry_mode", "rejected_reasons", "area_px", "bbox", "geometry_mode", "seed_relation", "marker_area_px", "marker_bbox", "confidence", "candidate_count", "warnings", "scan", "diagnostics", "audit"]) {
    if (raw[key] !== undefined) result[key] = JSON.parse(JSON.stringify(raw[key])) as Json;
  }
  assertDiagnosticJson(result);
  return result;
}
export function parseDiagnosticRun(text: string): DiagnosticRun {
  if (new TextEncoder().encode(text).byteLength > MAX_DIAGNOSTIC_BYTES) throw new Error("诊断文件超过8MB");
  const value: unknown = JSON.parse(text);
  assertDiagnosticJson(value);
  if (value && !Array.isArray(value) && typeof value === "object"
    && (value.schema === MARKER_DIAGNOSTIC_BUNDLE_SCHEMA || value.schema === MARKER_DIAGNOSTIC_SESSION_SCHEMA)) {
    if (!auditMarkerDiagnosticExport(value).passed) throw new Error("诊断包未通过隐私检查");
    const runs = value.runs as Json[];
    if (!runs.length) throw new Error("该诊断包尚无已执行的识别记录");
    return parseDiagnosticRun(JSON.stringify(runs.at(-1)));
  }
  const r = value as unknown as DiagnosticRun;
  if (r.schema !== MARKER_DIAGNOSTIC_SCHEMA || r.status !== "recorded" || !r.input || !r.input.seed || !r.input.options || !r.input.parameters
    || r.raw_image_embedded !== false || r.uploaded !== false || r.client_source_binding !== "UNKNOWN"
    || !["web_worker", "main_thread_fallback"].includes(r.channel)) throw new Error("诊断版本或状态不支持复放");
  return r;
}

function randomDiagnosticId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function currentSessionId() {
  try {
    const key = "langerface_diagnostic_session_v2";
    const existing = sessionStorage.getItem(key);
    if (existing && /^session-[0-9a-f]{24}$/.test(existing)) return existing;
    const created = randomDiagnosticId("session");
    sessionStorage.setItem(key, created);
    return created;
  } catch { return randomDiagnosticId("session"); }
}

function clientModuleFingerprint() {
  const text = `${MARKER_DIAGNOSTIC_SESSION_SCHEMA}|${MarkerRunDiagnostics.toString()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function browserEngine() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const match = ua.match(/(?:Edg|Chrome|Firefox)\/[0-9.]+|Version\/[0-9.]+(?=.*Safari)/);
  return match?.[0] || "unknown";
}

type PersistedDiagnosticSession = {
  schema: typeof MARKER_DIAGNOSTIC_SESSION_SCHEMA; session_id: string; event_seq: number;
  page_instances: Json[]; sources: Json[]; runs: DiagnosticRun[];
  controller_events: RecordedControllerObservation[]; workflow_events: RecordedWorkflowEvent[];
  action_events?: DiagnosticActionEvent[];
  client_modules: Json[]; dropped_preview_events: number;
  dropped_runs?: number; dropped_controller_events?: number; dropped_workflow_events?: number;
  dropped_sources?: number; dropped_page_instances?: number; dropped_export_events?: number; dropped_action_events?: number;
};

function openDiagnosticDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DIAGNOSTIC_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIAGNOSTIC_STORE)) request.result.createObjectStore(DIAGNOSTIC_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readPersistedSession(sessionId: string): Promise<PersistedDiagnosticSession | null> {
  const db = await openDiagnosticDb();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(DIAGNOSTIC_STORE, "readonly").objectStore(DIAGNOSTIC_STORE).get(sessionId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function writePersistedSession(value: PersistedDiagnosticSession): Promise<void> {
  const db = await openDiagnosticDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const transaction = db.transaction(DIAGNOSTIC_STORE, "readwrite");
    transaction.objectStore(DIAGNOSTIC_STORE).put(value, value.session_id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}
export function diagnosticReplayMismatches(saved: DiagnosticRun, current: DiagnosticRun): string[] {
  const mismatch: string[] = [];
  if (saved.file_binding !== "PASS" || current.file_binding !== "PASS") mismatch.push("原图身份未知");
  if (saved.source_file?.sha256 !== current.source_file?.sha256) mismatch.push("原文件不同");
  if (saved.prepared_rgba_sha256 !== current.prepared_rgba_sha256 || !current.prepared_rgba_sha256) mismatch.push("原图像素不同");
  if (saved.detector_rgba_sha256 !== current.detector_rgba_sha256 || !current.detector_rgba_sha256) mismatch.push("实际检测像素不同");
  const { revision: _oldRevision, ...oldInput } = saved.input;
  const { revision: _newRevision, ...newInput } = current.input;
  if (stableDiagnosticJson(oldInput) !== stableDiagnosticJson(newInput)) mismatch.push("参数/坐标/变换不同");
  if (saved.service_snapshot_binding !== "PASS" || current.service_snapshot_binding !== "PASS"
    || saved.client_declared_contract_binding !== "PASS" || current.client_declared_contract_binding !== "PASS"
    || stableDiagnosticJson(saved.service_identity) !== stableDiagnosticJson(current.service_identity)) mismatch.push("服务或声明身份未匹配");
  return mismatch;
}

/**
 * Always constructed with the workflow controller so ordinary mode keeps a local
 * incident trail. The developer query gate controls export UI, not collection.
 */
export class MarkerRunDiagnostics {
  private generation = 0;
  private selection: { generation: number; previousRevision: number; boundRevision: number | null; sourceId: string; file: Promise<SourceFile | null> } | null = null;
  private sequence = 0;
  private runs: DiagnosticRun[] = [];
  private controllerEvents: RecordedControllerObservation[] = [];
  private exportEvents: CanvasExportDiagnosticDetail[] = [];
  private workflowEvents: RecordedWorkflowEvent[] = [];
  private actionEvents: DiagnosticActionEvent[] = [];
  private pageInstances: Json[] = [];
  private sources: Json[] = [];
  private eventSequence = 0;
  private droppedPreviewEvents = 0;
  private droppedRuns = 0;
  private droppedControllerEvents = 0;
  private droppedWorkflowEvents = 0;
  private droppedSources = 0;
  private droppedPageInstances = 0;
  private droppedExportEvents = 0;
  private droppedActionEvents = 0;
  private persistQueued = false;
  private persistChain = Promise.resolve();
  private sessionId = currentSessionId();
  private pageInstanceId = randomDiagnosticId("page");
  private currentSourceId: string | null = null;
  private activeGenerationAction: string | null = null;
  private clientModules: Json[] = [];
  private ready: Promise<void>;
  private alive = true;
  private initialIdentity = serviceIdentity();
  imported: DiagnosticRun | null = null;
  private getFrame: () => FrameIdentity | null | undefined;
  constructor(getFrame: () => FrameIdentity | null | undefined) {
    this.getFrame = getFrame;
    document.addEventListener("change", this.onFile, true);
    document.addEventListener("cancel", this.onFile, true);
    window.addEventListener(CANVAS_EXPORT_DIAGNOSTIC_EVENT, this.onExport as EventListener);
    this.ready = this.restore();
  }
  whenReady() { return this.ready; }
  async captureClientModule(moduleRole: string, moduleUrl: string) {
    if (!/^[a-z0-9_-]{1,64}$/.test(moduleRole) || !this.alive) return;
    try {
      const url = new URL(moduleUrl, window.location.href);
      if (url.origin !== window.location.origin) return;
      const response = await fetch(url.href, { cache: "no-store" });
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.clientModules.push({ module_role: moduleRole, sha256: await diagnosticSha256(bytes), size_bytes: bytes.byteLength });
      this.clientModules = this.clientModules.slice(-DIAGNOSTIC_LIMITS.clientModules);
      this.queuePersist();
    } catch { /* Client source evidence is optional; product behavior stays unchanged. */ }
  }
  private async restore() {
    const prior = await readPersistedSession(this.sessionId);
    if (!this.alive) return;
    if (prior?.schema === MARKER_DIAGNOSTIC_SESSION_SCHEMA) {
      this.eventSequence = Math.max(this.eventSequence, prior.event_seq || 0);
      this.pageInstances = prior.page_instances || [];
      this.sources = [...(prior.sources || []), ...this.sources].slice(-DIAGNOSTIC_LIMITS.sources);
      this.runs = [...(prior.runs || []), ...this.runs].slice(-DIAGNOSTIC_LIMITS.runs);
      this.sequence = this.runs.reduce((maximum, run) => Math.max(maximum, run.run_id || 0), 0);
      this.controllerEvents = [...(prior.controller_events || []), ...this.controllerEvents].slice(-DIAGNOSTIC_LIMITS.controllerEvents);
      this.workflowEvents = [...(prior.workflow_events || []), ...this.workflowEvents].slice(-MAX_SESSION_EVENTS);
      this.actionEvents = [...(prior.action_events || []), ...this.actionEvents].slice(-DIAGNOSTIC_LIMITS.actionEvents);
      this.clientModules = (prior.client_modules || []).slice(-DIAGNOSTIC_LIMITS.clientModules);
      this.droppedPreviewEvents = prior.dropped_preview_events || 0;
      this.droppedRuns = prior.dropped_runs || 0;
      this.droppedControllerEvents = prior.dropped_controller_events || 0;
      this.droppedWorkflowEvents = prior.dropped_workflow_events || 0;
      this.droppedSources = prior.dropped_sources || 0;
      this.droppedPageInstances = prior.dropped_page_instances || 0;
      this.droppedExportEvents = prior.dropped_export_events || 0;
      this.droppedActionEvents = prior.dropped_action_events || 0;
      const latestSource = this.sources.at(-1);
      // Browsers do not restore file input contents after refresh. A new source must be explicitly selected.
      this.currentSourceId = null;
    }
    const navigation = typeof performance.getEntriesByType === "function"
      ? performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined : undefined;
    this.pageInstances.push({
      page_instance_id: this.pageInstanceId, opened_at_ms: Date.now(), restored_session: Boolean(prior),
      client_module_fingerprint: clientModuleFingerprint(),
      viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0, device_pixel_ratio: window.devicePixelRatio || 1 },
      touch_points: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints || 0,
      browser_engine: browserEngine(), navigation_type: navigation?.type || "unknown",
    });
    if (this.pageInstances.length > DIAGNOSTIC_LIMITS.pageInstances) {
      this.droppedPageInstances += this.pageInstances.length - DIAGNOSTIC_LIMITS.pageInstances;
      this.pageInstances = this.pageInstances.slice(-DIAGNOSTIC_LIMITS.pageInstances);
    }
    const currentPage = this.pageInstances.at(-1);
    void this.initialIdentity.then(identity => {
      if (this.alive && currentPage && !Array.isArray(currentPage) && typeof currentPage === "object") {
        currentPage.service_identity = identity;
        this.queuePersist();
      }
    });
    this.queuePersist();
  }
  private persisted(): PersistedDiagnosticSession {
    return {
      schema: MARKER_DIAGNOSTIC_SESSION_SCHEMA, session_id: this.sessionId, event_seq: this.eventSequence,
      page_instances: this.pageInstances, sources: this.sources, runs: this.runs,
      controller_events: this.controllerEvents, workflow_events: this.workflowEvents,
      action_events: this.actionEvents,
      client_modules: this.clientModules, dropped_preview_events: this.droppedPreviewEvents,
      dropped_runs: this.droppedRuns, dropped_controller_events: this.droppedControllerEvents,
      dropped_workflow_events: this.droppedWorkflowEvents, dropped_sources: this.droppedSources,
      dropped_page_instances: this.droppedPageInstances, dropped_export_events: this.droppedExportEvents,
      dropped_action_events: this.droppedActionEvents,
    };
  }
  private mergePrior(prior: PersistedDiagnosticSession | null) {
    if (prior?.schema !== MARKER_DIAGNOSTIC_SESSION_SCHEMA) return;
    const mergeUnique = <T>(older: T[], current: T[], key: (item: T) => string) => {
      const merged = new Map<string, T>();
      for (const item of [...older, ...current]) merged.set(key(item), item);
      return [...merged.values()];
    };
    const trimMerged = <T>(items: T[], limit: number, onDrop: (count: number) => void) => {
      if (items.length > limit) onDrop(items.length - limit);
      return items.slice(-limit);
    };
    this.eventSequence = Math.max(this.eventSequence, prior.event_seq || 0);
    this.pageInstances = trimMerged(mergeUnique(prior.page_instances || [], this.pageInstances, item => {
      if (item && !Array.isArray(item) && typeof item === "object") return String(item.page_instance_id || stableDiagnosticJson(item));
      return stableDiagnosticJson(item);
    }), DIAGNOSTIC_LIMITS.pageInstances, count => { this.droppedPageInstances += count; });
    this.sources = trimMerged(mergeUnique(prior.sources || [], this.sources, item => {
      if (item && !Array.isArray(item) && typeof item === "object") return String(item.source_id || stableDiagnosticJson(item));
      return stableDiagnosticJson(item);
    }), DIAGNOSTIC_LIMITS.sources, count => { this.droppedSources += count; });
    this.runs = trimMerged(mergeUnique(prior.runs || [], this.runs, run => String(run.action_id || `${run.page_instance_id}:${run.run_id}`)), DIAGNOSTIC_LIMITS.runs, count => { this.droppedRuns += count; });
    this.sequence = this.runs.reduce((maximum, run) => Math.max(maximum, run.run_id || 0), this.sequence);
    this.controllerEvents = trimMerged(mergeUnique(prior.controller_events || [], this.controllerEvents,
      event => String(event.action_id || `${event.page_instance_id}:${event.event_seq}`)), DIAGNOSTIC_LIMITS.controllerEvents, count => { this.droppedControllerEvents += count; });
    this.workflowEvents = trimMerged(mergeUnique(prior.workflow_events || [], this.workflowEvents,
      event => String(event.action_id || `${event.page_instance_id}:${event.event_seq}:${event.stage}`)), MAX_SESSION_EVENTS, count => { this.droppedWorkflowEvents += count; });
    this.actionEvents = trimMerged(mergeUnique(prior.action_events || [], this.actionEvents,
      event => String(event.action_id || `${event.page_instance_id}:${event.event_seq}`)), DIAGNOSTIC_LIMITS.actionEvents, count => { this.droppedActionEvents += count; });
    this.clientModules = trimMerged(mergeUnique(prior.client_modules || [], this.clientModules, item => stableDiagnosticJson(item)), DIAGNOSTIC_LIMITS.clientModules, count => { /* module history is bounded and optional */ });
    this.droppedPreviewEvents = Math.max(this.droppedPreviewEvents, prior.dropped_preview_events || 0);
    this.droppedRuns = Math.max(this.droppedRuns, prior.dropped_runs || 0);
    this.droppedControllerEvents = Math.max(this.droppedControllerEvents, prior.dropped_controller_events || 0);
    this.droppedWorkflowEvents = Math.max(this.droppedWorkflowEvents, prior.dropped_workflow_events || 0);
    this.droppedSources = Math.max(this.droppedSources, prior.dropped_sources || 0);
    this.droppedPageInstances = Math.max(this.droppedPageInstances, prior.dropped_page_instances || 0);
    this.droppedExportEvents = Math.max(this.droppedExportEvents, prior.dropped_export_events || 0);
    this.droppedActionEvents = Math.max(this.droppedActionEvents, prior.dropped_action_events || 0);
  }
  private queuePersist() {
    if (this.persistQueued || !this.alive) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      if (this.alive) this.persistChain = this.persistChain.then(async () => {
        this.mergePrior(await readPersistedSession(this.sessionId));
        await writePersistedSession(structuredClone(this.persisted()));
      });
    });
  }
  private onExport = (event: CustomEvent<CanvasExportDiagnosticDetail>) => {
    if (!this.alive || !event.detail) return;
    assertDiagnosticJson(event.detail);
    this.exportEvents.push(structuredClone(event.detail));
    if (this.exportEvents.length > DIAGNOSTIC_LIMITS.exportEvents) {
      this.droppedExportEvents += this.exportEvents.length - DIAGNOSTIC_LIMITS.exportEvents;
      this.exportEvents = this.exportEvents.slice(-DIAGNOSTIC_LIMITS.exportEvents);
    }
    notify(`开发者诊断：${event.detail.export_kind === "video" ? "视频" : "图片"}导出 ${event.detail.stage}。日志仅记录格式、大小、能力和结果，不含媒体内容。`);
  };
  private onFile = (event: Event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== "fileInput") return;
    const generation = ++this.generation;
    this.selection = null;
    if (event.type === "cancel") return;
    const file = event.target.files?.[0];
    if (!file || !["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) return;
    const sourceId = randomDiagnosticId("source");
    this.currentSourceId = sourceId;
    const selectedAt = Date.now();
    const decoded = this.decode(file);
    this.selection = { generation, previousRevision: this.getFrame()?.revision ?? -1, boundRevision: null, sourceId, file: decoded };
    void decoded.then(source => {
      if (!this.alive) return;
      this.sources.push({ source_id: sourceId, selected_at_ms: selectedAt, page_instance_id: this.pageInstanceId,
        source_revision: this.getFrame()?.revision ?? null, file: source });
      if (this.sources.length > DIAGNOSTIC_LIMITS.sources) {
        this.droppedSources += this.sources.length - DIAGNOSTIC_LIMITS.sources;
        this.sources = this.sources.slice(-DIAGNOSTIC_LIMITS.sources);
      }
      this.workflowEvents.push({ event_type: "source_state", stage: "changed", reason: "image_selected",
        event_seq: ++this.eventSequence, action_id: randomDiagnosticId("source"), source_id: sourceId,
        page_instance_id: this.pageInstanceId, observed_at_ms: selectedAt });
      while (this.workflowEvents.length > MAX_SESSION_EVENTS) {
        const previewIndex = this.workflowEvents.findIndex(item => item.stage === "preview");
        if (previewIndex >= 0) { this.workflowEvents.splice(previewIndex, 1); this.droppedPreviewEvents += 1; }
        else this.workflowEvents.shift();
        this.droppedWorkflowEvents += 1;
      }
      this.queuePersist();
    });
  };
  private async decode(file: File): Promise<SourceFile | null> {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const prepared = prepareImageSource(image);
      const canvas = document.createElement("canvas");
      canvas.width = prepared.width; canvas.height = prepared.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(prepared.source, 0, 0, prepared.width, prepared.height);
      const [sha256, rgba_sha256] = await Promise.all([diagnosticSha256(new Uint8Array(await file.arrayBuffer())), diagnosticSha256(context.getImageData(0, 0, prepared.width, prepared.height).data)]);
      return { sha256, rgba_sha256, size: file.size, mime: file.type, width: prepared.width, height: prepared.height };
    } catch { return null; } finally { URL.revokeObjectURL(url); }
  }
  begin(input: RunInput, requestId: number, channel: string, before: Uint8ClampedArray, actual: Uint8ClampedArray, retain = true, replayOf?: DiagnosticRun, actionId?: string | null) {
    const selection = this.selection;
    const started = performance.now();
    const run: DiagnosticRun = {
      schema: MARKER_DIAGNOSTIC_SCHEMA, run_id: ++this.sequence, request_id: requestId, started_at_ms: Date.now(),
      status: "pending", elapsed_ms: null, input: structuredClone(input), channel,
      source_file: null, file_binding: "UNKNOWN", prepared_rgba_sha256: null, detector_rgba_sha256: null,
      service_identity: null, service_snapshot_binding: "UNKNOWN", client_declared_contract_binding: "UNKNOWN", client_source_binding: "UNKNOWN",
      raw_result: null, raw_image_embedded: false, uploaded: false,
      replay_of: replayOf ? { run_id: replayOf.run_id, started_at_ms: replayOf.started_at_ms } : null, comparison: null,
      session_id: this.sessionId, page_instance_id: this.pageInstanceId,
      source_id: selection?.sourceId || this.currentSourceId, action_id: actionId || randomDiagnosticId("detect"),
      event_seq: ++this.eventSequence,
    };
    if (retain) {
      this.runs.push(run);
      if (this.runs.length > DIAGNOSTIC_LIMITS.runs) {
        this.droppedRuns += this.runs.length - DIAGNOSTIC_LIMITS.runs;
        this.runs = this.runs.slice(-DIAGNOSTIC_LIMITS.runs);
      }
      this.queuePersist();
    }
    // Hash independent copies synchronously before caller transfers detector bytes.
    const evidence = Promise.all([diagnosticSha256(before), diagnosticSha256(actual), this.initialIdentity, serviceIdentity(), selection?.file ?? Promise.resolve(null)])
      .then(([beforeHash, actualHash, initial, current, file]) => {
        run.prepared_rgba_sha256 = beforeHash; run.detector_rgba_sha256 = actualHash;
        run.service_identity = current;
        if (initial && current) run.service_snapshot_binding = stableDiagnosticJson(initial) === stableDiagnosticJson(current) ? "PASS" : "FAIL";
        if (current) run.client_declared_contract_binding = current.profile === input.profile && current.implementationVersion === input.implementationVersion ? "PASS" : "FAIL";
        const frame = this.getFrame();
        if (this.alive && selection && this.selection === selection && selection.generation === this.generation
          // Formal workflow upload does clearSource (+1), then replaceSource (+1).
          // Another upload/source operation changes the revision again: fail closed.
          && input.revision === selection.previousRevision + 2 && frame?.kind === "image" && frame.revision === input.revision
          && (selection.boundRevision === null || selection.boundRevision === input.revision)
          && diagnosticPixelBinding(file, input, beforeHash)) {
          selection.boundRevision = input.revision; run.source_file = file; run.file_binding = "PASS";
        }
      }).catch(() => { run.status = "evidence_error"; });
    let settled = false;
    return {
      run, evidence,
      finish: (result: unknown, error = false, status: DiagnosticRun["status"] = error ? "detection_error" : "recorded") => {
        if (settled) return;
        settled = true;
        run.elapsed_ms = performance.now() - started;
        try { run.raw_result = error ? null : rawDetection(result); } catch { run.status = "evidence_error"; }
        if (replayOf && run.raw_result && status === "recorded") {
          const oldResult = replayOf.raw_result as Record<string, Json> | null;
          const newResult = run.raw_result as Record<string, Json>;
          run.comparison = { raw_result_equal: stableDiagnosticJson(oldResult) === stableDiagnosticJson(newResult), boundary_equal: stableDiagnosticJson(oldResult?.boundary) === stableDiagnosticJson(newResult.boundary) };
        }
        void evidence.then(() => {
          if (run.status !== "evidence_error") run.status = status;
          this.queuePersist();
          if (this.alive && retain && this.runs.at(-1) === run) notify(`诊断 #${run.run_id}：${run.status}；原图${run.file_binding}；客户端源码身份待确认${run.comparison ? `；复放边界${run.comparison.boundary_equal ? "完全一致" : "存在差异"}` : ""}`, run);
        });
      },
    };
  }
  exportLatest(): string {
    const run = this.runs.at(-1);
    if (!run || run.status === "pending") throw new Error("请先完成一次识别并等待诊断记录就绪");
    assertDiagnosticJson(run);
    return JSON.stringify(run, null, 2);
  }
  /**
   * Record a privacy-safe event for any workflow domain. This is intentionally
   * independent from detector runs and candidate-edit events so new features
   * can add observability without changing the replay contract.
   */
  recordAction(input: DiagnosticActionInput): string | null {
    if (!this.alive || !input || !DIAGNOSTIC_ACTION_TOKEN.test(input.domain)
      || !DIAGNOSTIC_ACTION_TOKEN.test(input.action) || !DIAGNOSTIC_ACTION_TOKEN.test(input.stage)
      || !/^[a-z0-9_:-]{1,160}$/.test(input.reason)) return null;
    if (input.request_id !== undefined && input.request_id !== null
      && (typeof input.request_id !== "number" || !Number.isFinite(input.request_id))) return null;
    const actionId = input.action_id || randomDiagnosticId("action");
    if (!/^[a-z0-9_-]{1,128}$/.test(actionId)) return null;
    try {
      const event: DiagnosticActionEvent = {
        schema: "marker-diagnostic-action/1", domain: input.domain, action: input.action,
        stage: input.stage, reason: input.reason, request_id: input.request_id ?? null,
        action_id: actionId, details: input.details === undefined ? null : structuredClone(input.details),
        event_seq: ++this.eventSequence, source_id: this.currentSourceId,
        page_instance_id: this.pageInstanceId, observed_at_ms: Date.now(),
      };
      assertDiagnosticJson(event);
      this.actionEvents.push(event);
      if (this.actionEvents.length > DIAGNOSTIC_LIMITS.actionEvents) {
        this.droppedActionEvents += this.actionEvents.length - DIAGNOSTIC_LIMITS.actionEvents;
        this.actionEvents = this.actionEvents.slice(-DIAGNOSTIC_LIMITS.actionEvents);
      }
      this.queuePersist();
      return actionId;
    } catch {
      return null;
    }
  }
  observeController(event: ControllerObservation) {
    const operationType: DiagnosticOperationType | null = /^(controlled_marker_|mobile_marker_)/.test(event.reason)
      ? "controlled_marker"
      : /^freehand_/.test(event.reason)
        ? "freehand"
        : null;
    if (!this.alive || !operationType) return;
    assertDiagnosticJson(event);
    const actionId = typeof event.action_id === "string" && /^[a-z0-9_-]{1,128}$/.test(event.action_id)
      ? event.action_id : randomDiagnosticId(operationType);
    this.controllerEvents.push({ ...structuredClone(event), operation_type: operationType, observed_at_ms: Date.now(),
      event_seq: ++this.eventSequence, action_id: actionId,
      source_id: this.currentSourceId, page_instance_id: this.pageInstanceId });
    if (this.controllerEvents.length > DIAGNOSTIC_LIMITS.controllerEvents) {
      this.droppedControllerEvents += this.controllerEvents.length - DIAGNOSTIC_LIMITS.controllerEvents;
      this.controllerEvents = this.controllerEvents.slice(-DIAGNOSTIC_LIMITS.controllerEvents);
    }
    this.queuePersist();
    notify(`开发者诊断：${event.reason}；${operationType === "freehand" ? "自由轮廓操作" : `本会话 ${this.runs.length} 次识别`}。日志仅保存在当前浏览器本地，刷新后继续接续。`);
  }
  observeWorkflow(event: WorkflowDiagnosticEvent) {
    if (!this.alive || !/^[a-z0-9_:-]{1,160}$/.test(event.reason)) return;
    const safeEvent = JSON.parse(JSON.stringify(event)) as WorkflowDiagnosticEvent;
    assertDiagnosticJson(safeEvent);
    const previous = this.workflowEvents.at(-1);
    if (safeEvent.stage === "preview" && previous?.stage === "preview"
      && previous.event_type === safeEvent.event_type && previous.control_id === safeEvent.control_id
      && previous.source_id === this.currentSourceId && previous.page_instance_id === this.pageInstanceId) {
      previous.preview_count = (previous.preview_count || 1) + 1;
      previous.requested_value = safeEvent.requested_value;
      previous.after = structuredClone(safeEvent.after || null);
      previous.observed_at_ms = Date.now();
    } else {
      let actionId = randomDiagnosticId(safeEvent.event_type === "candidate_edit" ? "edit" : "workflow");
      if (safeEvent.event_type === "candidate_generation") {
        if (safeEvent.stage === "started") this.activeGenerationAction = actionId;
        else if (this.activeGenerationAction) actionId = this.activeGenerationAction;
      } else if (safeEvent.event_type === "candidate_edit" && safeEvent.stage === "committed"
        && previous?.event_type === "candidate_edit" && previous.stage === "preview"
        && previous.control_id === safeEvent.control_id) actionId = previous.action_id;
      this.workflowEvents.push({ ...structuredClone(safeEvent), event_seq: ++this.eventSequence,
        action_id: actionId,
        source_id: this.currentSourceId, page_instance_id: this.pageInstanceId, observed_at_ms: Date.now(),
        ...(safeEvent.stage === "preview" ? { preview_count: 1, first_requested_value: safeEvent.requested_value } : {}) });
      if (safeEvent.event_type === "candidate_generation" && safeEvent.stage !== "started") this.activeGenerationAction = null;
    }
    while (this.workflowEvents.length > MAX_SESSION_EVENTS) {
      const previewIndex = this.workflowEvents.findIndex(item => item.stage === "preview");
      if (previewIndex >= 0) { this.workflowEvents.splice(previewIndex, 1); this.droppedPreviewEvents += 1; this.droppedWorkflowEvents += 1; }
      else { this.workflowEvents.shift(); this.droppedWorkflowEvents += 1; }
    }
    this.queuePersist();
  }
  exportBundle(): string {
    if (!this.runs.length && !this.controllerEvents.length && !this.workflowEvents.length && !this.actionEvents.length && !this.exportEvents.length) throw new Error("请先操作一次：受控标记、自由轮廓或其他诊断动作均可");
    if (this.runs.some(run => run.status === "pending")) throw new Error("诊断记录尚在生成，请稍后导出");
    const payload = {
      schema: MARKER_DIAGNOSTIC_BUNDLE_SCHEMA, exported_at_ms: Date.now(),
      runs: this.runs, controller_events: this.controllerEvents, workflow_events: this.workflowEvents,
      action_events: this.actionEvents, export_events: this.exportEvents,
      dropped_runs: this.droppedRuns, dropped_controller_events: this.droppedControllerEvents,
      dropped_workflow_events: this.droppedWorkflowEvents, dropped_sources: this.droppedSources,
      dropped_page_instances: this.droppedPageInstances, dropped_export_events: this.droppedExportEvents,
      dropped_action_events: this.droppedActionEvents,
      raw_image_embedded: false, uploaded: false,
    };
    assertDiagnosticJson(payload);
    const text = JSON.stringify(payload, null, 2);
    if (new TextEncoder().encode(text).byteLength > MAX_DIAGNOSTIC_BYTES) throw new Error("诊断包超过8MB，未导出；请保留当前页面并向开发者反馈，不要刷新以免丢失记录");
    return text;
  }
  exportSession(): string {
    if (!this.runs.length && !this.controllerEvents.length && !this.workflowEvents.length && !this.actionEvents.length) throw new Error("请先完成一次诊断动作");
    if (this.runs.some(run => run.status === "pending")) throw new Error("诊断记录尚在生成，请稍后导出");
    const payload = { ...this.persisted(), exported_at_ms: Date.now(), export_events: this.exportEvents,
      raw_image_embedded: false, uploaded: false };
    assertDiagnosticJson(payload);
    let text = JSON.stringify(payload, null, 2);
    while (new TextEncoder().encode(text).byteLength > MAX_DIAGNOSTIC_BYTES) {
      const previewIndex = payload.workflow_events.findIndex(item => item.stage === "preview");
      if (previewIndex < 0) throw new Error("诊断包超过8MB；关键事件未被删除，请分段结束本次诊断会话后再导出");
      payload.workflow_events.splice(previewIndex, 1);
      payload.dropped_preview_events += 1;
      payload.dropped_workflow_events = (payload.dropped_workflow_events || 0) + 1;
      text = JSON.stringify(payload, null, 2);
    }
    return text;
  }
  import(text: string) { this.imported = parseDiagnosticRun(text); notify("诊断已导入；复放前将核对当前图片、参数和服务身份，不自动改参"); }
  message(text: string) { if (this.alive) notify(text); }
  dispose() {
    this.alive = false; this.generation++; this.selection = null; this.runs = []; this.controllerEvents = []; this.workflowEvents = []; this.actionEvents = []; this.exportEvents = []; this.imported = null;
    document.removeEventListener("change", this.onFile, true); document.removeEventListener("cancel", this.onFile, true);
    window.removeEventListener(CANVAS_EXPORT_DIAGNOSTIC_EVENT, this.onExport as EventListener);
  }
}
