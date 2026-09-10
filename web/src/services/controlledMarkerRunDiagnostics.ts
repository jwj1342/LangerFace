import { prepareImageSource } from "./imageSource.ts";
import { auditExportPayload } from "./exportPrivacy.ts";

export const MARKER_DIAGNOSTIC_EVENT = "langerface:marker-run-diagnostic";
export const MARKER_DIAGNOSTIC_SCHEMA = "marker-run-diagnostic/1";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type FrameIdentity = { kind: string | null; revision: number; width: number; height: number };
type SourceFile = { sha256: string; size: number; mime: string; width: number; height: number; rgba_sha256: string };
export type RunInput = {
  revision: number; width: number; height: number; seed: { x: number; y: number };
  options: { roiRadius: number; expectedDiameterPx: number; scanDiameterMm: number };
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
/** Typed digest metadata is not free text. Keep the shared privacy scanner unchanged. */
export function auditMarkerDiagnosticExport(value: unknown) {
  assertDiagnosticJson(value);
  if (!value || Array.isArray(value) || typeof value !== "object" || value.schema !== MARKER_DIAGNOSTIC_SCHEMA) throw new Error("诊断版本不支持导出");
  const auditCopy = structuredClone(value) as Record<string, Json>;
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
  for (const key of ["ok", "failure_code", "center", "boundary", "area_px", "bbox", "geometry_mode", "seed_relation", "marker_area_px", "marker_bbox", "confidence", "candidate_count", "warnings", "scan", "diagnostics", "audit"]) {
    if (raw[key] !== undefined) result[key] = JSON.parse(JSON.stringify(raw[key])) as Json;
  }
  assertDiagnosticJson(result);
  return result;
}
export function parseDiagnosticRun(text: string): DiagnosticRun {
  if (text.length > 2_000_000) throw new Error("诊断文件超过2MB");
  const value: unknown = JSON.parse(text);
  assertDiagnosticJson(value);
  const r = value as unknown as DiagnosticRun;
  if (r.schema !== MARKER_DIAGNOSTIC_SCHEMA || r.status !== "recorded" || !r.input || !r.input.seed || !r.input.options || !r.input.parameters
    || r.raw_image_embedded !== false || r.uploaded !== false || r.client_source_binding !== "UNKNOWN"
    || !["web_worker", "main_thread_fallback"].includes(r.channel)) throw new Error("诊断版本或状态不支持复放");
  return r;
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

/** Construct only behind the controller query gate; no listeners or fetch in ordinary mode. */
export class MarkerRunDiagnostics {
  private generation = 0;
  private selection: { generation: number; previousRevision: number; boundRevision: number | null; file: Promise<SourceFile | null> } | null = null;
  private sequence = 0;
  private runs: DiagnosticRun[] = [];
  private alive = true;
  private initialIdentity = serviceIdentity();
  imported: DiagnosticRun | null = null;
  private getFrame: () => FrameIdentity | null | undefined;
  constructor(getFrame: () => FrameIdentity | null | undefined) {
    this.getFrame = getFrame;
    document.addEventListener("change", this.onFile, true);
    document.addEventListener("cancel", this.onFile, true);
  }
  private onFile = (event: Event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== "fileInput") return;
    const generation = ++this.generation;
    this.selection = null;
    if (event.type === "cancel") return;
    const file = event.target.files?.[0];
    if (!file || !["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) return;
    this.selection = { generation, previousRevision: this.getFrame()?.revision ?? -1, boundRevision: null, file: this.decode(file) };
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
  begin(input: RunInput, requestId: number, channel: string, before: Uint8ClampedArray, actual: Uint8ClampedArray, retain = true, replayOf?: DiagnosticRun) {
    const selection = this.selection;
    const started = performance.now();
    const run: DiagnosticRun = {
      schema: MARKER_DIAGNOSTIC_SCHEMA, run_id: ++this.sequence, request_id: requestId, started_at_ms: Date.now(),
      status: "pending", elapsed_ms: null, input: structuredClone(input), channel,
      source_file: null, file_binding: "UNKNOWN", prepared_rgba_sha256: null, detector_rgba_sha256: null,
      service_identity: null, service_snapshot_binding: "UNKNOWN", client_declared_contract_binding: "UNKNOWN", client_source_binding: "UNKNOWN",
      raw_result: null, raw_image_embedded: false, uploaded: false,
      replay_of: replayOf ? { run_id: replayOf.run_id, started_at_ms: replayOf.started_at_ms } : null, comparison: null,
    };
    if (retain) { this.runs.push(run); this.runs = this.runs.slice(-8); }
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
  import(text: string) { this.imported = parseDiagnosticRun(text); notify("诊断已导入；复放前将核对当前图片、参数和服务身份，不自动改参"); }
  message(text: string) { if (this.alive) notify(text); }
  dispose() {
    this.alive = false; this.generation++; this.selection = null; this.runs = []; this.imported = null;
    document.removeEventListener("change", this.onFile, true); document.removeEventListener("cancel", this.onFile, true);
  }
}
