import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import {
  normalizeTumorInput,
  summarizeTumorInputQuality,
  type TumorInput,
} from "./incisionCandidateTools.ts";
import type { SurfaceRef } from "./incisionOverlay.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

type AnyRecord = Record<string, any>;
type LesionKind = "cutaneous" | "subcutaneous" | "unknown";
type LesionSource = "manual" | "import" | "detector";

const SCHEMA = "lesion-detection-adapter/v0.1";
const FORBIDDEN_KEYS = new Set([
  "api_key", "authorization", "approved", "base64", "canvas", "endpoint",
  "image", "image_base64", "landmarks", "live_overlay_ready", "pixels",
  "provider", "raw_image", "raw_video", "review_status", "reviewer", "token",
  "video", "video_base64",
]);

export interface LesionDetectionAdapterDraft {
  schema: typeof SCHEMA;
  source: LesionSource | "detector_confirmed";
  kind: LesionKind;
  topology: { id: string; version: string };
  geometry: { center_ref: SurfaceRef; boundary_refs: SurfaceRef[]; center: Vec3; boundary: Vec3[] };
  tumor: TumorInput | null;
  confidence: number;
  model: { name: string; version: string } | null;
  warnings: string[];
  human_confirmation_required: boolean;
  draft_only: boolean;
  eligible_for_candidate: boolean;
  provenance: AnyRecord;
  audit: {
    raw_image_sent: false;
    raw_video_sent: false;
    network_request_made: false;
    review_status_set: false;
  };
}

export interface LesionAdapterMesh {
  topologyId?: string;
  topologyVersion?: string;
  vertices: Vec3[];
  triangles: Triangle[];
}

function record(value: unknown, label: string): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as AnyRecord;
}

