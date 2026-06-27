import { ANNOTATE_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

export { ANNOTATE_SNAPSHOT_SCHEMA_VERSION };

export const ANNOTATE_SYSTEM_LABELS: Record<string, string> = {
  rstl: "RSTL",
  langer: "Langer",
};

export interface AnnotatePointLike {
  xyz?: unknown;
  tri?: unknown;
  bary?: unknown;
  exportable?: boolean;
}

export interface AnnotateLineLike {
  name?: string;
  region?: string;
  controls?: AnnotatePointLike[];
  points?: AnnotatePointLike[];
  fallback?: boolean;
}

export interface AnnotateModelLike {
  system?: string;
  current?: AnnotateLineLike | null;
  lines?: AnnotateLineLike[];
  topologyId?: string | null;
  topologyVersion?: string | null;
  hasBarycentric?: () => boolean;
}

export interface AnnotateMeshState {
  loaded: boolean;
  modeLabel: string;
  onCanonical: boolean;
  topologyId: string | null;
  topologyVersion: string | null;
}

export interface AnnotateMeshActionsState {
  canLoadFlame: boolean;
  canLoadFittedFlame: boolean;
}

export interface AnnotateDraftState {
  active: boolean;
  name: string | null;
  region: string | null;
  controlCount: number;
  pathPointCount: number;
  fallback: boolean;
}

export interface AnnotateSavedSummary {
  count: number;
  warningCount: number;
  totalControlPoints: number;
  totalPathPoints: number;
  lines: AnnotateSavedLineSummary[];
}

export interface AnnotateSavedLineSummary {
  index: number;
  title: string;
  meta: string;
  fallback: boolean;
  warning: string | null;
}

export interface AnnotateExportState {
  canExportAtlas: boolean;
  canExportXyz: boolean;
  canPreviewActiveAtlas: boolean;
}

export interface AnnotateControllerSnapshot {
  schema_version: typeof ANNOTATE_SNAPSHOT_SCHEMA_VERSION;
  reason: string;
  hint: string;
  system: string;
  mesh: AnnotateMeshState;
  meshActions: AnnotateMeshActionsState;
  draft: AnnotateDraftState;
  saved: AnnotateSavedSummary;
  export: AnnotateExportState;
  updatedAt: string;
}

export interface AnnotateControllerSnapshotInput {
  reason?: string;
  hint?: string;
  system?: string;
  model?: AnnotateModelLike | null;
  meshLoaded?: boolean;
  modeLabel?: string;
  onCanonical?: boolean;
  topologyId?: string | null;
  topologyVersion?: string | null;
  canLoadFlame?: boolean;
  canLoadFittedFlame?: boolean;
  updatedAt?: string;
}

export function annotateSystemLabel(system?: string) {
  return ANNOTATE_SYSTEM_LABELS[system || ""] || String(system || "RSTL").toUpperCase();
}

export function controlsOf(line?: AnnotateLineLike | null) {
  return line ? (line.controls || line.points || []) : [];
}

export function buildAnnotateDraftSnapshot(model?: AnnotateModelLike | null): AnnotateDraftState {
  const line = model?.current || null;
  const controls = controlsOf(line);
  return {
    active: Boolean(line),
    name: line?.name || null,
    region: line?.region || null,
    controlCount: controls.length,
    pathPointCount: line?.points?.length || 0,
    fallback: Boolean(line?.fallback),
  };
}

export function buildAnnotateSavedSummary(model?: AnnotateModelLike | null): AnnotateSavedSummary {
  const lines = model?.lines || [];
  const systemLabel = annotateSystemLabel(model?.system);
  return lines.reduce<AnnotateSavedSummary>((acc, line, index) => {
    const controls = controlsOf(line);
    const pathPointCount = line.points?.length || 0;
    const fallback = Boolean(line?.fallback);
    acc.count += 1;
    acc.warningCount += fallback ? 1 : 0;
    acc.totalControlPoints += controls.length;
    acc.totalPathPoints += pathPointCount;
    acc.lines.push({
      index,
      title: `${index + 1}. ${line.name}`,
      meta: `${systemLabel}${line.region ? " · " + line.region : ""} · ${controls.length} 控制点 · ${pathPointCount} 路径点${fallback ? " · 贴面 fallback" : ""}`,
      fallback,
      warning: fallback ? "需复核：该线存在退回直线连接，可能穿面" : null,
    });
    return acc;
  }, { count: 0, warningCount: 0, totalControlPoints: 0, totalPathPoints: 0, lines: [] });
}

export function buildAnnotateExportState(
  model?: AnnotateModelLike | null,
  onCanonical = false,
): AnnotateExportState {
  const hasLines = Boolean(model?.lines?.length);
  return {
    canExportAtlas: Boolean(hasLines && onCanonical && model?.hasBarycentric?.()),
    canExportXyz: hasLines,
    canPreviewActiveAtlas: Boolean(hasLines && onCanonical && model?.topologyId === "mediapipe-468"),
  };
}

export function buildAnnotateControllerSnapshot({
  reason = "state_update",
  hint = "",
  system,
  model,
  meshLoaded = false,
  modeLabel = "",
  onCanonical = false,
  topologyId,
  topologyVersion,
  canLoadFlame = false,
  canLoadFittedFlame = false,
  updatedAt = new Date().toISOString(),
}: AnnotateControllerSnapshotInput): AnnotateControllerSnapshot {
  const resolvedSystem = system || model?.system || "rstl";
  return {
    schema_version: ANNOTATE_SNAPSHOT_SCHEMA_VERSION,
    reason,
    hint,
    system: resolvedSystem,
    mesh: {
      loaded: meshLoaded,
      modeLabel,
      onCanonical,
      topologyId: topologyId ?? model?.topologyId ?? null,
      topologyVersion: topologyVersion ?? model?.topologyVersion ?? null,
    },
    meshActions: {
      canLoadFlame,
      canLoadFittedFlame,
    },
    draft: buildAnnotateDraftSnapshot(model),
    saved: buildAnnotateSavedSummary(model),
    export: buildAnnotateExportState(model, onCanonical),
    updatedAt,
  };
}
