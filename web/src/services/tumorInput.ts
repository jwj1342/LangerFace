import { normalizeTumorInput, type TumorInput } from "./incisionCandidateTools.ts";

export type Vec3 = [number, number, number];
export type TumorKind = "subcutaneous" | "cutaneous";
export type TumorBoundaryMode = "center_diameter" | "ellipse" | "freehand";

export interface TumorFormState {
  kind: string;
  center: Vec3;
  diameterMm: number | null;
  depthMm: number | null;
  marginMm: number | null;
  boundary: Vec3[];
  boundaryMode: string;
  author: string;
}

export interface TumorSnapshotInput {
  kind?: string;
  author?: string;
  diameterMm?: number | null;
  depthMm?: number | null;
  marginMm?: number | null;
  boundaryMode?: string;
  boundaryActive?: boolean;
  boundaryPointCount?: number;
  boundaryStatus?: string;
  boundaryStatusWarn?: boolean;
  pickState?: string;
  anatomyPreview?: string;
  anatomyPreviewWarn?: boolean;
}

export interface TumorFormSnapshot {
  kind: string;
  author: string;
  diameterMm: number | null;
  depthMm: number | null;
  marginMm: number | null;
  boundaryMode: string;
  boundaryActive: boolean;
  boundaryPointCount: number;
  boundaryStatus: string;
  boundaryStatusWarn: boolean;
  pickState: string;
  anatomyPreview: string;
  anatomyPreviewWarn: boolean;
}

export interface TumorImportedFormState {
  tumor: TumorInput;
  kind: string;
  diameterValue: string;
  depthValue: string;
  marginValue: string;
  author: string;
  boundaryMode: "ellipse" | "freehand";
  boundaryPoints: Vec3[];
  pickState: string;
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function numericControlValue(value: unknown): number | null {
  if (value && typeof value === "object" && "value" in value) {
    return finiteOrNull((value as { value?: unknown }).value);
  }
  return finiteOrNull(value);
}

export function normalizeTumorKind(kind?: string): TumorKind {
  return kind === "cutaneous" ? "cutaneous" : "subcutaneous";
}

export function normalizeTumorBoundaryMode(kind?: string, boundaryMode?: string): TumorBoundaryMode {
  if (normalizeTumorKind(kind) !== "cutaneous") return "center_diameter";
  return boundaryMode === "freehand" ? "freehand" : "ellipse";
}

export function buildTumorInput({
  kind,
  center,
  diameterMm,
  depthMm,
  marginMm,
  boundary,
  boundaryMode,
  author,
}: TumorFormState): TumorInput {
  const normalizedKind = normalizeTumorKind(kind);
  const normalizedBoundaryMode = normalizeTumorBoundaryMode(normalizedKind, boundaryMode);
  const sourceBoundary = normalizedKind === "cutaneous" ? boundary : [];
  return {
    kind: normalizedKind,
    center,
    diameter_mm: Number(diameterMm),
    depth_mm: normalizedKind === "subcutaneous" ? Number(depthMm) : null,
    margin_mm: normalizedKind === "cutaneous" ? Number(marginMm) : 0,
    boundary: sourceBoundary,
    boundary_mode: normalizedBoundaryMode,
    boundary_source: normalizedKind === "cutaneous" ? `manual_${normalizedBoundaryMode}` : "ultrasound_diameter",
    source: "manual_web_agent",
    author: author.trim(),
    units: "mm",
  };
}

export function buildTumorFormSnapshot(input: TumorSnapshotInput): TumorFormSnapshot {
  const kind = normalizeTumorKind(input.kind);
  return {
    kind,
    author: input.author?.trim?.() || "",
    diameterMm: input.diameterMm ?? null,
    depthMm: kind === "subcutaneous" ? input.depthMm ?? null : null,
    marginMm: kind === "cutaneous" ? input.marginMm ?? 0 : 0,
    boundaryMode: normalizeTumorBoundaryMode(kind, input.boundaryMode),
    boundaryActive: Boolean(input.boundaryActive),
    boundaryPointCount: Number.isFinite(input.boundaryPointCount) ? Number(input.boundaryPointCount) : 0,
    boundaryStatus: input.boundaryStatus || "",
    boundaryStatusWarn: Boolean(input.boundaryStatusWarn),
    pickState: input.pickState || "",
    anatomyPreview: input.anatomyPreview || "",
    anatomyPreviewWarn: Boolean(input.anatomyPreviewWarn),
  };
}

function clampRounded(value: number | null | undefined, min: number, max: number, fallback: number) {
  const n = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return String(Math.max(min, Math.min(max, Math.round(n))));
}

export function importedTumorFormState(
  payload: unknown,
  controls: {
    diameterMin: number;
    diameterMax: number;
    depthMin: number;
    depthMax: number;
    depthFallback: number;
    marginMin: number;
    marginMax: number;
    authorFallback: string;
  },
): TumorImportedFormState {
  const raw = (payload && typeof payload === "object" && "tumor" in payload)
    ? (payload as { tumor?: unknown }).tumor
    : payload;
  const tumor = normalizeTumorInput(raw as TumorInput);
  const boundary = Array.isArray(tumor.boundary) ? (tumor.boundary as Vec3[]) : [];
  const boundaryPoints = tumor.kind === "cutaneous" && boundary.length >= 3
    ? boundary.map((point) => point.map(Number) as Vec3)
    : [];
  return {
    tumor,
    kind: normalizeTumorKind(tumor.kind),
    diameterValue: clampRounded(tumor.diameter_mm, controls.diameterMin, controls.diameterMax, controls.diameterMin),
    depthValue: clampRounded(tumor.depth_mm, controls.depthMin, controls.depthMax, controls.depthFallback),
    marginValue: clampRounded(tumor.margin_mm, controls.marginMin, controls.marginMax, controls.marginMin),
    author: tumor.author || controls.authorFallback,
    boundaryMode: tumor.kind === "cutaneous" && boundaryPoints.length >= 3
      ? "freehand"
      : tumor.kind === "cutaneous" && tumor.boundary_mode === "freehand"
        ? "freehand"
        : "ellipse",
    boundaryPoints,
    pickState: boundaryPoints.length >= 3
      ? `已导入肿物：自由轮廓 ${boundaryPoints.length} 点`
      : "已导入肿物：中心点与直径",
  };
}