function rejectForbiddenFields(value: unknown, path = "$", seen = new Set<unknown>()): void {
  if (typeof value === "string" && /^data:(?:image|video)\//i.test(value.trim())) {
    throw new Error(`${path} contains forbidden embedded media`);
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenFields(item, `${path}.${index}`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    const normalizedKey = key.toLowerCase();
    const mediaOrSecretKey = normalizedKey.includes("base64")
      || /^(?:raw_)?(?:image|video)(?:_|$)/.test(normalizedKey)
      || normalizedKey.includes("api_key");
    if (FORBIDDEN_KEYS.has(normalizedKey) || mediaOrSecretKey) {
      throw new Error(`${path}.${key} is forbidden in lesion adapter payloads`);
    }
    rejectForbiddenFields(child, `${path}.${key}`, seen);
  }
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function surfaceRef(value: unknown, mesh: LesionAdapterMesh, label: string): SurfaceRef {
  const ref = record(value, label);
  const tri = Number(ref.tri);
  if (!Number.isInteger(tri) || tri < 0 || tri >= mesh.triangles.length) {
    throw new Error(`${label}.tri is outside the active topology`);
  }
  const u = finiteNumber(ref.u, `${label}.u`);
  const v = finiteNumber(ref.v, `${label}.v`);
  const w = finiteNumber(ref.w ?? 1 - u - v, `${label}.w`);
  if (Math.abs(u + v + w - 1) > 1e-4 || Math.min(u, v, w) < -1e-4 || Math.max(u, v, w) > 1 + 1e-4) {
    throw new Error(`${label} has invalid barycentric weights`);
  }
  return { tri, u, v, w };
}

function pointFromRef(ref: SurfaceRef, mesh: LesionAdapterMesh): Vec3 {
  const triangle = mesh.triangles[ref.tri];
  const points = triangle.map((index) => mesh.vertices[index]);
  if (points.some((point) => !point?.every(Number.isFinite))) throw new Error("active topology has invalid vertices");
  return [0, 1, 2].map((axis) => (
    ref.u * points[0][axis] + ref.v * points[1][axis] + ref.w * points[2][axis]
  )) as Vec3;
}

function optionalPositive(value: unknown, label: string, required: boolean): number | null {
  if (value == null && !required) return null;
  const number = finiteNumber(value, label);
  if (!(number > 0)) throw new Error(`${label} must be positive`);
  return number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function adapterAudit() {
  return {
    raw_image_sent: false as const,
    raw_video_sent: false as const,
    network_request_made: false as const,
    review_status_set: false as const,
  };
}

export function normalizeLesionDetectionAdapter(
  payload: unknown,
  mesh: LesionAdapterMesh,
): LesionDetectionAdapterDraft {
  rejectForbiddenFields(payload);
  const input = record(payload, "lesion adapter payload");
  if (input.schema !== SCHEMA) throw new Error(`unsupported lesion adapter schema: ${String(input.schema || "missing")}`);
  if (!["manual", "import", "detector"].includes(input.source)) throw new Error("lesion adapter source is invalid");
  if (!["cutaneous", "subcutaneous", "unknown"].includes(input.kind)) throw new Error("lesion adapter kind is invalid");
  if (input.units !== "mm") throw new Error("lesion adapter units must be mm");
  const topology = record(input.topology, "lesion adapter topology");
  const expectedTopologyId = mesh.topologyId || TOPOLOGY_ID;
  const expectedTopologyVersion = mesh.topologyVersion || TOPOLOGY_VERSION;
  if (topology.id !== expectedTopologyId || topology.version !== expectedTopologyVersion) {
    throw new Error("lesion adapter topology does not match the active surface");
  }
  const confidence = finiteNumber(input.confidence, "lesion adapter confidence");
  if (confidence < 0 || confidence > 1) throw new Error("lesion adapter confidence must be between 0 and 1");
  const centerRef = surfaceRef(input.center_ref, mesh, "center_ref");
  if (!Array.isArray(input.boundary_refs)) throw new Error("boundary_refs must be an array");
  if (input.kind === "cutaneous" && input.boundary_refs.length < 3) {
    throw new Error("cutaneous detector boundary must contain at least three refs");
  }
  const boundaryRefs = input.boundary_refs.map((ref: unknown, index: number) =>
    surfaceRef(ref, mesh, `boundary_refs.${index}`));
  const diameterMm = optionalPositive(input.diameter_mm, "diameter_mm", input.kind !== "unknown");
  const depthMm = optionalPositive(input.depth_mm, "depth_mm", false);
  const marginMm = input.margin_mm == null ? 0 : finiteNumber(input.margin_mm, "margin_mm");
  if (marginMm < 0) throw new Error("margin_mm must be non-negative");
  const warnings = stringArray(input.warnings, "warnings");
  const source = input.source as LesionSource;
  const model = input.model == null ? null : record(input.model, "model");
  if (source === "detector" && (!model || typeof model.name !== "string" || typeof model.version !== "string")) {
    throw new Error("detector payloads require model name and version");
  }
  const normalizedModel = model ? { name: String(model.name), version: String(model.version) } : null;
  const center = pointFromRef(centerRef, mesh);
  const boundary = boundaryRefs.map((ref) => pointFromRef(ref, mesh));
  const tumor = input.kind === "unknown" ? null : normalizeTumorInput({
    kind: input.kind,
    center,
    diameter_mm: diameterMm as number,
    depth_mm: input.kind === "subcutaneous" ? depthMm : null,
    margin_mm: input.kind === "cutaneous" ? marginMm : 0,
    boundary,
    boundary_mode: input.kind === "cutaneous" ? "freehand" : "center_diameter",
    boundary_source: source,
    source,
    author: source === "detector" ? "" : String(input.author || ""),
    units: "mm",
  });
  const quality = tumor ? summarizeTumorInputQuality(tumor) : { passed: false };
  const detectorDraft = source === "detector" || input.kind === "unknown" || confidence < 0.5;
  return {
    schema: SCHEMA,
    source,
    kind: input.kind as LesionKind,
    topology: { id: expectedTopologyId, version: expectedTopologyVersion },
    geometry: { center_ref: centerRef, boundary_refs: boundaryRefs, center, boundary },
    tumor,
    confidence,
    model: normalizedModel,
    warnings,
    human_confirmation_required: detectorDraft,
    draft_only: detectorDraft,
    eligible_for_candidate: Boolean(tumor && quality.passed && !detectorDraft),
    provenance: {
      original_detection: {
        source,
        kind: input.kind,
        center_ref: centerRef,
        boundary_refs: boundaryRefs,
        diameter_mm: diameterMm,
        depth_mm: depthMm,
        margin_mm: marginMm,
        confidence,
        model: normalizedModel,
        warnings,
      },
      clinician_override: null,
    },
    audit: adapterAudit(),
  };
}

export function confirmLesionDetectionDraft(
  draft: LesionDetectionAdapterDraft,
  overrides: Partial<TumorInput>,
  clinician: string,
): LesionDetectionAdapterDraft {
  if (draft.source !== "detector" || !draft.human_confirmation_required) {
    throw new Error("only unconfirmed detector drafts can be confirmed");
  }
  const author = clinician.trim();
  if (!author) throw new Error("clinician confirmation requires an author");
  const original = draft.provenance.original_detection || {};
  const kind = overrides.kind || (draft.kind === "unknown" ? null : draft.kind);
  if (kind !== "cutaneous" && kind !== "subcutaneous") throw new Error("clinician must confirm a known tumor kind");
  const tumor = normalizeTumorInput({
    kind,
    center: overrides.center || draft.geometry.center,
    diameter_mm: overrides.diameter_mm ?? original.diameter_mm,
    depth_mm: overrides.depth_mm ?? original.depth_mm,
    margin_mm: overrides.margin_mm ?? original.margin_mm,
    boundary: overrides.boundary || draft.geometry.boundary,
    boundary_mode: overrides.boundary_mode || (kind === "cutaneous" ? "freehand" : "center_diameter"),
    boundary_source: overrides.boundary_source || "detector_confirmed",
    source: "detector_confirmed",
    author,
    units: "mm",
  });
  const quality = summarizeTumorInputQuality(tumor);
  return {
    ...draft,
    source: "detector_confirmed",
    kind,
    tumor,
    human_confirmation_required: false,
    draft_only: false,
    eligible_for_candidate: quality.passed,
    provenance: {
      ...draft.provenance,
      clinician_override: { ...overrides, author },
    },
    audit: adapterAudit(),
  };
}
